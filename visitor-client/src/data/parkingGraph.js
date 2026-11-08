/**
 * Smart Mall Parking Navigation Graph
 *
 * Models the physical driving topology of Basement 1 (B1) and Basement 2 (B2).
 * Includes entry gates, driving junctions, the inter-floor transit ramp,
 * and all 24 individual parking slots connected to their respective aisle junctions.
 *
 * Edge weights represent realistic driving distances in metres.
 */

import { SLOTS_B1, SLOTS_B2 } from './topology.js';

// ---------------- 1. BASE NAVIGATION NODES ----------------
export const BASE_NODES = [
  // Floor B1 Nodes
  { id: "B1-GA", floor: "B1", type: "gate", name: "Gate A Entry", x: 0, y: 0 },
  { id: "B1-J1", floor: "B1", type: "junction", name: "Aisle 1 Junction", x: 10, y: 0 },
  { id: "B1-J2", floor: "B1", type: "junction", name: "Aisle 2 Junction", x: 20, y: 0 },
  { id: "B1-J3", floor: "B1", type: "junction", name: "Aisle 3 Junction", x: 30, y: 0 },
  { id: "B1-GB", floor: "B1", type: "gate", name: "Gate B Entry", x: 40, y: 0 },
  { id: "B1-R1", floor: "B1", type: "ramp", name: "Ramp Entrance (to B2)", x: 20, y: 10 },

  // Floor B2 Nodes
  { id: "B2-R1", floor: "B2", type: "ramp", name: "Ramp Arrival (from B1)", x: 20, y: 10 },
  { id: "B2-J1", floor: "B2", type: "junction", name: "Aisle 1 Junction", x: 10, y: 20 },
  { id: "B2-J2", floor: "B2", type: "junction", name: "Aisle 2 Junction", x: 20, y: 20 },
  { id: "B2-J3", floor: "B2", type: "junction", name: "Aisle 3 Junction", x: 30, y: 20 },
];

// Helper to assign each slot to its respective junction
function getSlotJunction(slotId, floor) {
  const num = parseInt(slotId.slice(-2), 10);
  if (num <= 4) return `${floor}-J1`;
  if (num <= 8) return `${floor}-J2`;
  return `${floor}-J3`;
}

// ---------------- 2. PARKING SLOT NODES ----------------
export const SLOT_NODES = [
  ...SLOTS_B1.map((id) => ({
    id,
    floor: "B1",
    type: "parking",
    name: `Parking Bay ${id}`,
    connectsTo: getSlotJunction(id, "B1"),
  })),
  ...SLOTS_B2.map((id) => ({
    id,
    floor: "B2",
    type: "parking",
    name: `Parking Bay ${id}`,
    connectsTo: getSlotJunction(id, "B2"),
  })),
];

// Complete list of all 34 graph nodes (10 base nodes + 24 slots)
export const ALL_GRAPH_NODES = [...BASE_NODES, ...SLOT_NODES];

// ---------------- 3. GRAPH EDGES (START, END, WEIGHT_IN_METRES) ----------------
export const GRAPH_EDGES = [
  // B1 Concourse Thoroughfare (Gate A -> J1 -> J2 -> J3 -> Gate B)
  ["B1-GA", "B1-J1", 10],
  ["B1-J1", "B1-J2", 10],
  ["B1-J2", "B1-J3", 10],
  ["B1-J3", "B1-GB", 10],

  // B1 Ramp Connector (from Junction 2 to Ramp Entry)
  ["B1-J2", "B1-R1", 8],

  // Inter-Floor Driving Ramp (B1-R1 <-> B2-R1)
  ["B1-R1", "B2-R1", 20],

  // B2 Concourse Thoroughfare (Ramp Arrival -> J2, then J1 <-> J2 <-> J3)
  ["B2-R1", "B2-J2", 8],
  ["B2-J1", "B2-J2", 10],
  ["B2-J2", "B2-J3", 10],

  // Parking Bays Connections (each bay connects to its aisle junction, dist: 3m)
  ...SLOT_NODES.map((slot) => [slot.id, slot.connectsTo, 3]),
];

// ---------------- 4. BUILD ADJACENCY LIST ----------------
export function buildAdjacencyList() {
  const graph = {};

  // Initialize empty adjacency lists for all nodes
  for (const node of ALL_GRAPH_NODES) {
    graph[node.id] = [];
  }

  // Populate bidirectional edges
  for (const [from, to, distance] of GRAPH_EDGES) {
    if (!graph[from] || !graph[to]) {
      console.warn(`[parkingGraph] Invalid edge definition: ${from} <-> ${to}`);
      continue;
    }

    graph[from].push({ node: to, distance });
    graph[to].push({ node: from, distance });
  }

  return graph;
}

export const PARKING_GRAPH = buildAdjacencyList();

/**
 * Returns human-readable label for any node in the graph
 */
export function getNodeLabel(nodeId) {
  const found = ALL_GRAPH_NODES.find((n) => n.id === nodeId);
  if (found) return found.name;
  if (nodeId.includes("GA")) return "Gate A Entry";
  if (nodeId.includes("GB")) return "Gate B Entry";
  if (nodeId.includes("R1")) return "Inter-Floor Ramp";
  if (nodeId.includes("-J")) return `Junction ${nodeId.slice(-2)}`;
  return nodeId;
}
