"""
Automated Test Suite for Python-to-Node.js HTTP Integration (Prompt 4 Final Contract)
Verifies:
1. Exact updates[] request structure (cameraId, timestamp, updates; no slots, no status, no vehicleType).
2. Correct confirmedStatus values ('occupied', 'available').
3. Correct monitoring flags (isMonitored=True).
4. Actual occupied and available frame counters from CV pipeline.
5. Exclusion of uncertain and unmonitored slots.
6. CAM-B1-02 suppression while calibration is pending.
7. Successful acknowledgment (updated and unchanged purge pending updates).
8. Partial success and rejected updates (updated acknowledged, protected cleared, rejected retried).
9. HTTP errors, connection failures and timeouts.
10. Retry and duplicate suppression.
11. Offline mode preservation (enable_http_sync=False).
12. Existing occupancy adapter compatibility.
"""

import os
import sys
import json
import unittest
from unittest import mock

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from config.settings import DEFAULT_BACKEND_URL
from detection.occupancy_stabilizer import SlotTemporalState
from services.occupancy_adapter import OccupancyAdapter
from services.api_client import (
    BackendApiClient,
    DispatchResult,
    PendingSlotUpdate,
)
from pipeline import CVPipeline


def _make_slot_state(
    slot_id: str = "B1-A01",
    floor: str = "B1",
    camera_id: str = "CAM-B1-01",
    confirmed_status: str = "available",
    vehicle_class: str = None,
    confidence: float = 0.95,
    is_monitored: bool = True,
    consecutive_occupied_frames: int = 0,
    consecutive_available_frames: int = 0,
) -> SlotTemporalState:
    """Helper creating a SlotTemporalState with genuine stabilization counters."""
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


class TestBackendApiClient(unittest.TestCase):
    """Test suite for BackendApiClient aligned with Person B's final backend contract."""

    def setUp(self):
        self.adapter = OccupancyAdapter(camera_id="CAM-B1-01")
        self.recorded_requests = []

    def _create_mock_transport(self, response_generator):
        """Creates an injectable transport that records outgoing payloads."""
        def transport(payload):
            self.recorded_requests.append(payload)
            return response_generator(payload)
        return transport

    def test_01_exact_updates_request_structure(self):
        """Dispatches exact JSON request body structure: cameraId, timestamp, updates[]. No slots[], no status, no vehicleType."""
        def mock_resp(payload):
            return 200, {
                "success": True,
                "statusCode": 200,
                "message": "CV occupancy update processed",
                "summary": {"totalReceived": 1, "updated": 1, "unchanged": 0, "protected": 0, "rejected": 0},
                "results": [{"slotId": "B1-A01", "status": "updated", "currentStatus": "occupied"}],
            }

        client = BackendApiClient(
            backend_url="http://localhost:5000/api/slots/cv-update",
            custom_transport=self._create_mock_transport(mock_resp),
        )

        states = {
            "B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied", vehicle_class="car")
        }

        result = client.sync_occupancy(self.adapter, states, timestamp=1700000000.0)

        self.assertIsNotNone(result)
        self.assertTrue(result.success)
        self.assertEqual(len(self.recorded_requests), 1)

        sent = self.recorded_requests[0]
        # Top-level checks
        self.assertEqual(sent["cameraId"], "CAM-B1-01")
        self.assertIn("timestamp", sent)
        self.assertIn("updates", sent)
        self.assertNotIn("slots", sent, "Field 'slots' must NOT be sent")

        # Updates array checks
        self.assertIsInstance(sent["updates"], list)
        self.assertEqual(len(sent["updates"]), 1)

        update_item = sent["updates"][0]
        self.assertEqual(update_item["slotId"], "B1-A01")
        self.assertEqual(update_item["confirmedStatus"], "occupied")
        self.assertTrue(update_item["isMonitored"])
        self.assertEqual(update_item["consecutiveOccupiedFrames"], 3)
        self.assertEqual(update_item["consecutiveAvailableFrames"], 0)

        # Ensure obsolete/unconfirmed fields are strictly absent
        self.assertNotIn("status", update_item, "Obsolete field 'status' must NOT be sent")
        self.assertNotIn("vehicleType", update_item, "Field 'vehicleType' must NOT be sent")
        self.assertNotIn("confidence", update_item, "Unconfirmed field 'confidence' must NOT be sent")

    def test_02_correct_confirmed_status_values(self):
        """Validates that confirmedStatus values are strictly 'occupied' and 'available'."""
        def mock_resp(payload):
            return 200, {
                "success": True,
                "summary": {"totalReceived": 2, "updated": 2, "unchanged": 0, "protected": 0, "rejected": 0},
                "results": [
                    {"slotId": "B1-A01", "status": "updated", "currentStatus": "occupied"},
                    {"slotId": "B1-A02", "status": "updated", "currentStatus": "available"},
                ],
            }

        client = BackendApiClient(custom_transport=self._create_mock_transport(mock_resp))
        states = {
            "B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied"),
            "B1-A02": _make_slot_state("B1-A02", confirmed_status="available"),
        }

        result = client.sync_occupancy(self.adapter, states)
        self.assertTrue(result.success)
        self.assertEqual(len(self.recorded_requests), 1)

        items_by_id = {u["slotId"]: u for u in self.recorded_requests[0]["updates"]}
        self.assertEqual(items_by_id["B1-A01"]["confirmedStatus"], "occupied")
        self.assertEqual(items_by_id["B1-A02"]["confirmedStatus"], "available")

    def test_03_correct_monitoring_flags(self):
        """Ensures isMonitored is explicitly set to True for operational slots."""
        def mock_resp(payload):
            return 200, {"success": True, "results": [{"slotId": "B1-A01", "status": "updated"}]}

        client = BackendApiClient(custom_transport=self._create_mock_transport(mock_resp))
        states = {
            "B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied", is_monitored=True),
        }

        result = client.sync_occupancy(self.adapter, states)
        self.assertTrue(result.success)
        update_item = self.recorded_requests[0]["updates"][0]
        self.assertIs(update_item["isMonitored"], True)

    def test_04_actual_occupied_and_available_frame_counters(self):
        """Ensures consecutiveOccupiedFrames and consecutiveAvailableFrames reflect actual CV stabilization counters."""
        def mock_resp(payload):
            return 200, {"success": True, "results": [{"slotId": "B1-A01", "status": "updated"}, {"slotId": "B1-A02", "status": "updated"}]}

        client = BackendApiClient(custom_transport=self._create_mock_transport(mock_resp))
        states = {
            "B1-A01": _make_slot_state(
                "B1-A01",
                confirmed_status="occupied",
                consecutive_occupied_frames=7,
                consecutive_available_frames=0,
            ),
            "B1-A02": _make_slot_state(
                "B1-A02",
                confirmed_status="available",
                consecutive_occupied_frames=0,
                consecutive_available_frames=9,
            ),
        }

        result = client.sync_occupancy(self.adapter, states)
        self.assertTrue(result.success)

        items = {u["slotId"]: u for u in self.recorded_requests[0]["updates"]}
        self.assertEqual(items["B1-A01"]["consecutiveOccupiedFrames"], 7)
        self.assertEqual(items["B1-A01"]["consecutiveAvailableFrames"], 0)
        self.assertEqual(items["B1-A02"]["consecutiveOccupiedFrames"], 0)
        self.assertEqual(items["B1-A02"]["consecutiveAvailableFrames"], 9)

    def test_05_exclusion_of_uncertain_and_unmonitored_slots(self):
        """Uncertain, unmonitored and not_monitored slots are strictly excluded from updates[]."""
        def mock_resp(payload):
            return 200, {"success": True, "results": [{"slotId": "B1-A01", "status": "updated"}]}

        client = BackendApiClient(custom_transport=self._create_mock_transport(mock_resp))
        states = {
            "B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied"),
            "B1-A02": _make_slot_state("B1-A02", confirmed_status="uncertain"),
            "B1-A03": _make_slot_state("B1-A03", confirmed_status="not_monitored"),
            "B1-A04": _make_slot_state("B1-A04", confirmed_status="available", is_monitored=False),
        }

        result = client.sync_occupancy(self.adapter, states)
        self.assertTrue(result.success)
        sent_slot_ids = [u["slotId"] for u in self.recorded_requests[0]["updates"]]

        self.assertEqual(sent_slot_ids, ["B1-A01"], "Only confirmed operational slot B1-A01 must be transmitted")
        self.assertNotIn("B1-A02", sent_slot_ids)
        self.assertNotIn("B1-A03", sent_slot_ids)
        self.assertNotIn("B1-A04", sent_slot_ids)

    def test_06_cam_b1_02_calibration_suppression(self):
        """Camera CAM-B1-02 (needs_calibration=true) is completely suppressed from operational updates."""
        adapter_uncalibrated = OccupancyAdapter(camera_id="CAM-B1-02")
        client = BackendApiClient()

        states = {
            "B1-A09": _make_slot_state("B1-A09", floor="B1", camera_id="CAM-B1-02", confirmed_status="available")
        }

        result = client.sync_occupancy(adapter_uncalibrated, states)
        self.assertIsNone(result, "CAM-B1-02 must return None without transmitting network requests")

        # Direct payload sending check returns 422
        direct_result = client.send_payload({
            "cameraId": "CAM-B1-02",
            "needsCalibration": True,
            "updates": [{"slotId": "B1-A09", "confirmedStatus": "available", "isMonitored": True}],
        })
        self.assertFalse(direct_result.success)
        self.assertEqual(direct_result.status_code, 422)

    def test_07_successful_backend_acknowledgment(self):
        """Updates confirmed as 'updated' or 'unchanged' by backend are cleared from pending updates."""
        def mock_resp(payload):
            return 200, {
                "success": True,
                "summary": {"totalReceived": 2, "updated": 1, "unchanged": 1, "protected": 0, "rejected": 0},
                "results": [
                    {"slotId": "B1-A01", "status": "updated", "currentStatus": "occupied"},
                    {"slotId": "B1-A02", "status": "unchanged", "currentStatus": "available"},
                ],
            }

        client = BackendApiClient(custom_transport=self._create_mock_transport(mock_resp))
        states = {
            "B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied"),
            "B1-A02": _make_slot_state("B1-A02", confirmed_status="available"),
        }

        result = client.sync_occupancy(self.adapter, states)

        self.assertTrue(result.success)
        self.assertIn("B1-A01", result.slots_updated)
        self.assertIn("B1-A02", result.slots_unchanged)
        self.assertEqual(client.acknowledged_status["B1-A01"], "occupied")
        self.assertEqual(client.acknowledged_status["B1-A02"], "available")
        self.assertEqual(len(client.pending_updates), 0, "Acknowledged slots must be purged from pending queue")

    def test_08_partial_success_and_rejected_updates(self):
        """Handles mix of updated, protected (reserved/maintenance), and rejected slots."""
        def mock_resp(payload):
            return 200, {
                "success": True,
                "summary": {"totalReceived": 3, "updated": 1, "unchanged": 0, "protected": 1, "rejected": 1},
                "results": [
                    {"slotId": "B1-A01", "status": "updated", "currentStatus": "occupied"},
                    {"slotId": "B1-A05", "status": "protected", "currentStatus": "reserved", "reason": "Slot is reserved"},
                    {"slotId": "B1-A03", "status": "rejected", "reason": "Stale update rejected"},
                ],
            }

        client = BackendApiClient(custom_transport=self._create_mock_transport(mock_resp))
        states = {
            "B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied"),
            "B1-A05": _make_slot_state("B1-A05", confirmed_status="available"),
            "B1-A03": _make_slot_state("B1-A03", confirmed_status="occupied"),
        }

        result = client.sync_occupancy(self.adapter, states)

        self.assertTrue(result.success)
        self.assertIn("B1-A01", result.slots_updated)
        self.assertIn("B1-A05", result.slots_protected)
        self.assertIn("B1-A03", result.slots_failed)

        # B1-A01 acknowledged
        self.assertEqual(client.acknowledged_status.get("B1-A01"), "occupied")
        # B1-A05 dropped from pending because it is protected
        self.assertNotIn("B1-A05", client.pending_updates)
        # B1-A03 retained in pending for retry
        self.assertIn("B1-A03", client.pending_updates)

    def test_09_http_errors_connection_failures_and_timeouts(self):
        """Verifies handling of HTTP 400, 500, connection drops (0), and timeouts without marking updates delivered."""
        # 1. HTTP 400 Bad Request
        client_400 = BackendApiClient(custom_transport=lambda p: (400, {"success": False, "message": "Bad Request"}))
        states = {"B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied")}
        r_400 = client_400.sync_occupancy(self.adapter, states)
        self.assertFalse(r_400.success)
        self.assertEqual(r_400.status_code, 400)
        self.assertNotIn("B1-A01", client_400.acknowledged_status)
        self.assertIn("B1-A01", client_400.pending_updates)

        # 2. HTTP 500 Internal Error
        client_500 = BackendApiClient(custom_transport=lambda p: (500, {"success": False, "message": "Internal Server Error"}))
        r_500 = client_500.sync_occupancy(self.adapter, states)
        self.assertFalse(r_500.success)
        self.assertEqual(r_500.status_code, 500)
        self.assertNotIn("B1-A01", client_500.acknowledged_status)

        # 3. Connection failure (status_code 0)
        client_conn = BackendApiClient(custom_transport=lambda p: (0, {"success": False, "message": "Connection refused"}))
        r_conn = client_conn.sync_occupancy(self.adapter, states)
        self.assertFalse(r_conn.success)
        self.assertEqual(r_conn.status_code, 0)
        self.assertEqual(client_conn.pending_updates["B1-A01"].attempts, 1)

        # 4. Request timeout
        client_timeout = BackendApiClient(custom_transport=lambda p: (0, {"success": False, "message": "Request timed out"}))
        r_timeout = client_timeout.sync_occupancy(self.adapter, states)
        self.assertFalse(r_timeout.success)
        self.assertIn("timed out", r_timeout.message)

    def test_10_retry_and_duplicate_suppression(self):
        """Failed updates are retried up to max_retries before quarantine; acknowledged states are suppressed."""
        call_count = 0

        def failing_resp(payload):
            nonlocal call_count
            call_count += 1
            return 0, {"success": False, "message": "Network error"}

        client = BackendApiClient(max_retries=3, custom_transport=self._create_mock_transport(failing_resp))
        states = {"B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied")}

        # Attempt 1: Fails
        r1 = client.sync_occupancy(self.adapter, states)
        self.assertFalse(r1.success)
        self.assertEqual(client.pending_updates["B1-A01"].attempts, 1)

        # Attempt 2: Fails
        r2 = client.sync_occupancy(self.adapter, states)
        self.assertFalse(r2.success)
        self.assertEqual(client.pending_updates["B1-A01"].attempts, 2)

        # Attempt 3: Fails -> quarantined
        r3 = client.sync_occupancy(self.adapter, states)
        self.assertFalse(r3.success)
        self.assertIn("B1-A01", client.quarantined_slots)
        self.assertNotIn("B1-A01", client.pending_updates)

        # Duplicate suppression check with successful client
        def success_resp(payload):
            return 200, {
                "success": True,
                "results": [{"slotId": "B1-A01", "status": "updated", "currentStatus": "occupied"}],
            }
        succ_client = BackendApiClient(custom_transport=self._create_mock_transport(success_resp))
        self.recorded_requests.clear()

        # Cycle 1: Dispatches
        succ_client.sync_occupancy(self.adapter, states)
        self.assertEqual(len(self.recorded_requests), 1)

        # Cycle 2: Same state -> Suppressed (None returned)
        sup_result = succ_client.sync_occupancy(self.adapter, states)
        self.assertIsNone(sup_result, "Unchanged state must be suppressed")
        self.assertEqual(len(self.recorded_requests), 1, "No extra HTTP requests should be sent")

    def test_11_offline_mode(self):
        """Pipeline runs completely offline when enable_http_sync is False (default)."""
        pipeline = CVPipeline(
            camera_id="CAM-B1-01",
            enable_http_sync=False,
            allow_mock=True,
        )

        self.assertFalse(pipeline.enable_http_sync)
        self.assertIsNone(pipeline.api_client)

        dummy_frame = mock.MagicMock()
        dummy_frame.shape = (720, 1280, 3)

        record, _ = pipeline.process_frame(dummy_frame, frame_number=1, custom_detections=[])
        self.assertIsNone(record.get("http_sync"))
        self.assertIn("backend_payload", record)
        self.assertIn("backend_request", record)
        self.assertIn("updates", record["backend_request"])

    def test_12_existing_occupancy_adapter_compatibility(self):
        """OccupancyAdapter maintains backward compatibility: build_slot_record, build_update_record, snapshots."""
        state = _make_slot_state("B1-A01", confirmed_status="occupied", vehicle_class="car")

        # 1. build_update_record conforms to final Person B contract
        upd = self.adapter.build_update_record("B1-A01", state)
        self.assertIsNotNone(upd)
        self.assertEqual(upd["slotId"], "B1-A01")
        self.assertEqual(upd["confirmedStatus"], "occupied")
        self.assertTrue(upd["isMonitored"])
        self.assertEqual(upd["consecutiveOccupiedFrames"], 3)
        self.assertEqual(upd["consecutiveAvailableFrames"], 0)
        self.assertNotIn("status", upd)
        self.assertNotIn("vehicleType", upd)

        # 2. build_slot_record preserved for backward compatibility
        rec = self.adapter.build_slot_record("B1-A01", state)
        self.assertIsNotNone(rec)
        self.assertEqual(rec["slotId"], "B1-A01")
        self.assertEqual(rec["status"], "occupied")
        self.assertEqual(rec["vehicleType"], "car")

        # 3. build_backend_payload produces exact contract
        payload = self.adapter.build_backend_payload({"B1-A01": state})
        self.assertEqual(payload["cameraId"], "CAM-B1-01")
        self.assertIn("updates", payload)
        self.assertNotIn("slots", payload)
        self.assertEqual(payload["updates"][0]["slotId"], "B1-A01")


if __name__ == "__main__":
    unittest.main()
