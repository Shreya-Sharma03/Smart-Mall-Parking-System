import React from 'react';
import {
  Navigation,
  ArrowRight,
  GitCommit,
  CornerDownRight,
  MapPin,
  CheckCircle2,
  ExternalLink,
  X,
} from 'lucide-react';
import { getNodeLabel } from '../data/parkingGraph.js';

export default function RouteOverlay({
  activeRoute,
  currentFloor,
  onSwitchFloor,
  onClearRoute,
}) {
  if (!activeRoute || !activeRoute.path || activeRoute.path.length === 0) {
    return null;
  }

  const { path, distance, slot, estimatedTime } = activeRoute;
  const destinationFloor = slot.floor;
  const isMultiFloor = path.some((node) => node.includes('R1'));
  const isOppositeFloor = currentFloor !== destinationFloor;

  return (
    <div className="route-navigation-bar">
      <div className="route-bar-top">
        <div className="route-bar-title-wrap">
          <div className="route-bar-icon-pulse">
            <Navigation size={18} />
          </div>
          <div>
            <div className="route-bar-title">Active Navigation Route</div>
            <div className="route-bar-sub">
              Target: <strong>Bay {slot.slotId}</strong> (Floor {slot.floor}) • Distance: <strong>{distance}m</strong> • Travel:{' '}
              <strong>{estimatedTime}</strong>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="route-bar-clear-btn"
          onClick={onClearRoute}
          aria-label="Clear navigation route"
        >
          <X size={14} />
          <span>Exit Route</span>
        </button>
      </div>

      {/* Inter-Floor Transition Alert Banner */}
      {isMultiFloor && isOppositeFloor && (
        <div className="inter-floor-route-alert">
          <div className="alert-text-left">
            <CornerDownRight size={18} />
            <div>
              <strong>Multi-Floor Route: Destination is on Floor {destinationFloor}</strong>
              <p>
                You are currently viewing Floor {currentFloor}. Follow Ramp B1-R1 to reach Bay {slot.slotId}.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn-switch-to-dest-floor"
            onClick={() => onSwitchFloor(destinationFloor)}
          >
            <span>Switch to Floor {destinationFloor}</span>
            <ExternalLink size={14} />
          </button>
        </div>
      )}

      {/* Step-by-Step Path Breadcrumbs */}
      <div className="route-breadcrumbs-container">
        <span className="route-breadcrumb-label">Route Sequence:</span>
        <div className="route-breadcrumbs-list">
          {path.map((nodeId, index) => {
            const isStart = index === 0;
            const isEnd = index === path.length - 1;
            const isRamp = nodeId.includes('R1');
            const isCurrentFloor = nodeId.startsWith(currentFloor);

            return (
              <React.Fragment key={nodeId}>
                <div
                  className={`route-crumb-node ${isStart ? 'start-crumb' : ''} ${
                    isEnd ? 'dest-crumb' : ''
                  } ${isRamp ? 'ramp-crumb' : ''} ${
                    !isCurrentFloor ? 'other-floor-crumb' : 'active-floor-crumb'
                  }`}
                  title={getNodeLabel(nodeId)}
                >
                  {isStart && <MapPin size={12} />}
                  {isRamp && <CornerDownRight size={12} />}
                  {isEnd && <CheckCircle2 size={12} />}
                  <span>{getNodeLabel(nodeId)}</span>
                </div>
                {index < path.length - 1 && (
                  <ArrowRight size={12} className="crumb-arrow" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
