const express = require("express");
const router = express.Router();
const dijkstra = require("../algorithms/dijkstra");
const { graph } = require("../data/parkingGraph");
const ParkingSlot = require("../models/ParkingSlot");
const TOTAL_CAPACITY = 24;
const FLOOR_CAPACITY = 12;

// 1. Add a new parking slot
router.post("/", async (req, res) => {
    try {
        const {
            slotId,
            floor,
            status,
            vehicleType,
            accessible,
            nodeId,
            location
        } = req.body;

        // Check required fields
        if (
            !slotId ||
            !floor ||
            !nodeId ||
            !location ||
            location.x === undefined ||
            location.y === undefined ||
            !Array.isArray(vehicleType) ||
            vehicleType.length === 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Please provide all required parking slot details"
            });
        }

        // Validate floor
        if (!["B1", "B2"].includes(floor)) {
            return res.status(400).json({
                success: false,
                message: "Floor must be B1 or B2"
            });
        }
        // Check total parking capacity
        const totalSlots = await ParkingSlot.countDocuments();

        if (totalSlots >= TOTAL_CAPACITY) {
            return res.status(400).json({
                success: false,
                message: "Parking capacity is full. Maximum 24 slots allowed."
            });
        }

        // Check floor capacity
        const floorSlots = await ParkingSlot.countDocuments({
            floor: floor
        });

        if (floorSlots >= FLOOR_CAPACITY) {
            return res.status(400).json({
                success: false,
                message: `Floor ${floor} has reached its maximum capacity of 12 slots.`
            });
        }
        // Validate vehicle types
        const validVehicleTypes = ["car", "bike"];

        if (
            !vehicleType.every(type =>
                validVehicleTypes.includes(type)
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "Vehicle type must be car or bike"
            });
        }

        // Validate coordinates
        if (
            !Number.isFinite(Number(location.x)) ||
            !Number.isFinite(Number(location.y))
        ) {
            return res.status(400).json({
                success: false,
                message: "X and Y coordinates must be valid numbers"
            });
        }

        // Check whether the graph node exists
        if (!Object.prototype.hasOwnProperty.call(graph, nodeId)) {
            return res.status(400).json({
                success: false,
                message: `Graph node '${nodeId}' does not exist`
            });
        }

        // Check whether graph node belongs to the selected floor
        if (!nodeId.startsWith(`${floor}-`)) {
            return res.status(400).json({
                success: false,
                message: "Selected floor does not match the graph node"
            });
        }

        // Check for duplicate slot ID
        const existingSlot = await ParkingSlot.findOne({
            slotId: slotId.trim()
        });

        if (existingSlot) {
            return res.status(400).json({
                success: false,
                message: "A parking slot with this ID already exists"
            });
        }

        // Check for duplicate graph node
        const duplicateNode = await ParkingSlot.findOne({
            nodeId: nodeId
        });

        if (duplicateNode) {
            return res.status(400).json({
                success: false,
                message: `Graph node '${nodeId}' is already assigned to another slot`
            });
        }

        // Create and save the parking slot
        const slot = new ParkingSlot({
            slotId: slotId.trim(),
            floor,
            status: status || "available",
            vehicleType,
            accessible: accessible ?? false,
            nodeId,
            location: {
                x: Number(location.x),
                y: Number(location.y)
            }
        });

        const savedSlot = await slot.save();

        res.status(201).json({
            success: true,
            message: "Parking slot added successfully",
            data: savedSlot
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// 2. Get all parking slots with optional filters
router.get("/", async (req, res) => {
    try {
        const filters = {};

        if (req.query.floor) {
            filters.floor = req.query.floor;
        }

        if (req.query.status) {
            filters.status = req.query.status;
        }

        if (req.query.vehicleType) {
            filters.vehicleType = req.query.vehicleType;
        }
        if (req.query.accessible !== undefined) {
            filters.accessible = req.query.accessible === "true";
        }
        const slots = await ParkingSlot.find(filters);

        res.status(200).json({
            success: true,
            count: slots.length,
            data: slots
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});


// Recommend the nearest available parking slot
router.get("/recommend", async (req, res) => {
    try {
        const { gateId, vehicleType, accessible } = req.query;

        // Validate gate
        if (!gateId || !graph[gateId]) {
            return res.status(400).json({
                success: false,
                message: "Please provide a valid gateId"
            });
        }

        // Validate vehicle type
        if (!["car", "bike"].includes(vehicleType)) {
            return res.status(400).json({
                success: false,
                message: "vehicleType must be car or bike"
            });
        }

        // Find available slots suitable for this vehicle
        const filters = {
            status: "available",
            vehicleType: vehicleType
        };

        if (accessible === "true") {
            filters.accessible = true;
        }

        const availableSlots = await ParkingSlot.find(filters);

        if (availableSlots.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No suitable available parking slots found"
            });
        }

        const recommendations = [];

        // Calculate the shortest route to each available slot
        for (const slot of availableSlots) {
            const result = dijkstra(
                graph,
                gateId,
                slot.nodeId
            );

            if (result !== null) {
                recommendations.push({
                    slot: slot,
                    distance: result.distance,
                    path: result.path
                });
            }
        }

        if (recommendations.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No reachable parking slots found"
            });
        }

        // Sort by shortest distance
        recommendations.sort((a, b) => a.distance - b.distance);

        return res.status(200).json({
            success: true,
            message: "Nearest parking slots found",
            count: recommendations.length,
            recommendations: recommendations
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});


// Get parking statistics for the admin dashboard
router.get("/stats", async (req, res) => {
    try {
        const statuses = [
            "available",
            "occupied",
            "reserved",
            "maintenance"
        ];

        const floors = ["B1", "B2"];

        // Initialize all status counts to zero
        const statusCounts = {
            available: 0,
            occupied: 0,
            reserved: 0,
            maintenance: 0
        };

        // Initialize floor-wise statistics
        const floorStats = {};

        for (const floor of floors) {
            floorStats[floor] = {
                total: 0,
                available: 0,
                occupied: 0,
                reserved: 0,
                maintenance: 0
            };
        }

        // Group slots by floor and status in MongoDB
        const groupedStats = await ParkingSlot.aggregate([
            {
                $group: {
                    _id: {
                        floor: "$floor",
                        status: "$status"
                    },
                    count: {
                        $sum: 1
                    }
                }
            }
        ]);

        // Fill the statistics using the grouped results
        for (const item of groupedStats) {
            const floor = item._id.floor;
            const status = item._id.status;
            const count = item.count;

            if (statusCounts[status] !== undefined) {
                statusCounts[status] += count;
            }

            if (floorStats[floor]) {
                floorStats[floor][status] = count;
                floorStats[floor].total += count;
            }
        }

        // Calculate total number of slots
        const totalSlots = Object.values(statusCounts)
            .reduce((sum, count) => sum + count, 0);

        return res.status(200).json({
            success: true,
            message: "Parking statistics fetched successfully",
            data: {
                totalSlots,
                statusCounts,
                floorStats
            }
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 3. Get a parking slot by its ID
router.get("/:slotId", async (req, res) => {
    try {
        const slot = await ParkingSlot.findOne({
            slotId: req.params.slotId
        });

        if (!slot) {
            return res.status(404).json({
                success: false,
                message: "Parking slot not found"
            });
        }

        res.status(200).json({
            success: true,
            data: slot
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 4. Update a parking slot

router.patch("/:slotId", async (req, res) => {
    try {
        const allowedFields = [
            "floor",
            "status",
            "vehicleType",
            "accessible",
            "nodeId",
            "location"
        ];

        const updates = {};

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid fields provided for update"
            });
        }

        // Find the existing slot
        const existingSlot = await ParkingSlot.findOne({
            slotId: req.params.slotId
        });

        if (!existingSlot) {
            return res.status(404).json({
                success: false,
                message: "Parking slot not found"
            });
        }

        // Validate graph node if nodeId or floor is being changed
        const nodeId = updates.nodeId || existingSlot.nodeId;
        const floor = updates.floor || existingSlot.floor;

        // Check floor capacity when moving a slot to another floor
        if (updates.floor && updates.floor !== existingSlot.floor) {
            const floorSlots = await ParkingSlot.countDocuments({
                floor: updates.floor
            });

            if (floorSlots >= FLOOR_CAPACITY) {
                return res.status(400).json({
                    success: false,
                    message: `Floor ${updates.floor} has reached its maximum capacity of 12 slots.`
                });
            }
        }
        if (updates.nodeId !== undefined || updates.floor !== undefined) {

            // Check whether the node exists in the parking graph
            if (!Object.prototype.hasOwnProperty.call(graph, nodeId)) {
                return res.status(400).json({
                    success: false,
                    message: `Graph node '${nodeId}' does not exist`
                });
            }

            // Check whether the node belongs to the selected floor
            if (!nodeId.startsWith(`${floor}-`)) {
                return res.status(400).json({
                    success: false,
                    message: "Selected floor does not match the graph node"
                });
            }

            // Prevent another slot from using the same graph node
            const duplicateNode = await ParkingSlot.findOne({
                nodeId: nodeId,
                slotId: { $ne: req.params.slotId }
            });

            if (duplicateNode) {
                return res.status(400).json({
                    success: false,
                    message: `Graph node '${nodeId}' is already assigned to another slot`
                });
            }
        }

        // Update the slot
        const slot = await ParkingSlot.findOneAndUpdate(
            { slotId: req.params.slotId },
            { $set: updates },
            { returnDocument: "after", runValidators: true }
        );

        res.status(200).json({
            success: true,
            message: "Parking slot updated successfully",
            data: slot
        });

    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

router.delete("/:slotId", async (req, res) => {
    try {
        const slot = await ParkingSlot.findOne({
            slotId: req.params.slotId
        });

        if (!slot) {
            return res.status(404).json({
                success: false,
                message: "Parking slot not found"
            });
        }

        // Prevent deleting occupied or reserved slots
        if (["occupied", "reserved"].includes(slot.status)) {
            return res.status(400).json({
                success: false,
                message: "Occupied or reserved slots cannot be deleted."
            });
        }

        await ParkingSlot.deleteOne({
            slotId: req.params.slotId
        });

        res.status(200).json({
            success: true,
            message: "Parking slot deleted successfully"
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});
module.exports = router;