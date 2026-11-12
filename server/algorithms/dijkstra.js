
function dijkstra(graph, start, end) {
    // Check whether start and destination exist
    if (!graph[start] || !graph[end]) {
        return null;
    }

    const distances = {};
    const previous = {};
    const visited = new Set();

    // Initially, distance to every node is infinity
    for (const node in graph) {
        distances[node] = Infinity;
        previous[node] = null;
    }

    // Distance from start to itself is zero
    distances[start] = 0;

    while (true) {
        let currentNode = null;
        let smallestDistance = Infinity;

        // Find the unvisited node with the smallest distance
        for (const node in graph) {
            if (
                !visited.has(node) &&
                distances[node] < smallestDistance
            ) {
                smallestDistance = distances[node];
                currentNode = node;
            }
        }

        // No reachable unvisited nodes remain
        if (currentNode === null) {
            break;
        }

        // Destination reached
        if (currentNode === end) {
            break;
        }

        visited.add(currentNode);

        // Check all neighbouring nodes
        for (const neighbour of graph[currentNode]) {
            const nextNode = neighbour.node;
            const newDistance =
                distances[currentNode] + neighbour.distance;

            // Update if we found a shorter route
            if (
                !visited.has(nextNode) &&
                newDistance < distances[nextNode]
            ) {
                distances[nextNode] = newDistance;
                previous[nextNode] = currentNode;
            }
        }
    }

    // Destination cannot be reached
    if (distances[end] === Infinity) {
        return null;
    }

    // Reconstruct the shortest path
    const path = [];
    let current = end;

    while (current !== null) {
        path.push(current);
        current = previous[current];
    }

    path.reverse();

    return {
        distance: distances[end],
        path: path
    };
}

module.exports = dijkstra;
