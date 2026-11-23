import React from 'react';
import { Compass, Clock, RefreshCw, Wifi, WifiOff } from 'lucide-react';

export default function Header({ isBackendOnline, isRefreshing, lastUpdated, onRefresh }) {
  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const timeLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  // Determine pill state
  const pillOnline = isBackendOnline === true;
  const pillUnknown = isBackendOnline === null;

  return (
    <header className="visitor-header">
      <div className="header-brand-wrap">
        <div className="header-logo-badge">PIQ</div>
        <div className="header-titles">
          <h1 className="header-title">ParkIQ</h1>
          <p className="header-subtitle">Visitor Parking Navigator</p>
        </div>
      </div>

      <div className="header-status-group">
        {/* Backend health indicator */}
        {pillUnknown ? (
          <div className="system-live-pill pill-unknown">
            <span className="live-pulse pulse-unknown" />
            <span>Connecting…</span>
          </div>
        ) : pillOnline ? (
          <div className="system-live-pill">
            <span className="live-pulse" />
            <span>Live Monitoring: Active</span>
          </div>
        ) : (
          <div className="system-live-pill pill-offline">
            <WifiOff size={13} />
            <span>Offline — Demo Mode</span>
          </div>
        )}

        {/* Updated timestamp */}
        {timeLabel && (
          <div className="header-updated-pill">
            <span>Updated: {timeLabel}</span>
          </div>
        )}

        {/* Manual refresh button */}
        {onRefresh && (
          <button
            type="button"
            className={`header-refresh-btn ${isRefreshing ? 'refreshing' : ''}`}
            onClick={onRefresh}
            disabled={isRefreshing}
            title={timeLabel ? `Last updated: ${timeLabel}` : 'Refresh data'}
            aria-label="Refresh parking data"
          >
            <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
            <span>{isRefreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        )}

        {/* Date badge */}
        <div className="header-date-badge">
          <Clock size={14} />
          <span>{currentDate}</span>
        </div>
      </div>
    </header>
  );
}
