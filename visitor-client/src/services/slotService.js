/**
 * Visitor Client Slot & Recommendation API Service
 *
 * Provides centralized communication with Person B's Express backend.
 * Base URL is configurable via VITE_API_URL environment variable,
 * defaulting to http://localhost:5000/api.
 */

const API_BASE_URL = (import.meta.env && import.meta.env.VITE_API_URL)
  ? import.meta.env.VITE_API_URL
  : 'http://localhost:5000/api';

/**
 * Normalizes a slot document received from backend MongoDB to ensure
 * all required frontend fields are present with correct types.
 *
 * @param {Object} slot - Raw slot document from backend
 * @returns {Object} Normalized slot object
 */
export function normalizeSlot(slot) {
  if (!slot || typeof slot !== 'object') return null;

  // Determine aisle based on slot number (Slots 01-04 -> Aisle 1, etc.)
  const slotNumMatch = slot.slotId?.match(/A(\d+)/);
  const slotNum = slotNumMatch ? parseInt(slotNumMatch[1], 10) : 1;
  const aisleNum = Math.floor((slotNum - 1) / 4) + 1;
  const junctionId = `${slot.floor || 'B1'}-J${aisleNum}`;

  return {
    _id: slot._id,
    slotId: slot.slotId,
    floor: slot.floor,
    status: slot.status || 'available',
    vehicleType: Array.isArray(slot.vehicleType) ? slot.vehicleType : (slot.vehicleType ? [slot.vehicleType] : ['car']),
    accessible: Boolean(slot.accessible),
    activeReservationId: slot.activeReservationId || null,
    nodeId: slot.nodeId || slot.slotId,
    location: slot.location || { x: 0, y: 0 },
    aisle: `Aisle ${aisleNum}`,
    connectToJunction: junctionId,
    createdAt: slot.createdAt,
    updatedAt: slot.updatedAt,
  };
}

/**
 * Fetch all parking slots from backend with optional filters.
 * Endpoint: GET /api/slots
 *
 * @param {Object} [params] - Query parameters { floor, status, vehicleType, accessible }
 * @returns {Promise<Array<Object>>} Normalized slot documents
 */
export async function fetchSlots(params = {}) {
  const query = new URLSearchParams();
  if (params.floor) query.set('floor', params.floor);
  if (params.status) query.set('status', params.status);
  if (params.vehicleType) query.set('vehicleType', params.vehicleType);
  if (params.accessible !== undefined && params.accessible !== null && params.accessible !== '') {
    query.set('accessible', String(params.accessible));
  }

  const queryString = query.toString();
  const url = `${API_BASE_URL}/slots${queryString ? `?${queryString}` : ''}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `Failed to fetch slots (HTTP ${response.status})`);
  }

  const json = await response.json();
  if (!json.success) {
    throw new Error(json.message || 'Server reported failure while fetching slots');
  }

  const rawSlots = Array.isArray(json.data) ? json.data : (Array.isArray(json.slots) ? json.slots : []);
  return rawSlots.map(normalizeSlot).filter(Boolean);
}

/**
 * Fetch a single parking slot by its ID.
 * Endpoint: GET /api/slots/:slotId
 *
 * @param {string} slotId - e.g. "B1-A01"
 * @returns {Promise<Object>} Normalized slot document
 */
export async function fetchSlotById(slotId) {
  if (!slotId) throw new Error('slotId is required');

  const url = `${API_BASE_URL}/slots/${encodeURIComponent(slotId.trim())}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || `Slot '${slotId}' not found (HTTP ${response.status})`);
  }

  const json = await response.json();
  if (!json.success || !json.data) {
    throw new Error(json.message || `Failed to load slot '${slotId}'`);
  }

  return normalizeSlot(json.data);
}

/**
 * Fetch shortest-path recommended slots from backend.
 * Endpoint: GET /api/slots/recommend?gateId=...&vehicleType=...&accessible=...
 *
 * @param {Object} options - { gateId, vehicleType, accessible }
 * @returns {Promise<Object>} { success, message, count, recommendations }
 */
export async function fetchRecommendedSlots({ gateId = 'B1-GA', vehicleType = 'car', accessible = false }) {
  const query = new URLSearchParams({
    gateId,
    vehicleType,
    accessible: String(Boolean(accessible)),
  });

  const url = `${API_BASE_URL}/slots/recommend?${query.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  const json = await response.json().catch(() => ({}));

  if (response.status === 404) {
    // No suitable slots found is a valid business state, not an unhandled network error
    return {
      success: false,
      message: json.message || 'No suitable available parking slots found',
      count: 0,
      recommendations: [],
    };
  }

  if (!response.ok || !json.success) {
    return {
      success: false,
      message: json.message || `Recommendation request failed (HTTP ${response.status})`,
      count: 0,
      recommendations: [],
    };
  }

  // Normalize each recommended slot inside the recommendations array
  const normalizedRecs = (json.recommendations || []).map((rec) => ({
    ...rec,
    slot: normalizeSlot(rec.slot),
  }));

  return {
    success: true,
    message: json.message || 'Nearest parking slots found',
    count: normalizedRecs.length,
    recommendations: normalizedRecs,
  };
}

/**
 * Health check probe for the Express backend.
 * Endpoint: GET /api/health
 *
 * @returns {Promise<{ isOnline: boolean, message: string }>}
 */
export async function checkBackendHealth() {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return { isOnline: false, message: `HTTP ${response.status}` };
    }
    const json = await response.json();
    return { isOnline: json.success === true, message: json.message || 'Online' };
  } catch (err) {
    return { isOnline: false, message: err.message || 'Connection failed' };
  }
}
