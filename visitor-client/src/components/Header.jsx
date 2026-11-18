import React from 'react';
import { Compass, Clock, RefreshCw, Wifi, WifiOff } from 'lucide-react';

export default function Header({ isBackendOnline, isRefreshing, lastUpdated, onRefresh }) {
  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const timeLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : null;

  // Determine pill state
  const pillOnline = isBackendOnline === true;
  const pillUnknown = isBackendOnline === null;

  return (
    <header className="visitor-header">
      <div className="header-brand-wrap">
        <div className="header-logo-badge">
          <Compass size={24} />
        </div>
        <div>
          <h1 className="header-title">Smart Mall Parking Navigator</h1>
          <p className="header-subtitle">Real-Time Multi-Floor Visitor Parking Assistance</p>
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
            <span>Live Slot Monitoring</span>
          </div>
        ) : (
          <div className="system-live-pill pill-offline">
            <WifiOff size={12} />
            <span>Offline — Demo Mode</span>
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
            {isRefreshing ? 'Refreshing' : timeLabel ? `${timeLabel}` : 'Refresh'}
          </button>
        )}

        <div className="header-date-badge">
          <Clock size={15} />
          <span>{currentDate}</span>
        </div>
      </div>
    </header>
  );
}
