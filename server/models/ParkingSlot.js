const mongoose = require("mongoose");

const parkingSlotSchema = new mongoose.Schema(
    {
        slotId: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },

        floor: {
            type: String,
            required: true
        },

        status: {
            type: String,
            enum: ["available", "occupied", "reserved", "maintenance"],
            default: "available"
        },

        vehicleType: {
            type: [String],
            enum: ["car", "bike"],
            required: true
        },

        accessible: {
            type: Boolean,
            default: false
        },

        nodeId: {
            type: String,
            required: true
        },

        location: {
            x: {
                type: Number,
                required: true
            },
            y: {
                type: Number,
                required: true
            }
        }
    },
    {
        timestamps: true
    }
);

const ParkingSlot = mongoose.model("ParkingSlot", parkingSlotSchema);

module.exports = ParkingSlot;