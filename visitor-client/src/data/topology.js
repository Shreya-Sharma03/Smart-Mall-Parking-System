/**
 * Shared Parking Topology Definition for Smart Mall Parking System
 *
 * Defines the canonical floor names, slot identifiers, gates, ramp nodes,
 * junctions, and parking status values.
 */

export const FLOORS = Object.freeze(["B1", "B2"]);

export const PARKING_STATUSES = Object.freeze([
  "available",
  "occupied",
  "reserved",
  "maintenance",
]);

export const GATES = Object.freeze([
  { id: "B1-GA", name: "Gate A", floor: "B1" },
  { id: "B1-GB", name: "Gate B", floor: "B1" },
]);

export const RAMP_NODES = Object.freeze([
  { id: "B1-R1", floor: "B1", description: "Ramp entry on Floor B1" },
  { id: "B2-R1", floor: "B2", description: "Ramp arrival on Floor B2" },
]);

export const JUNCTIONS = Object.freeze([
  { id: "B1-J1", floor: "B1" },
  { id: "B1-J2", floor: "B1" },
  { id: "B1-J3", floor: "B1" },
  { id: "B2-J1", floor: "B2" },
  { id: "B2-J2", floor: "B2" },
  { id: "B2-J3", floor: "B2" },
]);

// 12 slots on B1 and 12 slots on B2 = 24 slots in total
export const SLOTS_B1 = Object.freeze([
  "B1-A01",
  "B1-A02",
  "B1-A03",
  "B1-A04",
  "B1-A05",
  "B1-A06",
  "B1-A07",
  "B1-A08",
  "B1-A09",
  "B1-A10",
  "B1-A11",
  "B1-A12",
]);

export const SLOTS_B2 = Object.freeze([
  "B2-A01",
  "B2-A02",
  "B2-A03",
  "B2-A04",
  "B2-A05",
  "B2-A06",
  "B2-A07",
  "B2-A08",
  "B2-A09",
  "B2-A10",
  "B2-A11",
  "B2-A12",
]);

export const ALL_SLOT_IDS = Object.freeze([...SLOTS_B1, ...SLOTS_B2]);

export const TOPOLOGY = Object.freeze({
  floors: FLOORS,
  statuses: PARKING_STATUSES,
  gates: GATES,
  ramps: RAMP_NODES,
  junctions: JUNCTIONS,
  slots: {
    B1: SLOTS_B1,
    B2: SLOTS_B2,
  },
  totalCapacity: ALL_SLOT_IDS.length,
  capacityPerFloor: {
    B1: SLOTS_B1.length,
    B2: SLOTS_B2.length,
  },
});
