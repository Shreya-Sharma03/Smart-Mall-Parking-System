const mongoose = require("mongoose");

const reservationSchema = new mongoose.Schema(
    {
        reservationId: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },

        slotId: {
            type: String,
            required: true,
            trim: true
        },

        floor: {
            type: String,
            enum: ["B1", "B2"],
            required: true
        },

        customerName: {
            type: String,
            required: true,
            trim: true
        },

        vehicleNumber: {
            type: String,
            required: true,
            trim: true,
            uppercase: true
        },

        vehicleType: {
            type: String,
            enum: ["car", "bike"],
            required: true
        },

        status: {
            type: String,
            enum: ["active", "completed", "cancelled", "expired"],
            default: "active"
        },

        startTime: {
            type: Date,
            default: Date.now
        },

        expiryTime: {
            type: Date,
            default: () => new Date(Date.now() + 30 * 60 * 1000)
        },

        cancelledAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);

// Compound indexes for active reservation queries and server-side expiry sweeps
reservationSchema.index({ slotId: 1, status: 1 });
reservationSchema.index({ status: 1, expiryTime: 1 });

const Reservation = mongoose.model("Reservation", reservationSchema);

module.exports = Reservation;
