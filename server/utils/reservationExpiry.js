const mongoose = require("mongoose");
const Reservation = require("../models/Reservation");
const ParkingSlot = require("../models/ParkingSlot");

/**
 * Automatically expires active reservations whose expiryTime has passed
 * and releases their associated slots.
 * 
 * Multi-document updates are handled transactionally to prevent partial updates.
 * Each expired reservation is processed independently so that a failure in one
 * does not block other expired reservations.
 * 
 * @returns {Promise<{ releasedCount: number, expiredIds: string[] }>}
 */
async function releaseExpiredReservations() {
    const now = new Date();

    // 1. Find active reservations whose expiryTime is <= now
    const candidates = await Reservation.find({
        status: "active",
        expiryTime: { $lte: now }
    })
        .select("reservationId slotId")
        .lean();

    if (!candidates || candidates.length === 0) {
        return { releasedCount: 0, expiredIds: [] };
    }

    const expiredIds = [];

    for (const candidate of candidates) {
        let session = null;
        try {
            session = await mongoose.startSession();
            await session.withTransaction(async () => {
                // Re-verify that the reservation is still active and expired
                const resDoc = await Reservation.findOne({
                    reservationId: candidate.reservationId,
                    status: "active",
                    expiryTime: { $lte: new Date() }
                }).session(session);

                if (!resDoc) {
                    // Already processed, cancelled, or completed by another concurrent process
                    return;
                }

                // Verify that the slot is reserved by that exact reservation
                const slotDoc = await ParkingSlot.findOne({
                    slotId: resDoc.slotId,
                    status: "reserved",
                    activeReservationId: resDoc.reservationId
                }).session(session);

                // Change reservation status to expired
                resDoc.status = "expired";
                await resDoc.save({ session });

                // If the slot is reserved by this exact reservation, release it
                if (slotDoc) {
                    await ParkingSlot.updateOne(
                        {
                            slotId: resDoc.slotId,
                            status: "reserved",
                            activeReservationId: resDoc.reservationId
                        },
                        {
                            $set: {
                                status: "available",
                                activeReservationId: null
                            }
                        },
                        { session }
                    );
                }

                expiredIds.push(resDoc.reservationId);
            });
        } catch (error) {
            console.error(`Error during expiry for reservation ${candidate.reservationId}:`, error.message);
        } finally {
            if (session) {
                await session.endSession();
            }
        }
    }

    return {
        releasedCount: expiredIds.length,
        expiredIds
    };
}

module.exports = {
    releaseExpiredReservations
};
