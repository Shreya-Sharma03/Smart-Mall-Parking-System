import React from 'react';
import {
  LogIn,
  CornerDownRight,
  MapPin,
  CheckCircle2,
  Navigation,
  Accessibility,
  Car,
  Bike,
  ShieldCheck,
  AlertCircle,
  Clock,
  ArrowRight,
  Layers,
} from 'lucide-react';
import { getNodeLabel } from '../data/parkingGraph.js';

// SVG Blueprint coordinate system (viewBox: 0 0 1000 600)
// Junctions & Gates
const NODE_COORDINATES = {
  // Floor B1 Nodes
  'B1-GA': { x: 80, y: 260, label: 'Gate A Entry', type: 'gate' },
  'B1-J1': { x: 280, y: 260, label: 'Junction 1', type: 'junction' },
  'B1-J2': { x: 500, y: 260, label: 'Junction 2', type: 'junction' },
  'B1-J3': { x: 720, y: 260, label: 'Junction 3', type: 'junction' },
  'B1-GB': { x: 920, y: 260, label: 'Gate B Entry', type: 'gate' },
  'B1-R1': { x: 500, y: 480, label: 'Ramp to B2', type: 'ramp' },

  // Floor B2 Nodes
  'B2-R1': { x: 500, y: 480, label: 'Ramp Arrival', type: 'ramp' },
  'B2-J1': { x: 280, y: 260, label: 'Junction 1', type: 'junction' },
  'B2-J2': { x: 500, y: 260, label: 'Junction 2', type: 'junction' },
  'B2-J3': { x: 720, y: 260, label: 'Junction 3', type: 'junction' },
};

// Slot stall geometries (12 slots per floor, matching junction connections)
// Slots 01-04 -> J1 (x: 280)
// Slots 05-08 -> J2 (x: 500)
// Slots 09-12 -> J3 (x: 720)
const SLOT_LAYOUT_DEFS = [
  // Aisle 1 (Junction 1)
  { num: '01', x: 200, y: 55, width: 72, height: 125, isNorth: true, junctionX: 280 },
  { num: '02', x: 284, y: 55, width: 72, height: 125, isNorth: true, junctionX: 280 },
  { num: '03', x: 200, y: 340, width: 72, height: 125, isNorth: false, junctionX: 280 },
  { num: '04', x: 284, y: 340, width: 72, height: 125, isNorth: false, junctionX: 280 },

  // Aisle 2 (Junction 2)
  { num: '05', x: 420, y: 55, width: 72, height: 125, isNorth: true, junctionX: 500 },
  { num: '06', x: 504, y: 55, width: 72, height: 125, isNorth: true, junctionX: 500 },
  { num: '07', x: 380, y: 340, width: 72, height: 125, isNorth: false, junctionX: 500 },
  { num: '08', x: 552, y: 340, width: 72, height: 125, isNorth: false, junctionX: 500 },

  // Aisle 3 (Junction 3)
  { num: '09', x: 644, y: 55, width: 72, height: 125, isNorth: true, junctionX: 720 },
  { num: '10', x: 728, y: 55, width: 72, height: 125, isNorth: true, junctionX: 720 },
  { num: '11', x: 644, y: 340, width: 72, height: 125, isNorth: false, junctionX: 720 },
  { num: '12', x: 728, y: 340, width: 72, height: 125, isNorth: false, junctionX: 720 },
];

export default function ParkingFloorMap({
  floor,
  slots,
  selectedSlotId,
  onSelectSlot,
  vehicleType,
  accessibleOnly,
  activeRoute = null,
  onSwitchFloor,
  selectedGate,
  onSelectGate,
}) {
  // Filter slots for active floor
  const floorSlots = slots.filter((s) => s.floor === floor);

  // Validate active route
  const isRouteActive = Boolean(activeRoute && activeRoute.path && activeRoute.path.length > 0);
  const targetSlot = isRouteActive ? activeRoute.slot : null;
  const targetFloor = targetSlot ? targetSlot.floor : null;
  const isTargetOnThisFloor = isRouteActive && targetFloor === floor;
  const isMultiFloorRoute = isRouteActive && activeRoute.path.some((n) => n.includes('R1'));

  // Filter path for currently viewed floor
  const currentFloorPath = isRouteActive
    ? activeRoute.path.filter((nodeId) => {
        if (nodeId.startsWith(floor)) return true;
        if (floor === 'B1' && nodeId === 'B1-R1') return true;
        if (floor === 'B2' && nodeId === 'B2-R1') return true;
        return false;
      })
    : [];

  // Build SVG points for route polyline
  const buildSvgPath = () => {
    if (!isRouteActive || currentFloorPath.length === 0) return null;

    const points = [];

    currentFloorPath.forEach((nodeId, idx) => {
      // Check if it's a base node
      if (NODE_COORDINATES[nodeId]) {
        points.push({ x: NODE_COORDINATES[nodeId].x, y: NODE_COORDINATES[nodeId].y, id: nodeId });
        return;
      }

      // Check if it's a parking slot node
      const slotDef = SLOT_LAYOUT_DEFS.find((d) => `${floor}-A${d.num}` === nodeId);
      if (slotDef) {
        // To make driving look natural, first add an aisle turning point right outside the stall
        const stallCenterX = slotDef.x + slotDef.width / 2;
        points.push({ x: stallCenterX, y: 260, id: `${nodeId}-aisle` });
        // Then add the center of the stall
        const stallCenterY = slotDef.isNorth ? slotDef.y + slotDef.height / 2 + 10 : slotDef.y + slotDef.height / 2 - 10;
        points.push({ x: stallCenterX, y: stallCenterY, id: nodeId });
      }
    });

    if (points.length < 2) return null;

    // Convert points to SVG path string
    return points.reduce((acc, pt, i) => {
      return i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
    }, '');
  };

  const svgRouteD = buildSvgPath();

  // Helper to determine slot match
  const checkSlotMatchesFilters = (slot) => {
    const vMatch = Array.isArray(slot.vehicleType)
      ? slot.vehicleType.includes(vehicleType)
      : slot.vehicleType === vehicleType;
    const aMatch = !accessibleOnly || slot.accessible === true;
    return vMatch && aMatch;
  };

  // Check if a junction is in the active path
  const isJunctionActive = (junctionNodeId) => {
    return isRouteActive && currentFloorPath.includes(junctionNodeId);
  };

  const isRampInActivePath = isRouteActive && currentFloorPath.includes(`${floor}-R1`);

  return (
    <div className={`cad-blueprint-wrapper ${isRouteActive ? 'has-active-route' : ''}`}>
      {/* CAD Map Header Horizon */}
      <div className="cad-header-horizon">
        <div className="cad-title-group">
          <div className="cad-indicator-mark"></div>
          <div>
            <div className="cad-level-title">
              {floor === 'B1' ? 'Basement Level 1 (B1)' : 'Basement Level 2 (B2)'}
            </div>
            <div className="cad-subtext">
              {floor === 'B1'
                ? 'Main Concourse • Gate A & Gate B Entry • Transit Ramp to B2'
                : 'Lower Concourse • Transit Ramp from B1 • Monitored Parking Bays'}
            </div>
          </div>
        </div>

        <div className="cad-controls-meta">
          {isRouteActive && (
            <div className="cad-route-meta-badge">
              <Navigation size={13} />
              <span>
                {isTargetOnThisFloor
                  ? `Route Destination: Bay ${targetSlot.slotId}`
                  : `Transit Floor: Follow Ramp to ${targetFloor}`}
              </span>
            </div>
          )}
          <div className="cad-spec-pill">
            <span>12 Monitored Bays</span>
            <span className="spec-dot">•</span>
            <span>Scale 1:100</span>
          </div>
        </div>
      </div>

      {/* Main SVG Blueprint Canvas */}
      <div className="cad-svg-container">
        <svg
          className="cad-floor-svg"
          viewBox="0 0 1000 600"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Parking floor map for ${floor}`}
        >
          <defs>
            {/* Architectural Grid Pattern */}
            <pattern id="cadGridPattern" width="25" height="25" patternUnits="userSpaceOnUse">
              <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#e6e1d6" strokeWidth="0.6" />
              <circle cx="25" cy="25" r="0.75" fill="#d8d1c3" />
            </pattern>

            {/* Glowing route filters */}
            <filter id="routeGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Background drafting grid */}
          <rect width="100%" height="100%" fill="url(#cadGridPattern)" />

          {/* Floor boundary walls */}
          <rect
            x="30"
            y="25"
            width="940"
            height="550"
            rx="12"
            fill="none"
            stroke="#d4ccc0"
            strokeWidth="2.5"
          />
          <rect
            x="36"
            y="31"
            width="928"
            height="538"
            rx="8"
            fill="none"
            stroke="#e2dad0"
            strokeWidth="1"
            strokeDasharray="4 4"
          />

          {/* Structural Concrete Columns */}
          {[
            { x: 60, y: 45 },
            { x: 350, y: 45 },
            { x: 640, y: 45 },
            { x: 920, y: 45 },
            { x: 60, y: 535 },
            { x: 350, y: 535 },
            { x: 640, y: 535 },
            { x: 920, y: 535 },
          ].map((col, idx) => (
            <g key={`col-${idx}`} fill="#cfc8bd" stroke="#b8b0a2" strokeWidth="1">
              <rect x={col.x - 7} y={col.y - 7} width="14" height="14" rx="2" />
              <line x1={col.x - 10} y1={col.y} x2={col.x + 10} y2={col.y} stroke="#a89f92" strokeWidth="0.8" />
              <line x1={col.x} y1={col.y - 10} x2={col.x} y2={col.y + 10} stroke="#a89f92" strokeWidth="0.8" />
            </g>
          ))}

          {/* Central Main Thoroughfare / Driving Aisle */}
          <g id="main-aisle-thoroughfare">
            {/* Driving road fill */}
            <rect
              x="50"
              y="200"
              width="900"
              height="120"
              rx="6"
              fill="#eeebe1"
              stroke="#dfd9cd"
              strokeWidth="1.5"
            />

            {/* Centerline dashed driving markings */}
            <line
              x1="70"
              y1="260"
              x2="930"
              y2="260"
              stroke="#cfc5b4"
              strokeWidth="2"
              strokeDasharray="14 10"
            />

            {/* Driving lane label & flow indicators */}
            <text x="500" y="242" textAnchor="middle" fill="#8c8273" fontSize="10" fontWeight="600" letterSpacing="0.08em">
              MAIN CIRCULATION AISLE • TWO-WAY FLOW • MAX 15 KM/H
            </text>

            {/* Wayfinding direction arrows */}
            <path d="M 160 255 L 180 260 L 160 265" fill="none" stroke="#b0a594" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M 380 255 L 400 260 L 380 265" fill="none" stroke="#b0a594" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M 620 255 L 640 260 L 620 265" fill="none" stroke="#b0a594" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M 840 255 L 820 260 L 840 265" fill="none" stroke="#b0a594" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </g>

          {/* Ramp Portal (Central South Connector at x: 500) */}
          <g
            id="ramp-portal"
            className="cad-interactive-element"
            onClick={() => onSwitchFloor && onSwitchFloor(floor === 'B1' ? 'B2' : 'B1')}
            style={{ cursor: 'pointer' }}
          >
            {/* Ramp lane road connector */}
            <rect
              x="465"
              y="320"
              width="70"
              height="170"
              rx="4"
              fill="#eeebe1"
              stroke={isRampInActivePath ? '#c24d2c' : '#dfd9cd'}
              strokeWidth={isRampInActivePath ? '2' : '1.5'}
            />

            {/* Ramp incline hatching lines */}
            {[345, 365, 385, 405, 425, 445].map((yPos) => (
              <line
                key={`hatch-${yPos}`}
                x1="472"
                y1={yPos}
                x2="528"
                y2={yPos}
                stroke={isRampInActivePath ? '#f3c2b4' : '#dfd9cd'}
                strokeWidth="1.2"
                strokeDasharray="3 3"
              />
            ))}

            {/* Ramp arrival/departure node box */}
            <rect
              x="440"
              y="460"
              width="120"
              height="40"
              rx="6"
              fill={isRampInActivePath ? '#faece7' : '#ffffff'}
              stroke={isRampInActivePath ? '#c24d2c' : '#c8c0b2'}
              strokeWidth={isRampInActivePath ? '2' : '1.5'}
            />
            <text
              x="500"
              y="478"
              textAnchor="middle"
              fill={isRampInActivePath ? '#c24d2c' : '#2d3748'}
              fontSize="10"
              fontWeight="700"
            >
              {floor === 'B1' ? 'RAMP TO B2' : 'RAMP FROM B1'}
            </text>
            <text
              x="500"
              y="492"
              textAnchor="middle"
              fill={isRampInActivePath ? '#a83f21' : '#718096'}
              fontSize="8.5"
              fontWeight="600"
            >
              Node: {floor}-R1 {isRampInActivePath && '• ACTIVE ROUTE'}
            </text>

            {/* Ramp chevron arrow */}
            <path
              d={floor === 'B1' ? 'M 495 380 L 500 395 L 505 380' : 'M 495 395 L 500 380 L 505 395'}
              fill="none"
              stroke={isRampInActivePath ? '#c24d2c' : '#8c8273'}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>

          {/* West Gate A (Floor B1) / Turnaround (Floor B2) */}
          {floor === 'B1' ? (
            <g
              id="gate-a-portal"
              className="cad-interactive-element"
              onClick={() => onSelectGate && onSelectGate('B1-GA')}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x="45"
                y="220"
                width="70"
                height="80"
                rx="6"
                fill={selectedGate === 'B1-GA' ? '#faece7' : '#ffffff'}
                stroke={selectedGate === 'B1-GA' ? '#c24d2c' : '#cfc6b7'}
                strokeWidth={selectedGate === 'B1-GA' ? '2.5' : '1.5'}
              />
              {/* Gate barrier arm */}
              <line
                x1="55"
                y1="260"
                x2="105"
                y2="260"
                stroke={selectedGate === 'B1-GA' ? '#c24d2c' : '#e53e3e'}
                strokeWidth="3.5"
                strokeDasharray="6 4"
              />
              <text
                x="80"
                y="245"
                textAnchor="middle"
                fill={selectedGate === 'B1-GA' ? '#c24d2c' : '#1a202c'}
                fontSize="10"
                fontWeight="700"
              >
                GATE A
              </text>
              <text
                x="80"
                y="285"
                textAnchor="middle"
                fill={selectedGate === 'B1-GA' ? '#a83f21' : '#718096'}
                fontSize="8"
                fontWeight="600"
              >
                {selectedGate === 'B1-GA' ? 'START GATE' : 'B1-GA ENTRY'}
              </text>
            </g>
          ) : (
            <g id="west-turnaround-b2">
              <path
                d="M 50 220 C 35 220 35 300 50 300"
                fill="none"
                stroke="#cfc6b7"
                strokeWidth="2"
                strokeDasharray="4 4"
              />
              <text x="65" y="264" textAnchor="middle" fill="#8c8273" fontSize="8" fontWeight="600">
                TURNING BAY
              </text>
            </g>
          )}

          {/* East Gate B (Floor B1) / Turnaround (Floor B2) */}
          {floor === 'B1' ? (
            <g
              id="gate-b-portal"
              className="cad-interactive-element"
              onClick={() => onSelectGate && onSelectGate('B1-GB')}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x="885"
                y="220"
                width="70"
                height="80"
                rx="6"
                fill={selectedGate === 'B1-GB' ? '#faece7' : '#ffffff'}
                stroke={selectedGate === 'B1-GB' ? '#c24d2c' : '#cfc6b7'}
                strokeWidth={selectedGate === 'B1-GB' ? '2.5' : '1.5'}
              />
              {/* Gate barrier arm */}
              <line
                x1="895"
                y1="260"
                x2="945"
                y2="260"
                stroke={selectedGate === 'B1-GB' ? '#c24d2c' : '#e53e3e'}
                strokeWidth="3.5"
                strokeDasharray="6 4"
              />
              <text
                x="920"
                y="245"
                textAnchor="middle"
                fill={selectedGate === 'B1-GB' ? '#c24d2c' : '#1a202c'}
                fontSize="10"
                fontWeight="700"
              >
                GATE B
              </text>
              <text
                x="920"
                y="285"
                textAnchor="middle"
                fill={selectedGate === 'B1-GB' ? '#a83f21' : '#718096'}
                fontSize="8"
                fontWeight="600"
              >
                {selectedGate === 'B1-GB' ? 'START GATE' : 'B1-GB ENTRY'}
              </text>
            </g>
          ) : (
            <g id="east-turnaround-b2">
              <path
                d="M 950 220 C 965 220 965 300 950 300"
                fill="none"
                stroke="#cfc6b7"
                strokeWidth="2"
                strokeDasharray="4 4"
              />
              <text x="935" y="264" textAnchor="middle" fill="#8c8273" fontSize="8" fontWeight="600">
                TURNING BAY
              </text>
            </g>
          )}

          {/* Junction Node Markers along Thoroughfare */}
          {[
            { id: `${floor}-J1`, x: 280, y: 260, label: 'Junction 1' },
            { id: `${floor}-J2`, x: 500, y: 260, label: 'Junction 2' },
            { id: `${floor}-J3`, x: 720, y: 260, label: 'Junction 3' },
          ].map((junc) => {
            const active = isJunctionActive(junc.id);
            return (
              <g key={junc.id} className="cad-junction-node">
                <circle
                  cx={junc.x}
                  cy={junc.y}
                  r={active ? '9' : '6'}
                  fill={active ? '#c24d2c' : '#ffffff'}
                  stroke={active ? '#a83f21' : '#a0aec0'}
                  strokeWidth={active ? '2.5' : '1.5'}
                />
                {active && (
                  <circle
                    cx={junc.x}
                    cy={junc.y}
                    r="15"
                    fill="none"
                    stroke="#c24d2c"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                    className="cad-beacon-pulse"
                  />
                )}
                <text
                  x={junc.x}
                  y={junc.y + 24}
                  textAnchor="middle"
                  fill={active ? '#c24d2c' : '#718096'}
                  fontSize="8"
                  fontWeight={active ? '700' : '500'}
                >
                  {junc.id}
                </text>
              </g>
            );
          })}

          {/* ---------------- 12 PARKING BAYS ---------------- */}
          {SLOT_LAYOUT_DEFS.map((slotDef) => {
            const slotId = `${floor}-A${slotDef.num}`;
            const slot = floorSlots.find((s) => s.slotId === slotId) || {
              slotId,
              floor,
              status: 'available',
              vehicleType: ['car'],
              accessible: false,
            };

            const isSelected = selectedSlotId === slotId;
            const isTarget = isRouteActive && targetSlot && targetSlot.slotId === slotId;
            const matchesFilters = checkSlotMatchesFilters(slot);

            // Determine status colors based on Terracotta design system
            let strokeColor = '#cfc6b7';
            let fillColor = '#ffffff';
            let textColor = '#4a5568';
            let statusBadgeText = 'AVAILABLE';
            let statusBadgeBg = '#edf7f2';
            let statusBadgeColor = '#247a54';

            if (slot.status === 'available') {
              strokeColor = '#247a54';
              fillColor = '#edf7f2';
              textColor = '#1c6344';
              statusBadgeText = 'VACANT';
              statusBadgeBg = '#247a54';
              statusBadgeColor = '#ffffff';
            } else if (slot.status === 'occupied') {
              strokeColor = '#c24d2c';
              fillColor = '#faece7';
              textColor = '#a83f21';
              statusBadgeText = 'OCCUPIED';
              statusBadgeBg = '#c24d2c';
              statusBadgeColor = '#ffffff';
            } else if (slot.status === 'reserved') {
              strokeColor = '#2f699a';
              fillColor = '#edf4fa';
              textColor = '#1e4b70';
              statusBadgeText = 'RESERVED';
              statusBadgeBg = '#2f699a';
              statusBadgeColor = '#ffffff';
            } else if (slot.status === 'maintenance') {
              strokeColor = '#a67c1e';
              fillColor = '#fbf6ec';
              textColor = '#7d5c14';
              statusBadgeText = 'SERVICE';
              statusBadgeBg = '#a67c1e';
              statusBadgeColor = '#ffffff';
            }

            // Highlighting overrides for selected / target slot
            if (isTarget) {
              strokeColor = '#c24d2c';
              fillColor = '#ffffff';
            } else if (isSelected) {
              strokeColor = '#247a54';
            }

            const centerX = slotDef.x + slotDef.width / 2;
            const centerY = slotDef.y + slotDef.height / 2;

            return (
              <g
                key={slotId}
                id={`bay-${slotId}`}
                className={`cad-bay-stall ${isTarget ? 'is-target' : ''} ${isSelected ? 'is-selected' : ''}`}
                onClick={() => onSelectSlot(slot)}
                style={{ cursor: 'pointer' }}
                tabIndex={0}
                role="button"
                aria-label={`Parking Bay ${slotId}, Status: ${slot.status}`}
              >
                {/* Highlight Halo for Target or Selected */}
                {(isTarget || isSelected) && (
                  <rect
                    x={slotDef.x - 4}
                    y={slotDef.y - 4}
                    width={slotDef.width + 8}
                    height={slotDef.height + 8}
                    rx="8"
                    fill="none"
                    stroke={isTarget ? '#c24d2c' : '#247a54'}
                    strokeWidth="2.5"
                    strokeDasharray={isTarget ? '4 3' : 'none'}
                    className="cad-beacon-pulse"
                  />
                )}

                {/* Stall Stall Boundary Box */}
                <rect
                  x={slotDef.x}
                  y={slotDef.y}
                  width={slotDef.width}
                  height={slotDef.height}
                  rx="4"
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth={isTarget || isSelected ? '2' : '1.5'}
                  opacity={matchesFilters ? 1 : 0.45}
                />

                {/* Stall Inner Marking Lines (Architectural Bay Guidelines) */}
                <line
                  x1={slotDef.x + 4}
                  y1={slotDef.isNorth ? slotDef.y + slotDef.height : slotDef.y}
                  x2={slotDef.x + 4}
                  y2={slotDef.isNorth ? slotDef.y + 6 : slotDef.y + slotDef.height - 6}
                  stroke={strokeColor}
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.6"
                />
                <line
                  x1={slotDef.x + slotDef.width - 4}
                  y1={slotDef.isNorth ? slotDef.y + slotDef.height : slotDef.y}
                  x2={slotDef.x + slotDef.width - 4}
                  y2={slotDef.isNorth ? slotDef.y + 6 : slotDef.y + slotDef.height - 6}
                  stroke={strokeColor}
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.6"
                />

                {/* Bay Header ID */}
                <rect
                  x={slotDef.x + 6}
                  y={slotDef.isNorth ? slotDef.y + 6 : slotDef.y + slotDef.height - 24}
                  width={slotDef.width - 12}
                  height="18"
                  rx="3"
                  fill="#ffffff"
                  stroke={strokeColor}
                  strokeWidth="1"
                />
                <text
                  x={centerX}
                  y={slotDef.isNorth ? slotDef.y + 19 : slotDef.y + slotDef.height - 11}
                  textAnchor="middle"
                  fill={textColor}
                  fontSize="9.5"
                  fontWeight="800"
                >
                  {slotId.split('-')[1]}
                </text>

                {/* Central Stall Content: Vehicle Silhouette or Status */}
                {slot.status === 'occupied' ? (
                  // Vehicle silhouette graphic in CAD
                  <g className="cad-vehicle-silhouette">
                    <rect
                      x={centerX - 18}
                      y={centerY - 24}
                      width="36"
                      height="48"
                      rx="6"
                      fill="#faece7"
                      stroke="#c24d2c"
                      strokeWidth="1.2"
                    />
                    <rect x={centerX - 12} y={centerY - 16} width="24" height="8" rx="2" fill="#c24d2c" opacity="0.3" />
                    <rect x={centerX - 12} y={centerY + 8} width="24" height="6" rx="2" fill="#c24d2c" opacity="0.3" />
                    <text x={centerX} y={centerY + 2} textAnchor="middle" fill="#c24d2c" fontSize="7.5" fontWeight="700">
                      PARKED
                    </text>
                  </g>
                ) : slot.status === 'reserved' ? (
                  <g className="cad-reserved-badge">
                    <rect
                      x={centerX - 24}
                      y={centerY - 14}
                      width="48"
                      height="28"
                      rx="4"
                      fill="#edf4fa"
                      stroke="#2f699a"
                      strokeWidth="1"
                    />
                    <text x={centerX} y={centerY + 3} textAnchor="middle" fill="#2f699a" fontSize="7.5" fontWeight="700">
                      RESERVED
                    </text>
                  </g>
                ) : slot.status === 'maintenance' ? (
                  <g className="cad-maintenance-badge">
                    <rect
                      x={centerX - 24}
                      y={centerY - 14}
                      width="48"
                      height="28"
                      rx="4"
                      fill="#fbf6ec"
                      stroke="#a67c1e"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                    <text x={centerX} y={centerY + 3} textAnchor="middle" fill="#a67c1e" fontSize="7.5" fontWeight="700">
                      CLOSED
                    </text>
                  </g>
                ) : (
                  // Vacant / Ready to park
                  <g className="cad-vacant-indicator">
                    <circle cx={centerX} cy={centerY} r="14" fill="#ffffff" stroke="#247a54" strokeWidth="1.2" />
                    <text x={centerX} y={centerY + 3} textAnchor="middle" fill="#247a54" fontSize="8" fontWeight="700">
                      OPEN
                    </text>
                  </g>
                )}

                {/* Feature Icons: Accessible / Bike / Target Flag */}
                <g className="cad-bay-badges">
                  {slot.accessible && (
                    <circle
                      cx={slotDef.x + 14}
                      cy={slotDef.isNorth ? slotDef.y + slotDef.height - 12 : slotDef.y + 12}
                      r="6"
                      fill="#2f699a"
                      title="Accessible Priority Bay"
                    />
                  )}
                  {slot.vehicleType.includes('bike') && !slot.vehicleType.includes('car') && (
                    <circle
                      cx={slotDef.x + slotDef.width - 14}
                      cy={slotDef.isNorth ? slotDef.y + slotDef.height - 12 : slotDef.y + 12}
                      r="6"
                      fill="#a67c1e"
                      title="Bike Space"
                    />
                  )}
                </g>

                {/* Target Beacon if this slot is the active navigation target */}
                {isTarget && (
                  <g className="cad-target-pin">
                    <circle cx={centerX} cy={centerY} r="6" fill="#c24d2c" />
                    <circle cx={centerX} cy={centerY} r="18" fill="none" stroke="#c24d2c" strokeWidth="2" className="cad-beacon-pulse" />
                  </g>
                )}
              </g>
            );
          })}

          {/* ---------------- HIGHLIGHTED NAVIGATION ROUTE OVERLAY ---------------- */}
          {svgRouteD && (
            <g id="svg-active-route-layer">
              {/* Outer glow aura path */}
              <path
                d={svgRouteD}
                fill="none"
                stroke="rgba(194, 77, 44, 0.22)"
                strokeWidth="14"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Main highlighted solid/dashed polyline */}
              <path
                d={svgRouteD}
                fill="none"
                stroke="#c24d2c"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="10 6"
                className="cad-route-animated-path"
              />

              {/* Inner animated pulse line */}
              <path
                d={svgRouteD}
                fill="none"
                stroke="#ffffff"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="4 8"
                className="cad-route-dash-pulse"
              />

              {/* Route Waypoint Dots */}
              {currentFloorPath.map((nodeId) => {
                const base = NODE_COORDINATES[nodeId];
                if (!base) return null;
                return (
                  <g key={`dot-${nodeId}`}>
                    <circle cx={base.x} cy={base.y} r="5" fill="#c24d2c" stroke="#ffffff" strokeWidth="2" />
                  </g>
                );
              })}

              {/* Target Slot Destination Beacon & Distance Tag */}
              {isTargetOnThisFloor && targetSlot && (
                <g
                  className="cad-destination-tag"
                  transform={`translate(${
                    (SLOT_LAYOUT_DEFS.find((d) => `${floor}-A${d.num}` === targetSlot.slotId)?.x || 200) + 36
                  }, ${
                    SLOT_LAYOUT_DEFS.find((d) => `${floor}-A${d.num}` === targetSlot.slotId)?.isNorth ? 200 : 320
                  })`}
                >
                  <rect x="-65" y="-14" width="130" height="26" rx="4" fill="#c24d2c" stroke="#ffffff" strokeWidth="1.5" />
                  <text x="0" y="3" textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="800">
                    DESTINATION: {targetSlot.slotId} ({activeRoute.distance}m)
                  </text>
                </g>
              )}

              {/* Ramp Transition Tag if multi-floor */}
              {isMultiFloorRoute && !isTargetOnThisFloor && (
                <g className="cad-ramp-transition-tag" transform="translate(500, 435)">
                  <rect x="-85" y="-13" width="170" height="26" rx="4" fill="#c24d2c" stroke="#ffffff" strokeWidth="1.5" />
                  <text x="0" y="4" textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="800">
                    CONTINUE DOWN RAMP TO {targetFloor}
                  </text>
                </g>
              )}
            </g>
          )}
        </svg>
      </div>

      {/* CAD Map Footer / Quick Wayfinding Legend */}
      <div className="cad-map-footer">
        <div className="cad-footer-left">
          <div className="cad-legend-chip">
            <span className="chip-dot dot-available"></span>
            <span>Available</span>
          </div>
          <div className="cad-legend-chip">
            <span className="chip-dot dot-occupied"></span>
            <span>Occupied</span>
          </div>
          <div className="cad-legend-chip">
            <span className="chip-dot dot-reserved"></span>
            <span>Reserved</span>
          </div>
          <div className="cad-legend-chip">
            <span className="chip-dot dot-maintenance"></span>
            <span>Maintenance</span>
          </div>
        </div>

        <div className="cad-footer-right">
          {isRouteActive && (
            <div className="cad-route-summary">
              <Navigation size={13} className="route-icon-pulse" />
              <span>
                Active Route: {activeRoute.distance}m via{' '}
                {currentFloorPath.map((n) => getNodeLabel(n)).slice(0, 3).join(' → ')}
                {currentFloorPath.length > 3 ? '…' : ''}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
