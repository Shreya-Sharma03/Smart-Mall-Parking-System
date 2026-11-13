/**
 * Dedicated Test Server Entry Point
 * 
 * Safely starts the Express backend bound ONLY to 'smart_mall_parking_test'.
 * 
 * Safety invariants:
 * - Explicitly loads server/.env.test.local using an absolute path.
 * - Reads TEST_MONGO_URI directly from parsed file contents (immune to shell env inheritance).
 * - Forces Mongoose connection option { dbName: "smart_mall_parking_test" }.
 * - Asserts mongoose.connection.name === "smart_mall_parking_test" BEFORE listening.
 * - Refuses to listen if the database name does not match or URI is missing.
 * - Listens on port 5000 matching admin dashboard expectation.
 * - Handles EADDRINUSE and graceful shutdown (SIGINT/SIGTERM) cleanly.
 * - Never prints or exposes the MongoDB URI or credentials.
 */

const path = require("path");
const dns = require("dns");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

// 1. Explicitly load server/.env.test.local using an absolute path
const envPath = path.resolve(__dirname, ".env.test.local");
const envResult = dotenv.config({ path: envPath });

// Abort immediately if the environment file cannot be loaded
if (envResult.error || !envResult.parsed) {
    console.error("SAFETY ABORT: Could not load environment file from server/.env.test.local");
    process.exit(1);
}

// 2. Read TEST_MONGO_URI directly from the parsed file contents (never fallback or rely on pre-existing shell env)
const rawParsedUri = envResult.parsed.TEST_MONGO_URI;
if (!rawParsedUri || typeof rawParsedUri !== "string" || !rawParsedUri.trim()) {
    console.error("SAFETY ABORT: TEST_MONGO_URI is missing or empty in parsed server/.env.test.local");
    process.exit(1);
}

const testMongoUri = rawParsedUri.trim();

// Configure Google DNS matching production and test configurations
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const TEST_DB_NAME = "smart_mall_parking_test";
const PORT = 5000;

// 3. Import existing Express app (does not start listener on import)
const app = require("./server");

async function startTestServer() {
    try {
        console.log("Connecting to test database...");

        // 4. Connect explicitly to smart_mall_parking_test using parsed URI
        await mongoose.connect(testMongoUri, {
            dbName: TEST_DB_NAME
        });

        // 5. Strict database identity verification BEFORE opening HTTP listener
        const connectedDbName = mongoose.connection.name;
        if (connectedDbName !== TEST_DB_NAME) {
            console.error(
                `CRITICAL SAFETY ABORT: Connected to database '${connectedDbName}', expected '${TEST_DB_NAME}'. Disconnecting immediately.`
            );
            await mongoose.disconnect();
            process.exit(1);
        }

        console.log(`Verified connection to isolated test database: '${connectedDbName}'`);

        // 6. Start HTTP server on port 5000 only after database verification
        const server = app.listen(PORT, () => {
            console.log(`Smart Mall Parking Test Server running on http://localhost:${PORT}`);
            console.log(`Database: ${TEST_DB_NAME}`);
        });

        // 7. Handle server-level errors safely (e.g., EADDRINUSE)
        server.on("error", async (err) => {
            if (err.code === "EADDRINUSE") {
                console.error(`ERROR: Port ${PORT} is already in use by another process.`);
            } else {
                console.error("HTTP server error:", err.message);
            }

            if (mongoose.connection.readyState !== 0) {
                await mongoose.disconnect();
                console.log("Mongoose disconnected.");
            }
            process.exit(1);
        });

        // 8. Graceful shutdown on SIGINT and SIGTERM
        let shuttingDown = false;
        const handleShutdown = async (signal) => {
            if (shuttingDown) return;
            shuttingDown = true;
            console.log(`\nReceived ${signal}. Shutting down test server cleanly...`);

            server.close(async () => {
                console.log("HTTP server closed.");
                try {
                    if (mongoose.connection.readyState !== 0) {
                        await mongoose.disconnect();
                        console.log("Mongoose disconnected cleanly.");
                    }
                } catch (closeErr) {
                    console.error("Error during Mongoose disconnect:", closeErr.message);
                } finally {
                    process.exit(0);
                }
            });
        };

        process.on("SIGINT", () => handleShutdown("SIGINT"));
        process.on("SIGTERM", () => handleShutdown("SIGTERM"));

    } catch (error) {
        console.error("Failed to start test server:", error.message);
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
        process.exit(1);
    }
}

startTestServer();
