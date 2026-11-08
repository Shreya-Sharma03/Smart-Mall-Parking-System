"""
Unit and Integration Tests for Phase 2: ROI Configuration & Calibration
"""

import os
import sys
import copy
import json
import unittest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from topology import ALL_SLOT_IDS, FLOORS
from utils.roi_utils import (
    load_slots_config,
    save_slots_config,
    validate_slots_config,
    normalized_to_pixel,
    pixel_to_normalized,
    get_camera_slots,
    get_slot_by_id,
    update_slot_polygon,
    DEFAULT_CONFIG_PATH,
)


class TestSlotsROIConfiguration(unittest.TestCase):
    """Verifies that slots_config.json covers all 24 slots across multiple cameras."""

    def setUp(self):
        self.config = load_slots_config(DEFAULT_CONFIG_PATH)

    def test_all_24_slots_covered(self):
        """Verifies that all 24 canonical slot IDs exist across the camera configs."""
        all_configured_slots = []
        for cam in self.config.get("cameras", []):
            for s in cam.get("slots", []):
                all_configured_slots.append(s.get("slotId"))

        self.assertEqual(len(all_configured_slots), 24, "Must configure exactly 24 slots total")
        for expected_id in ALL_SLOT_IDS:
            self.assertIn(expected_id, all_configured_slots, f"Slot {expected_id} missing from slots_config.json")

    def test_multi_camera_structure(self):
        """Verifies multi-camera segregation (CAM-B1-01 + CAM-B1-02 for B1, CAM-B2-01 for B2)."""
        cam_ids = [c["cameraId"] for c in self.config["cameras"]]
        self.assertIn("CAM-B1-01", cam_ids)
        self.assertIn("CAM-B2-01", cam_ids)

        b1_01_slots = get_camera_slots(self.config, "CAM-B1-01")
        b2_slots = get_camera_slots(self.config, "CAM-B2-01")

        # CAM-B1-01 covers the 8 visible bays; additional B1 cameras cover the rest
        self.assertGreaterEqual(len(b1_01_slots), 1, "CAM-B1-01 must have at least 1 slot")
        self.assertEqual(len(b2_slots), 12, "CAM-B2-01 must have 12 slots")

        # All B1 slots across all B1 cameras must start with 'B1-'
        for cam in self.config["cameras"]:
            if cam.get("floor") == "B1":
                for s in cam.get("slots", []):
                    self.assertTrue(s["slotId"].startswith("B1-"))
        for s in b2_slots:
            self.assertTrue(s["slotId"].startswith("B2-"))

    def test_normalized_coordinate_bounds(self):
        """Verifies all polygon vertices are normalized [0.0, 1.0]."""
        for cam in self.config["cameras"]:
            for slot in cam["slots"]:
                poly = slot["polygon"]
                self.assertGreaterEqual(len(poly), 3, f"Slot {slot['slotId']} polygon must have >= 3 vertices")
                for pt in poly:
                    x, y = pt
                    self.assertTrue(0.0 <= x <= 1.0, f"X coord {x} out of range in {slot['slotId']}")
                    self.assertTrue(0.0 <= y <= 1.0, f"Y coord {y} out of range in {slot['slotId']}")


class TestROIValidationRules(unittest.TestCase):
    """Verifies that validation rejects invalid slot IDs, bounds, or duplicates."""

    def setUp(self):
        self.valid_config = load_slots_config(DEFAULT_CONFIG_PATH)

    def test_reject_invalid_slot_id(self):
        bad_config = copy.deepcopy(self.valid_config)
        bad_config["cameras"][0]["slots"][0]["slotId"] = "B1-A99"  # Non-existent slot

        is_valid, errors = validate_slots_config(bad_config)
        self.assertFalse(is_valid)
        self.assertTrue(any("Invalid slot ID 'B1-A99'" in err for err in errors))

    def test_reject_floor_mismatch(self):
        bad_config = copy.deepcopy(self.valid_config)
        # Try putting B2 slot on B1 camera
        bad_config["cameras"][0]["slots"][0]["slotId"] = "B2-A01"

        is_valid, errors = validate_slots_config(bad_config)
        self.assertFalse(is_valid)
        self.assertTrue(any("floor prefix mismatch" in err for err in errors))

    def test_reject_duplicate_slot_assignment(self):
        bad_config = copy.deepcopy(self.valid_config)
        # Duplicate B1-A01 into CAM-B2-01 (or another camera on B1)
        bad_config["cameras"].append({
            "cameraId": "CAM-B1-02",
            "floor": "B1",
            "slots": [{"slotId": "B1-A01", "polygon": [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]]}]
        })

        is_valid, errors = validate_slots_config(bad_config)
        self.assertFalse(is_valid)
        self.assertTrue(any("multiple cameras" in err for err in errors))

    def test_reject_out_of_bounds_coords(self):
        bad_config = copy.deepcopy(self.valid_config)
        bad_config["cameras"][0]["slots"][0]["polygon"][0] = [1.5, 0.5]  # Out of bounds

        is_valid, errors = validate_slots_config(bad_config)
        self.assertFalse(is_valid)
        self.assertTrue(any("outside normalized range" in err for err in errors))


class TestCoordinateTransformations(unittest.TestCase):
    """Verifies coordinate conversion between normalized [0..1] and image pixels."""

    def test_normalized_to_pixel_and_back(self):
        img_w = 1920
        img_h = 1080

        norm_poly = [[0.10, 0.20], [0.25, 0.20], [0.25, 0.45], [0.10, 0.45]]
        pixels = normalized_to_pixel(norm_poly, img_w, img_h)

        self.assertEqual(len(pixels), 4)
        self.assertEqual(pixels[0][0], int(round(0.10 * img_w)))
        self.assertEqual(pixels[0][1], int(round(0.20 * img_h)))

        # Convert back
        pixels_list = pixels.tolist() if hasattr(pixels, "tolist") else pixels
        recovered_norm = pixel_to_normalized(pixels_list, img_w, img_h)
        for original, recovered in zip(norm_poly, recovered_norm):
            self.assertAlmostEqual(original[0], recovered[0], delta=0.002)
            self.assertAlmostEqual(original[1], recovered[1], delta=0.002)

    def test_pixel_clamping(self):
        """Verifies coordinates are safely clamped within image bounds."""
        norm_poly = [[0.0, 0.0], [1.0, 1.0]]
        pixels = normalized_to_pixel(norm_poly, 100, 100)
        p0 = list(pixels[0])
        p1 = list(pixels[1])
        self.assertEqual(p0, [0, 0])
        self.assertEqual(p1, [99, 99])


class TestUpdateAndSaveROI(unittest.TestCase):
    """Verifies programmatic calibration updates."""

    def test_update_slot_polygon(self):
        cfg = copy.deepcopy(load_slots_config(DEFAULT_CONFIG_PATH))
        new_coords = [[0.11, 0.22], [0.33, 0.22], [0.33, 0.44], [0.11, 0.44]]

        updated = update_slot_polygon(cfg, "CAM-B1-01", "B1-A01", new_coords)
        self.assertTrue(updated)

        slot = get_slot_by_id(cfg, "B1-A01")
        self.assertEqual(slot["polygon"], new_coords)
        self.assertEqual(slot["cameraId"], "CAM-B1-01")
        self.assertEqual(slot["floor"], "B1")


if __name__ == "__main__":
    unittest.main()
