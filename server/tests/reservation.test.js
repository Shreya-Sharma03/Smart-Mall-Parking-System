/**
 * Reservation System Integration Test Suite
 * 
 * Verifies all reservation lifecycle operations against smart_mall_parking_test database:
 * - Reservation creation and validation
 * - Concurrency and double-booking protection
 * - Reservation lookup and filtering
 * - Reservation cancellation and slot release
 * - Automatic 30-minute expiry and slot release
 * - Computer vision interlocking and compatibility
 * 
 * Uses Node.js built-in node:test runner, node:assert/strict, native fetch,
 * and an ephemeral HTTP port via app.listen(0).
 */

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const app = require("../server");
const ParkingSlot = require("../models/ParkingSlot");
const Reservation = require("../models/Reservation");
const { releaseExpiredReservations } = require("../utils/reservationExpiry");
const {
    TEST_DB_NAME,
    connectTestDb,
    disconnectTestDb,
    seedTestSlots,
    getSlotDoc
} = require("./helpers/testDb");
const { getFreshTestSlots } = require("./fixtures/testSlots");

describe("Reservation System Integration Tests", () => {
    let server;
    let baseUrl;

    // Millisecond offset counter for monotonic CV timestamps
    let timeOffsetMs = 0;

    function generateMonotonicTimestamp() {
        timeOffsetMs += 1000;
        return new Date(Date.now() - 60000 + timeOffsetMs).toISOString();
    }

    /**
     * HTTP helper for API requests
     */
    async function apiRequest(method, endpoint, body = null) {
        const options = {
            method,
            headers: {}
        };

        if (body !== null) {
            options.headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${baseUrl}${endpoint}`, options);
        let data;
        try {
            data = await response.json();
        } catch {
            data = null;
        }

        return {
            status: response.status,
            body: data
        };
    }

    before(async () => {
        // Enforce strict test database connection
        await connectTestDb();

        // Start Express app on ephemeral port
        await new Promise((resolve) => {
            server = app.listen(0, () => {
                const port = server.address().port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });
    });

    after(async () => {
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        await disconnectTestDb();
    });

    beforeEach(async () => {
        // Reset slots and clear reservations in test DB before each scenario
        await seedTestSlots(getFreshTestSlots());
        await Reservation.deleteMany({});
    });

    // =========================================================================
    // 1. Reservation Creation Tests
    // =========================================================================
    describe("POST /api/reservations - Creation", () => {
        it("Scenario 1: Should successfully reserve an available car slot", async () => {
            const payload = {
                slotId: "B1-A01",
                customerName: "Rahul Sharma",
                vehicleNumber: "dl-01-ab-1234",
                vehicleType: "car"
            };

            const { status, body } = await apiRequest("POST", "/api/reservations", payload);

            assert.equal(status, 201);
            assert.equal(body.success, true);
            assert.equal(body.message, "Slot reserved successfully");
            assert.ok(body.data.reservationId.startsWith("RES-B1-A01-"));
            assert.equal(body.data.slotId, "B1-A01");
            assert.equal(body.data.floor, "B1");
            assert.equal(body.data.customerName, "Rahul Sharma");
            assert.equal(body.data.vehicleNumber, "DL-01-AB-1234"); // Upper-cased
            assert.equal(body.data.vehicleType, "car");
            assert.equal(body.data.status, "active");
            assert.ok(body.data.startTime);
            assert.ok(body.data.expiryTime);

            // Verify in MongoDB directly
            const slotDoc = await getSlotDoc("B1-A01");
            assert.equal(slotDoc.status, "reserved");
            assert.equal(slotDoc.activeReservationId, body.data.reservationId);

            const resDoc = await Reservation.findOne({ reservationId: body.data.reservationId });
            assert.ok(resDoc);
            assert.equal(resDoc.status, "active");
        });

        it("Scenario 2: Should successfully reserve a dual-compatible slot for a bike", async () => {
            const payload = {
                slotId: "B1-A11", // Compatible with ["car", "bike"]
                customerName: "Pooja Verma",
                vehicleNumber: "MH-02-CD-5678",
                vehicleType: "bike"
            };

            const { status, body } = await apiRequest("POST", "/api/reservations", payload);

            assert.equal(status, 201);
            assert.equal(body.success, true);
            assert.equal(body.data.vehicleType, "bike");

            const slotDoc = await getSlotDoc("B1-A11");
            assert.equal(slotDoc.status, "reserved");
            assert.equal(slotDoc.activeReservationId, body.data.reservationId);
        });

        it("Scenario 3: Should reject missing or array request body", async () => {
            // Missing body (no body sent, req.body is undefined)
            const resNoBody = await fetch(`${baseUrl}/api/reservations`, {
                method: "POST"
            });
            assert.equal(resNoBody.status, 400);
            const bodyNoBody = await resNoBody.json();
            assert.equal(bodyNoBody.success, false);
            assert.match(bodyNoBody.message, /valid JSON object/i);

            // Array body sent (req.body is an Array)
            const resArray = await apiRequest("POST", "/api/reservations", [
                { slotId: "B1-A01" }
            ]);
            assert.equal(resArray.status, 400);
            assert.equal(resArray.body.success, false);
            assert.match(resArray.body.message, /valid JSON object/i);
        });

        it("Scenario 4: Should reject missing required fields", async () => {
            // Missing slotId
            const resNoSlot = await apiRequest("POST", "/api/reservations", {
                customerName: "Rahul",
                vehicleNumber: "DL-01-AB-1234",
                vehicleType: "car"
            });
            assert.equal(resNoSlot.status, 400);
            assert.match(resNoSlot.body.message, /slotId is required/i);

            // Missing customerName
            const resNoName = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A01",
                vehicleNumber: "DL-01-AB-1234",
                vehicleType: "car"
            });
            assert.equal(resNoName.status, 400);
            assert.match(resNoName.body.message, /customerName is required/i);

            // Missing vehicleNumber
            const resNoNum = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A01",
                customerName: "Rahul",
                vehicleType: "car"
            });
            assert.equal(resNoNum.status, 400);
            assert.match(resNoNum.body.message, /vehicleNumber is required/i);

            // Whitespace-only fields
            const resWhitespace = await apiRequest("POST", "/api/reservations", {
                slotId: "   ",
                customerName: "Rahul",
                vehicleNumber: "DL-01",
                vehicleType: "car"
            });
            assert.equal(resWhitespace.status, 400);
            assert.match(resWhitespace.body.message, /slotId is required/i);
        });

        it("Scenario 5: Should reject invalid vehicle type", async () => {
            const payload = {
                slotId: "B1-A01",
                customerName: "Rahul",
                vehicleNumber: "DL-01-AB-1234",
                vehicleType: "truck"
            };

            const { status, body } = await apiRequest("POST", "/api/reservations", payload);

            assert.equal(status, 400);
            assert.equal(body.success, false);
            assert.match(body.message, /vehicleType must be 'car' or 'bike'/i);
        });

        it("Scenario 6: Should return 404 for nonexistent slot", async () => {
            const payload = {
                slotId: "B1-Z99",
                customerName: "Rahul",
                vehicleNumber: "DL-01-AB-1234",
                vehicleType: "car"
            };

            const { status, body } = await apiRequest("POST", "/api/reservations", payload);

            assert.equal(status, 404);
            assert.equal(body.success, false);
            assert.match(body.message, /Parking slot 'B1-Z99' not found/i);
        });

        it("Scenario 7: Should reject vehicle-incompatible slot", async () => {
            // Attempt to park car in bike-only slot B1-A09
            const resCarInBike = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A09",
                customerName: "Rahul",
                vehicleNumber: "DL-01-AB-1234",
                vehicleType: "car"
            });
            assert.equal(resCarInBike.status, 400);
            assert.match(resCarInBike.body.message, /not compatible with vehicle type 'car'/i);

            // Attempt to park bike in car-only slot B1-A03
            const resBikeInCar = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A03",
                customerName: "Rahul",
                vehicleNumber: "DL-01-AB-1234",
                vehicleType: "bike"
            });
            assert.equal(resBikeInCar.status, 400);
            assert.match(resBikeInCar.body.message, /not compatible with vehicle type 'bike'/i);
        });

        it("Scenario 8: Should reject reservation if slot is occupied, reserved, or maintenance", async () => {
            // B1-A02 is initialized as occupied
            const resOccupied = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A02",
                customerName: "Rahul",
                vehicleNumber: "DL-01-AB-1234",
                vehicleType: "car"
            });
            assert.equal(resOccupied.status, 409);
            assert.match(resOccupied.body.message, /not available for reservation.*occupied/i);

            // B1-A05 is initialized as reserved
            const resReserved = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A05",
                customerName: "Rahul",
                vehicleNumber: "DL-01-AB-1234",
                vehicleType: "car"
            });
            assert.equal(resReserved.status, 409);
            assert.match(resReserved.body.message, /not available for reservation.*reserved/i);

            // B1-A06 is initialized as maintenance
            const resMaint = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A06",
                customerName: "Rahul",
                vehicleNumber: "DL-01-AB-1234",
                vehicleType: "car"
            });
            assert.equal(resMaint.status, 409);
            assert.match(resMaint.body.message, /not available for reservation.*maintenance/i);
        });
    });

    // =========================================================================
    // 2. Concurrency & Double-Booking Protection
    // =========================================================================
    describe("Concurrency Protection", () => {
        it("Scenario 9: Two simultaneous requests for the same slot: exactly one succeeds and one receives 409", async () => {
            const req1 = apiRequest("POST", "/api/reservations", {
                slotId: "B1-A03",
                customerName: "Visitor One",
                vehicleNumber: "DL-01-AA-1111",
                vehicleType: "car"
            });

            const req2 = apiRequest("POST", "/api/reservations", {
                slotId: "B1-A03",
                customerName: "Visitor Two",
                vehicleNumber: "DL-02-BB-2222",
                vehicleType: "car"
            });

            const [res1, res2] = await Promise.all([req1, req2]);

            const statuses = [res1.status, res2.status].sort();
            assert.deepEqual(statuses, [201, 409], "One request must succeed with 201 and the other fail with 409");

            // Verify database state: exactly 1 active reservation in DB for B1-A03
            const count = await Reservation.countDocuments({ slotId: "B1-A03", status: "active" });
            assert.equal(count, 1);

            const winningRes = res1.status === 201 ? res1.body.data : res2.body.data;
            const slotDoc = await getSlotDoc("B1-A03");
            assert.equal(slotDoc.status, "reserved");
            assert.equal(slotDoc.activeReservationId, winningRes.reservationId);
        });
    });

    // =========================================================================
    // 3. Reservation Lookup & Filtering
    // =========================================================================
    describe("GET /api/reservations - Listing and Details", () => {
        it("Scenario 10: Should list all reservations and support query filtering", async () => {
            // Create two bookings
            const res1 = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A03",
                customerName: "Alice",
                vehicleNumber: "KA-01-AA-1111",
                vehicleType: "car"
            });
            assert.equal(res1.status, 201);

            const res2 = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A04",
                customerName: "Bob",
                vehicleNumber: "KA-02-BB-2222",
                vehicleType: "car"
            });
            assert.equal(res2.status, 201);

            // List all
            const listAll = await apiRequest("GET", "/api/reservations");
            assert.equal(listAll.status, 200);
            assert.equal(listAll.body.success, true);
            assert.equal(listAll.body.count, 2);

            // Filter by slotId
            const filterSlot = await apiRequest("GET", "/api/reservations?slotId=B1-A03");
            assert.equal(filterSlot.status, 200);
            assert.equal(filterSlot.body.count, 1);
            assert.equal(filterSlot.body.data[0].slotId, "B1-A03");

            // Filter by vehicleNumber
            const filterVeh = await apiRequest("GET", "/api/reservations?vehicleNumber=KA-02-BB-2222");
            assert.equal(filterVeh.status, 200);
            assert.equal(filterVeh.body.count, 1);
            assert.equal(filterVeh.body.data[0].vehicleNumber, "KA-02-BB-2222");

            // Filter by status
            const filterActive = await apiRequest("GET", "/api/reservations?status=active");
            assert.equal(filterActive.status, 200);
            assert.equal(filterActive.body.count, 2);

            const filterCancelled = await apiRequest("GET", "/api/reservations?status=cancelled");
            assert.equal(filterCancelled.status, 200);
            assert.equal(filterCancelled.body.count, 0);
        });

        it("Scenario 11: Should retrieve an existing reservation by ID and return 404 for unknown ID", async () => {
            const createRes = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A03",
                customerName: "Alice",
                vehicleNumber: "KA-01-AA-1111",
                vehicleType: "car"
            });
            const resId = createRes.body.data.reservationId;

            // Existing ID
            const getValid = await apiRequest("GET", `/api/reservations/${resId}`);
            assert.equal(getValid.status, 200);
            assert.equal(getValid.body.success, true);
            assert.equal(getValid.body.data.reservationId, resId);

            // Unknown ID
            const getUnknown = await apiRequest("GET", "/api/reservations/RES-UNKNOWN-999");
            assert.equal(getUnknown.status, 404);
            assert.equal(getUnknown.body.success, false);
            assert.match(getUnknown.body.message, /not found/i);
        });
    });

    // =========================================================================
    // 4. Cancellation Tests
    // =========================================================================
    describe("PATCH /api/reservations/:id/cancel - Cancellation", () => {
        it("Scenario 12: Should successfully cancel active reservation, set cancelledAt, and release slot", async () => {
            const createRes = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A03",
                customerName: "Charlie",
                vehicleNumber: "HR-03-CC-3333",
                vehicleType: "car"
            });
            const resId = createRes.body.data.reservationId;

            // Cancel
            const cancelRes = await apiRequest("PATCH", `/api/reservations/${resId}/cancel`);
            assert.equal(cancelRes.status, 200);
            assert.equal(cancelRes.body.success, true);
            assert.equal(cancelRes.body.data.reservationId, resId);
            assert.equal(cancelRes.body.data.status, "cancelled");
            assert.ok(cancelRes.body.data.cancelledAt);

            // Verify in MongoDB
            const slotDoc = await getSlotDoc("B1-A03");
            assert.equal(slotDoc.status, "available");
            assert.equal(slotDoc.activeReservationId, null);

            const resDoc = await Reservation.findOne({ reservationId: resId });
            assert.equal(resDoc.status, "cancelled");
            assert.ok(resDoc.cancelledAt);
        });

        it("Scenario 13: Should reject repeated cancellation request", async () => {
            const createRes = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A03",
                customerName: "Charlie",
                vehicleNumber: "HR-03-CC-3333",
                vehicleType: "car"
            });
            const resId = createRes.body.data.reservationId;

            // First cancellation
            const firstCancel = await apiRequest("PATCH", `/api/reservations/${resId}/cancel`);
            assert.equal(firstCancel.status, 200);

            // Repeated cancellation
            const secondCancel = await apiRequest("PATCH", `/api/reservations/${resId}/cancel`);
            assert.equal(secondCancel.status, 400);
            assert.equal(secondCancel.body.success, false);
            assert.match(secondCancel.body.message, /Only active reservations can be cancelled/i);

            // Slot remains available and activeReservationId remains null
            const slotDoc = await getSlotDoc("B1-A03");
            assert.equal(slotDoc.status, "available");
            assert.equal(slotDoc.activeReservationId, null);
        });

        it("Scenario 14: Should reject cancellation for nonexistent reservation", async () => {
            const res = await apiRequest("PATCH", "/api/reservations/RES-FAKE-123/cancel");
            assert.equal(res.status, 404);
            assert.match(res.body.message, /not found/i);
        });

        it("Scenario 15: Cancellation cannot release a slot owned by another reservation", async () => {
            const createRes = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A03",
                customerName: "Charlie",
                vehicleNumber: "HR-03-CC-3333",
                vehicleType: "car"
            });
            const resId = createRes.body.data.reservationId;

            // Tamper slot's activeReservationId to simulate ownership divergence
            await ParkingSlot.updateOne(
                { slotId: "B1-A03" },
                { $set: { activeReservationId: "RES-SOME-OTHER-ID" } }
            );

            const cancelRes = await apiRequest("PATCH", `/api/reservations/${resId}/cancel`);
            assert.equal(cancelRes.status, 409);
            assert.match(cancelRes.body.message, /ownership mismatch/i);

            // Ensure slot was NOT released
            const slotDoc = await getSlotDoc("B1-A03");
            assert.equal(slotDoc.status, "reserved");
            assert.equal(slotDoc.activeReservationId, "RES-SOME-OTHER-ID");
        });
    });

    // =========================================================================
    // 5. Automatic Expiry Tests
    // =========================================================================
    describe("Automatic Expiry Sweep", () => {
        it("Scenario 16: Should automatically expire overdue active reservation and release slot", async () => {
            // Insert an active reservation with expiryTime in the past
            const pastTime = new Date(Date.now() - 60000); // 1 minute ago
            const resId = "RES-B1-A03-EXPIRED-TEST";

            await Reservation.create({
                reservationId: resId,
                slotId: "B1-A03",
                floor: "B1",
                customerName: "Expired User",
                vehicleNumber: "DL-99-ZZ-9999",
                vehicleType: "car",
                status: "active",
                startTime: new Date(Date.now() - 31 * 60 * 1000),
                expiryTime: pastTime
            });

            // Mark slot as reserved by this reservation
            await ParkingSlot.updateOne(
                { slotId: "B1-A03" },
                { $set: { status: "reserved", activeReservationId: resId } }
            );

            // GET /api/slots triggers releaseExpiredReservations()
            const getSlotsRes = await apiRequest("GET", "/api/slots?floor=B1");
            assert.equal(getSlotsRes.status, 200);

            // Check reservation status
            const resDoc = await Reservation.findOne({ reservationId: resId });
            assert.equal(resDoc.status, "expired");

            // Check slot is released
            const slotDoc = await getSlotDoc("B1-A03");
            assert.equal(slotDoc.status, "available");
            assert.equal(slotDoc.activeReservationId, null);
        });

        it("Scenario 17: Should NOT expire an unexpired active reservation", async () => {
            const createRes = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A03",
                customerName: "Active User",
                vehicleNumber: "DL-01-AA-1111",
                vehicleType: "car"
            });
            const resId = createRes.body.data.reservationId;

            // Trigger expiry sweep
            await releaseExpiredReservations();

            const resDoc = await Reservation.findOne({ reservationId: resId });
            assert.equal(resDoc.status, "active");

            const slotDoc = await getSlotDoc("B1-A03");
            assert.equal(slotDoc.status, "reserved");
            assert.equal(slotDoc.activeReservationId, resId);
        });

        it("Scenario 18: Should NOT expire a cancelled reservation even if past expiry time", async () => {
            const pastTime = new Date(Date.now() - 60000);
            const resId = "RES-B1-A03-CANCELLED-TEST";

            await Reservation.create({
                reservationId: resId,
                slotId: "B1-A03",
                floor: "B1",
                customerName: "Cancelled User",
                vehicleNumber: "DL-99-ZZ-9999",
                vehicleType: "car",
                status: "cancelled",
                cancelledAt: new Date(),
                startTime: new Date(Date.now() - 31 * 60 * 1000),
                expiryTime: pastTime
            });

            await releaseExpiredReservations();

            const resDoc = await Reservation.findOne({ reservationId: resId });
            assert.equal(resDoc.status, "cancelled");
        });

        it("Scenario 19: Expiry helper does not release slot if ownership does not match", async () => {
            const pastTime = new Date(Date.now() - 60000);
            const resId = "RES-B1-A03-MISMATCH-TEST";

            await Reservation.create({
                reservationId: resId,
                slotId: "B1-A03",
                floor: "B1",
                customerName: "Mismatch User",
                vehicleNumber: "DL-99-ZZ-9999",
                vehicleType: "car",
                status: "active",
                startTime: new Date(Date.now() - 31 * 60 * 1000),
                expiryTime: pastTime
            });

            // Slot is owned by another reservation
            await ParkingSlot.updateOne(
                { slotId: "B1-A03" },
                { $set: { status: "reserved", activeReservationId: "RES-OTHER-OWNER" } }
            );

            await releaseExpiredReservations();

            // Reservation becomes expired
            const resDoc = await Reservation.findOne({ reservationId: resId });
            assert.equal(resDoc.status, "expired");

            // But the slot remains untouched and NOT released
            const slotDoc = await getSlotDoc("B1-A03");
            assert.equal(slotDoc.status, "reserved");
            assert.equal(slotDoc.activeReservationId, "RES-OTHER-OWNER");
        });

        it("Scenario 20: Concurrent releaseExpiredReservations calls are safe and idempotent", async () => {
            const pastTime = new Date(Date.now() - 60000);
            const resId = "RES-B1-A03-CONCURRENT-TEST";

            await Reservation.create({
                reservationId: resId,
                slotId: "B1-A03",
                floor: "B1",
                customerName: "Concurrent User",
                vehicleNumber: "DL-99-ZZ-9999",
                vehicleType: "car",
                status: "active",
                startTime: new Date(Date.now() - 31 * 60 * 1000),
                expiryTime: pastTime
            });

            await ParkingSlot.updateOne(
                { slotId: "B1-A03" },
                { $set: { status: "reserved", activeReservationId: resId } }
            );

            // Execute two concurrent sweeps
            const [sweep1, sweep2] = await Promise.all([
                releaseExpiredReservations(),
                releaseExpiredReservations()
            ]);

            const totalReleased = sweep1.releasedCount + sweep2.releasedCount;
            assert.equal(totalReleased, 1, "Exactly one sweep should report releasing the reservation");

            const resDoc = await Reservation.findOne({ reservationId: resId });
            assert.equal(resDoc.status, "expired");

            const slotDoc = await getSlotDoc("B1-A03");
            assert.equal(slotDoc.status, "available");
            assert.equal(slotDoc.activeReservationId, null);
        });
    });

    // =========================================================================
    // 6. Computer Vision Interlocking & Compatibility Tests
    // =========================================================================
    describe("CV Interlocking & Compatibility", () => {
        it("Scenario 21: CV update cannot overwrite a reserved slot (reported in skipped)", async () => {
            // 1. Create a reservation on B1-A03
            const createRes = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A03",
                customerName: "David",
                vehicleNumber: "PB-01-DD-4444",
                vehicleType: "car"
            });
            assert.equal(createRes.status, 201);

            // 2. CV service submits update claiming B1-A03 is occupied
            const cvPayload = {
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

            const cvRes = await apiRequest("POST", "/api/slots/cv-update", cvPayload);

            assert.equal(cvRes.status, 200);
            assert.equal(cvRes.body.success, true);
            assert.equal(cvRes.body.updated, 0);
            assert.equal(cvRes.body.skipped.length, 1);
            assert.equal(cvRes.body.skipped[0].slotId, "B1-A03");
            assert.equal(cvRes.body.skipped[0].reason, "Slot is reserved");

            // Verify slot is still reserved in MongoDB
            const slotDoc = await getSlotDoc("B1-A03");
            assert.equal(slotDoc.status, "reserved");
            assert.equal(slotDoc.activeReservationId, createRes.body.data.reservationId);
        });

        it("Scenario 22: Once reservation is cancelled, CV updates resume updating slot normally", async () => {
            // 1. Create reservation
            const createRes = await apiRequest("POST", "/api/reservations", {
                slotId: "B1-A03",
                customerName: "David",
                vehicleNumber: "PB-01-DD-4444",
                vehicleType: "car"
            });
            const resId = createRes.body.data.reservationId;

            // 2. Cancel reservation
            const cancelRes = await apiRequest("PATCH", `/api/reservations/${resId}/cancel`);
            assert.equal(cancelRes.status, 200);

            // Verify slot is available
            const slotAfterCancel = await getSlotDoc("B1-A03");
            assert.equal(slotAfterCancel.status, "available");

            // 3. CV service submits update marking slot occupied
            const cvPayload = {
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

            const cvRes = await apiRequest("POST", "/api/slots/cv-update", cvPayload);

            assert.equal(cvRes.status, 200);
            assert.equal(cvRes.body.success, true);
            assert.equal(cvRes.body.updated, 1);
            assert.equal(cvRes.body.skipped.length, 0);

            // Verify slot is now occupied
            const slotAfterCv = await getSlotDoc("B1-A03");
            assert.equal(slotAfterCv.status, "occupied");
        });
    });
});
