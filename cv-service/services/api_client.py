"""
Backend API Client: Computer Vision to Node.js HTTP Dispatcher
Smart Mall Parking Management System (cv-service)

Responsibilities:
1. Dispatches confirmed occupancy transitions to the Node.js backend:
   POST http://localhost:5000/api/slots/cv-update
2. Formats payloads strictly matching Person B's final API contract:
   {
       "cameraId": "CAM-B1-01",
       "timestamp": "ISO-8601 UTC timestamp",
       "updates": [
           {
               "slotId": "B1-A01",
               "confirmedStatus": "occupied",
               "isMonitored": true,
               "consecutiveOccupiedFrames": 3,
               "consecutiveAvailableFrames": 0
           }
       ]
   }
3. Parses and handles the backend response structure:
   - success: bool
   - summary: { totalReceived, updated, unchanged, protected, rejected }
   - results: [{ slotId, status, currentStatus, reason, ... }]
4. Enforces delivery acknowledgment:
   - Only acknowledges transitions confirmed as 'updated', 'unchanged', or 'protected'.
   - Unacknowledged updates remain in a pending retry queue.
   - Bounded retries (default: 3 attempts).
   - Duplicate suppression: does not re-transmit states already acknowledged by backend.
5. Uses actual consecutive occupied and available frame counters from CV pipeline.
6. Handles transport failures gracefully:
   - ConnectionError, Timeout, HTTP 400/422/500, and non-JSON responses.
7. Enforces calibration isolation:
   - Suppresses operational updates for CAM-B1-02 (needs_calibration: true).
8. Supports standard library urllib fallback when requests package is not installed.
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Tuple, Set, Union, Callable

# Optional requests import with urllib fallback
try:
    import requests
except ImportError:
    requests = None

import urllib.request
import urllib.error

from config.settings import (
    DEFAULT_BACKEND_URL,
    DEFAULT_HTTP_TIMEOUT,
    DEFAULT_MAX_RETRIES,
)
from services.occupancy_adapter import (
    OccupancyAdapter,
    get_iso_timestamp,
    OPERATIONAL_STATUSES,
)

logger = logging.getLogger("cv-service.api_client")


@dataclass
class PendingSlotUpdate:
    """
    Represents an unacknowledged slot transition awaiting delivery confirmation.
    Strictly adheres to Person B's final backend request contract for each update item.
    """
    slot_id: str
    confirmed_status: str
    is_monitored: bool = True
    consecutive_occupied_frames: int = 0
    consecutive_available_frames: int = 0
    timestamp: str = ""
    attempts: int = 0
    last_error: Optional[str] = None

    # Backward compatibility properties for any internal callers
    @property
    def status(self) -> str:
        return self.confirmed_status

    @status.setter
    def status(self, val: str) -> None:
        self.confirmed_status = val

    def to_dict(self) -> Dict[str, Any]:
        """
        Formats the update item according to the exact backend schema:
        {
            "slotId": "B1-A01",
            "confirmedStatus": "occupied",
            "isMonitored": true,
            "consecutiveOccupiedFrames": 3,
            "consecutiveAvailableFrames": 0
        }
        """
        return {
            "slotId": self.slot_id,
            "confirmedStatus": self.confirmed_status,
            "isMonitored": bool(self.is_monitored),
            "consecutiveOccupiedFrames": int(self.consecutive_occupied_frames),
            "consecutiveAvailableFrames": int(self.consecutive_available_frames),
        }


@dataclass
class DispatchResult:
    """
    Structured outcome of an HTTP occupancy dispatch attempt.
    """
    success: bool
    status_code: Optional[int] = None
    message: str = ""
    slots_updated: List[str] = field(default_factory=list)
    slots_unchanged: List[str] = field(default_factory=list)
    slots_protected: List[str] = field(default_factory=list)
    slots_failed: List[str] = field(default_factory=list)
    raw_response: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "statusCode": self.status_code,
            "message": self.message,
            "slotsUpdated": list(self.slots_updated),
            "slotsUnchanged": list(self.slots_unchanged),
            "slotsProtected": list(self.slots_protected),
            "slotsFailed": list(self.slots_failed),
            "rawResponse": self.raw_response,
        }


class BackendApiClient:
    """
    Reusable HTTP client for synchronizing CV occupancy data with Node.js backend.
    """

    def __init__(
        self,
        backend_url: str = DEFAULT_BACKEND_URL,
        timeout: float = DEFAULT_HTTP_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        custom_transport: Optional[Callable[[Dict[str, Any]], Tuple[int, Dict[str, Any]]]] = None,
    ):
        """
        :param backend_url: Target Express endpoint URL
        :param timeout: HTTP request timeout in seconds
        :param max_retries: Max attempts before dropping or quarantining an unconfirmed slot
        :param custom_transport: Optional injectable callable (payload) -> (status_code, dict) for unit tests
        """
        self.backend_url = backend_url
        self.timeout = float(timeout)
        self.max_retries = int(max_retries)
        self.custom_transport = custom_transport

        # Delivery tracking state
        self.pending_updates: Dict[str, PendingSlotUpdate] = {}
        self.acknowledged_status: Dict[str, str] = {}
        self.quarantined_slots: Dict[str, str] = {}

    def reset_state(self) -> None:
        """Resets all delivery tracking queues and caches."""
        self.pending_updates.clear()
        self.acknowledged_status.clear()
        self.quarantined_slots.clear()

    def _execute_http_post(self, payload: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
        """
        Executes HTTP POST request using injectable transport, requests, or urllib.
        Returns Tuple of (status_code: int, response_dict: Dict).
        """
        # 1. Injectable transport (used for deterministic unit testing)
        if self.custom_transport is not None:
            return self.custom_transport(payload)

        # 2. Use requests library if installed
        if requests is not None:
            try:
                resp = requests.post(
                    self.backend_url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                    timeout=self.timeout,
                )
                status_code = resp.status_code
                try:
                    data = resp.json()
                except Exception:
                    data = {"success": False, "message": f"Non-JSON response: {resp.text[:200]}"}
                return status_code, data
            except requests.exceptions.Timeout:
                return 0, {"success": False, "message": f"Request timed out after {self.timeout}s"}
            except requests.exceptions.ConnectionError as ce:
                return 0, {"success": False, "message": f"Connection error: {ce}"}
            except Exception as e:
                return 0, {"success": False, "message": f"HTTP transport error: {e}"}

        # 3. Fallback to standard library urllib
        try:
            req_data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                self.backend_url,
                data=req_data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                status_code = response.getcode()
                body = response.read().decode("utf-8")
                try:
                    data = json.loads(body)
                except Exception:
                    data = {"success": False, "message": f"Non-JSON response: {body[:200]}"}
                return status_code, data
        except urllib.error.HTTPError as he:
            status_code = he.code
            try:
                body = he.read().decode("utf-8")
                data = json.loads(body)
            except Exception:
                data = {"success": False, "message": f"HTTP error {status_code}"}
            return status_code, data
        except urllib.error.URLError as ue:
            return 0, {"success": False, "message": f"Connection error: {ue.reason}"}
        except Exception as e:
            return 0, {"success": False, "message": f"Urllib transport error: {e}"}

    def send_payload(self, payload: Dict[str, Any]) -> DispatchResult:
        """
        Dispatches a formatted payload to the backend and handles response acknowledgment.

        :param payload: Dictionary conforming to Person B final contract (updates[])
        :returns: DispatchResult
        """
        camera_id = payload.get("cameraId")
        updates_to_send = payload.get("updates")
        if updates_to_send is None and "slots" in payload:
            updates_to_send = payload.get("slots", [])
        if updates_to_send is None:
            updates_to_send = []

        # Calibration check: CAM-B1-02 must be suppressed
        if payload.get("needsCalibration") or camera_id == "CAM-B1-02":
            return DispatchResult(
                success=False,
                status_code=422,
                message=f"Camera '{camera_id}' requires calibration. Operational updates suppressed.",
                slots_failed=[s.get("slotId") for s in updates_to_send],
            )

        if not updates_to_send:
            return DispatchResult(
                success=True,
                status_code=200,
                message="No updates to transmit.",
            )

        # Execute network request
        status_code, response_data = self._execute_http_post(payload)

        # Network transport failure (ConnectionError, Timeout, 0 status)
        if status_code == 0:
            error_msg = response_data.get("message", "Network failure")
            failed_ids = []
            for s in updates_to_send:
                s_id = s.get("slotId")
                failed_ids.append(s_id)
                if s_id in self.pending_updates:
                    self.pending_updates[s_id].attempts += 1
                    self.pending_updates[s_id].last_error = error_msg
                    if self.pending_updates[s_id].attempts >= self.max_retries:
                        self.quarantined_slots[s_id] = error_msg
                        self.pending_updates.pop(s_id, None)
            return DispatchResult(
                success=False,
                status_code=0,
                message=error_msg,
                slots_failed=failed_ids,
                raw_response=response_data,
            )

        # Successful HTTP response from backend (200 OK)
        if status_code == 200 and response_data.get("success"):
            slots_updated = []
            slots_unchanged = []
            slots_protected = []
            slots_failed = []

            for result_item in response_data.get("results", []):
                s_id = result_item.get("slotId")
                res_status = result_item.get("status")
                current_status = result_item.get("currentStatus") or result_item.get("confirmedStatus")

                if res_status == "updated":
                    slots_updated.append(s_id)
                    # Acknowledge confirmed delivery
                    confirmed_st = current_status
                    if not confirmed_st and s_id in self.pending_updates:
                        confirmed_st = self.pending_updates[s_id].confirmed_status
                    self.acknowledged_status[s_id] = confirmed_st
                    self.pending_updates.pop(s_id, None)

                elif res_status == "unchanged":
                    slots_unchanged.append(s_id)
                    # Acknowledge state already identical in backend
                    confirmed_st = current_status
                    if not confirmed_st and s_id in self.pending_updates:
                        confirmed_st = self.pending_updates[s_id].confirmed_status
                    self.acknowledged_status[s_id] = confirmed_st
                    self.pending_updates.pop(s_id, None)

                elif res_status == "protected":
                    slots_protected.append(s_id)
                    # Slot is reserved or under maintenance; backend intentionally protected it
                    # Drop from pending so we don't spin retrying against a locked slot
                    self.pending_updates.pop(s_id, None)

                elif res_status in ("rejected", "error"):
                    slots_failed.append(s_id)
                    reason = result_item.get("reason", "Backend rejected slot update")
                    if s_id in self.pending_updates:
                        self.pending_updates[s_id].attempts += 1
                        self.pending_updates[s_id].last_error = reason
                        if self.pending_updates[s_id].attempts >= self.max_retries:
                            self.quarantined_slots[s_id] = reason
                            self.pending_updates.pop(s_id, None)

            return DispatchResult(
                success=True,
                status_code=200,
                message=response_data.get("message", "CV occupancy update processed"),
                slots_updated=slots_updated,
                slots_unchanged=slots_unchanged,
                slots_protected=slots_protected,
                slots_failed=slots_failed,
                raw_response=response_data,
            )

        # Top-level backend rejection (400, 422, 500, etc.)
        err_msg = response_data.get("message", f"Backend rejected with HTTP {status_code}")
        failed_ids = []
        for s in updates_to_send:
            s_id = s.get("slotId")
            failed_ids.append(s_id)
            if s_id in self.pending_updates:
                self.pending_updates[s_id].attempts += 1
                self.pending_updates[s_id].last_error = err_msg
                if self.pending_updates[s_id].attempts >= self.max_retries:
                    self.quarantined_slots[s_id] = err_msg
                    self.pending_updates.pop(s_id, None)

        return DispatchResult(
            success=False,
            status_code=status_code,
            message=err_msg,
            slots_failed=failed_ids,
            raw_response=response_data,
        )

    def sync_occupancy(
        self,
        adapter: OccupancyAdapter,
        stabilized_states: Dict[str, Any],
        timestamp: Optional[Union[float, str]] = None,
    ) -> Optional[DispatchResult]:
        """
        Gathers unacknowledged status transitions and pending retries,
        formats a payload conforming to Person B's final contract (updates[]),
        and sends it to Node.js.

        :param adapter: OccupancyAdapter for the current camera
        :param stabilized_states: Dict mapping slot_id to SlotTemporalState
        :param timestamp: Optional frame timestamp
        :returns: DispatchResult if an HTTP transmission occurred, None if duplicate/suppressed
        """
        # Guard: Uncalibrated cameras do not transmit operational updates
        if adapter.needs_calibration:
            return None

        camera_id = adapter.camera_id
        iso_timestamp = get_iso_timestamp(timestamp)

        # 1. Identify newly confirmed transitions against backend acknowledged state
        for s_id in adapter.assigned_slots:
            state = stabilized_states.get(s_id)
            if state is None:
                continue

            # Extract confirmed status and monitoring flag
            if hasattr(state, "confirmed_status"):
                confirmed_status = state.confirmed_status
                is_monitored = getattr(state, "is_monitored", True)
                consec_occupied = getattr(state, "consecutive_occupied_frames", 0)
                consec_available = getattr(state, "consecutive_available_frames", 0)
            elif isinstance(state, dict):
                confirmed_status = state.get("confirmedStatus") or state.get("confirmed_status")
                is_monitored = state.get("isMonitored", state.get("is_monitored", True))
                consec_occupied = state.get("consecutiveOccupiedFrames", state.get("consecutive_occupied_frames", 0))
                consec_available = state.get("consecutiveAvailableFrames", state.get("consecutive_available_frames", 0))
            else:
                continue

            # Guard: Unmonitored or non-operational slots are never queued for backend sync
            if not is_monitored or confirmed_status == "not_monitored":
                continue

            if confirmed_status not in OPERATIONAL_STATUSES:
                continue

            ack_status = self.acknowledged_status.get(s_id)

            # Check if this status differs from what backend has confirmed
            if confirmed_status != ack_status:
                if s_id in self.pending_updates:
                    pending = self.pending_updates[s_id]
                    if pending.confirmed_status != confirmed_status:
                        # State has changed while in pending queue -> reset for new state
                        pending.confirmed_status = confirmed_status
                        pending.is_monitored = bool(is_monitored)
                        pending.consecutive_occupied_frames = int(consec_occupied)
                        pending.consecutive_available_frames = int(consec_available)
                        pending.timestamp = iso_timestamp
                        pending.attempts = 0
                        pending.last_error = None
                    else:
                        # Existing pending update with same state -> retain attempts count, refresh counters
                        pending.timestamp = iso_timestamp
                        pending.consecutive_occupied_frames = int(consec_occupied)
                        pending.consecutive_available_frames = int(consec_available)
                else:
                    self.pending_updates[s_id] = PendingSlotUpdate(
                        slot_id=s_id,
                        confirmed_status=confirmed_status,
                        is_monitored=bool(is_monitored),
                        consecutive_occupied_frames=int(consec_occupied),
                        consecutive_available_frames=int(consec_available),
                        timestamp=iso_timestamp,
                    )

        # 2. Check if we have any pending updates to transmit
        if not self.pending_updates:
            # Duplicate suppression: state is already identical in backend
            return None

        # 3. Assemble payload conforming to Person B's final contract (updates[])
        updates_payload = []
        for pending in list(self.pending_updates.values()):
            if pending.attempts < self.max_retries:
                updates_payload.append(pending.to_dict())

        if not updates_payload:
            return None

        request_body = {
            "cameraId": camera_id,
            "timestamp": iso_timestamp,
            "updates": updates_payload,
        }

        # 4. Dispatch and process acknowledgment
        return self.send_payload(request_body)
