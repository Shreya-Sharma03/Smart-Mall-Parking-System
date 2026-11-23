import React from 'react';
import { GATES } from '../data/topology.js';
import { Car, Bike, Accessibility, LogIn, CheckCircle2, Sparkles, Navigation } from 'lucide-react';

export default function VisitorPreferences({
  selectedGate,
  onSelectGate,
  vehicleType,
  onSelectVehicle,
  accessibleOnly,
  onToggleAccessible,
  matchingAvailableCount,
  onFindBestSlot,
}) {
  return (
    <section className="preferences-panel">
      <div className="panel-header">
        <div className="panel-header-icon">
          <LogIn size={18} />
        </div>
        <div>
          <h2 className="panel-title">Trip Preferences</h2>
          <p className="panel-subtitle">Select entry gate, vehicle type, and requirements</p>
        </div>
      </div>

      {/* Entry Gate Selection */}
      <div className="pref-group">
        <label className="pref-label">Entrance Gate</label>
        <div className="gate-selector-grid">
          {GATES.map((gate) => {
            const isSelected = selectedGate === gate.id;
            return (
              <button
                key={gate.id}
                type="button"
                className={`gate-btn ${isSelected ? 'active' : ''}`}
                onClick={() => onSelectGate(gate.id)}
              >
                <div className="gate-btn-indicator"></div>
                <div className="gate-btn-content">
                  <span className="gate-name">{gate.name}</span>
                  <span className="gate-id-badge">{gate.id}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Vehicle Type Selection */}
      <div className="pref-group">
        <label className="pref-label">Vehicle Category</label>
        <div className="vehicle-selector-grid">
          <button
            type="button"
            className={`vehicle-btn ${vehicleType === 'car' ? 'active' : ''}`}
            onClick={() => onSelectVehicle('car')}
          >
            <Car size={18} />
            <span>Four-Wheeler (Car)</span>
          </button>

          <button
            type="button"
            className={`vehicle-btn ${vehicleType === 'bike' ? 'active' : ''}`}
            onClick={() => onSelectVehicle('bike')}
          >
            <Bike size={18} />
            <span>Two-Wheeler (Bike)</span>
          </button>
        </div>
      </div>

      {/* Accessibility Preference Toggle */}
      <div className="pref-group">
        <label className="pref-label">Accessibility</label>
        <div
          className={`accessible-toggle-card ${accessibleOnly ? 'active' : ''}`}
          onClick={() => onToggleAccessible(!accessibleOnly)}
          role="button"
          tabIndex={0}
        >
          <div className="accessible-icon-wrap">
            <Accessibility size={18} />
          </div>
          <div className="accessible-text">
            <span className="accessible-title">Accessible Bay Only</span>
            <span className="accessible-desc">Priority bays located near main lifts</span>
          </div>
          <div className={`custom-switch ${accessibleOnly ? 'on' : 'off'}`}>
            <span className="switch-handle"></span>
          </div>
        </div>
      </div>

      {/* Matching summary & Find Best Slot CTA */}
      <div className="pref-match-banner">
        <CheckCircle2 size={16} className="match-icon" />
        <span>
          <strong>{matchingAvailableCount}</strong> matching bays currently available
        </span>
      </div>

      <button
        type="button"
        className="btn-find-best-slot"
        onClick={onFindBestSlot}
        disabled={matchingAvailableCount === 0}
      >
        <Navigation size={16} />
        <span>Recommend Best Parking Slot</span>
      </button>
    </section>
  );
}
