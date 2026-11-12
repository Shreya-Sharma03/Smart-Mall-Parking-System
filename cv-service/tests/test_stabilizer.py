"""
Unit Tests for Occupancy Stabilizer (Milestone 5)
Tests temporal occupancy confirmation rules:
- 3 consecutive frames to confirm occupied.
- 5 consecutive frames to confirm available.
- Temporary detection loss does not prematurely vacate an occupied slot.
- Ambiguous / conflict mappings produce uncertain results rather than available.
- Reserved and maintenance states are preserved against camera overrides.
- Single vehicle cannot occupy multiple slots simultaneously.
"""

import sys
import os
import unittest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from detection.slot_mapper import (
    SlotMapper,
    FrameMappingResult,
    SlotOccupancyCandidate,
    MappedVehicle,
)
from detection.occupancy_stabilizer import OccupancyStabilizer, StabilizerConfig


def _make_dummy_result(
    camera_id: str = "CAM-B1-01",
    floor: str = "B1",
    slot_id: str = "B1-A01",
    status: str = "available_candidate",
    is_conflict: bool = False,
    mapped_vehicle: bool = False,
) -> FrameMappingResult:
    """Helper creating a minimal FrameMappingResult for testing."""
    mv_list = []
    if mapped_vehicle:
        mv_list.append(
            MappedVehicle(
                slot_id=slot_id,
                floor=floor,
                camera_id=camera_id,
                vehicle_class="car",
                confidence=0.90,
                bounding_box=(100, 200, 300, 400),
                bottom_center=(200.0, 380.0),
                mapping_method="hybrid",
                overlap_score=0.85,
                occupancy_candidate="uncertain" if is_conflict else "occupied",
                timestamp=0.0,
                is_conflict=is_conflict,
            )
        )

    cand = SlotOccupancyCandidate(
        slot_id=slot_id,
        floor=floor,
        camera_id=camera_id,
        candidate_status="uncertain" if is_conflict else status,
        mapped_vehicle=mv_list[0].to_dict() if mv_list else None,
        confidence=0.90 if mapped_vehicle else 1.0,
        conflict_details="Conflict details" if is_conflict else None,
    )

    return FrameMappingResult(
        camera_id=camera_id,
        floor=floor,
        timestamp=0.0,
        total_slots_monitored=1,
        occupied_count=1 if mapped_vehicle and not is_conflict else 0,
        available_candidate_count=1 if status == "available_candidate" and not is_conflict else 0,
        uncertain_count=1 if is_conflict else 0,
        unmapped_vehicles_count=0,
        slot_candidates={slot_id: cand},
        mapped_vehicles=mv_list,
        unmapped_vehicles=[],
    )


class TestOccupancyStabilizer(unittest.TestCase):
    """Test suite for Milestone 5 OccupancyStabilizer temporal confirmation rules."""

    def setUp(self):
        self.config = StabilizerConfig(
            occupied_threshold=3,
            available_threshold=5,
            uncertain_threshold=1,
        )
        self.stabilizer = OccupancyStabilizer(config=self.config)

    def test_01_occupied_requires_3_consecutive_frames(self):
        """A bay becomes 'occupied' only after a vehicle is consistently mapped across 3 consecutive frames."""
        # Frame 1: Vehicle detected -> 1/3 confirming (still available or confirming)
        res1 = _make_dummy_result(status="occupied", mapped_vehicle=True)
        states1 = self.stabilizer.update(res1)
        self.assertNotEqual(states1["B1-A01"].confirmed_status, "occupied",
                            "Must not immediately confirm occupied on frame 1")
        self.assertEqual(states1["B1-A01"].consecutive_occupied_frames, 1)
        self.assertIn("1/3 confirming", states1["B1-A01"].confirmation_progress)

        # Frame 2: Vehicle still mapped -> 2/3 confirming
        res2 = _make_dummy_result(status="occupied", mapped_vehicle=True)
        states2 = self.stabilizer.update(res2)
        self.assertNotEqual(states2["B1-A01"].confirmed_status, "occupied",
                            "Must not confirm occupied on frame 2 (requires 3)")
        self.assertEqual(states2["B1-A01"].consecutive_occupied_frames, 2)
        self.assertIn("2/3 confirming", states2["B1-A01"].confirmation_progress)

        # Frame 3: Vehicle still mapped -> 3/3 confirmed -> OCCUPIED!
        res3 = _make_dummy_result(status="occupied", mapped_vehicle=True)
        states3 = self.stabilizer.update(res3)
        self.assertEqual(states3["B1-A01"].confirmed_status, "occupied",
                         "Must be confirmed 'occupied' on 3rd consecutive frame")
        self.assertEqual(states3["B1-A01"].consecutive_occupied_frames, 3)
        self.assertIn("3/3 confirmed", states3["B1-A01"].confirmation_progress)

    def test_02_available_requires_5_consecutive_empty_frames(self):
        """A confirmed occupied bay becomes 'available' only after 5 consecutive empty frames."""
        # Establish confirmed occupied state (3 frames)
        for _ in range(3):
            self.stabilizer.update(_make_dummy_result(status="occupied", mapped_vehicle=True))
        self.assertEqual(self.stabilizer.slots_state["B1-A01"].confirmed_status, "occupied")

        # Empty frames 1 to 4: Slot MUST remain 'occupied' during grace period!
        for frame_idx in range(1, 5):
            empty_res = _make_dummy_result(status="available_candidate", mapped_vehicle=False)
            states = self.stabilizer.update(empty_res)
            self.assertEqual(
                states["B1-A01"].confirmed_status, "occupied",
                f"Slot must remain 'occupied' during empty frame {frame_idx}/5",
            )
            self.assertIn(f"{frame_idx}/5 vacating", states["B1-A01"].confirmation_progress)

        # Empty frame 5: 5 consecutive empty frames -> Confirmed 'available'!
        empty_res5 = _make_dummy_result(status="available_candidate", mapped_vehicle=False)
        states5 = self.stabilizer.update(empty_res5)
        self.assertEqual(
            states5["B1-A01"].confirmed_status, "available",
            "Slot must become 'available' only after 5 consecutive empty frames",
        )
        self.assertIn("5/5 confirmed", states5["B1-A01"].confirmation_progress)

    def test_03_temporary_detection_loss_does_not_vacate_slot(self):
        """A temporarily missed vehicle (e.g. 2 empty frames) does not make the slot available."""
        # Establish confirmed occupied
        for _ in range(3):
            self.stabilizer.update(_make_dummy_result(status="occupied", mapped_vehicle=True))
        self.assertEqual(self.stabilizer.slots_state["B1-A01"].confirmed_status, "occupied")

        # 2 frames missed detection (e.g. glare or occlusion)
        self.stabilizer.update(_make_dummy_result(status="available_candidate", mapped_vehicle=False))
        self.stabilizer.update(_make_dummy_result(status="available_candidate", mapped_vehicle=False))
        self.assertEqual(self.stabilizer.slots_state["B1-A01"].confirmed_status, "occupied")

        # Vehicle is detected again on 3rd frame
        states = self.stabilizer.update(_make_dummy_result(status="occupied", mapped_vehicle=True))
        self.assertEqual(states["B1-A01"].confirmed_status, "occupied")
        self.assertEqual(states["B1-A01"].consecutive_available_frames, 0)

    def test_04_ambiguous_or_conflict_marked_uncertain(self):
        """Ambiguous or conflicting mappings immediately reflect 'uncertain' rather than incorrect available."""
        res_conflict = _make_dummy_result(status="uncertain", is_conflict=True, mapped_vehicle=True)
        states = self.stabilizer.update(res_conflict)

        self.assertEqual(states["B1-A01"].confirmed_status, "uncertain")
        self.assertTrue(states["B1-A01"].is_conflict)
        self.assertIsNotNone(states["B1-A01"].conflict_details)

    def test_05_reserved_and_maintenance_preserved(self):
        """Slots marked as 'reserved' or 'maintenance' cannot be overwritten by camera detections."""
        stabilizer_with_overrides = OccupancyStabilizer(
            config=self.config,
            override_statuses={"B1-A01": "reserved", "B1-A02": "maintenance"},
        )

        # Send 10 consecutive frames of mapped vehicle to B1-A01
        for _ in range(10):
            res = _make_dummy_result(slot_id="B1-A01", status="occupied", mapped_vehicle=True)
            states = stabilizer_with_overrides.update(res)

        self.assertEqual(states["B1-A01"].confirmed_status, "reserved",
                         "Camera detection must NEVER overwrite 'reserved' status")

        # Send 10 empty frames to B1-A02
        for _ in range(10):
            res_maint = _make_dummy_result(slot_id="B1-A02", status="available_candidate", mapped_vehicle=False)
            states = stabilizer_with_overrides.update(res_maint)

        self.assertEqual(states["B1-A02"].confirmed_status, "maintenance",
                         "Camera detection must NEVER overwrite 'maintenance' status")

    def test_06_single_vehicle_cannot_occupy_multiple_slots(self):
        """If one vehicle is claimed by multiple slots, only the best match is assigned."""
        cand_a01 = SlotOccupancyCandidate(
            slot_id="B1-A01", floor="B1", camera_id="CAM-B1-01",
            candidate_status="occupied",
        )
        cand_a02 = SlotOccupancyCandidate(
            slot_id="B1-A02", floor="B1", camera_id="CAM-B1-01",
            candidate_status="occupied",
        )

        # Same physical vehicle (same track_id 1) claimed by both slots
        mv1 = MappedVehicle(
            slot_id="B1-A01", floor="B1", camera_id="CAM-B1-01",
            vehicle_class="car", confidence=0.90,
            bounding_box=(100, 200, 300, 400), bottom_center=(200.0, 380.0),
            mapping_method="hybrid", overlap_score=0.80,  # higher score
            occupancy_candidate="occupied", timestamp=0.0, track_id=1,
        )
        mv2 = MappedVehicle(
            slot_id="B1-A02", floor="B1", camera_id="CAM-B1-01",
            vehicle_class="car", confidence=0.90,
            bounding_box=(100, 200, 300, 400), bottom_center=(200.0, 380.0),
            mapping_method="hybrid", overlap_score=0.40,  # lower score
            occupancy_candidate="occupied", timestamp=0.0, track_id=1,
        )

        res = FrameMappingResult(
            camera_id="CAM-B1-01", floor="B1", timestamp=0.0,
            total_slots_monitored=2, occupied_count=2, available_candidate_count=0,
            uncertain_count=0, unmapped_vehicles_count=0,
            slot_candidates={"B1-A01": cand_a01, "B1-A02": cand_a02},
            mapped_vehicles=[mv1, mv2], unmapped_vehicles=[],
        )

        states = self.stabilizer.update(res)

        # B1-A01 wins track 1 (score 0.80 > 0.40); B1-A02 loses it and becomes available
        self.assertEqual(states["B1-A01"].consecutive_occupied_frames, 1)
        self.assertEqual(states["B1-A02"].consecutive_available_frames, 1)


class TestConflictGraceMechanism(unittest.TestCase):
    """
    Targeted tests for the conflict grace mechanism added to OccupancyStabilizer
    (Fix 2 — B1-A02 regression fix):

    Rule: a *confirmed-occupied* bay absorbs up to conflict_grace_frames consecutive
    transient conflict events without transitioning to 'uncertain'. An isolated
    1-frame glitch must not reset confirmation. Persistent conflicts still produce 'uncertain'.
    """

    def _make_occupied_result(self, slot_id="B1-A01"):
        return _make_dummy_result(
            slot_id=slot_id, status="occupied", mapped_vehicle=True, is_conflict=False
        )

    def _make_conflict_result(self, slot_id="B1-A01"):
        return _make_dummy_result(
            slot_id=slot_id, status="uncertain", mapped_vehicle=True, is_conflict=True
        )

    def test_07_single_conflict_does_not_reset_confirmed_occupied(self):
        """
        A confirmed-occupied slot (3/3) must NOT immediately become 'uncertain' on a
        single isolated conflict frame.  It should retain 'occupied' and show the
        transient-conflict progress badge.
        """
        cfg = StabilizerConfig(
            occupied_threshold=3,
            available_threshold=5,
            uncertain_threshold=1,
            conflict_grace_frames=2,
        )
        stab = OccupancyStabilizer(config=cfg)

        # Confirm occupied over 3 frames
        for _ in range(3):
            stab.update(self._make_occupied_result())

        self.assertEqual(stab.slots_state["B1-A01"].confirmed_status, "occupied")

        # Inject exactly 1 conflict frame
        states = stab.update(self._make_conflict_result())

        self.assertEqual(
            states["B1-A01"].confirmed_status,
            "occupied",
            "Single-frame conflict must NOT demote a confirmed-occupied bay to 'uncertain'",
        )
        self.assertEqual(states["B1-A01"].consecutive_conflict_frames, 1)
        self.assertIn("transient conflict", states["B1-A01"].confirmation_progress)

    def test_08_conflict_clears_after_clean_frame(self):
        """
        After a transient conflict is absorbed, a clean occupied frame must reset the
        conflict counter and restore the normal 'confirmed' progress badge.
        """
        cfg = StabilizerConfig(
            occupied_threshold=3,
            available_threshold=5,
            uncertain_threshold=1,
            conflict_grace_frames=2,
        )
        stab = OccupancyStabilizer(config=cfg)

        for _ in range(3):
            stab.update(self._make_occupied_result())

        # 1 conflict frame absorbed
        stab.update(self._make_conflict_result())

        # Clean occupied frame follows
        states = stab.update(self._make_occupied_result())

        self.assertEqual(states["B1-A01"].confirmed_status, "occupied")
        self.assertEqual(
            states["B1-A01"].consecutive_conflict_frames,
            0,
            "Conflict counter must reset to 0 after a clean occupied frame",
        )

    def test_09_persistent_conflict_produces_uncertain(self):
        """
        If conflict_grace_frames are exceeded (e.g. 3 consecutive conflict frames with
        conflict_grace_frames=2), the bay must finally transition to 'uncertain'.
        """
        cfg = StabilizerConfig(
            occupied_threshold=3,
            available_threshold=5,
            uncertain_threshold=1,
            conflict_grace_frames=2,
        )
        stab = OccupancyStabilizer(config=cfg)

        for _ in range(3):
            stab.update(self._make_occupied_result())

        # Push conflict_grace_frames + 1 consecutive conflict frames
        for i in range(cfg.conflict_grace_frames + 1):
            states = stab.update(self._make_conflict_result())

        self.assertEqual(
            states["B1-A01"].confirmed_status,
            "uncertain",
            "Persistent conflicts beyond grace window must produce 'uncertain'",
        )

    def test_10_unconfirmed_slot_still_becomes_uncertain_immediately(self):
        """
        A slot that is NOT yet confirmed occupied (< 3 frames) must still become
        'uncertain' immediately upon the first conflict frame — grace only applies
        to already-confirmed occupied bays.
        """
        cfg = StabilizerConfig(
            occupied_threshold=3,
            available_threshold=5,
            uncertain_threshold=1,
            conflict_grace_frames=2,
        )
        stab = OccupancyStabilizer(config=cfg)

        # Only 2 frames — not yet confirmed
        stab.update(self._make_occupied_result())
        stab.update(self._make_occupied_result())

        self.assertNotEqual(stab.slots_state["B1-A01"].confirmed_status, "occupied")

        # Inject a conflict — must immediately mark uncertain (no grace for unconfirmed bays)
        states = stab.update(self._make_conflict_result())

        self.assertEqual(
            states["B1-A01"].confirmed_status,
            "uncertain",
            "Unconfirmed bays must still become uncertain immediately on first conflict frame",
        )


if __name__ == "__main__":
    unittest.main()
