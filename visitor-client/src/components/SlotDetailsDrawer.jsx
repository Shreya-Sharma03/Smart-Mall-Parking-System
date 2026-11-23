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
  Navigation,
} from 'lucide-react';

export default function SlotDetailsDrawer({
  slot,
  onClose,
  onOpenReservation,
  onNavigateToSlot,
  isNavigating = false,
}) {
  if (!slot) return null;

  const { slotId, floor, status, vehicleType, accessible } = slot;

  const getStatusAdvice = () => {
    switch (status) {
      case 'available':
        return {
          title: 'Ready for Parking & Reservation',
          desc: 'This space is vacant. You can navigate directly or reserve it for 30 minutes.',
          icon: <CheckCircle2 size={16} className="advice-icon success" />,
          boxClass: 'advice-box-available',
        };
      case 'occupied':
        return {
          title: 'Currently Occupied',
          desc: 'Another vehicle is parked here. Please choose an available green slot.',
          icon: <AlertTriangle size={16} className="advice-icon warning" />,
          boxClass: 'advice-box-occupied',
        };
      case 'reserved':
        return {
          title: 'Reserved Space',
          desc: 'This bay is currently held under an active reservation.',
          icon: <Lock size={16} className="advice-icon info" />,
          boxClass: 'advice-box-reserved',
        };
      case 'maintenance':
        return {
          title: 'Out of Service',
          desc: 'This bay is temporarily closed for facility upkeep or maintenance.',
          icon: <Wrench size={16} className="advice-icon danger" />,
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
          <span className="details-slot-id">Bay {slotId}</span>
          <span className={`details-status-pill status-${status}`}>{status}</span>
        </div>
        <button
          type="button"
          className="details-close-btn"
          onClick={onClose}
          aria-label="Close details"
        >
          <X size={16} />
        </button>
      </div>

      <div className="details-grid">
        <div className="details-item">
          <span className="details-item-label">
            <MapPin size={13} /> Floor Level
          </span>
          <span className="details-item-value">
            {floor === 'B1' ? 'Basement 1 (B1)' : 'Basement 2 (B2)'}
          </span>
        </div>

        <div className="details-item">
          <span className="details-item-label">
            <Car size={13} /> Vehicle Types
          </span>
          <span className="details-item-value">
            {Array.isArray(vehicleType)
              ? vehicleType.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(', ')
              : vehicleType}
          </span>
        </div>

        <div className="details-item">
          <span className="details-item-label">
            <Accessibility size={13} /> Accessibility
          </span>
          <span className="details-item-value">
            {accessible ? 'Yes (Priority Accessible)' : 'Standard Bay'}
          </span>
        </div>
      </div>

      {advice && (
        <div className={`details-advice-box ${advice.boxClass}`}>
          <div className="advice-header">
            {advice.icon}
            <span className="advice-title">{advice.title}</span>
          </div>
          <p className="advice-desc">{advice.desc}</p>
        </div>
      )}

      {/* Action buttons */}
      <div className="details-actions">
        {isAvailable && onNavigateToSlot && (
          <button
            type="button"
            className={`btn-navigate-slot ${isNavigating ? 'active' : ''}`}
            onClick={() => onNavigateToSlot(slot)}
          >
            <Navigation size={15} />
            <span>{isNavigating ? 'Route Displayed' : 'Navigate Here'}</span>
          </button>
        )}

        {isAvailable && onOpenReservation && (
          <button
            type="button"
            className="btn-reserve-slot"
            onClick={() => onOpenReservation(slot)}
          >
            <ShieldCheck size={16} />
            <span>Reserve Spot (30 Mins)</span>
          </button>
        )}
      </div>
    </div>
  );
}
