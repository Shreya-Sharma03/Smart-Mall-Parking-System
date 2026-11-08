"""
Detection & ROI Visualizer Utilities

Annotates OpenCV frames with clean, professional bounding boxes,
vehicle classification labels, confidence percentage banners,
and parking slot ROI polygon boundaries.
"""

from typing import List, Tuple, Any, Optional, Dict
try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None
    np = None

from detection.detector import DetectionResult
from config.settings import CLASS_COLORS
from utils.roi_utils import draw_roi_polygons, get_camera_slots, normalized_to_pixel

# Status colors in BGR format for OpenCV
STATUS_COLORS: Dict[str, Tuple[int, int, int]] = {
    "occupied": (45, 45, 220),             # Vivid Red / Crimson
    "available": (60, 200, 60),             # Vibrant Emerald Green
    "available_candidate": (60, 200, 60),   # Vibrant Emerald Green
    "uncertain": (0, 200, 255),             # Warm Amber / Yellow
    "unmapped": (148, 163, 184),            # Slate Gray
    "not_monitored": (100, 100, 100),       # Dark Gray
    "reserved": (180, 50, 180),             # Purple / Magenta
    "maintenance": (200, 140, 40),          # Steel Blue
}


def draw_detections(
    frame: Any,
    detections: List[DetectionResult],
    show_confidence: bool = True,
    line_thickness: int = 2,
    font_scale: float = 0.55,
) -> Any:
    """
    Renders high-visibility bounding boxes and labels onto an OpenCV BGR frame.

    :param frame: Target BGR image (NumPy ndarray)
    :param detections: List of DetectionResult objects
    :param show_confidence: Whether to append confidence percentage to the label
    :param line_thickness: Border width of the bounding box
    :param font_scale: Text font scale
    :returns: Annotated frame copy
    """
    if frame is None or cv2 is None:
        return frame

    annotated = frame.copy()

    for det in detections:
        x1, y1, x2, y2 = det.bounding_box
        color = CLASS_COLORS.get(det.class_name, CLASS_COLORS["default"])

        # Draw main bounding box
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, line_thickness, lineType=cv2.LINE_AA)

        # Build label text
        display_name = det.class_name.capitalize()
        if show_confidence:
            conf_pct = det.confidence * 100.0
            label = f"{display_name} {conf_pct:.1f}%"
        else:
            label = display_name

        # Calculate text dimensions for background pill
        (text_width, text_height), baseline = cv2.getTextSize(
            label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1
        )

        # Position label above bounding box if space permits, else inside
        if y1 - text_height - 6 >= 0:
            label_y1 = y1 - text_height - 8
            label_y2 = y1
            text_baseline_y = y1 - 4
        else:
            label_y1 = y1
            label_y2 = y1 + text_height + 8
            text_baseline_y = y1 + text_height + 4

        label_x1 = x1
        label_x2 = x1 + text_width + 8

        # Draw solid label background rectangle
        cv2.rectangle(
            annotated,
            (label_x1, label_y1),
            (label_x2, label_y2),
            color,
            -1,
            lineType=cv2.LINE_AA,
        )

        # Draw text in high-contrast black
        cv2.putText(
            annotated,
            label,
            (label_x1 + 4, text_baseline_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            font_scale,
            (10, 10, 10),
            thickness=1,
            lineType=cv2.LINE_AA,
        )

    # Add HUD summary header in top-left
    hud_bg = (15, 23, 42)
    cv2.rectangle(annotated, (10, 10), (320, 50), hud_bg, -1)
    cv2.rectangle(annotated, (10, 10), (320, 50), (51, 65, 85), 1)

    cars = sum(1 for d in detections if d.class_name == "car")
    motorcycles = sum(1 for d in detections if d.class_name == "motorcycle")
    summary_text = f"Vehicles: {len(detections)} (Cars: {cars}, Bikes: {motorcycles})"

    cv2.putText(
        annotated,
        summary_text,
        (20, 35),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        (248, 250, 252),
        1,
        lineType=cv2.LINE_AA,
    )

    return annotated


def draw_detections_and_rois(
    frame: Any,
    detections: List[DetectionResult],
    slots_config: Dict[str, Any],
    camera_id: Optional[str] = "CAM-B1-01",
    show_confidence: bool = True,
) -> Any:
    """
    Combines Phase 1 YOLOv8 vehicle detections with Phase 2 parking slot ROI polygons.
    Visualizes slot boundaries, slot IDs, vehicle bounding boxes, and confidence scores.

    Note: Does NOT compute vehicle-to-slot associations (that belongs to Phase 3).

    :param frame: Target OpenCV BGR image
    :param detections: List of DetectionResult objects from YOLOv8
    :param slots_config: Loaded slots configuration
    :param camera_id: Filter slots for a specific camera
    :param show_confidence: Whether to display detection confidence
    :returns: Combined annotated frame
    """
    if frame is None or cv2 is None:
        return frame

    # 1. First render parking slot ROI polygons and IDs
    with_rois = draw_roi_polygons(
        frame,
        slots_config,
        camera_id=camera_id,
        draw_fill=True,
        fill_alpha=0.15,
    )

    # 2. Render YOLOv8 vehicle bounding boxes on top
    annotated = draw_detections(
        with_rois,
        detections,
        show_confidence=show_confidence,
    )

    # 3. Add combined metadata banner in top-right
    height, width = frame.shape[:2]
    slots = get_camera_slots(slots_config, camera_id) if camera_id else []

    banner_w = 300
    banner_h = 40
    bx1 = width - banner_w - 15
    by1 = 10
    bx2 = width - 15
    by2 = by1 + banner_h

    cv2.rectangle(annotated, (bx1, by1), (bx2, by2), (15, 23, 42), -1)
    cv2.rectangle(annotated, (bx1, by1), (bx2, by2), (59, 130, 246), 1)

    info_str = f"Camera: {camera_id or 'All'} | Monitored: {len(slots)} Bays"
    cv2.putText(
        annotated,
        info_str,
        (bx1 + 10, by1 + 25),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.48,
        (147, 197, 253),
        1,
        lineType=cv2.LINE_AA,
    )

    return annotated


def draw_mapping_results(
    frame: Any,
    mapping_result: Any,
    slots_config: Dict[str, Any],
    show_lines: bool = True,
    show_confidence: bool = True,
    fill_alpha: float = 0.20,
    frame_number: Optional[int] = None,
    stabilized_states: Optional[Dict[str, Any]] = None,
) -> Any:
    """
    Renders Phase 3/4/5 vehicle-to-slot mapping and stabilized occupancy on top of an OpenCV frame:
      - Slot ROI polygons color-coded by stabilized occupancy status
        (Green: available, Red: occupied, Amber: uncertain, Purple: reserved, Blue: maintenance)
      - Slot ID, stabilized status, and confirmation progress badges
      - Tracked vehicle bounding boxes with persistent track IDs, classes, and confidence
      - Ground-contact bottom-center target markers
      - Mapping indicator lines connecting vehicles to assigned slot centroids
      - Unmapped vehicle bounding boxes and badges
      - Top executive HUD summarizing camera ID, floor, frame number, tracks, and stabilized counts

    :param frame: Target OpenCV BGR image
    :param mapping_result: FrameMappingResult instance from SlotMapper
    :param slots_config: Loaded multi-camera slots configuration
    :param show_lines: Whether to draw connecting lines between vehicles and slots
    :param show_confidence: Whether to display detection confidence
    :param fill_alpha: Transparency factor for slot ROI polygon fills
    :param frame_number: Optional sequential video/stream frame index
    :param stabilized_states: Optional Dict of slot_id -> SlotTemporalState from OccupancyStabilizer
    :returns: Annotated OpenCV BGR image
    """
    if frame is None or cv2 is None or np is None:
        return frame

    annotated = frame.copy()
    overlay = frame.copy()
    height, width = frame.shape[:2]

    # 1. Resolve camera slot polygons and centroids
    camera_slots = get_camera_slots(slots_config, mapping_result.camera_id)
    slot_polys_px: Dict[str, Any] = {}
    slot_centroids: Dict[str, Tuple[float, float]] = {}

    for slot in camera_slots:
        s_id = slot.get("slotId")
        poly = slot.get("polygon", [])
        if not s_id or not poly:
            continue
        pts = normalized_to_pixel(poly, width, height)
        slot_polys_px[s_id] = pts

        # Centroid
        cx = float(np.mean(pts[:, 0]))
        cy = float(np.mean(pts[:, 1]))
        slot_centroids[s_id] = (cx, cy)

    # 2. Render Slot ROI Polygons with status colors
    for s_id, pts in slot_polys_px.items():
        candidate = mapping_result.slot_candidates.get(s_id)
        candidate_raw = candidate.candidate_status if candidate else "available_candidate"

        # Check stabilized state if available
        stab_state = stabilized_states.get(s_id) if stabilized_states else None
        if stab_state is not None:
            if isinstance(stab_state, dict):
                status = stab_state.get("confirmedStatus", candidate_raw)
                progress = stab_state.get("confirmationProgress", "")
            else:
                status = getattr(stab_state, "confirmed_status", candidate_raw)
                progress = getattr(stab_state, "confirmation_progress", "")
        else:
            status = candidate_raw
            progress = ""

        color = STATUS_COLORS.get(status, (200, 200, 200))

        # Fill on overlay
        cv2.fillPoly(overlay, [pts], color)

        # Stroke on main frame
        cv2.polylines(annotated, [pts], isClosed=True, color=color, thickness=2, lineType=cv2.LINE_AA)

        # Slot ID + status tag
        cx, cy = slot_centroids[s_id]
        status_abbr = {
            "occupied": "OCCUPIED",
            "available": "AVAIL",
            "available_candidate": "AVAIL",
            "uncertain": "UNCERTAIN",
            "not_monitored": "NO CAM",
            "reserved": "RESERVED",
            "maintenance": "MAINT",
        }.get(status, status.upper())

        if progress and ("confirming" in progress or "vacating" in progress):
            tag_text = f"{s_id} [{status_abbr} {progress}]"
        else:
            tag_text = f"{s_id} [{status_abbr}]"

        (tw, th), _ = cv2.getTextSize(tag_text, cv2.FONT_HERSHEY_SIMPLEX, 0.40, 1)
        tx = int(cx - tw / 2)
        ty = int(cy)

        # Dark background tag pill
        cv2.rectangle(
            annotated,
            (tx - 4, ty - th - 4),
            (tx + tw + 4, ty + 4),
            (15, 23, 42),
            -1,
            lineType=cv2.LINE_AA,
        )
        cv2.rectangle(
            annotated,
            (tx - 4, ty - th - 4),
            (tx + tw + 4, ty + 4),
            color,
            1,
            lineType=cv2.LINE_AA,
        )
        cv2.putText(
            annotated,
            tag_text,
            (tx, ty),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.40,
            (255, 255, 255),
            1,
            lineType=cv2.LINE_AA,
        )

    # Blend polygon fills
    cv2.addWeighted(overlay, fill_alpha, annotated, 1.0 - fill_alpha, 0, annotated)

    # 3. Render Mapped Vehicles and Mapping Lines
    for v in mapping_result.mapped_vehicles:
        x1, y1, x2, y2 = v.bounding_box
        v_color = STATUS_COLORS["uncertain"] if v.is_conflict else (0, 230, 64)

        # Bounding box
        cv2.rectangle(annotated, (x1, y1), (x2, y2), v_color, 2, lineType=cv2.LINE_AA)

        # Bottom-center contact point
        bc_x, bc_y = int(v.bottom_center[0]), int(v.bottom_center[1])
        cv2.circle(annotated, (bc_x, bc_y), 5, (255, 255, 255), -1, lineType=cv2.LINE_AA)
        cv2.circle(annotated, (bc_x, bc_y), 6, (0, 0, 0), 1, lineType=cv2.LINE_AA)

        # Vehicle label with persistent track ID if available
        track_str = f" #{v.track_id}" if getattr(v, "track_id", None) is not None else ""
        conf_str = f" {v.confidence * 100:.0f}%" if show_confidence else ""
        slot_target = f" -> {v.slot_id}" if v.slot_id else ""
        conflict_tag = " [CONFLICT]" if v.is_conflict else ""
        label = f"{v.vehicle_class.capitalize()}{track_str}{conf_str}{slot_target}{conflict_tag}"

        (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.48, 1)
        ly = max(y1 - 6, lh + 6)
        cv2.rectangle(
            annotated,
            (x1, ly - lh - 4),
            (x1 + lw + 8, ly + 2),
            v_color,
            -1,
            lineType=cv2.LINE_AA,
        )
        cv2.putText(
            annotated,
            label,
            (x1 + 4, ly - 2),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (10, 10, 10),
            1,
            lineType=cv2.LINE_AA,
        )

        # Mapping Line from vehicle bottom-center to slot centroid
        if show_lines and v.slot_id and v.slot_id in slot_centroids:
            sc_x, sc_y = slot_centroids[v.slot_id]
            line_color = (0, 215, 255) if v.is_conflict else (255, 200, 60)
            cv2.line(
                annotated,
                (bc_x, bc_y),
                (int(sc_x), int(sc_y)),
                line_color,
                2,
                lineType=cv2.LINE_AA,
            )
            cv2.circle(annotated, (int(sc_x), int(sc_y)), 4, line_color, -1, lineType=cv2.LINE_AA)

    # 4. Render Unmapped Vehicles
    for v in mapping_result.unmapped_vehicles:
        x1, y1, x2, y2 = v.bounding_box
        unmapped_color = STATUS_COLORS["unmapped"]

        cv2.rectangle(annotated, (x1, y1), (x2, y2), unmapped_color, 2, lineType=cv2.LINE_AA)
        bc_x, bc_y = int(v.bottom_center[0]), int(v.bottom_center[1])
        cv2.circle(annotated, (bc_x, bc_y), 4, unmapped_color, -1, lineType=cv2.LINE_AA)

        track_str = f" #{v.track_id}" if getattr(v, "track_id", None) is not None else ""
        label = f"{v.vehicle_class.capitalize()}{track_str} {v.confidence * 100:.0f}% [UNMAPPED]"
        (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        ly = max(y1 - 6, lh + 6)
        cv2.rectangle(
            annotated,
            (x1, ly - lh - 4),
            (x1 + lw + 8, ly + 2),
            (30, 41, 59),
            -1,
            lineType=cv2.LINE_AA,
        )
        cv2.rectangle(
            annotated,
            (x1, ly - lh - 4),
            (x1 + lw + 8, ly + 2),
            unmapped_color,
            1,
            lineType=cv2.LINE_AA,
        )
        cv2.putText(
            annotated,
            label,
            (x1 + 4, ly - 2),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (226, 232, 240),
            1,
            lineType=cv2.LINE_AA,
        )

    # 5. Top Executive HUD
    hud_h = 44
    cv2.rectangle(annotated, (12, 10), (width - 12, 10 + hud_h), (15, 23, 42), -1)
    cv2.rectangle(annotated, (12, 10), (width - 12, 10 + hud_h), (51, 65, 85), 1)

    frame_str = f" | Frame #{frame_number}" if frame_number is not None else ""
    left_hud = f"Camera: {mapping_result.camera_id} (Floor {mapping_result.floor}){frame_str} | Monitored: {mapping_result.total_slots_monitored} Bays"
    cv2.putText(
        annotated,
        left_hud,
        (24, 37),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.52,
        (241, 245, 249),
        1,
        lineType=cv2.LINE_AA,
    )

    # Calculate counts to show in HUD (stabilized if provided, else single-frame)
    if stabilized_states:
        monitored_states = [s for s in stabilized_states.values() if getattr(s, "is_monitored", True)]
        disp_occ = sum(1 for s in monitored_states if getattr(s, "confirmed_status", "") == "occupied")
        disp_avail = sum(1 for s in monitored_states if getattr(s, "confirmed_status", "") == "available")
        disp_unc = sum(1 for s in monitored_states if getattr(s, "confirmed_status", "") == "uncertain")
    else:
        disp_occ = mapping_result.occupied_count
        disp_avail = mapping_result.available_candidate_count
        disp_unc = mapping_result.uncertain_count

    # Right side badges with colored circular dots
    rx = width - 680
    badges = [
        (f"Occupied: {disp_occ}", STATUS_COLORS["occupied"]),
        (f"Available: {disp_avail}", STATUS_COLORS["available"]),
        (f"Uncertain: {disp_unc}", STATUS_COLORS["uncertain"]),
        (f"Unmapped: {mapping_result.unmapped_vehicles_count}", STATUS_COLORS["unmapped"]),
    ]
    unmonitored = getattr(mapping_result, "unmonitored_count", 0)
    if unmonitored > 0:
        badges.append((f"No Cam: {unmonitored}", STATUS_COLORS["not_monitored"]))

    for badge_text, badge_color in badges:
        cv2.circle(annotated, (rx, 32), 5, badge_color, -1, lineType=cv2.LINE_AA)
        cv2.putText(
            annotated,
            badge_text,
            (rx + 10, 37),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            (226, 232, 240),
            1,
            lineType=cv2.LINE_AA,
        )
        rx += 115

    return annotated
