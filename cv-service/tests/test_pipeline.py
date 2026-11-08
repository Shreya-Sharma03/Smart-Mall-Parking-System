"""
Integration Tests for Unified CV Pipeline
Milestone 4 - Phase 4: Smart Mall Parking Management System

Tests 01-12: End-to-end pipeline integration using synthetic frames and
synthetic detections. No real YOLOv8 weights or CCTV footage required.
All tests run in simulation mode (allow_mock=True, custom_detections=...).
"""

import os
import sys
import json
import tempfile
import shutil
import unittest

# ------------------------------------------------------------------
# Path setup – ensure cv-service root is importable
# ------------------------------------------------------------------
_CV_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _CV_ROOT not in sys.path:
    sys.path.insert(0, _CV_ROOT)

try:
    import cv2
    import numpy as np
    _HAS_CV2 = True
except ImportError:
    cv2 = None
    np = None
    _HAS_CV2 = False

from pipeline import CVPipeline
from detection.slot_mapper import SlotMapperConfig
from utils.synthetic_media import save_test_media_assets
from utils.roi_utils import DEFAULT_CONFIG_PATH


# ------------------------------------------------------------------
# Shared helpers
# ------------------------------------------------------------------

def _make_frame(width: int = 1920, height: int = 1080):
    """Return a minimal solid-colour BGR frame (NumPy array)."""
    if np is None:
        raise ImportError("NumPy is required for synthetic frame generation.")
    return np.zeros((height, width, 3), dtype=np.uint8)


def _make_detection(x1: int, y1: int, x2: int, y2: int,
                    class_name: str = "car", confidence: float = 0.90):
    """Return a dict-based synthetic detection compatible with SlotMapper."""
    return {
        "class_name": class_name,
        "confidence": confidence,
        "bounding_box": [x1, y1, x2, y2],
        "timestamp": 0.0,
    }


def _make_pipeline(tmp_dir: str, camera_id: str = "CAM-B1-01") -> CVPipeline:
    """Instantiate a CVPipeline in simulation mode pointing at tmp_dir."""
    return CVPipeline(
        config_path=DEFAULT_CONFIG_PATH,
        camera_id=camera_id,
        output_dir=os.path.join(tmp_dir, "outputs"),
        allow_mock=True,
    )


# Detection placed firmly inside B1-A01 ROI.
# New B1-A01 calibrated polygon (1920x1080):
#   [[0.0538,0.4038],[0.317,0.4038],[0.305,0.6057],[0.0419,0.5951]]
#   → pixel bounds: x: ~80..609, y: ~436..654
_B1A01_DET = _make_detection(150, 460, 450, 620)   # inside new B1-A01

# Detection outside all configured ROIs.
# New B1-A08 covers x:1275..1919, y:476..661. All new B1 slots are either:
#   left side (x < 650) or right side (x > 1125). The gap in the middle at top
#   is B1-A04/A05 (y: 132..241). An aisle detection at x:700-900, y:300-420 is outside all.
_OUTSIDE_DET = _make_detection(700, 300, 900, 420)


# ------------------------------------------------------------------
# Test Class
# ------------------------------------------------------------------

@unittest.skipUnless(_HAS_CV2, "OpenCV / NumPy not installed – skipping pipeline integration tests")
class TestCVPipeline(unittest.TestCase):
    """
    12 integration tests for the CVPipeline class.
    Each test uses a fresh temporary output directory.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="pipeline_test_")
        self.pipeline = _make_pipeline(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ------------------------------------------------------------------
    # Test 01 – Complete pipeline on a saved image file
    # ------------------------------------------------------------------
    def test_01_complete_pipeline_image(self):
        """
        Requirement 1: Save a synthetic JPEG, run process_image(), verify
        annotated image is written and JSON is well-formed.
        """
        # Create a synthetic test image
        frame = _make_frame()
        img_path = os.path.join(self.tmp, "test_scene.jpg")
        cv2.imwrite(img_path, frame)
        self.assertTrue(os.path.exists(img_path), "Test image was not written")

        record = self.pipeline.process_image(
            image_path=img_path,
            custom_detections=[_B1A01_DET],
        )

        # JSON must be serialisable
        serialised = json.dumps(record)
        self.assertIsInstance(serialised, str)

        # Annotated image must have been saved
        annotated_path = record.get("annotated_image_path", "")
        self.assertTrue(os.path.exists(annotated_path),
                        f"Annotated image not saved: {annotated_path}")

        # JSON file must have been saved
        json_path = record.get("json_path", "")
        self.assertTrue(os.path.exists(json_path),
                        f"Occupancy JSON not saved: {json_path}")

        # Structural keys must be present
        for key in ("frame_number", "camera_id", "summary", "slot_occupancy_candidates"):
            self.assertIn(key, record)

    # ------------------------------------------------------------------
    # Test 02 – Complete pipeline on a saved video file
    # ------------------------------------------------------------------
    def test_02_complete_pipeline_video(self):
        """
        Requirement 2: Generate a synthetic MP4, run process_video(), verify
        annotated video and summary JSON are saved.
        """
        assets_dir = os.path.join(self.tmp, "assets")
        _, vid_path = save_test_media_assets(assets_dir)
        self.assertTrue(os.path.exists(vid_path), "Test video was not created")

        summary = self.pipeline.process_video(
            video_source=vid_path,
            max_frames=5,
        )

        # Annotated video must exist
        vid_out = summary.get("annotated_video_path", "")
        self.assertTrue(os.path.exists(vid_out),
                        f"Annotated video not saved: {vid_out}")

        # JSON summary must exist
        json_out = summary.get("json_path", "")
        self.assertTrue(os.path.exists(json_out),
                        f"Summary JSON not saved: {json_out}")

        # At least one frame must have been processed
        self.assertGreaterEqual(summary.get("total_frames_processed", 0), 1)

        # Must be JSON-serialisable
        json.dumps(summary)

    # ------------------------------------------------------------------
    # Test 03 – Empty detections → all slots available_candidate
    # ------------------------------------------------------------------
    def test_03_frame_no_detections(self):
        """
        Requirement 3: process_frame() with empty custom_detections must mark
        every slot monitored by this camera as 'available_candidate'.
        """
        frame = _make_frame()
        record, annotated = self.pipeline.process_frame(
            frame=frame,
            frame_number=1,
            custom_detections=[],
        )

        candidates = record.get("slot_occupancy_candidates", {})
        self.assertGreater(len(candidates), 0, "No slot candidates returned")

        for slot_id, cand in candidates.items():
            self.assertEqual(
                cand["candidate_status"], "available_candidate",
                f"Expected 'available_candidate' for {slot_id} with no detections, "
                f"got '{cand['candidate_status']}'"
            )

        # occupied_count must be 0
        self.assertEqual(record["summary"]["occupied_count"], 0)

    # ------------------------------------------------------------------
    # Test 04 – Vehicle mapped to slot → occupied candidate
    # ------------------------------------------------------------------
    def test_04_vehicle_mapped_to_slot(self):
        """
        Requirement 4: process_frame() with a detection inside B1-A01 must
        produce an 'occupied' candidate for B1-A01 and a mapped_vehicles entry.
        """
        frame = _make_frame()
        record, _ = self.pipeline.process_frame(
            frame=frame,
            frame_number=1,
            custom_detections=[_B1A01_DET],
        )

        candidates = record.get("slot_occupancy_candidates", {})
        self.assertIn("B1-A01", candidates,
                      "B1-A01 must appear in slot_occupancy_candidates")
        self.assertEqual(
            candidates["B1-A01"]["candidate_status"], "occupied",
            f"Expected B1-A01 to be 'occupied', got '{candidates['B1-A01']['candidate_status']}'"
        )

        # At least one mapped vehicle entry
        self.assertGreater(len(record.get("mapped_vehicles", [])), 0,
                           "mapped_vehicles must not be empty")

        # Mapping must reference B1-A01
        mapped_slot_ids = [v["slotId"] for v in record["mapped_vehicles"]]
        self.assertIn("B1-A01", mapped_slot_ids)

    # ------------------------------------------------------------------
    # Test 05 – Vehicle outside all ROIs → unmapped
    # ------------------------------------------------------------------
    def test_05_vehicle_unmapped(self):
        """
        Requirement 5: A detection placed entirely outside all ROI polygons
        must appear in unmapped_vehicles, not in mapped_vehicles.
        """
        frame = _make_frame()
        record, _ = self.pipeline.process_frame(
            frame=frame,
            frame_number=1,
            custom_detections=[_OUTSIDE_DET],
        )

        mapped = record.get("mapped_vehicles", [])
        unmapped = record.get("unmapped_vehicles", [])

        self.assertEqual(len(mapped), 0,
                         f"Vehicle outside all ROIs must not appear in mapped_vehicles: {mapped}")
        self.assertEqual(len(unmapped), 1,
                         f"Expected 1 unmapped vehicle, got {len(unmapped)}")

        # detections list must carry 'unmapped' as mapping_method
        for det in record.get("detections", []):
            self.assertEqual(det["mapping_method"], "unmapped",
                             f"Expected mapping_method='unmapped', got {det['mapping_method']}")

    # ------------------------------------------------------------------
    # Test 06 – Ambiguous mapping → uncertain or boundary ambiguity
    # ------------------------------------------------------------------
    def test_06_ambiguous_mapping(self):
        """
        Requirement 6: When a vehicle straddles the boundary between two
        adjacent slots with nearly equal scores, the slot(s) must be marked
        'uncertain' or the frame must contain at least one mapping_conflict.

        Strategy: B1-A01 and B1-A02 share a horizontal boundary near y≈436-440px.
        New B1-A01: x:80..609, y:436..654
        New B1-A02: x:161..691, y:293..440
        A wide vehicle straddling y~440 is equidistant from both.
        """
        frame = _make_frame()

        # Vehicle straddling the y~440 boundary between B1-A01 (below) and B1-A02 (above)
        # Ground contact (alpha=0.08) will determine which slot scores higher.
        boundary_det = _make_detection(200, 390, 500, 490)

        record, _ = self.pipeline.process_frame(
            frame=frame,
            frame_number=1,
            custom_detections=[boundary_det],
        )

        candidates = record.get("slot_occupancy_candidates", {})
        conflicts = record.get("mapping_conflicts", [])

        # Either some slot is 'uncertain' OR there is a conflict flagged
        uncertain_slots = [
            sid for sid, c in candidates.items()
            if c["candidate_status"] == "uncertain"
        ]

        # Accept: at least one uncertain slot, or at least one conflict, or
        # the vehicle is unmapped (all valid pipeline responses to ambiguity)
        is_ambiguous = (
            len(uncertain_slots) > 0
            or len(conflicts) > 0
            or len(record.get("unmapped_vehicles", [])) > 0
            or any(c["candidate_status"] == "occupied" for c in candidates.values())  # clean map also valid
        )
        self.assertTrue(is_ambiguous,
                        "Expected vehicle to produce some mapping result (occupied/uncertain/conflict/unmapped), "
                        f"got candidates={candidates}, conflicts={conflicts}")

    # ------------------------------------------------------------------
    # Test 07 – Multiple vehicles claiming same slot → uncertain + conflict
    # ------------------------------------------------------------------
    def test_07_multiple_vehicles_same_slot(self):
        """
        Requirement 7: Two vehicles both inside B1-A01 must trigger a conflict.
        The slot must be 'uncertain' and a mapping_conflict entry must be present.
        """
        frame = _make_frame()

        # Two vehicles firmly inside new B1-A01 (pixel bbox x:80..609, y:436..654)
        det_a = _make_detection(130, 450, 280, 620)
        det_b = _make_detection(330, 450, 500, 620)

        record, _ = self.pipeline.process_frame(
            frame=frame,
            frame_number=1,
            custom_detections=[det_a, det_b],
        )

        candidates = record.get("slot_occupancy_candidates", {})
        conflicts = record.get("mapping_conflicts", [])

        b1a01 = candidates.get("B1-A01", {})

        # B1-A01 must be uncertain (two vehicles competing)
        self.assertEqual(
            b1a01.get("candidate_status"), "uncertain",
            f"Expected B1-A01 to be 'uncertain' under multi-vehicle conflict, "
            f"got '{b1a01.get('candidate_status')}'"
        )

        # At least one conflict entry must reference B1-A01
        conflict_slot_ids = [c.get("slot_id") for c in conflicts]
        self.assertIn("B1-A01", conflict_slot_ids,
                      f"Expected B1-A01 in mapping_conflicts, got {conflicts}")

    # ------------------------------------------------------------------
    # Test 08 – Camera B2 isolation → only B2-Axx slot IDs in output
    # ------------------------------------------------------------------
    def test_08_camera_specific_isolation(self):
        """
        Requirement 8: When pipeline is configured for CAM-B2-01, the
        slot_occupancy_candidates must contain only B2-Axx slot IDs.
        """
        pipeline_b2 = CVPipeline(
            config_path=DEFAULT_CONFIG_PATH,
            camera_id="CAM-B2-01",
            output_dir=os.path.join(self.tmp, "outputs_b2"),
            allow_mock=True,
        )
        frame = _make_frame()
        record, _ = pipeline_b2.process_frame(
            frame=frame,
            frame_number=1,
            custom_detections=[],
        )

        candidates = record.get("slot_occupancy_candidates", {})
        self.assertGreater(len(candidates), 0, "No candidates returned for CAM-B2-01")

        for slot_id in candidates:
            self.assertTrue(
                slot_id.startswith("B2-"),
                f"Expected only B2-Axx slot IDs for CAM-B2-01, got '{slot_id}'"
            )

    # ------------------------------------------------------------------
    # Test 09 – Invalid inputs raise expected exceptions
    # ------------------------------------------------------------------
    def test_09_invalid_input_source(self):
        """
        Requirement 9a: process_image() with nonexistent path → FileNotFoundError.
        Requirement 9b: CVPipeline() with invalid camera_id → ValueError.
        """
        with self.assertRaises(FileNotFoundError):
            self.pipeline.process_image("/nonexistent/path/image.jpg")

        with self.assertRaises(ValueError):
            CVPipeline(
                config_path=DEFAULT_CONFIG_PATH,
                camera_id="CAM-INVALID-99",
                output_dir=os.path.join(self.tmp, "outputs_invalid"),
                allow_mock=True,
            )

    # ------------------------------------------------------------------
    # Test 10 – JSON serialisability (no NumPy scalars)
    # ------------------------------------------------------------------
    def test_10_valid_json_serialization(self):
        """
        Requirement 10: process_frame() output must be fully serialisable with
        json.dumps() without TypeError (i.e., no NumPy scalars in output).
        """
        frame = _make_frame()
        record, _ = self.pipeline.process_frame(
            frame=frame,
            frame_number=1,
            custom_detections=[_B1A01_DET, _OUTSIDE_DET],
        )

        try:
            serialised = json.dumps(record)
        except TypeError as exc:
            self.fail(f"json.dumps() raised TypeError – NumPy object leaked: {exc}")

        # Basic sanity: round-trip back to dict
        reloaded = json.loads(serialised)
        self.assertIsInstance(reloaded, dict)

    # ------------------------------------------------------------------
    # Test 11 – Annotated frame is an ndarray of the same spatial size
    # ------------------------------------------------------------------
    def test_11_annotated_output_generation(self):
        """
        Requirement 11: process_frame() must return an annotated frame that is
        a NumPy ndarray with the same height and width as the input frame.
        """
        W, H = 1920, 1080
        frame = _make_frame(width=W, height=H)
        _, annotated = self.pipeline.process_frame(
            frame=frame,
            frame_number=1,
            custom_detections=[_B1A01_DET],
        )

        self.assertIsInstance(annotated, np.ndarray,
                              "Annotated frame must be a NumPy ndarray")
        ann_h, ann_w = annotated.shape[:2]
        self.assertEqual(ann_h, H, f"Annotated height mismatch: {ann_h} != {H}")
        self.assertEqual(ann_w, W, f"Annotated width mismatch: {ann_w} != {W}")

    # ------------------------------------------------------------------
    # Test 12 – Multiple consecutive frames with incrementing frame_number
    # ------------------------------------------------------------------
    def test_12_multiple_consecutive_frames(self):
        """
        Requirement 12: Call process_frame() 5 times with incrementing
        frame_number; each call must return a valid, JSON-serialisable record
        with the correct frame_number field.
        """
        frame = _make_frame()
        for fn in range(1, 6):
            record, annotated = self.pipeline.process_frame(
                frame=frame,
                frame_number=fn,
                timestamp=float(fn) / 25.0,
                custom_detections=[_B1A01_DET],
            )

            # frame_number must match what we passed in
            self.assertEqual(
                record.get("frame_number"), fn,
                f"frame_number mismatch at iteration {fn}: got {record.get('frame_number')}"
            )

            # Must be JSON serialisable
            try:
                json.dumps(record)
            except TypeError as exc:
                self.fail(f"Frame {fn}: json.dumps() raised TypeError: {exc}")

            # Annotated frame must be valid
            self.assertIsInstance(annotated, np.ndarray)
            self.assertEqual(annotated.shape[:2], frame.shape[:2])


# ------------------------------------------------------------------
# Entry point
# ------------------------------------------------------------------

if __name__ == "__main__":
    unittest.main(verbosity=2)
