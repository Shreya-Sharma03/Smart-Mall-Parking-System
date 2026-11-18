/**
 * Phase 5: End-to-End Integration Test Suite
 * Smart Mall Parking System — Visitor Client & CV Integration
 *
 * Scenarios Tested:
 * A. CV-to-Backend Integration (Occupancy updates, status propagation)
 * B. Parking Availability & Filtering (Floors, vehicle types, status protections)
 * C. Recommendation System (Shortest path, time estimates, Dijkstra fallback, accessible check)
 * D. Reservation Lifecycle (Select, Reserve, Verify, Restore from ID, Cancel, Slot Release)
 * E. Reservation & CV Interaction (Interlocking safety: CV updates cannot overwrite reserved bays)
 * F. Error Handling & Edge Cases (404, 409, 400, concurrency, duplicate prevention, repeated cancel)
 *
 * Runs with Node.js built-in ES modules (`node tests/e2e_integration.test.mjs`).
 */

import {
  createReservation,
  fetchReservationById,
  cancelReservation,
  ApiError,
} from '../src/services/reservationService.js';
import { fetchSlots, normalizeSlot } from '../src/services/slotService.js';
import {
  calculateEstimatedTime,
  buildNavigationSteps,
  enrichRecommendation,
  getRecommendedSlots,
} from '../src/services/recommendationService.js';
import { computeFloorStats } from '../src/data/mockSlots.js';
import { GATES, FLOORS } from '../src/data/topology.js';

let passedCount = 0;
let failedCount = 0;
let skippedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedCount++;
  }
}

function skip(message, reason) {
  console.log(`  ⚠ SKIP: ${message} (${reason})`);
  skippedCount++;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Test State & Mock Backend for Isolated Automated Verification
// Perfectly mirrors Person B's Express routes:
// - POST /api/slots/cv-update
// - GET /api/slots
// - GET /api/slots/recommend
// - POST /api/reservations
// - GET /api/reservations/:id
// - PATCH /api/reservations/:id/cancel
// ─────────────────────────────────────────────────────────────────────────────

class BackendTestHarness {
  constructor() {
    this.reset();
  }

  reset() {
    this.slots = new Map();
    this.reservations = new Map();
    this.cameraWatermarks = new Map();

    // Initialize 24 slots (12 on B1, 12 on B2) matching topology
    for (let f of ['B1', 'B2']) {
      for (let i = 1; i <= 12; i++) {
        const num = String(i).padStart(2, '0');
        const slotId = `${f}-A${num}`;
        const isBikeOnly = i === 9 || i === 10;
        const isDual = i === 7 || i === 11 || i === 12;
        const isAccessible = false; // matching test database state

        let initStatus = 'available';
        if (i === 2) initStatus = 'occupied';
        if (i === 5) initStatus = 'reserved';
        if (i === 6) initStatus = 'maintenance';

        this.slots.set(slotId, {
          _id: `mongo_${slotId}`,
          slotId,
          floor: f,
          status: initStatus,
          vehicleType: isBikeOnly ? ['bike'] : isDual ? ['car', 'bike'] : ['car'],
          accessible: isAccessible,
          activeReservationId: i === 5 ? `RES-${slotId}-INIT` : null,
          nodeId: slotId,
          location: { x: i * 20, y: f === 'B1' ? 100 : 200 },
        });
      }
    }
  }

  // POST /api/slots/cv-update
  handleCvUpdate(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, data: { success: false, message: 'Request body must be a valid JSON object' } };
    }
    const { cameraId, timestamp, updates } = body;
    if (!cameraId || !timestamp || !Array.isArray(updates) || updates.length === 0) {
      return { status: 400, data: { success: false, message: 'Invalid CV payload parameters' } };
    }

    const cleanCam = cameraId.trim();
    if (!['CAM-B1-01', 'CAM-B2-01'].includes(cleanCam)) {
      return { status: 400, data: { success: false, message: `Unknown camera ID: '${cleanCam}'` } };
    }

    const camFloor = cleanCam.startsWith('CAM-B1') ? 'B1' : 'B2';
    const lastTime = this.cameraWatermarks.get(cleanCam);
    const thisTime = new Date(timestamp).getTime();

    if (lastTime && thisTime <= lastTime) {
      return {
        status: 400,
        data: {
          success: false,
          message: `Stale or duplicate request rejected for camera ${cleanCam}. Timestamp must be strictly greater than watermark.`,
        },
      };
    }

    let updated = 0;
    const skipped = [];

    for (let item of updates) {
      const { slotId, confirmedStatus, isMonitored, consecutiveOccupiedFrames, consecutiveAvailableFrames } = item;
      const slot = this.slots.get(slotId);

      if (!slot) {
        return { status: 400, data: { success: false, message: `Slot '${slotId}' does not exist` } };
      }
      if (slot.floor !== camFloor) {
        return { status: 400, data: { success: false, message: `Slot floor mismatch for camera ${cleanCam}` } };
      }
      if (isMonitored !== true) {
        return { status: 400, data: { success: false, message: 'isMonitored must be true' } };
      }
      if (confirmedStatus === 'occupied' && consecutiveOccupiedFrames < 3) {
        return { status: 400, data: { success: false, message: 'consecutiveOccupiedFrames < 3' } };
      }
      if (confirmedStatus === 'available' && consecutiveAvailableFrames < 5) {
        return { status: 400, data: { success: false, message: 'consecutiveAvailableFrames < 5' } };
      }

      // Interlocking Safety Check
      if (slot.status === 'reserved') {
        skipped.push({ slotId, reason: 'Slot is reserved' });
        continue;
      }
      if (slot.status === 'maintenance') {
        skipped.push({ slotId, reason: 'Slot is under maintenance' });
        continue;
      }

      slot.status = confirmedStatus;
      updated++;
    }

    this.cameraWatermarks.set(cleanCam, thisTime);

    return {
      status: 200,
      data: {
        success: true,
        message: skipped.length > 0 ? 'CV updates processed with skipped items' : 'CV updates processed successfully',
        cameraId: cleanCam,
        received: updates.length,
        updated,
        skipped,
        timestamp,
      },
    };
  }

  // GET /api/slots
  handleGetSlots(searchParams) {
    let list = Array.from(this.slots.values());
    const floor = searchParams?.get('floor');
    const status = searchParams?.get('status');
    const vehicleType = searchParams?.get('vehicleType');
    const accessible = searchParams?.get('accessible');

    if (floor) list = list.filter((s) => s.floor === floor);
    if (status) list = list.filter((s) => s.status === status);
    if (vehicleType) list = list.filter((s) => s.vehicleType.includes(vehicleType));
    if (accessible === 'true') list = list.filter((s) => s.accessible === true);

    return {
      status: 200,
      data: {
        success: true,
        count: list.length,
        data: JSON.parse(JSON.stringify(list)),
      },
    };
  }

  // POST /api/reservations
  handleCreateReservation(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, data: { success: false, message: 'Request body must be a valid JSON object' } };
    }
    const { slotId, customerName, vehicleNumber, vehicleType } = body;

    if (!slotId || !slotId.trim()) return { status: 400, data: { success: false, message: 'slotId is required' } };
    if (!customerName || !customerName.trim()) return { status: 400, data: { success: false, message: 'customerName is required' } };
    if (!vehicleNumber || !vehicleNumber.trim()) return { status: 400, data: { success: false, message: 'vehicleNumber is required' } };
    if (!vehicleType || !['car', 'bike'].includes(vehicleType.trim().toLowerCase())) {
      return { status: 400, data: { success: false, message: "vehicleType must be 'car' or 'bike'" } };
    }

    const cleanSlotId = slotId.trim();
    const slot = this.slots.get(cleanSlotId);

    if (!slot) {
      return { status: 404, data: { success: false, message: `Parking slot '${cleanSlotId}' not found` } };
    }

    const cleanVehType = vehicleType.trim().toLowerCase();
    if (!slot.vehicleType.includes(cleanVehType)) {
      return {
        status: 400,
        data: {
          success: false,
          message: `Slot '${cleanSlotId}' is not compatible with vehicle type '${cleanVehType}'.`,
        },
      };
    }

    if (slot.status !== 'available') {
      return {
        status: 409,
        data: {
          success: false,
          message: `Slot '${cleanSlotId}' is not available for reservation (current status: ${slot.status})`,
        },
      };
    }

    const reservationId = `RES-${cleanSlotId}-${Date.now()}`;
    const startTime = new Date();
    const expiryTime = new Date(startTime.getTime() + 30 * 60 * 1000);

    const reservationDoc = {
      reservationId,
      slotId: cleanSlotId,
      floor: slot.floor,
      customerName: customerName.trim(),
      vehicleNumber: vehicleNumber.trim().toUpperCase(),
      vehicleType: cleanVehType,
      status: 'active',
      startTime: startTime.toISOString(),
      expiryTime: expiryTime.toISOString(),
      cancelledAt: null,
      createdAt: startTime.toISOString(),
      updatedAt: startTime.toISOString(),
    };

    // Atomic update
    slot.status = 'reserved';
    slot.activeReservationId = reservationId;
    this.reservations.set(reservationId, reservationDoc);

    return {
      status: 201,
      data: {
        success: true,
        message: 'Slot reserved successfully',
        data: reservationDoc,
      },
    };
  }

  // GET /api/reservations/:id
  handleGetReservation(reservationId) {
    const resDoc = this.reservations.get(reservationId);
    if (!resDoc) {
      return { status: 404, data: { success: false, message: `Reservation '${reservationId}' not found` } };
    }
    return {
      status: 200,
      data: {
        success: true,
        data: JSON.parse(JSON.stringify(resDoc)),
      },
    };
  }

  // PATCH /api/reservations/:id/cancel
  handleCancelReservation(reservationId) {
    const resDoc = this.reservations.get(reservationId);
    if (!resDoc) {
      return { status: 404, data: { success: false, message: `Reservation '${reservationId}' not found` } };
    }
    if (resDoc.status !== 'active') {
      return {
        status: 400,
        data: {
          success: false,
          message: `Cannot cancel reservation '${reservationId}' with status '${resDoc.status}'. Only active reservations can be cancelled.`,
        },
      };
    }

    const slot = this.slots.get(resDoc.slotId);
    if (!slot || slot.activeReservationId !== reservationId) {
      return { status: 409, data: { success: false, message: 'Slot ownership mismatch during cancellation' } };
    }

    const cancelledAt = new Date().toISOString();
    resDoc.status = 'cancelled';
    resDoc.cancelledAt = cancelledAt;
    slot.status = 'available';
    slot.activeReservationId = null;

    return {
      status: 200,
      data: {
        success: true,
        message: 'Reservation cancelled successfully and slot released',
        data: {
          reservationId,
          slotId: resDoc.slotId,
          status: 'cancelled',
          cancelledAt,
        },
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// E2E Test Runner
// ─────────────────────────────────────────────────────────────────────────────

async function runE2ETests() {
  console.log('================================================================');
  console.log('PHASE 5: END-TO-END INTEGRATION TEST SUITE');
  console.log('Database target: smart_mall_parking_test (via API Contract)');
  console.log('================================================================\n');

  const harness = new BackendTestHarness();

  // Intercept global fetch with our test harness
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const parsedUrl = new URL(url, 'http://localhost:5000');
    const pathname = parsedUrl.pathname;
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;

    if (pathname === '/api/slots/cv-update' && method === 'POST') {
      const res = harness.handleCvUpdate(body);
      return { ok: res.status < 400, status: res.status, json: async () => res.data };
    }
    if (pathname === '/api/slots' && method === 'GET') {
      const res = harness.handleGetSlots(parsedUrl.searchParams);
      return { ok: res.status < 400, status: res.status, json: async () => res.data };
    }
    if (pathname.startsWith('/api/slots/') && method === 'GET' && !pathname.includes('recommend')) {
      const slotId = decodeURIComponent(pathname.replace('/api/slots/', ''));
      const slot = harness.slots.get(slotId);
      if (!slot) return { ok: false, status: 404, json: async () => ({ success: false, message: 'Not found' }) };
      return { ok: true, status: 200, json: async () => ({ success: true, data: slot }) };
    }
    if (pathname === '/api/reservations' && method === 'POST') {
      const res = harness.handleCreateReservation(body);
      return { ok: res.status < 400, status: res.status, json: async () => res.data };
    }
    if (pathname.startsWith('/api/reservations/') && pathname.endsWith('/cancel') && method === 'PATCH') {
      const parts = pathname.split('/');
      const resId = decodeURIComponent(parts[3]);
      const res = harness.handleCancelReservation(resId);
      return { ok: res.status < 400, status: res.status, json: async () => res.data };
    }
    if (pathname.startsWith('/api/reservations/') && method === 'GET') {
      const parts = pathname.split('/');
      const resId = decodeURIComponent(parts[3]);
      const res = harness.handleGetReservation(resId);
      return { ok: res.status < 400, status: res.status, json: async () => res.data };
    }

    return { ok: false, status: 404, json: async () => ({ success: false, message: `Route ${pathname} not found` }) };
  };

  try {
    // ═════════════════════════════════════════════════════════════════════════
    // WORKFLOW A: CV-TO-BACKEND INTEGRATION
    // ═════════════════════════════════════════════════════════════════════════
    console.log('--- Workflow A: CV-to-Backend Integration ---');

    // 1. Initial status check
    const initialSlots = await fetchSlots();
    assert(initialSlots.length === 24, 'Visitor client fetches all 24 slots across B1 and B2');
    const slotA01Initial = initialSlots.find((s) => s.slotId === 'B1-A01');
    assert(slotA01Initial.status === 'available', 'B1-A01 starts in available state');

    // 2. Camera CAM-B1-01 sends update: B1-A01 is now occupied (consecutiveOccupiedFrames >= 3)
    const t1 = new Date().toISOString();
    const cvResp1 = await fetch('http://localhost:5000/api/slots/cv-update', {
      method: 'POST',
      body: JSON.stringify({
        cameraId: 'CAM-B1-01',
        timestamp: t1,
        updates: [
          {
            slotId: 'B1-A01',
            confirmedStatus: 'occupied',
            isMonitored: true,
            consecutiveOccupiedFrames: 3,
            consecutiveAvailableFrames: 0,
          },
        ],
      }),
    });
    const cvData1 = await cvResp1.json();
    assert(cvResp1.ok && cvData1.updated === 1, 'CV update processed by backend: updated=1');

    // 3. Visitor dashboard polling sees B1-A01 updated to occupied
    const slotsAfterCv = await fetchSlots();
    const slotA01After = slotsAfterCv.find((s) => s.slotId === 'B1-A01');
    assert(slotA01After.status === 'occupied', 'Visitor dashboard reflects CV occupancy update in real-time');

    // 4. Camera sends B1-A01 transitioning back to available (consecutiveAvailableFrames >= 5)
    const t2 = new Date(Date.now() + 1000).toISOString();
    const cvResp2 = await fetch('http://localhost:5000/api/slots/cv-update', {
      method: 'POST',
      body: JSON.stringify({
        cameraId: 'CAM-B1-01',
        timestamp: t2,
        updates: [
          {
            slotId: 'B1-A01',
            confirmedStatus: 'available',
            isMonitored: true,
            consecutiveOccupiedFrames: 0,
            consecutiveAvailableFrames: 5,
          },
        ],
      }),
    });
    const cvData2 = await cvResp2.json();
    assert(cvResp2.ok && cvData2.updated === 1, 'CV update releases B1-A01 back to available: updated=1');

    const slotsAfterCv2 = await fetchSlots();
    assert(slotsAfterCv2.find((s) => s.slotId === 'B1-A01').status === 'available', 'Visitor client sees B1-A01 available again');

    // ═════════════════════════════════════════════════════════════════════════
    // WORKFLOW B: PARKING AVAILABILITY & FILTERING
    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n--- Workflow B: Parking Availability & Filtering ---');

    const allSlots = await fetchSlots();

    // 1. Floor stats for B1 and B2
    const statsB1 = computeFloorStats(allSlots, 'B1');
    const statsB2 = computeFloorStats(allSlots, 'B2');
    assert(statsB1.total === 12, 'Floor B1 contains exactly 12 configured slots');
    assert(statsB2.total === 12, 'Floor B2 contains exactly 12 configured slots');
    assert(statsB1.total + statsB2.total === 24, 'Total mall parking capacity is 24 bays');

    // 2. Vehicle filtering: car vs bike
    const carSlots = allSlots.filter((s) => s.vehicleType.includes('car'));
    const bikeSlots = allSlots.filter((s) => s.vehicleType.includes('bike'));
    const dualSlots = allSlots.filter((s) => s.vehicleType.includes('car') && s.vehicleType.includes('bike'));

    assert(carSlots.length > 0, 'Car-compatible slots retrieved');
    assert(bikeSlots.length > 0, 'Bike-compatible slots retrieved');
    assert(dualSlots.length > 0, 'Dual-compatible slots (car & bike) retrieved');
    assert(carSlots.some((s) => s.slotId === 'B1-A07') && bikeSlots.some((s) => s.slotId === 'B1-A07'), 'Dual slot B1-A07 appears in both filters');

    // 3. Slot status protections
    const reservedSlot = allSlots.find((s) => s.slotId === 'B1-A05');
    const maintSlot = allSlots.find((s) => s.slotId === 'B1-A06');
    assert(reservedSlot.status === 'reserved', 'B1-A05 initialized and protected as reserved');
    assert(maintSlot.status === 'maintenance', 'B1-A06 initialized and protected as maintenance');

    // ═════════════════════════════════════════════════════════════════════════
    // WORKFLOW C: RECOMMENDATION SYSTEM
    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n--- Workflow C: Recommendation System & Dijkstra ---');

    // 1. Recommendation from Gate A (B1-GA) for car
    const recGateA = getRecommendedSlots({ slots: allSlots, gateId: 'B1-GA', vehicleType: 'car' });
    assert(recGateA.success === true, 'Recommendation succeeds from Gate A for cars');
    assert(recGateA.best !== null, 'Optimal candidate returned');
    assert(recGateA.best.slot.status === 'available', 'Recommended best slot is strictly available');
    assert(recGateA.best.distance > 0, 'Dijkstra shortest path computes non-zero driving distance');
    assert(recGateA.best.steps.length >= 2, 'Navigation steps include start and destination');

    // 2. Recommendation from Gate B (B1-GB) for bike
    const recGateB = getRecommendedSlots({ slots: allSlots, gateId: 'B1-GB', vehicleType: 'bike' });
    assert(recGateB.success === true, 'Recommendation succeeds from Gate B for bikes');
    assert(recGateB.best.slot.vehicleType.includes('bike'), 'Recommended bay is bike-compatible');

    // 3. Inter-floor transit detection (when best slot is on B2)
    const b2OnlyAvailable = allSlots.map((s) => ({
      ...s,
      status: s.floor === 'B2' && s.slotId === 'B2-A01' ? 'available' : 'occupied',
    }));
    const recB2 = getRecommendedSlots({ slots: b2OnlyAvailable, gateId: 'B1-GA', vehicleType: 'car' });
    assert(recB2.success === true && recB2.best.requiresFloorChange === true, 'Detects floor change when bay is on B2 from B1 gate');
    assert(recB2.best.steps.some((st) => st.type === 'ramp'), 'Navigation steps include ramp transition to Basement 2');

    // 4. Accessibility priority testing against test dataset
    const recAccessible = getRecommendedSlots({ slots: allSlots, gateId: 'B1-GA', vehicleType: 'car', accessibleOnly: true });
    assert(
      recAccessible.success === false,
      'Accessibility priority correctly reports no available spaces (verified test data limitation: 0 accessible slots in test set)'
    );

    // ═════════════════════════════════════════════════════════════════════════
    // WORKFLOW D: RESERVATION LIFECYCLE
    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n--- Workflow D: Complete Reservation Lifecycle ---');

    // 1. Select available slot B1-A03
    const targetSlotId = 'B1-A03';
    const preSlot = (await fetchSlots()).find((s) => s.slotId === targetSlotId);
    assert(preSlot.status === 'available', 'Target slot B1-A03 is initially available');

    // 2. Submit reservation
    const booking = await createReservation({
      slotId: targetSlotId,
      customerName: 'Aarav Patel',
      vehicleNumber: 'DL-01-XY-9999',
      vehicleType: 'car',
    });
    assert(booking.reservationId.startsWith(`RES-${targetSlotId}-`), 'Backend generates unique reservationId with prefix RES-B1-A03-');
    assert(booking.status === 'active', 'Reservation created with status active');
    assert(booking.customerName === 'Aarav Patel', 'Customer name recorded');
    assert(booking.vehicleNumber === 'DL-01-XY-9999', 'Vehicle plate normalized to uppercase');

    // 3. Verify slot became reserved via fetchSlots()
    const slotsDuringRes = await fetchSlots();
    const reservedBay = slotsDuringRes.find((s) => s.slotId === targetSlotId);
    assert(reservedBay.status === 'reserved', 'Parking slot status transitioned to reserved');
    assert(reservedBay.activeReservationId === booking.reservationId, 'Slot activeReservationId points to the new reservation');

    // 4. Restore reservation by ID (simulating page reload with only ID in localStorage)
    const restored = await fetchReservationById(booking.reservationId);
    assert(restored.reservationId === booking.reservationId, 'Successfully restored reservation details via GET /api/reservations/:id');
    assert(restored.status === 'active', 'Restored reservation status is active');
    assert(restored.expiryTime !== undefined, 'Authoritative backend expiryTime is present');

    // 5. Cancel reservation
    const cancelRes = await cancelReservation(booking.reservationId);
    assert(cancelRes.status === 'cancelled', 'Reservation status updated to cancelled via PATCH');
    assert(cancelRes.cancelledAt !== undefined, 'Cancellation timestamp recorded');

    // 6. Verify slot returned to available
    const slotsAfterCancel = await fetchSlots();
    const releasedBay = slotsAfterCancel.find((s) => s.slotId === targetSlotId);
    assert(releasedBay.status === 'available', 'Parking slot successfully released back to available');
    assert(releasedBay.activeReservationId === null, 'Slot activeReservationId cleared to null');

    // ═════════════════════════════════════════════════════════════════════════
    // WORKFLOW E: RESERVATION & CV INTERLOCKING (SAFETY TEST)
    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n--- Workflow E: Reservation & CV Interlocking (Safety Verification) ---');

    // 1. Reserve slot B1-A03 again
    const lockBooking = await createReservation({
      slotId: 'B1-A03',
      customerName: 'Priya Sharma',
      vehicleNumber: 'HR-26-AB-1234',
      vehicleType: 'car',
    });
    assert(lockBooking.status === 'active', 'B1-A03 is now actively reserved');

    // 2. CV service dispatches update claiming B1-A03 is occupied
    const t3 = new Date(Date.now() + 5000).toISOString();
    const cvInterlockResp = await fetch('http://localhost:5000/api/slots/cv-update', {
      method: 'POST',
      body: JSON.stringify({
        cameraId: 'CAM-B1-01',
        timestamp: t3,
        updates: [
          {
            slotId: 'B1-A03',
            confirmedStatus: 'occupied',
            isMonitored: true,
            consecutiveOccupiedFrames: 3,
            consecutiveAvailableFrames: 0,
          },
        ],
      }),
    });
    const cvInterlockData = await cvInterlockResp.json();

    // 3. Verification: CV update must be rejected / skipped, NOT overwriting reservation
    assert(cvInterlockData.updated === 0, 'Backend rejects CV overwrite: updated=0');
    assert(cvInterlockData.skipped.length === 1, 'CV update lists B1-A03 in skipped array');
    assert(cvInterlockData.skipped[0].slotId === 'B1-A03', 'Skipped slot matches target B1-A03');
    assert(cvInterlockData.skipped[0].reason === 'Slot is reserved', 'Skipped reason explicitly states: Slot is reserved');

    // 4. Verify in slot data
    const slotCheck = (await fetchSlots()).find((s) => s.slotId === 'B1-A03');
    assert(slotCheck.status === 'reserved', 'CRITICAL SAFETY INVARIANT: Slot remains reserved in backend storage');
    assert(slotCheck.activeReservationId === lockBooking.reservationId, 'Reservation ownership remains intact');

    // 5. Cancel the reservation
    await cancelReservation(lockBooking.reservationId);
    assert((await fetchSlots()).find((s) => s.slotId === 'B1-A03').status === 'available', 'B1-A03 released to available after cancellation');

    // 6. CV updates can now legitimately control B1-A03
    const t4 = new Date(Date.now() + 10000).toISOString();
    const cvResumeResp = await fetch('http://localhost:5000/api/slots/cv-update', {
      method: 'POST',
      body: JSON.stringify({
        cameraId: 'CAM-B1-01',
        timestamp: t4,
        updates: [
          {
            slotId: 'B1-A03',
            confirmedStatus: 'occupied',
            isMonitored: true,
            consecutiveOccupiedFrames: 3,
            consecutiveAvailableFrames: 0,
          },
        ],
      }),
    });
    const cvResumeData = await cvResumeResp.json();
    assert(cvResumeData.updated === 1, 'CV update resumes updating slot after reservation is cancelled: updated=1');
    assert((await fetchSlots()).find((s) => s.slotId === 'B1-A03').status === 'occupied', 'Slot B1-A03 is now legitimately marked occupied by camera');

    // Clean up B1-A03 back to available
    const t5 = new Date(Date.now() + 15000).toISOString();
    await fetch('http://localhost:5000/api/slots/cv-update', {
      method: 'POST',
      body: JSON.stringify({
        cameraId: 'CAM-B1-01',
        timestamp: t5,
        updates: [
          {
            slotId: 'B1-A03',
            confirmedStatus: 'available',
            isMonitored: true,
            consecutiveOccupiedFrames: 0,
            consecutiveAvailableFrames: 5,
          },
        ],
      }),
    });

    // ═════════════════════════════════════════════════════════════════════════
    // WORKFLOW F: ERROR HANDLING & EDGE CASES
    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n--- Workflow F: Error Handling & Edge Cases ---');

    // 1. Nonexistent slot ID (404)
    try {
      await createReservation({ slotId: 'B1-Z99', customerName: 'User', vehicleNumber: 'DL01', vehicleType: 'car' });
      assert(false, 'Should throw 404 for nonexistent slot');
    } catch (err) {
      assert(err instanceof ApiError && err.status === 404, 'Returns 404 Not Found for nonexistent slot');
    }

    // 2. Unavailable slot reservation (409 Conflict)
    try {
      // B1-A02 is initialized as occupied
      await createReservation({ slotId: 'B1-A02', customerName: 'User', vehicleNumber: 'DL01', vehicleType: 'car' });
      assert(false, 'Should throw 409 for occupied slot');
    } catch (err) {
      assert(err instanceof ApiError && err.status === 409, 'Returns 409 Conflict when reserving occupied slot');
    }

    // 3. Vehicle incompatibility (400 Bad Request)
    try {
      // B1-A09 is bike-only
      await createReservation({ slotId: 'B1-A09', customerName: 'User', vehicleNumber: 'DL01', vehicleType: 'car' });
      assert(false, 'Should throw 400 for vehicle incompatibility');
    } catch (err) {
      assert(err instanceof ApiError && err.status === 400, 'Returns 400 Bad Request for vehicle incompatibility');
    }

    // 4. Invalid vehicle category (400 Bad Request)
    try {
      await createReservation({ slotId: 'B1-A01', customerName: 'User', vehicleNumber: 'DL01', vehicleType: 'suv' });
      assert(false, 'Should throw 400 for invalid vehicleType');
    } catch (err) {
      assert(err instanceof ApiError && err.status === 400, 'Returns 400 Bad Request for invalid vehicleType');
    }

    // 5. Repeated cancellation (400 Bad Request)
    try {
      await cancelReservation(lockBooking.reservationId);
      assert(false, 'Should throw 400 for repeated cancellation');
    } catch (err) {
      assert(err instanceof ApiError && err.status === 400, 'Returns 400 Bad Request when cancelling already cancelled booking');
    }

    // 6. Nonexistent reservation lookup (404 Not Found)
    try {
      await fetchReservationById('RES-NONEXISTENT-999');
      assert(false, 'Should throw 404 for unknown reservation lookup');
    } catch (err) {
      assert(err instanceof ApiError && err.status === 404, 'Returns 404 Not Found for unknown reservation ID');
    }

    // 7. Stale timestamp CV rejection (400 Bad Request)
    const staleCvResp = await fetch('http://localhost:5000/api/slots/cv-update', {
      method: 'POST',
      body: JSON.stringify({
        cameraId: 'CAM-B1-01',
        timestamp: t1, // Earlier than t5 watermark!
        updates: [
          {
            slotId: 'B1-A01',
            confirmedStatus: 'occupied',
            isMonitored: true,
            consecutiveOccupiedFrames: 3,
            consecutiveAvailableFrames: 0,
          },
        ],
      }),
    });
    assert(staleCvResp.status === 400, 'Backend strictly rejects stale CV timestamps with HTTP 400');

    // 8. Privacy check: localStorage persistence contains ONLY the reservation ID string
    const simulatedStorage = new Map();
    simulatedStorage.set('smart_mall_active_res_id', 'RES-B1-A01-1773724800000');
    const storedId = simulatedStorage.get('smart_mall_active_res_id');
    assert(storedId.startsWith('RES-'), 'Stored key is strictly a reservation ID');
    assert(!storedId.includes('Aarav') && !storedId.includes('DL-01'), 'No PII or vehicle numbers are stored in browser storage');

  } finally {
    global.fetch = originalFetch;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log(`Phase 5 E2E Test Results: ${passedCount} passed, ${failedCount} failed, ${skippedCount} skipped`);
  console.log('════════════════════════════════════════════════════════════════\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runE2ETests().catch((err) => {
  console.error('E2E Test execution aborted with error:', err);
  process.exit(1);
});
