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
3. Parses and handles the actual backend response structure:
   - success: bool
   - message: str ("CV updates processed successfully" / "CV updates processed with skipped items")
   - cameraId: str
   - received: int
   - updated: int
   - skipped: [{ slotId, reason }]
   - timestamp: str
4. Delivery acknowledgment and protected slot lifecycle:
   - Removes successfully updated slots from pending queue.
   - Recognizes skipped protected slots (reserved, maintenance) and drops them from retry loops.
   - Prevents permanent blacklisting: releases protection when CV detects status change or after cooldown.
   - Bounded retries (default: 3 attempts) for transient failures.
   - Duplicate suppression: does not re-transmit states already confirmed in backend.
5. Strictly increasing per-camera timestamps:
   - Monotonic tracking per camera.
   - Handles static test frames and repeated video timestamps by advancing monotonically.
   - Reuses original timestamp on pure retries where appropriate.
6. Calibration isolation:
   - Suppresses operational updates for CAM-B1-02 (needs_calibration: true).
7. Supports standard library urllib fallback when requests package is not installed.
"""

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
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


class CameraTimestampTracker:
    """
    Guarantees strictly monotonically increasing UTC ISO-8601 timestamps per camera.
    Handles static test frames, video loops, repeated frame timestamps, and concurrency.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._last_micros: Dict[str, int] = {}

    def get_strictly_increasing_timestamp(
        self,
        camera_id: str,
        desired_time: Optional[Union[float, str, datetime]] = None,
        reuse_for_retry: Optional[str] = None,
    ) -> str:
        """
        Returns a valid UTC ISO 8601 string guaranteed to be strictly greater in
        microseconds than any previously issued timestamp for the given camera.
        """
        with self._lock:
            # If reusing an existing timestamp for a pure retry of an uncommitted request
            if reuse_for_retry and isinstance(reuse_for_retry, str) and "T" in reuse_for_retry:
                return reuse_for_retry

            now_dt = datetime.now(timezone.utc)
            now_micros = int(now_dt.timestamp() * 1_000_000)

            # Determine proposed microseconds from input
            if isinstance(desired_time, (int, float)) and desired_time > 0:
                proposed_micros = int(desired_time * 1_000_000)
            elif isinstance(desired_time, str) and "T" in desired_time:
                try:
                    clean_str = desired_time.strip().replace("Z", "+00:00")
                    dt = datetime.fromisoformat(clean_str)
                    proposed_micros = int(dt.timestamp() * 1_000_000)
                except Exception:
                    proposed_micros = now_micros
            elif isinstance(desired_time, datetime):
                dt = desired_time.astimezone(timezone.utc)
                proposed_micros = int(dt.timestamp() * 1_000_000)
            else:
                proposed_micros = now_micros

            last_micros = self._last_micros.get(camera_id, 0)

            # Enforce strictly monotonic progression for this camera
            if proposed_micros <= last_micros:
                # If proposed timestamp is behind or equal to last seen (e.g. repeated video frame
                # or static test frame), advance by at least 1,000 microseconds (1 millisecond)
                target_micros = last_micros + 1_000
            else:
                target_micros = proposed_micros

            # Ensure we do not exceed backend's permitted future limit (> 5 minutes clock skew)
            max_allowed_future = now_micros + (4 * 60 * 1_000_000)  # Capped at now + 4 mins
            if target_micros > max_allowed_future:
                target_micros = now_micros

            self._last_micros[camera_id] = target_micros

            dt_obj = datetime.fromtimestamp(target_micros / 1_000_000, tz=timezone.utc)
            return dt_obj.strftime("%Y-%m-%dT%H:%M:%S.%fZ")

    def advance_past(self, camera_id: str, timestamp_str: str) -> None:
        """Advances camera's recorded watermark if backend informed us of a higher timestamp."""
        try:
            clean_str = timestamp_str.strip().replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean_str)
            micros = int(dt.timestamp() * 1_000_000)
            with self._lock:
                if micros >= self._last_micros.get(camera_id, 0):
                    self._last_micros[camera_id] = micros + 1_000
        except Exception:
            pass

    def reset(self, camera_id: Optional[str] = None) -> None:
        """Resets the timestamp cache for a specific camera or all cameras."""
        with self._lock:
            if camera_id:
                self._last_micros.pop(camera_id, None)
            else:
                self._last_micros.clear()


@dataclass
class ProtectedSlotRecord:
    """
    Represents a slot temporarily skipped by the backend due to reservation or maintenance.
    Tracks reason, status when protected, timestamp, and re-check cooldown.
    """
    slot_id: str
    reason: str                     # "Slot is reserved", "Slot is under maintenance"
    protected_status: str           # Status when skipped (e.g. "available")
    skipped_at: float = field(default_factory=time.time)
    cooldown_seconds: float = 30.0  # Periodic re-evaluation interval

    def is_expired(self, current_time: Optional[float] = None) -> bool:
        """Returns True if cooldown has elapsed, allowing re-verification with backend."""
        now = current_time if current_time is not None else time.time()
        return (now - self.skipped_at) >= self.cooldown_seconds


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

    # Backward compatibility properties for any existing callers
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
    Structured outcome of an HTTP occupancy dispatch attempt matching actual backend response.
    """
    success: bool
    status_code: Optional[int] = None
    message: str = ""
    received: int = 0
    updated: int = 0
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
            "received": self.received,
            "updated": self.updated,
            "slotsUpdated": list(self.slots_updated),
            "slotsUnchanged": list(self.slots_unchanged),
            "slotsProtected": list(self.slots_protected),
            "slotsFailed": list(self.slots_failed),
            "rawResponse": self.raw_response,
        }


class BackendApiClient:
    """
    Reusable HTTP client for synchronizing CV occupancy data with Person B's Node.js backend.
    """

    def __init__(
        self,
        backend_url: str = DEFAULT_BACKEND_URL,
        timeout: float = DEFAULT_HTTP_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        custom_transport: Optional[Callable[[Dict[str, Any]], Tuple[int, Dict[str, Any]]]] = None,
        timestamp_tracker: Optional[CameraTimestampTracker] = None,
        protected_cooldown: float = 30.0,
    ):
        """
        :param backend_url: Target Express endpoint URL
        :param timeout: HTTP request timeout in seconds
        :param max_retries: Max attempts before dropping or quarantining an unconfirmed slot
        :param custom_transport: Optional injectable callable (payload) -> (status_code, dict) for unit tests
        :param timestamp_tracker: Optional shared or pre-configured CameraTimestampTracker
        :param protected_cooldown: Seconds before re-verifying a protected slot with backend (default: 30s)
        """
        self.backend_url = backend_url
        self.timeout = float(timeout)
        self.max_retries = int(max_retries)
        self.custom_transport = custom_transport
        self.timestamp_tracker = timestamp_tracker or CameraTimestampTracker()
        self.protected_cooldown = float(protected_cooldown)

        # Delivery tracking state
        self.pending_updates: Dict[str, PendingSlotUpdate] = {}
        self.acknowledged_status: Dict[str, str] = {}
        self.protected_slots: Dict[str, ProtectedSlotRecord] = {}  # slotId -> ProtectedSlotRecord
        self.quarantined_slots: Dict[str, str] = {}

    def reset_state(self) -> None:
        """Resets all delivery tracking queues, caches, and timestamp monitors."""
        self.pending_updates.clear()
        self.acknowledged_status.clear()
        self.protected_slots.clear()
        self.quarantined_slots.clear()
        self.timestamp_tracker.reset()

    def unprotect_slot(self, slot_id: str) -> None:
        """Explicitly releases protection on a slot (e.g. when reservation expires or maintenance is cleared)."""
        self.protected_slots.pop(slot_id, None)

    def clear_protected_slots(self) -> None:
        """Removes all slots from the protected cache."""
        self.protected_slots.clear()

    def is_slot_protected(self, slot_id: str, current_time: Optional[float] = None) -> bool:
        """Returns True if the slot is currently in an active protected state."""
        record = self.protected_slots.get(slot_id)
        if not record:
            return False
        if record.is_expired(current_time):
            self.protected_slots.pop(slot_id, None)
            return False
        return True

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
                    if not isinstance(data, dict):
                        data = {"success": False, "message": f"Non-dict JSON response: {data}"}
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
                    if not isinstance(data, dict):
                        data = {"success": False, "message": f"Non-dict JSON response: {data}"}
                except Exception:
                    data = {"success": False, "message": f"Non-JSON response: {body[:200]}"}
                return status_code, data
        except urllib.error.HTTPError as he:
            status_code = he.code
            try:
                body = he.read().decode("utf-8")
                data = json.loads(body)
                if not isinstance(data, dict):
                    data = {"success": False, "message": f"HTTP error {status_code}"}
            except Exception:
                data = {"success": False, "message": f"HTTP error {status_code}"}
            return status_code, data
        except urllib.error.URLError as ue:
            return 0, {"success": False, "message": f"Connection error: {ue.reason}"}
        except Exception as e:
            return 0, {"success": False, "message": f"Urllib transport error: {e}"}

    def send_payload(self, payload: Dict[str, Any]) -> DispatchResult:
        """
        Dispatches a formatted payload to the backend and handles response acknowledgment,
        correctly parsing Person B's actual response structure:
        { success, message, cameraId, received, updated, skipped: [{slotId, reason}], timestamp }

        :param payload: Dictionary conforming to Person B final contract (updates[])
        :returns: DispatchResult
        """
        camera_id = payload.get("cameraId", "")
        updates_to_send = payload.get("updates")
        if updates_to_send is None and "slots" in payload:
            updates_to_send = payload.get("slots", [])
        if updates_to_send is None:
            updates_to_send = []

        # Calibration check: CAM-B1-02 must be suppressed
        if payload.get("needsCalibration") or camera_id == "CAM-B1-02":
            return DispatchResult(
                success=False,
                status_code=403,
                message=f"Camera '{camera_id}' is uncalibrated and disabled. Operational updates suppressed.",
                slots_failed=[s.get("slotId") for s in updates_to_send if isinstance(s, dict)],
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
            error_msg = response_data.get("message", "Network failure") if isinstance(response_data, dict) else "Network failure"
            failed_ids = []
            for s in updates_to_send:
                if not isinstance(s, dict):
                    continue
                s_id = s.get("slotId")
                if not s_id:
                    continue
                failed_ids.append(s_id)
                if s_id in self.pending_updates:
                    self.pending_updates[s_id].attempts += 1
                    self.pending_updates[s_id].last_error = error_msg
                    if self.pending_updates[s_id].attempts >= self.max_retries:
                        self.quarantined_slots[s_id] = error_msg
                        self.pending_updates.pop(s_id, None)
                        logger.warning(f"[BackendApiClient] Slot '{s_id}' quarantined after {self.max_retries} attempts: {error_msg}")
            return DispatchResult(
                success=False,
                status_code=0,
                message=error_msg,
                slots_failed=failed_ids,
                raw_response=response_data,
            )

        # Successful HTTP response from backend (200 OK)
        if status_code == 200 and isinstance(response_data, dict) and response_data.get("success") is True:
            received_count = response_data.get("received", len(updates_to_send))
            updated_count = response_data.get("updated")

            # Extract skipped slots map: slotId -> reason
            skipped_list = response_data.get("skipped", [])
            if not isinstance(skipped_list, list):
                skipped_list = []

            skipped_map: Dict[str, str] = {}
            for item in skipped_list:
                if isinstance(item, dict) and "slotId" in item:
                    skipped_map[item["slotId"]] = item.get("reason", "Skipped by backend")

            # Check for legacy or mock "results" format for backward compatibility
            results_list = response_data.get("results")
            legacy_results_map: Dict[str, Dict[str, Any]] = {}
            if isinstance(results_list, list):
                for res_item in results_list:
                    if isinstance(res_item, dict) and "slotId" in res_item:
                        legacy_results_map[res_item["slotId"]] = res_item

            slots_updated: List[str] = []
            slots_unchanged: List[str] = []
            slots_protected: List[str] = []
            slots_failed: List[str] = []

            for item in updates_to_send:
                if not isinstance(item, dict):
                    continue
                s_id = item.get("slotId")
                confirmed_status = item.get("confirmedStatus") or item.get("status")
                if not s_id:
                    continue

                # 1. Check if slot was skipped by backend
                if s_id in skipped_map:
                    reason = skipped_map[s_id]
                    reason_lower = reason.lower()

                    if "reserved" in reason_lower or "maintenance" in reason_lower:
                        # AUDIT 1 & 2: Protected slot!
                        slots_protected.append(s_id)
                        # Record with cooldown so it is not permanently blacklisted
                        self.protected_slots[s_id] = ProtectedSlotRecord(
                            slot_id=s_id,
                            reason=reason,
                            protected_status=confirmed_status,
                            skipped_at=time.time(),
                            cooldown_seconds=self.protected_cooldown,
                        )
                        # Do NOT repeatedly retry permanently skipped protected updates in immediate loop:
                        self.pending_updates.pop(s_id, None)
                        logger.info(f"[BackendApiClient] Slot '{s_id}' is protected by backend ({reason}). Dropped from immediate pending queue.")
                    else:
                        # Transient failure or conflict during update
                        slots_failed.append(s_id)
                        if s_id in self.pending_updates:
                            self.pending_updates[s_id].attempts += 1
                            self.pending_updates[s_id].last_error = reason
                            if self.pending_updates[s_id].attempts >= self.max_retries:
                                self.quarantined_slots[s_id] = reason
                                self.pending_updates.pop(s_id, None)
                                logger.warning(f"[BackendApiClient] Slot '{s_id}' quarantined after {self.max_retries} attempts: {reason}")

                # 2. Check legacy results if present
                elif s_id in legacy_results_map:
                    legacy_item = legacy_results_map[s_id]
                    leg_status = legacy_item.get("status")
                    if leg_status == "updated":
                        slots_updated.append(s_id)
                        self.acknowledged_status[s_id] = confirmed_status
                        self.pending_updates.pop(s_id, None)
                        self.protected_slots.pop(s_id, None)
                    elif leg_status == "unchanged":
                        slots_unchanged.append(s_id)
                        self.acknowledged_status[s_id] = confirmed_status
                        self.pending_updates.pop(s_id, None)
                    elif leg_status == "protected":
                        slots_protected.append(s_id)
                        self.protected_slots[s_id] = ProtectedSlotRecord(
                            slot_id=s_id,
                            reason=legacy_item.get("reason", "Protected"),
                            protected_status=confirmed_status,
                            skipped_at=time.time(),
                            cooldown_seconds=self.protected_cooldown,
                        )
                        self.pending_updates.pop(s_id, None)
                    else:
                        slots_failed.append(s_id)

                # 3. Standard successful update (not in skipped_map)
                else:
                    # AUDIT 2: Pay attention to backend's updated count!
                    # Do not assume absence of slot in skipped automatically proves success
                    # if backend explicitly reported updated=0!
                    if updated_count is not None and isinstance(updated_count, int) and updated_count == 0 and len(updates_to_send) > len(skipped_map):
                        slots_failed.append(s_id)
                        if s_id in self.pending_updates:
                            self.pending_updates[s_id].attempts += 1
                            self.pending_updates[s_id].last_error = "Backend reported updated=0 despite unskipped slots"
                            if self.pending_updates[s_id].attempts >= self.max_retries:
                                self.quarantined_slots[s_id] = self.pending_updates[s_id].last_error
                                self.pending_updates.pop(s_id, None)
                        logger.warning(f"[BackendApiClient] Slot '{s_id}' unconfirmed (backend reported updated=0).")
                    else:
                        slots_updated.append(s_id)
                        self.acknowledged_status[s_id] = confirmed_status
                        self.pending_updates.pop(s_id, None)
                        self.protected_slots.pop(s_id, None)
                        logger.debug(f"[BackendApiClient] Slot '{s_id}' confirmed updated to '{confirmed_status}'.")

            return DispatchResult(
                success=True,
                status_code=200,
                message=response_data.get("message", "CV updates processed successfully"),
                received=int(received_count) if received_count is not None else len(updates_to_send),
                updated=int(updated_count) if updated_count is not None else len(slots_updated),
                slots_updated=slots_updated,
                slots_unchanged=slots_unchanged,
                slots_protected=slots_protected,
                slots_failed=slots_failed,
                raw_response=response_data,
            )

        # Top-level backend rejection (400, 403, 422, 500, etc.) or malformed response
        if isinstance(response_data, dict):
            err_msg = response_data.get("message", f"Backend rejected with HTTP {status_code}")
        else:
            err_msg = f"Backend rejected with HTTP {status_code}: {str(response_data)[:150]}"

        # AUDIT 3: Handle backend stale timestamp error
        # e.g., "Stale or duplicate request rejected for camera CAM-B1-01. Timestamp must be strictly greater than 2026-11-15T01:30:00.000Z"
        if status_code == 400 and "strictly greater than" in err_msg:
            parts = err_msg.split("strictly greater than")
            if len(parts) > 1:
                rejected_ts = parts[1].strip()
                self.timestamp_tracker.advance_past(camera_id, rejected_ts)
            # Reset timestamp on pending updates so next retry generates a fresh, strictly greater timestamp
            for s in updates_to_send:
                if isinstance(s, dict):
                    s_id = s.get("slotId")
                    if s_id and s_id in self.pending_updates:
                        self.pending_updates[s_id].timestamp = ""

        failed_ids = []
        for s in updates_to_send:
            if not isinstance(s, dict):
                continue
            s_id = s.get("slotId")
            if not s_id:
                continue
            failed_ids.append(s_id)
            if s_id in self.pending_updates:
                self.pending_updates[s_id].attempts += 1
                self.pending_updates[s_id].last_error = err_msg
                if self.pending_updates[s_id].attempts >= self.max_retries:
                    self.quarantined_slots[s_id] = err_msg
                    self.pending_updates.pop(s_id, None)
                    logger.warning(f"[BackendApiClient] Slot '{s_id}' quarantined after {self.max_retries} attempts: {err_msg}")

        return DispatchResult(
            success=False,
            status_code=status_code,
            message=err_msg,
            slots_failed=failed_ids,
            raw_response=response_data if isinstance(response_data, dict) else {"raw": str(response_data)[:200]},
        )

    def sync_occupancy(
        self,
        adapter: OccupancyAdapter,
        stabilized_states: Dict[str, Any],
        timestamp: Optional[Union[float, str]] = None,
    ) -> Optional[DispatchResult]:
        """
        Gathers unacknowledged status transitions and pending retries,
        formats a payload conforming to Person B's contract, and sends it to Node.js.

        :param adapter: OccupancyAdapter for the current camera
        :param stabilized_states: Dict mapping slot_id to SlotTemporalState
        :param timestamp: Optional frame timestamp
        :returns: DispatchResult if an HTTP transmission occurred, None if duplicate/suppressed
        """
        # Guard: Uncalibrated cameras do not transmit operational updates
        if adapter.needs_calibration:
            return None

        camera_id = adapter.camera_id

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

            consec_occ_int = int(consec_occupied)
            consec_avail_int = int(consec_available)

            # ISSUE 2 GATE:
            # Backend strictly requires:
            # - Occupied: consecutiveOccupiedFrames >= 3
            # - Available: consecutiveAvailableFrames >= 5
            # Do NOT transmit initial available state with zero (or < 5) frames!
            if confirmed_status == "occupied" and consec_occ_int < 3:
                continue
            if confirmed_status == "available" and consec_avail_int < 5:
                continue

            ack_status = self.acknowledged_status.get(s_id)

            # AUDIT 1: Protected Slot Lifecycle Check
            if s_id in self.protected_slots:
                prot = self.protected_slots[s_id]
                # Check A: Has the CV confirmed status changed?
                # (e.g. car parked in reserved bay or left)
                if confirmed_status != prot.protected_status:
                    logger.info(
                        f"[BackendApiClient] Slot '{s_id}' state changed from '{prot.protected_status}' "
                        f"to '{confirmed_status}'. Releasing protection."
                    )
                    self.protected_slots.pop(s_id, None)
                # Check B: Has the cooldown interval elapsed?
                # (Reservation or maintenance may have been cancelled or expired in backend)
                elif prot.is_expired():
                    logger.info(
                        f"[BackendApiClient] Slot '{s_id}' protection cooldown elapsed ({prot.cooldown_seconds}s). "
                        "Re-checking with backend."
                    )
                    self.protected_slots.pop(s_id, None)
                else:
                    # Still protected and status unchanged -> skip queueing to avoid redundant requests
                    continue

            # Check if this status differs from what backend has confirmed
            if confirmed_status != ack_status:
                if s_id in self.pending_updates:
                    pending = self.pending_updates[s_id]
                    if pending.confirmed_status != confirmed_status:
                        # State has changed while in pending queue -> reset for new state
                        pending.confirmed_status = confirmed_status
                        pending.is_monitored = bool(is_monitored)
                        pending.consecutive_occupied_frames = consec_occ_int
                        pending.consecutive_available_frames = consec_avail_int
                        pending.attempts = 0
                        pending.last_error = None
                        pending.timestamp = ""
                    else:
                        # Existing pending update with same state -> retain attempts, update counters
                        pending.consecutive_occupied_frames = consec_occ_int
                        pending.consecutive_available_frames = consec_avail_int
                else:
                    self.pending_updates[s_id] = PendingSlotUpdate(
                        slot_id=s_id,
                        confirmed_status=confirmed_status,
                        is_monitored=bool(is_monitored),
                        consecutive_occupied_frames=consec_occ_int,
                        consecutive_available_frames=consec_avail_int,
                        timestamp="",
                    )

        # 2. Check if we have any pending updates to transmit
        if not self.pending_updates:
            # Duplicate suppression: state is already identical in backend
            return None

        # 3. Assemble batch of updates to transmit
        pending_batch: List[PendingSlotUpdate] = []
        for pending in list(self.pending_updates.values()):
            if pending.attempts < self.max_retries:
                pending_batch.append(pending)

        if not pending_batch:
            return None

        # 4. AUDIT 3: Strictly increasing timestamp generation per camera
        # Check if this is a pure retry of an existing request that had a network/timeout failure
        reusable_timestamp = None
        if all(p.attempts > 0 and p.timestamp for p in pending_batch):
            # Same pending batch being retried without new additions
            first_ts = pending_batch[0].timestamp
            if all(p.timestamp == first_ts for p in pending_batch):
                reusable_timestamp = first_ts

        if reusable_timestamp:
            iso_timestamp = reusable_timestamp
        else:
            iso_timestamp = self.timestamp_tracker.get_strictly_increasing_timestamp(
                camera_id=camera_id,
                desired_time=timestamp,
            )
            for p in pending_batch:
                p.timestamp = iso_timestamp

        request_body = {
            "cameraId": camera_id,
            "timestamp": iso_timestamp,
            "updates": [p.to_dict() for p in pending_batch],
        }

        # 5. Dispatch and process acknowledgment
        return self.send_payload(request_body)
