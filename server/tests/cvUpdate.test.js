/**
 * CV Update API Integration Test Suite
 * 
 * Verifies POST /api/slots/cv-update against smart_mall_parking_test database.
 * Uses Node.js built-in node:test runner, node:assert/strict, native fetch,
 * and an ephemeral HTTP port via app.listen(0).
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const app = require("../server");
const ParkingSlot = require("../models/ParkingSlot");
const {
    TEST_DB_NAME,
    connectTestDb,
    disconnectTestDb,
    seedTestSlots,
    getSlotDoc
} = require("./helpers/testDb");
const { getFreshTestSlots } = require("./fixtures/testSlots");

describe("POST /api/slots/cv-update Integration Tests", () => {
    let server;
    let baseUrl;

    // Millisecond offset counter to guarantee strictly monotonic timestamps
    let timeOffsetMs = 0;

    /**
     * Helper to generate strictly monotonic ISO 8601 timestamps
     * @param {number} extraMinutesOffset
     * @returns {string}
     */
    function generateMonotonicTimestamp(extraMinutesOffset = 0) {
        timeOffsetMs += 1000;
        const now = Date.now() - 120000 + timeOffsetMs + (extraMinutesOffset * 60000);
        return new Date(now).toISOString();
    }

    /**
     * Helper to make POST requests to the /api/slots/cv-update endpoint
     * @param {object} payload 
     * @returns {Promise<{ status: number, body: object }>}
     */
    async function postCvUpdate(payload) {
        const response = await fetch(`${baseUrl}/api/slots/cv-update`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const body = await response.json();
        return {
            status: response.status,
            body
        };
    }

    before(async () => {
        // Safe database connection enforcing smart_mall_parking_test
        await connectTestDb();

        // Start Express app on an ephemeral port (0 lets the OS pick an available port)
        await new Promise((resolve) => {
            server = app.listen(0, () => {
                const port = server.address().port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        // Safely close the ephemeral HTTP server
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }

        // Safely disconnect from the test database
        await disconnectTestDb();
    });

    beforeEach(async () => {
        // Reset test database records before each scenario
        await seedTestSlots(getFreshTestSlots());
    });

    // -------------------------------------------------------------
    // Scenario 1: Valid occupied update
    // -------------------------------------------------------------
    it("Scenario 1: Should successfully update an available slot to occupied with valid frame count", async () => {
        const payload = {
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        };

        const { status, body } = await postCvUpdate(payload);

        assert.equal(status, 200);
        assert.equal(body.success, true);
        assert.equal(body.updated, 1);
        assert.equal(body.received, 1);
        assert.deepEqual(body.skipped, []);

        const doc = await getSlotDoc("B1-A01");
        assert.equal(doc.status, "occupied");
    });

    // -------------------------------------------------------------
    // Scenario 2: Valid available update
    // -------------------------------------------------------------
    it("Scenario 2: Should successfully update an occupied slot to available with valid frame count", async () => {
        // B1-A02 is initialized as occupied in fixtures
        const initialDoc = await getSlotDoc("B1-A02");
        assert.equal(initialDoc.status, "occupied");

        const payload = {
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A02",
                    confirmedStatus: "available",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 0,
                    consecutiveAvailableFrames: 5
                }
            ]
        };

        const { status, body } = await postCvUpdate(payload);

        assert.equal(status, 200);
        assert.equal(body.success, true);
        assert.equal(body.updated, 1);
        assert.equal(body.received, 1);
        assert.deepEqual(body.skipped, []);

        const doc = await getSlotDoc("B1-A02");
        assert.equal(doc.status, "available");
    });

    // -------------------------------------------------------------
    // Scenario 3: Unknown camera
    // -------------------------------------------------------------
    it("Scenario 3: Should reject request from an unknown camera ID", async () => {
        const payload = {
            cameraId: "CAM-UNKNOWN-99",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        };

        const { status, body } = await postCvUpdate(payload);

        assert.equal(status, 400);
        assert.equal(body.success, false);
        assert.match(body.message, /Unknown camera ID/i);
    });

    // -------------------------------------------------------------
    // Scenario 4: Disabled camera
    // -------------------------------------------------------------
    it("Scenario 4: Should reject request from a disabled/uncalibrated camera (CAM-B1-02)", async () => {
        const payload = {
            cameraId: "CAM-B1-02",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A09",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        };

        const { status, body } = await postCvUpdate(payload);

        assert.equal(status, 403);
        assert.equal(body.success, false);
        assert.match(body.message, /uncalibrated and disabled/i);
    });

    // -------------------------------------------------------------
    // Scenario 5: Unauthorized slot for camera
    // -------------------------------------------------------------
    it("Scenario 5: Should reject update if slot is not authorized for the submitting camera", async () => {
        // CAM-B1-01 is authorized for B1-A01..B1-A08; B1-A10 belongs to CAM-B1-02
        const payload = {
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A10",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        };

        const { status, body } = await postCvUpdate(payload);

        assert.equal(status, 400);
        assert.equal(body.success, false);
        assert.match(body.message, /not authorized for camera/i);
    });

    // -------------------------------------------------------------
    // Scenario 6: Camera-floor mismatch
    // -------------------------------------------------------------
    it("Scenario 6: Should reject update if database slot floor does not match camera floor", async () => {
        // Temporarily mutate B1-A03 floor to B2 in test database
        await ParkingSlot.updateOne({ slotId: "B1-A03" }, { $set: { floor: "B2" } });

        const payload = {
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A03",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        };

        const { status, body } = await postCvUpdate(payload);

        assert.equal(status, 400);
        assert.equal(body.success, false);
        assert.match(body.message, /does not match camera/i);
    });

    // -------------------------------------------------------------
    // Scenario 7: Missing or invalid timestamp
    // -------------------------------------------------------------
    it("Scenario 7: Should reject missing, non-ISO, or impossible calendar timestamps", async () => {
        // 7a: Missing timestamp
        const resMissing = await postCvUpdate({
            cameraId: "CAM-B1-01",
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        });
        assert.equal(resMissing.status, 400);
        assert.match(resMissing.body.message, /ISO 8601/i);

        // 7b: Invalid format
        const resInvalid = await postCvUpdate({
            cameraId: "CAM-B1-01",
            timestamp: "not-a-valid-timestamp",
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        });
        assert.equal(resInvalid.status, 400);
        assert.match(resInvalid.body.message, /ISO 8601/i);

        // 7c: Impossible calendar date (Feb 31)
        const resFeb31 = await postCvUpdate({
            cameraId: "CAM-B1-01",
            timestamp: "2026-02-31T12:00:00Z",
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        });
        assert.equal(resFeb31.status, 400);
        assert.match(resFeb31.body.message, /ISO 8601/i);
    });

    // -------------------------------------------------------------
    // Scenario 8: Timestamp more than five minutes in the future
    // -------------------------------------------------------------
    it("Scenario 8: Should reject timestamp more than five minutes in the future", async () => {
        const payload = {
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(10), // 10 minutes in the future
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        };

        const { status, body } = await postCvUpdate(payload);

        assert.equal(status, 400);
        assert.equal(body.success, false);
        assert.match(body.message, /future beyond 5 minutes/i);
    });

    // -------------------------------------------------------------
    // Scenario 9: Duplicate and out-of-order timestamps
    // -------------------------------------------------------------
    it("Scenario 9: Should reject duplicate and out-of-order timestamps for the same camera", async () => {
        const baseTimestamp = generateMonotonicTimestamp();

        // Initial valid request
        const res1 = await postCvUpdate({
            cameraId: "CAM-B1-01",
            timestamp: baseTimestamp,
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        });
        assert.equal(res1.status, 200);

        // Duplicate timestamp
        const resDuplicate = await postCvUpdate({
            cameraId: "CAM-B1-01",
            timestamp: baseTimestamp,
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        });
        assert.equal(resDuplicate.status, 400);
        assert.match(resDuplicate.body.message, /Stale or duplicate request rejected/i);

        // Out-of-order (older) timestamp
        const olderTimestamp = new Date(Date.parse(baseTimestamp) - 5000).toISOString();
        const resOlder = await postCvUpdate({
            cameraId: "CAM-B1-01",
            timestamp: olderTimestamp,
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        });
        assert.equal(resOlder.status, 400);
        assert.match(resOlder.body.message, /Stale or duplicate request rejected/i);
    });

    // -------------------------------------------------------------
    // Scenario 10: Duplicate slot IDs in one batch
    // -------------------------------------------------------------
    it("Scenario 10: Should reject batch containing duplicate slot IDs", async () => {
        const payload = {
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                },
                {
                    slotId: "B1-A01",
                    confirmedStatus: "available",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 0,
                    consecutiveAvailableFrames: 5
                }
            ]
        };

        const { status, body } = await postCvUpdate(payload);

        assert.equal(status, 400);
        assert.equal(body.success, false);
        assert.match(body.message, /Duplicate slot ID/i);
    });

    // -------------------------------------------------------------
    // Scenario 11: Empty updates array
    // -------------------------------------------------------------
    it("Scenario 11: Should reject request with empty updates array", async () => {
        const payload = {
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: []
        };

        const { status, body } = await postCvUpdate(payload);

        assert.equal(status, 400);
        assert.equal(body.success, false);
        assert.match(body.message, /Updates must be a non-empty array/i);
    });

    // -------------------------------------------------------------
    // Scenario 12: Batch larger than 24
    // -------------------------------------------------------------
    it("Scenario 12: Should reject batch exceeding maximum limit of 24 items", async () => {
        const oversizedUpdates = [];
        for (let i = 1; i <= 25; i++) {
            oversizedUpdates.push({
                slotId: `B1-A${String(i).padStart(2, "0")}`,
                confirmedStatus: "occupied",
                isMonitored: true,
                consecutiveOccupiedFrames: 3,
                consecutiveAvailableFrames: 0
            });
        }

        const payload = {
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: oversizedUpdates
        };

        const { status, body } = await postCvUpdate(payload);

        assert.equal(status, 400);
        assert.equal(body.success, false);
        assert.match(body.message, /Batch size exceeds maximum limit/i);
    });

    // -------------------------------------------------------------
    // Scenario 13: Missing or invalid frame counts
    // -------------------------------------------------------------
    it("Scenario 13: Should reject negative, non-integer, or insufficient frame counts", async () => {
        // 13a: Negative frame count
        const resNegative = await postCvUpdate({
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: -1,
                    consecutiveAvailableFrames: 0
                }
            ]
        });
        assert.equal(resNegative.status, 400);
        assert.match(resNegative.body.message, /non-negative integer frame counts/i);

        // 13b: Non-integer frame count
        const resFloat = await postCvUpdate({
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3.5,
                    consecutiveAvailableFrames: 0
                }
            ]
        });
        assert.equal(resFloat.status, 400);
        assert.match(resFloat.body.message, /non-negative integer frame counts/i);

        // 13c: Occupied with frame count < 3
        const resLowOccupied = await postCvUpdate({
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 2,
                    consecutiveAvailableFrames: 0
                }
            ]
        });
        assert.equal(resLowOccupied.status, 400);
        assert.match(resLowOccupied.body.message, /consecutiveOccupiedFrames.*< 3/i);

        // 13d: Available with frame count < 5
        const resLowAvailable = await postCvUpdate({
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "available",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 0,
                    consecutiveAvailableFrames: 4
                }
            ]
        });
        assert.equal(resLowAvailable.status, 400);
        assert.match(resLowAvailable.body.message, /consecutiveAvailableFrames.*< 5/i);
    });

    // -------------------------------------------------------------
    // Scenario 14: Unmonitored slot
    // -------------------------------------------------------------
    it("Scenario 14: Should reject update if isMonitored is false or omitted", async () => {
        // 14a: isMonitored is false
        const resFalse = await postCvUpdate({
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: false,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        });
        assert.equal(resFalse.status, 400);
        assert.match(resFalse.body.message, /isMonitored set to true/i);

        // 14b: isMonitored is omitted
        const resOmitted = await postCvUpdate({
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        });
        assert.equal(resOmitted.status, 400);
        assert.match(resOmitted.body.message, /isMonitored set to true/i);
    });

    // -------------------------------------------------------------
    // Scenario 15: Reserved slot protection
    // -------------------------------------------------------------
    it("Scenario 15: Should skip reserved slot and preserve reserved status in database", async () => {
        // B1-A05 is seeded as reserved in fixtures
        const initialDoc = await getSlotDoc("B1-A05");
        assert.equal(initialDoc.status, "reserved");

        const payload = {
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A05",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        };

        const { status, body } = await postCvUpdate(payload);

        assert.equal(status, 200);
        assert.equal(body.success, true);
        assert.equal(body.updated, 0);
        assert.equal(body.skipped.length, 1);
        assert.equal(body.skipped[0].slotId, "B1-A05");
        assert.equal(body.skipped[0].reason, "Slot is reserved");

        const afterDoc = await getSlotDoc("B1-A05");
        assert.equal(afterDoc.status, "reserved");
    });

    // -------------------------------------------------------------
    // Scenario 16: Maintenance slot protection
    // -------------------------------------------------------------
    it("Scenario 16: Should skip maintenance slot and preserve maintenance status in database", async () => {
        // B1-A06 is seeded as maintenance in fixtures
        const initialDoc = await getSlotDoc("B1-A06");
        assert.equal(initialDoc.status, "maintenance");

        const payload = {
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A06",
                    confirmedStatus: "available",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 0,
                    consecutiveAvailableFrames: 5
                }
            ]
        };

        const { status, body } = await postCvUpdate(payload);

        assert.equal(status, 200);
        assert.equal(body.success, true);
        assert.equal(body.updated, 0);
        assert.equal(body.skipped.length, 1);
        assert.equal(body.skipped[0].slotId, "B1-A06");
        assert.equal(body.skipped[0].reason, "Slot is under maintenance");

        const afterDoc = await getSlotDoc("B1-A06");
        assert.equal(afterDoc.status, "maintenance");
    });

    // -------------------------------------------------------------
    // Scenario 17: Nonexistent slot
    // -------------------------------------------------------------
    it("Scenario 17: Should reject batch if an authorized slot does not exist in the database", async () => {
        // Temporarily delete B1-A04 from test database
        await ParkingSlot.deleteOne({ slotId: "B1-A04" });

        const payload = {
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A04",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        };

        const { status, body } = await postCvUpdate(payload);

        assert.equal(status, 400);
        assert.equal(body.success, false);
        assert.match(body.message, /does not exist in the database/i);
    });

    // -------------------------------------------------------------
    // Scenario 18: Invalid status
    // -------------------------------------------------------------
    it("Scenario 18: Should reject invalid status such as 'uncertain' or 'unknown'", async () => {
        const payload = {
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "uncertain",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        };

        const { status, body } = await postCvUpdate(payload);

        assert.equal(status, 400);
        assert.equal(body.success, false);
        assert.match(body.message, /invalid confirmedStatus.*Only 'occupied' or 'available'/i);
    });

    // -------------------------------------------------------------
    // Scenario 19: Invalid batch causes zero database writes
    // -------------------------------------------------------------
    it("Scenario 19: Should ensure invalid batch causes zero database writes (all-or-nothing pre-validation)", async () => {
        // Initial state of B1-A03 is available
        const initialDoc = await getSlotDoc("B1-A03");
        assert.equal(initialDoc.status, "available");

        // Batch contains one valid item (B1-A03) and one invalid item (B1-A04 with invalid frames)
        const payload = {
            cameraId: "CAM-B1-01",
            timestamp: generateMonotonicTimestamp(),
            updates: [
                {
                    slotId: "B1-A03",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                },
                {
                    slotId: "B1-A04",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 1, // Invalid: < 3
                    consecutiveAvailableFrames: 0
                }
            ]
        };

        const { status, body } = await postCvUpdate(payload);

        assert.equal(status, 400);
        assert.equal(body.success, false);

        // Verify that B1-A03 was NOT updated in MongoDB
        const checkDoc = await getSlotDoc("B1-A03");
        assert.equal(checkDoc.status, "available");
    });

    // -------------------------------------------------------------
    // Scenario 20: Same-camera concurrent requests
    // -------------------------------------------------------------
    it("Scenario 20: Should handle concurrent identical-timestamp requests for same camera: exactly one succeeds and one is rejected", async () => {
        const sharedTimestamp = generateMonotonicTimestamp();

        const req1 = postCvUpdate({
            cameraId: "CAM-B1-01",
            timestamp: sharedTimestamp,
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        });

        const req2 = postCvUpdate({
            cameraId: "CAM-B1-01",
            timestamp: sharedTimestamp,
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        });

        const [res1, res2] = await Promise.all([req1, req2]);
        const statuses = [res1.status, res2.status].sort();

        // Exactly one should succeed (200) and the other should be rejected as stale/duplicate (400)
        assert.deepEqual(statuses, [200, 400]);

        const rejected = res1.status === 400 ? res1.body : res2.body;
        assert.match(rejected.message, /Stale or duplicate request rejected/i);
    });

    // -------------------------------------------------------------
    // Scenario 21: Independent cameras processing concurrently
    // -------------------------------------------------------------
    it("Scenario 21: Should allow independent cameras to process requests concurrently without blocking", async () => {
        const timestampB1 = generateMonotonicTimestamp();
        const timestampB2 = generateMonotonicTimestamp();

        const reqCamB1 = postCvUpdate({
            cameraId: "CAM-B1-01",
            timestamp: timestampB1,
            updates: [
                {
                    slotId: "B1-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        });

        const reqCamB2 = postCvUpdate({
            cameraId: "CAM-B2-01",
            timestamp: timestampB2,
            updates: [
                {
                    slotId: "B2-A01",
                    confirmedStatus: "occupied",
                    isMonitored: true,
                    consecutiveOccupiedFrames: 3,
                    consecutiveAvailableFrames: 0
                }
            ]
        });

        const [resB1, resB2] = await Promise.all([reqCamB1, reqCamB2]);

        assert.equal(resB1.status, 200);
        assert.equal(resB1.body.success, true);
        assert.equal(resB1.body.updated, 1);

        assert.equal(resB2.status, 200);
        assert.equal(resB2.body.success, true);
        assert.equal(resB2.body.updated, 1);

        const docB1 = await getSlotDoc("B1-A01");
        const docB2 = await getSlotDoc("B2-A01");

        assert.equal(docB1.status, "occupied");
        assert.equal(docB2.status, "occupied");
    });
});
