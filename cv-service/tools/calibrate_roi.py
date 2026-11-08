"""
Interactive ROI Calibration Tool for Smart Mall Parking

Allows developers and camera technicians to interactively calibrate
parking slot ROI polygons by clicking on parking lot reference images.
Coordinates are saved in normalized [0.0, 1.0] format to config/slots_config.json.
"""

import os
import sys
import argparse
import copy
from typing import List, Tuple, Optional, Any

# Ensure cv-service root is in sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None
    np = None

from topology import ALL_SLOT_IDS, FLOORS
from utils.roi_utils import (
    load_slots_config,
    save_slots_config,
    draw_roi_polygons,
    pixel_to_normalized,
    normalized_to_pixel,
    update_slot_polygon,
    DEFAULT_CONFIG_PATH,
)


class ROICalibrator:
    """
    Interactive OpenCV tool to calibrate polygon ROIs on camera images.
    """

    def __init__(
        self,
        image_path: str,
        camera_id: str = "CAM-B1-01",
        config_path: str = DEFAULT_CONFIG_PATH,
    ):
        self.image_path = image_path
        self.camera_id = camera_id
        self.config_path = config_path

        if cv2 is None or np is None:
            raise ImportError("OpenCV and NumPy are required for the calibration tool.")

        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Reference image not found: {image_path}")

        self.original_image = cv2.imread(image_path)
        if self.original_image is None:
            raise ValueError(f"Could not load image: {image_path}")

        self.height, self.width = self.original_image.shape[:2]

        # Load existing configuration
        if os.path.exists(config_path):
            self.config = load_slots_config(config_path)
        else:
            self.config = {"version": "1.0", "cameras": []}

        # Filter candidate slot IDs for this camera's floor
        self.floor = self._determine_camera_floor(camera_id)
        self.slot_ids = [s for s in ALL_SLOT_IDS if s.startswith(f"{self.floor}-")]
        self.current_slot_idx = 0

        # Interactive state
        self.current_points: List[List[int]] = []  # [[px, py], ...]
        self.status_message = "Click vertices to draw polygon. Press 'C' to complete."

    def _determine_camera_floor(self, camera_id: str) -> str:
        for cam in self.config.get("cameras", []):
            if cam.get("cameraId") == camera_id:
                return cam.get("floor", "B1")
        if "B2" in camera_id:
            return "B2"
        return "B1"

    @property
    def current_slot_id(self) -> str:
        return self.slot_ids[self.current_slot_idx]

    def _mouse_callback(self, event, x, y, flags, param):
        """Captures mouse clicks on the calibration window."""
        if event == cv2.EVENT_LBUTTONDOWN:
            self.current_points.append([x, y])
            self.status_message = f"Added vertex #{len(self.current_points)} at ({x}, {y})"
        elif event == cv2.EVENT_RBUTTONDOWN:
            if self.current_points:
                removed = self.current_points.pop()
                self.status_message = f"Undid vertex at ({removed[0]}, {removed[1]})"

    def complete_current_polygon(self) -> bool:
        """Saves current points as normalized polygon for current slot ID."""
        if len(self.current_points) < 3:
            self.status_message = "[Error] A polygon requires at least 3 vertices!"
            return False

        normalized_poly = pixel_to_normalized(self.current_points, self.width, self.height)
        updated = update_slot_polygon(
            self.config, self.camera_id, self.current_slot_id, normalized_poly
        )

        if updated:
            self.status_message = f"Saved ROI for {self.current_slot_id} ({len(self.current_points)} points). Press 'S' to write to disk."
            self.current_points = []
            # Advance to next slot automatically if available
            if self.current_slot_idx < len(self.slot_ids) - 1:
                self.current_slot_idx += 1
            return True
        else:
            self.status_message = f"[Error] Failed to update slot {self.current_slot_id}."
            return False

    def render_hud(self, canvas: Any) -> Any:
        """Renders on-screen instructions, current points, and slot selector."""
        # Draw existing saved polygons
        annotated = draw_roi_polygons(
            canvas,
            self.config,
            camera_id=self.camera_id,
            selected_slot_id=self.current_slot_id,
            draw_fill=True,
        )

        # Draw currently in-progress polygon
        if self.current_points:
            pts = np.array(self.current_points, dtype=np.int32)
            cv2.polylines(annotated, [pts], isClosed=False, color=(0, 255, 255), thickness=2, lineType=cv2.LINE_AA)
            for i, p in enumerate(self.current_points):
                cv2.circle(annotated, (p[0], p[1]), 5, (0, 0, 255), -1, lineType=cv2.LINE_AA)
                cv2.putText(annotated, str(i + 1), (p[0] + 6, p[1] - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)

        # Top HUD Banner
        hud_h = 100
        hud_bg = (15, 23, 42)
        cv2.rectangle(annotated, (0, 0), (self.width, hud_h), hud_bg, -1)
        cv2.line(annotated, (0, hud_h), (self.width, hud_h), (59, 130, 246), 2)

        # Title & Camera info
        cv2.putText(annotated, f"ROI CALIBRATION TOOL | Camera: {self.camera_id} (Floor {self.floor})", (15, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2)

        # Active Slot Selector
        slot_label = f"Target Slot: [{self.current_slot_id}] ({self.current_slot_idx + 1}/{len(self.slot_ids)})"
        cv2.putText(annotated, slot_label, (15, 52), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 215, 255), 2)

        # Controls instructions
        controls = "Controls: [L-Click] Add Point | [R-Click/U] Undo | [C/Space] Complete | [N/P] Next/Prev Slot | [S] Save | [Q] Quit"
        cv2.putText(annotated, controls, (15, 75), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (148, 163, 184), 1)

        # Status footer banner
        cv2.rectangle(annotated, (0, self.height - 35), (self.width, self.height), (20, 20, 20), -1)
        cv2.putText(annotated, f"Status: {self.status_message}", (15, self.height - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (100, 240, 100), 1)

        return annotated

    def run_interactive(self):
        """Launches the interactive OpenCV calibration window."""
        window_name = f"Smart Mall Parking - ROI Calibration ({self.camera_id})"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_name, min(1280, self.width), min(720, self.height))
        cv2.setMouseCallback(window_name, self._mouse_callback)

        print("==================================================")
        print("Smart Mall Parking - ROI Calibration Tool Launched")
        print("==================================================")
        print(f"Camera ID:   {self.camera_id}")
        print(f"Floor:       {self.floor}")
        print(f"Slots to calibrate: {', '.join(self.slot_ids)}")
        print("--------------------------------------------------")
        print("Keyboard Shortcuts:")
        print("  [L-Click]     Add polygon vertex")
        print("  [R-Click / U] Undo last point")
        print("  [C / Space]   Complete and register polygon for current slot")
        print("  [N]           Next parking slot")
        print("  [P]           Previous parking slot")
        print("  [S]           Save configuration to config/slots_config.json")
        print("  [Q / Esc]     Quit calibration")
        print("==================================================")

        try:
            while True:
                display_frame = self.render_hud(self.original_image)
                cv2.imshow(window_name, display_frame)

                key = cv2.waitKey(20) & 0xFF

                if key in (ord('q'), 27):  # 'q' or ESC
                    break
                elif key in (ord('c'), ord(' ')):  # 'c' or SPACE
                    self.complete_current_polygon()
                elif key == ord('u'):  # 'u' (undo)
                    if self.current_points:
                        self.current_points.pop()
                        self.status_message = "Undid last vertex."
                elif key == ord('n'):  # 'n' (next slot)
                    self.current_points = []
                    self.current_slot_idx = (self.current_slot_idx + 1) % len(self.slot_ids)
                    self.status_message = f"Selected slot {self.current_slot_id}"
                elif key == ord('p'):  # 'p' (previous slot)
                    self.current_points = []
                    self.current_slot_idx = (self.current_slot_idx - 1) % len(self.slot_ids)
                    self.status_message = f"Selected slot {self.current_slot_id}"
                elif key == ord('s'):  # 's' (save)
                    try:
                        save_slots_config(self.config, self.config_path)
                        self.status_message = f"[SUCCESS] Saved to {os.path.basename(self.config_path)}!"
                    except Exception as e:
                        self.status_message = f"[ERROR] Save failed: {e}"
        finally:
            cv2.destroyAllWindows()


def set_slot_manually(
    config_path: str,
    camera_id: str,
    slot_id: str,
    normalized_polygon: List[List[float]],
) -> bool:
    """
    Programmatic calibration function to assign polygon coordinates without a GUI window.
    """
    config = load_slots_config(config_path)
    updated = update_slot_polygon(config, camera_id, slot_id, normalized_polygon)
    if updated:
        save_slots_config(config, config_path)
        return True
    return False


def main():
    parser = argparse.ArgumentParser(description="Smart Mall Parking - Interactive ROI Calibration Utility")
    parser.add_argument("--image", type=str, required=True, help="Path to reference parking camera image")
    parser.add_argument("--camera-id", type=str, default="CAM-B1-01", help="Camera ID to calibrate (e.g. CAM-B1-01, CAM-B2-01)")
    parser.add_argument("--config", type=str, default=DEFAULT_CONFIG_PATH, help=f"Path to slots_config.json (default: {DEFAULT_CONFIG_PATH})")
    parser.add_argument("--set-slot", type=str, help="Slot ID to update programmatically (e.g. B1-A01)")
    parser.add_argument("--coords", type=str, help="Normalized coords JSON string (e.g. '[[0.1, 0.2], [0.3, 0.2], [0.3, 0.4], [0.1, 0.4]]')")

    args = parser.parse_args()

    # Programmatic mode (no GUI)
    if args.set_slot and args.coords:
        import json
        poly = json.loads(args.coords)
        success = set_slot_manually(args.config, args.camera_id, args.set_slot, poly)
        if success:
            print(f"[OK] Programmatically updated ROI for slot '{args.set_slot}' on camera '{args.camera_id}'.")
        else:
            print(f"[Error] Failed to update slot '{args.set_slot}'.")
        return

    # Interactive GUI mode
    calibrator = ROICalibrator(
        image_path=args.image,
        camera_id=args.camera_id,
        config_path=args.config,
    )
    calibrator.run_interactive()


if __name__ == "__main__":
    main()
