import React from 'react';
import { Compass, Clock, ShieldCheck } from 'lucide-react';

export default function Header() {
  const currentTime = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

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
        <div className="system-live-pill">
          <span className="live-pulse"></span>
          <span>Live Slot Monitoring</span>
        </div>
        <div className="header-date-badge">
          <Clock size={15} />
          <span>{currentTime}</span>
        </div>
      </div>
    </header>
  );
}
