
import React from "react";
import { ShieldCheck, CarFront, ArrowRight, ParkingSquare } from "lucide-react";
import "./Welcome.css";

const VISITOR_URL = "http://localhost:5174";

export default function Welcome({ onAdminLogin }) {
  return (
    <main className="welcome-page">
      <div className="welcome-overlay" />

      <nav className="welcome-nav">
        <div className="welcome-brand">
          <div className="welcome-logo">PIQ</div>
          <div>
            <h2>ParkIQ</h2>
            <span>SMART PARKING SYSTEM</span>
          </div>
        </div>
        <div className="welcome-nav-tag">
          <span className="live-dot" />
          Intelligent Parking Experience
        </div>
      </nav>

      <section className="welcome-content">
        <div className="welcome-eyebrow">
          <ParkingSquare size={16} />
          SMART MALL PARKING
        </div>

        <h1>
          Parking made
          <span> effortless.</span>
        </h1>

        <p className="welcome-description">
          A smarter way to manage parking, discover available spaces
          and enjoy a seamless mall visit.
        </p>

        <h3 className="welcome-choice-title">
          Choose how you want to continue
        </h3>

        <div className="role-cards">
          <button
            className="role-card admin-card"
            onClick={onAdminLogin}
          >
            <div className="role-icon">
              <ShieldCheck size={29} />
            </div>
            <div className="role-card-text">
              <span className="role-label">MANAGEMENT PORTAL</span>
              <h2>Login as Admin</h2>
              <p>Manage parking slots, reservations and operations.</p>
            </div>
            <ArrowRight className="role-arrow" size={22} />
          </button>

          <button
            className="role-card visitor-card"
            onClick={() => window.location.assign(VISITOR_URL)}
          >
            <div className="role-icon">
              <CarFront size={29} />
            </div>
            <div className="role-card-text">
              <span className="role-label">CUSTOMER PORTAL</span>
              <h2>Continue as Visitor</h2>
              <p>Find parking, explore available spaces and reserve.</p>
            </div>
            <ArrowRight className="role-arrow" size={22} />
          </button>
        </div>

        <div className="welcome-footer">
          <span>SMARTER SPACES. SMOOTHER JOURNEYS.</span>
          <span>ParkIQ © 2026</span>
        </div>
      </section>
    </main>
  );
}
