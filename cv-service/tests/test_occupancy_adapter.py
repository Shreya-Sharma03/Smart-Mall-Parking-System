"""
Focused Unit Tests for Occupancy Adapter (Prompt 2)
Verifies:
1. Confirmed occupied status produces an occupied update.
2. Confirmed available status produces an available update.
3. Uncertain status does not produce an operational occupancy update.
4. Not-monitored slots do not produce available updates.
5. Identical consecutive statuses do not produce duplicate transition events.
6. Available-to-occupied transition is detected.
7. Occupied-to-available transition is detected.
8. Different cameras maintain independent slot states.
9. Invalid slot IDs are rejected or safely excluded.
10. CAM-B1-02 needs_calibration suppresses operational updates.
11. Vehicle type normalization ('car' -> 'car', 'motorcycle' -> 'bike').
12. Camera topology validation checks all configured cameras.
"""

import os
import sys
import unittest
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from config.topology import ALL_SLOT_IDS
from detection.occupancy_stabilizer import SlotTemporalState
from services.occupancy_adapter import (
    OccupancyAdapter,
    normalize_vehicle_type,
    get_iso_timestamp,
)


def _make_slot_state(
    slot_id: str = "B1-A01",
    floor: str = "B1",
    camera_id: str = "CAM-B1-01",
    confirmed_status: str = "available",
    vehicle_class: str = None,
    confidence: float = 0.92,
    is_monitored: bool = True,
    consecutive_occupied_frames: int = 0,
    consecutive_available_frames: int = 0,
) -> SlotTemporalState:
    """Helper to generate a mock SlotTemporalState with valid stabilization thresholds."""
    if confirmed_status == "occupied" and consecutive_occupied_frames == 0:
        consecutive_occupied_frames = 3
    if confirmed_status == "available" and consecutive_available_frames == 0:
        consecutive_available_frames = 5
    return SlotTemporalState(
        slot_id=slot_id,
        floor=floor,
        camera_id=camera_id,
        confirmed_status=confirmed_status,
        raw_status="occupied" if confirmed_status == "occupied" else "available_candidate",
        vehicle_class=vehicle_class,
        confidence=confidence,
        is_monitored=is_monitored,
        consecutive_occupied_frames=consecutive_occupied_frames,
        consecutive_available_frames=consecutive_available_frames,
    )


class TestOccupancyAdapter(unittest.TestCase):
    """Test suite for OccupancyAdapter and backend-ready output normalization."""

    def setUp(self):
        self.adapter_b1 = OccupancyAdapter(camera_id="CAM-B1-01")
        self.adapter_b2 = OccupancyAdapter(camera_id="CAM-B2-01")

    def test_01_confirmed_occupied_produces_occupied_update(self):
        """Confirmed occupied bay produces an operational record with status 'occupied' and vehicleType."""
        state = _make_slot_state(
            slot_id="B1-A01",
            confirmed_status="occupied",
            vehicle_class="car",
            confidence=0.9412,
        )
        rec = self.adapter_b1.build_slot_record("B1-A01", state)

        self.assertIsNotNone(rec, "Occupied state must produce a valid record")
        self.assertEqual(rec["slotId"], "B1-A01")
        self.assertEqual(rec["status"], "occupied")
        self.assertEqual(rec["vehicleType"], "car")
        self.assertEqual(rec["confidence"], 0.9412)

    def test_02_confirmed_available_produces_available_update(self):
        """Confirmed available bay produces an operational record with status 'available' and no vehicleType."""
        state = _make_slot_state(
            slot_id="B1-A02",
            confirmed_status="available",
        )
        rec = self.adapter_b1.build_slot_record("B1-A02", state)

        self.assertIsNotNone(rec, "Available state must produce a valid record")
        self.assertEqual(rec["slotId"], "B1-A02")
        self.assertEqual(rec["status"], "available")
        self.assertNotIn("vehicleType", rec, "Available slot must not contain a vehicleType")

    def test_03_uncertain_status_does_not_produce_operational_update(self):
        """Uncertain status must NEVER produce an operational available/occupied record."""
        state = _make_slot_state(
            slot_id="B1-A03",
            confirmed_status="uncertain",
        )
        rec = self.adapter_b1.build_slot_record("B1-A03", state)
        self.assertIsNone(rec, "Uncertain status must not produce an operational record")

        # Snapshot should also exclude uncertain slots from operational slot array
        snapshot = self.adapter_b1.get_normalized_snapshot({"B1-A03": state})
        emitted_ids = [s["slotId"] for s in snapshot["slots"]]
        self.assertNotIn("B1-A03", emitted_ids, "Uncertain slots must be excluded from operational updates")

    def test_04_not_monitored_slots_do_not_produce_available_updates(self):
        """Unmonitored slots must NEVER be converted to available."""
        state = _make_slot_state(
            slot_id="B1-A04",
            confirmed_status="not_monitored",
            is_monitored=False,
        )
        rec = self.adapter_b1.build_slot_record("B1-A04", state)
        self.assertIsNone(rec, "not_monitored slots must not produce operational available updates")

    def test_05_identical_consecutive_statuses_do_not_produce_duplicate_transitions(self):
        """Consecutive identical statuses must NOT repeatedly fire transition events."""
        state = _make_slot_state(slot_id="B1-A01", confirmed_status="available")

        # Frame 1: Initial confirmation
        t1 = self.adapter_b1.detect_status_transitions({"B1-A01": state})
        self.assertIsNotNone(t1, "Initial confirmation should be reported")
        self.assertEqual(t1["transitionCount"], 1)

        # Frame 2: Identical status -> No transition
        t2 = self.adapter_b1.detect_status_transitions({"B1-A01": state})
        self.assertIsNone(t2, "Identical consecutive status must not generate a duplicate transition event")

        # Frame 3: Still identical -> No transition
        t3 = self.adapter_b1.detect_status_transitions({"B1-A01": state})
        self.assertIsNone(t3)

    def test_06_available_to_occupied_transition_is_detected(self):
        """Transition from available to occupied is correctly detected and recorded."""
        state_avail = _make_slot_state(slot_id="B1-A01", confirmed_status="available")
        self.adapter_b1.detect_status_transitions({"B1-A01": state_avail})

        # Vehicle arrives and stabilizes as occupied
        state_occ = _make_slot_state(
            slot_id="B1-A01",
            confirmed_status="occupied",
            vehicle_class="car",
        )
        t_event = self.adapter_b1.detect_status_transitions({"B1-A01": state_occ})

        self.assertIsNotNone(t_event, "available -> occupied transition must be detected")
        self.assertEqual(t_event["transitionCount"], 1)
        transition = t_event["transitions"][0]
        self.assertEqual(transition["slotId"], "B1-A01")
        self.assertEqual(transition["fromStatus"], "available")
        self.assertEqual(transition["toStatus"], "occupied")
        self.assertEqual(transition["vehicleType"], "car")

    def test_07_occupied_to_available_transition_is_detected(self):
        """Transition from occupied to available is correctly detected and recorded."""
        state_occ = _make_slot_state(
            slot_id="B1-A02",
            confirmed_status="occupied",
            vehicle_class="motorcycle",
        )
        self.adapter_b1.detect_status_transitions({"B1-A02": state_occ})

        # Vehicle departs and stabilizes as available
        state_avail = _make_slot_state(slot_id="B1-A02", confirmed_status="available")
        t_event = self.adapter_b1.detect_status_transitions({"B1-A02": state_avail})

        self.assertIsNotNone(t_event, "occupied -> available transition must be detected")
        self.assertEqual(t_event["transitionCount"], 1)
        transition = t_event["transitions"][0]
        self.assertEqual(transition["slotId"], "B1-A02")
        self.assertEqual(transition["fromStatus"], "occupied")
        self.assertEqual(transition["toStatus"], "available")

    def test_08_different_cameras_maintain_independent_slot_states(self):
        """CAM-B1-01 and CAM-B2-01 maintain separate transition histories without collision."""
        adapter_b1 = OccupancyAdapter(camera_id="CAM-B1-01")
        adapter_b2 = OccupancyAdapter(camera_id="CAM-B2-01")

        state_b1 = _make_slot_state(slot_id="B1-A01", floor="B1", camera_id="CAM-B1-01", confirmed_status="occupied", vehicle_class="car")
        state_b2 = _make_slot_state(slot_id="B2-A01", floor="B2", camera_id="CAM-B2-01", confirmed_status="available")

        # Emit on B1
        t_b1 = adapter_b1.detect_status_transitions({"B1-A01": state_b1})
        self.assertIn("B1-A01", adapter_b1.last_emitted_status)
        self.assertNotIn("B1-A01", adapter_b2.last_emitted_status)

        # Emit on B2
        t_b2 = adapter_b2.detect_status_transitions({"B2-A01": state_b2})
        self.assertIn("B2-A01", adapter_b2.last_emitted_status)
        self.assertNotIn("B2-A01", adapter_b1.last_emitted_status)

        # Ensure CAM-B1-01 rejects B2 slots
        invalid_on_b1 = adapter_b1.build_slot_record("B2-A01", state_b2)
        self.assertIsNone(invalid_on_b1, "CAM-B1-01 must reject B2 slots")

    def test_09_invalid_or_unassigned_slot_ids_are_safely_excluded(self):
        """Unknown or unassigned slot IDs are strictly excluded from output payloads."""
        state = _make_slot_state(slot_id="UNKNOWN-99", confirmed_status="occupied")
        rec = self.adapter_b1.build_slot_record("UNKNOWN-99", state)
        self.assertIsNone(rec, "Unknown slot ID must be rejected")

        # B1-A10 belongs to CAM-B1-02, not CAM-B1-01
        state_b1_10 = _make_slot_state(slot_id="B1-A10", confirmed_status="available")
        rec_unassigned = self.adapter_b1.build_slot_record("B1-A10", state_b1_10)
        self.assertIsNone(rec_unassigned, "CAM-B1-01 must reject slots assigned to CAM-B1-02")

    def test_10_cam_b1_02_needs_calibration_suppresses_operational_updates(self):
        """Camera CAM-B1-02 marked needs_calibration=true must NOT produce operational updates."""
        adapter_uncalibrated = OccupancyAdapter(camera_id="CAM-B1-02")
        self.assertTrue(adapter_uncalibrated.needs_calibration)

        state = _make_slot_state(slot_id="B1-A09", floor="B1", camera_id="CAM-B1-02", confirmed_status="available")
        rec = adapter_uncalibrated.build_slot_record("B1-A09", state)
        self.assertIsNone(rec, "Uncalibrated camera must return None for slot records")

        snapshot = adapter_uncalibrated.get_normalized_snapshot({"B1-A09": state})
        self.assertTrue(snapshot["needsCalibration"])
        self.assertEqual(len(snapshot["slots"]), 0, "Uncalibrated camera must produce 0 operational slots")

        transitions = adapter_uncalibrated.detect_status_transitions({"B1-A09": state})
        self.assertIsNone(transitions, "Uncalibrated camera must not emit transition events")

    def test_11_vehicle_type_normalization(self):
        """COCO classes are mapped correctly to backend schema ('car' -> 'car', 'motorcycle' -> 'bike')."""
        self.assertEqual(normalize_vehicle_type("car"), "car")
        self.assertEqual(normalize_vehicle_type("CAR"), "car")
        self.assertEqual(normalize_vehicle_type("motorcycle"), "bike")
        self.assertEqual(normalize_vehicle_type("bike"), "bike")
        self.assertIsNone(normalize_vehicle_type("truck"))
        self.assertIsNone(normalize_vehicle_type(None))

    def test_12_camera_topology_validation(self):
        """Validates all configured cameras across canonical topology."""
        report = OccupancyAdapter.validate_camera_topology()

        self.assertTrue(report["isValid"], f"Topology validation failed: {report['errors']}")
        self.assertEqual(report["totalConfiguredSlots"], 24)
        self.assertEqual(report["canonicalSlotsCovered"], 24)

        # Check CAM-B1-02 warning
        has_cal_warning = any("CAM-B1-02" in w for w in report["warnings"])
        self.assertTrue(has_cal_warning, "Report must flag CAM-B1-02 calibration warning")


if __name__ == "__main__":
    unittest.main()
