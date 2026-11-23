import React from 'react';

const LEGEND_ITEMS = [
  {
    status: 'available',
    label: 'Available',
    colorClass: 'legend-available',
    description: 'Vacant and ready to park',
  },
  {
    status: 'occupied',
    label: 'Occupied',
    colorClass: 'legend-occupied',
    description: 'Vehicle currently parked',
  },
  {
    status: 'reserved',
    label: 'Reserved',
    colorClass: 'legend-reserved',
    description: 'Pre-booked space',
  },
  {
    status: 'maintenance',
    label: 'Out of Service',
    colorClass: 'legend-maintenance',
    description: 'Temporarily closed for maintenance',
  },
];

export default function StatusLegend({ counts = {} }) {
  return (
    <div className="status-legend-card">
      <span className="legend-heading">Slot Status:</span>
      <div className="legend-items">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.status} className="legend-item" title={item.description}>
            <span className={`legend-dot ${item.colorClass}`}></span>
            <span className="legend-label">{item.label}</span>
            {counts[item.status] !== undefined && (
              <span className="legend-count">({counts[item.status]})</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
