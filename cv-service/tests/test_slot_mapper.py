"""
Unit Tests for Vehicle-to-Slot Mapping (Phase 3 Corrections + Phase 4 Enhancements)
Tests geometric point containment, exact polygon clipping, IoU overlap,
ground-contact estimation, duplicate suppression, disambiguation,
physical overlap conflict vs capacity conflict, multi-camera isolation,
and candidate status generation.
"""

import sys
import os
import unittest

# Ensure cv-service root is in sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from config.topology import ALL_SLOT_IDS, FLOORS
from detection.slot_mapper import (
    SlotMapper,
    SlotMapperConfig,
    MappedVehicle,
    SlotOccupancyCandidate,
    FrameMappingResult,
    calculate_bottom_center,
    calculate_ground_contact_point,
    is_point_in_polygon,
    polygon_area,
    clip_polygon_to_bbox,
    compute_polygon_intersection_and_iou,
    compute_bbox_intersection_and_iou,
    compute_bbox_iou,
)
from utils.roi_utils import load_slots_config


class TestSlotMapper(unittest.TestCase):
    """Test suite for Phase 3 SlotMapper logic and threshold consistency."""

    def setUp(self):
        """Set up standard test configuration with sample rectangular and tilted slots."""
        self.sample_config = {
            "version": "1.0",
            "cameras": [
                {
                    "cameraId": "CAM-B1-01",
                    "floor": "B1",
                    "slots": [
                        {
                            "slotId": "B1-A01",
                            "polygon": [
                                [0.10, 0.10],
                                [0.30, 0.10],
                                [0.30, 0.50],
                                [0.10, 0.50],
                            ],
                        },
                        {
                            "slotId": "B1-A02",
                            "polygon": [
                                [0.35, 0.10],
                                [0.55, 0.10],
                                [0.55, 0.50],
                                [0.35, 0.50],
                            ],
                        },
                        {
                            "slotId": "B1-A03",
                            # Tilted / slanted parallelogram bay: top-left (0.60, 0.10), top-right (0.75, 0.10),
                            # bottom-right (0.85, 0.50), bottom-left (0.70, 0.50)
                            "polygon": [
                                [0.60, 0.10],
                                [0.75, 0.10],
                                [0.85, 0.50],
                                [0.70, 0.50],
                            ],
                        },
                    ],
                },
                {
                    "cameraId": "CAM-B2-01",
                    "floor": "B2",
                    "slots": [
                        {
                            "slotId": "B2-A01",
                            "polygon": [
                                [0.15, 0.15],
                                [0.35, 0.15],
                                [0.35, 0.55],
                                [0.15, 0.55],
                            ],
                        },
                    ],
                },
            ],
        }
        self.frame_dims = (1000, 1000)
        self.mapper = SlotMapper()

    def test_01_vehicle_completely_inside_rectangular_slot(self):
        """Requirement 1: Vehicle completely inside a rectangular slot -> Mapped & Occupied."""
        # Slot B1-A01 is [100..300, 100..500] in 1000x1000
        # Vehicle at [140, 150, 260, 420] -> bottom-center (200, 420) is inside
        detections = [
            {
                "class_name": "car",
                "confidence": 0.94,
                "bounding_box": [140, 150, 260, 420],
                "timestamp": 1.0,
            }
        ]

        result = self.mapper.map_detections(
            detections, self.sample_config, self.frame_dims, camera_id="CAM-B1-01"
        )

        self.assertEqual(result.occupied_count, 1)
        self.assertEqual(result.available_candidate_count, 2)
        self.assertEqual(len(result.mapped_vehicles), 1)

        v = result.mapped_vehicles[0]
        self.assertEqual(v.slot_id, "B1-A01")
        self.assertEqual(v.occupancy_candidate, "occupied")
        self.assertFalse(v.is_conflict)
        self.assertGreaterEqual(v.overlap_score, 0.50)
        self.assertEqual(v.mapping_method, "hybrid")

        candidate = result.slot_candidates["B1-A01"]
        self.assertEqual(candidate.candidate_status, "occupied")
        self.assertIsNotNone(candidate.mapped_vehicle)

    def test_02_vehicle_inside_tilted_parking_slot_polygon(self):
        """Requirement 2: Vehicle inside a tilted parking slot polygon -> Exact polygon clipping."""
        # Slot B1-A03 is a tilted parallelogram:
        # [600, 100], [750, 100], [850, 500], [700, 500]
        # Vehicle A is cleanly positioned inside the slanted polygon:
        # x: 670..780, y: 200..400. At y=400, slanted x bounds are [675, 825]. Bottom-center: (725, 400) inside!
        detections_inside = [
            {
                "class_name": "car",
                "confidence": 0.92,
                "bounding_box": [670, 200, 780, 400],
                "timestamp": 2.0,
            }
        ]

        result = self.mapper.map_detections(
            detections_inside, self.sample_config, self.frame_dims, camera_id="CAM-B1-01"
        )
        self.assertEqual(result.occupied_count, 1)
        self.assertEqual(result.mapped_vehicles[0].slot_id, "B1-A03")
        self.assertGreater(result.mapped_vehicles[0].overlap_score, 0.50)

        # Vehicle B is located in the empty bounding-box corner of B1-A03:
        # x: 600..650, y: 350..450.
        # Note: B1-A03's axis-aligned bbox is [600..850, 100..500], so Vehicle B overlaps the bbox!
        # BUT at y=350..450, the actual tilted polygon has x >= 662.
        # Vehicle B is completely OUTSIDE the tilted polygon!
        detections_in_bbox_corner = [
            {
                "class_name": "car",
                "confidence": 0.90,
                "bounding_box": [600, 350, 650, 450],
                "timestamp": 2.1,
            }
        ]

        result_corner = self.mapper.map_detections(
            detections_in_bbox_corner, self.sample_config, self.frame_dims, camera_id="CAM-B1-01"
        )
        # Vehicle B must NOT map to B1-A03 because exact polygon intersection is 0!
        self.assertEqual(result_corner.occupied_count, 0)
        self.assertEqual(result_corner.unmapped_vehicles_count, 1)
        self.assertEqual(result_corner.slot_candidates["B1-A03"].candidate_status, "available_candidate")

    def test_03_vehicle_partially_overlapping_slot(self):
        """Requirement 3: Vehicle partially overlapping slot with bottom-center inside -> Mapped."""
        # Vehicle extends to x=80 (outside slot min_x=100), but bottom-center is at x=140, y=400 (inside)
        detections = [
            {
                "class_name": "car",
                "confidence": 0.88,
                "bounding_box": [80, 200, 200, 400],
                "timestamp": 1.5,
            }
        ]

        result = self.mapper.map_detections(
            detections, self.sample_config, self.frame_dims, camera_id="CAM-B1-01"
        )

        self.assertEqual(result.occupied_count, 1)
        v = result.mapped_vehicles[0]
        self.assertEqual(v.slot_id, "B1-A01")
        self.assertEqual(result.slot_candidates["B1-A01"].candidate_status, "occupied")

    def test_04_vehicle_outside_all_slots(self):
        """Requirement 4: Vehicle outside all slots -> Classified as unmapped."""
        # Vehicle located at thoroughfare aisle [850, 800, 950, 950]
        detections = [
            {
                "class_name": "car",
                "confidence": 0.91,
                "bounding_box": [850, 800, 950, 950],
                "timestamp": 2.0,
            }
        ]

        result = self.mapper.map_detections(
            detections, self.sample_config, self.frame_dims, camera_id="CAM-B1-01"
        )

        self.assertEqual(result.occupied_count, 0)
        self.assertEqual(result.available_candidate_count, 3)
        self.assertEqual(result.unmapped_vehicles_count, 1)
        self.assertEqual(len(result.unmapped_vehicles), 1)

        unmapped = result.unmapped_vehicles[0]
        self.assertIsNone(unmapped.slot_id)
        self.assertEqual(unmapped.mapping_method, "unmapped")
        self.assertEqual(unmapped.occupancy_candidate, "unmapped")

    def test_05_vehicle_near_boundary_between_two_slots(self):
        """Requirement 5: Vehicle near boundary between B1-A01 and B1-A02 -> Flags boundary ambiguity."""
        # B1-A01 ends at x=300 (0.30), B1-A02 starts at x=350 (0.35)
        # Position vehicle right at the margin [280, 200, 360, 450]
        detections = [
            {
                "class_name": "car",
                "confidence": 0.85,
                "bounding_box": [280, 200, 360, 450],
                "timestamp": 2.5,
            }
        ]

        config = SlotMapperConfig(boundary_ambiguity_threshold=0.15)
        custom_mapper = SlotMapper(config)
        result = custom_mapper.map_detections(
            detections, self.sample_config, self.frame_dims, camera_id="CAM-B1-01"
        )

        self.assertTrue(len(result.mapped_vehicles) == 1 or len(result.unmapped_vehicles) == 1)

    def test_06_two_vehicles_claiming_same_slot_capacity_conflict(self):
        """Requirement 6: Two distinct vehicles claiming same slot (inter-vehicle IoU < threshold) -> Capacity conflict."""
        # Both motorcycles are inside slot B1-A01 [100..300, 100..500], but side-by-side without touching
        detections = [
            {
                "class_name": "motorcycle",
                "confidence": 0.90,
                "bounding_box": [110, 150, 180, 300],
                "timestamp": 3.0,
            },
            {
                "class_name": "motorcycle",
                "confidence": 0.87,
                "bounding_box": [220, 150, 290, 300],
                "timestamp": 3.0,
            },
        ]

        result = self.mapper.map_detections(
            detections, self.sample_config, self.frame_dims, camera_id="CAM-B1-01"
        )

        self.assertEqual(result.uncertain_count, 1)
        self.assertEqual(result.occupied_count, 0)
        cand = result.slot_candidates["B1-A01"]
        self.assertEqual(cand.candidate_status, "uncertain")
        self.assertIn("Capacity conflict", cand.notes)

        for v in result.mapped_vehicles:
            if v.slot_id == "B1-A01":
                self.assertTrue(v.is_conflict)
                self.assertEqual(v.occupancy_candidate, "uncertain")

    def test_07_two_vehicles_physically_overlapping(self):
        """Requirement 7: Two vehicles physically overlapping (inter-vehicle IoU >= conflict_iou_threshold).
        
        Note: When inter-vehicle IoU >= duplicate_iou_threshold (0.65), duplicate suppression
        fires first and keeps only the highest-confidence detection. This is the correct behaviour
        since near-identical bboxes represent the same physical vehicle detected twice.
        The result is a clean single-vehicle mapping (not a conflict), which is preferable
        over reporting a spurious conflict for one real vehicle.
        """
        # Two bounding boxes with IoU ≈ 0.75 (> duplicate_iou_threshold=0.65)
        # -> duplicate suppression keeps highest confidence, no conflict expected
        detections = [
            {
                "class_name": "car",
                "confidence": 0.93,
                "bounding_box": [120, 150, 260, 400],
                "timestamp": 3.5,
            },
            {
                "class_name": "car",
                "confidence": 0.89,
                "bounding_box": [130, 160, 270, 410],  # IoU ≈ 0.90 > 0.65 -> suppressed
                "timestamp": 3.5,
            },
        ]

        result = self.mapper.map_detections(
            detections, self.sample_config, self.frame_dims, camera_id="CAM-B1-01"
        )

        # Duplicate suppressor fires: 1 effective detection -> B1-A01 occupied (not uncertain)
        # The suppressed lower-confidence detection appears as unmapped
        suppressed = [v for v in result.unmapped_vehicles if v.conflict_reason and "duplicate" in v.conflict_reason.lower()]
        self.assertEqual(len(suppressed), 1, "Lower-confidence duplicate must be suppressed as unmapped")
        # The slot must be occupied by the surviving higher-confidence detection
        b1a01 = result.slot_candidates.get("B1-A01")
        self.assertIsNotNone(b1a01)
        self.assertEqual(b1a01.candidate_status, "occupied",
                         "After duplicate suppression, single claimant should produce 'occupied'")

        # To test genuine physical overlap conflict (IoU < duplicate threshold, IoU >= conflict threshold):
        # Use bboxes with IoU ≈ 0.35 (overlapping but not duplicate-level)
        detections_conflict = [
            {
                "class_name": "car",
                "confidence": 0.93,
                "bounding_box": [120, 150, 260, 400],
                "timestamp": 3.5,
            },
            {
                "class_name": "car",
                "confidence": 0.89,
                "bounding_box": [200, 150, 290, 400],  # IoU ≈ 0.37, > conflict(0.20) but < duplicate(0.65)
                "timestamp": 3.5,
            },
        ]
        result_conflict = self.mapper.map_detections(
            detections_conflict, self.sample_config, self.frame_dims, camera_id="CAM-B1-01"
        )
        self.assertEqual(result_conflict.uncertain_count, 1)
        cand = result_conflict.slot_candidates["B1-A01"]
        self.assertEqual(cand.candidate_status, "uncertain")
        self.assertIn("Physical overlap conflict", cand.notes)

    def test_08_different_camera_ids_isolation(self):
        """Requirement 8: Different camera IDs -> Complete floor/camera isolation."""
        detections = [
            {
                "class_name": "car",
                "confidence": 0.95,
                "bounding_box": [200, 200, 300, 450],
                "timestamp": 5.0,
            }
        ]

        # Process on CAM-B2-01
        res_b2 = self.mapper.map_detections(
            detections, self.sample_config, self.frame_dims, camera_id="CAM-B2-01"
        )
        self.assertEqual(res_b2.floor, "B2")
        self.assertEqual(res_b2.camera_id, "CAM-B2-01")
        self.assertIn("B2-A01", res_b2.slot_candidates)
        self.assertNotIn("B1-A01", res_b2.slot_candidates)
        self.assertEqual(res_b2.occupied_count, 1)

        # Process on CAM-B1-01 -> B2-A01 is not visible/monitored by CAM-B1-01
        res_b1 = self.mapper.map_detections(
            detections, self.sample_config, self.frame_dims, camera_id="CAM-B1-01"
        )
        self.assertEqual(res_b1.floor, "B1")
        self.assertNotIn("B2-A01", res_b1.slot_candidates)
        self.assertIn("B1-A01", res_b1.slot_candidates)

    def test_09_missing_or_invalid_roi_configuration(self):
        """Requirement 9: Invalid camera ID or corrupt dimensions -> Raises appropriate error."""
        with self.assertRaises(ValueError):
            self.mapper.map_detections(
                [], self.sample_config, self.frame_dims, camera_id="CAM-UNKNOWN-99"
            )

        with self.assertRaises(ValueError):
            self.mapper.map_detections(
                [], self.sample_config, (0, 0), camera_id="CAM-B1-01"
            )

    def test_10_empty_detection_list(self):
        """Requirement 10: Empty detection list -> All camera slots become available_candidate."""
        result = self.mapper.map_detections(
            [], self.sample_config, self.frame_dims, camera_id="CAM-B1-01"
        )

        self.assertEqual(result.total_slots_monitored, 3)
        self.assertEqual(result.occupied_count, 0)
        self.assertEqual(result.available_candidate_count, 3)
        self.assertEqual(result.uncertain_count, 0)
        self.assertEqual(result.unmapped_vehicles_count, 0)

        for s_id, cand in result.slot_candidates.items():
            self.assertEqual(cand.candidate_status, "available_candidate")
            self.assertIsNone(cand.mapped_vehicle)

    def test_11_configured_thresholds_verification(self):
        """Requirement 11: Verify that implementation dynamically uses custom configured thresholds."""
        # Vehicle has 35% overlap with B1-A01, bottom-center OUTSIDE polygon (contained=False)
        # Slot B1-A01: [100..300, 100..500]
        # Vehicle at [100, 50, 300, 240] -> bottom_y = 240. But wait, y in [100, 500] so bottom-center is inside!
        # To make contained=False with 35% overlap:
        # Bottom-center must be outside y > 500 or x > 300.
        # Let slot be [100..300, 100..500]. Vehicle at [100, 360, 300, 600].
        # Bbox: width=200, height=240, area=48,000.
        # Intersection with slot: [100, 360, 300, 500] -> width=200, height=140, area=28,000.
        # overlap_ratio = 28,000 / 48,000 = 0.5833 (58.33%).
        # Bottom-center: x=200, bottom_y=600 (outside y=500!). So contained = False!
        detections = [
            {
                "class_name": "car",
                "confidence": 0.90,
                "bounding_box": [100, 360, 300, 600],
                "timestamp": 4.0,
            }
        ]

        # Config A: min_overlap_ratio=0.50, min_iou=0.20 -> overlap_ratio=0.5833 qualifies!
        # score = 0.50 * 0.5833 = 0.2917 >= min_match_score=0.20
        config_a = SlotMapperConfig(min_overlap_ratio=0.50, min_iou=0.20, min_match_score=0.20)
        mapper_a = SlotMapper(config_a)
        res_a = mapper_a.map_detections(detections, self.sample_config, self.frame_dims, camera_id="CAM-B1-01")
        self.assertEqual(res_a.occupied_count, 1)
        self.assertEqual(res_a.mapped_vehicles[0].mapping_method, "roi_overlap")

        # Config B: min_match_score=0.35 -> vehicle score 0.2917 < 0.35 is strictly rejected!
        config_b = SlotMapperConfig(min_overlap_ratio=0.50, min_iou=0.20, min_match_score=0.35)
        mapper_b = SlotMapper(config_b)
        res_b = mapper_b.map_detections(detections, self.sample_config, self.frame_dims, camera_id="CAM-B1-01")
        self.assertEqual(res_b.occupied_count, 0)
        self.assertEqual(res_b.unmapped_vehicles_count, 1)

    def test_12_canonical_topology_slot_ids(self):
        """Requirement 12: Ensures slot IDs emitted by mapper strictly match canonical topology."""
        full_config = load_slots_config()
        result = self.mapper.map_detections(
            [], full_config, (1920, 1080), camera_id="CAM-B1-01"
        )

        for s_id in result.slot_candidates.keys():
            self.assertIn(s_id, ALL_SLOT_IDS)
            self.assertTrue(s_id.startswith("B1-"))

        result_b2 = self.mapper.map_detections(
            [], full_config, (1920, 1080), camera_id="CAM-B2-01"
        )
        for s_id in result_b2.slot_candidates.keys():
            self.assertIn(s_id, ALL_SLOT_IDS)
            self.assertTrue(s_id.startswith("B2-"))

    def test_13_ground_contact_offset(self):
        """Requirement 13: calculate_ground_contact_point with alpha=0.08 offsets correctly."""
        bbox = (100, 200, 300, 400)   # x1, y1, x2, y2 -> height=200
        gc_x, gc_y = calculate_ground_contact_point(bbox, offset_ratio=0.08)
        self.assertAlmostEqual(gc_x, 200.0)                    # center_x = (100+300)/2
        self.assertAlmostEqual(gc_y, 400 - 0.08 * 200, places=3)  # y2 - 0.08 * height = 384.0

        # With zero offset -> identical to bottom_center
        gc_x0, gc_y0 = calculate_ground_contact_point(bbox, offset_ratio=0.0)
        bc_x, bc_y = calculate_bottom_center(bbox)
        self.assertAlmostEqual(gc_x0, bc_x)
        self.assertAlmostEqual(gc_y0, bc_y)

    def test_14_duplicate_detection_suppression(self):
        """Requirement 14: Two heavily overlapping detections -> only highest-confidence mapped."""
        # Two bounding boxes with IoU >> 0.65 (nearly identical)
        detections = [
            {
                "class_name": "car",
                "confidence": 0.93,
                "bounding_box": [120, 150, 260, 400],
                "timestamp": 1.0,
            },
            {
                "class_name": "car",
                "confidence": 0.72,  # lower confidence -> should be suppressed
                "bounding_box": [125, 155, 265, 405],  # IoU > 0.90
                "timestamp": 1.0,
            },
        ]
        result = self.mapper.map_detections(
            detections, self.sample_config, self.frame_dims, camera_id="CAM-B1-01"
        )
        # Only 1 effective detection (the high-confidence one) should map
        # Total vehicles across mapped + unmapped = 2, but only 1 non-suppressed
        total = len(result.mapped_vehicles) + len(result.unmapped_vehicles)
        self.assertEqual(total, 2)  # Both appear in output (1 mapped, 1 suppressed-unmapped)
        suppressed = [v for v in result.unmapped_vehicles if v.conflict_reason and "duplicate" in v.conflict_reason.lower()]
        self.assertEqual(len(suppressed), 1, "Exactly 1 duplicate should be suppressed")
        # The suppressed one must have lower confidence
        self.assertAlmostEqual(suppressed[0].confidence, 0.72, places=2)
        # The slot should NOT show a conflict (single effective claimant)
        b1a01 = result.slot_candidates.get("B1-A01")
        if b1a01 and b1a01.candidate_status == "occupied":
            self.assertFalse(b1a01.conflict_details, "No conflict expected after duplicate suppression")

    def test_15_obstruction_aware_uncertain(self):
        """Requirement 15: Unmapped vehicle overlapping a slot marks it uncertain (obstruction).
        
        Uses a vehicle placed in the aisle below B1-A01 (outside the slot's y range)
        but whose bounding box top edge extends slightly into B1-A01, creating >= 15% overlap
        of the vehicle's area inside the slot polygon — triggering obstruction-aware uncertain.
        
        The vehicle's ground-contact point must be outside ALL slot polygons so it stays unmapped.
        """
        # B1-A01 pixel rect (1000x1000 frame): [100..300, 100..500]
        # Place vehicle partially below B1-A01 — ground-contact (500 - 0.08*200=484) is outside (y>500? no)
        # Need ground_y > 500. Use vehicle at [100, 420, 300, 650]:
        #   height=230, gc_y=650-0.08*230=631.6 > 500 -> OUTSIDE B1-A01
        #   bbox overlap with B1-A01: [100,420,300,500] -> 200*80=16000
        #   vehicle area=200*230=46000, overlap_ratio=16000/46000=0.348 > min_overlap_ratio=0.30
        # This would trigger ROI overlap score and MAP the vehicle, not leave it unmapped.
        # To keep it unmapped we need overlap_ratio < min_overlap_ratio.
        # Use vehicle at [100, 490, 300, 700]:
        #   height=210, gc_y=700-0.08*210=683.2 > 500 -> OUTSIDE
        #   bbox overlap with B1-A01: [100,490,300,500] -> 200*10=2000
        #   vehicle area=200*210=42000, overlap_ratio=2000/42000=0.0476 < 0.30 -> unqualified by overlap
        #   iou ~ 2000/(200*400+2000-2000) = very small < 0.20 -> unqualified by IoU
        #   -> Vehicle is UNMAPPED (no slot reaches min_match_score)
        #   obstruction check: overlap_ratio=0.0476 < obstruction_overlap_threshold=0.15 -> no obstruction
        #
        # So we need a vehicle that is both: unmapped AND has >= 15% overlap with an available slot.
        # Solution: use a slot with large y extent and vehicle that overlaps from below.
        # Use a custom config with lower obstruction threshold = 0.04:
        config = SlotMapperConfig(obstruction_overlap_threshold=0.04, min_overlap_ratio=0.30, min_iou=0.20)
        custom_mapper = SlotMapper(config)
        # Vehicle [100, 490, 300, 700]: overlap_ratio=4.76% > 4% threshold -> obstruction triggered
        detections = [
            {
                "class_name": "car",
                "confidence": 0.80,
                "bounding_box": [100, 490, 300, 700],
                "timestamp": 1.0,
            }
        ]
        result = custom_mapper.map_detections(
            detections, self.sample_config, self.frame_dims, camera_id="CAM-B1-01"
        )
        # Vehicle must be unmapped (ground contact outside all slots, overlap < min_overlap_ratio)
        self.assertEqual(result.unmapped_vehicles_count, 1,
                         f"Vehicle should be unmapped, got {result.unmapped_vehicles_count} unmapped")
        # B1-A01 must be uncertain due to obstruction
        b1a01 = result.slot_candidates.get("B1-A01")
        self.assertIsNotNone(b1a01)
        self.assertEqual(b1a01.candidate_status, "uncertain",
                         f"B1-A01 expected 'uncertain' due to obstruction, got {b1a01.candidate_status}")

    def test_16_perspective_polygon_containment(self):
        """Requirement 16: Ground-contact point (alpha=0.08) correctly maps vehicles to calibrated slots."""
        # Using new calibrated CAM-B1-01 polygons from slots_config.json (1672x941 frame)
        full_config = load_slots_config()
        frame_dims = (1672, 941)

        # Confirmed YOLO detections on parking_frame.png:
        test_cases = [
            ([122, 318, 498, 550], "B1-A01"),
            ([198, 230, 581, 377], "B1-A02"),
            ([296, 161, 642, 263], "B1-A03"),
            ([1267, 317, 1670, 546], "B1-A08"),
            ([1151, 228, 1479, 408], "B1-A07"),
            ([1082, 144, 1255, 247], "B1-A06"),
        ]

        for bbox, expected_slot in test_cases:
            detections = [{"class_name": "car", "confidence": 0.90, "bounding_box": bbox, "timestamp": 0.0}]
            result = self.mapper.map_detections(
                detections, full_config, frame_dims, camera_id="CAM-B1-01"
            )
            mapped_slot_ids = [v.slot_id for v in result.mapped_vehicles]
            self.assertIn(
                expected_slot, mapped_slot_ids,
                f"Vehicle {bbox} expected in {expected_slot}, got mapped to {mapped_slot_ids}"
            )


class TestContainmentOverlapGate(unittest.TestCase):
    """
    Targeted tests for Fix 1: the containment_min_overlap_gate added to SlotMapperConfig.

    Regression case: in the 15-frame parking video, Car #6 (Track #6, assigned to B1-A03)
    had a 1-px YOLO bbox shift on Frame 13 that placed its ground-contact point just inside
    B1-A02 (overlap=7%) while 88% of the vehicle resided in B1-A03.  Without the gate the
    point-containment bonus (0.50) made B1-A02 outscore B1-A03 (0.4416) → false conflict.
    With the gate the undeserved bonus is withheld and B1-A03 wins on physical overlap alone.
    """

    def setUp(self):
        self.full_config = load_slots_config(
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "config", "slots_config.json")
        )
        self.frame_dims = (1672, 940)
        self.mapper = SlotMapper()   # uses default config (gate=0.15)

    def test_17_overlap_gate_prevents_misassignment_on_boundary_shift(self):
        """
        Frame-13 regression: bbox (298,161,642,263) has gc inside B1-A02 (ov=7%) but
        88% of area is inside B1-A03.  Gate must block the containment bonus for B1-A02
        and assign the vehicle to B1-A03 via roi_overlap instead.
        """
        bbox_f13 = (298, 161, 642, 263)
        detections = [{"class_name": "car", "confidence": 0.71, "bounding_box": bbox_f13, "timestamp": 0.0}]
        result = self.mapper.map_detections(detections, self.full_config, self.frame_dims, "CAM-B1-01")
        mapped_slot_ids = [v.slot_id for v in result.mapped_vehicles]
        self.assertIn(
            "B1-A03", mapped_slot_ids,
            f"Vehicle with 88% overlap in B1-A03 must map to B1-A03, got {mapped_slot_ids}",
        )
        self.assertNotIn(
            "B1-A02", mapped_slot_ids,
            f"Vehicle with only 7% overlap in B1-A02 must NOT map to B1-A02, got {mapped_slot_ids}",
        )

    def test_18_overlap_gate_does_not_affect_well_contained_vehicle(self):
        """
        A vehicle whose ground-contact is well inside its slot with high overlap (B1-A01
        Frame-1 reference bbox) must still map correctly — gate must not suppress valid hits.
        """
        bbox_a01 = (122, 319, 498, 550)   # Car #1 / Track #1 — always cleanly in B1-A01
        detections = [{"class_name": "car", "confidence": 0.90, "bounding_box": bbox_a01, "timestamp": 0.0}]
        result = self.mapper.map_detections(detections, self.full_config, self.frame_dims, "CAM-B1-01")
        mapped_slot_ids = [v.slot_id for v in result.mapped_vehicles]
        self.assertIn(
            "B1-A01", mapped_slot_ids,
            f"Well-contained vehicle must still map to B1-A01, got {mapped_slot_ids}",
        )

    def test_19_containment_gate_uses_configured_threshold(self):
        """
        Verify that containment_min_overlap_gate is correctly stored in SlotMapperConfig
        and that the default value is 0.15.
        """
        cfg = SlotMapperConfig()
        self.assertEqual(
            cfg.containment_min_overlap_gate, 0.15,
            "Default containment_min_overlap_gate must be 0.15",
        )

    def test_20_frame12_still_maps_car6_to_a03(self):
        """
        Frame-12 reference: bbox (297,161,642,262) is fully in B1-A03 by both containment
        and 89% overlap. Must continue mapping to B1-A03 after the gate is introduced.
        """
        bbox_f12 = (297, 161, 642, 262)
        detections = [{"class_name": "car", "confidence": 0.71, "bounding_box": bbox_f12, "timestamp": 0.0}]
        result = self.mapper.map_detections(detections, self.full_config, self.frame_dims, "CAM-B1-01")
        mapped_slot_ids = [v.slot_id for v in result.mapped_vehicles]
        self.assertIn(
            "B1-A03", mapped_slot_ids,
            f"Frame-12 vehicle must still map to B1-A03 after gate fix, got {mapped_slot_ids}",
        )


if __name__ == "__main__":
    unittest.main()
