import React, { useState } from 'react';
import {
  Compass,
  Navigation2,
  Clock,
  Car,
  Bike,
  Accessibility,
  ArrowRight,
  Layers,
  Sparkles,
  AlertCircle,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export default function RecommendationCard({
  recommendation,
  isRouteActive,
  onToggleRoute,
  onSelectAlternative,
  activeRouteSlotId,
}) {
  const [showAlternatives, setShowAlternatives] = useState(false);

  if (!recommendation) {
    return null;
  }

  // Handle zero matching/eligible slots
  if (!recommendation.success || !recommendation.best) {
    return (
      <div className="recommendation-card empty-state">
        <div className="recommendation-header">
          <div className="rec-badge-icon warning">
            <AlertCircle size={20} />
          </div>
          <div>
            <h3 className="rec-title">No Available Bay Found</h3>
            <span className="rec-sub">Based on current criteria</span>
          </div>
        </div>

        <p className="rec-empty-message">{recommendation.message}</p>

        <div className="rec-empty-hint">
          <span>Tip: Try deselecting the accessibility requirement or checking the other vehicle category.</span>
        </div>
      </div>
    );
  }

  const { best, alternatives } = recommendation;
  const { slot, distance, estimatedTime, estimatedTimeDesc, requiresFloorChange } = best;

  const isCurrentActive = isRouteActive && activeRouteSlotId === slot.slotId;

  return (
    <div className={`recommendation-card ${isCurrentActive ? 'route-active' : ''}`}>
      {/* Top banner tag */}
      <div className="rec-top-banner">
        <div className="rec-star-label">
          <Sparkles size={14} />
          <span>OPTIMAL PARKING RECOMMENDATION</span>
        </div>
        <span className="rec-algorithm-tag">Dijkstra Shortest Path</span>
      </div>

      {/* Main card body */}
      <div className="rec-main-body">
        <div className="rec-hero-row">
          <div className="rec-slot-identity">
            <span className="rec-slot-id">{slot.slotId}</span>
            <span className={`rec-floor-badge floor-${slot.floor}`}>
              Floor {slot.floor}
            </span>
          </div>

          <div className="rec-metrics-cluster">
            <div className="metric-badge metric-distance" title="Total driving distance">
              <Navigation2 size={14} className="metric-icon" />
              <div>
                <span className="metric-val">{distance}m</span>
                <span className="metric-sub">Distance</span>
              </div>
            </div>

            <div className="metric-badge metric-time" title={estimatedTimeDesc}>
              <Clock size={14} className="metric-icon" />
              <div>
                <span className="metric-val">{estimatedTime}</span>
                <span className="metric-sub">Est. Travel</span>
              </div>
            </div>
          </div>
        </div>

        {/* Feature tags */}
        <div className="rec-features-row">
          <span className="rec-feature-tag">
            {slot.vehicleType.includes('bike') && !slot.vehicleType.includes('car') ? (
              <Bike size={13} />
            ) : (
              <Car size={13} />
            )}
            <span>
              {slot.vehicleType.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(' / ')}
            </span>
          </span>

          {slot.accessible ? (
            <span className="rec-feature-tag accessible-tag">
              <Accessibility size={13} />
              <span>Priority Accessible</span>
            </span>
          ) : (
            <span className="rec-feature-tag standard-tag">Standard Bay</span>
          )}

          {requiresFloorChange && (
            <span className="rec-feature-tag ramp-transit-tag">
              <Layers size={13} />
              <span>Take Ramp B1-R1 to B2</span>
            </span>
          )}
        </div>

        {/* Action Button: Visualize Route */}
        <div className="rec-actions">
          <button
            type="button"
            className={`btn-visualize-route ${isCurrentActive ? 'btn-active' : ''}`}
            onClick={() => onToggleRoute(best)}
          >
            {isCurrentActive ? (
              <>
                <EyeOff size={16} />
                <span>Hide Navigation Path</span>
              </>
            ) : (
              <>
                <Compass size={16} />
                <span>Visualize Optimal Route</span>
              </>
            )}
          </button>
        </div>

        {/* Alternative options section */}
        {alternatives && alternatives.length > 0 && (
          <div className="rec-alternatives-wrapper">
            <button
              type="button"
              className="alternatives-toggle-btn"
              onClick={() => setShowAlternatives(!showAlternatives)}
            >
              <span>{alternatives.length} Alternative Slots Available</span>
              {showAlternatives ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showAlternatives && (
              <div className="alternatives-list">
                {alternatives.slice(0, 4).map((alt) => {
                  const isAltActive = isRouteActive && activeRouteSlotId === alt.slot.slotId;
                  return (
                    <div
                      key={alt.slot.slotId}
                      className={`alternative-item ${isAltActive ? 'active-alt' : ''}`}
                      onClick={() => onSelectAlternative(alt)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="alt-left">
                        <span className="alt-slot-id">{alt.slot.slotId}</span>
                        <span className="alt-floor">({alt.slot.floor})</span>
                        {alt.slot.accessible && (
                          <Accessibility size={12} className="alt-acc-icon" />
                        )}
                      </div>
                      <div className="alt-right">
                        <span className="alt-distance">{alt.distance}m</span>
                        <span className="alt-time">{alt.estimatedTime}</span>
                        <ArrowRight size={13} className="alt-arrow" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
