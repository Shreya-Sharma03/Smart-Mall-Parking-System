
import React, { useState } from "react";
import { useAuth } from "./auth";
import {
  ShieldCheck,
  ArrowLeft,
  LockKeyhole,
  Mail,
  ArrowRight,
} from "lucide-react";
import "./Welcome.css";

const Login = ({ onBack }) => {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const resp = await fetch("http://localhost:5000/api/admin/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await resp.json();

      if (resp.ok && data.success) {
        login(data.admin, data.csrfToken);
      } else {
        setError(data.message || "Login failed. Please check your details.");
      }
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="welcome-page">
      <div className="welcome-overlay" />

      <nav className="welcome-nav">
        {/* Clickable ParkIQ logo and title */}
        <div
          className="welcome-brand clickable-brand"
          onClick={onBack}
          role="button"
          tabIndex={0}
          aria-label="Back to Home"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onBack();
            }
          }}
        >
          <div className="welcome-logo">PIQ</div>
          <div>
            <h2>ParkIQ</h2>
            <span>SMART PARKING SYSTEM</span>
          </div>
        </div>

        {/* Keep the top-right navigation button */}
        <button className="login-back" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Home
        </button>
      </nav>

      <section className="login-content">
        <div className="login-card">
          <div className="login-icon">
            <ShieldCheck size={30} />
          </div>

          <span className="role-label">MANAGEMENT PORTAL</span>
          <h1>Welcome back</h1>
          <p className="login-subtitle">
            Sign in to access your parking management dashboard.
          </p>

          {error && <div className="login-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <label htmlFor="admin-email">Email address</label>
            <div className="login-input-wrap">
              <Mail size={18} />
              <input
                id="admin-email"
                type="email"
                placeholder="Enter your admin email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <label htmlFor="admin-password">Password</label>
            <div className="login-input-wrap">
              <LockKeyhole size={18} />
              <input
                id="admin-password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button className="login-submit" type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign in to Dashboard"}
              {!loading && <ArrowRight size={18} />}
            </button>
          </form>

          <div className="login-security">
            <LockKeyhole size={14} />
            Secure administrator authentication
          </div>
        </div>
      </section>
    </main>
  );
};

export default Login;
