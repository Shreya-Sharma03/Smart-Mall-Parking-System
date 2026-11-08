"""
Parking Slot Region of Interest (ROI) Utilities

Handles loading, validating, converting, and rendering polygon-based
parking slot boundaries across multi-camera configurations.
"""

import os
import json
from typing import List, Dict, Any, Tuple, Optional

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None
    np = None

from topology import ALL_SLOT_IDS, FLOORS

DEFAULT_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "config",
    "slots_config.json"
)


def load_slots_config(config_path: str = DEFAULT_CONFIG_PATH) -> Dict[str, Any]:
    """
    Loads and parses the multi-camera slots ROI configuration JSON.

    :param config_path: Absolute or relative path to slots_config.json
    :returns: Parsed configuration dictionary
    """
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"[ROI] Configuration file not found: {config_path}")

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
    except json.JSONDecodeError as e:
        raise ValueError(f"[ROI] Failed to parse JSON configuration: {e}")

    is_valid, errors = validate_slots_config(config)
    if not is_valid:
        raise ValueError(f"[ROI] Invalid slots configuration:\n" + "\n".join(f" - {err}" for err in errors))

    return config


def save_slots_config(config: Dict[str, Any], config_path: str = DEFAULT_CONFIG_PATH) -> None:
    """
    Validates and writes the slots configuration to disk.

    :param config: Configuration dictionary to save
    :param config_path: Destination path
    """
    is_valid, errors = validate_slots_config(config)
    if not is_valid:
        raise ValueError(f"[ROI] Cannot save invalid configuration:\n" + "\n".join(f" - {err}" for err in errors))

    os.makedirs(os.path.dirname(os.path.abspath(config_path)), exist_ok=True)
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

    print(f"[ROI] Successfully saved configuration to: {config_path}")


def validate_slots_config(config: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Validates the configuration structure against canonical topology rules:
    - Verifies presence of cameras array
    - Verifies slotId exists in canonical topology (rejects unknown slot IDs)
    - Verifies slot floor matches camera floor
    - Verifies normalized coordinate boundaries [0.0, 1.0]
    - Verifies minimum 3 vertices per polygon
    - Verifies no slot is assigned to conflicting cameras

    :param config: Dictionary to validate
    :returns: Tuple (is_valid: bool, errors: List[str])
    """
    errors: List[str] = []

    if not isinstance(config, dict):
        return False, ["Root configuration must be a JSON object"]

    cameras = config.get("cameras")
    if not isinstance(cameras, list) or len(cameras) == 0:
        return False, ["Configuration must contain a non-empty 'cameras' list"]

    assigned_slots: Dict[str, str] = {}  # slotId -> cameraId

    for cam_idx, cam in enumerate(cameras):
        cam_id = cam.get("cameraId")
        if not cam_id or not isinstance(cam_id, str):
            errors.append(f"Camera at index {cam_idx} missing valid 'cameraId'")
            continue

        floor = cam.get("floor")
        if floor not in FLOORS:
            errors.append(f"Camera '{cam_id}' has invalid floor '{floor}'. Must be one of {FLOORS}")

        slots = cam.get("slots")
        if not isinstance(slots, list):
            errors.append(f"Camera '{cam_id}' missing 'slots' array")
            continue

        for slot_idx, slot in enumerate(slots):
            slot_id = slot.get("slotId")
            if not slot_id or not isinstance(slot_id, str):
                errors.append(f"Camera '{cam_id}' slot #{slot_idx} missing valid 'slotId'")
                continue

            # Validate against canonical topology
            if slot_id not in ALL_SLOT_IDS:
                errors.append(f"Camera '{cam_id}': Invalid slot ID '{slot_id}' not found in canonical topology")

            # Validate floor consistency
            if not slot_id.startswith(f"{floor}-"):
                errors.append(f"Camera '{cam_id}' (Floor {floor}) cannot manage slot '{slot_id}' (floor prefix mismatch)")

            # Check duplicate camera assignment
            if slot_id in assigned_slots:
                prev_cam = assigned_slots[slot_id]
                errors.append(f"Slot '{slot_id}' is assigned to multiple cameras ('{prev_cam}' and '{cam_id}')")
            else:
                assigned_slots[slot_id] = cam_id

            # Validate polygon coordinates
            polygon = slot.get("polygon")
            if not isinstance(polygon, list) or len(polygon) < 3:
                errors.append(f"Slot '{slot_id}' must have a polygon with at least 3 vertices (found {len(polygon) if isinstance(polygon, list) else 0})")
            else:
                for pt_idx, pt in enumerate(polygon):
                    if not isinstance(pt, (list, tuple)) or len(pt) != 2:
                        errors.append(f"Slot '{slot_id}' vertex #{pt_idx} must be a [x, y] pair")
                    else:
                        x, y = pt
                        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
                            errors.append(f"Slot '{slot_id}' vertex #{pt_idx} [{x}, {y}] outside normalized range [0.0, 1.0]")

    return len(errors) == 0, errors


def normalized_to_pixel(
    polygon: List[List[float]],
    width: int,
    height: int,
) -> Any:
    """
    Converts normalized polygon coordinates [[nx, ny], ...] to pixel coordinates [[px, py], ...].

    :param polygon: List of normalized coordinate pairs
    :param width: Image pixel width
    :param height: Image pixel height
    :returns: NumPy array if NumPy is available, otherwise list of coordinate pairs
    """
    pixel_coords = []
    for pt in polygon:
        x = int(round(pt[0] * width))
        y = int(round(pt[1] * height))
        # Clamp to image bounds
        x = max(0, min(width - 1, x))
        y = max(0, min(height - 1, y))
        pixel_coords.append([x, y])

    if np is not None:
        return np.array(pixel_coords, dtype=np.int32)
    return pixel_coords


def pixel_to_normalized(
    polygon: List[List[int]],
    width: int,
    height: int,
    precision: int = 4,
) -> List[List[float]]:
    """
    Converts pixel coordinates [[px, py], ...] to normalized floats [[nx, ny], ...].

    :param polygon: List of integer pixel coordinate pairs
    :param width: Image pixel width
    :param height: Image pixel height
    :param precision: Decimal places to round
    :returns: List of normalized coordinate pairs
    """
    if width <= 0 or height <= 0:
        raise ValueError(f"Invalid image dimensions: {width}x{height}")

    normalized = []
    for pt in polygon:
        nx = round(pt[0] / float(width), precision)
        ny = round(pt[1] / float(height), precision)
        nx = max(0.0, min(1.0, nx))
        ny = max(0.0, min(1.0, ny))
        normalized.append([nx, ny])

    return normalized


def get_camera_slots(config: Dict[str, Any], camera_id: str) -> List[Dict[str, Any]]:
    """
    Retrieves the list of slot configurations for a specific camera.
    """
    for cam in config.get("cameras", []):
        if cam.get("cameraId") == camera_id:
            return cam.get("slots", [])
    return []


def get_slot_by_id(config: Dict[str, Any], slot_id: str) -> Optional[Dict[str, Any]]:
    """
    Finds a slot's ROI definition across all configured cameras.
    """
    for cam in config.get("cameras", []):
        for slot in cam.get("slots", []):
            if slot.get("slotId") == slot_id:
                slot_copy = dict(slot)
                slot_copy["cameraId"] = cam.get("cameraId")
                slot_copy["floor"] = cam.get("floor")
                return slot_copy
    return None


def update_slot_polygon(
    config: Dict[str, Any],
    camera_id: str,
    slot_id: str,
    polygon: List[List[float]],
) -> bool:
    """
    Updates or inserts a polygon definition for a specific slot on a camera.
    """
    for cam in config.get("cameras", []):
        if cam.get("cameraId") == camera_id:
            for slot in cam.get("slots", []):
                if slot.get("slotId") == slot_id:
                    slot["polygon"] = polygon
                    return True
            # If not in list but belongs to camera floor, append
            if slot_id.startswith(f"{cam.get('floor')}-"):
                cam["slots"].append({"slotId": slot_id, "polygon": polygon})
                return True
    return False


def draw_roi_polygons(
    frame: Any,
    slots_config: Dict[str, Any],
    camera_id: Optional[str] = None,
    selected_slot_id: Optional[str] = None,
    draw_fill: bool = True,
    fill_alpha: float = 0.15,
) -> Any:
    """
    Renders parking slot ROI polygon boundaries and slot ID badges onto an OpenCV frame.

    :param frame: Target OpenCV BGR image (NumPy array)
    :param slots_config: Loaded slots configuration dictionary
    :param camera_id: Optional camera ID filter (e.g. "CAM-B1-01")
    :param selected_slot_id: Optional slot ID to highlight (e.g. during calibration)
    :param draw_fill: Whether to shade polygon interiors with a transparent tint
    :param fill_alpha: Transparency ratio for polygon fill
    :returns: Annotated frame copy
    """
    if frame is None or cv2 is None or np is None:
        return frame

    height, width = frame.shape[:2]
    annotated = frame.copy()
    overlay = frame.copy() if draw_fill else None

    # Collect slots to draw
    slots_to_draw = []
    for cam in slots_config.get("cameras", []):
        if camera_id is None or cam.get("cameraId") == camera_id:
            for s in cam.get("slots", []):
                slots_to_draw.append(s)

    for slot in slots_to_draw:
        slot_id = slot.get("slotId", "")
        polygon = slot.get("polygon", [])
        if len(polygon) < 3:
            continue

        pts = normalized_to_pixel(polygon, width, height)

        is_selected = (selected_slot_id == slot_id)

        # Style colors (BGR)
        if is_selected:
            edge_color = (0, 215, 255)   # Glowing Gold/Amber
            fill_color = (0, 215, 255)
            thickness = 3
        else:
            edge_color = (255, 144, 30)  # Dodger / Electric Blue
            fill_color = (255, 144, 30)
            thickness = 2

        # Draw semi-transparent fill
        if draw_fill and overlay is not None:
            cv2.fillPoly(overlay, [pts], fill_color)

        # Draw polygon boundary
        cv2.polylines(annotated, [pts], isClosed=True, color=edge_color, thickness=thickness, lineType=cv2.LINE_AA)

        # Draw vertices
        for pt in pts:
            cv2.circle(annotated, (pt[0], pt[1]), 3, (255, 255, 255), -1, lineType=cv2.LINE_AA)

        # Compute centroid for slot ID text placement
        moments = cv2.moments(pts)
        if moments["m00"] != 0:
            cx = int(moments["m10"] / moments["m00"])
            cy = int(moments["m01"] / moments["m00"])
        else:
            cx, cy = pts[0][0], pts[0][1]

        # Draw slot ID pill badge
        label = slot_id
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.45
        (tw, th), baseline = cv2.getTextSize(label, font, font_scale, 1)

        rx1 = cx - tw // 2 - 4
        ry1 = cy - th // 2 - 4
        rx2 = cx + tw // 2 + 4
        ry2 = cy + th // 2 + 4

        # Pill background
        cv2.rectangle(annotated, (rx1, ry1), (rx2, ry2), (15, 23, 42), -1, lineType=cv2.LINE_AA)
        cv2.rectangle(annotated, (rx1, ry1), (rx2, ry2), edge_color, 1, lineType=cv2.LINE_AA)

        # Text label
        cv2.putText(annotated, label, (rx1 + 4, ry2 - 4), font, font_scale, (255, 255, 255), 1, lineType=cv2.LINE_AA)

    if draw_fill and overlay is not None:
        cv2.addWeighted(overlay, fill_alpha, annotated, 1.0 - fill_alpha, 0, annotated)

    return annotated
