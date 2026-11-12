/**
 * Dijkstra's Shortest Path Algorithm
 *
 * Computes the optimal driving route and total distance between any two
 * navigation nodes in the weighted parking graph.
 *
 * @param {Object} graph - Adjacency list representation: { [nodeId]: [{ node, distance }] }
 * @param {string} startNode - Starting node ID (e.g. "B1-GA")
 * @param {string} destinationNode - Destination node ID (e.g. "B1-A03")
 * @returns {Object|null} Result object containing path array, total distance, and destination
 */
export function dijkstra(graph, startNode, destinationNode) {
  // Validate presence and existence of nodes in graph
  if (!graph || !startNode || !destinationNode) {
    return null;
  }

  if (!graph[startNode] || !graph[destinationNode]) {
    return {
      distance: Infinity,
      path: [],
      start: startNode,
      destination: destinationNode,
      reachable: false,
      error: `Invalid node: ${!graph[startNode] ? startNode : destinationNode} does not exist in graph`,
    };
  }

  // Trivial case: start is already destination
  if (startNode === destinationNode) {
    return {
      distance: 0,
      path: [startNode],
      start: startNode,
      destination: destinationNode,
      reachable: true,
    };
  }

  const distances = {};
  const previous = {};
  const visited = new Set();

  // Initialize all distances to infinity
  for (const node in graph) {
    distances[node] = Infinity;
    previous[node] = null;
  }

  distances[startNode] = 0;

  while (true) {
    let currentNode = null;
    let smallestDistance = Infinity;

    // Pick unvisited node with lowest tentative distance
    for (const node in graph) {
      if (!visited.has(node) && distances[node] < smallestDistance) {
        smallestDistance = distances[node];
        currentNode = node;
      }
    }

    // If no reachable unvisited node remains or distance is infinite, terminate
    if (currentNode === null || smallestDistance === Infinity) {
      break;
    }

    // Destination reached
    if (currentNode === destinationNode) {
      break;
    }

    visited.add(currentNode);

    // Evaluate neighbors
    const neighbors = graph[currentNode] || [];
    for (const neighbor of neighbors) {
      const { node: neighborNode, distance: edgeWeight } = neighbor;

      if (!visited.has(neighborNode)) {
        const candidateDistance = distances[currentNode] + edgeWeight;

        if (candidateDistance < distances[neighborNode]) {
          distances[neighborNode] = candidateDistance;
          previous[neighborNode] = currentNode;
        }
      }
    }
  }

  // Destination was not reached
  if (distances[destinationNode] === Infinity) {
    return {
      distance: Infinity,
      path: [],
      start: startNode,
      destination: destinationNode,
      reachable: false,
    };
  }

  // Reconstruct path from destination to start
  const path = [];
  let current = destinationNode;

  while (current !== null) {
    path.push(current);
    current = previous[current];
  }

  path.reverse();

  return {
    distance: distances[destinationNode],
    path,
    start: startNode,
    destination: destinationNode,
    reachable: true,
  };
}

export default dijkstra;
