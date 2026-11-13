"""
Occupancy Adapter: Backend-Ready Occupancy Normalizer & Transition Detector
Smart Mall Parking Management System (cv-service)

Prepares clean, normalized representations of confirmed parking-slot occupancy
for downstream consumption by the Node.js / Express backend.

Key Responsibilities:
1. Validates camera configuration and ensures slot IDs conform to canonical topology.
2. Respects camera calibration flags (e.g. CAM-B1-02 needs_calibration: true).
3. Formats confirmed stabilized states into the standardized backend structure:
   {
       "cameraId": "CAM-B1-01",
       "timestamp": "ISO-8601 string",
       "slots": [
           {"slotId": "B1-A01", "status": "occupied", "vehicleType": "car"},
           {"slotId": "B1-A02", "status": "available"}
       ]
   }
4. Enforces definitive status rules:
   - Only 'available' and 'occupied' are emitted for operational updates.
   - 'uncertain' is NEVER converted to 'available'.
   - 'not_monitored' or uncalibrated slots NEVER produce 'available' updates.
   - No fabricated vehicle types or confidence scores.
5. Tracks state transitions per camera instance:
   - Detects transitions: available -> occupied, occupied -> available.
   - Suppresses duplicate transition events for unchanged states.
   - Maintains strict independence across camera instances.
"""

import os
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple, Set, Union

from config.topology import ALL_SLOT_IDS, FLOORS
from utils.roi_utils import load_slots_config, DEFAULT_CONFIG_PATH


# Mapping from YOLOv8 / CV vehicle detection classes to canonical backend vehicle types
VEHICLE_TYPE_NORMALIZATION: Dict[str, str] = {
    "car": "car",
    "motorcycle": "bike",
    "bike": "bike",
}

# Operational statuses permitted for backend occupancy synchronization
OPERATIONAL_STATUSES: Set[str] = {"available", "occupied"}


def normalize_vehicle_type(vehicle_class: Optional[str]) -> Optional[str]:
    """
    Normalizes CV detection class names into canonical backend vehicle types.
    e.g. 'car' -> 'car', 'motorcycle' -> 'bike'.
    Returns None if vehicle_class is empty or unmapped.
    """
    if not vehicle_class or not isinstance(vehicle_class, str):
        return None
    normalized_key = vehicle_class.strip().lower()
    return VEHICLE_TYPE_NORMALIZATION.get(normalized_key, None)


def get_iso_timestamp(timestamp: Optional[Union[float, str]] = None) -> str:
    """
    Generates an ISO-8601 UTC timestamp string.
    If a float timestamp (seconds) is provided, uses it; otherwise uses current UTC time.
    """
    if isinstance(timestamp, str) and "T" in timestamp:
        return timestamp
    if isinstance(timestamp, (int, float)) and timestamp > 0:
        dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
    else:
        dt = datetime.now(timezone.utc)
    return dt.isoformat()


class OccupancyAdapter:
    """
    Camera-specific output adapter for confirmed parking bay occupancy.
    Maintains independent emission history to detect real status transitions.
    """

    def __init__(
        self,
        camera_id: str = "CAM-B1-01",
        slots_config: Optional[Dict[str, Any]] = None,
        config_path: str = DEFAULT_CONFIG_PATH,
    ):
        """
        Initializes the occupancy adapter for a specific camera.

        :param camera_id: Target camera identifier (e.g. 'CAM-B1-01')
        :param slots_config: Optional pre-loaded ROI configuration dictionary
        :param config_path: Path to slots_config.json if config not pre-loaded
        """
        self.camera_id = camera_id
        self.config_path = config_path
        self.slots_config = slots_config or load_slots_config(self.config_path)

        # Validate and resolve camera metadata from config
        self.camera_entry = self._resolve_camera_entry()
        self.floor = self.camera_entry.get("floor", "B1")
        self.needs_calibration = bool(self.camera_entry.get("needs_calibration", False))
        self.assigned_slots = self._resolve_assigned_slots()

        # State transition tracking (isolated per camera instance)
        self.last_emitted_status: Dict[str, str] = {}
        self.last_emitted_vehicle: Dict[str, Optional[str]] = {}

    def _resolve_camera_entry(self) -> Dict[str, Any]:
        """Finds the camera definition in slots_config."""
        for cam in self.slots_config.get("cameras", []):
            if cam.get("cameraId") == self.camera_id:
                return cam
        raise ValueError(
            f"[OccupancyAdapter] Camera '{self.camera_id}' not found in configuration. "
            f"Configured: {[c.get('cameraId') for c in self.slots_config.get('cameras', [])]}"
        )

    def _resolve_assigned_slots(self) -> List[str]:
        """Resolves and validates slot IDs assigned to this camera."""
        slots = []
        for slot in self.camera_entry.get("slots", []):
            s_id = slot.get("slotId")
            if s_id and s_id in ALL_SLOT_IDS:
                slots.append(s_id)
        return slots

    def reset_transition_state(self) -> None:
        """Resets the transition tracking history for this camera."""
        self.last_emitted_status.clear()
        self.last_emitted_vehicle.clear()

    def build_slot_record(
        self,
        slot_id: str,
        state_or_dict: Any,
    ) -> Optional[Dict[str, Any]]:
        """
        Formats a single slot's confirmed status into the normalized backend record.

        Rules:
        - Must be assigned to this camera.
        - Must exist in canonical topology.
        - If camera requires calibration, returns None (no operational data).
        - Must be in OPERATIONAL_STATUSES ('available', 'occupied').
        - 'uncertain' and 'not_monitored' return None.
        - 'vehicleType' is included only when occupied and reliably detected.

        :param slot_id: Canonical slot identifier (e.g. 'B1-A01')
        :param state_or_dict: SlotTemporalState instance or dict representation
        :returns: Formatted dictionary or None if ineligible for operational reporting
        """
        # Guard: Uncalibrated camera cannot produce operational updates
        if self.needs_calibration:
            return None

        # Guard: Slot must belong to this camera
        if slot_id not in self.assigned_slots:
            return None

        # Guard: Canonical topology verification
        if slot_id not in ALL_SLOT_IDS:
            return None

        # Extract fields from SlotTemporalState or dict
        if hasattr(state_or_dict, "confirmed_status"):
            confirmed_status = state_or_dict.confirmed_status
            vehicle_class = getattr(state_or_dict, "vehicle_class", None)
            confidence = getattr(state_or_dict, "confidence", 0.0)
            is_monitored = getattr(state_or_dict, "is_monitored", True)
        elif isinstance(state_or_dict, dict):
            confirmed_status = state_or_dict.get("confirmedStatus") or state_or_dict.get("confirmed_status")
            vehicle_class = state_or_dict.get("vehicleClass") or state_or_dict.get("vehicle_class")
            confidence = state_or_dict.get("confidence", 0.0)
            is_monitored = state_or_dict.get("isMonitored", state_or_dict.get("is_monitored", True))
        else:
            return None

        # Guard: Unmonitored slots never produce operational updates
        if not is_monitored or confirmed_status == "not_monitored":
            return None

        # Guard: Only definitive operational statuses permitted (reject 'uncertain', 'reserved', 'maintenance')
        if confirmed_status not in OPERATIONAL_STATUSES:
            return None

        record: Dict[str, Any] = {
            "slotId": slot_id,
            "status": confirmed_status,
        }

        # Include vehicleType ONLY when occupied and reliably detected
        if confirmed_status == "occupied":
            normalized_vtype = normalize_vehicle_type(vehicle_class)
            if normalized_vtype:
                record["vehicleType"] = normalized_vtype
            if confidence and confidence > 0.0:
                record["confidence"] = round(float(confidence), 4)

        return record

    def build_update_record(
        self,
        slot_id: str,
        state_or_dict: Any,
    ) -> Optional[Dict[str, Any]]:
        """
        Formats a single slot's confirmed status into the final backend update record.

        Strict Contract (Person B):
        {
            "slotId": "B1-A01",
            "confirmedStatus": "occupied",
            "isMonitored": True,
            "consecutiveOccupiedFrames": 3,
            "consecutiveAvailableFrames": 0
        }

        Rules:
        - Must be assigned to this camera.
        - Must exist in canonical topology.
        - If camera requires calibration, returns None (no operational data).
        - Must be in OPERATIONAL_STATUSES ('available', 'occupied').
        - 'uncertain' and 'not_monitored' return None.
        - Frame counters come directly from CV temporal stabilization engine.
        - Does NOT contain slots[], status, vehicleType, confidence.

        :param slot_id: Canonical slot identifier (e.g. 'B1-A01')
        :param state_or_dict: SlotTemporalState instance or dict representation
        :returns: Formatted dictionary strictly conforming to final API contract, or None
        """
        # Guard: Uncalibrated camera cannot produce operational updates
        if self.needs_calibration:
            return None

        # Guard: Slot must belong to this camera
        if slot_id not in self.assigned_slots:
            return None

        # Guard: Canonical topology verification
        if slot_id not in ALL_SLOT_IDS:
            return None

        # Extract fields from SlotTemporalState or dict
        if hasattr(state_or_dict, "confirmed_status"):
            confirmed_status = state_or_dict.confirmed_status
            is_monitored = getattr(state_or_dict, "is_monitored", True)
            consec_occupied = getattr(state_or_dict, "consecutive_occupied_frames", 0)
            consec_available = getattr(state_or_dict, "consecutive_available_frames", 0)
        elif isinstance(state_or_dict, dict):
            confirmed_status = state_or_dict.get("confirmedStatus") or state_or_dict.get("confirmed_status")
            is_monitored = state_or_dict.get("isMonitored", state_or_dict.get("is_monitored", True))
            consec_occupied = state_or_dict.get("consecutiveOccupiedFrames", state_or_dict.get("consecutive_occupied_frames", 0))
            consec_available = state_or_dict.get("consecutiveAvailableFrames", state_or_dict.get("consecutive_available_frames", 0))
        else:
            return None

        # Guard: Unmonitored slots never produce operational updates
        if not is_monitored or confirmed_status == "not_monitored":
            return None

        # Guard: Only definitive operational statuses permitted ('available', 'occupied')
        if confirmed_status not in OPERATIONAL_STATUSES:
            return None

        return {
            "slotId": slot_id,
            "confirmedStatus": confirmed_status,
            "isMonitored": bool(is_monitored),
            "consecutiveOccupiedFrames": int(consec_occupied),
            "consecutiveAvailableFrames": int(consec_available),
        }

    def build_backend_payload(
        self,
        stabilized_states: Dict[str, Any],
        timestamp: Optional[Union[float, str]] = None,
    ) -> Dict[str, Any]:
        """
        Produces the exact final request body expected by Person B's backend endpoint:
        POST /api/slots/cv-update

        Payload Schema:
        {
            "cameraId": "CAM-B1-01",
            "timestamp": "2026-11-13T10:00:00.000Z",
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
        """
        iso_ts = get_iso_timestamp(timestamp)

        if self.needs_calibration:
            return {
                "cameraId": self.camera_id,
                "timestamp": iso_ts,
                "needsCalibration": True,
                "updates": [],
            }

        updates: List[Dict[str, Any]] = []
        for s_id in self.assigned_slots:
            state = stabilized_states.get(s_id)
            if state is not None:
                record = self.build_update_record(s_id, state)
                if record is not None:
                    updates.append(record)

        return {
            "cameraId": self.camera_id,
            "timestamp": iso_ts,
            "updates": updates,
        }

    def get_normalized_snapshot(
        self,
        stabilized_states: Dict[str, Any],
        timestamp: Optional[Union[float, str]] = None,
    ) -> Dict[str, Any]:
        """
        Produces the normalized occupancy snapshot for this camera.
        Includes both 'updates' (final contract) and 'slots' (backward compatibility).
        """
        iso_ts = get_iso_timestamp(timestamp)

        if self.needs_calibration:
            return {
                "cameraId": self.camera_id,
                "floor": self.floor,
                "timestamp": iso_ts,
                "needsCalibration": True,
                "calibrationWarning": (
                    f"Camera '{self.camera_id}' is marked with needs_calibration=true. "
                    "Placeholder coordinates are not production-ready; operational reporting suppressed."
                ),
                "totalConfiguredSlots": len(self.assigned_slots),
                "activeSlotsCount": 0,
                "updates": [],
                "slots": [],
            }

        slot_records: List[Dict[str, Any]] = []
        update_records: List[Dict[str, Any]] = []
        for s_id in self.assigned_slots:
            state = stabilized_states.get(s_id)
            if state is not None:
                record = self.build_slot_record(s_id, state)
                if record is not None:
                    slot_records.append(record)
                upd_record = self.build_update_record(s_id, state)
                if upd_record is not None:
                    update_records.append(upd_record)

        return {
            "cameraId": self.camera_id,
            "floor": self.floor,
            "timestamp": iso_ts,
            "needsCalibration": False,
            "totalConfiguredSlots": len(self.assigned_slots),
            "activeSlotsCount": len(update_records),
            "updates": update_records,
            "slots": slot_records,
        }

    def detect_status_transitions(
        self,
        stabilized_states: Dict[str, Any],
        timestamp: Optional[Union[float, str]] = None,
        emit_initial: bool = True,
    ) -> Optional[Dict[str, Any]]:
        """
        Evaluates stabilized slot states against last-emitted status to detect
        confirmed transitions (e.g. available -> occupied, occupied -> available).

        Rules:
        - If no transition occurred, returns None (avoids duplicate events).
        - If a slot is 'uncertain', it does NOT trigger a transition.
        - Missing observations do NOT trigger an 'available' transition.
        - If emit_initial=True, the first time a slot reaches a definitive
          operational state, it is emitted as an initial confirmed event.

        :param stabilized_states: Dict of slot_id -> SlotTemporalState
        :param timestamp: Optional timestamp
        :param emit_initial: Whether to emit the first confirmed state as a transition
        :returns: Transition payload dictionary or None if no changes detected
        """
        if self.needs_calibration:
            return None

        iso_ts = get_iso_timestamp(timestamp)
        transition_records: List[Dict[str, Any]] = []
        changed_slot_records: List[Dict[str, Any]] = []
        changed_update_records: List[Dict[str, Any]] = []

        for s_id in self.assigned_slots:
            state = stabilized_states.get(s_id)
            if state is None:
                continue

            # Extract confirmed status
            if hasattr(state, "confirmed_status"):
                confirmed_status = state.confirmed_status
                vehicle_class = getattr(state, "vehicle_class", None)
            elif isinstance(state, dict):
                confirmed_status = state.get("confirmedStatus") or state.get("confirmed_status")
                vehicle_class = state.get("vehicleClass") or state.get("vehicle_class")
            else:
                continue

            # Guard: Transitions ONLY occur between definitive operational states
            # Uncertain or unmonitored states never trigger operational transitions
            if confirmed_status not in OPERATIONAL_STATUSES:
                continue

            prev_status = self.last_emitted_status.get(s_id)
            prev_vehicle = self.last_emitted_vehicle.get(s_id)
            norm_vehicle = normalize_vehicle_type(vehicle_class) if confirmed_status == "occupied" else None

            # Check if this represents a status transition or initial confirmation
            is_initial = prev_status is None and emit_initial
            is_status_change = prev_status is not None and prev_status != confirmed_status
            is_vehicle_change = (
                prev_status == "occupied"
                and confirmed_status == "occupied"
                and prev_vehicle != norm_vehicle
                and norm_vehicle is not None
            )

            if is_initial or is_status_change or is_vehicle_change:
                # Update emission history
                self.last_emitted_status[s_id] = confirmed_status
                self.last_emitted_vehicle[s_id] = norm_vehicle

                slot_rec = self.build_slot_record(s_id, state)
                if slot_rec:
                    changed_slot_records.append(slot_rec)
                upd_rec = self.build_update_record(s_id, state)
                if upd_rec:
                    changed_update_records.append(upd_rec)

                transition_records.append({
                    "slotId": s_id,
                    "fromStatus": prev_status,
                    "toStatus": confirmed_status,
                    "transitionType": "initial" if is_initial else "status_change",
                    "vehicleType": norm_vehicle,
                })

        if not transition_records:
            return None

        return {
            "cameraId": self.camera_id,
            "floor": self.floor,
            "timestamp": iso_ts,
            "transitionCount": len(transition_records),
            "updates": changed_update_records,
            "slots": changed_slot_records,
            "transitions": transition_records,
        }

    @classmethod
    def validate_camera_topology(
        cls,
        slots_config: Optional[Dict[str, Any]] = None,
        config_path: str = DEFAULT_CONFIG_PATH,
    ) -> Dict[str, Any]:
        """
        Validates the complete camera-to-slot mapping topology across all cameras.

        Verifies:
        1. Each camera has a valid camera ID.
        2. Configured slots exist in canonical topology (ALL_SLOT_IDS).
        3. Floor assignments match (e.g. B1 camera manages B1 slots).
        4. No slot is assigned to multiple cameras.
        5. Reports calibration status (flags CAM-B1-02).
        """
        config = slots_config or load_slots_config(config_path)
        cameras = config.get("cameras", [])

        report: Dict[str, Any] = {
            "isValid": True,
            "errors": [],
            "warnings": [],
            "cameraSummary": {},
            "totalConfiguredSlots": 0,
            "canonicalSlotsCovered": 0,
        }

        all_assigned_slots: Dict[str, str] = {}  # slotId -> cameraId

        for cam in cameras:
            cam_id = cam.get("cameraId")
            floor = cam.get("floor")
            needs_cal = bool(cam.get("needs_calibration", False))
            slots = cam.get("slots", [])

            if not cam_id or not isinstance(cam_id, str):
                report["isValid"] = False
                report["errors"].append(f"Camera entry missing valid cameraId: {cam}")
                continue

            if floor not in FLOORS:
                report["isValid"] = False
                report["errors"].append(f"Camera '{cam_id}' has invalid floor '{floor}'. Allowed: {FLOORS}")

            slot_ids = []
            for slot in slots:
                s_id = slot.get("slotId")
                if not s_id:
                    report["isValid"] = False
                    report["errors"].append(f"Camera '{cam_id}' contains slot missing 'slotId'")
                    continue

                if s_id not in ALL_SLOT_IDS:
                    report["isValid"] = False
                    report["errors"].append(
                        f"Camera '{cam_id}': slotId '{s_id}' does not exist in canonical topology"
                    )

                if not s_id.startswith(f"{floor}-"):
                    report["isValid"] = False
                    report["errors"].append(
                        f"Camera '{cam_id}' (Floor {floor}) assigned slot '{s_id}' with floor mismatch"
                    )

                if s_id in all_assigned_slots:
                    report["isValid"] = False
                    report["errors"].append(
                        f"Slot '{s_id}' is assigned to multiple cameras: "
                        f"'{all_assigned_slots[s_id]}' and '{cam_id}'"
                    )
                else:
                    all_assigned_slots[s_id] = cam_id

                slot_ids.append(s_id)

            if needs_cal:
                report["warnings"].append(
                    f"Camera '{cam_id}' is marked with needs_calibration=true. "
                    f"Slots {slot_ids} require physical calibration before production use."
                )

            report["cameraSummary"][cam_id] = {
                "floor": floor,
                "needsCalibration": needs_cal,
                "slotCount": len(slot_ids),
                "slots": slot_ids,
            }

        report["totalConfiguredSlots"] = len(all_assigned_slots)
        report["canonicalSlotsCovered"] = len(set(all_assigned_slots.keys()).intersection(set(ALL_SLOT_IDS)))

        return report
