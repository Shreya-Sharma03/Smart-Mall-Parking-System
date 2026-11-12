"""
Slot Mapper: Vehicle-to-Parking-Slot Association Engine
Milestone 4 - Phase 3: Smart Mall Parking Management System

Maps YOLOv8 vehicle detections to parking slot ROI polygons using:
1. Perspective-adjusted Ground-Contact Point Containment (Primary indicator).
2. Bounding Box & Polygon Overlap / Intersection-over-Union (IoU).
3. Duplicate Detection Suppression (high inter-vehicle IoU -> keep highest confidence).
4. Candidate Disambiguation and Multi-Vehicle Conflict Detection.
5. Per-Slot Camera Occupancy Candidate Generation ('occupied', 'available_candidate', 'uncertain').
6. Obstruction-aware uncertain classification for unmapped vehicles overlapping bay areas.
"""

import time
import math
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any, Tuple, Optional, Set

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None
    np = None

from config.topology import ALL_SLOT_IDS, FLOORS
from detection.detector import DetectionResult
from utils.roi_utils import get_camera_slots, normalized_to_pixel


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

@dataclass
class SlotMapperConfig:
    """
    Configurable parameters and thresholds for vehicle-to-slot mapping.
    """
    # Overlap and IoU thresholds for uncontained detections
    min_overlap_ratio: float = 0.30     # Min ratio of vehicle area inside slot polygon
    min_iou: float = 0.20               # Min IoU between vehicle bounding box and slot polygon
    min_match_score: float = 0.15       # Minimum combined score required to qualify as candidate (aligned with 0.50 * 0.30)

    # Weighting between bottom-center containment and polygon overlap
    point_containment_bonus: float = 0.50  # Base score awarded when ground-contact is inside polygon [0.50..1.00]
    overlap_weight: float = 0.50           # Weight awarded to polygon overlap / IoU [0.00..0.50]

    # Method selection threshold
    hybrid_overlap_threshold: float = 0.25  # Overlap ratio threshold to distinguish 'hybrid' vs 'bottom_center_containment'

    # Ambiguity and conflict detection thresholds
    boundary_ambiguity_threshold: float = 0.06  # If top 2 slots have score diff < threshold
    conflict_iou_threshold: float = 0.20        # IoU threshold between two vehicle bounding boxes to declare physical overlap
    duplicate_iou_threshold: float = 0.65       # IoU threshold above which two detections are treated as the same physical vehicle

    # Perspective ground-contact & obstruction thresholds
    ground_contact_offset_ratio: float = 0.08   # Offset from bottom bbox edge toward tire contact patch centroid
    obstruction_overlap_threshold: float = 0.15  # Min overlap ratio for unmapped vehicle to mark bay as obstructed/uncertain

    # Overlap gate for point-containment bonus
    # The point-containment bonus is only awarded when the vehicle's physical area overlap with
    # that slot meets this threshold. This prevents a 1-px boundary edge-crossing from
    # misassigning a vehicle whose bounding box physically resides overwhelmingly inside a
    # different slot. Must be <= min_overlap_ratio so as not to suppress valid tight fits.
    containment_min_overlap_gate: float = 0.15  # Min overlap_ratio to award point_containment_bonus


@dataclass
class MappedVehicle:
    """
    Structured result of mapping a single detected vehicle to a parking slot.
    """
    slot_id: Optional[str]               # e.g., "B1-A01" or None if unmapped
    floor: str                           # e.g., "B1"
    camera_id: str                       # e.g., "CAM-B1-01"
    vehicle_class: str                   # e.g., "car", "motorcycle"
    confidence: float                    # YOLO detection confidence [0.0, 1.0]
    bounding_box: Tuple[int, int, int, int]  # (x1, y1, x2, y2) in pixels
    bottom_center: Tuple[float, float]   # (center_x, ground_y) in pixels (perspective-corrected)
    mapping_method: str                  # "bottom_center_containment", "roi_overlap", "hybrid", "unmapped"
    overlap_score: float                 # Combined match score [0.0, 1.0]
    occupancy_candidate: str             # "occupied", "uncertain", "unmapped"
    timestamp: float                     # Unix or frame timestamp
    is_conflict: bool = False            # True if multiple vehicles compete for this slot
    conflict_reason: Optional[str] = None
    track_id: Optional[int] = None       # Milestone 5 persistent tracking ID

    def to_dict(self) -> Dict[str, Any]:
        """Convert to serializable dictionary matching canonical schema."""
        return {
            "slotId": self.slot_id,
            "floor": self.floor,
            "cameraId": self.camera_id,
            "vehicleClass": self.vehicle_class,
            "confidence": round(float(self.confidence), 4),
            "boundingBox": [int(v) for v in self.bounding_box],
            "bottomCenter": [round(float(self.bottom_center[0]), 2), round(float(self.bottom_center[1]), 2)],
            "mappingMethod": self.mapping_method,
            "overlapScore": round(float(self.overlap_score), 4),
            "occupancyCandidate": self.occupancy_candidate,
            "timestamp": round(float(self.timestamp), 3),
            "isConflict": self.is_conflict,
            "conflictReason": self.conflict_reason,
            "trackId": self.track_id,
        }


@dataclass
class SlotOccupancyCandidate:
    """
    Candidate occupancy state for an individual parking bay derived from camera vision.

    Status definitions:
      - 'occupied': A vehicle is reliably mapped to this slot.
      - 'available_candidate': No vehicle mapped in current camera frame.
                               (Note: candidate only, subject to occlusion/temporal check).
      - 'uncertain': Ambiguous mapping (e.g. multiple vehicles conflicting or boundary straddle).
      - 'not_monitored': Slot belongs to canonical topology but is not visible in this camera FOV.
    """
    slot_id: str
    floor: str
    camera_id: str
    candidate_status: str                # 'occupied', 'available_candidate', 'uncertain', 'not_monitored'
    mapped_vehicle: Optional[Dict[str, Any]] = None
    confidence: float = 0.0
    timestamp: float = 0.0
    notes: str = ""
    conflict_details: Optional[str] = None
    is_monitored: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "slotId": self.slot_id,
            "floor": self.floor,
            "cameraId": self.camera_id,
            "candidateStatus": self.candidate_status,
            "isMonitored": self.is_monitored,
            "mappedVehicle": self.mapped_vehicle,
            "confidence": round(float(self.confidence), 4),
            "timestamp": round(float(self.timestamp), 3),
            "notes": self.notes,
            "conflictDetails": self.conflict_details,
        }


@dataclass
class FrameMappingResult:
    """
    Container summarizing all vehicle mappings and slot candidates for a frame.
    """
    camera_id: str
    floor: str
    timestamp: float
    total_slots_monitored: int
    occupied_count: int
    available_candidate_count: int
    uncertain_count: int
    unmapped_vehicles_count: int
    slot_candidates: Dict[str, SlotOccupancyCandidate]
    mapped_vehicles: List[MappedVehicle]
    unmapped_vehicles: List[MappedVehicle]
    unmonitored_count: int = 0
    unmonitored_slots: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "cameraId": self.camera_id,
            "floor": self.floor,
            "timestamp": round(float(self.timestamp), 3),
            "summary": {
                "totalSlotsMonitored": self.total_slots_monitored,
                "occupiedCount": self.occupied_count,
                "availableCandidateCount": self.available_candidate_count,
                "uncertainCount": self.uncertain_count,
                "unmappedVehiclesCount": self.unmapped_vehicles_count,
                "unmonitoredCount": self.unmonitored_count,
                "unmonitoredSlots": self.unmonitored_slots,
            },
            "slotCandidates": {
                s_id: candidate.to_dict() for s_id, candidate in self.slot_candidates.items()
            },
            "mappedVehicles": [v.to_dict() for v in self.mapped_vehicles],
            "unmappedVehicles": [v.to_dict() for v in self.unmapped_vehicles],
        }


# ---------------------------------------------------------------------------
# Pure Geometric Functions (NumPy/OpenCV independent with fallbacks)
# ---------------------------------------------------------------------------

def calculate_ground_contact_point(
    bbox: Tuple[int, int, int, int],
    offset_ratio: float = 0.08,
) -> Tuple[float, float]:
    """
    Computes the perspective-adjusted ground contact centroid of a vehicle.
    Accounts for bumper overhang and camera elevation angle by offsetting
    the contact point upward from the bottom bbox edge toward the tire patch.

    Formula: P_ground = ( (x1 + x2)/2, y2 - offset_ratio * (y2 - y1) )

    With offset_ratio=0.08, the reference point is at 92% of the bbox height
    from the top — i.e., near (but slightly above) the visible bottom edge,
    accounting for perspective foreshortening on CCTV cameras.
    """
    x1, y1, x2, y2 = bbox
    height = max(1.0, float(y2 - y1))
    center_x = (x1 + x2) / 2.0
    ground_y = float(y2) - float(offset_ratio) * height
    return center_x, ground_y


def calculate_bottom_center(bbox: Tuple[int, int, int, int]) -> Tuple[float, float]:
    """
    Computes the bottom-center point (center_x, bottom_y) of a bounding box.
    Retained for backward compatibility with tests and legacy callers.
    """
    x1, y1, x2, y2 = bbox
    center_x = (x1 + x2) / 2.0
    bottom_y = float(y2)
    return center_x, bottom_y


def is_point_in_polygon(px: float, py: float, polygon: List[List[float]]) -> bool:
    """
    Determines if a 2D point (px, py) lies inside a polygon using ray-casting.
    Works independently of OpenCV/NumPy. Includes boundary edges.
    """
    n = len(polygon)
    if n < 3:
        return False

    inside = False
    p1x, p1y = polygon[0]
    for i in range(1, n + 1):
        p2x, p2y = polygon[i % n]

        # Check if point lies exactly on an edge
        if (min(p1x, p2x) <= px <= max(p1x, p2x)) and (min(p1y, p2y) <= py <= max(p1y, p2y)):
            # Check collinearity: (y - y1)*(x2 - x1) == (x - x1)*(y2 - y1)
            dx = p2x - p1x
            dy = p2y - p1y
            if abs((py - p1y) * dx - (px - p1x) * dy) < 1e-5:
                return True

        if py > min(p1y, p2y):
            if py <= max(p1y, p2y):
                if px <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (py - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or px <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y

    return inside


def get_polygon_bbox(polygon: List[List[float]]) -> Tuple[float, float, float, float]:
    """
    Calculates the axis-aligned bounding box of a polygon: (min_x, min_y, max_x, max_y).
    """
    xs = [p[0] for p in polygon]
    ys = [p[1] for p in polygon]
    return min(xs), min(ys), max(xs), max(ys)


def calculate_polygon_centroid(polygon: List[List[float]]) -> Tuple[float, float]:
    """
    Calculates the centroid (cx, cy) of a 2D polygon.
    """
    n = len(polygon)
    if n == 0:
        return 0.0, 0.0
    cx = sum(p[0] for p in polygon) / float(n)
    cy = sum(p[1] for p in polygon) / float(n)
    return cx, cy


def polygon_area(polygon: List[List[float]]) -> float:
    """
    Computes the exact 2D area of a polygon using the Shoelace formula (Gauss's area formula).
    """
    n = len(polygon)
    if n < 3:
        return 0.0
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += polygon[i][0] * polygon[j][1]
        area -= polygon[j][0] * polygon[i][1]
    return abs(area) / 2.0


def clip_polygon_to_bbox(
    polygon: List[List[float]],
    bbox: Tuple[float, float, float, float],
) -> List[List[float]]:
    """
    Clips a polygon against an axis-aligned bounding box (x1, y1, x2, y2)
    using the Sutherland-Hodgman polygon clipping algorithm.
    Returns the vertices of the intersection polygon without external dependencies.
    """
    if len(polygon) < 3:
        return []

    bx1, by1, bx2, by2 = bbox

    # 4 clipping stages: Left (x >= bx1), Right (x <= bx2), Top (y >= by1), Bottom (y <= by2)
    def clip_edge(poly: List[List[float]], inside_fn, intersect_fn) -> List[List[float]]:
        clipped = []
        if not poly:
            return clipped
        p1 = poly[-1]
        for p2 in poly:
            if inside_fn(p2):
                if not inside_fn(p1):
                    clipped.append(intersect_fn(p1, p2))
                clipped.append(p2)
            elif inside_fn(p1):
                clipped.append(intersect_fn(p1, p2))
            p1 = p2
        return clipped

    # Stage 1: Left boundary (x >= bx1)
    output = clip_edge(
        polygon,
        lambda p: p[0] >= bx1,
        lambda p1, p2: [bx1, p1[1] + (p2[1] - p1[1]) * (bx1 - p1[0]) / (p2[0] - p1[0]) if p2[0] != p1[0] else p1[1]],
    )
    # Stage 2: Right boundary (x <= bx2)
    output = clip_edge(
        output,
        lambda p: p[0] <= bx2,
        lambda p1, p2: [bx2, p1[1] + (p2[1] - p1[1]) * (bx2 - p1[0]) / (p2[0] - p1[0]) if p2[0] != p1[0] else p1[1]],
    )
    # Stage 3: Top boundary (y >= by1)
    output = clip_edge(
        output,
        lambda p: p[1] >= by1,
        lambda p1, p2: [p1[0] + (p2[0] - p1[0]) * (by1 - p1[1]) / (p2[1] - p1[1]) if p2[1] != p1[1] else p1[0], by1],
    )
    # Stage 4: Bottom boundary (y <= by2)
    output = clip_edge(
        output,
        lambda p: p[1] <= by2,
        lambda p1, p2: [p1[0] + (p2[0] - p1[0]) * (by2 - p1[1]) / (p2[1] - p1[1]) if p2[1] != p1[1] else p1[0], by2],
    )

    return output


def compute_polygon_intersection_and_iou(
    polygon: List[List[float]],
    bbox: Tuple[float, float, float, float],
) -> Tuple[float, float, float]:
    """
    Computes exact polygon-to-bounding-box intersection area, IoU, and overlap ratio.
    Accurately handles tilted, skewed, or irregular parking slot polygons without
    introducing false overlap from bounding box padding.

    :param polygon: 2D slot ROI polygon vertices [[x1, y1], [x2, y2], ...]
    :param bbox: Vehicle bounding box (x1, y1, x2, y2)
    :returns: Tuple (intersection_area, iou, overlap_ratio_of_vehicle)
    """
    vx1, vy1, vx2, vy2 = bbox
    veh_area = max(0.0, vx2 - vx1) * max(0.0, vy2 - vy1)
    if veh_area <= 0.0 or len(polygon) < 3:
        return 0.0, 0.0, 0.0

    # Fast rejection test against slot's axis-aligned bounding box
    sx1, sy1, sx2, sy2 = get_polygon_bbox(polygon)
    if vx2 < sx1 or vx1 > sx2 or vy2 < sy1 or vy1 > sy2:
        return 0.0, 0.0, 0.0

    # Exact Sutherland-Hodgman polygon clipping
    clipped = clip_polygon_to_bbox(polygon, bbox)
    inter_area = polygon_area(clipped)

    slot_area = polygon_area(polygon)
    union_area = veh_area + slot_area - inter_area

    iou = inter_area / union_area if union_area > 0.0 else 0.0
    overlap_ratio = inter_area / veh_area if veh_area > 0.0 else 0.0

    return inter_area, iou, overlap_ratio


def compute_bbox_intersection_and_iou(
    bbox1: Tuple[float, float, float, float],
    bbox2: Tuple[float, float, float, float],
) -> Tuple[float, float, float]:
    """
    Computes axis-aligned bounding box intersection area, IoU, and ratio.
    Retained as an alternative/fallback for rectangular geometries.
    """
    b1_x1, b1_y1, b1_x2, b1_y2 = bbox1
    b2_x1, b2_y1, b2_x2, b2_y2 = bbox2

    ix1 = max(b1_x1, b2_x1)
    iy1 = max(b1_y1, b2_y1)
    ix2 = min(b1_x2, b2_x2)
    iy2 = min(b1_y2, b2_y2)

    inter_w = max(0.0, ix2 - ix1)
    inter_h = max(0.0, iy2 - iy1)
    inter_area = inter_w * inter_h

    area1 = max(0.0, b1_x2 - b1_x1) * max(0.0, b1_y2 - b1_y1)
    area2 = max(0.0, b2_x2 - b2_x1) * max(0.0, b2_y2 - b2_y1)

    union_area = area1 + area2 - inter_area
    iou = inter_area / union_area if union_area > 0 else 0.0
    overlap_ratio1 = inter_area / area1 if area1 > 0 else 0.0

    return inter_area, iou, overlap_ratio1


def compute_bbox_iou(
    bbox1: Tuple[float, float, float, float],
    bbox2: Tuple[float, float, float, float],
) -> float:
    """Computes Intersection-over-Union (IoU) between two bounding boxes."""
    b1_x1, b1_y1, b1_x2, b1_y2 = bbox1
    b2_x1, b2_y1, b2_x2, b2_y2 = bbox2

    ix1 = max(b1_x1, b2_x1)
    iy1 = max(b1_y1, b2_y1)
    ix2 = min(b1_x2, b2_x2)
    iy2 = min(b1_y2, b2_y2)

    inter_w = max(0.0, ix2 - ix1)
    inter_h = max(0.0, iy2 - iy1)
    inter_area = inter_w * inter_h

    area1 = max(0.0, b1_x2 - b1_x1) * max(0.0, b1_y2 - b1_y1)
    area2 = max(0.0, b2_x2 - b2_x1) * max(0.0, b2_y2 - b2_y1)
    union_area = area1 + area2 - inter_area

    return inter_area / union_area if union_area > 0.0 else 0.0


# ---------------------------------------------------------------------------
# Slot Mapper Implementation
# ---------------------------------------------------------------------------

class SlotMapper:
    """
    Maps detected vehicles to configured parking slot ROI polygons.
    """

    def __init__(self, config: Optional[SlotMapperConfig] = None):
        """
        Initialize the slot mapper with configuration thresholds.
        """
        self.config = config or SlotMapperConfig()

    def map_detections(
        self,
        detections: List[Any],
        slots_config: Dict[str, Any],
        frame_dims: Tuple[int, int],
        camera_id: str = "CAM-B1-01",
        timestamp: float = 0.0,
    ) -> FrameMappingResult:
        """
        Maps a list of vehicle detections to parking slots for a specific camera.

        :param detections: List of DetectionResult objects or dictionaries
        :param slots_config: Loaded slots ROI configuration
        :param frame_dims: Frame (width, height) in pixels
        :param camera_id: Target camera identifier (e.g. 'CAM-B1-01')
        :param timestamp: Frame timestamp in seconds
        :returns: FrameMappingResult containing mapped vehicles and slot candidates
        """
        width, height = frame_dims
        if width <= 0 or height <= 0:
            raise ValueError(f"Invalid frame dimensions: {width}x{height}")

        # 1. Resolve camera slot configurations
        camera_entry = None
        for cam in slots_config.get("cameras", []):
            if cam.get("cameraId") == camera_id:
                camera_entry = cam
                break

        if not camera_entry:
            raise ValueError(f"[SlotMapper] Camera '{camera_id}' not found in slots configuration")

        camera_floor = camera_entry.get("floor", "B1")
        configured_slots = camera_entry.get("slots", [])

        # Validate that slots belong to canonical topology
        camera_slot_ids = []
        slot_polygons_px: Dict[str, List[List[float]]] = {}
        slot_bboxes_px: Dict[str, Tuple[float, float, float, float]] = {}

        for slot in configured_slots:
            s_id = slot.get("slotId")
            if not s_id or s_id not in ALL_SLOT_IDS:
                continue

            camera_slot_ids.append(s_id)
            norm_poly = slot.get("polygon", [])

            # Convert normalized coordinates to pixel coordinates
            poly_px: List[List[float]] = []
            for pt in norm_poly:
                px = pt[0] * width
                py = pt[1] * height
                poly_px.append([px, py])

            slot_polygons_px[s_id] = poly_px
            slot_bboxes_px[s_id] = get_polygon_bbox(poly_px)

        # 2. Convert raw detections into standardized format
        standardized_dets = []
        for det in detections:
            if isinstance(det, DetectionResult):
                standardized_dets.append({
                    "class_name": det.class_name,
                    "confidence": det.confidence,
                    "bounding_box": det.bounding_box,
                    "timestamp": getattr(det, "frame_timestamp", timestamp),
                    "track_id": getattr(det, "track_id", None),
                })
            elif isinstance(det, dict):
                standardized_dets.append({
                    "class_name": det.get("class_name", det.get("vehicleClass", "car")),
                    "confidence": float(det.get("confidence", 1.0)),
                    "bounding_box": tuple(det.get("bounding_box", det.get("boundingBox", (0, 0, 0, 0)))),
                    "timestamp": float(det.get("timestamp", timestamp)),
                    "track_id": det.get("track_id", det.get("trackId", None)),
                })
            elif hasattr(det, "bounding_box"):
                # Duck-typing for TrackedVehicle or custom detection objects
                standardized_dets.append({
                    "class_name": getattr(det, "class_name", "car"),
                    "confidence": float(getattr(det, "confidence", 1.0)),
                    "bounding_box": tuple(int(c) for c in getattr(det, "bounding_box")),
                    "timestamp": float(getattr(det, "last_seen_timestamp", timestamp)),
                    "track_id": getattr(det, "track_id", None),
                })

        # 2a. Duplicate-detection suppression
        # If two detections have inter-vehicle IoU >= duplicate_iou_threshold,
        # keep only the higher-confidence one and suppress the other.
        suppressed_indices: Set[int] = set()
        for a_idx in range(len(standardized_dets)):
            if a_idx in suppressed_indices:
                continue
            for b_idx in range(a_idx + 1, len(standardized_dets)):
                if b_idx in suppressed_indices:
                    continue
                pair_iou = compute_bbox_iou(
                    standardized_dets[a_idx]["bounding_box"],
                    standardized_dets[b_idx]["bounding_box"],
                )
                if pair_iou >= self.config.duplicate_iou_threshold:
                    # Suppress the lower-confidence detection
                    if standardized_dets[a_idx]["confidence"] >= standardized_dets[b_idx]["confidence"]:
                        suppressed_indices.add(b_idx)
                    else:
                        suppressed_indices.add(a_idx)

        # 3. Compute match scores between each detection and each slot
        # Uses perspective-corrected ground-contact point as primary indicator.
        det_candidate_scores: Dict[int, List[Dict[str, Any]]] = {
            i: [] for i in range(len(standardized_dets))
        }

        for i, det in enumerate(standardized_dets):
            if i in suppressed_indices:
                continue
            bbox = det["bounding_box"]
            # Perspective-corrected ground-contact point (offset_ratio=0.08 confirmed on test image)
            gc_x, gc_y = calculate_ground_contact_point(bbox, self.config.ground_contact_offset_ratio)

            for s_id in camera_slot_ids:
                poly = slot_polygons_px[s_id]

                # Check ground-contact containment (perspective-corrected)
                contained = is_point_in_polygon(gc_x, gc_y, poly)

                # Compute exact polygon intersection & IoU
                inter_area, iou, overlap_ratio = compute_polygon_intersection_and_iou(poly, bbox)

                # Determine score and method
                score = 0.0
                method = "none"

                if contained:
                    # Ground-contact containment is primary — but only award the full
                    # point_containment_bonus when physical overlap clears the gate threshold.
                    # This prevents a sub-pixel boundary edge-crossing from misassigning a vehicle
                    # that physically resides overwhelmingly inside a neighbouring slot
                    # (e.g. overlap=7% here vs overlap=88% in adjacent slot → gate fails → fall through
                    # to secondary roi_overlap path and lose the undeserved bonus).
                    if overlap_ratio >= self.config.containment_min_overlap_gate:
                        overlap_contrib = self.config.overlap_weight * max(iou, overlap_ratio)
                        score = self.config.point_containment_bonus + overlap_contrib
                        method = "bottom_center_containment" if overlap_ratio < self.config.hybrid_overlap_threshold else "hybrid"
                    elif overlap_ratio >= self.config.min_overlap_ratio or iou >= self.config.min_iou:
                        # Overlap gate failed: treat the same as a secondary overlap match
                        # (the vehicle is physically across the boundary — no containment bonus).
                        score = self.config.overlap_weight * max(iou, overlap_ratio)
                        method = "roi_overlap"
                elif overlap_ratio >= self.config.min_overlap_ratio or iou >= self.config.min_iou:
                    # Secondary indicator: ROI overlap
                    score = self.config.overlap_weight * max(iou, overlap_ratio)
                    method = "roi_overlap"

                # Cap score at 1.0
                score = min(1.0, score)

                if score >= self.config.min_match_score:
                    det_candidate_scores[i].append({
                        "slot_id": s_id,
                        "score": score,
                        "method": method,
                        "contained": contained,
                        "iou": iou,
                        "overlap_ratio": overlap_ratio,
                    })

        # 4. Disambiguation and Assignment Logic
        # Sort each detection's candidates by descending score
        for i in det_candidate_scores:
            det_candidate_scores[i].sort(key=lambda c: c["score"], reverse=True)

        # Track slot to vehicle pairings: slot_id -> list of (det_idx, match_dict)
        slot_assignments: Dict[str, List[Tuple[int, Dict[str, Any]]]] = {
            s_id: [] for s_id in camera_slot_ids
        }
        unmapped_vehicles: List[MappedVehicle] = []

        for i, det in enumerate(standardized_dets):
            bbox = det["bounding_box"]
            gc_x, gc_y = calculate_ground_contact_point(bbox, self.config.ground_contact_offset_ratio)
            candidates = det_candidate_scores[i]

            if i in suppressed_indices:
                # Duplicate suppressed — record as unmapped with reason
                unmapped_vehicles.append(MappedVehicle(
                    slot_id=None,
                    floor=camera_floor,
                    camera_id=camera_id,
                    vehicle_class=det["class_name"],
                    confidence=det["confidence"],
                    bounding_box=bbox,
                    bottom_center=(gc_x, gc_y),
                    mapping_method="unmapped",
                    overlap_score=0.0,
                    occupancy_candidate="unmapped",
                    timestamp=det["timestamp"],
                    is_conflict=False,
                    conflict_reason="Suppressed as duplicate detection (high IoU with higher-confidence detection).",
                    track_id=det.get("track_id"),
                ))
                continue

            if not candidates:
                # No slot reached minimum score -> Unmapped
                unmapped_vehicles.append(MappedVehicle(
                    slot_id=None,
                    floor=camera_floor,
                    camera_id=camera_id,
                    vehicle_class=det["class_name"],
                    confidence=det["confidence"],
                    bounding_box=bbox,
                    bottom_center=(gc_x, gc_y),
                    mapping_method="unmapped",
                    overlap_score=0.0,
                    occupancy_candidate="unmapped",
                    timestamp=det["timestamp"],
                    is_conflict=False,
                    track_id=det.get("track_id"),
                ))
            else:
                top_match = candidates[0]

                # Check for boundary ambiguity between top 2 slots
                if len(candidates) > 1:
                    score_diff = top_match["score"] - candidates[1]["score"]
                    # (boundary_ambiguity is tracked per-detection at conflict resolution)

                slot_assignments[top_match["slot_id"]].append((i, top_match))

        # 5. Process Conflicts and Generate Slot Occupancy Candidates
        slot_candidates: Dict[str, SlotOccupancyCandidate] = {}
        mapped_vehicles: List[MappedVehicle] = []

        for s_id in camera_slot_ids:
            claimants = slot_assignments[s_id]

            if len(claimants) == 0:
                # No vehicle mapped to this slot -> Available candidate
                slot_candidates[s_id] = SlotOccupancyCandidate(
                    slot_id=s_id,
                    floor=camera_floor,
                    camera_id=camera_id,
                    candidate_status="available_candidate",
                    mapped_vehicle=None,
                    confidence=1.0,
                    timestamp=timestamp,
                    notes="No vehicle detected within slot ROI in current frame.",
                )

            elif len(claimants) == 1:
                # Single vehicle cleanly mapped -> Occupied (or uncertain if boundary ambiguous)
                det_idx, match_info = claimants[0]
                det = standardized_dets[det_idx]
                gc_x, gc_y = calculate_ground_contact_point(det["bounding_box"], self.config.ground_contact_offset_ratio)

                # Check if this detection had ambiguous boundary match with another slot
                all_cands = det_candidate_scores[det_idx]
                is_ambiguous = False
                ambiguity_note = ""
                if len(all_cands) > 1 and (all_cands[0]["score"] - all_cands[1]["score"] < self.config.boundary_ambiguity_threshold):
                    is_ambiguous = True
                    ambiguity_note = (
                        f"Boundary match with {all_cands[1]['slot_id']} "
                        f"(score diff: {all_cands[0]['score'] - all_cands[1]['score']:.3f})"
                    )

                mapped_v = MappedVehicle(
                    slot_id=s_id,
                    floor=camera_floor,
                    camera_id=camera_id,
                    vehicle_class=det["class_name"],
                    confidence=det["confidence"],
                    bounding_box=det["bounding_box"],
                    bottom_center=(gc_x, gc_y),
                    mapping_method=match_info["method"],
                    overlap_score=match_info["score"],
                    occupancy_candidate="uncertain" if is_ambiguous else "occupied",
                    timestamp=det["timestamp"],
                    is_conflict=is_ambiguous,
                    conflict_reason=ambiguity_note if is_ambiguous else None,
                    track_id=det.get("track_id"),
                )
                mapped_vehicles.append(mapped_v)

                candidate_status = "uncertain" if is_ambiguous else "occupied"
                slot_candidates[s_id] = SlotOccupancyCandidate(
                    slot_id=s_id,
                    floor=camera_floor,
                    camera_id=camera_id,
                    candidate_status=candidate_status,
                    mapped_vehicle=mapped_v.to_dict(),
                    confidence=round(match_info["score"], 4),
                    timestamp=det["timestamp"],
                    notes=f"Vehicle '{det['class_name']}' mapped via {match_info['method']}. {ambiguity_note}".strip(),
                    conflict_details=ambiguity_note if is_ambiguous else None,
                )

            else:
                # Multi-Vehicle Conflict: Multiple vehicles mapped to same slot -> Uncertain
                competing_indices = [c[0] for c in claimants]

                # Evaluate physical overlap between competing vehicle detections
                max_competing_iou = 0.0
                for a_idx in range(len(claimants)):
                    for b_idx in range(a_idx + 1, len(claimants)):
                        idx_a = claimants[a_idx][0]
                        idx_b = claimants[b_idx][0]
                        p_iou = compute_bbox_iou(
                            standardized_dets[idx_a]["bounding_box"],
                            standardized_dets[idx_b]["bounding_box"],
                        )
                        if p_iou > max_competing_iou:
                            max_competing_iou = p_iou

                is_physical_overlap = max_competing_iou >= self.config.conflict_iou_threshold

                if is_physical_overlap:
                    conflict_msg = (
                        f"Physical overlap conflict: {len(claimants)} vehicles ({competing_indices}) "
                        f"physically overlap with IoU={max_competing_iou:.2f} >= {self.config.conflict_iou_threshold:.2f} "
                        f"in slot {s_id}."
                    )
                else:
                    conflict_msg = (
                        f"Capacity conflict: {len(claimants)} distinct vehicles ({competing_indices}) "
                        f"simultaneously claiming slot {s_id} "
                        f"(inter-vehicle IoU={max_competing_iou:.2f} < {self.config.conflict_iou_threshold:.2f})."
                    )

                for det_idx, match_info in claimants:
                    det = standardized_dets[det_idx]
                    gc_x, gc_y = calculate_ground_contact_point(det["bounding_box"], self.config.ground_contact_offset_ratio)
                    mapped_v = MappedVehicle(
                        slot_id=s_id,
                        floor=camera_floor,
                        camera_id=camera_id,
                        vehicle_class=det["class_name"],
                        confidence=det["confidence"],
                        bounding_box=det["bounding_box"],
                        bottom_center=(gc_x, gc_y),
                        mapping_method=match_info["method"],
                        overlap_score=match_info["score"],
                        occupancy_candidate="uncertain",
                        timestamp=det["timestamp"],
                        is_conflict=True,
                        conflict_reason=conflict_msg,
                        track_id=det.get("track_id"),
                    )
                    mapped_vehicles.append(mapped_v)

                conflicting_v_dicts = [
                    mapped_v.to_dict() for mapped_v in mapped_vehicles[-len(claimants):]
                ]
                slot_candidates[s_id] = SlotOccupancyCandidate(
                    slot_id=s_id,
                    floor=camera_floor,
                    camera_id=camera_id,
                    candidate_status="uncertain",
                    mapped_vehicle=conflicting_v_dicts[0] if conflicting_v_dicts else None,
                    confidence=0.5,
                    timestamp=timestamp,
                    notes=conflict_msg,
                    conflict_details=conflict_msg,
                )

        # 6. Obstruction-aware uncertain classification
        # For each unmapped vehicle, check if its bbox significantly overlaps any
        # available_candidate slot. If so, mark that slot uncertain (possible obstruction).
        for unmapped_v in unmapped_vehicles:
            if unmapped_v.conflict_reason and "duplicate" in unmapped_v.conflict_reason.lower():
                continue  # Skip suppressed duplicates — they don't indicate obstruction
            u_bbox = unmapped_v.bounding_box
            for s_id in camera_slot_ids:
                if s_id not in slot_candidates:
                    continue
                if slot_candidates[s_id].candidate_status != "available_candidate":
                    continue
                poly = slot_polygons_px[s_id]
                _, _, overlap_ratio = compute_polygon_intersection_and_iou(poly, u_bbox)
                if overlap_ratio >= self.config.obstruction_overlap_threshold:
                    slot_candidates[s_id] = SlotOccupancyCandidate(
                        slot_id=s_id,
                        floor=camera_floor,
                        camera_id=camera_id,
                        candidate_status="uncertain",
                        mapped_vehicle=None,
                        confidence=0.4,
                        timestamp=timestamp,
                        notes=(
                            f"Unmapped vehicle ({unmapped_v.vehicle_class} "
                            f"conf={unmapped_v.confidence:.2f}) overlaps slot ROI "
                            f"by {overlap_ratio:.1%}. Possible obstruction."
                        ),
                        conflict_details="Obstruction by nearby unmapped vehicle.",
                    )

        # 7. Aggregate Counts
        occupied_count = sum(1 for c in slot_candidates.values() if c.candidate_status == "occupied")
        avail_count = sum(1 for c in slot_candidates.values() if c.candidate_status == "available_candidate")
        uncertain_count = sum(1 for c in slot_candidates.values() if c.candidate_status == "uncertain")

        return FrameMappingResult(
            camera_id=camera_id,
            floor=camera_floor,
            timestamp=timestamp,
            total_slots_monitored=len(camera_slot_ids),
            occupied_count=occupied_count,
            available_candidate_count=avail_count,
            uncertain_count=uncertain_count,
            unmapped_vehicles_count=len(unmapped_vehicles),
            slot_candidates=slot_candidates,
            mapped_vehicles=mapped_vehicles,
            unmapped_vehicles=unmapped_vehicles,
        )
