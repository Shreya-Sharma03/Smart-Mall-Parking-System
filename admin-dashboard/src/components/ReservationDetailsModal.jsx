import { X, Clock, Car, User, MapPin, Hash, XCircle } from "lucide-react";

export default function ReservationDetailsModal({ reservation, onClose }) {
  if (!reservation) return null;

  const formatDateTime = (dateStr) => {
    if (!dateStr) return "None";
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? "—" : d.toLocaleString();
  };

  const getStatusBadge = (status) => {
    const s = (status || "").toLowerCase();
    return `status-badge ${s}`;
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Reservation Details</h3>
            <p className="modal-subtitle">{reservation.reservationId}</p>
          </div>
          <button className="modal-close-btn" onClick={onClose} title="Close modal" aria-label="Close modal">
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-status-banner">
            <span>Current Status:</span>
            <span className={getStatusBadge(reservation.status)}>
              {reservation.status}
            </span>
          </div>

          <div className="modal-grid">
            <div className="detail-item">
              <span className="detail-label">
                <Hash size={14} /> Reservation ID
              </span>
              <span className="detail-value mono">{reservation.reservationId}</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">
                <MapPin size={14} /> Assigned Slot
              </span>
              <span className="detail-value highlight">{reservation.slotId} ({reservation.floor})</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">
                <User size={14} /> Customer Name
              </span>
              <span className="detail-value">{reservation.customerName}</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">
                <Car size={14} /> Vehicle
              </span>
              <span className="detail-value">{reservation.vehicleNumber} ({reservation.vehicleType})</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">
                <Clock size={14} /> Start Time
              </span>
              <span className="detail-value">{formatDateTime(reservation.startTime)}</span>
            </div>

            <div className="detail-item">
              <span className="detail-label">
                <Clock size={14} /> Expiry Time
              </span>
              <span className="detail-value">{formatDateTime(reservation.expiryTime)}</span>
            </div>

            {reservation.cancelledAt && (
              <div className="detail-item full-width">
                <span className="detail-label">
                  <XCircle size={14} /> Cancelled At
                </span>
                <span className="detail-value cancel-text">{formatDateTime(reservation.cancelledAt)}</span>
              </div>
            )}

            {reservation.createdAt && (
              <div className="detail-item">
                <span className="detail-label">Created At</span>
                <span className="detail-value text-muted">{formatDateTime(reservation.createdAt)}</span>
              </div>
            )}

            {reservation.updatedAt && (
              <div className="detail-item">
                <span className="detail-label">Last Updated</span>
                <span className="detail-value text-muted">{formatDateTime(reservation.updatedAt)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="modal-btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
