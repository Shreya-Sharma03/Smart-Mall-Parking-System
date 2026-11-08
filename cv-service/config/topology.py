"""
Shared Parking Topology Definition for Smart Mall Parking System (CV Service)

Provides canonical definitions of:
- Floors: B1, B2
- Slots: B1-A01 to B1-A12, B2-A01 to B2-A12 (24 total)
- Gates: B1-GA, B1-GB
- Ramp Nodes: B1-R1, B2-R1
- Junctions: B1-J1..J3, B2-J1..J3
- Statuses: available, occupied, reserved, maintenance
"""

from typing import List, Dict

FLOORS: List[str] = ["B1", "B2"]

PARKING_STATUSES: List[str] = [
    "available",
    "occupied",
    "reserved",
    "maintenance"
]

GATES: List[Dict[str, str]] = [
    {"id": "B1-GA", "name": "Gate A", "floor": "B1"},
    {"id": "B1-GB", "name": "Gate B", "floor": "B1"}
]

RAMP_NODES: List[Dict[str, str]] = [
    {"id": "B1-R1", "floor": "B1", "description": "Ramp entry on Floor B1"},
    {"id": "B2-R1", "floor": "B2", "description": "Ramp arrival on Floor B2"}
]

JUNCTIONS: List[Dict[str, str]] = [
    {"id": "B1-J1", "floor": "B1"},
    {"id": "B1-J2", "floor": "B1"},
    {"id": "B1-J3", "floor": "B1"},
    {"id": "B2-J1", "floor": "B2"},
    {"id": "B2-J2", "floor": "B2"},
    {"id": "B2-J3", "floor": "B2"}
]

# 12 slots per floor: B1-A01 to B1-A12 and B2-A01 to B2-A12
SLOTS_B1: List[str] = [f"B1-A{i:02d}" for i in range(1, 13)]
SLOTS_B2: List[str] = [f"B2-A{i:02d}" for i in range(1, 13)]

ALL_SLOT_IDS: List[str] = SLOTS_B1 + SLOTS_B2

TOPOLOGY = {
    "floors": FLOORS,
    "statuses": PARKING_STATUSES,
    "gates": GATES,
    "ramps": RAMP_NODES,
    "junctions": JUNCTIONS,
    "slots": {
        "B1": SLOTS_B1,
        "B2": SLOTS_B2
    },
    "total_capacity": len(ALL_SLOT_IDS),
    "capacity_per_floor": {
        "B1": len(SLOTS_B1),
        "B2": len(SLOTS_B2)
    }
}
