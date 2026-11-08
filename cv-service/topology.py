"""
Shared Parking Topology Definition for Smart Mall Parking System (CV Service Root)

Re-exports canonical definitions from config.topology for modular import access.
Preserves exact floors, slot IDs, gates, ramps, junctions, and statuses.
"""

from config.topology import (
    FLOORS,
    PARKING_STATUSES,
    GATES,
    RAMP_NODES,
    JUNCTIONS,
    SLOTS_B1,
    SLOTS_B2,
    ALL_SLOT_IDS,
    TOPOLOGY,
)

__all__ = [
    "FLOORS",
    "PARKING_STATUSES",
    "GATES",
    "RAMP_NODES",
    "JUNCTIONS",
    "SLOTS_B1",
    "SLOTS_B2",
    "ALL_SLOT_IDS",
    "TOPOLOGY",
]
