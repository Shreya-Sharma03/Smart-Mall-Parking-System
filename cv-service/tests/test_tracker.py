"""
Unit Tests for Vehicle Tracker (Milestone 5)
Tests persistent track ID generation, spatial association across consecutive frames,
coasting on temporary detection dropouts, duplicate suppression, and track pruning.
"""

import sys
import os
import unittest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from detection.tracker import VehicleTracker, TrackerConfig, TrackedVehicle


class TestVehicleTracker(unittest.TestCase):
    """Test suite for Milestone 5 VehicleTracker."""

    def setUp(self):
        self.config = TrackerConfig(
            min_iou_match=0.25,
            max_centroid_dist=100.0,
            max_missed_frames=3,
            min_hits_to_confirm=1,
            duplicate_iou_threshold=0.65,
        )
        self.tracker = VehicleTracker(config=self.config)

    def test_01_track_initialization(self):
        """A new detection initializes a TrackedVehicle with track_id 1."""
        dets = [
            {"class_name": "car", "confidence": 0.90, "bounding_box": [100, 200, 300, 400]}
        ]
        tracks = self.tracker.update(dets, timestamp=0.0)

        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0].track_id, 1)
        self.assertEqual(tracks[0].class_name, "car")
        self.assertEqual(tracks[0].hits, 1)
        self.assertTrue(tracks[0].is_active)

    def test_02_persistent_track_across_frames(self):
        """A vehicle moving slightly across consecutive frames maintains the exact same track_id."""
        # Frame 1: box at [100, 200, 300, 400]
        dets_f1 = [{"class_name": "car", "confidence": 0.90, "bounding_box": [100, 200, 300, 400]}]
        tracks_f1 = self.tracker.update(dets_f1, timestamp=0.0)
        self.assertEqual(tracks_f1[0].track_id, 1)

        # Frame 2: box shifted slightly by 10px -> high IoU
        dets_f2 = [{"class_name": "car", "confidence": 0.91, "bounding_box": [105, 205, 305, 405]}]
        tracks_f2 = self.tracker.update(dets_f2, timestamp=0.1)

        self.assertEqual(len(tracks_f2), 1)
        self.assertEqual(tracks_f2[0].track_id, 1, "Track ID must remain persistent across consecutive frames")
        self.assertEqual(tracks_f2[0].hits, 2)
        self.assertEqual(tracks_f2[0].age_frames, 2)
        self.assertEqual(tracks_f2[0].missed_frames, 0)

    def test_03_coasting_on_temporary_missed_frame(self):
        """A temporarily missing vehicle remains in tracks (coasting) rather than being deleted immediately."""
        # Frame 1: Vehicle detected
        self.tracker.update([{"class_name": "car", "confidence": 0.88, "bounding_box": [100, 200, 300, 400]}])

        # Frame 2: Vehicle missed (empty detection list)
        tracks_f2 = self.tracker.update([], timestamp=0.1)

        self.assertEqual(len(tracks_f2), 1, "Track must persist in coasting state during temporary dropout")
        self.assertEqual(tracks_f2[0].track_id, 1)
        self.assertFalse(tracks_f2[0].is_active, "Track should be marked inactive/coasting")
        self.assertEqual(tracks_f2[0].missed_frames, 1)

        # Frame 3: Vehicle reappears in roughly the same location
        tracks_f3 = self.tracker.update(
            [{"class_name": "car", "confidence": 0.89, "bounding_box": [102, 202, 302, 402]}],
            timestamp=0.2,
        )
        self.assertEqual(len(tracks_f3), 1)
        self.assertEqual(tracks_f3[0].track_id, 1, "Track ID must be recovered upon redetection")
        self.assertTrue(tracks_f3[0].is_active)
        self.assertEqual(tracks_f3[0].missed_frames, 0)

    def test_04_track_pruning_after_max_missed_frames(self):
        """A track is pruned after exceeding max_missed_frames without detection."""
        # Frame 1: Detected
        self.tracker.update([{"class_name": "car", "confidence": 0.90, "bounding_box": [100, 200, 300, 400]}])

        # Frames 2, 3, 4: Missed (max_missed_frames = 3)
        self.tracker.update([])
        self.tracker.update([])
        tracks_f4 = self.tracker.update([])
        self.assertEqual(len(tracks_f4), 1, "Still kept at missed_frames=3")

        # Frame 5: Missed frame 4 > max_missed_frames(3) -> Pruned!
        tracks_f5 = self.tracker.update([])
        self.assertEqual(len(tracks_f5), 0, "Track must be deleted after exceeding max_missed_frames")

    def test_05_duplicate_detection_suppressed(self):
        """Two overlapping detections representing the same vehicle produce only one track."""
        dets = [
            {"class_name": "car", "confidence": 0.92, "bounding_box": [100, 200, 300, 400]},
            {"class_name": "car", "confidence": 0.75, "bounding_box": [105, 205, 305, 405]},  # IoU > 0.80
        ]
        tracks = self.tracker.update(dets)
        self.assertEqual(len(tracks), 1, "Only one track should be initiated for near-identical bounding boxes")
        self.assertEqual(tracks[0].confidence, 0.92)

    def test_06_multiple_vehicles_tracked_independently(self):
        """Multiple distinct vehicles receive distinct persistent IDs."""
        dets = [
            {"class_name": "car", "confidence": 0.90, "bounding_box": [50, 100, 200, 300]},
            {"class_name": "motorcycle", "confidence": 0.85, "bounding_box": [500, 600, 650, 800]},
        ]
        tracks = self.tracker.update(dets)
        self.assertEqual(len(tracks), 2)
        track_ids = {t.track_id for t in tracks}
        self.assertEqual(track_ids, {1, 2})


if __name__ == "__main__":
    unittest.main()
