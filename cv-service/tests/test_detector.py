"""
Unit & Integration Tests for Vehicle Detection Service
"""

import os
import sys
import unittest

# Ensure cv-service root is in sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from config.topology import ALL_SLOT_IDS, FLOORS, PARKING_STATUSES, GATES, RAMP_NODES, JUNCTIONS
from config.settings import TARGET_CLASSES, DEFAULT_CONF_THRESHOLD
from detection.detector import DetectionResult, FrameDetections


class TestTopologyIntegrity(unittest.TestCase):
    """Verifies that shared parking topology is intact and strictly preserved."""

    def test_slot_count(self):
        self.assertEqual(len(ALL_SLOT_IDS), 24, "Must contain exactly 24 slots")
        b1_slots = [s for s in ALL_SLOT_IDS if s.startswith("B1-")]
        b2_slots = [s for s in ALL_SLOT_IDS if s.startswith("B2-")]
        self.assertEqual(len(b1_slots), 12, "Floor B1 must have 12 slots")
        self.assertEqual(len(b2_slots), 12, "Floor B2 must have 12 slots")

    def test_gates_and_ramps(self):
        gate_ids = [g["id"] for g in GATES]
        self.assertIn("B1-GA", gate_ids)
        self.assertIn("B1-GB", gate_ids)

        ramp_ids = [r["id"] for r in RAMP_NODES]
        self.assertIn("B1-R1", ramp_ids)
        self.assertIn("B2-R1", ramp_ids)

    def test_junctions(self):
        j_ids = [j["id"] for j in JUNCTIONS]
        expected_junctions = ["B1-J1", "B1-J2", "B1-J3", "B2-J1", "B2-J2", "B2-J3"]
        for j in expected_junctions:
            self.assertIn(j, j_ids)

    def test_statuses(self):
        expected_statuses = ["available", "occupied", "reserved", "maintenance"]
        for st in expected_statuses:
            self.assertIn(st, PARKING_STATUSES)


class TestDetectionDataStructures(unittest.TestCase):
    """Verifies structured output formats and serialization."""

    def test_target_classes(self):
        self.assertEqual(TARGET_CLASSES[2], "car", "COCO class 2 must map to car")
        self.assertEqual(TARGET_CLASSES[3], "motorcycle", "COCO class 3 must map to motorcycle")

    def test_detection_result_serialization(self):
        det = DetectionResult(
            class_name="car",
            confidence=0.8923,
            bounding_box=(100, 150, 300, 450),
            frame_timestamp=1.25,
            class_id=2,
        )
        d = det.to_dict()
        self.assertEqual(d["class_name"], "car")
        self.assertEqual(d["confidence"], 0.8923)
        self.assertEqual(d["bounding_box"], [100, 150, 300, 450])
        self.assertEqual(d["frame_timestamp"], 1.25)
        self.assertEqual(d["class_id"], 2)

    def test_frame_detections_counts(self):
        det1 = DetectionResult("car", 0.9, (10, 10, 50, 50), 0.0, 2)
        det2 = DetectionResult("motorcycle", 0.85, (60, 60, 100, 100), 0.0, 3)

        frame = FrameDetections(
            frame_timestamp=0.0,
            detections=[det1, det2],
            total_vehicles=2,
            car_count=1,
            motorcycle_count=1,
            inference_time_ms=12.5,
        )

        d = frame.to_dict()
        self.assertEqual(d["total_vehicles"], 2)
        self.assertEqual(d["car_count"], 1)
        self.assertEqual(d["motorcycle_count"], 1)
        self.assertEqual(len(d["detections"]), 2)


class TestErrorHandling(unittest.TestCase):
    """Verifies that detector handles invalid inputs gracefully."""

    def test_invalid_image_path(self):
        try:
            from detection.detector import VehicleDetector
            detector = VehicleDetector.__new__(VehicleDetector)
            detector.conf_threshold = DEFAULT_CONF_THRESHOLD
            with self.assertRaises(FileNotFoundError):
                detector.detect_image("non_existent_image_12345.jpg")
        except ImportError:
            self.skipTest("Ultralytics or OpenCV not installed in active environment")

    def test_unsupported_image_extension(self):
        try:
            from detection.detector import VehicleDetector
            detector = VehicleDetector.__new__(VehicleDetector)
            # Create a dummy file with unsupported extension
            dummy_file = os.path.join(BASE_DIR, "dummy_test_file.txt")
            with open(dummy_file, "w") as f:
                f.write("test")
            try:
                with self.assertRaises(ValueError):
                    detector.detect_image(dummy_file)
            finally:
                if os.path.exists(dummy_file):
                    os.remove(dummy_file)
        except ImportError:
            self.skipTest("Ultralytics or OpenCV not installed in active environment")


if __name__ == "__main__":
    unittest.main()
