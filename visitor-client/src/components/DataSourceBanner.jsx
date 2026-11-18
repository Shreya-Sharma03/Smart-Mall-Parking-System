/**
 * DataSourceBanner — shows backend status, stale data warnings, errors
 * and manual refresh control.
 */
import React from 'react';
import { AlertTriangle, RefreshCw, Database, Wifi, WifiOff, CheckCircle2 } from 'lucide-react';

export default function DataSourceBanner({
  dataSource,
  error,
  isRefreshing,
  lastUpdated,
  onRefresh,
}) {
  // Nothing to show if backend is live and no errors
  if (dataSource === 'backend' && !error) return null;

  const timeLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  if (error && dataSource === 'mock') {
    return (
      <div className="data-source-banner banner-offline">
        <div className="banner-left">
          <WifiOff size={16} />
          <div>
            <strong>Backend Unavailable</strong>
            <span>{error}</span>
          </div>
        </div>
        <button
          type="button"
          className={`banner-refresh-btn ${isRefreshing ? 'refreshing' : ''}`}
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Retry backend connection"
        >
          <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
          {isRefreshing ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    );
  }

  if (error && dataSource === 'backend') {
    // Refresh failed but we still have live data from previous poll
    return (
      <div className="data-source-banner banner-stale">
        <div className="banner-left">
          <AlertTriangle size={16} />
          <div>
            <strong>Refresh Failed</strong>
            <span>Showing data from {timeLabel || 'previous fetch'}. {error}</span>
          </div>
        </div>
        <button
          type="button"
          className={`banner-refresh-btn ${isRefreshing ? 'refreshing' : ''}`}
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Retry data refresh"
        >
          <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    );
  }

  if (dataSource === 'mock') {
    return (
      <div className="data-source-banner banner-demo">
        <div className="banner-left">
          <Database size={16} />
          <div>
            <strong>Demo Mode</strong>
            <span>Displaying sample data. Connect the backend to enable live updates.</span>
          </div>
        </div>
        <button
          type="button"
          className={`banner-refresh-btn ${isRefreshing ? 'refreshing' : ''}`}
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Check backend connection"
        >
          <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
          {isRefreshing ? 'Checking…' : 'Connect'}
        </button>
      </div>
    );
  }

  return null;
}
