/**
 * Visitor Reservation API Service
 *
 * Provides centralized communication with Person B's Express reservation endpoints.
 * Base URL is configurable via VITE_API_URL environment variable,
 * defaulting to http://localhost:5000/api.
 */

const API_BASE_URL = (import.meta.env && import.meta.env.VITE_API_URL)
  ? import.meta.env.VITE_API_URL
  : 'http://localhost:5000/api';

/**
 * Custom API Error carrying HTTP status code and server error details.
 */
export class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Creates a new visitor parking reservation.
 * Endpoint: POST /api/reservations
 *
 * @param {Object} payload - { slotId, customerName, vehicleNumber, vehicleType }
 * @returns {Promise<Object>} Created reservation record
 */
export async function createReservation({ slotId, customerName, vehicleNumber, vehicleType }) {
  if (!slotId || !slotId.trim()) {
    throw new ApiError('Please select a parking slot.', 400);
  }
  if (!customerName || !customerName.trim()) {
    throw new ApiError('Please enter your full name.', 400);
  }
  if (!vehicleNumber || !vehicleNumber.trim()) {
    throw new ApiError('Please enter your vehicle license plate number.', 400);
  }
  if (!vehicleType || !['car', 'bike'].includes(vehicleType.trim().toLowerCase())) {
    throw new ApiError("Vehicle type must be 'car' or 'bike'.", 400);
  }

  const url = `${API_BASE_URL}/reservations`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      slotId: slotId.trim(),
      customerName: customerName.trim(),
      vehicleNumber: vehicleNumber.trim().toUpperCase(),
      vehicleType: vehicleType.trim().toLowerCase(),
    }),
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok || !json.success) {
    const errorMsg = json.message || `Failed to create reservation (HTTP ${response.status})`;
    throw new ApiError(errorMsg, response.status, json);
  }

  return json.data;
}

/**
 * Fetches reservation details by its unique reservation ID.
 * Endpoint: GET /api/reservations/:reservationId
 *
 * @param {string} reservationId
 * @returns {Promise<Object>} Reservation record
 */
export async function fetchReservationById(reservationId) {
  if (!reservationId || !reservationId.trim()) {
    throw new ApiError('Reservation ID is required.', 400);
  }

  const cleanId = encodeURIComponent(reservationId.trim());
  const url = `${API_BASE_URL}/reservations/${cleanId}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok || !json.success) {
    const errorMsg = json.message || `Reservation '${reservationId}' not found (HTTP ${response.status})`;
    throw new ApiError(errorMsg, response.status, json);
  }

  return json.data;
}

/**
 * Cancels an active reservation and releases the slot.
 * Endpoint: PATCH /api/reservations/:reservationId/cancel
 *
 * @param {string} reservationId
 * @returns {Promise<Object>} Cancellation confirmation data
 */
export async function cancelReservation(reservationId) {
  if (!reservationId || !reservationId.trim()) {
    throw new ApiError('Reservation ID is required.', 400);
  }

  const cleanId = encodeURIComponent(reservationId.trim());
  const url = `${API_BASE_URL}/reservations/${cleanId}/cancel`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Accept': 'application/json',
    },
  });

  const json = await response.json().catch(() => ({}));

  if (!response.ok || !json.success) {
    const errorMsg = json.message || `Failed to cancel reservation (HTTP ${response.status})`;
    throw new ApiError(errorMsg, response.status, json);
  }

  return json.data;
}
