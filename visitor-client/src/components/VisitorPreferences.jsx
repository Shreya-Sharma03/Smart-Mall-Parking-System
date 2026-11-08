import React from 'react';
import { GATES } from '../data/topology';
import { Car, Bike, Accessibility, LogIn, CheckCircle2, Sparkles } from 'lucide-react';

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
          <p className="panel-subtitle">Select your entry point and vehicle specs</p>
        </div>
      </div>

      {/* Entry Gate Selection */}
      <div className="pref-group">
        <label className="pref-label">Entry Gate</label>
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
        <label className="pref-label">Vehicle Type</label>
        <div className="vehicle-selector-grid">
          <button
            type="button"
            className={`vehicle-btn ${vehicleType === 'car' ? 'active' : ''}`}
            onClick={() => onSelectVehicle('car')}
          >
            <Car size={20} />
            <span>Four-Wheeler (Car)</span>
          </button>

          <button
            type="button"
            className={`vehicle-btn ${vehicleType === 'bike' ? 'active' : ''}`}
            onClick={() => onSelectVehicle('bike')}
          >
            <Bike size={20} />
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
            <Accessibility size={20} />
          </div>
          <div className="accessible-text">
            <span className="accessible-title">Accessible Bay Only</span>
            <span className="accessible-desc">Priority spaces near lifts & concourse</span>
          </div>
          <div className={`custom-switch ${accessibleOnly ? 'on' : 'off'}`}>
            <span className="switch-handle"></span>
          </div>
        </div>
      </div>

      {/* Matching summary pill */}
      <div className="pref-match-banner">
        <CheckCircle2 size={16} className="match-icon" />
        <span>
          <strong>{matchingAvailableCount}</strong> matching slots available now
        </span>
      </div>

      {/* Find Best Parking Slot Trigger Button */}
      <div className="find-slot-action-container">
        <button
          type="button"
          className="btn-find-best-slot"
          onClick={onFindBestSlot}
        >
          <Sparkles size={16} />
          <span>Find Best Parking Slot</span>
        </button>
      </div>
    </section>
  );
}
