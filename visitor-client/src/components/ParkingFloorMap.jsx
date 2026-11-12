import React from 'react';
import ParkingSlotCard from './ParkingSlotCard';
import {
  LogIn,
  ArrowDownCircle,
  GitCommit,
  CornerDownRight,
  Navigation,
  CheckCircle2,
  MapPin,
} from 'lucide-react';

export default function ParkingFloorMap({
  floor,
  slots,
  selectedSlotId,
  onSelectSlot,
  vehicleType,
  accessibleOnly,
  activeRoute = null,
}) {
  // Filter slots for the current floor
  const floorSlots = slots.filter((s) => s.floor === floor);

  // Split into 3 aisles of 4 slots matching topology junctions
  const aisle1Slots = floorSlots.slice(0, 4); // Slots 01-04 -> J1
  const aisle2Slots = floorSlots.slice(4, 8); // Slots 05-08 -> J2
  const aisle3Slots = floorSlots.slice(8, 12); // Slots 09-12 -> J3

  // Validate that activeRoute strictly matches current vehicle and accessibility filters
  const isRouteValidForFilters = Boolean(
    activeRoute &&
    activeRoute.slot &&
    activeRoute.slot.status === 'available' &&
    activeRoute.slot.vehicleType.includes(vehicleType) &&
    (!accessibleOnly || activeRoute.slot.accessible === true)
  );

  const destinationNode = isRouteValidForFilters ? activeRoute.slot.nodeId : null;
  const pathNodes = isRouteValidForFilters ? (activeRoute.path || []) : [];
  const isGateAActive = floor === 'B1' && pathNodes.includes('B1-GA');
  const isGateBActive = floor === 'B1' && pathNodes.includes('B1-GB');
  const isRampActive = pathNodes.includes(`${floor}-R1`);
  const isDestinationOnThisFloor = isRouteValidForFilters && activeRoute.slot.floor === floor;

  const isJunctionInPath = (junctionId) => pathNodes.includes(junctionId);

  const doesSlotMatchFilters = (slot) => {
    const vehicleMatches = slot.vehicleType.includes(vehicleType);
    const accessibleMatches = !accessibleOnly || slot.accessible === true;
    return vehicleMatches && accessibleMatches;
  };

  return (
    <div className={`parking-map-blueprint ${isRouteValidForFilters ? 'map-has-active-route' : ''}`}>
      {/* Blueprint Header / Landmark Bar */}
      <div className="blueprint-header-bar">
        <div className="blueprint-title-wrap">
          <span className="blueprint-tag">FLOOR BLUEPRINT</span>
          <h3 className="blueprint-floor-name">
            {floor === 'B1'
              ? 'Basement Level 1 (Street Entry & Main Concourse)'
              : 'Basement Level 2 (Lower Concourse)'}
          </h3>
        </div>

        <div className="blueprint-meta">
          {isRouteValidForFilters && isDestinationOnThisFloor && (
            <span className="route-status-flag active-destination">
              <CheckCircle2 size={13} />
              Destination: Bay {activeRoute.slot.slotId}
            </span>
          )}
          {isRouteValidForFilters && !isDestinationOnThisFloor && (
            <span className="route-status-flag transit-floor">
              <CornerDownRight size={13} />
              Transit Floor (Follow Ramp to B2)
            </span>
          )}
          <span className="blueprint-stat">12 Monitored Bays</span>
          <span className="blueprint-divider">•</span>
          <span className="blueprint-stat">3 Drive Aisles</span>
        </div>
      </div>

      {/* Floor B1 Entry Gates Landmark Banner */}
      {floor === 'B1' && (
        <div className="gates-landmark-row">
          <div className={`gate-landmark gate-a ${isGateAActive ? 'route-active-gate' : ''}`}>
            {isGateAActive ? <MapPin size={18} className="gate-pin-icon" /> : <LogIn size={16} />}
            <div>
              <strong>Gate A Entry {isGateAActive && '(Route Start)'}</strong>
              <span>Node: B1-GA</span>
            </div>
          </div>

          <div className="central-drive-banner">
            <Navigation size={14} />
            <span>Main Entry Driveway (Two-Way Flow)</span>
          </div>

          <div className={`gate-landmark gate-b ${isGateBActive ? 'route-active-gate' : ''}`}>
            {isGateBActive ? <MapPin size={18} className="gate-pin-icon" /> : <LogIn size={16} />}
            <div>
              <strong>Gate B Entry {isGateBActive && '(Route Start)'}</strong>
              <span>Node: B1-GB</span>
            </div>
          </div>
        </div>
      )}

      {/* Floor B2 Ramp Arrival Landmark Banner */}
      {floor === 'B2' && (
        <div className={`ramp-arrival-banner ${isRampActive ? 'route-active-ramp' : ''}`}>
          <ArrowDownCircle size={18} />
          <div>
            <strong>
              Ramp Arrival Point (Node: B2-R1) {isRampActive && '— Direct Route Connection'}
            </strong>
            <span>Vehicle transit connection from Floor B1 Ramp (B1-R1)</span>
          </div>
        </div>
      )}

      {/* Main Floor Blueprint Grid */}
      <div className="blueprint-lanes-container">
        {/* Aisle 1 (Junction 1) */}
        <div className={`aisle-section ${isJunctionInPath(`${floor}-J1`) ? 'aisle-in-path' : ''}`}>
          <div className="aisle-header">
            <div
              className={`aisle-junction-pill ${
                isJunctionInPath(`${floor}-J1`) ? 'junction-active-path' : ''
              }`}
            >
              <GitCommit size={14} />
              <span>Junction {floor}-J1</span>
              {isJunctionInPath(`${floor}-J1`) && <span className="path-dot"></span>}
            </div>
            <span className="aisle-title">Aisle 1 (Slots 01 - 04)</span>
          </div>

          <div className="slots-grid">
            {aisle1Slots.map((slot) => {
              const isTarget = isRouteValidForFilters && slot.slotId === destinationNode;
              return (
                <div key={slot.slotId} className={`slot-wrapper ${isTarget ? 'target-slot-wrapper' : ''}`}>
                  {isTarget && (
                    <div className="target-beacon">
                      <CheckCircle2 size={14} />
                      <span>RECOMMENDED DESTINATION</span>
                    </div>
                  )}
                  <ParkingSlotCard
                    slot={slot}
                    isSelected={selectedSlotId === slot.slotId || isTarget}
                    onSelectSlot={onSelectSlot}
                    matchesFilters={doesSlotMatchFilters(slot)}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Central Inter-Aisle Road & Ramp Connection */}
        <div className="inter-aisle-thoroughfare">
          <div className="road-lane-marking">
            <span className="road-text">MAIN TRANSIT CORRIDOR</span>
          </div>

          <div className={`ramp-junction-node ${isRampActive ? 'ramp-active-path' : ''}`}>
            <div className="node-badge">
              <CornerDownRight size={14} />
              <span>
                {floor === 'B1' ? 'Ramp to B2 (B1-R1)' : 'Ramp from B1 (B2-R1)'}
              </span>
              {isRampActive && <span className="ramp-pulse-tag">ACTIVE ROUTE</span>}
            </div>
          </div>
        </div>

        {/* Aisle 2 (Junction 2) */}
        <div className={`aisle-section ${isJunctionInPath(`${floor}-J2`) ? 'aisle-in-path' : ''}`}>
          <div className="aisle-header">
            <div
              className={`aisle-junction-pill ${
                isJunctionInPath(`${floor}-J2`) ? 'junction-active-path' : ''
              }`}
            >
              <GitCommit size={14} />
              <span>Junction {floor}-J2</span>
              {isJunctionInPath(`${floor}-J2`) && <span className="path-dot"></span>}
            </div>
            <span className="aisle-title">Aisle 2 (Slots 05 - 08)</span>
          </div>

          <div className="slots-grid">
            {aisle2Slots.map((slot) => {
              const isTarget = isRouteValidForFilters && slot.slotId === destinationNode;
              return (
                <div key={slot.slotId} className={`slot-wrapper ${isTarget ? 'target-slot-wrapper' : ''}`}>
                  {isTarget && (
                    <div className="target-beacon">
                      <CheckCircle2 size={14} />
                      <span>RECOMMENDED DESTINATION</span>
                    </div>
                  )}
                  <ParkingSlotCard
                    slot={slot}
                    isSelected={selectedSlotId === slot.slotId || isTarget}
                    onSelectSlot={onSelectSlot}
                    matchesFilters={doesSlotMatchFilters(slot)}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Second Inter-Aisle Road */}
        <div className="inter-aisle-thoroughfare secondary">
          <div className="road-lane-marking">
            <span className="road-text">EAST DRIVEWAY</span>
          </div>
        </div>

        {/* Aisle 3 (Junction 3) */}
        <div className={`aisle-section ${isJunctionInPath(`${floor}-J3`) ? 'aisle-in-path' : ''}`}>
          <div className="aisle-header">
            <div
              className={`aisle-junction-pill ${
                isJunctionInPath(`${floor}-J3`) ? 'junction-active-path' : ''
              }`}
            >
              <GitCommit size={14} />
              <span>Junction {floor}-J3</span>
              {isJunctionInPath(`${floor}-J3`) && <span className="path-dot"></span>}
            </div>
            <span className="aisle-title">Aisle 3 (Slots 09 - 12)</span>
          </div>

          <div className="slots-grid">
            {aisle3Slots.map((slot) => {
              const isTarget = isRouteValidForFilters && slot.slotId === destinationNode;
              return (
                <div key={slot.slotId} className={`slot-wrapper ${isTarget ? 'target-slot-wrapper' : ''}`}>
                  {isTarget && (
                    <div className="target-beacon">
                      <CheckCircle2 size={14} />
                      <span>RECOMMENDED DESTINATION</span>
                    </div>
                  )}
                  <ParkingSlotCard
                    slot={slot}
                    isSelected={selectedSlotId === slot.slotId || isTarget}
                    onSelectSlot={onSelectSlot}
                    matchesFilters={doesSlotMatchFilters(slot)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
