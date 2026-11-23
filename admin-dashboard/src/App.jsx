import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Layers,
  ParkingSquare,
  CalendarClock,
  RefreshCw,
  Search,
  CheckCircle2,
  Car,
  Clock,
  Wrench,
  Plus,
  Trash2,
  Pencil,
  AlertCircle,
  Activity,
  Check
} from "lucide-react";

import "./App.css";
import ReservationsView from "./components/ReservationsView";

const API_BASE_URL = "http://localhost:5000/api";
const API_URL = `${API_BASE_URL}/slots`;
const RESERVATIONS_API_URL = `${API_BASE_URL}/reservations`;

const EMPTY_SLOT = {
  slotId: "",
  floor: "B1",
  vehicleType: ["car"],
  accessible: false,
  nodeId: "",
  x: "",
  y: ""
};

// Sort slots by floor and then by numerical slot ID
const sortParkingSlots = (slotList) => {
  return [...slotList].sort((a, b) => {
    const floorOrder = a.floor.localeCompare(b.floor);

    if (floorOrder !== 0) {
      return floorOrder;
    }

    const numberA = parseInt(
      a.slotId?.match(/\d+$/)?.[0] || "0",
      10
    );

    const numberB = parseInt(
      b.slotId?.match(/\d+$/)?.[0] || "0",
      10
    );

    return numberA - numberB;
  });
};

function App() {
  const [stats, setStats] = useState(null);
  const [slots, setSlots] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Four original pages: "Overview", "Floor Overview", "Parking Slots", "Reservations"
  const [activePage, setActivePage] = useState("Overview");

  const [selectedFloor, setSelectedFloor] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("All");
  const [selectedAccessible, setSelectedAccessible] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");

  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [updatingSlotId, setUpdatingSlotId] = useState(null);
  const [deletingSlotId, setDeletingSlotId] = useState(null);
  const [actionMessage, setActionMessage] = useState("");
  const [actionMessageType, setActionMessageType] = useState("");

  // Add-slot form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addingSlot, setAddingSlot] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingSlot, setEditingSlot] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [newSlot, setNewSlot] = useState(EMPTY_SLOT);

  // Fetch dashboard data
  const fetchDashboardData = async (showLoading = false) => {
    if (showLoading) {
      setRefreshing(true);
    }

    try {
      setError("");

      const [statsResponse, slotsResponse] = await Promise.all([
        fetch(`${API_URL}/stats`),
        fetch(API_URL)
      ]);

      if (!statsResponse.ok || !slotsResponse.ok) {
        throw new Error("Unable to connect to the parking server.");
      }

      const statsResult = await statsResponse.json();
      const slotsResult = await slotsResponse.json();

      if (!statsResult.success || !slotsResult.success) {
        throw new Error("Server returned an unsuccessful response.");
      }

      setStats(statsResult.data);
      setSlots(slotsResult.data || []);
      setLastUpdated(new Date());

    } catch (err) {
      setError(err.message || "Unable to connect to the backend.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Update an existing slot's status
  const handleStatusChange = async (slotId, newStatus) => {
    try {
      setUpdatingSlotId(slotId);
      setActionMessage("");
      setActionMessageType("");

      const response = await fetch(
        `${API_URL}/${encodeURIComponent(slotId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ status: newStatus })
        }
      );

      const result = await response.json();

      if (!response.ok || result.success === false) {
        throw new Error(result.message || "Could not update slot status.");
      }

      setActionMessage(`Slot ${slotId} status updated to ${newStatus}.`);
      setActionMessageType("success");

      await fetchDashboardData();

    } catch (err) {
      setActionMessage(err.message || "Status update failed.");
      setActionMessageType("error");
      await fetchDashboardData();
    } finally {
      setUpdatingSlotId(null);
    }
  };

  // Delete a parking slot
  const handleDeleteSlot = async (slotId) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete parking slot ${slotId}?`
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingSlotId(slotId);
      setActionMessage("");
      setActionMessageType("");

      const response = await fetch(
        `${API_URL}/${encodeURIComponent(slotId)}`,
        {
          method: "DELETE"
        }
      );

      const result = await response.json();

      if (!response.ok || result.success === false) {
        throw new Error(result.message || "Could not delete parking slot.");
      }

      setActionMessage(`Slot ${slotId} deleted successfully.`);
      setActionMessageType("success");

      await fetchDashboardData();

    } catch (err) {
      setActionMessage(err.message || "Unable to delete parking slot.");
      setActionMessageType("error");
    } finally {
      setDeletingSlotId(null);
    }
  };

  const handleEditClick = (slot) => {
    setEditingSlot({
      slotId: slot.slotId,
      floor: slot.floor || "B1",
      vehicleType: Array.isArray(slot.vehicleType)
        ? [...slot.vehicleType]
        : [],
      accessible: Boolean(slot.accessible),
      nodeId: slot.nodeId || "",
      x: slot.location?.x ?? "",
      y: slot.location?.y ?? ""
    });

    setShowEditForm(true);
    setShowAddForm(false);
    setActionMessage("");
    setActionMessageType("");
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();

    if (!editingSlot) return;

    if (
      !editingSlot.floor ||
      !editingSlot.nodeId.trim() ||
      editingSlot.vehicleType.length === 0 ||
      editingSlot.x === "" ||
      editingSlot.y === "" ||
      !Number.isFinite(Number(editingSlot.x)) ||
      !Number.isFinite(Number(editingSlot.y))
    ) {
      setActionMessage("Please enter valid details in all required fields.");
      setActionMessageType("error");
      return;
    }

    try {
      setSavingEdit(true);
      setActionMessage("");
      setActionMessageType("");

      const response = await fetch(
        `${API_URL}/${encodeURIComponent(editingSlot.slotId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            floor: editingSlot.floor,
            vehicleType: editingSlot.vehicleType,
            accessible: editingSlot.accessible,
            nodeId: editingSlot.nodeId.trim(),
            location: {
              x: Number(editingSlot.x),
              y: Number(editingSlot.y)
            }
          })
        }
      );

      const result = await response.json();

      if (!response.ok || result.success === false) {
        throw new Error(result.message || "Could not update parking slot.");
      }

      setActionMessage(`Slot ${editingSlot.slotId} updated successfully.`);
      setActionMessageType("success");
      setShowEditForm(false);
      setEditingSlot(null);

      await fetchDashboardData();

    } catch (err) {
      setActionMessage(err.message || "Unable to update parking slot.");
      setActionMessageType("error");
    } finally {
      setSavingEdit(false);
    }
  };

  const updateNewSlot = (field, value) => {
    setNewSlot((prev) => ({
      ...prev,
      [field]: value
    }));
  };

  const handleAddSlot = async (e) => {
    e.preventDefault();

    setActionMessage("");
    setActionMessageType("");

    const slotId = newSlot.slotId.trim().toUpperCase();
    const nodeId = newSlot.nodeId.trim();

    if (!slotId || !nodeId) {
      setActionMessage("Please enter both Slot ID and Graph Node ID.");
      setActionMessageType("error");
      return;
    }

    if (newSlot.vehicleType.length === 0) {
      setActionMessage("Select at least one vehicle type.");
      setActionMessageType("error");
      return;
    }

    if (newSlot.x === "" || newSlot.y === "") {
      setActionMessage("Please enter both X and Y coordinates.");
      setActionMessageType("error");
      return;
    }

    const x = Number(newSlot.x);
    const y = Number(newSlot.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      setActionMessage("Coordinates must be valid numbers.");
      setActionMessageType("error");
      return;
    }

    if (slots.some((slot) => slot.slotId === slotId)) {
      setActionMessage("A slot with this ID already exists.");
      setActionMessageType("error");
      return;
    }

    if (slots.some((slot) => slot.nodeId === nodeId)) {
      setActionMessage("This graph node is already assigned to a slot.");
      setActionMessageType("error");
      return;
    }

    setAddingSlot(true);

    try {
      const slotData = {
        slotId,
        floor: newSlot.floor,
        status: "available",
        vehicleType: newSlot.vehicleType,
        accessible: newSlot.accessible,
        nodeId,
        location: { x, y }
      };

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(slotData)
      });

      const result = await response.json();

      if (!response.ok || result.success === false) {
        throw new Error(result.message || "Could not add parking slot.");
      }

      setActionMessage(`Slot ${slotId} added successfully.`);
      setActionMessageType("success");

      setNewSlot(EMPTY_SLOT);
      setShowAddForm(false);

      await fetchDashboardData();

    } catch (err) {
      setActionMessage(err.message || "Unable to add parking slot.");
      setActionMessageType("error");
    } finally {
      setAddingSlot(false);
    }
  };

  // Initial load and automatic polling every 10 seconds
  useEffect(() => {
    fetchDashboardData();

    const interval = setInterval(() => {
      fetchDashboardData();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const sortedSlots = sortParkingSlots(slots);

  const filteredSlots = sortedSlots.filter((slot) => {
    const matchesFloor =
      selectedFloor === "All" || slot.floor === selectedFloor;

    const matchesStatus =
      selectedStatus === "All" || slot.status === selectedStatus;

    const matchesSearch =
      slot.slotId?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesAccessible =
      selectedAccessible === "All" ||
      String(slot.accessible) === selectedAccessible;

    return (
      matchesFloor &&
      matchesStatus &&
      matchesSearch &&
      matchesAccessible
    );
  });

  const totalSlotsCount = stats?.totalSlots ?? slots.length ?? 0;
  const availCount = stats?.statusCounts?.available ?? 0;
  const occCount = stats?.statusCounts?.occupied ?? 0;
  const rsvdCount = stats?.statusCounts?.reserved ?? 0;
  const maintCount = stats?.statusCounts?.maintenance ?? 0;

  const availPct = totalSlotsCount ? Math.round((availCount / totalSlotsCount) * 100) : 0;
  const occPct = totalSlotsCount ? Math.round((occCount / totalSlotsCount) * 100) : 0;

  const statusCards = [
    {
      title: "Total Parking Slots",
      value: totalSlotsCount,
      icon: ParkingSquare,
      color: "blue",
      subtext: "System capacity"
    },
    {
      title: "Available Slots",
      value: availCount,
      icon: CheckCircle2,
      color: "green",
      subtext: `${availPct}% available`
    },
    {
      title: "Occupied Slots",
      value: occCount,
      icon: Car,
      color: "terracotta",
      subtext: `${occPct}% occupied`
    },
    {
      title: "Active Reservations",
      value: rsvdCount,
      icon: Clock,
      color: "slate",
      subtext: "Secured spots"
    },
    {
      title: "Maintenance",
      value: maintCount,
      icon: Wrench,
      color: "amber",
      subtext: "Offline / calibration"
    }
  ];

  const getStatusClass = (status) => `status-badge ${status}`;

  const formatTime = () => {
    return lastUpdated
      ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "Updating...";
  };

  return (
    <div className="dashboard-app">
      {/* Top Professional Navigation Header */}
      <header className="navbar-header">
        <div className="navbar-container">
          <div className="navbar-brand">
            <div className="brand-logo">PIQ</div>
            <div className="brand-details">
              <span className="brand-name">ParkIQ</span>
              <span className="brand-tagline">Parking Management</span>
            </div>
          </div>

          <div className="status-indicator-badge">
            <span className="status-live-dot"></span>
            <span>CV Service: Active</span>
          </div>

          <div className="last-sync-tag">
            <span>Updated: {formatTime()}</span>
          </div>

          <button
            className="refresh-btn"
            onClick={() => fetchDashboardData(true)}
            disabled={refreshing}
            title="Refresh dashboard data"
          >
            <RefreshCw size={14} className={refreshing ? "spinning" : ""} />
            <span>Refresh</span>
          </button>

          <div className="user-profile-badge">
            <div className="user-avatar">A</div>
            <div className="user-info">
              <span className="user-name">Admin</span>
              <span className="user-role">Manager</span>
            </div>
          </div>
        </div>

        {/* Four Original Main Navigation Tabs */}
        <div className="navbar-tabs-wrapper">
          <nav className="navbar-tabs" aria-label="Main Navigation">
            <button
              className={`tab-item ${activePage === "Overview" ? "active" : ""}`}
              onClick={() => setActivePage("Overview")}
            >
              <LayoutDashboard size={16} />
              <span>Overview</span>
            </button>

            <button
              className={`tab-item ${activePage === "Floor Overview" ? "active" : ""}`}
              onClick={() => setActivePage("Floor Overview")}
            >
              <Layers size={16} />
              <span>Floor Overview</span>
            </button>

            <button
              className={`tab-item ${activePage === "Parking Slots" ? "active" : ""}`}
              onClick={() => setActivePage("Parking Slots")}
            >
              <ParkingSquare size={16} />
              <span>Parking Slots</span>
            </button>

            <button
              className={`tab-item ${activePage === "Reservations" ? "active" : ""}`}
              onClick={() => setActivePage("Reservations")}
            >
              <CalendarClock size={16} />
              <span>Reservations</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Dashboard Content Area */}
      <main className="dashboard-content">
        {/* Error Alert Banner */}
        {error && (
          <div className="alert-banner error" role="alert">
            <AlertCircle size={18} />
            <div className="alert-content">
              <strong>Connection Error:</strong> {error}
            </div>
            <button
              className="alert-retry-btn"
              onClick={() => fetchDashboardData(true)}
              disabled={loading || refreshing}
            >
              Retry
            </button>
          </div>
        )}

        {/* Action Success / Error Notification */}
        {actionMessage && (
          <div className={`alert-banner ${actionMessageType}`} role="status">
            <div className="alert-content">
              {actionMessageType === "success" && <Check size={18} />}
              {actionMessageType === "error" && <AlertCircle size={18} />}
              <span>{actionMessage}</span>
            </div>
            <button
              className="alert-close-btn"
              onClick={() => setActionMessage("")}
              aria-label="Dismiss message"
            >
              ✕
            </button>
          </div>
        )}

        {/* =========================================================
            PAGE 1: OVERVIEW
            ========================================================= */}
        {activePage === "Overview" && (
          <div className="view-wrapper">
            <div className="page-header">
              <div>
                <h2>Parking Overview</h2>
                <p>Live status and overall occupancy across the parking facility.</p>
              </div>
            </div>

            {/* 5 KPI Stat Cards */}
            <div className="kpi-grid">
              {statusCards.map((card) => {
                const Icon = card.icon;
                return (
                  <div className={`kpi-card ${card.color}`} key={card.title}>
                    <div className="kpi-card-top">
                      <span className="kpi-title">{card.title}</span>
                      <div className={`kpi-icon ${card.color}`}>
                        <Icon size={18} />
                      </div>
                    </div>
                    <div className="kpi-number tabular-nums">
                      {loading ? "..." : card.value}
                    </div>
                    <div className="kpi-subtext">{card.subtext}</div>
                  </div>
                );
              })}
            </div>

            {/* Floor Overview Section Preview */}
            <div className="section-title-bar">
              <div>
                <h3>Floor Availability</h3>
                <p>Real-time slot availability for each basement level</p>
              </div>
              <button
                className="section-link-btn"
                onClick={() => setActivePage("Floor Overview")}
              >
                View Detailed Floor Status ➜
              </button>
            </div>

            <div className="floor-cards-grid">
              {["B1", "B2"].map((floor) => {
                const floorData = stats?.floorStats?.[floor] || {
                  total: 0,
                  available: 0,
                  occupied: 0,
                  reserved: 0,
                  maintenance: 0
                };

                const percentage = floorData.total
                  ? Math.round((floorData.available / floorData.total) * 100)
                  : 0;

                return (
                  <div className="floor-card" key={floor}>
                    <div className="floor-card-header">
                      <div className="floor-meta">
                        <span className="floor-pill">{floor}</span>
                        <div>
                          <h4>
                            {floor === "B1" ? "Basement Level 1" : "Basement Level 2"}
                          </h4>
                          <span className="floor-sub">
                            {floorData.total} total spaces
                          </span>
                        </div>
                      </div>
                      <div className="floor-stat-highlight">
                        <span className="avail-percent tabular-nums">{percentage}%</span>
                        <span className="avail-label">Available</span>
                      </div>
                    </div>

                    <div className="progress-container">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>

                    <div className="floor-breakdown-row">
                      <div className="breakdown-item">
                        <span className="indicator-dot green"></span>
                        <span className="breakdown-label">Available</span>
                        <strong className="breakdown-val tabular-nums">
                          {floorData.available}
                        </strong>
                      </div>
                      <div className="breakdown-item">
                        <span className="indicator-dot terracotta"></span>
                        <span className="breakdown-label">Occupied</span>
                        <strong className="breakdown-val tabular-nums">
                          {floorData.occupied}
                        </strong>
                      </div>
                      <div className="breakdown-item">
                        <span className="indicator-dot slate"></span>
                        <span className="breakdown-label">Reserved</span>
                        <strong className="breakdown-val tabular-nums">
                          {floorData.reserved}
                        </strong>
                      </div>
                      <div className="breakdown-item">
                        <span className="indicator-dot amber"></span>
                        <span className="breakdown-label">Maintenance</span>
                        <strong className="breakdown-val tabular-nums">
                          {floorData.maintenance}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Recent Parking Slots */}
            <div className="section-title-bar space-above">
              <div>
                <h3>Recent Parking Slots</h3>
                <p>Latest slots registered in the system database</p>
              </div>
              <button
                className="section-link-btn"
                onClick={() => setActivePage("Parking Slots")}
              >
                View All Slots ➜
              </button>
            </div>

            <div className="table-card">
              <table className="standard-table">
                <thead>
                  <tr>
                    <th>Slot ID</th>
                    <th>Floor</th>
                    <th>Vehicle Type</th>
                    <th>Accessibility</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="5" className="empty-message">
                        Loading parking slots...
                      </td>
                    </tr>
                  ) : sortedSlots.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="empty-message">
                        No parking slots found.
                      </td>
                    </tr>
                  ) : (
                    sortedSlots.slice(0, 6).map((slot) => (
                      <tr key={slot.slotId}>
                        <td className="slot-id-cell">{slot.slotId}</td>
                        <td>Level {slot.floor}</td>
                        <td>{slot.vehicleType?.join(", ").toUpperCase()}</td>
                        <td>
                          {slot.accessible ? (
                            <span className="badge-accessible">♿ Accessible</span>
                          ) : (
                            <span className="badge-standard">Standard</span>
                          )}
                        </td>
                        <td>
                          <span className={getStatusClass(slot.status)}>
                            {slot.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* =========================================================
            PAGE 2: FLOOR OVERVIEW
            ========================================================= */}
        {activePage === "Floor Overview" && (
          <div className="view-wrapper">
            <div className="page-header">
              <div>
                <h2>Floor Overview</h2>
                <p>Detailed floor-by-floor occupancy, capacity, and slot allocation.</p>
              </div>
            </div>

            <div className="floor-cards-grid large">
              {["B1", "B2"].map((floor) => {
                const floorData = stats?.floorStats?.[floor] || {
                  total: 0,
                  available: 0,
                  occupied: 0,
                  reserved: 0,
                  maintenance: 0
                };

                const percentage = floorData.total
                  ? Math.round((floorData.available / floorData.total) * 100)
                  : 0;

                const floorSlotsList = sortedSlots.filter((s) => s.floor === floor);

                return (
                  <div className="floor-card detailed" key={floor}>
                    <div className="floor-card-header">
                      <div className="floor-meta">
                        <span className="floor-pill">{floor}</span>
                        <div>
                          <h4>
                            {floor === "B1" ? "Basement Level 1" : "Basement Level 2"}
                          </h4>
                          <span className="floor-sub">
                            {floorData.total} Total Registered Slots
                          </span>
                        </div>
                      </div>

                      <div className="floor-stat-highlight">
                        <span className="avail-percent tabular-nums">{percentage}%</span>
                        <span className="avail-label">Available Spaces</span>
                      </div>
                    </div>

                    <div className="progress-container">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>

                    <div className="floor-breakdown-row">
                      <div className="breakdown-item">
                        <span className="indicator-dot green"></span>
                        <span className="breakdown-label">Available</span>
                        <strong className="breakdown-val tabular-nums">
                          {floorData.available}
                        </strong>
                      </div>
                      <div className="breakdown-item">
                        <span className="indicator-dot terracotta"></span>
                        <span className="breakdown-label">Occupied</span>
                        <strong className="breakdown-val tabular-nums">
                          {floorData.occupied}
                        </strong>
                      </div>
                      <div className="breakdown-item">
                        <span className="indicator-dot slate"></span>
                        <span className="breakdown-label">Reserved</span>
                        <strong className="breakdown-val tabular-nums">
                          {floorData.reserved}
                        </strong>
                      </div>
                      <div className="breakdown-item">
                        <span className="indicator-dot amber"></span>
                        <span className="breakdown-label">Maintenance</span>
                        <strong className="breakdown-val tabular-nums">
                          {floorData.maintenance}
                        </strong>
                      </div>
                    </div>

                    {/* Floor Slots Grid Preview */}
                    <div className="floor-slots-preview">
                      <span className="preview-heading">
                        Registered Slots on Level {floor} ({floorSlotsList.length})
                      </span>
                      <div className="slots-chips-grid">
                        {floorSlotsList.map((slot) => (
                          <div
                            key={slot.slotId}
                            className={`slot-chip ${slot.status}`}
                            title={`${slot.slotId} - ${slot.status}`}
                          >
                            <span className="chip-slot-id">{slot.slotId}</span>
                            <span className="chip-slot-status">{slot.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* =========================================================
            PAGE 3: PARKING SLOTS
            ========================================================= */}
        {activePage === "Parking Slots" && (
          <div className="view-wrapper">
            <div className="page-header with-action">
              <div>
                <h2>Parking Slots Management</h2>
                <p>Register, update, filter, and manage all parking spaces.</p>
              </div>

              <button
                className="primary-btn"
                onClick={() => {
                  setShowAddForm((prev) => !prev);
                  setActionMessage("");
                }}
              >
                <Plus size={16} />
                <span>{showAddForm ? "Cancel" : "Add New Slot"}</span>
              </button>
            </div>

            {/* Add Slot Form */}
            {showAddForm && (
              <form className="form-card" onSubmit={handleAddSlot}>
                <div className="form-card-title">
                  <Plus size={18} />
                  <h3>Register New Parking Slot</h3>
                </div>

                <div className="form-fields-grid">
                  <div className="field-group">
                    <label htmlFor="slotId">Slot ID</label>
                    <input
                      id="slotId"
                      type="text"
                      placeholder="e.g. B1-A13"
                      value={newSlot.slotId}
                      onChange={(e) => updateNewSlot("slotId", e.target.value)}
                      required
                    />
                  </div>

                  <div className="field-group">
                    <label htmlFor="floor">Floor Level</label>
                    <select
                      id="floor"
                      value={newSlot.floor}
                      onChange={(e) => updateNewSlot("floor", e.target.value)}
                    >
                      <option value="B1">Basement Level 1 (B1)</option>
                      <option value="B2">Basement Level 2 (B2)</option>
                    </select>
                  </div>

                  <div className="field-group">
                    <label htmlFor="nodeId">Graph Node ID</label>
                    <input
                      id="nodeId"
                      type="text"
                      placeholder="e.g. B1-A13"
                      value={newSlot.nodeId}
                      onChange={(e) => updateNewSlot("nodeId", e.target.value)}
                      required
                    />
                  </div>

                  <div className="field-group">
                    <label htmlFor="xCoordinate">X Coordinate</label>
                    <input
                      id="xCoordinate"
                      type="number"
                      placeholder="e.g. 24"
                      value={newSlot.x}
                      onChange={(e) => updateNewSlot("x", e.target.value)}
                      required
                    />
                  </div>

                  <div className="field-group">
                    <label htmlFor="yCoordinate">Y Coordinate</label>
                    <input
                      id="yCoordinate"
                      type="number"
                      placeholder="e.g. -5"
                      value={newSlot.y}
                      onChange={(e) => updateNewSlot("y", e.target.value)}
                      required
                    />
                  </div>

                  <div className="field-group">
                    <label>Vehicle Compatibility</label>
                    <div className="checkboxes-row">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={newSlot.vehicleType.includes("car")}
                          onChange={(e) => {
                            const types = e.target.checked
                              ? [...newSlot.vehicleType, "car"]
                              : newSlot.vehicleType.filter((t) => t !== "car");
                            updateNewSlot("vehicleType", types);
                          }}
                        />
                        <span>Car</span>
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={newSlot.vehicleType.includes("bike")}
                          onChange={(e) => {
                            const types = e.target.checked
                              ? [...newSlot.vehicleType, "bike"]
                              : newSlot.vehicleType.filter((t) => t !== "bike");
                            updateNewSlot("vehicleType", types);
                          }}
                        />
                        <span>Bike</span>
                      </label>
                    </div>
                  </div>

                  <div className="field-group span-full">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={newSlot.accessible}
                        onChange={(e) => updateNewSlot("accessible", e.target.checked)}
                      />
                      <span>Accessible Parking Slot (PRM / Disability)</span>
                    </label>
                  </div>
                </div>

                <div className="form-card-footer">
                  <p className="form-hint">
                    New slots are initialized as Available.
                  </p>
                  <button
                    type="submit"
                    className="primary-btn"
                    disabled={addingSlot}
                  >
                    {addingSlot ? "Saving..." : "Save Parking Slot"}
                  </button>
                </div>
              </form>
            )}

            {/* Edit Slot Form */}
            {showEditForm && editingSlot && (
              <form className="form-card edit" onSubmit={handleEditSubmit}>
                <div className="form-card-title">
                  <Pencil size={18} />
                  <h3>Edit Parking Slot: {editingSlot.slotId}</h3>
                </div>

                <div className="form-fields-grid">
                  <div className="field-group">
                    <label htmlFor="editFloor">Floor Level</label>
                    <select
                      id="editFloor"
                      value={editingSlot.floor}
                      onChange={(e) =>
                        setEditingSlot({ ...editingSlot, floor: e.target.value })
                      }
                    >
                      <option value="B1">Basement Level 1 (B1)</option>
                      <option value="B2">Basement Level 2 (B2)</option>
                    </select>
                  </div>

                  <div className="field-group">
                    <label htmlFor="editNodeId">Graph Node ID</label>
                    <input
                      id="editNodeId"
                      type="text"
                      value={editingSlot.nodeId}
                      onChange={(e) =>
                        setEditingSlot({ ...editingSlot, nodeId: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="field-group">
                    <label htmlFor="editXCoordinate">X Coordinate</label>
                    <input
                      id="editXCoordinate"
                      type="number"
                      value={editingSlot.x}
                      onChange={(e) =>
                        setEditingSlot({ ...editingSlot, x: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="field-group">
                    <label htmlFor="editYCoordinate">Y Coordinate</label>
                    <input
                      id="editYCoordinate"
                      type="number"
                      value={editingSlot.y}
                      onChange={(e) =>
                        setEditingSlot({ ...editingSlot, y: e.target.value })
                      }
                      required
                    />
                  </div>

                  <div className="field-group">
                    <label>Vehicle Compatibility</label>
                    <div className="checkboxes-row">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={editingSlot.vehicleType.includes("car")}
                          onChange={(e) => {
                            const types = e.target.checked
                              ? [...editingSlot.vehicleType, "car"]
                              : editingSlot.vehicleType.filter((t) => t !== "car");
                            setEditingSlot({ ...editingSlot, vehicleType: types });
                          }}
                        />
                        <span>Car</span>
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={editingSlot.vehicleType.includes("bike")}
                          onChange={(e) => {
                            const types = e.target.checked
                              ? [...editingSlot.vehicleType, "bike"]
                              : editingSlot.vehicleType.filter((t) => t !== "bike");
                            setEditingSlot({ ...editingSlot, vehicleType: types });
                          }}
                        />
                        <span>Bike</span>
                      </label>
                    </div>
                  </div>

                  <div className="field-group span-full">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={editingSlot.accessible}
                        onChange={(e) =>
                          setEditingSlot({ ...editingSlot, accessible: e.target.checked })
                        }
                      />
                      <span>Accessible Parking Slot (PRM / Disability)</span>
                    </label>
                  </div>
                </div>

                <div className="form-card-footer">
                  <div className="btn-group">
                    <button
                      type="submit"
                      className="primary-btn"
                      disabled={savingEdit}
                    >
                      {savingEdit ? "Saving..." : "Update Slot"}
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => {
                        setShowEditForm(false);
                        setEditingSlot(null);
                      }}
                      disabled={savingEdit}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Filter Toolbar */}
            <div className="filter-toolbar">
              <div className="search-input-box">
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Search by Slot ID (e.g. B1-A01)..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <select
                value={selectedFloor}
                onChange={(e) => setSelectedFloor(e.target.value)}
                aria-label="Filter by floor"
              >
                <option value="All">All Floors</option>
                <option value="B1">Floor B1</option>
                <option value="B2">Floor B2</option>
              </select>

              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                aria-label="Filter by status"
              >
                <option value="All">All Statuses</option>
                <option value="available">Available</option>
                <option value="occupied">Occupied</option>
                <option value="reserved">Reserved</option>
                <option value="maintenance">Maintenance</option>
              </select>

              <select
                value={selectedAccessible}
                onChange={(e) => setSelectedAccessible(e.target.value)}
                aria-label="Filter by accessibility"
              >
                <option value="All">All Accessibility</option>
                <option value="true">Accessible Only</option>
                <option value="false">Standard Only</option>
              </select>
            </div>

            {/* Slots Table */}
            <div className="table-card">
              <table className="standard-table">
                <thead>
                  <tr>
                    <th>Slot ID</th>
                    <th>Floor</th>
                    <th>Vehicle Type</th>
                    <th>Accessibility</th>
                    <th>Status Management</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="6" className="empty-message">
                        Loading parking slots...
                      </td>
                    </tr>
                  ) : filteredSlots.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="empty-message">
                        No matching parking slots found.
                      </td>
                    </tr>
                  ) : (
                    filteredSlots.map((slot) => (
                      <tr key={slot.slotId}>
                        <td className="slot-id-cell">{slot.slotId}</td>
                        <td>Level {slot.floor}</td>
                        <td>{slot.vehicleType?.join(", ").toUpperCase()}</td>
                        <td>
                          {slot.accessible ? (
                            <span className="badge-accessible">♿ Accessible</span>
                          ) : (
                            <span className="badge-standard">Standard</span>
                          )}
                        </td>
                        <td>
                          <div className="status-inline-control">
                            <span className={getStatusClass(slot.status)}>
                              {slot.status}
                            </span>
                            <select
                              className="status-dropdown-select"
                              value={slot.status}
                              disabled={updatingSlotId === slot.slotId}
                              onChange={(e) =>
                                handleStatusChange(slot.slotId, e.target.value)
                              }
                            >
                              <option value="available">Available</option>
                              <option value="occupied">Occupied</option>
                              <option value="reserved">Reserved</option>
                              <option value="maintenance">Maintenance</option>
                            </select>
                            {updatingSlotId === slot.slotId && (
                              <span className="saving-text">Saving...</span>
                            )}
                          </div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <div className="actions-cell">
                            <button
                              className="action-btn edit"
                              onClick={() => handleEditClick(slot)}
                              disabled={
                                deletingSlotId === slot.slotId ||
                                updatingSlotId === slot.slotId
                              }
                              title="Edit slot details"
                            >
                              <Pencil size={14} />
                              <span>Edit</span>
                            </button>
                            <button
                              className="action-btn delete"
                              onClick={() => handleDeleteSlot(slot.slotId)}
                              disabled={
                                deletingSlotId === slot.slotId ||
                                updatingSlotId === slot.slotId
                              }
                              title="Delete slot"
                            >
                              <Trash2 size={14} />
                              <span>
                                {deletingSlotId === slot.slotId
                                  ? "..."
                                  : "Delete"}
                              </span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <p className="table-footer-count">
              Showing {filteredSlots.length} of {slots.length} parking slots
            </p>
          </div>
        )}

        {/* =========================================================
            PAGE 4: RESERVATIONS
            ========================================================= */}
        {activePage === "Reservations" && (
          <div className="view-wrapper">
            <ReservationsView
              apiUrl={RESERVATIONS_API_URL}
              onRefreshSlots={fetchDashboardData}
            />
          </div>
        )}
      </main>

      {/* Clean Professional Footer */}
      <footer className="simple-footer">
        <div className="footer-container">
          <div className="footer-left">
            <Activity size={15} />
            <span>ParkIQ • Smart Mall Parking Management System</span>
          </div>
          <div className="footer-right">
            <span>Admin Operations Panel</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
