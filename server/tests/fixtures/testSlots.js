/**
 * Test Fixtures for Parking Slots
 * 
 * Defines standard 24 parking slots across floors B1 and B2 matching:
 * - server/models/ParkingSlot.js schema
 * - server/data/parkingGraph.js node coordinates and IDs
 * - camera assignments (CAM-B1-01, CAM-B1-02, CAM-B2-01)
 */

function generateTestSlots() {
    const slots = [];

    // Floor B1: Slots B1-A01 to B1-A12
    for (let i = 1; i <= 12; i++) {
        const slotId = `B1-A${String(i).padStart(2, "0")}`;
        const group = Math.floor((i - 1) / 4) + 1;
        const position = (i - 1) % 4;
        const x = (group * 10) + ((position - 1.5) * 2);
        const y = -5;

        let vehicleType;
        if (i <= 8) {
            vehicleType = ["car"];
        } else if (i <= 10) {
            vehicleType = ["bike"];
        } else {
            vehicleType = ["car", "bike"];
        }

        const accessible = (i === 1 || i === 7);

        // Pre-configure initial statuses to support scenario testing:
        // B1-A02 is initialized occupied (to test occupied -> available)
        // B1-A05 is reserved (to test reserved protection)
        // B1-A06 is maintenance (to test maintenance protection)
        let status = "available";
        if (slotId === "B1-A02") status = "occupied";
        if (slotId === "B1-A05") status = "reserved";
        if (slotId === "B1-A06") status = "maintenance";

        slots.push({
            slotId,
            floor: "B1",
            status,
            vehicleType,
            accessible,
            nodeId: slotId,
            location: { x, y }
        });
    }

    // Floor B2: Slots B2-A01 to B2-A12
    for (let i = 1; i <= 12; i++) {
        const slotId = `B2-A${String(i).padStart(2, "0")}`;
        const group = Math.floor((i - 1) / 4) + 1;
        const position = (i - 1) % 4;
        const x = (group * 10) + ((position - 1.5) * 2);
        const y = 25;

        let vehicleType;
        if (i <= 8) {
            vehicleType = ["car"];
        } else if (i <= 10) {
            vehicleType = ["bike"];
        } else {
            vehicleType = ["car", "bike"];
        }

        const accessible = (i === 1 || i === 7);

        slots.push({
            slotId,
            floor: "B2",
            status: "available",
            vehicleType,
            accessible,
            nodeId: slotId,
            location: { x, y }
        });
    }

    return slots;
}

/**
 * Returns a fresh, deep-cloned array of 24 test parking slots.
 * @returns {Array<object>}
 */
function getFreshTestSlots() {
    return JSON.parse(JSON.stringify(generateTestSlots()));
}

module.exports = {
    generateTestSlots,
    getFreshTestSlots
};
