/**
 * Test Database Helper for Integration Testing
 * 
 * Enforces strict database isolation:
 * - Strictly connects ONLY to 'smart_mall_parking_test'.
 * - Aborts immediately if the connected database is anything else.
 * - Never uses dropDatabase().
 * - Only cleans/seeds records inside 'smart_mall_parking_test'.
 * - Never exposes credentials or connection strings.
 */

const dns = require("dns");
const path = require("path");
const dotenv = require("dotenv");

// Load test environment file from server/.env.test.local or root .env.test.local
dotenv.config({ path: path.resolve(__dirname, "../../.env.test.local") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env.test.local") });
// Fallback to .env if test-specific file is not present
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

// Configure Google DNS to avoid Atlas SRV lookup issues, matching server config
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const mongoose = require("mongoose");
const ParkingSlot = require("../../models/ParkingSlot");

const TEST_DB_NAME = "smart_mall_parking_test";

/**
 * Resolves the MongoDB connection string to use for testing.
 * Strictly avoids logging or exposing credentials.
 * @returns {string|null}
 */
function getTestMongoUri() {
    if (process.env.TEST_MONGO_URI && process.env.TEST_MONGO_URI.trim()) {
        return process.env.TEST_MONGO_URI.trim();
    }
    if (process.env.MONGO_URI && process.env.MONGO_URI.trim()) {
        return process.env.MONGO_URI.trim();
    }
    return null;
}

/**
 * Connects to MongoDB, forcing the database name to smart_mall_parking_test.
 * Verifies that the connected database name matches exactly before proceeding.
 */
async function connectTestDb() {
    const rawUri = getTestMongoUri();
    if (!rawUri) {
        throw new Error(
            "TEST ABORTED: Neither TEST_MONGO_URI nor MONGO_URI environment variable is defined. " +
            "Please configure the test environment with access to 'smart_mall_parking_test'."
        );
    }

    // Connect with explicit dbName option forcing smart_mall_parking_test
    await mongoose.connect(rawUri, {
        dbName: TEST_DB_NAME
    });

    const connectedDbName = mongoose.connection.name;
    if (connectedDbName !== TEST_DB_NAME) {
        await mongoose.disconnect();
        throw new Error(
            `CRITICAL SAFETY ABORT: Connected database is '${connectedDbName}', expected '${TEST_DB_NAME}'. ` +
            "Disconnected immediately to prevent modifying non-test databases."
        );
    }
}

/**
 * Disconnects cleanly from MongoDB if connected.
 */
async function disconnectTestDb() {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
}

/**
 * Seeds the test database with fixture slots.
 * Deletes only documents in the ParkingSlot collection; NEVER drops database.
 * @param {Array<object>} slots 
 */
async function seedTestSlots(slots) {
    if (mongoose.connection.name !== TEST_DB_NAME) {
        throw new Error(
            `SAFETY ABORT: Cannot seed. Connected database is '${mongoose.connection.name}', not '${TEST_DB_NAME}'.`
        );
    }

    await ParkingSlot.deleteMany({});
    if (slots && slots.length > 0) {
        await ParkingSlot.insertMany(slots);
    }
}

/**
 * Clears all parking slot records from the test database.
 */
async function clearTestSlots() {
    if (mongoose.connection.name !== TEST_DB_NAME) {
        throw new Error(
            `SAFETY ABORT: Cannot clear. Connected database is '${mongoose.connection.name}', not '${TEST_DB_NAME}'.`
        );
    }

    await ParkingSlot.deleteMany({});
}

/**
 * Helper to fetch a single parking slot document directly from the test DB.
 * @param {string} slotId 
 * @returns {Promise<object|null>}
 */
async function getSlotDoc(slotId) {
    return await ParkingSlot.findOne({ slotId: slotId.trim() }).lean();
}

module.exports = {
    TEST_DB_NAME,
    connectTestDb,
    disconnectTestDb,
    seedTestSlots,
    clearTestSlots,
    getSlotDoc
};
