/**
 * Mock Parking Slot Data for Visitor Client
 *
 * Implements all 24 slots across Basement 1 (B1) and Basement 2 (B2)
 * using the exact canonical identifiers from topology.js.
 *
 * Vehicle Compatibility:
 * - Car-compatible slots: ["car"] or ["car", "bike"]
 * - Bike-compatible slots: ["bike"] or ["car", "bike"]
 * - Dual-compatible slots: ["car", "bike"] (appear under both filters)
 *
 * Accessibility:
 * - B1-A01 (Car), B1-A07 (Car/Bike)
 * - B2-A01 (Car), B2-A07 (Car/Bike)
 * Ensures accessible options exist independently and in combination with vehicle type.
 */

import { SLOTS_B1, SLOTS_B2 } from './topology.js';

export const INITIAL_MOCK_SLOTS = [
  // ---------------- FLOOR B1 (12 Slots: B1-A01 to B1-A12) ----------------
  {
    slotId: "B1-A01",
    floor: "B1",
    status: "available",
    vehicleType: ["car"],
    accessible: true,
    nodeId: "B1-A01",
    aisle: "Aisle 1",
    connectToJunction: "B1-J1",
  },
  {
    slotId: "B1-A02",
    floor: "B1",
    status: "occupied",
    vehicleType: ["car"],
    accessible: false,
    nodeId: "B1-A02",
    aisle: "Aisle 1",
    connectToJunction: "B1-J1",
  },
  {
    slotId: "B1-A03",
    floor: "B1",
    status: "available",
    vehicleType: ["car"],
    accessible: false,
    nodeId: "B1-A03",
    aisle: "Aisle 1",
    connectToJunction: "B1-J1",
  },
  {
    slotId: "B1-A04",
    floor: "B1",
    status: "available",
    vehicleType: ["car"],
    accessible: false,
    nodeId: "B1-A04",
    aisle: "Aisle 1",
    connectToJunction: "B1-J1",
  },
  {
    slotId: "B1-A05",
    floor: "B1",
    status: "reserved",
    vehicleType: ["car"],
    accessible: false,
    nodeId: "B1-A05",
    aisle: "Aisle 2",
    connectToJunction: "B1-J2",
  },
  {
    slotId: "B1-A06",
    floor: "B1",
    status: "occupied",
    vehicleType: ["car"],
    accessible: false,
    nodeId: "B1-A06",
    aisle: "Aisle 2",
    connectToJunction: "B1-J2",
  },
  {
    slotId: "B1-A07",
    floor: "B1",
    status: "available",
    vehicleType: ["car", "bike"],
    accessible: true,
    nodeId: "B1-A07",
    aisle: "Aisle 2",
    connectToJunction: "B1-J2",
  },
  {
    slotId: "B1-A08",
    floor: "B1",
    status: "available",
    vehicleType: ["car"],
    accessible: false,
    nodeId: "B1-A08",
    aisle: "Aisle 2",
    connectToJunction: "B1-J2",
  },
  {
    slotId: "B1-A09",
    floor: "B1",
    status: "available",
    vehicleType: ["bike"],
    accessible: false,
    nodeId: "B1-A09",
    aisle: "Aisle 3",
    connectToJunction: "B1-J3",
  },
  {
    slotId: "B1-A10",
    floor: "B1",
    status: "occupied",
    vehicleType: ["bike"],
    accessible: false,
    nodeId: "B1-A10",
    aisle: "Aisle 3",
    connectToJunction: "B1-J3",
  },
  {
    slotId: "B1-A11",
    floor: "B1",
    status: "available",
    vehicleType: ["car", "bike"],
    accessible: false,
    nodeId: "B1-A11",
    aisle: "Aisle 3",
    connectToJunction: "B1-J3",
  },
  {
    slotId: "B1-A12",
    floor: "B1",
    status: "maintenance",
    vehicleType: ["car", "bike"],
    accessible: false,
    nodeId: "B1-A12",
    aisle: "Aisle 3",
    connectToJunction: "B1-J3",
  },

  // ---------------- FLOOR B2 (12 Slots: B2-A01 to B2-A12) ----------------
  {
    slotId: "B2-A01",
    floor: "B2",
    status: "available",
    vehicleType: ["car"],
    accessible: true,
    nodeId: "B2-A01",
    aisle: "Aisle 1",
    connectToJunction: "B2-J1",
  },
  {
    slotId: "B2-A02",
    floor: "B2",
    status: "available",
    vehicleType: ["car"],
    accessible: false,
    nodeId: "B2-A02",
    aisle: "Aisle 1",
    connectToJunction: "B2-J1",
  },
  {
    slotId: "B2-A03",
    floor: "B2",
    status: "occupied",
    vehicleType: ["car"],
    accessible: false,
    nodeId: "B2-A03",
    aisle: "Aisle 1",
    connectToJunction: "B2-J1",
  },
  {
    slotId: "B2-A04",
    floor: "B2",
    status: "available",
    vehicleType: ["car"],
    accessible: false,
    nodeId: "B2-A04",
    aisle: "Aisle 1",
    connectToJunction: "B2-J1",
  },
  {
    slotId: "B2-A05",
    floor: "B2",
    status: "available",
    vehicleType: ["car"],
    accessible: false,
    nodeId: "B2-A05",
    aisle: "Aisle 2",
    connectToJunction: "B2-J2",
  },
  {
    slotId: "B2-A06",
    floor: "B2",
    status: "reserved",
    vehicleType: ["car"],
    accessible: false,
    nodeId: "B2-A06",
    aisle: "Aisle 2",
    connectToJunction: "B2-J2",
  },
  {
    slotId: "B2-A07",
    floor: "B2",
    status: "available",
    vehicleType: ["car", "bike"],
    accessible: true,
    nodeId: "B2-A07",
    aisle: "Aisle 2",
    connectToJunction: "B2-J2",
  },
  {
    slotId: "B2-A08",
    floor: "B2",
    status: "occupied",
    vehicleType: ["car"],
    accessible: false,
    nodeId: "B2-A08",
    aisle: "Aisle 2",
    connectToJunction: "B2-J2",
  },
  {
    slotId: "B2-A09",
    floor: "B2",
    status: "available",
    vehicleType: ["bike"],
    accessible: false,
    nodeId: "B2-A09",
    aisle: "Aisle 3",
    connectToJunction: "B2-J3",
  },
  {
    slotId: "B2-A10",
    floor: "B2",
    status: "available",
    vehicleType: ["bike"],
    accessible: false,
    nodeId: "B2-A10",
    aisle: "Aisle 3",
    connectToJunction: "B2-J3",
  },
  {
    slotId: "B2-A11",
    floor: "B2",
    status: "occupied",
    vehicleType: ["car", "bike"],
    accessible: false,
    nodeId: "B2-A11",
    aisle: "Aisle 3",
    connectToJunction: "B2-J3",
  },
  {
    slotId: "B2-A12",
    floor: "B2",
    status: "available",
    vehicleType: ["car", "bike"],
    accessible: false,
    nodeId: "B2-A12",
    aisle: "Aisle 3",
    connectToJunction: "B2-J3",
  },
];

/**
 * Helper to retrieve slots for a specific floor
 */
export function getSlotsForFloor(slots, floor) {
  return slots.filter((slot) => slot.floor === floor);
}

/**
 * Helper to compute occupancy statistics for a floor
 * Optionally factors in active vehicle & accessibility filters
 */
export function computeFloorStats(slots, floor, vehicleType = null, accessibleOnly = false) {
  const floorSlots = getSlotsForFloor(slots, floor);
  const total = floorSlots.length;
  const available = floorSlots.filter((s) => s.status === "available").length;
  const occupied = floorSlots.filter((s) => s.status === "occupied").length;
  const reserved = floorSlots.filter((s) => s.status === "reserved").length;
  const maintenance = floorSlots.filter((s) => s.status === "maintenance").length;

  // Matching available slots according to active preferences
  const matchingAvailable = floorSlots.filter((s) => {
    if (s.status !== "available") return false;
    if (vehicleType && !s.vehicleType.includes(vehicleType)) return false;
    if (accessibleOnly && !s.accessible) return false;
    return true;
  }).length;

  return {
    total,
    available,
    occupied,
    reserved,
    maintenance,
    matchingAvailable,
    occupancyRate: total > 0 ? Math.round((occupied / total) * 100) : 0,
  };
}
