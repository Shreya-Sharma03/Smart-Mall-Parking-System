/**
 * Intelligent Parking Recommendation Service
 *
 * Connects to Person B's backend endpoint GET /api/slots/recommend,
 * enriches the returned shortest path with estimated driving time and
 * step-by-step navigation instructions, and supports local Dijkstra
 * fallback when offline.
 */

import { PARKING_GRAPH, getNodeLabel } from '../data/parkingGraph.js';
import { dijkstra } from '../algorithms/dijkstra.js';
import { fetchRecommendedSlots } from './slotService.js';

/**
 * Calculates a human-readable driving estimate in minutes/seconds.
 * Assumptions: approximately 12 km/h average indoor garage speed
 * (3.3 m/s) + 20 seconds for maneuvering.
 */
export function calculateEstimatedTime(distanceMetres) {
  const travelSec = Math.round(distanceMetres / 3.3) + 20;

  if (travelSec < 60) {
    return {
      formatted: `~${travelSec} sec`,
      seconds: travelSec,
      description: 'Estimate based on 12 km/h garage speed + parking maneuver',
    };
  }

  const mins = (travelSec / 60).toFixed(1);

  return {
    formatted: `~${mins} min${mins === '1.0' ? '' : 's'}`,
    seconds: travelSec,
    description: 'Estimate based on 12 km/h garage speed + parking maneuver',
  };
}

/**
 * Transforms an array of node IDs into step-by-step navigation instructions.
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
        type: 'start',
      });
    } else if (i === path.length - 1) {
      steps.push({
        nodeId: currentNode,
        instruction: `Arrive at destination: ${label}`,
        type: 'destination',
      });
    } else if (currentNode.includes('R1')) {
      const isB1 = currentNode.startsWith('B1');

      steps.push({
        nodeId: currentNode,
        instruction: isB1
          ? 'Transition: Take driving ramp down to Basement 2 (B2-R1)'
          : 'Arrival on Basement 2 ramp exit',
        type: 'ramp',
      });
    } else if (currentNode.includes('-J')) {
      steps.push({
        nodeId: currentNode,
        instruction: `Continue along thoroughfare through ${label}`,
        type: 'junction',
      });
    }
  }

  return steps;
}

/**
 * Enriches a raw recommendation record with time estimates and navigation steps.
 *
 * @param {Object} rawRec - { slot, distance, path }
 * @returns {Object|null} Enriched candidate
 */
export function enrichRecommendation(rawRec) {
  if (!rawRec || !rawRec.slot) return null;

  const timeEstimate = calculateEstimatedTime(rawRec.distance || 0);
  const steps = buildNavigationSteps(rawRec.path || []);

  return {
    slot: rawRec.slot,
    distance: rawRec.distance,
    path: rawRec.path || [],
    estimatedTime: timeEstimate.formatted,
    estimatedSeconds: timeEstimate.seconds,
    estimatedTimeDesc: timeEstimate.description,
    steps,
    requiresFloorChange: rawRec.slot.floor !== 'B1',
  };
}

/**
 * Fetches and processes recommendations from the Express backend API.
 *
 * @param {Object} options - { gateId, vehicleType, accessibleOnly }
 * @returns {Promise<Object>} Formatted recommendation state
 */
export async function getBackendRecommendedSlots({
  gateId = 'B1-GA',
  vehicleType = 'car',
  accessibleOnly = false,
}) {
  try {
    const response = await fetchRecommendedSlots({
      gateId,
      vehicleType,
      accessible: accessibleOnly,
    });

    if (
      !response.success ||
      !response.recommendations ||
      response.recommendations.length === 0
    ) {
      let failureReason =
        response.message ||
        `No available ${vehicleType} parking slots found.`;

      if (accessibleOnly && !response.message) {
        failureReason =
          `No available accessible ${vehicleType} spaces found on any floor. ` +
          'Try searching for standard spaces or visit the parking help desk.';
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

    const enriched = response.recommendations
      .map(enrichRecommendation)
      .filter(Boolean);

    if (enriched.length === 0) {
      return {
        success: false,
        message: `No reachable parking slots found from ${gateId}.`,
        best: null,
        alternatives: [],
        allRanked: [],
        totalEligibleCount: 0,
        gateId,
        vehicleType,
        accessibleOnly,
      };
    }

    const best = enriched[0];
    const alternatives = enriched.slice(1);

    return {
      success: true,
      message: `Nearest available slot is ${best.slot.slotId} on Floor ${best.slot.floor} (${best.distance}m away).`,
      best,
      alternatives,
      allRanked: enriched,
      totalEligibleCount: enriched.length,
      gateId,
      vehicleType,
      accessibleOnly,
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to load recommendation: ${err.message}`,
      best: null,
      alternatives: [],
      allRanked: [],
      totalEligibleCount: 0,
      gateId,
      vehicleType,
      accessibleOnly,
    };
  }
}

/**
 * Local Recommendation Engine (synchronous calculation on active slots state).
 * Operates on slots loaded from backend or state cache.
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
  gateId = 'B1-GA',
  vehicleType = 'car',
  accessibleOnly = false,
  graph = PARKING_GRAPH,
}) {
  // 1. Filter slots by availability and vehicle compatibility.
  const eligibleSlots = slots.filter((slot) => {
    // Rule: Must be strictly available.
    if (slot.status !== 'available') {
      return false;
    }

    // Rule: Must support the requested vehicle type.
    if (!slot.vehicleType.includes(vehicleType)) {
      return false;
    }

    // Rule: If accessibility is requested, slot must be accessible.
    if (accessibleOnly && !slot.accessible) {
      return false;
    }

    return true;
  });

  // No eligible slots found in the entire system.
  if (eligibleSlots.length === 0) {
    let failureReason =
      `No available ${vehicleType} parking slots found.`;

    if (accessibleOnly) {
      failureReason =
        `No available accessible ${vehicleType} spaces found on any floor. ` +
        'Try searching for standard spaces or visit the parking help desk.';
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

  // 2. Compute the shortest path from the gate to each eligible slot.
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
        requiresFloorChange: slot.floor !== 'B1',
      });
    }
  }

  // If no slot could be reached through the graph.
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

  // 3. Rank candidates by ascending distance (nearest first).
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