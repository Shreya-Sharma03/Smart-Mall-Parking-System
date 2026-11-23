
const mongoose = require("mongoose");

const connectDB = async () => {
    try {
        const isTest = process.env.NODE_ENV === "test";

        const mongoUri = isTest
            ? process.env.TEST_MONGO_URI
            : process.env.MONGO_URI;

        if (!mongoUri) {
            throw new Error("MongoDB URI is not configured.");
        }

        await mongoose.connect(mongoUri, {
            ...(isTest ? { dbName: "smart_mall_parking_test" } : {})
        });

        if (isTest && mongoose.connection.name !== "smart_mall_parking_test") {
            await mongoose.disconnect();
            throw new Error("Test database isolation check failed.");
        }

        console.log("MongoDB connected successfully!");
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);
        throw error;
    }
};

module.exports = connectDB;
