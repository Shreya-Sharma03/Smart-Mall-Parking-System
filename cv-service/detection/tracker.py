"""
Vehicle Tracker: Temporal Multi-Vehicle Tracking Engine
Milestone 5 - Smart Mall Parking Management System

Tracks vehicles across consecutive video frames using:
1. Spatial bounding box IoU & Centroid Distance Association.
2. Persistent Unique Track IDs (incrementing integers).
3. Coasting state handling for temporary detection dropouts (occlusion/missed detection).
4. Duplicate-detection prevention.
5. Persistent Slot Association tracking.
"""

import math
from dataclasses import dataclass, field
from typing import List, Dict, Any, Tuple, Optional, Set

try:
    import numpy as np
except ImportError:
    np = None

from detection.detector import DetectionResult
from detection.slot_mapper import compute_bbox_iou


@dataclass
class TrackerConfig:
    """
    Configuration parameters for multi-vehicle temporal tracking.
    """
    min_iou_match: float = 0.25         # Minimum IoU to associate detection with existing track
    max_centroid_dist: float = 120.0    # Fallback maximum centroid pixel distance for association
    max_missed_frames: int = 5          # Number of frames to maintain track without detection before deletion
    min_hits_to_confirm: int = 1        # Consecutive detections required to confirm track
    duplicate_iou_threshold: float = 0.65  # IoU threshold to suppress duplicate detections of same vehicle


@dataclass
class TrackedVehicle:
    """
    Represents a persistently tracked vehicle across video frames.
    """
    track_id: int
    class_name: str
    confidence: float
    bounding_box: Tuple[int, int, int, int]  # (x1, y1, x2, y2)
    first_seen_timestamp: float
    last_seen_timestamp: float
    age_frames: int = 1                      # Total frames since initialization
    hits: int = 1                            # Number of times successfully detected and matched
    missed_frames: int = 0                   # Consecutive frames without detection
    is_active: bool = True                   # True if detected in latest frame, False if coasting
    associated_slot_id: Optional[str] = None # Currently associated parking slot ID (if mapped)
    history: List[Tuple[int, int, int, int]] = field(default_factory=list)

    @property
    def centroid(self) -> Tuple[float, float]:
        x1, y1, x2, y2 = self.bounding_box
        return (x1 + x2) / 2.0, (y1 + y2) / 2.0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to serializable dictionary."""
        return {
            "trackId": self.track_id,
            "className": self.class_name,
            "confidence": round(float(self.confidence), 4),
            "boundingBox": [int(v) for v in self.bounding_box],
            "ageFrames": int(self.age_frames),
            "hits": int(self.hits),
            "missedFrames": int(self.missed_frames),
            "isActive": bool(self.is_active),
            "associatedSlotId": self.associated_slot_id,
            "centroid": [round(float(c), 1) for c in self.centroid],
        }


def compute_centroid_distance(
    box1: Tuple[int, int, int, int],
    box2: Tuple[int, int, int, int],
) -> float:
    """Computes Euclidean distance between the centers of two bounding boxes."""
    c1_x = (box1[0] + box1[2]) / 2.0
    c1_y = (box1[1] + box1[3]) / 2.0
    c2_x = (box2[0] + box2[2]) / 2.0
    c2_y = (box2[1] + box2[3]) / 2.0
    return math.hypot(c1_x - c2_x, c1_y - c2_y)


class VehicleTracker:
    """
    Lightweight, deterministic multi-vehicle temporal tracker.
    Maintains persistent IDs across consecutive frames and handles
    temporary detection drops without external dependencies.
    """

    def __init__(self, config: Optional[TrackerConfig] = None):
        self.config = config or TrackerConfig()
        self.tracks: List[TrackedVehicle] = []
        self._next_id: int = 1
        self.frame_count: int = 0

    def reset(self) -> None:
        """Clears all tracking history and resets ID counter."""
        self.tracks = []
        self._next_id = 1
        self.frame_count = 0

    def update(
        self,
        detections: List[Any],
        timestamp: float = 0.0,
    ) -> List[TrackedVehicle]:
        """
        Updates tracks with detections from the current frame.

        :param detections: List of DetectionResult objects or dicts
        :param timestamp: Frame timestamp in seconds
        :returns: List of currently confirmed/active TrackedVehicle instances
        """
        self.frame_count += 1

        # 1. Standardize input detections
        std_dets: List[Dict[str, Any]] = []
        for det in detections:
            if isinstance(det, DetectionResult):
                std_dets.append({
                    "class_name": det.class_name,
                    "confidence": float(det.confidence),
                    "bounding_box": tuple(int(c) for c in det.bounding_box),
                    "class_id": det.class_id,
                })
            elif isinstance(det, dict):
                bbox = det.get("bounding_box", det.get("boundingBox", (0, 0, 0, 0)))
                std_dets.append({
                    "class_name": det.get("class_name", det.get("vehicleClass", "car")),
                    "confidence": float(det.get("confidence", 1.0)),
                    "bounding_box": tuple(int(c) for c in bbox),
                    "class_id": det.get("class_id", 2),
                })

        # 2. Duplicate suppression among incoming detections
        suppressed_det_indices: Set[int] = set()
        for i in range(len(std_dets)):
            if i in suppressed_det_indices:
                continue
            for j in range(i + 1, len(std_dets)):
                if j in suppressed_det_indices:
                    continue
                pair_iou = compute_bbox_iou(
                    std_dets[i]["bounding_box"],
                    std_dets[j]["bounding_box"],
                )
                if pair_iou >= self.config.duplicate_iou_threshold:
                    if std_dets[i]["confidence"] >= std_dets[j]["confidence"]:
                        suppressed_det_indices.add(j)
                    else:
                        suppressed_det_indices.add(i)

        valid_dets = [d for idx, d in enumerate(std_dets) if idx not in suppressed_det_indices]

        # 3. Associate detections with existing tracks using IoU + Centroid distance
        # Score matrix: higher is better
        # Prefer IoU; if IoU == 0 and distance < max_centroid_dist, use normalized proximity
        matched_track_indices: Set[int] = set()
        matched_det_indices: Set[int] = set()
        matches: List[Tuple[int, int]] = []  # (track_idx, det_idx)

        if len(self.tracks) > 0 and len(valid_dets) > 0:
            cost_matrix = []
            for t_idx, track in enumerate(self.tracks):
                row = []
                for d_idx, det in enumerate(valid_dets):
                    iou = compute_bbox_iou(track.bounding_box, det["bounding_box"])
                    dist = compute_centroid_distance(track.bounding_box, det["bounding_box"])

                    # Primary metric: IoU
                    score = iou
                    # Fallback proximity metric if IoU is zero but centroids are very close
                    if score < self.config.min_iou_match and dist <= self.config.max_centroid_dist:
                        prox_score = max(0.0, 1.0 - (dist / self.config.max_centroid_dist)) * 0.49
                        score = max(score, prox_score)

                    row.append(score)
                cost_matrix.append(row)

            # Greedy bipartite matching from highest score down
            # Builds pairs while score >= min_iou_match or proximity threshold
            pair_candidates = []
            for t_idx in range(len(self.tracks)):
                for d_idx in range(len(valid_dets)):
                    score = cost_matrix[t_idx][d_idx]
                    if score >= self.config.min_iou_match or (score > 0.20 and cost_matrix[t_idx][d_idx] >= 0.20):
                        pair_candidates.append((score, t_idx, d_idx))

            pair_candidates.sort(key=lambda x: x[0], reverse=True)

            for score, t_idx, d_idx in pair_candidates:
                if t_idx not in matched_track_indices and d_idx not in matched_det_indices:
                    matched_track_indices.add(t_idx)
                    matched_det_indices.add(d_idx)
                    matches.append((t_idx, d_idx))

        # 4. Update matched tracks
        for t_idx, d_idx in matches:
            track = self.tracks[t_idx]
            det = valid_dets[d_idx]

            track.bounding_box = det["bounding_box"]
            track.confidence = det["confidence"]
            track.class_name = det["class_name"]
            track.last_seen_timestamp = timestamp
            track.age_frames += 1
            track.hits += 1
            track.missed_frames = 0
            track.is_active = True
            track.history.append(det["bounding_box"])
            if len(track.history) > 30:
                track.history.pop(0)

        # 5. Handle unmatched tracks (missed detection / coasting)
        for t_idx, track in enumerate(self.tracks):
            if t_idx not in matched_track_indices:
                track.age_frames += 1
                track.missed_frames += 1
                track.is_active = False

        # 6. Create new tracks for unmatched detections
        for d_idx, det in enumerate(valid_dets):
            if d_idx not in matched_det_indices:
                new_track = TrackedVehicle(
                    track_id=self._next_id,
                    class_name=det["class_name"],
                    confidence=det["confidence"],
                    bounding_box=det["bounding_box"],
                    first_seen_timestamp=timestamp,
                    last_seen_timestamp=timestamp,
                    age_frames=1,
                    hits=1,
                    missed_frames=0,
                    is_active=True,
                    history=[det["bounding_box"]],
                )
                self._next_id += 1
                self.tracks.append(new_track)

        # 7. Prune dead tracks that exceeded max_missed_frames
        self.tracks = [
            t for t in self.tracks if t.missed_frames <= self.config.max_missed_frames
        ]

        # 8. Return currently active and coasting tracks that satisfy min_hits
        confirmed_tracks = [
            t for t in self.tracks if t.hits >= self.config.min_hits_to_confirm
        ]
        return confirmed_tracks

    def associate_slot(self, track_id: int, slot_id: Optional[str]) -> None:
        """Associates a tracked vehicle with its confirmed parking slot."""
        for t in self.tracks:
            if t.track_id == track_id:
                t.associated_slot_id = slot_id
                break
