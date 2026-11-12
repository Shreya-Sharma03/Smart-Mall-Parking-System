
require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const ParkingSlot = require("../models/ParkingSlot");
const { nodes } = require("../data/parkingGraph");

async function seedSlots() {
    try {
        // Connect to MongoDB
        await connectDB();

        // Get only parking nodes, not gates or junctions
        const parkingNodes = nodes.filter(
            node => node.type === "parking"
        );

        let inserted = 0;
        let updated = 0;

        for (const node of parkingNodes) {
            const slotNumber = Number(node.id.slice(-2));

            // Sample vehicle compatibility for our prototype
            let vehicleType;

            if (slotNumber <= 8) {
                vehicleType = ["car"];
            } else if (slotNumber <= 10) {
                vehicleType = ["bike"];
            } else {
                vehicleType = ["car", "bike"];
            }

            // Two sample accessible spaces on each floor
            const accessible =
                slotNumber === 1 || slotNumber === 7;

            const slotData = {
                slotId: node.id,
                floor: node.floor,
                vehicleType: vehicleType,
                accessible: accessible,
                nodeId: node.id,
                location: {
                    x: node.x,
                    y: node.y
                }
            };

            // Insert if new; update details if it already exists.
            // Existing status is preserved when the script is rerun.
            const result = await ParkingSlot.updateOne(
                { slotId: node.id },
                {
                    $set: slotData,
                    $setOnInsert: {
                        status: "available"
                    }
                },
                {
                    upsert: true,
                    runValidators: true
                }
            );

            if (result.upsertedCount > 0) {
                inserted++;
            } else if (result.modifiedCount > 0) {
                updated++;
            }
        }

        const totalSlots = await ParkingSlot.countDocuments();

        console.log("--------------------------------");
        console.log("Parking slot seeding completed!");
        console.log("Graph parking nodes:", parkingNodes.length);
        console.log("New slots inserted:", inserted);
        console.log("Existing slots updated:", updated);
        console.log("Total slots in database:", totalSlots);
        console.log("--------------------------------");

    } catch (error) {
        console.error("Seeding failed:", error.message);
    } finally {
        await mongoose.disconnect();
        console.log("MongoDB connection closed.");
    }
}

seedSlots();
