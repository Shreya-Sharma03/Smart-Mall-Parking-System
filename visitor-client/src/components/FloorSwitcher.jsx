import React from 'react';
import { FLOORS } from '../data/topology.js';
import { Layers } from 'lucide-react';

export default function FloorSwitcher({ activeFloor, onSelectFloor, floorStats }) {
  return (
    <div className="floor-switcher-container">
      <div className="floor-switcher-label">
        <Layers size={18} />
        <span>Basement Floor:</span>
      </div>

      <div className="floor-tabs">
        {FLOORS.map((floor) => {
          const stats = floorStats[floor] || { available: 0, matchingAvailable: 0, total: 12 };
          const isActive = activeFloor === floor;
          const count = stats.matchingAvailable !== undefined ? stats.matchingAvailable : stats.available;

          return (
            <button
              key={floor}
              type="button"
              className={`floor-tab ${isActive ? 'active' : ''}`}
              onClick={() => onSelectFloor(floor)}
            >
              <span className="floor-tab-name">
                {floor === 'B1' ? 'Basement 1 (B1)' : 'Basement 2 (B2)'}
              </span>
              <span className={`floor-tab-badge ${count > 0 ? 'has-slots' : 'no-slots'}`}>
                {count} Available
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
