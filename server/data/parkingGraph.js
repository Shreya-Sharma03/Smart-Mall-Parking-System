
// Main locations in our two-floor parking system

const baseNodes = [
    // Ground floor B1
    { id: "B1-GA", floor: "B1", type: "gate", x: 0, y: 0 },
    { id: "B1-J1", floor: "B1", type: "junction", x: 10, y: 0 },
    { id: "B1-J2", floor: "B1", type: "junction", x: 20, y: 0 },
    { id: "B1-J3", floor: "B1", type: "junction", x: 30, y: 0 },
    { id: "B1-GB", floor: "B1", type: "gate", x: 40, y: 0 },
    { id: "B1-R1", floor: "B1", type: "ramp", x: 20, y: 10 },

    // Upper floor B2
    { id: "B2-R1", floor: "B2", type: "ramp", x: 20, y: 10 },
    { id: "B2-J1", floor: "B2", type: "junction", x: 10, y: 20 },
    { id: "B2-J2", floor: "B2", type: "junction", x: 20, y: 20 },
    { id: "B2-J3", floor: "B2", type: "junction", x: 30, y: 20 }
];


// Generate 12 parking slots for each floor

function generateFloorSlots(floor) {

    const slots = [];

    for (let i = 1; i <= 12; i++) {

        // Four slots connect to each junction
        const group = Math.floor((i - 1) / 4) + 1;

        const junctionId = `${floor}-J${group}`;

        const position = (i - 1) % 4;

        const x = (group * 10) + ((position - 1.5) * 2);

        const y = floor === "B1" ? -5 : 25;

        const slotId = `${floor}-A${String(i).padStart(2, "0")}`;

        slots.push({
            id: slotId,
            floor: floor,
            type: "parking",
            x: x,
            y: y,
            connectTo: junctionId
        });
    }

    return slots;
}


// Generate slots for both floors

const slotNodes = [
    ...generateFloorSlots("B1"),
    ...generateFloorSlots("B2")
];


// Combine all nodes

const nodes = [
    ...baseNodes,
    ...slotNodes
];


// Connections between roads and junctions
// Format: [startingNode, endingNode, distanceInMetres]

const edges = [

    // B1: Gate A to Gate B
    ["B1-GA", "B1-J1", 10],
    ["B1-J1", "B1-J2", 10],
    ["B1-J2", "B1-J3", 10],
    ["B1-J3", "B1-GB", 10],

    // B1: Connection to ramp
    ["B1-J2", "B1-R1", 8],

    // Ramp connecting both floors
    ["B1-R1", "B2-R1", 20],

    // B2: Ramp to junctions
    ["B2-R1", "B2-J2", 8],
    ["B2-J1", "B2-J2", 10],
    ["B2-J2", "B2-J3", 10]
];


// Connect every parking slot to its junction

for (const slot of slotNodes) {

    edges.push([
        slot.id,
        slot.connectTo,
        3
    ]);

}


// Convert the connections into an adjacency list

const graph = {};

// Initially, every node has an empty list of neighbours

for (const node of nodes) {
    graph[node.id] = [];
}


// Add connections in both directions

for (const [from, to, distance] of edges) {

    if (!graph[from] || !graph[to]) {
        throw new Error(`Invalid connection: ${from} - ${to}`);
    }

    graph[from].push({
        node: to,
        distance: distance
    });

    graph[to].push({
        node: from,
        distance: distance
    });

}


// Export graph information

module.exports = {
    nodes,
    edges,
    graph
};
