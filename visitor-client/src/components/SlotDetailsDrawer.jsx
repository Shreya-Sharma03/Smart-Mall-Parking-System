import React from 'react';
import {
  X,
  Car,
  Bike,
  Accessibility,
  MapPin,
  GitCommit,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Wrench,
  Lock,
} from 'lucide-react';

export default function SlotDetailsDrawer({ slot, onClose, onOpenReservation }) {
  if (!slot) return null;

  const { slotId, floor, status, vehicleType, accessible, connectToJunction } = slot;

  const getStatusAdvice = () => {
    switch (status) {
      case 'available':
        return {
          title: 'Ready for Parking & Reservation',
          desc: 'This space is currently vacant. You can navigate directly or reserve it for 30 minutes.',
          icon: <CheckCircle2 size={18} className="advice-icon success" />,
          boxClass: 'advice-box-available',
        };
      case 'occupied':
        return {
          title: 'Currently Occupied',
          desc: 'Another vehicle is parked here. Please select an available green slot.',
          icon: <AlertTriangle size={18} className="advice-icon warning" />,
          boxClass: 'advice-box-occupied',
        };
      case 'reserved':
        return {
          title: 'Reserved Space',
          desc: 'This bay is currently held under an active reservation.',
          icon: <Lock size={18} className="advice-icon info" />,
          boxClass: 'advice-box-reserved',
        };
      case 'maintenance':
        return {
          title: 'Under Maintenance',
          desc: 'This bay is temporarily closed for facility upkeep or sensor calibration.',
          icon: <Wrench size={18} className="advice-icon danger" />,
          boxClass: 'advice-box-maintenance',
        };
      default:
        return null;
    }
  };

  const advice = getStatusAdvice();
  const isAvailable = status === 'available';

  return (
    <div className="slot-details-card">
      <div className="details-header">
        <div className="details-header-title">
          <span className="details-slot-id">{slotId}</span>
          <span className={`details-status-pill status-${status}`}>{status}</span>
        </div>
        <button
          type="button"
          className="details-close-btn"
          onClick={onClose}
          aria-label="Close details"
        >
          <X size={18} />
        </button>
      </div>

      <div className="details-grid">
        <div className="details-item">
          <span className="details-item-label">
            <MapPin size={14} /> Floor Level
          </span>
          <span className="details-item-value">
            {floor === 'B1' ? 'Basement 1 (B1)' : 'Basement 2 (B2)'}
          </span>
        </div>

        <div className="details-item">
          <span className="details-item-label">
            <Car size={14} /> Supported Vehicles
          </span>
          <span className="details-item-value">
            {vehicleType.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(', ')}
          </span>
        </div>

        <div className="details-item">
          <span className="details-item-label">
            <Accessibility size={14} /> Accessible Bay
          </span>
          <span className="details-item-value">
            {accessible ? 'Yes (Priority Accessible)' : 'Standard Bay'}
          </span>
        </div>

        <div className="details-item">
          <span className="details-item-label">
            <GitCommit size={14} /> Navigation Junction
          </span>
          <span className="details-item-value">{connectToJunction}</span>
        </div>
      </div>

      {advice && (
        <div className={`details-advice-box ${advice.boxClass}`}>
          {advice.icon}
          <div>
            <strong>{advice.title}: </strong>
            <span>{advice.desc}</span>
          </div>
        </div>
      )}

      {/* Reservation Action Button */}
      {isAvailable && onOpenReservation && (
        <div className="details-reserve-action">
          <button
            type="button"
            className="btn-reserve-bay-cta"
            onClick={() => onOpenReservation(slot)}
          >
            <ShieldCheck size={16} />
            <span>Reserve Bay {slotId} (30 Min Hold)</span>
          </button>
        </div>
      )}
    </div>
  );
}
