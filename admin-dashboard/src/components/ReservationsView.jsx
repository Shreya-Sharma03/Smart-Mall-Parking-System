import { useEffect, useState, useMemo } from "react";
import {
  Search,
  RefreshCw,
  Eye,
  Ban
} from "lucide-react";
import ReservationDetailsModal from "./ReservationDetailsModal";

export default function ReservationsView({ apiUrl, onRefreshSlots }) {
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionMessageType, setActionMessageType] = useState("");
  const [cancellingId, setCancellingId] = useState(null);
  const [selectedReservation, setSelectedReservation] = useState(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFloor, setSelectedFloor] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("All");

  const fetchReservations = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    setError("");
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`Failed to load reservations (HTTP ${response.status})`);
      }
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.message || "Failed to load reservations.");
      }
      setReservations(Array.isArray(result.data) ? result.data : []);
    } catch (err) {
      setError(err.message || "Unable to connect to reservation service.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchReservations();
    const interval = setInterval(() => {
      fetchReservations();
    }, 10000);
    return () => clearInterval(interval);
  }, [apiUrl]);

  const handleCancel = async (reservation) => {
    const { reservationId, slotId, status } = reservation;
    if (status !== "active") {
      setActionMessage(`Only active reservations can be cancelled (current status: ${status}).`);
      setActionMessageType("error");
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to cancel reservation ${reservationId} for slot ${slotId}?\n\nThis will immediately release slot ${slotId} back to available.`
    );
    if (!confirmed) return;

    try {
      setCancellingId(reservationId);
      setActionMessage("");
      setActionMessageType("");

      const response = await fetch(
        `${apiUrl}/${encodeURIComponent(reservationId)}/cancel`,
        { method: "PATCH" }
      );
      const result = await response.json();

      if (!response.ok || result.success === false) {
        throw new Error(result.message || "Could not cancel reservation.");
      }

      setActionMessage(
        `Reservation ${reservationId} cancelled successfully. Slot ${result.data?.slotId || slotId} is now available.`
      );
      setActionMessageType("success");

      // Re-fetch reservations and parent dashboard slot counts
      await fetchReservations();
      if (onRefreshSlots) {
        await onRefreshSlots();
      }
    } catch (err) {
      setActionMessage(err.message || "Unable to cancel reservation.");
      setActionMessageType("error");
    } finally {
      setCancellingId(null);
    }
  };

  const handleViewDetails = async (reservation) => {
    try {
      const response = await fetch(
        `${apiUrl}/${encodeURIComponent(reservation.reservationId)}`
      );
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          setSelectedReservation(result.data);
          return;
        }
      }
    } catch {
      // Fallback to local reservation object
    }
    setSelectedReservation(reservation);
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const getRemainingTime = (expiryTimeStr, status) => {
    if (status !== "active" || !expiryTimeStr) return null;
    const expiry = new Date(expiryTimeStr);
    const now = new Date();
    const diffMs = expiry.getTime() - now.getTime();
    if (diffMs <= 0) return "Expiring...";
    const mins = Math.ceil(diffMs / 60000);
    return `${mins}m left`;
  };

  const filteredReservations = useMemo(() => {
    return reservations.filter((item) => {
      const term = searchTerm.trim().toLowerCase();
      const matchesSearch =
        !term ||
        item.reservationId?.toLowerCase().includes(term) ||
        item.customerName?.toLowerCase().includes(term) ||
        item.vehicleNumber?.toLowerCase().includes(term) ||
        item.slotId?.toLowerCase().includes(term);

      const matchesFloor = selectedFloor === "All" || item.floor === selectedFloor;
      const matchesStatus = selectedStatus === "All" || item.status === selectedStatus;

      return matchesSearch && matchesFloor && matchesStatus;
    });
  }, [reservations, searchTerm, selectedFloor, selectedStatus]);

  const activeCount = reservations.filter((r) => r.status === "active").length;
  const completedCount = reservations.filter((r) => r.status === "completed").length;
  const cancelledCount = reservations.filter((r) => r.status === "cancelled").length;
  const expiredCount = reservations.filter((r) => r.status === "expired").length;

  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Reservation Management</h2>
          <p>Monitor, search, inspect, and cancel visitor reservations</p>
        </div>

        <button
          className="refresh-button"
          onClick={() => fetchReservations(true)}
          disabled={loading || refreshing}
          title="Refresh reservations"
        >
          <RefreshCw size={15} className={refreshing ? "spinning" : ""} />
          <span>Refresh</span>
        </button>
      </div>

      {actionMessage && (
        <div className={`action-message ${actionMessageType}`} role="status">
          {actionMessage}
        </div>
      )}

      {error && (
        <div className="error-message">
          <p>{error}</p>
          <button onClick={() => fetchReservations(true)} disabled={loading || refreshing}>
            Try Again
          </button>
        </div>
      )}

      {/* Mini KPI banner for reservations */}
      <div className="reservations-mini-stats">
        <div className="mini-stat-item">
          <span className="mini-stat-label">Total Bookings</span>
          <strong className="mini-stat-value">{reservations.length}</strong>
        </div>
        <div className="mini-stat-item">
          <span className="mini-stat-label">Active</span>
          <strong className="mini-stat-value active-text">{activeCount}</strong>
        </div>
        <div className="mini-stat-item">
          <span className="mini-stat-label">Completed</span>
          <strong className="mini-stat-value completed-text">{completedCount}</strong>
        </div>
        <div className="mini-stat-item">
          <span className="mini-stat-label">Cancelled</span>
          <strong className="mini-stat-value cancelled-text">{cancelledCount}</strong>
        </div>
        <div className="mini-stat-item">
          <span className="mini-stat-label">Expired</span>
          <strong className="mini-stat-value expired-text">{expiredCount}</strong>
        </div>
      </div>

      {/* Filter panel */}
      <div className="filter-panel">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search by Reservation ID, Customer, Vehicle No, or Slot..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <select
          value={selectedFloor}
          onChange={(e) => setSelectedFloor(e.target.value)}
          aria-label="Filter by floor"
        >
          <option value="All">All Floors</option>
          <option value="B1">Floor B1</option>
          <option value="B2">Floor B2</option>
        </select>

        <select
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="All">All Statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Table */}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Reservation ID</th>
              <th>Customer</th>
              <th>Vehicle</th>
              <th>Slot / Floor</th>
              <th>Window (Start — Expiry)</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="7" className="empty-state">
                  Loading reservations...
                </td>
              </tr>
            ) : filteredReservations.length === 0 ? (
              <tr>
                <td colSpan="7" className="empty-state">
                  {reservations.length === 0
                    ? "No reservations found in the database."
                    : "No matching reservations found for current filters."}
                </td>
              </tr>
            ) : (
              filteredReservations.map((item) => {
                const remaining = getRemainingTime(item.expiryTime, item.status);
                const isCancelling = cancellingId === item.reservationId;

                return (
                  <tr key={item.reservationId}>
                    <td className="slot-id mono-cell">{item.reservationId}</td>
                    <td>
                      <div className="customer-cell">
                        <strong>{item.customerName}</strong>
                      </div>
                    </td>
                    <td>
                      <div className="vehicle-cell">
                        <span className="plate-badge">{item.vehicleNumber}</span>
                        <span className="vehicle-type-tag">{item.vehicleType}</span>
                      </div>
                    </td>
                    <td>
                      <strong>{item.slotId}</strong>
                      <span className="floor-tag">({item.floor})</span>
                    </td>
                    <td>
                      <div className="window-cell">
                        <span>{formatDateTime(item.startTime)}</span>
                        <span className="arrow-sep">→</span>
                        <span>{formatDateTime(item.expiryTime)}</span>
                        {remaining && (
                          <span className="remaining-pill" title="Time remaining before auto-expiry">
                            {remaining}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${item.status}`}>
                        {item.status}
                      </span>
                    </td>
                    <td>
                      <div className="reservation-actions">
                        <button
                          className="view-details-button"
                          onClick={() => handleViewDetails(item)}
                          title="View complete details"
                        >
                          <Eye size={15} />
                          <span>Details</span>
                        </button>

                        {item.status === "active" ? (
                          <button
                            className="cancel-reservation-button"
                            onClick={() => handleCancel(item)}
                            disabled={isCancelling}
                            title="Cancel reservation and release slot"
                          >
                            <Ban size={15} />
                            <span>{isCancelling ? "Cancelling..." : "Cancel"}</span>
                          </button>
                        ) : (
                          <span className="inactive-action-text">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="results-count">
        Showing {filteredReservations.length} of {reservations.length} reservations
      </p>

      {/* Details modal */}
      {selectedReservation && (
        <ReservationDetailsModal
          reservation={selectedReservation}
          onClose={() => setSelectedReservation(null)}
        />
      )}
    </>
  );
}
