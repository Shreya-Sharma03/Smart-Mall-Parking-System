"""
Automated Test Suite for Python-to-Node.js HTTP Integration (Phase 1 Fixes)
Verifies:
1. Actual Express success response structure ({ success, message, cameraId, received, updated, skipped, timestamp }).
2. Successful slot updates acknowledgment.
3. Unchanged updates and duplicate suppression.
4. Skipped reserved slots handling (dropped from pending, no endless retries).
5. Skipped maintenance slots handling (dropped from pending, no endless retries).
6. Failed HTTP responses (400, 403, 500, status 0).
7. Malformed and non-JSON responses.
8. Initial available state with zero frames (rejected/excluded).
9. Available state at five consecutive frames (accepted at 5, rejected at < 5).
10. Occupied state at three consecutive frames (accepted at 3, rejected at < 3).
11. Repeated video timestamps (strictly increasing timestamps per camera).
12. Retry timestamp behaviour (reuse where appropriate, advance on stale 400).
13. Multiple requests from the same camera (monotonicity and future limit).
14. Existing functionality and regression tests (adapter compatibility, offline mode).
"""

import os
import sys
import json
import unittest
from datetime import datetime, timezone
from unittest import mock

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from config.settings import DEFAULT_BACKEND_URL
from detection.occupancy_stabilizer import SlotTemporalState
from services.occupancy_adapter import OccupancyAdapter, get_iso_timestamp
from services.api_client import (
    BackendApiClient,
    DispatchResult,
    PendingSlotUpdate,
    CameraTimestampTracker,
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
    """Helper creating a SlotTemporalState."""
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


class TestBackendApiClientPhase1(unittest.TestCase):
    """Test suite for BackendApiClient aligned with Person B's actual Express backend."""

    def setUp(self):
        self.adapter = OccupancyAdapter(camera_id="CAM-B1-01")
        self.recorded_requests = []

    def _create_mock_transport(self, response_generator):
        """Creates an injectable transport that records outgoing payloads."""
        def transport(payload):
            self.recorded_requests.append(payload)
            return response_generator(payload)
        return transport

    def test_01_actual_express_success_response_structure(self):
        """Correctly parses Person B's actual success response: { success, message, cameraId, received, updated, skipped, timestamp }."""
        def mock_resp(payload):
            return 200, {
                "success": True,
                "message": "CV updates processed successfully",
                "cameraId": "CAM-B1-01",
                "received": 1,
                "updated": 1,
                "skipped": [],
                "timestamp": "2026-11-15T01:30:00.123456Z"
            }

        client = BackendApiClient(
            backend_url="http://localhost:5000/api/slots/cv-update",
            custom_transport=self._create_mock_transport(mock_resp),
        )

        states = {
            "B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied", consecutive_occupied_frames=3)
        }

        result = client.sync_occupancy(self.adapter, states, timestamp=1700000000.0)

        self.assertIsNotNone(result)
        self.assertTrue(result.success)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.received, 1)
        self.assertEqual(result.updated, 1)
        self.assertEqual(result.slots_updated, ["B1-A01"])
        self.assertEqual(result.slots_protected, [])
        self.assertEqual(result.slots_failed, [])
        self.assertNotIn("B1-A01", client.pending_updates, "Acknowledged slot must be cleared from pending updates")

        # Verify outgoing request format
        sent = self.recorded_requests[0]
        self.assertEqual(sent["cameraId"], "CAM-B1-01")
        self.assertIn("timestamp", sent)
        self.assertIn("updates", sent)
        self.assertNotIn("slots", sent)
        self.assertEqual(sent["updates"][0]["slotId"], "B1-A01")
        self.assertEqual(sent["updates"][0]["confirmedStatus"], "occupied")
        self.assertEqual(sent["updates"][0]["consecutiveOccupiedFrames"], 3)
        self.assertEqual(sent["updates"][0]["consecutiveAvailableFrames"], 0)

    def test_02_successful_slot_updates(self):
        """Acknowledges multiple successful slot updates in a batch."""
        def mock_resp(payload):
            return 200, {
                "success": True,
                "message": "CV updates processed successfully",
                "cameraId": "CAM-B1-01",
                "received": 2,
                "updated": 2,
                "skipped": [],
                "timestamp": "2026-11-15T01:30:00.123456Z"
            }

        client = BackendApiClient(custom_transport=self._create_mock_transport(mock_resp))
        states = {
            "B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied", consecutive_occupied_frames=3),
            "B1-A02": _make_slot_state("B1-A02", confirmed_status="available", consecutive_available_frames=5),
        }

        result = client.sync_occupancy(self.adapter, states)

        self.assertTrue(result.success)
        self.assertEqual(result.updated, 2)
        self.assertIn("B1-A01", result.slots_updated)
        self.assertIn("B1-A02", result.slots_updated)
        self.assertEqual(client.acknowledged_status["B1-A01"], "occupied")
        self.assertEqual(client.acknowledged_status["B1-A02"], "available")
        self.assertEqual(len(client.pending_updates), 0)

    def test_03_unchanged_updates_and_duplicate_suppression(self):
        """Suppresses redundant network transmissions when states have already been confirmed."""
        def mock_resp(payload):
            return 200, {
                "success": True,
                "message": "CV updates processed successfully",
                "cameraId": "CAM-B1-01",
                "received": 1,
                "updated": 1,
                "skipped": [],
                "timestamp": "2026-11-15T01:30:00.123456Z"
            }

        client = BackendApiClient(custom_transport=self._create_mock_transport(mock_resp))
        states = {
            "B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied", consecutive_occupied_frames=3)
        }

        # Cycle 1: Dispatches
        r1 = client.sync_occupancy(self.adapter, states)
        self.assertIsNotNone(r1)
        self.assertEqual(len(self.recorded_requests), 1)

        # Cycle 2: Same state -> Suppressed (None returned, 0 extra HTTP requests)
        r2 = client.sync_occupancy(self.adapter, states)
        self.assertIsNone(r2)
        self.assertEqual(len(self.recorded_requests), 1)

    def test_04_skipped_reserved_slots(self):
        """Recognizes 'Slot is reserved' in skipped response, drops from pending, and does NOT endlessly retry."""
        def mock_resp(payload):
            return 200, {
                "success": True,
                "message": "CV updates processed with skipped items",
                "cameraId": "CAM-B1-01",
                "received": 2,
                "updated": 1,
                "skipped": [
                    {"slotId": "B1-A05", "reason": "Slot is reserved"}
                ],
                "timestamp": "2026-11-15T01:30:00.123456Z"
            }

        client = BackendApiClient(custom_transport=self._create_mock_transport(mock_resp))
        states = {
            "B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied", consecutive_occupied_frames=3),
            "B1-A05": _make_slot_state("B1-A05", confirmed_status="available", consecutive_available_frames=5),
        }

        result = client.sync_occupancy(self.adapter, states)

        self.assertTrue(result.success)
        self.assertIn("B1-A01", result.slots_updated)
        self.assertIn("B1-A05", result.slots_protected)
        self.assertNotIn("B1-A05", client.acknowledged_status, "Protected slot must NOT be marked as acknowledged occupancy")
        self.assertNotIn("B1-A05", client.pending_updates, "Protected slot must be cleared from pending to prevent endless retry")
        self.assertIn("B1-A05", client.protected_slots)

        # Next sync cycle: B1-A05 must NOT be retried
        r2 = client.sync_occupancy(self.adapter, states)
        self.assertIsNone(r2, "Permanently skipped protected slot must NOT be re-transmitted")
        self.assertEqual(len(self.recorded_requests), 1, "No second request should be sent")

    def test_05_skipped_maintenance_slots(self):
        """Recognizes 'Slot is under maintenance' in skipped response, records protection, and drops from pending."""
        def mock_resp(payload):
            return 200, {
                "success": True,
                "message": "CV updates processed with skipped items",
                "cameraId": "CAM-B1-01",
                "received": 1,
                "updated": 0,
                "skipped": [
                    {"slotId": "B1-A03", "reason": "Slot is under maintenance"}
                ],
                "timestamp": "2026-11-15T01:30:00.123456Z"
            }

        client = BackendApiClient(custom_transport=self._create_mock_transport(mock_resp))
        states = {
            "B1-A03": _make_slot_state("B1-A03", confirmed_status="available", consecutive_available_frames=5),
        }

        result = client.sync_occupancy(self.adapter, states)

        self.assertTrue(result.success)
        self.assertEqual(result.updated, 0)
        self.assertIn("B1-A03", result.slots_protected)
        self.assertNotIn("B1-A03", client.pending_updates)
        self.assertIn("B1-A03", client.protected_slots)

    def test_06_failed_http_responses(self):
        """Handles HTTP 400, 403, 500, and connection drop (status 0) without falsely acknowledging updates."""
        # HTTP 400
        client_400 = BackendApiClient(custom_transport=lambda p: (400, {"success": False, "message": "Batch size exceeds limit"}))
        states = {"B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied", consecutive_occupied_frames=3)}
        r_400 = client_400.sync_occupancy(self.adapter, states)
        self.assertFalse(r_400.success)
        self.assertEqual(r_400.status_code, 400)
        self.assertNotIn("B1-A01", client_400.acknowledged_status)

        # HTTP 403 (uncalibrated camera CAM-B1-02)
        adapter_b1_02 = OccupancyAdapter(camera_id="CAM-B1-02")
        client_403 = BackendApiClient()
        r_403 = client_403.sync_occupancy(adapter_b1_02, states)
        self.assertIsNone(r_403, "Uncalibrated camera must be suppressed")
        direct_403 = client_403.send_payload({"cameraId": "CAM-B1-02", "needsCalibration": True, "updates": [{"slotId": "B1-A09", "confirmedStatus": "available", "isMonitored": True, "consecutiveOccupiedFrames": 0, "consecutiveAvailableFrames": 5}]})
        self.assertFalse(direct_403.success)
        self.assertEqual(direct_403.status_code, 403)

        # HTTP 500
        client_500 = BackendApiClient(custom_transport=lambda p: (500, {"success": False, "message": "Database error"}))
        r_500 = client_500.sync_occupancy(self.adapter, states)
        self.assertFalse(r_500.success)
        self.assertEqual(r_500.status_code, 500)

        # Connection error (status 0)
        client_0 = BackendApiClient(custom_transport=lambda p: (0, {"success": False, "message": "Connection refused"}))
        r_0 = client_0.sync_occupancy(self.adapter, states)
        self.assertFalse(r_0.success)
        self.assertEqual(r_0.status_code, 0)
        self.assertIn("B1-A01", client_0.pending_updates)

    def test_07_malformed_and_non_json_responses(self):
        """Handles non-JSON, HTML error pages, or non-dict responses safely without crashing."""
        client_bad_gateway = BackendApiClient(
            custom_transport=lambda p: (502, {"success": False, "message": "Non-JSON response: <html>Bad Gateway</html>"})
        )
        states = {"B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied", consecutive_occupied_frames=3)}
        result = client_bad_gateway.sync_occupancy(self.adapter, states)
        self.assertFalse(result.success)
        self.assertEqual(result.status_code, 502)

    def test_08_initial_available_state_with_zero_frames(self):
        """Initial available state with consecutiveAvailableFrames=0 MUST NOT be transmitted."""
        # 1. build_update_record rejects it
        zero_frame_state = _make_slot_state("B1-A01", confirmed_status="available", consecutive_available_frames=0)
        rec = self.adapter.build_update_record("B1-A01", zero_frame_state)
        self.assertIsNone(rec, "Available state with 0 confirmed frames must return None")

        # 2. sync_occupancy excludes it
        client = BackendApiClient(custom_transport=self._create_mock_transport(lambda p: (200, {"success": True})))
        result = client.sync_occupancy(self.adapter, {"B1-A01": zero_frame_state})
        self.assertIsNone(result, "Available state with 0 confirmed frames must NOT trigger an HTTP request")
        self.assertEqual(len(self.recorded_requests), 0)

    def test_09_available_state_at_five_consecutive_frames(self):
        """Available state is rejected at < 5 frames and accepted once 5 consecutive frames are reached."""
        # 4 frames: rejected
        four_frame_state = _make_slot_state("B1-A01", confirmed_status="available", consecutive_available_frames=4)
        rec_4 = self.adapter.build_update_record("B1-A01", four_frame_state)
        self.assertIsNone(rec_4, "Available state with 4 frames must be rejected")

        # 5 frames: accepted
        five_frame_state = _make_slot_state("B1-A01", confirmed_status="available", consecutive_available_frames=5)
        rec_5 = self.adapter.build_update_record("B1-A01", five_frame_state)
        self.assertIsNotNone(rec_5)
        self.assertEqual(rec_5["slotId"], "B1-A01")
        self.assertEqual(rec_5["confirmedStatus"], "available")
        self.assertEqual(rec_5["consecutiveAvailableFrames"], 5)
        self.assertEqual(rec_5["consecutiveOccupiedFrames"], 0)

        # 8 frames: preserves actual count
        eight_frame_state = _make_slot_state("B1-A01", confirmed_status="available", consecutive_available_frames=8)
        rec_8 = self.adapter.build_update_record("B1-A01", eight_frame_state)
        self.assertEqual(rec_8["consecutiveAvailableFrames"], 8)

    def test_10_occupied_state_at_three_consecutive_frames(self):
        """Occupied state is rejected at < 3 frames and accepted once 3 consecutive frames are reached."""
        # 2 frames: rejected
        two_frame_state = _make_slot_state("B1-A01", confirmed_status="occupied", consecutive_occupied_frames=2)
        rec_2 = self.adapter.build_update_record("B1-A01", two_frame_state)
        self.assertIsNone(rec_2, "Occupied state with 2 frames must be rejected")

        # 3 frames: accepted
        three_frame_state = _make_slot_state("B1-A01", confirmed_status="occupied", consecutive_occupied_frames=3)
        rec_3 = self.adapter.build_update_record("B1-A01", three_frame_state)
        self.assertIsNotNone(rec_3)
        self.assertEqual(rec_3["slotId"], "B1-A01")
        self.assertEqual(rec_3["confirmedStatus"], "occupied")
        self.assertEqual(rec_3["consecutiveOccupiedFrames"], 3)
        self.assertEqual(rec_3["consecutiveAvailableFrames"], 0)

        # 6 frames: preserves actual count
        six_frame_state = _make_slot_state("B1-A01", confirmed_status="occupied", consecutive_occupied_frames=6)
        rec_6 = self.adapter.build_update_record("B1-A01", six_frame_state)
        self.assertEqual(rec_6["consecutiveOccupiedFrames"], 6)

    def test_11_repeated_video_timestamps(self):
        """Successive requests with repeated/static frame timestamps have strictly increasing timestamps."""
        tracker = CameraTimestampTracker()
        camera_id = "CAM-B1-01"

        # Simulate 5 video frames with the exact same float timestamp (e.g. repeated frame or video loop)
        same_time = 1700000000.0
        ts1 = tracker.get_strictly_increasing_timestamp(camera_id, desired_time=same_time)
        ts2 = tracker.get_strictly_increasing_timestamp(camera_id, desired_time=same_time)
        ts3 = tracker.get_strictly_increasing_timestamp(camera_id, desired_time=same_time)

        self.assertTrue(ts1 < ts2 < ts3, f"Timestamps must be strictly increasing: {ts1} < {ts2} < {ts3}")
        self.assertTrue(ts1.endswith("Z"))
        self.assertTrue(ts2.endswith("Z"))
        self.assertTrue(ts3.endswith("Z"))

    def test_12_retry_timestamp_behaviour(self):
        """Pure retries reuse original timestamp; backend 400 stale timestamp causes watermark advancement."""
        from datetime import timedelta
        tracker = CameraTimestampTracker()
        camera_id = "CAM-B1-01"

        # 1. Pure retry reuses original timestamp
        orig_ts = "2026-11-14T20:00:00.000000Z"
        reused = tracker.get_strictly_increasing_timestamp(camera_id, reuse_for_retry=orig_ts)
        self.assertEqual(reused, orig_ts)

        # 2. Advance past backend recorded watermark on stale 400 error
        now_utc = datetime.now(timezone.utc)
        watermark_dt = now_utc - timedelta(minutes=2)
        watermark_ts = watermark_dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        stale_ts = (now_utc - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

        tracker.advance_past(camera_id, watermark_ts)
        new_ts = tracker.get_strictly_increasing_timestamp(camera_id, desired_time=stale_ts)
        self.assertTrue(new_ts > watermark_ts, f"New timestamp must advance past watermark: {new_ts} > {watermark_ts}")

    def test_13_multiple_requests_from_same_camera(self):
        """Successive dispatches from same camera have strictly increasing timestamps and respect future limit."""
        client = BackendApiClient(custom_transport=self._create_mock_transport(
            lambda p: (200, {"success": True, "message": "OK", "received": 1, "updated": 1, "skipped": []})
        ))

        # Request 1: B1-A01 occupied
        s1 = {"B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied", consecutive_occupied_frames=3)}
        client.sync_occupancy(self.adapter, s1, timestamp=1700000000.0)

        # Request 2: B1-A01 transitions to available
        s2 = {"B1-A01": _make_slot_state("B1-A01", confirmed_status="available", consecutive_available_frames=5)}
        client.sync_occupancy(self.adapter, s2, timestamp=1700000000.0)

        self.assertEqual(len(self.recorded_requests), 2)
        req1_ts = self.recorded_requests[0]["timestamp"]
        req2_ts = self.recorded_requests[1]["timestamp"]
        self.assertTrue(req1_ts < req2_ts, f"Req 2 timestamp must be strictly greater: {req1_ts} < {req2_ts}")

    def test_14_existing_functionality_and_regression(self):
        """Preserves backward compatibility: build_slot_record, snapshot structure, and offline pipeline mode."""
        # 1. build_slot_record produces status and vehicleType for occupied
        occ_state = _make_slot_state("B1-A01", confirmed_status="occupied", vehicle_class="car", consecutive_occupied_frames=3)
        slot_rec = self.adapter.build_slot_record("B1-A01", occ_state)
        self.assertEqual(slot_rec["slotId"], "B1-A01")
        self.assertEqual(slot_rec["status"], "occupied")
        self.assertEqual(slot_rec["vehicleType"], "car")

        # 2. get_normalized_snapshot contains updates
        snap = self.adapter.get_normalized_snapshot({"B1-A01": occ_state})
        self.assertEqual(snap["cameraId"], "CAM-B1-01")
        self.assertIn("updates", snap)
        self.assertEqual(snap["updates"][0]["slotId"], "B1-A01")

        # 3. Offline pipeline runs without HTTP sync by default
        pipeline = CVPipeline(camera_id="CAM-B1-01", enable_http_sync=False, allow_mock=True)
        self.assertFalse(pipeline.enable_http_sync)
        self.assertIsNone(pipeline.api_client)

        dummy_frame = mock.MagicMock()
        dummy_frame.shape = (720, 1280, 3)
        record, _ = pipeline.process_frame(dummy_frame, frame_number=1, custom_detections=[])
        self.assertIsNone(record.get("http_sync"))
        self.assertIn("backend_payload", record)
        self.assertIn("backend_request", record)


    def test_15_audit1_reservation_protection_and_release_on_state_change(self):
        """Audit 1: Reserved slot is protected, and protection is released when CV detects a status change."""
        def mock_resp_reserved(payload):
            return 200, {
                "success": True,
                "message": "CV updates processed successfully",
                "received": 1,
                "updated": 0,
                "skipped": [{"slotId": "B1-A01", "reason": "Slot is reserved"}],
            }

        client = BackendApiClient(
            backend_url="http://localhost:5000/api/slots/cv-update",
            custom_transport=self._create_mock_transport(mock_resp_reserved),
        )

        # 1. Slot is available (5 frames) -> backend skips as reserved
        avail_state = {"B1-A01": _make_slot_state("B1-A01", confirmed_status="available", consecutive_available_frames=5)}
        res1 = client.sync_occupancy(self.adapter, avail_state)
        self.assertIsNotNone(res1)
        self.assertEqual(res1.slots_protected, ["B1-A01"])
        self.assertTrue(client.is_slot_protected("B1-A01"))
        self.assertEqual(len(client.pending_updates), 0, "Protected slot must be removed from immediate pending updates")

        # 2. Subsequent sync with same status (available) is suppressed
        res2 = client.sync_occupancy(self.adapter, avail_state)
        self.assertIsNone(res2, "Redundant sync while still protected and status unchanged must be suppressed")

        # 3. Car parks in reserved bay -> CV detects occupied (3 frames)
        # Status change releases protection automatically and queues update
        def mock_resp_ok(payload):
            return 200, {
                "success": True,
                "message": "CV updates processed successfully",
                "received": 1,
                "updated": 1,
                "skipped": [],
            }
        client.custom_transport = self._create_mock_transport(mock_resp_ok)

        occ_state = {"B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied", consecutive_occupied_frames=3)}
        res3 = client.sync_occupancy(self.adapter, occ_state)
        self.assertIsNotNone(res3, "State change must release protection and trigger transmission")
        self.assertEqual(res3.slots_updated, ["B1-A01"])
        self.assertFalse(client.is_slot_protected("B1-A01"))
        self.assertEqual(client.acknowledged_status.get("B1-A01"), "occupied")

    def test_16_audit1_reservation_protection_release_on_cooldown(self):
        """Audit 1: Protected slot is released after cooldown expires so backend state can be re-verified."""
        import time

        def mock_resp_reserved(payload):
            return 200, {
                "success": True,
                "received": 1,
                "updated": 0,
                "skipped": [{"slotId": "B1-A01", "reason": "Slot is reserved"}],
            }

        client = BackendApiClient(
            backend_url="http://localhost:5000/api/slots/cv-update",
            custom_transport=self._create_mock_transport(mock_resp_reserved),
            protected_cooldown=0.05,  # 50ms cooldown for test
        )

        # 1. Initial attempt -> marked protected
        avail_state = {"B1-A01": _make_slot_state("B1-A01", confirmed_status="available", consecutive_available_frames=5)}
        res1 = client.sync_occupancy(self.adapter, avail_state)
        self.assertTrue(client.is_slot_protected("B1-A01"))

        # 2. Cooldown not expired yet
        self.assertIsNone(client.sync_occupancy(self.adapter, avail_state))

        # 3. Wait for cooldown to expire
        time.sleep(0.06)

        # Now when reservation has expired in backend, backend accepts update
        def mock_resp_accepted(payload):
            return 200, {
                "success": True,
                "received": 1,
                "updated": 1,
                "skipped": [],
            }
        client.custom_transport = self._create_mock_transport(mock_resp_accepted)

        # Cooldown elapsed -> protection released -> transmitted to backend
        res2 = client.sync_occupancy(self.adapter, avail_state)
        self.assertIsNotNone(res2)
        self.assertEqual(res2.slots_updated, ["B1-A01"])
        self.assertFalse(client.is_slot_protected("B1-A01"))

    def test_17_audit1_maintenance_slot_protection_and_manual_release(self):
        """Audit 1: Maintenance slot is protected and can be manually released via unprotect_slot()."""
        def mock_resp_maint(payload):
            return 200, {
                "success": True,
                "received": 1,
                "updated": 0,
                "skipped": [{"slotId": "B1-A01", "reason": "Slot is under maintenance"}],
            }

        client = BackendApiClient(
            backend_url="http://localhost:5000/api/slots/cv-update",
            custom_transport=self._create_mock_transport(mock_resp_maint),
        )

        avail_state = {"B1-A01": _make_slot_state("B1-A01", confirmed_status="available", consecutive_available_frames=5)}
        res = client.sync_occupancy(self.adapter, avail_state)
        self.assertEqual(res.slots_protected, ["B1-A01"])
        self.assertTrue(client.is_slot_protected("B1-A01"))

        # Manual release (e.g. administrator re-enabled bay via dashboard or webhook)
        client.unprotect_slot("B1-A01")
        self.assertFalse(client.is_slot_protected("B1-A01"))

        # Clear protected slots entirely
        client.protected_slots["B1-A02"] = mock.MagicMock()
        client.clear_protected_slots()
        self.assertEqual(len(client.protected_slots), 0)

    def test_18_audit2_partial_batch_processing(self):
        """Audit 2: Partial batch processing correctly separates updated, skipped (reserved/maintenance), and unchanged slots."""
        def mock_resp_partial(payload):
            return 200, {
                "success": True,
                "message": "CV updates processed successfully",
                "cameraId": "CAM-B1-01",
                "received": 3,
                "updated": 1,
                "skipped": [
                    {"slotId": "B1-A02", "reason": "Slot is reserved"},
                    {"slotId": "B1-A03", "reason": "Slot is under maintenance"},
                ],
                "timestamp": "2026-11-15T02:00:00.000000Z",
            }

        client = BackendApiClient(
            backend_url="http://localhost:5000/api/slots/cv-update",
            custom_transport=self._create_mock_transport(mock_resp_partial),
        )

        states = {
            "B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied", consecutive_occupied_frames=3),
            "B1-A02": _make_slot_state("B1-A02", confirmed_status="available", consecutive_available_frames=5),
            "B1-A03": _make_slot_state("B1-A03", confirmed_status="available", consecutive_available_frames=5),
        }

        result = client.sync_occupancy(self.adapter, states)

        self.assertIsNotNone(result)
        self.assertTrue(result.success)
        self.assertEqual(result.received, 3)
        self.assertEqual(result.updated, 1)
        self.assertEqual(result.slots_updated, ["B1-A01"])
        self.assertIn("B1-A02", result.slots_protected)
        self.assertIn("B1-A03", result.slots_protected)
        self.assertEqual(len(result.slots_failed), 0)

        # Updated slot is acknowledged
        self.assertEqual(client.acknowledged_status.get("B1-A01"), "occupied")
        # Protected slots are in protected_slots map
        self.assertTrue(client.is_slot_protected("B1-A02"))
        self.assertTrue(client.is_slot_protected("B1-A03"))
        # All three slots are removed from pending_updates (no unneeded retries)
        self.assertEqual(len(client.pending_updates), 0)

    def test_19_audit2_backend_updated_zero_with_unskipped_slots(self):
        """Audit 2: Backend returns updated=0 with unskipped slots -> treated as unconfirmed/failed, NOT acknowledged."""
        def mock_resp_zero_updated(payload):
            return 200, {
                "success": True,
                "message": "Zero rows matched in database",
                "received": 1,
                "updated": 0,
                "skipped": [],
            }

        client = BackendApiClient(
            backend_url="http://localhost:5000/api/slots/cv-update",
            custom_transport=self._create_mock_transport(mock_resp_zero_updated),
        )

        states = {
            "B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied", consecutive_occupied_frames=3)
        }

        result = client.sync_occupancy(self.adapter, states)

        self.assertIsNotNone(result)
        self.assertEqual(result.updated, 0)
        self.assertIn("B1-A01", result.slots_failed, "Unskipped slot with updated=0 must be marked failed/unconfirmed")
        self.assertEqual(len(result.slots_updated), 0)
        self.assertNotIn("B1-A01", client.acknowledged_status, "Must NOT falsely acknowledge unupdated slot")
        self.assertIn("B1-A01", client.pending_updates, "Unconfirmed slot remains in pending queue for retry")
        self.assertEqual(client.pending_updates["B1-A01"].attempts, 1)

    def test_20_audit3_stale_timestamp_400_watermark_advancement(self):
        """Audit 3: HTTP 400 with 'strictly greater than' advances watermark and clears stale pending timestamp."""
        from datetime import datetime, timezone, timedelta
        watermark_dt = datetime.now(timezone.utc) - timedelta(minutes=1)
        watermark = watermark_dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        call_count = [0]

        def mock_resp_stale_then_ok(payload):
            call_count[0] += 1
            if call_count[0] == 1:
                return 400, {
                    "success": False,
                    "message": f"Stale or duplicate request rejected for camera CAM-B1-01. Timestamp must be strictly greater than {watermark}"
                }
            return 200, {
                "success": True,
                "message": "CV updates processed successfully",
                "received": 1,
                "updated": 1,
                "skipped": [],
            }

        client = BackendApiClient(
            backend_url="http://localhost:5000/api/slots/cv-update",
            custom_transport=self._create_mock_transport(mock_resp_stale_then_ok),
        )

        states = {
            "B1-A01": _make_slot_state("B1-A01", confirmed_status="occupied", consecutive_occupied_frames=3)
        }

        # First dispatch -> fails with 400 stale timestamp
        res1 = client.sync_occupancy(self.adapter, states)
        self.assertFalse(res1.success)
        self.assertEqual(res1.status_code, 400)
        self.assertIn("B1-A01", client.pending_updates)
        self.assertEqual(client.pending_updates["B1-A01"].timestamp, "", "Pending timestamp must be cleared")

        # Second dispatch -> tracker uses advanced watermark
        res2 = client.sync_occupancy(self.adapter, states)
        self.assertTrue(res2.success)
        self.assertEqual(res2.updated, 1)
        self.assertEqual(client.acknowledged_status.get("B1-A01"), "occupied")


if __name__ == "__main__":
    unittest.main()
