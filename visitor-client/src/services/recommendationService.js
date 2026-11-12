/**
 * Intelligent Parking Recommendation Service
 *
 * Filters available parking bays based on user vehicle type and accessibility,
 * executes Dijkstra pathfinding from the chosen entry gate, and ranks reachable
 * slots by shortest driving distance.
 */

import { PARKING_GRAPH, getNodeLabel } from '../data/parkingGraph.js';
import { dijkstra } from '../algorithms/dijkstra.js';

/**
 * Calculates human-readable driving estimate in minutes/seconds
 * Assumptions: ~12 km/h average indoor garage speed (~3.3 m/s) + 20s maneuvering
 */
export function calculateEstimatedTime(distanceMetres) {
  const travelSec = Math.round(distanceMetres / 3.3) + 20;
  if (travelSec < 60) {
    return {
      formatted: `~${travelSec} sec`,
      seconds: travelSec,
      description: "Estimate based on 10 km/h garage speed + parking maneuver",
    };
  }

  const mins = (travelSec / 60).toFixed(1);
  return {
    formatted: `~${mins} min${mins === "1.0" ? "" : "s"}`,
    seconds: travelSec,
    description: "Estimate based on 10 km/h garage speed + parking maneuver",
  };
}

/**
 * Transforms an array of node IDs into step-by-step navigation instructions
 */
export function buildNavigationSteps(path) {
  if (!path || path.length === 0) return [];

  const steps = [];

  for (let i = 0; i < path.length; i++) {
    const currentNode = path[i];
    const label = getNodeLabel(currentNode);

    if (i === 0) {
      steps.push({
        nodeId: currentNode,
        instruction: `Enter through ${label}`,
        type: "start",
      });
    } else if (i === path.length - 1) {
      steps.push({
        nodeId: currentNode,
        instruction: `Arrive at destination: ${label}`,
        type: "destination",
      });
    } else if (currentNode.includes("R1")) {
      const isB1 = currentNode.startsWith("B1");
      steps.push({
        nodeId: currentNode,
        instruction: isB1
          ? "Transition: Take driving ramp down to Basement 2 (B2-R1)"
          : "Arrival on Basement 2 ramp exit",
        type: "ramp",
      });
    } else if (currentNode.includes("-J")) {
      steps.push({
        nodeId: currentNode,
        instruction: `Continue along thoroughfare through ${label}`,
        type: "junction",
      });
    }
  }

  return steps;
}

/**
 * Core Recommendation Engine
 *
 * @param {Object} options
 * @param {Array} options.slots - List of parking slot objects
 * @param {string} options.gateId - "B1-GA" or "B1-GB"
 * @param {string} options.vehicleType - "car" or "bike"
 * @param {boolean} options.accessibleOnly - Flag for accessible priority
 * @param {Object} [options.graph] - Optional custom adjacency list
 * @returns {Object} Recommendation result with best slot, distance, path, and alternatives
 */
export function getRecommendedSlots({
  slots = [],
  gateId = "B1-GA",
  vehicleType = "car",
  accessibleOnly = false,
  graph = PARKING_GRAPH,
}) {
  // 1. Filter slots by availability and vehicle compatibility
  const eligibleSlots = slots.filter((slot) => {
    // Rule: Must be strictly available
    if (slot.status !== "available") {
      return false;
    }

    // Rule: Must support the requested vehicle type
    if (!slot.vehicleType.includes(vehicleType)) {
      return false;
    }

    // Rule: If accessible is requested, must be marked accessible
    if (accessibleOnly && !slot.accessible) {
      return false;
    }

    return true;
  });

  // No eligible slots found in entire system
  if (eligibleSlots.length === 0) {
    let failureReason = `No available ${vehicleType} parking slots found.`;
    if (accessibleOnly) {
      failureReason = `No available accessible ${vehicleType} spaces found on any floor. Try searching for standard spaces or visit the parking help desk.`;
    }

    return {
      success: false,
      message: failureReason,
      best: null,
      alternatives: [],
      allRanked: [],
      totalEligibleCount: 0,
      gateId,
      vehicleType,
      accessibleOnly,
    };
  }

  // 2. Compute shortest path from gateId to each eligible slot
  const routeCandidates = [];

  for (const slot of eligibleSlots) {
    const route = dijkstra(graph, gateId, slot.nodeId);

    if (route && route.reachable && route.distance < Infinity) {
      const timeEstimate = calculateEstimatedTime(route.distance);
      const steps = buildNavigationSteps(route.path);

      routeCandidates.push({
        slot,
        distance: route.distance,
        path: route.path,
        estimatedTime: timeEstimate.formatted,
        estimatedSeconds: timeEstimate.seconds,
        estimatedTimeDesc: timeEstimate.description,
        steps,
        requiresFloorChange: slot.floor !== "B1",
      });
    }
  }

  // If none could be reached via graph
  if (routeCandidates.length === 0) {
    return {
      success: false,
      message: `No reachable route found from ${gateId} to available spaces.`,
      best: null,
      alternatives: [],
      allRanked: [],
      totalEligibleCount: eligibleSlots.length,
      gateId,
      vehicleType,
      accessibleOnly,
    };
  }

  // 3. Rank candidates by ascending distance (nearest first)
  routeCandidates.sort((a, b) => a.distance - b.distance);

  const best = routeCandidates[0];
  const alternatives = routeCandidates.slice(1);

  return {
    success: true,
    message: `Nearest available slot is ${best.slot.slotId} on Floor ${best.slot.floor} (${best.distance}m away).`,
    best,
    alternatives,
    allRanked: routeCandidates,
    totalEligibleCount: eligibleSlots.length,
    gateId,
    vehicleType,
    accessibleOnly,
  };
}
