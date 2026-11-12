
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ParkingSquare,
  Car,
  CheckCircle,
  Wrench,
  Clock,
  RefreshCw,
  Search,
  MapPin,
  Activity,
  AlertCircle,
  Menu,
  X,
  Plus,
  Trash2,
  Pencil
} from "lucide-react";

import "./App.css";

const API_URL = "http://localhost:5000/api/slots";

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

  const [activePage, setActivePage] = useState("Overview");

  const [selectedFloor, setSelectedFloor] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("All");
  const [selectedAccessible, setSelectedAccessible] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
        throw new Error("Could not fetch parking data.");
      }

      const statsResult = await statsResponse.json();
      const slotsResult = await slotsResponse.json();

      if (!statsResult.success || !slotsResult.success) {
        throw new Error("Backend returned an unsuccessful response.");
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

      setActionMessage(`${slotId} updated to ${newStatus}.`);
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

      setActionMessage(`${slotId} deleted successfully.`);
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

    setActionMessage(`${editingSlot.slotId} updated successfully.`);
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
  // Update a field in the new-slot form
  const updateNewSlot = (field, value) => {
    setNewSlot((previous) => ({
      ...previous,
      [field]: value
    }));
  };

  // Add a new parking slot
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

      setActionMessage(`${slotId} added successfully.`);
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

  // Initial load and automatic refresh
  useEffect(() => {
    fetchDashboardData();

    const interval = setInterval(() => {
      fetchDashboardData();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // Sort all slots once for consistent display
  const sortedSlots = sortParkingSlots(slots);

  // Filter parking slots
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

  // Dashboard cards
  const statusCards = [
    {
      title: "Total Slots",
      value: stats?.totalSlots ?? 0,
      icon: ParkingSquare,
      color: "blue"
    },
    {
      title: "Available",
      value: stats?.statusCounts?.available ?? 0,
      icon: CheckCircle,
      color: "green"
    },
    {
      title: "Occupied",
      value: stats?.statusCounts?.occupied ?? 0,
      icon: Car,
      color: "orange"
    },
    {
      title: "Maintenance",
      value: stats?.statusCounts?.maintenance ?? 0,
      icon: Wrench,
      color: "red"
    }
  ];

  const getStatusClass = (status) => `status-badge ${status}`;

  const formatTime = () => {
    return lastUpdated
      ? lastUpdated.toLocaleTimeString()
      : "Not updated yet";
  };

  return (
    <div className="dashboard-container">

      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-icon">
            <ParkingSquare size={25} />
          </div>

          <div>
            <h2>SmartPark</h2>
            <p>Parking Management</p>
          </div>

          <button
            className="mobile-close"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="sidebar-section">
          <p className="sidebar-label">MAIN MENU</p>

          <button
            className={`nav-item ${activePage === "Overview" ? "active" : ""}`}
            onClick={() => {
              setActivePage("Overview");
              setSidebarOpen(false);
            }}
          >
            <LayoutDashboard size={19} />
            <span>Overview</span>
          </button>

          <button
            className={`nav-item ${activePage === "Parking Slots" ? "active" : ""}`}
            onClick={() => {
              setActivePage("Parking Slots");
              setSidebarOpen(false);
            }}
          >
            <ParkingSquare size={19} />
            <span>Parking Slots</span>
          </button>
        </div>

        <div className="sidebar-bottom">
          <div className="admin-profile">
            <div className="profile-avatar">A</div>

            <div>
              <h4>Administrator</h4>
              <p>Parking Manager</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">

        <header className="topbar">
          <div className="topbar-left">

            <button
              className="mobile-menu"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={22} />
            </button>

            <div>
              <p className="breadcrumb">SmartPark / Admin</p>
              <h1>{activePage}</h1>
            </div>
          </div>

          <div className="topbar-right">
            <div className="system-status">
              <span className="live-dot"></span>
              System monitoring
            </div>

            <button
              className="refresh-button"
              onClick={() => fetchDashboardData(true)}
              disabled={refreshing}
            >
              <RefreshCw
                size={16}
                className={refreshing ? "spinning" : ""}
              />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        <section className="page-content">

          <div className="welcome-section">
            <div>
              <h2>Parking Overview</h2>
              <p>
                Monitor parking availability and manage your mall parking system.
              </p>
            </div>

            <div className="updated-time">
              <Clock size={15} />
              Updated: {formatTime()}
            </div>
          </div>

          {error && (
            <div className="error-message">
              <p>{error}</p>

              <button
                onClick={fetchDashboardData}
                disabled={loading || refreshing}
              >
                Try Again
              </button>
            </div>
          )}

          {/* Overview */}
          {activePage === "Overview" && (
            <>
              <div className="stats-grid">
                {statusCards.map((card) => {
                  const Icon = card.icon;

                  return (
                    <div className="stat-card" key={card.title}>
                      <div className={`stat-icon ${card.color}`}>
                        <Icon size={23} />
                      </div>

                      <div>
                        <p>{card.title}</p>
                        <h2>{loading ? "..." : card.value}</h2>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="section-heading">
                <div>
                  <h2>Floor Overview</h2>
                  <p>Parking availability on each floor</p>
                </div>
              </div>

              <div className="floor-grid">
                {["B1", "B2"].map((floor) => {
                  const floorData = stats?.floorStats?.[floor] || {
                    total: 0,
                    available: 0,
                    occupied: 0,
                    reserved: 0,
                    maintenance: 0
                  };

                  const percentage = floorData.total
                    ? Math.round(
                        (floorData.available / floorData.total) * 100
                      )
                    : 0;

                  return (
                    <div className="floor-card" key={floor}>
                      <div className="floor-header">
                        <div className="floor-title">
                          <div className="floor-icon">
                            <MapPin size={20} />
                          </div>

                          <div>
                            <h3>{floor}</h3>
                            <p>
                              {floor === "B1"
                                ? "Basement Level 1"
                                : "Basement Level 2"}
                            </p>
                          </div>
                        </div>

                        <span className="floor-total">
                          {floorData.total} slots
                        </span>
                      </div>

                      <div className="availability-info">
                        <span>Available spaces</span>
                        <strong>{percentage}%</strong>
                      </div>

                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>

                      <div className="floor-statistics">
                        <div>
                          <span className="legend-dot available-dot"></span>
                          Available
                          <strong>{floorData.available}</strong>
                        </div>

                        <div>
                          <span className="legend-dot occupied-dot"></span>
                          Occupied
                          <strong>{floorData.occupied}</strong>
                        </div>

                        <div>
                          <span className="legend-dot reserved-dot"></span>
                          Reserved
                          <strong>{floorData.reserved}</strong>
                        </div>

                        <div>
                          <span className="legend-dot maintenance-dot"></span>
                          Maintenance
                          <strong>{floorData.maintenance}</strong>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="section-heading">
                <div>
                  <h2>Recent Parking Slots</h2>
                  <p>Latest slots from the parking database</p>
                </div>

                <button
                  className="view-all-button"
                  onClick={() => setActivePage("Parking Slots")}
                >
                  View all
                </button>
              </div>

              <div className="table-container">
                <table>
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
                        <td colSpan="5" className="empty-state">
                          Loading parking slots...
                        </td>
                      </tr>
                    ) : sortedSlots.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="empty-state">
                          No parking slots found.
                        </td>
                      </tr>
                    ) : (
                      sortedSlots.slice(0, 6).map((slot) => (
                        <tr key={slot.slotId}>
                          <td className="slot-id">{slot.slotId}</td>
                          <td>{slot.floor}</td>
                          <td>{slot.vehicleType?.join(", ")}</td>
                          <td>{slot.accessible ? "Yes" : "No"}</td>
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
            </>
          )}

          {/* Parking Slots */}
          {activePage === "Parking Slots" && (
            <>
              <div className="section-heading">
                <div>
                  <h2>All Parking Slots</h2>
                  <p>View and manage all registered parking spaces</p>
                </div>

                <button
                  className="add-slot-button"
                  onClick={() => {
                    setShowAddForm((previous) => !previous);
                    setActionMessage("");
                  }}
                >
                  <Plus size={16} />
                  {showAddForm ? "Cancel" : "Add New Slot"}
                </button>
              </div>

              {/* Add slot form */}
              {showAddForm && (
                <form className="add-slot-form" onSubmit={handleAddSlot}>
                  <h3>Register New Parking Slot</h3>

                  <div className="form-grid">

                    <div className="form-group">
                      <label htmlFor="slotId">Slot ID</label>
                      <input
                        id="slotId"
                        type="text"
                        placeholder="Example: B1-A13"
                        value={newSlot.slotId}
                        onChange={(e) =>
                          updateNewSlot("slotId", e.target.value)
                        }
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="floor">Floor</label>
                      <select
                        id="floor"
                        value={newSlot.floor}
                        onChange={(e) =>
                          updateNewSlot("floor", e.target.value)
                        }
                      >
                        <option value="B1">B1</option>
                        <option value="B2">B2</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label htmlFor="nodeId">Graph Node ID</label>
                      <input
                        id="nodeId"
                        type="text"
                        placeholder="Example: B1-A13"
                        value={newSlot.nodeId}
                        onChange={(e) =>
                          updateNewSlot("nodeId", e.target.value)
                        }
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="xCoordinate">X Coordinate</label>
                      <input
                        id="xCoordinate"
                        type="number"
                        placeholder="Enter X coordinate"
                        value={newSlot.x}
                        onChange={(e) =>
                          updateNewSlot("x", e.target.value)
                        }
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="yCoordinate">Y Coordinate</label>
                      <input
                        id="yCoordinate"
                        type="number"
                        placeholder="Enter Y coordinate"
                        value={newSlot.y}
                        onChange={(e) =>
                          updateNewSlot("y", e.target.value)
                        }
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label>Vehicle Type</label>

                      <div className="vehicle-options">
                        <label>
                          <input
                            type="checkbox"
                            checked={newSlot.vehicleType.includes("car")}
                            onChange={(e) => {
                              const types = e.target.checked
                                ? [...newSlot.vehicleType, "car"]
                                : newSlot.vehicleType.filter(
                                    (type) => type !== "car"
                                  );

                              updateNewSlot("vehicleType", types);
                            }}
                          />
                          Car
                        </label>

                        <label>
                          <input
                            type="checkbox"
                            checked={newSlot.vehicleType.includes("bike")}
                            onChange={(e) => {
                              const types = e.target.checked
                                ? [...newSlot.vehicleType, "bike"]
                                : newSlot.vehicleType.filter(
                                    (type) => type !== "bike"
                                  );

                              updateNewSlot("vehicleType", types);
                            }}
                          />
                          Bike
                        </label>
                      </div>
                    </div>

                    <div className="form-group checkbox-group">
                      <label>
                        <input
                          type="checkbox"
                          checked={newSlot.accessible}
                          onChange={(e) =>
                            updateNewSlot("accessible", e.target.checked)
                          }
                        />
                        Accessible parking slot
                      </label>
                    </div>

                  </div>

                  <p className="form-note">
                    New slots are initially registered as Available.
                    Ensure the corresponding node is connected in the
                    parking graph before using route recommendations.
                  </p>

                  <button
                    type="submit"
                    className="submit-slot-button"
                    disabled={addingSlot}
                  >
                    {addingSlot ? "Adding..." : "Save Parking Slot"}
                  </button>
                </form>
              )}
              
              {/* Edit slot form */}
              {showEditForm && editingSlot && (
                <form className="add-slot-form" onSubmit={handleEditSubmit}>
                  <h3>Edit Parking Slot: {editingSlot.slotId}</h3>

                  <div className="form-grid">

                    <div className="form-group">
                      <label htmlFor="editFloor">Floor</label>
                      <select
                        id="editFloor"
                        value={editingSlot.floor}
                        onChange={(e) =>
                          setEditingSlot({
                            ...editingSlot,
                            floor: e.target.value
                          })
                        }
                      >
                        <option value="B1">B1</option>
                        <option value="B2">B2</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label htmlFor="editNodeId">Graph Node ID</label>
                      <input
                        id="editNodeId"
                        type="text"
                        value={editingSlot.nodeId}
                        onChange={(e) =>
                          setEditingSlot({
                            ...editingSlot,
                            nodeId: e.target.value
                          })
                        }
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="editXCoordinate">X Coordinate</label>
                      <input
                        id="editXCoordinate"
                        type="number"
                        value={editingSlot.x}
                        onChange={(e) =>
                          setEditingSlot({
                            ...editingSlot,
                            x: e.target.value
                          })
                        }
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="editYCoordinate">Y Coordinate</label>
                      <input
                        id="editYCoordinate"
                        type="number"
                        value={editingSlot.y}
                        onChange={(e) =>
                          setEditingSlot({
                            ...editingSlot,
                            y: e.target.value
                          })
                        }
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label>Vehicle Type</label>

                      <div className="vehicle-options">
                        <label>
                          <input
                            type="checkbox"
                            checked={editingSlot.vehicleType.includes("car")}
                            onChange={(e) => {
                              const types = e.target.checked
                                ? [...editingSlot.vehicleType, "car"]
                                : editingSlot.vehicleType.filter(
                                    (type) => type !== "car"
                                  );

                              setEditingSlot({
                                ...editingSlot,
                                vehicleType: types
                              });
                            }}
                          />
                          Car
                        </label>

                        <label>
                          <input
                            type="checkbox"
                            checked={editingSlot.vehicleType.includes("bike")}
                            onChange={(e) => {
                              const types = e.target.checked
                                ? [...editingSlot.vehicleType, "bike"]
                                : editingSlot.vehicleType.filter(
                                    (type) => type !== "bike"
                                  );

                              setEditingSlot({
                                ...editingSlot,
                                vehicleType: types
                              });
                            }}
                          />
                          Bike
                        </label>
                      </div>
                    </div>

                    <div className="form-group checkbox-group">
                      <label>
                        <input
                          type="checkbox"
                          checked={editingSlot.accessible}
                          onChange={(e) =>
                            setEditingSlot({
                              ...editingSlot,
                              accessible: e.target.checked
                            })
                          }
                        />
                        Accessible parking slot
                      </label>
                    </div>

                  </div>

                  <p className="form-note">
                    Slot ID and current status will remain unchanged.
                    Make sure the graph node exists before saving.
                  </p>

                  <div className="edit-form-actions">
                    <button
                      type="submit"
                      className="submit-slot-button"
                      disabled={savingEdit}
                    >
                      {savingEdit ? "Saving..." : "Save Changes"}
                    </button>

                    <button
                      type="button"
                      className="cancel-edit-button"
                      onClick={() => {
                        setShowEditForm(false);
                        setEditingSlot(null);
                      }}
                      disabled={savingEdit}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {actionMessage && (
                <div
                  className={`action-message ${actionMessageType}`}
                  role="status"
                >
                  {actionMessage}
                </div>
              )}

              {/* Filters */}
              <div className="filter-panel">
                <div className="search-box">
                  <Search size={18} />

                  <input
                    type="text"
                    placeholder="Search slot ID..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>

                <select
                  value={selectedFloor}
                  onChange={(e) => setSelectedFloor(e.target.value)}
                >
                  <option value="All">All Floors</option>
                  <option value="B1">B1</option>
                  <option value="B2">B2</option>
                </select>

                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                >
                  <option value="All">All Statuses</option>
                  <option value="available">Available</option>
                  <option value="occupied">Occupied</option>
                  <option value="reserved">Reserved</option>
                  <option value="maintenance">Maintenance</option>
                </select>
                {/* Accessible filter */}
                <select
                  value={selectedAccessible}
                  onChange={(e) => setSelectedAccessible(e.target.value)}
                >
                  <option value="All">All Accessibility</option>
                  <option value="true">Accessible</option>
                  <option value="false">Non-Accessible</option>
                </select>
              </div>

              {/* Slots table */}
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Slot ID</th>
                      <th>Floor</th>
                      <th>Vehicle Type</th>
                      <th>Accessible</th>
                      <th>Status Management</th>
                    </tr>
                  </thead>

                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan="5" className="empty-state">
                          Loading parking slots...
                        </td>
                      </tr>
                    ) : filteredSlots.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="empty-state">
                          No matching parking slots found.
                        </td>
                      </tr>
                    ) : (
                      filteredSlots.map((slot) => (
                        <tr key={slot.slotId}>
                          <td className="slot-id">{slot.slotId}</td>
                          <td>{slot.floor}</td>
                          <td>{slot.vehicleType?.join(", ")}</td>
                          <td>{slot.accessible ? "Yes" : "No"}</td>

                          <td>
                            <div className="status-management">
                              <span className={getStatusClass(slot.status)}>
                                {slot.status}
                              </span>

                              <select
                                className="status-select"
                                value={slot.status}
                                disabled={updatingSlotId === slot.slotId}
                                onChange={(e) =>
                                  handleStatusChange(
                                    slot.slotId,
                                    e.target.value
                                  )
                                }
                              >
                                <option value="available">Available</option>
                                <option value="occupied">Occupied</option>
                                <option value="reserved">Reserved</option>
                                <option value="maintenance">Maintenance</option>
                              </select>

                              {updatingSlotId === slot.slotId && (
                                <span className="updating-text">
                                  Saving...
                                </span>
                              )}
                              <button
                                className="delete-slot-button"
                                onClick={() => handleDeleteSlot(slot.slotId)}
                                disabled={
                                  deletingSlotId === slot.slotId ||
                                  updatingSlotId === slot.slotId
                                }
                                title="Delete parking slot"
                              >
                                <Trash2 size={16} />
                                {deletingSlotId === slot.slotId ? "Deleting..." : "Delete"}
                              </button>
                              <button
                                className="edit-slot-button"
                                onClick={() => handleEditClick(slot)}
                                disabled={
                                  deletingSlotId === slot.slotId ||
                                  updatingSlotId === slot.slotId
                                }
                                title="Edit parking slot"
                              >
                                <Pencil size={16} />
                                Edit
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <p className="results-count">
                Showing {filteredSlots.length} of {slots.length} parking slots
              </p>
            </>
          )}

          <footer className="dashboard-footer">
            <div>
              <Activity size={16} />
              Smart Mall Parking Management System
            </div>

            <span>Admin Panel</span>
          </footer>

        </section>
      </main>
    </div>
  );
}

export default App;
