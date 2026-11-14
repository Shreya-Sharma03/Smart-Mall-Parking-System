const express = require("express");
const router = express.Router();
const dijkstra = require("../algorithms/dijkstra");
const { graph } = require("../data/parkingGraph");
const ParkingSlot = require("../models/ParkingSlot");
const { releaseExpiredReservations } = require("../utils/reservationExpiry");
const {
    isCameraKnown,
    isCameraEnabled,
    getCameraFloor,
    isSlotAuthorizedForCamera,
    getDisabledReason
} = require("../config/cameraConfig");

const MAX_BATCH_SIZE = 24;

// In-memory tracking of the latest processed timestamp per camera
// Used to reject stale or duplicate requests without modifying the MongoDB schema
const lastProcessedCameraTimestamps = new Map();

// Per-camera serialization queues to ensure only one request per camera
// performs timestamp checks and updates at a time.
const cameraQueues = new Map();

/**
 * Checks if a year is a leap year
 */
function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * Validates that a string is a strictly valid ISO 8601 timestamp with an explicit timezone
 * and represents a real calendar date (rejects Feb 31, Apr 31, 25:00, etc.).
 */
function parseIso8601(timestampStr) {
    if (!timestampStr || typeof timestampStr !== "string") {
        return null;
    }

    const trimmed = timestampStr.trim();
    // Requires YYYY-MM-DDTHH:mm:ss(.1-6 digits optional)(Z|(+/-)HH:mm)
    const regex = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;
    const match = trimmed.match(regex);
    if (!match) {
        return null;
    }

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    const hour = parseInt(match[4], 10);
    const minute = parseInt(match[5], 10);
    const second = parseInt(match[6], 10);
    const fractionPart = match[7] || "";
    const tz = match[8];

    // Hour, minute, second range check
    if (hour > 23 || minute > 59 || second > 59) {
        return null;
    }

    // Timezone offset range check
    if (tz !== "Z") {
        const tzHour = parseInt(tz.slice(1, 3), 10);
        const tzMinute = parseInt(tz.slice(4, 6), 10);
        if (tzHour > 23 || tzMinute > 59) {
            return null;
        }
    }

    // Month range check (1 to 12)
    if (month < 1 || month > 12) {
        return null;
    }

    // Calendar day-of-month check (handles leap years)
    const daysInMonth = [31, (isLeapYear(year) ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day < 1 || day > daysInMonth[month - 1]) {
        return null;
    }

    // Parse base time up to seconds in UTC milliseconds
    const baseIso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${tz}`;
    const baseMs = Date.parse(baseIso);
    if (isNaN(baseMs)) {
        return null;
    }

    // Normalize fractional seconds to 6 microsecond digits
    const fractionMicros = parseInt(fractionPart.padEnd(6, "0"), 10);
    const totalMicroseconds = BigInt(baseMs) * 1000n + BigInt(fractionMicros);

    return {
        trimmed,
        baseMs,
        totalMicroseconds
    };
}

function isValidIso8601(timestampStr) {
    return parseIso8601(timestampStr) !== null;
}

/**
 * Serializes async tasks for a given camera ID.
 * If another request for the same camera is in progress, subsequent requests wait
 * until the previous request settles before checking timestamps and running.
 * Requests for different cameras execute independently in parallel.
 */
function runWithCameraLock(cameraId, task) {
    const tail = cameraQueues.get(cameraId) || Promise.resolve();

    let release;
    const lockSettled = new Promise(resolve => {
        release = resolve;
    });

    cameraQueues.set(cameraId, lockSettled);

    lockSettled.finally(() => {
        if (cameraQueues.get(cameraId) === lockSettled) {
            cameraQueues.delete(cameraId);
        }
    });

    return tail
        .catch(() => {}) // Continue even if previous task failed
        .then(() => task())
        .finally(() => release());
}
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

// CV-to-Backend Occupancy Update Endpoint
router.post("/cv-update", async (req, res) => {
    try {
        // 1. Request body structure validation
        if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
            return res.status(400).json({
                success: false,
                message: "Request body must be a valid JSON object"
            });
        }

        const { cameraId, timestamp, updates } = req.body;

        // 2. Camera ID validation
        if (!cameraId || typeof cameraId !== "string" || cameraId.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "A valid cameraId string is required"
            });
        }

        const cleanCameraId = cameraId.trim();

        if (!isCameraKnown(cleanCameraId)) {
            return res.status(400).json({
                success: false,
                message: `Unknown camera ID: '${cleanCameraId}'`
            });
        }

        // Enforce camera authorization & calibration status
        if (!isCameraEnabled(cleanCameraId)) {
            return res.status(403).json({
                success: false,
                message: getDisabledReason(cleanCameraId)
            });
        }

        // 3. Strict ISO 8601 timestamp validation (format, calendar date, ranges, timezone)
        const parsedTimestamp = parseIso8601(timestamp);
        if (!parsedTimestamp) {
            return res.status(400).json({
                success: false,
                message: "A valid ISO 8601 timestamp string with timezone is required (e.g., 'YYYY-MM-DDTHH:mm:ss.sssZ' or Python isoformat)"
            });
        }

        // Reject timestamps excessively far in the future (> 5 minutes clock skew tolerance)
        const maxFutureTimeMicros = BigInt(Date.now() + 5 * 60 * 1000) * 1000n;
        if (parsedTimestamp.totalMicroseconds > maxFutureTimeMicros) {
            return res.status(400).json({
                success: false,
                message: "Timestamp cannot be in the future beyond 5 minutes"
            });
        }

        // 4. Updates array validation
        if (!Array.isArray(updates) || updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Updates must be a non-empty array"
            });
        }

        if (updates.length > MAX_BATCH_SIZE) {
            return res.status(400).json({
                success: false,
                message: `Batch size exceeds maximum limit of ${MAX_BATCH_SIZE} slots`
            });
        }

        // 5. Batch item pre-validation (slot authorization, isMonitored, frame rules)
        const cameraFloor = getCameraFloor(cleanCameraId);
        const seenSlotIds = new Set();
        const batchSlotIds = [];

        for (let i = 0; i < updates.length; i++) {
            const item = updates[i];

            if (!item || typeof item !== "object" || Array.isArray(item)) {
                return res.status(400).json({
                    success: false,
                    message: `Update item at index ${i} must be a valid JSON object`
                });
            }

            const { slotId, confirmedStatus, isMonitored, consecutiveOccupiedFrames, consecutiveAvailableFrames } = item;

            // Slot ID validation
            if (!slotId || typeof slotId !== "string" || slotId.trim() === "") {
                return res.status(400).json({
                    success: false,
                    message: `Update item at index ${i} is missing a valid slotId`
                });
            }

            const cleanSlotId = slotId.trim();

            // Reject duplicate slot IDs in the same payload
            if (seenSlotIds.has(cleanSlotId)) {
                return res.status(400).json({
                    success: false,
                    message: `Duplicate slot ID '${cleanSlotId}' found in batch`
                });
            }
            seenSlotIds.add(cleanSlotId);
            batchSlotIds.push(cleanSlotId);

            // Verify slot is authorized for this camera
            if (!isSlotAuthorizedForCamera(cleanCameraId, cleanSlotId)) {
                return res.status(400).json({
                    success: false,
                    message: `Slot '${cleanSlotId}' is not authorized for camera '${cleanCameraId}'`
                });
            }

            // isMonitored must be explicitly true
            if (isMonitored !== true) {
                return res.status(400).json({
                    success: false,
                    message: `Slot '${cleanSlotId}' must have isMonitored set to true`
                });
            }

            // confirmedStatus must be either "occupied" or "available"
            if (confirmedStatus !== "occupied" && confirmedStatus !== "available") {
                return res.status(400).json({
                    success: false,
                    message: `Slot '${cleanSlotId}' has invalid confirmedStatus '${confirmedStatus}'. Only 'occupied' or 'available' are accepted.`
                });
            }

            // Frame counts must be non-negative integers
            if (
                !Number.isInteger(consecutiveOccupiedFrames) ||
                consecutiveOccupiedFrames < 0 ||
                !Number.isInteger(consecutiveAvailableFrames) ||
                consecutiveAvailableFrames < 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: `Slot '${cleanSlotId}' must provide non-negative integer frame counts`
                });
            }

            // Strict hysteresis confirmation frame requirements
            if (confirmedStatus === "occupied" && consecutiveOccupiedFrames < 3) {
                return res.status(400).json({
                    success: false,
                    message: `Slot '${cleanSlotId}' cannot be marked occupied with consecutiveOccupiedFrames (${consecutiveOccupiedFrames}) < 3`
                });
            }

            if (confirmedStatus === "available" && consecutiveAvailableFrames < 5) {
                return res.status(400).json({
                    success: false,
                    message: `Slot '${cleanSlotId}' cannot be marked available with consecutiveAvailableFrames (${consecutiveAvailableFrames}) < 5`
                });
            }
        }

        // 6. Execute timestamp check and database batch updates under the per-camera lock
        // This prevents race conditions where concurrent requests for the same camera bypass timestamp protection.
        return await runWithCameraLock(cleanCameraId, async () => {
            // Reject stale or duplicate requests for this camera within the running session
            const lastEntry = lastProcessedCameraTimestamps.get(cleanCameraId);
            if (lastEntry && parsedTimestamp.totalMicroseconds <= lastEntry.microseconds) {
                return res.status(400).json({
                    success: false,
                    message: `Stale or duplicate request rejected for camera ${cleanCameraId}. Timestamp must be strictly greater than ${lastEntry.isoString}`
                });
            }

            // Pre-read all referenced slots from database before any write (Validation Atomicity)
            const existingSlots = await ParkingSlot.find({
                slotId: { $in: batchSlotIds }
            });

            const slotMap = new Map();
            for (const s of existingSlots) {
                slotMap.set(s.slotId, s);
            }

            for (const sId of batchSlotIds) {
                if (!slotMap.has(sId)) {
                    return res.status(400).json({
                        success: false,
                        message: `Slot '${sId}' does not exist in the database`
                    });
                }

                const slotDoc = slotMap.get(sId);

                // Floor consistency validation
                if (slotDoc.floor !== cameraFloor) {
                    return res.status(400).json({
                        success: false,
                        message: `Slot '${sId}' floor '${slotDoc.floor}' does not match camera '${cleanCameraId}' floor '${cameraFloor}'`
                    });
                }
            }

            // Safe Database Writes (Protecting reserved and maintenance slots)
            let updatedCount = 0;
            const skipped = [];

            for (const item of updates) {
                const cleanSlotId = item.slotId.trim();
                const existingSlot = slotMap.get(cleanSlotId);

                // Protection check based on pre-read state
                if (existingSlot.status === "reserved") {
                    skipped.push({
                        slotId: cleanSlotId,
                        reason: "Slot is reserved"
                    });
                    continue;
                }

                if (existingSlot.status === "maintenance") {
                    skipped.push({
                        slotId: cleanSlotId,
                        reason: "Slot is under maintenance"
                    });
                    continue;
                }

                // Atomic conditional update: update ONLY if status is still not reserved or maintenance
                const updateResult = await ParkingSlot.updateOne(
                    {
                        slotId: cleanSlotId,
                        status: { $nin: ["reserved", "maintenance"] }
                    },
                    {
                        $set: { status: item.confirmedStatus }
                    }
                );

                if (updateResult.matchedCount > 0) {
                    updatedCount++;
                } else {
                    // Slot status changed concurrently between pre-read and update
                    const freshSlot = await ParkingSlot.findOne({ slotId: cleanSlotId });
                    if (freshSlot && freshSlot.status === "reserved") {
                        skipped.push({
                            slotId: cleanSlotId,
                            reason: "Slot is reserved"
                        });
                    } else if (freshSlot && freshSlot.status === "maintenance") {
                        skipped.push({
                            slotId: cleanSlotId,
                            reason: "Slot is under maintenance"
                        });
                    } else {
                        skipped.push({
                            slotId: cleanSlotId,
                            reason: "Status conflict during update"
                        });
                    }
                }
            }

            // Record latest processed timestamp for this camera in session (ONLY after successful loop)
            lastProcessedCameraTimestamps.set(cleanCameraId, {
                isoString: parsedTimestamp.trimmed,
                microseconds: parsedTimestamp.totalMicroseconds
            });

            return res.status(200).json({
                success: true,
                message: skipped.length > 0 ? "CV updates processed with skipped items" : "CV updates processed successfully",
                cameraId: cleanCameraId,
                received: updates.length,
                updated: updatedCount,
                skipped: skipped,
                timestamp: parsedTimestamp.trimmed
            });
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
        await releaseExpiredReservations();

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
        await releaseExpiredReservations();

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