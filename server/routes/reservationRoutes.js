const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Reservation = require("../models/Reservation");
const ParkingSlot = require("../models/ParkingSlot");
const { releaseExpiredReservations } = require("../utils/reservationExpiry");

/**
 * 1. Create a reservation
 * POST /api/reservations
 */
router.post("/", async (req, res) => {
    try {
        if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
            return res.status(400).json({
                success: false,
                message: "Request body must be a valid JSON object"
            });
        }

        const { slotId, customerName, vehicleNumber, vehicleType } = req.body;

        // Input validation & sanitization
        if (!slotId || typeof slotId !== "string" || !slotId.trim()) {
            return res.status(400).json({
                success: false,
                message: "slotId is required"
            });
        }

        if (!customerName || typeof customerName !== "string" || !customerName.trim()) {
            return res.status(400).json({
                success: false,
                message: "customerName is required"
            });
        }

        if (!vehicleNumber || typeof vehicleNumber !== "string" || !vehicleNumber.trim()) {
            return res.status(400).json({
                success: false,
                message: "vehicleNumber is required"
            });
        }

        if (!vehicleType || typeof vehicleType !== "string" || !["car", "bike"].includes(vehicleType.trim().toLowerCase())) {
            return res.status(400).json({
                success: false,
                message: "vehicleType must be 'car' or 'bike'"
            });
        }

        const cleanSlotId = slotId.trim();
        const cleanCustomerName = customerName.trim();
        const cleanVehicleNumber = vehicleNumber.trim().toUpperCase();
        const cleanVehicleType = vehicleType.trim().toLowerCase();

        // Release expired reservations before checking slot availability
        await releaseExpiredReservations();

        // Verify slot exists
        const slot = await ParkingSlot.findOne({ slotId: cleanSlotId });
        if (!slot) {
            return res.status(404).json({
                success: false,
                message: `Parking slot '${cleanSlotId}' not found`
            });
        }

        // Vehicle compatibility check
        const isCompatible = Array.isArray(slot.vehicleType)
            ? slot.vehicleType.includes(cleanVehicleType)
            : slot.vehicleType === cleanVehicleType;

        if (!isCompatible) {
            return res.status(400).json({
                success: false,
                message: `Slot '${cleanSlotId}' is not compatible with vehicle type '${cleanVehicleType}'. Compatible types: ${Array.isArray(slot.vehicleType) ? slot.vehicleType.join(", ") : slot.vehicleType}`
            });
        }

        // Pre-check slot availability
        if (slot.status !== "available") {
            return res.status(409).json({
                success: false,
                message: `Slot '${cleanSlotId}' is not available for reservation (current status: ${slot.status})`
            });
        }

        // Unique user-friendly reservation ID generation
        let reservationId = `RES-${cleanSlotId}-${Date.now()}`;
        let collisionCheck = await Reservation.findOne({ reservationId });
        let counter = 1;
        while (collisionCheck) {
            reservationId = `RES-${cleanSlotId}-${Date.now()}-${counter++}`;
            collisionCheck = await Reservation.findOne({ reservationId });
        }

        // Transactional multi-document creation
        let session = null;
        let createdReservation = null;

        try {
            session = await mongoose.startSession();
            await session.withTransaction(async () => {
                // 1. Atomically acquire slot only if still available
                const updatedSlot = await ParkingSlot.findOneAndUpdate(
                    {
                        slotId: cleanSlotId,
                        status: "available"
                    },
                    {
                        $set: {
                            status: "reserved",
                            activeReservationId: reservationId
                        }
                    },
                    { new: true, session }
                );

                if (!updatedSlot) {
                    const err = new Error(`Slot '${cleanSlotId}' is no longer available`);
                    err.statusCode = 409;
                    throw err;
                }

                // 2. Create Reservation document in the same transaction
                const startTime = new Date();
                const expiryTime = new Date(startTime.getTime() + 30 * 60 * 1000);

                const [created] = await Reservation.create(
                    [
                        {
                            reservationId,
                            slotId: cleanSlotId,
                            floor: updatedSlot.floor,
                            customerName: cleanCustomerName,
                            vehicleNumber: cleanVehicleNumber,
                            vehicleType: cleanVehicleType,
                            status: "active",
                            startTime,
                            expiryTime
                        }
                    ],
                    { session }
                );

                createdReservation = created;
            });

            return res.status(201).json({
                success: true,
                message: "Slot reserved successfully",
                data: {
                    reservationId: createdReservation.reservationId,
                    slotId: createdReservation.slotId,
                    floor: createdReservation.floor,
                    customerName: createdReservation.customerName,
                    vehicleNumber: createdReservation.vehicleNumber,
                    vehicleType: createdReservation.vehicleType,
                    status: createdReservation.status,
                    startTime: createdReservation.startTime,
                    expiryTime: createdReservation.expiryTime
                }
            });
        } catch (txErr) {
            if (txErr.statusCode === 409) {
                return res.status(409).json({
                    success: false,
                    message: txErr.message
                });
            }

            if (txErr.code === 11000) {
                return res.status(409).json({
                    success: false,
                    message: "A reservation with this ID already exists or slot is already reserved"
                });
            }

            if (txErr.message && (txErr.message.includes("replica set") || txErr.message.includes("Transaction numbers"))) {
                return res.status(500).json({
                    success: false,
                    message: "Database deployment does not support transactions. Replica set or MongoDB Atlas required."
                });
            }

            return res.status(500).json({
                success: false,
                message: txErr.message || "Failed to create reservation"
            });
        } finally {
            if (session) {
                await session.endSession();
            }
        }

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * 2. List reservations with optional filters
 * GET /api/reservations
 */
router.get("/", async (req, res) => {
    try {
        await releaseExpiredReservations();

        const filter = {};

        if (req.query.status) {
            filter.status = req.query.status.trim();
        }

        if (req.query.slotId) {
            filter.slotId = req.query.slotId.trim();
        }

        if (req.query.vehicleNumber) {
            filter.vehicleNumber = req.query.vehicleNumber.trim().toUpperCase();
        }

        const reservations = await Reservation.find(filter)
            .sort({ createdAt: -1 })
            .select("reservationId slotId floor customerName vehicleNumber vehicleType status startTime expiryTime cancelledAt createdAt updatedAt");

        return res.status(200).json({
            success: true,
            count: reservations.length,
            data: reservations
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * 3. Get reservation details
 * GET /api/reservations/:reservationId
 */
router.get("/:reservationId", async (req, res) => {
    try {
        await releaseExpiredReservations();

        const { reservationId } = req.params;
        if (!reservationId || !reservationId.trim()) {
            return res.status(400).json({
                success: false,
                message: "reservationId is required"
            });
        }

        const cleanReservationId = reservationId.trim();
        const reservation = await Reservation.findOne({ reservationId: cleanReservationId })
            .select("reservationId slotId floor customerName vehicleNumber vehicleType status startTime expiryTime cancelledAt createdAt updatedAt");

        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: `Reservation '${cleanReservationId}' not found`
            });
        }

        return res.status(200).json({
            success: true,
            data: reservation
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * 4. Cancel reservation
 * PATCH /api/reservations/:reservationId/cancel
 */
router.patch("/:reservationId/cancel", async (req, res) => {
    try {
        await releaseExpiredReservations();

        const { reservationId } = req.params;
        if (!reservationId || !reservationId.trim()) {
            return res.status(400).json({
                success: false,
                message: "reservationId is required"
            });
        }

        const cleanReservationId = reservationId.trim();

        // 1. Initial lookup
        const reservation = await Reservation.findOne({ reservationId: cleanReservationId });
        if (!reservation) {
            return res.status(404).json({
                success: false,
                message: `Reservation '${cleanReservationId}' not found`
            });
        }

        // Only active reservations can be cancelled
        if (reservation.status !== "active") {
            return res.status(400).json({
                success: false,
                message: `Cannot cancel reservation '${cleanReservationId}' with status '${reservation.status}'. Only active reservations can be cancelled.`
            });
        }

        // 2. Perform cancellation transaction
        let session = null;
        let cancelledDoc = null;

        try {
            session = await mongoose.startSession();
            await session.withTransaction(async () => {
                // Re-verify reservation inside transaction
                const resDoc = await Reservation.findOne({
                    reservationId: cleanReservationId,
                    status: "active"
                }).session(session);

                if (!resDoc) {
                    const err = new Error(`Reservation '${cleanReservationId}' is no longer active`);
                    err.statusCode = 400;
                    throw err;
                }

                // Verify associated slot
                const slot = await ParkingSlot.findOne({ slotId: resDoc.slotId }).session(session);
                if (!slot) {
                    const err = new Error(`Associated parking slot '${resDoc.slotId}' does not exist`);
                    err.statusCode = 404;
                    throw err;
                }

                // Verify ownership: slot must be reserved and activeReservationId must match
                if (slot.status !== "reserved" || slot.activeReservationId !== cleanReservationId) {
                    const err = new Error(
                        `Slot '${resDoc.slotId}' ownership mismatch. Expected activeReservationId '${cleanReservationId}', but found '${slot.activeReservationId}' with status '${slot.status}'.`
                    );
                    err.statusCode = 409;
                    throw err;
                }

                // Mark reservation cancelled
                const cancelledAt = new Date();
                resDoc.status = "cancelled";
                resDoc.cancelledAt = cancelledAt;
                await resDoc.save({ session });

                // Release slot and clear activeReservationId
                await ParkingSlot.updateOne(
                    {
                        slotId: resDoc.slotId,
                        status: "reserved",
                        activeReservationId: cleanReservationId
                    },
                    {
                        $set: {
                            status: "available",
                            activeReservationId: null
                        }
                    },
                    { session }
                );

                cancelledDoc = resDoc;
            });

            return res.status(200).json({
                success: true,
                message: "Reservation cancelled successfully and slot released",
                data: {
                    reservationId: cancelledDoc.reservationId,
                    slotId: cancelledDoc.slotId,
                    status: cancelledDoc.status,
                    cancelledAt: cancelledDoc.cancelledAt
                }
            });
        } catch (txErr) {
            if (txErr.statusCode) {
                return res.status(txErr.statusCode).json({
                    success: false,
                    message: txErr.message
                });
            }

            if (txErr.message && (txErr.message.includes("replica set") || txErr.message.includes("Transaction numbers"))) {
                return res.status(500).json({
                    success: false,
                    message: "Database deployment does not support transactions. Replica set or MongoDB Atlas required."
                });
            }

            return res.status(500).json({
                success: false,
                message: txErr.message || "Failed to cancel reservation"
            });
        } finally {
            if (session) {
                await session.endSession();
            }
        }
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

router.releaseExpiredReservations = releaseExpiredReservations;

module.exports = router;
