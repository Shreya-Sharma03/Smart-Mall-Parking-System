import React from 'react';
import {
  Navigation,
  ArrowRight,
  GitCommit,
  CornerDownRight,
  MapPin,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { getNodeLabel } from '../data/parkingGraph';

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

  // Filter path nodes that belong to the currently viewed floor (or the ramp connecting it)
  const floorNodes = path.filter(
    (node) => node.startsWith(currentFloor) || (currentFloor === 'B1' && node === 'B1-R1') || (currentFloor === 'B2' && node === 'B2-R1')
  );

  return (
    <div className="route-navigation-bar">
      <div className="route-bar-top">
        <div className="route-bar-title-wrap">
          <div className="route-bar-icon-pulse">
            <Navigation size={18} />
          </div>
          <div>
            <h4 className="route-bar-title">Active Navigation Route</h4>
            <span className="route-bar-sub">
              Target: <strong>{slot.slotId}</strong> (Floor {slot.floor}) • Total Distance: <strong>{distance}m</strong> • Est. {estimatedTime}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="route-bar-clear-btn"
          onClick={onClearRoute}
        >
          Exit Route View
        </button>
      </div>

      {/* Inter-Floor Transition Alert Banner */}
      {isMultiFloor && isOppositeFloor && (
        <div className="inter-floor-route-alert">
          <div className="alert-text-left">
            <CornerDownRight size={18} />
            <div>
              <strong>Multi-Floor Route: Target slot is on {destinationFloor}</strong>
              <p>You are viewing Floor {currentFloor}. Follow Ramp B1-R1 down to Floor B2 to reach {slot.slotId}.</p>
            </div>
          </div>
          <button
            type="button"
            className="btn-switch-to-dest-floor"
            onClick={() => onSwitchFloor(destinationFloor)}
          >
            <span>Switch Map to {destinationFloor}</span>
            <ExternalLink size={14} />
          </button>
        </div>
      )}

      {/* Step-by-Step Path Breadcrumbs */}
      <div className="route-breadcrumbs-container">
        <span className="route-breadcrumb-label">Driving Sequence:</span>
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
                  {!isStart && !isEnd && !isRamp && <GitCommit size={12} />}
                  <span>{nodeId}</span>
                </div>

                {index < path.length - 1 && (
                  <ArrowRight size={12} className="route-crumb-arrow" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
