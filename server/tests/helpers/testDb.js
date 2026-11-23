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
const path = require("path");
const dotenv = require("dotenv");

// Load test environment variables from the two possible locations
dotenv.config({ path: path.resolve(__dirname, "../../.env.test.local") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env.test.local") });

const mongoose = require("mongoose");
const ParkingSlot = require("../../models/ParkingSlot");

const TEST_DB_NAME = "smart_mall_parking_test";

/**
 * Returns the MongoDB connection string for testing.
 * Requires TEST_MONGO_URI environment variable; throws if missing.
 */
function getTestMongoUri() {
  if (process.env.TEST_MONGO_URI && process.env.TEST_MONGO_URI.trim()) {
    return process.env.TEST_MONGO_URI.trim();
  }
  throw new Error(
    "TEST ABORTED: TEST_MONGO_URI environment variable is not defined. " +
    "Please configure the test environment with access to 'smart_mall_parking_test'."
  );
}

/**
 * Connects to MongoDB, forcing the database name to smart_mall_parking_test.
 * Verifies that the connected database name matches exactly before proceeding.
 */
async function connectTestDb() {
  const rawUri = getTestMongoUri();

  // Connect with explicit dbName option forcing smart_mall_parking_test
  await mongoose.connect(rawUri, {
    dbName: TEST_DB_NAME,
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
  if (Array.isArray(slots) && slots.length > 0) {
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
  getSlotDoc,
};