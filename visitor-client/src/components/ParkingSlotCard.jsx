import React from 'react';
import { Car, Bike, Accessibility, Lock, Wrench, CheckCircle } from 'lucide-react';

export default function ParkingSlotCard({
  slot,
  isSelected,
  onSelectSlot,
  matchesFilters,
}) {
  const { slotId, status, vehicleType, accessible } = slot;

  const getStatusIcon = () => {
    switch (status) {
      case 'available':
        return <CheckCircle size={14} className="slot-status-icon icon-available" />;
      case 'occupied':
        return <Car size={14} className="slot-status-icon icon-occupied" />;
      case 'reserved':
        return <Lock size={14} className="slot-status-icon icon-reserved" />;
      case 'maintenance':
        return <Wrench size={14} className="slot-status-icon icon-maintenance" />;
      default:
        return null;
    }
  };

  const isBikeSlot = vehicleType.includes('bike') && !vehicleType.includes('car');
  const isMultiSlot = vehicleType.includes('car') && vehicleType.includes('bike');

  return (
    <div
      className={`parking-slot-bay status-${status} ${isSelected ? 'selected' : ''} ${
        matchesFilters ? 'matches-filter' : 'dimmed'
      }`}
      onClick={() => onSelectSlot(slot)}
      role="button"
      tabIndex={0}
      aria-label={`Parking slot ${slotId}, status ${status}`}
    >
      <div className="bay-marking-top"></div>

      <div className="bay-content">
        <div className="bay-header">
          <span className="bay-id">{slotId}</span>
          {accessible && (
            <span className="accessible-badge" title="Accessible Parking Bay">
              <Accessibility size={12} />
            </span>
          )}
        </div>

        <div className="bay-center-icon">
          {isBikeSlot ? (
            <Bike size={24} className="bay-vehicle-glyph" />
          ) : (
            <Car size={26} className="bay-vehicle-glyph" />
          )}
        </div>

        <div className="bay-footer">
          <span className={`bay-status-badge badge-${status}`}>
            {getStatusIcon()}
            <span className="status-text">{status}</span>
          </span>

          <span className="bay-type-indicator">
            {isBikeSlot ? 'Bike' : isMultiSlot ? 'Car/Bike' : 'Car'}
          </span>
        </div>
      </div>

      <div className="bay-marking-bottom"></div>
    </div>
  );
}
