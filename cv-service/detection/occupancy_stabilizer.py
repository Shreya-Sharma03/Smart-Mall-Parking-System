"""
Occupancy Stabilizer: Temporal Parking Bay Confirmation Engine
Milestone 5 - Smart Mall Parking Management System

Provides temporal confirmation of parking bay occupancy across video frames:
1. Occupied Confirmation: Requires consistent vehicle mapping across 3 consecutive frames.
2. Available Confirmation: Requires absence of vehicles across 5 consecutive frames.
3. Temporary Dropout Tolerance: A temporarily missed vehicle does not immediately vacate a slot.
4. Ambiguity / Conflict Isolation: Ambiguous mappings conservatively flag slot as 'uncertain'.
5. Status Preservation: Pre-configured 'reserved' and 'maintenance' statuses are preserved.
6. Multi-Slot Exclusion: Prevents one tracked vehicle from occupying multiple bays simultaneously.
"""

from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Tuple, Set

from detection.slot_mapper import FrameMappingResult, SlotOccupancyCandidate, MappedVehicle
from detection.tracker import TrackedVehicle


@dataclass
class StabilizerConfig:
    """
    Configurable confirmation thresholds for temporal occupancy stabilization.
    """
    occupied_threshold: int = 3      # Consecutive frames mapped before slot is confirmed 'occupied'
    available_threshold: int = 5     # Consecutive frames empty before slot is confirmed 'available'
    uncertain_threshold: int = 1     # Consecutive ambiguous frames before slot is confirmed 'uncertain'
    grace_dropout_frames: int = 3    # Frames an established vehicle can be absent before drop countdown begins
    conflict_grace_frames: int = 2   # Max consecutive conflict frames a *confirmed-occupied* slot may absorb
                                     # before transitioning to uncertain. An isolated 1-frame glitch (< 2)
                                     # is absorbed conservatively — the occupied state is retained.


@dataclass
class SlotTemporalState:
    """
    Persistent temporal occupancy state for an individual parking bay.
    """
    slot_id: str
    floor: str
    camera_id: str
    confirmed_status: str            # 'available', 'occupied', 'uncertain', 'reserved', 'maintenance', 'not_monitored'
    raw_status: str                  # Latest single-frame candidate status from SlotMapper
    consecutive_occupied_frames: int = 0
    consecutive_available_frames: int = 0
    consecutive_uncertain_frames: int = 0
    consecutive_conflict_frames: int = 0  # Tracks how many consecutive conflict/uncertain frames occurred
                                          # while the slot was in a confirmed-occupied state.
    associated_track_id: Optional[int] = None
    vehicle_class: Optional[str] = None
    confidence: float = 0.0
    confirmation_progress: str = ""  # e.g., "3/3 confirmed", "2/5 vacating", "2/3 arriving"
    is_conflict: bool = False
    conflict_details: Optional[str] = None
    is_monitored: bool = True
    history: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "slotId": self.slot_id,
            "floor": self.floor,
            "cameraId": self.camera_id,
            "confirmedStatus": self.confirmed_status,
            "rawCandidateStatus": self.raw_status,
            "consecutiveOccupiedFrames": int(self.consecutive_occupied_frames),
            "consecutiveAvailableFrames": int(self.consecutive_available_frames),
            "consecutiveUncertainFrames": int(self.consecutive_uncertain_frames),
            "consecutiveConflictFrames": int(self.consecutive_conflict_frames),
            "associatedTrackId": self.associated_track_id,
            "vehicleClass": self.vehicle_class,
            "confidence": round(float(self.confidence), 4),
            "confirmationProgress": self.confirmation_progress,
            "isConflict": bool(self.is_conflict),
            "conflictDetails": self.conflict_details,
            "isMonitored": bool(self.is_monitored),
        }


class OccupancyStabilizer:
    """
    Maintains temporal state for all monitored parking bays and applies
    hysteresis-based confirmation to eliminate flicker and false vacancies.
    """

    def __init__(
        self,
        config: Optional[StabilizerConfig] = None,
        override_statuses: Optional[Dict[str, str]] = None,
    ):
        """
        :param config: StabilizerConfig parameters
        :param override_statuses: Optional map of slot_id -> 'reserved' | 'maintenance'
        """
        self.config = config or StabilizerConfig()
        self.override_statuses: Dict[str, str] = override_statuses or {}
        self.slots_state: Dict[str, SlotTemporalState] = {}
        self.frame_number: int = 0

    def set_override_status(self, slot_id: str, status: str) -> None:
        """Sets a reserved or maintenance override that camera vision cannot overwrite."""
        self.override_statuses[slot_id] = status
        if slot_id in self.slots_state:
            self.slots_state[slot_id].confirmed_status = status
            self.slots_state[slot_id].confirmation_progress = f"locked: {status}"

    def reset(self) -> None:
        """Resets all temporal history."""
        self.slots_state = {}
        self.frame_number = 0

    def update(
        self,
        mapping_result: FrameMappingResult,
        tracked_vehicles: Optional[List[TrackedVehicle]] = None,
    ) -> Dict[str, SlotTemporalState]:
        """
        Updates temporal occupancy states based on the latest single-frame mapping result.

        :param mapping_result: FrameMappingResult from SlotMapper
        :param tracked_vehicles: Optional list of active TrackedVehicle objects from VehicleTracker
        :returns: Dict mapping slot_id to SlotTemporalState
        """
        self.frame_number += 1
        tracked_by_id = {t.track_id: t for t in (tracked_vehicles or [])}

        # Build mapping of slot_id -> list of mapped vehicles for this frame
        slot_mapped_vehicles: Dict[str, List[MappedVehicle]] = {}
        for v in mapping_result.mapped_vehicles:
            if v.slot_id:
                slot_mapped_vehicles.setdefault(v.slot_id, []).append(v)

        # 1. Enforce vehicle exclusivity across slots
        # If the same vehicle (or track ID) is claimed by multiple slots, assign it
        # to the highest-scoring slot and flag conflict on the others.
        assigned_vehicles: Dict[Any, Tuple[str, float]] = {}  # track_id/bbox -> (slot_id, score)
        for s_id, vehicles in list(slot_mapped_vehicles.items()):
            for v in vehicles:
                veh_key = getattr(v, "track_id", None) or tuple(v.bounding_box)
                if veh_key in assigned_vehicles:
                    other_slot, other_score = assigned_vehicles[veh_key]
                    if v.overlap_score > other_score:
                        # Current slot wins; previous slot loses assignment
                        slot_mapped_vehicles[other_slot] = [
                            ov for ov in slot_mapped_vehicles[other_slot]
                            if (getattr(ov, "track_id", None) or tuple(ov.bounding_box)) != veh_key
                        ]
                        assigned_vehicles[veh_key] = (s_id, v.overlap_score)
                    else:
                        # Other slot wins; current slot loses this vehicle
                        slot_mapped_vehicles[s_id] = [
                            ov for ov in slot_mapped_vehicles[s_id]
                            if (getattr(ov, "track_id", None) or tuple(ov.bounding_box)) != veh_key
                        ]
                else:
                    assigned_vehicles[veh_key] = (s_id, v.overlap_score)

        # 2. Update temporal state for every candidate slot
        for s_id, cand in mapping_result.slot_candidates.items():
            floor = cand.floor
            cam_id = cand.camera_id

            # Initialize state if first time seeing this slot
            if s_id not in self.slots_state:
                if s_id in self.override_statuses:
                    init_status = self.override_statuses[s_id]
                elif not cand.is_monitored or cand.candidate_status == "not_monitored":
                    init_status = "not_monitored"
                else:
                    init_status = "available"
                self.slots_state[s_id] = SlotTemporalState(
                    slot_id=s_id,
                    floor=floor,
                    camera_id=cam_id,
                    confirmed_status=init_status,
                    raw_status=cand.candidate_status,
                    is_monitored=cand.is_monitored,
                )

            state = self.slots_state[s_id]
            state.raw_status = cand.candidate_status
            state.is_monitored = cand.is_monitored

            # Preservation Rule: Reserved or Maintenance statuses must NEVER be overwritten by camera
            if s_id in self.override_statuses:
                state.confirmed_status = self.override_statuses[s_id]
                state.confirmation_progress = f"locked: {state.confirmed_status}"
                state.is_conflict = False
                continue

            # Preservation Rule: Not monitored slots retain not_monitored
            if not cand.is_monitored or cand.candidate_status == "not_monitored":
                state.confirmed_status = "not_monitored"
                state.confirmation_progress = "unmonitored"
                state.is_conflict = False
                continue

            # Evaluate effective single-frame status after exclusivity resolution
            effective_claimants = slot_mapped_vehicles.get(s_id, [])
            raw_cand_status = cand.candidate_status
            is_cand_conflict = bool(cand.conflict_details is not None or raw_cand_status == "uncertain")

            if is_cand_conflict or len(effective_claimants) > 1 or raw_cand_status == "uncertain":
                effective_status = "uncertain"
            elif len(effective_claimants) == 1:
                effective_status = "occupied"
            else:
                effective_status = "available"

            # -------------------------------------------------------------
            # Temporal Stabilization State Machine
            # -------------------------------------------------------------
            if effective_status == "occupied":
                claimant = effective_claimants[0]
                state.consecutive_occupied_frames += 1
                state.consecutive_available_frames = 0
                state.consecutive_uncertain_frames = 0
                state.consecutive_conflict_frames = 0  # Clean frame — reset conflict grace counter
                state.is_conflict = False
                state.conflict_details = None
                state.vehicle_class = claimant.vehicle_class
                state.confidence = claimant.confidence
                state.associated_track_id = getattr(claimant, "track_id", None)

                if state.consecutive_occupied_frames >= self.config.occupied_threshold:
                    state.confirmed_status = "occupied"
                    state.confirmation_progress = f"{self.config.occupied_threshold}/{self.config.occupied_threshold} confirmed"
                else:
                    # Still in arrival confirmation phase
                    if state.confirmed_status != "occupied":
                        state.confirmation_progress = (
                            f"{state.consecutive_occupied_frames}/{self.config.occupied_threshold} confirming"
                        )
                    else:
                        state.confirmation_progress = "occupied"

            elif effective_status == "available":
                state.consecutive_available_frames += 1
                state.consecutive_occupied_frames = 0
                state.consecutive_uncertain_frames = 0
                state.consecutive_conflict_frames = 0  # Not a conflict — reset grace counter
                state.is_conflict = False

                if state.confirmed_status == "occupied":
                    # Established occupied bay temporarily losing detection (hysteresis grace period)
                    if state.consecutive_available_frames >= self.config.available_threshold:
                        # 5 consecutive empty frames elapsed -> Confirm vacancy
                        state.confirmed_status = "available"
                        state.associated_track_id = None
                        state.vehicle_class = None
                        state.confirmation_progress = f"{self.config.available_threshold}/{self.config.available_threshold} confirmed"
                    else:
                        # Retain occupied status during grace period
                        state.confirmation_progress = (
                            f"{state.consecutive_available_frames}/{self.config.available_threshold} vacating"
                        )
                else:
                    # Slot was not occupied
                    if state.consecutive_available_frames >= self.config.available_threshold:
                        state.confirmed_status = "available"
                        state.associated_track_id = None
                        state.confirmation_progress = "available"
                    else:
                        state.confirmed_status = "available"
                        state.confirmation_progress = (
                            f"{state.consecutive_available_frames}/{self.config.available_threshold} confirming"
                        )

            elif effective_status == "uncertain":
                state.consecutive_uncertain_frames += 1
                state.consecutive_available_frames = 0
                state.consecutive_occupied_frames = 0
                state.is_conflict = True
                state.conflict_details = cand.conflict_details or cand.notes or "Ambiguous vehicle-slot association"

                if state.confirmed_status == "occupied":
                    # Grace mechanism: an already-confirmed occupied bay can absorb up to
                    # config.conflict_grace_frames consecutive conflict events (e.g. a 1-frame
                    # measurement glitch from a 1-px YOLO bbox shift) before transitioning to
                    # uncertain. Persistent or repeated conflicts still produce uncertain.
                    state.consecutive_conflict_frames += 1
                    if state.consecutive_conflict_frames > self.config.conflict_grace_frames:
                        # Persistent conflict — transition to uncertain
                        state.confirmed_status = "uncertain"
                        state.confirmation_progress = "uncertain/conflict"
                    else:
                        # Isolated transient conflict — retain occupied conservatively
                        state.confirmation_progress = (
                            f"occupied (transient conflict {state.consecutive_conflict_frames}/"
                            f"{self.config.conflict_grace_frames})"
                        )
                else:
                    # Slot not yet confirmed occupied — immediately mark uncertain
                    # (conservative rule for arriving or unconfirmed bays)
                    state.consecutive_conflict_frames += 1
                    if state.consecutive_uncertain_frames >= self.config.uncertain_threshold:
                        state.confirmed_status = "uncertain"
                        state.confirmation_progress = "uncertain/conflict"

            # Record history (keep last 30 frames)
            state.history.append(state.confirmed_status)
            if len(state.history) > 30:
                state.history.pop(0)

        return self.slots_state

    def get_summary_counts(self) -> Dict[str, int]:
        """Calculates current aggregate stabilized occupancy counts."""
        monitored = [s for s in self.slots_state.values() if s.is_monitored]
        return {
            "total_monitored": len(monitored),
            "occupied": sum(1 for s in monitored if s.confirmed_status == "occupied"),
            "available": sum(1 for s in monitored if s.confirmed_status == "available"),
            "uncertain": sum(1 for s in monitored if s.confirmed_status == "uncertain"),
            "reserved": sum(1 for s in monitored if s.confirmed_status == "reserved"),
            "maintenance": sum(1 for s in monitored if s.confirmed_status == "maintenance"),
        }
