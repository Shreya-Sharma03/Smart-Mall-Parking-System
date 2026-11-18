# Smart Mall Parking Management System

An intelligent, multi-floor parking management system designed for shopping malls. The system coordinates vehicle occupancy tracking across two basement floors, provides automated shortest-path parking recommendations, enables visitor slot reservations with transactional concurrency protection, and provides an administrative management dashboard.

---

## 1. Project Overview

Finding available parking in multi-level shopping mall basements is frequently inefficient, leading to traffic congestion, unnecessary fuel consumption, and driver frustration. Simultaneously, facility operators lack real-time visibility into multi-floor occupancy patterns, reservation compliance, and bay maintenance.

The **Smart Mall Parking Management System** solves these challenges by combining:
- **Centralized Parking Management:** Real-time tracking of slot status (`available`, `occupied`, `reserved`, `maintenance`) across multiple levels.
- **Dijkstra Shortest-Path Recommendations:** Route guidance directing arriving drivers from entry gates to the closest compatible available slot.
- **Visitor Reservations:** Self-service reservation booking with strict vehicle compatibility, 30-minute validity, and atomic double-booking prevention.
- **Computer Vision Integration:** Automated occupancy detection using YOLOv8 vehicle tracking, mapped to parking bays with hysteresis filtering and reservation protection.
- **Administrative Control:** A real-time operations dashboard for occupancy analytics, slot editing, and reservation lifecycle management.

**Target Users:**
- **Mall Visitors:** View real-time availability, obtain nearest-slot route guidance, and reserve compatible parking spaces in advance.
- **Parking Facility Managers / Administrators:** Monitor floor-by-floor KPIs, manage slot inventory, inspect reservations, and cancel inactive or invalid bookings.

---

## 2. Technology Stack

| Layer | Component | Technology / Library | Description |
|---|---|---|---|
| **Frontend** | Admin Dashboard | React 19, Vite 8, Lucide React | Administrative operations panel with live KPI monitoring |
| | Visitor Client | React 19, Vite 6, React Router 7, Lucide React | Visitor-facing map navigation and slot selection UI |
| **Backend** | API Server | Node.js (CommonJS), Express.js 5 | Central REST API server and routing engine |
| | Database ODM | Mongoose 9 | Object data modeling, validation schemas, and transactions |
| **Database** | Persistence | MongoDB Atlas (Replica Set) | Document database supporting multi-document ACID transactions |
| **Pathfinding** | Routing Engine | Dijkstra's Algorithm | Weighted shortest-path computation on graph topology |
| **Computer Vision** | Vehicle Detection | Python 3, OpenCV, Ultralytics YOLOv8, NumPy | Object detection (cars, bikes) and polygon ROI slot mapping |
| **Testing** | Automated Tests | Node.js Test Runner (`node:test`, `node:assert/strict`) | Built-in integration test harness with strict database isolation |

---

## 3. System Architecture

The Express backend serves as the authoritative coordinator for all business logic, pathfinding computations, and database transactions. External clients communicate exclusively via standard HTTP REST APIs.

```text
  +-----------------------+         +-----------------------+
  |   Visitor Frontend    |         |    Admin Dashboard    |
  |      (React 19)       |         |   (React 19 + Vite)   |
  +-----------+-----------+         +-----------+-----------+
              |                                 |
              | HTTP REST                       | HTTP REST
              v                                 v
  +---------------------------------------------------------+
  |                   Express.js Backend                    |
  |  +--------------------+         +--------------------+  |
  |  |  Slot & Routing    |         |  Reservation       |  |
  |  |  Controller        |         |  Controller        |  |
  |  +---------+----------+         +---------+----------+  |
  |            |                              |             |
  |            v                              v             |
  |  +--------------------+         +--------------------+  |
  |  | Dijkstra Algorithm |         | Expiry & Ownership |  |
  |  | (34 Nodes Topology)|         | Transactions       |  |
  |  +--------------------+         +--------------------+  |
  +---------------------------+-----------------------------+
                              |
                              | Mongoose / WiredTiger ACID
                              v
                +---------------------------+
                |       MongoDB Atlas       |
                | (parkingslots, reservat.) |
                +---------------------------+
                              ^
                              | HTTP REST: POST /api/slots/cv-update
                              | (Batch occupancy updates with hysteresis)
                +-------------+-------------+
                |    Python CV Service      |
                |  (OpenCV + YOLOv8 Engine) |
                +---------------------------+
```

### Architectural Principles:
1. **No Direct Database Access from CV:** The Python computer vision service does **not** connect directly to MongoDB. All camera detections are submitted via the authenticated Express API endpoint (`POST /api/slots/cv-update`).
2. **ACID Transactions:** Reservation creation and cancellation use multi-document MongoDB transactions to guarantee that slot availability checks and reservation document state updates occur atomically.
3. **Interlocking Protection:** Computer vision updates are strictly prevented from overwriting `reserved` or `maintenance` slots.

---

## 4. Parking Layout & Topology

The facility is modeled as two basement levels with 12 demarcated parking spaces per floor, providing a total capacity of **24 slots**.

### Floor Breakdown:
| Floor | Level | Slot Identifiers | Total Capacity | Accessible Slots | Car-Only Slots | Bike-Only Slots | Dual (Car/Bike) |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| **B1** | Basement 1 | `B1-A01` to `B1-A12` | 12 | `B1-A01`, `B1-A07` | `B1-A01` to `B1-A08` | `B1-A09`, `B1-A10` | `B1-A11`, `B1-A12` |
| **B2** | Basement 2 | `B2-A01` to `B2-A12` | 12 | `B2-A01`, `B2-A07` | `B2-A01` to `B2-A08` | `B2-A09`, `B2-A10` | `B2-A11`, `B2-A12` |
| **Total** | | | **24** | **4** | **16** | **4** | **4** |

### Graph Topology & Navigation Nodes:
The internal navigation network is defined in `server/data/parkingGraph.js` and consists of **34 nodes** and **33 weighted edges**:
- **Entry Gates:** `B1-GA` (Gate A), `B1-GB` (Gate B).
- **Ramp Connections:** `B1-R1` to `B2-R1` (bi-directional floor transitions).
- **Junction Nodes:** `B1-J1`, `B1-J2`, `B1-J3`, `B2-J1`, `B2-J2`, `B2-J3`.
- **Parking Bay Nodes:** 24 designated destination nodes corresponding exactly to slot IDs.

---

## 5. Backend REST API Reference

Base URL: `http://localhost:5000/api`

### Parking Slot APIs (`/api/slots`)

| Method | Endpoint | Description | Query Parameters / Payload | Status Codes |
|---|---|---|---|---|
| `GET` | `/slots` | List all parking slots | `floor`, `status`, `vehicleType`, `accessible` | `200`, `500` |
| `GET` | `/slots/stats` | System and floor statistics | None | `200`, `500` |
| `GET` | `/slots/recommend` | Dijkstra route recommendation | `gateId` (required), `vehicleType` (required), `accessible` | `200`, `400`, `404`, `500` |
| `GET` | `/slots/:slotId` | Get single slot details | None | `200`, `404`, `500` |
| `POST` | `/slots` | Create a new parking slot | `{ slotId, floor, vehicleType, accessible, nodeId, location }` | `201`, `400`, `500` |
| `PATCH` | `/slots/:slotId` | Update slot details/status | `{ status, floor, vehicleType, accessible, nodeId, location }` | `200`, `400`, `404`, `500` |
| `DELETE`| `/slots/:slotId` | Delete parking slot | Rejects deletion if slot is `occupied` or `reserved` | `200`, `400`, `404`, `500` |
| `POST` | `/slots/cv-update`| Batch CV occupancy update | `{ cameraId, timestamp, updates: [...] }` | `200`, `400`, `403`, `500` |

#### Example: Recommendation Request
```http
GET /api/slots/recommend?gateId=B1-GA&vehicleType=car&accessible=true HTTP/1.1
Host: localhost:5000
```
```json
{
  "success": true,
  "message": "Nearest parking slots found",
  "count": 1,
  "recommendations": [
    {
      "slot": {
        "slotId": "B1-A01",
        "floor": "B1",
        "status": "available",
        "vehicleType": ["car"],
        "accessible": true
      },
      "distance": 8.5,
      "path": ["B1-GA", "B1-J1", "B1-A01"]
    }
  ]
}
```

---

### Reservation APIs (`/api/reservations`)

| Method | Endpoint | Description | Payload / Parameters | Status Codes |
|---|---|---|---|---|
| `POST` | `/reservations` | Reserve an available slot | `{ slotId, customerName, vehicleNumber, vehicleType }` | `201`, `400`, `404`, `409`, `500` |
| `GET` | `/reservations` | List reservations with filters | `status`, `slotId`, `vehicleNumber` | `200`, `500` |
| `GET` | `/reservations/:reservationId` | Retrieve reservation details | Path param `reservationId` | `200`, `400`, `404`, `500` |
| `PATCH`| `/reservations/:reservationId/cancel` | Cancel active reservation & release slot | Path param `reservationId` | `200`, `400`, `404`, `409`, `500` |

#### Example: Reservation Creation
```http
POST /api/reservations HTTP/1.1
Host: localhost:5000
Content-Type: application/json

{
  "slotId": "B1-A01",
  "customerName": "Jane Doe",
  "vehicleNumber": "KA-01-AB-1234",
  "vehicleType": "car"
}
```
```json
{
  "success": true,
  "message": "Slot reserved successfully",
  "data": {
    "reservationId": "RES-B1-A01-1794594613510",
    "slotId": "B1-A01",
    "floor": "B1",
    "customerName": "Jane Doe",
    "vehicleNumber": "KA-01-AB-1234",
    "vehicleType": "car",
    "status": "active",
    "startTime": "2026-11-14T01:00:00.000Z",
    "expiryTime": "2026-11-14T01:30:00.000Z"
  }
}
```

---

## 6. Reservation Functionality & Transaction Safety

The reservation system implements strict business and concurrency safeguards:

1. **Transactional Allocation:** Slot acquisition and reservation creation execute inside a single MongoDB multi-document transaction (`session.withTransaction`).
2. **Double-Booking Prevention:** An atomic conditional update checks `{ slotId, status: "available" }` before switching the slot status to `reserved` and stamping `activeReservationId`. If two requests compete for the same slot simultaneously, exactly one succeeds and the other receives a `409 Conflict`.
3. **Vehicle Compatibility Validation:** Car bookings reject bike-only bays (`A09`, `A10`); bike bookings reject car-only bays (`A01`–`A08`). Dual-compatible bays (`A11`, `A12`) accept either.
4. **30-Minute Validity Window:** Each reservation is created with `startTime = now` and `expiryTime = now + 30 minutes`.
5. **Ownership-Guarded Cancellation:** Cancelling an active reservation verifies that the associated slot currently has `status: "reserved"` and that `activeReservationId` matches the reservation ID before resetting the slot to `available`.
6. **Automatic Overdue Expiry:** `server/utils/reservationExpiry.js` performs background sweeps. Overdue active reservations (`expiryTime <= now`) are transitioned to `status: "expired"`, and their slots are released atomically and idempotently.

---

## 7. Computer Vision Integration Contract

The backend exposes an occupancy update contract in `server/routes/slotRoutes.js` designed for integration with computer vision detection pipelines:

```http
POST /api/slots/cv-update HTTP/1.1
Host: localhost:5000
Content-Type: application/json

{
  "cameraId": "CAM-B1-01",
  "timestamp": "2026-11-14T01:15:30.000Z",
  "updates": [
    {
      "slotId": "B1-A02",
      "confirmedStatus": "occupied",
      "isMonitored": true,
      "consecutiveOccupiedFrames": 5,
      "consecutiveAvailableFrames": 0
    }
  ]
}
```

### Backend Safety & Validation Rules:
- **Camera Whitelist (`server/config/cameraConfig.js`):** Rejects unknown camera IDs. Uncalibrated cameras (e.g., `CAM-B1-02`) are rejected with `403 Forbidden`.
- **Spatial Authorization:** Cameras can only submit updates for slots within their authorized floor and bay list.
- **Timestamp Integrity:** Strict ISO 8601 validation with timezone. Stale, duplicate, or out-of-order timestamps per camera are rejected, preventing replay attacks. Timestamps more than 5 minutes in the future are rejected.
- **Hysteresis Thresholds:** Prevents detection flicker. A bay cannot be marked `occupied` with fewer than 3 consecutive occupied frames, nor marked `available` with fewer than 5 consecutive available frames.
- **Reservation & Maintenance Interlocking:** If a CV update targets a slot that is currently `reserved` or `maintenance`, the update is bypassed, reported in the `skipped` response array, and the existing database status is preserved.

---

## 8. Admin Dashboard

The administrative panel (`admin-dashboard/`) is a single-page React 19 application built with Vite:

- **Overview Page:**
  - 5 responsive KPI cards: **Total Slots**, **Available**, **Occupied**, **Reserved**, and **Maintenance**.
  - Floor availability cards with progress tracks, percentage breakdowns, and color-coded status badges for B1 and B2.
  - Recent parking slots table displaying live slot data.
- **Parking Slots Page:**
  - Complete slot table with real-time status management dropdown.
  - Client-side search by Slot ID.
  - Multi-select filters for Floor (`All`, `B1`, `B2`), Status (`All`, `available`, `occupied`, `reserved`, `maintenance`), and Accessibility.
  - Add Slot and Edit Slot modal forms with coordinate and graph-node validation.
  - Deletion protection preventing deletion of occupied or reserved bays.
- **Reservations Page:**
  - Reservations table displaying ID, Customer, Vehicle Plate, Vehicle Type, Slot/Floor, Time Window, and Status.
  - Real-time remaining-time badge (`"Xm left"` or `"Expiring..."`) for active bookings.
  - Client-side search across Reservation ID, Customer Name, Vehicle Number, and Slot ID.
  - Mini KPI summary banner (Total, Active, Completed, Cancelled, Expired).
  - **Details Modal:** Complete record inspection with localized date formatting and defensive timestamp fallbacks.
  - **Active Reservation Cancellation:** One-click cancellation with confirmation prompt, disabling repeated clicks, releasing the slot back to available, and immediately refreshing dashboard metrics.
  - Automatic background polling every 10 seconds with clean unmount teardown.

---

## 9. Project Directory Structure

```text
Smart-Mall-Parking-System/
├── admin-dashboard/                     # React 19 + Vite Admin Dashboard
│   ├── public/                          # Static assets and icons
│   ├── src/
│   │   ├── components/
│   │   │   ├── ReservationDetailsModal.jsx  # Reservation detail inspection dialog
│   │   │   └── ReservationsView.jsx         # Reservation management view
│   │   ├── App.css                      # Unified styles and responsive breakpoints
│   │   ├── App.jsx                      # Main dashboard router and view coordinator
│   │   ├── index.css
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
├── cv-service/                          # Python Computer Vision Service
│   ├── config/                          # Settings, topology export, and ROI slots config
│   ├── detection/                       # YOLOv8 detector, tracker, slot mapper & temporal stabilizer
│   ├── services/                        # Backend REST API client & occupancy adapter
│   ├── tests/                           # 135 unit, pipeline, and live integration tests
│   ├── tools/                           # Interactive ROI calibration utility
│   ├── utils/                           # Visualizer, ROI utilities, and synthetic media generator
│   ├── main.py                          # CLI runner (--demo, --image, --video, --calibrate)
│   ├── pipeline.py                      # Unified CV processing pipeline with HTTP sync
│   ├── requirements.txt                 # Python dependencies
│   └── README.md                        # CV service architecture and testing guide
├── server/                              # Node.js + Express Backend
│   ├── algorithms/
│   │   └── dijkstra.js                  # Shortest-path recommendation engine
│   ├── config/
│   │   ├── cameraConfig.js              # Camera authorization and slot mappings
│   │   └── db.js                        # Mongoose connection with Google DNS
│   ├── data/
│   │   └── parkingGraph.js              # 34-node, 33-edge parking graph
│   ├── models/
│   │   ├── ParkingSlot.js               # Slot schema with activeReservationId
│   │   └── Reservation.js               # Reservation schema with indexes
│   ├── routes/
│   │   ├── reservationRoutes.js         # Reservation lifecycle and transaction APIs
│   │   └── slotRoutes.js                # Slot CRUD, Dijkstra, and CV update APIs
│   ├── seed/
│   │   └── seedSlots.js                 # Database seeder for 24 bays
│   ├── tests/                           # Automated backend integration test suite
│   │   ├── fixtures/
│   │   │   └── testSlots.js             # 24-slot test fixture generator
│   │   ├── helpers/
│   │   │   └── testDb.js                # Isolated test database helper
│   │   ├── cvUpdate.test.js             # 21 CV update integration tests
│   │   └── reservation.test.js          # 22 reservation integration tests
│   ├── utils/
│   │   └── reservationExpiry.js         # Auto-expiry sweep and atomic slot release
│   ├── package.json
│   ├── server.js                        # Modular Express application
│   └── startTestServer.js               # Dedicated isolated test server runner
├── visitor-client/                      # React 19 + Vite Visitor Application
│   ├── dist/                            # Production build output
│   ├── src/
│   │   ├── algorithms/                  # Client-side Dijkstra pathfinding fallback
│   │   ├── components/                  # Floor map, slot card, reservation modal, route overlay
│   │   ├── data/                        # Shared topology, parking graph, and mock slots
│   │   ├── hooks/                       # useParking live polling & connectivity hook
│   │   ├── pages/                       # VisitorDashboard and HomePage
│   │   ├── services/                    # slotService, recommendationService, reservationService
│   │   └── styles/                      # Responsive CSS stylesheets
│   ├── tests/
│   │   └── e2e_integration.test.mjs     # 58-test end-to-end integration test suite
│   ├── package.json
│   ├── vite.config.js
│   └── README.md                        # Visitor client documentation
├── .gitignore
└── README.md                            # Comprehensive project documentation
```

---

## 10. Local Setup & Installation

### Prerequisites
- **Node.js:** v18.0.0 or higher (v20+ recommended)
- **npm:** v9.0.0 or higher
- **Python:** 3.10+ (for CV Service)
- **MongoDB:** MongoDB Atlas cluster or local replica set (required for multi-document transactions)
- **Git**

---

### Step 1: Clone the Repository
```bash
git clone https://github.com/Shreya-Sharma03/Smart-Mall-Parking-System.git
cd Smart-Mall-Parking-System
```

---

### Step 2: Configure and Start the Backend

1. Navigate to the `server` directory and install dependencies:
   ```bash
   cd server
   npm install
   ```

2. Create a development environment file (`server/.env`):
   ```env
   MONGO_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/smart_mall_parking?retryWrites=true&w=majority
   PORT=5000
   ```
   *(Note: Never commit `.env` files containing credentials to version control).*

3. Seed the 24 parking bays (Optional for fresh databases):
   ```bash
   node seed/seedSlots.js
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```
   The backend will be running at `http://localhost:5000`.

#### Running the Dedicated Isolated Test Server:
To run the server bound strictly to the test database (`smart_mall_parking_test`) without touching development data:
1. Ensure `server/.env.test.local` defines `TEST_MONGO_URI`.
2. Start the test server:
   ```bash
   node startTestServer.js
   ```
   The server verifies that `mongoose.connection.name === "smart_mall_parking_test"` before listening on `http://localhost:5000`.

---

### Step 3: Start the Admin Dashboard

1. From the project root, open a separate terminal:
   ```bash
   cd admin-dashboard
   npm install
   npm run dev
   ```

2. Open the local Vite URL displayed in your terminal (typically `http://localhost:5173`).

---

### Step 4: Start the Visitor Client

1. From the project root, open a separate terminal:
   ```bash
   cd visitor-client
   npm install
   npm run dev
   ```

2. Open the local Vite URL displayed in your terminal (typically `http://localhost:5173`).
3. **Backend Connectivity:** The client connects to `http://localhost:5000/api` (configurable via `VITE_API_URL` in `.env`). If the backend is offline, the client automatically operates in **Offline Demo Mode** using local mock data and client-side Dijkstra shortest path.

---

### Step 5: Run the Python Computer Vision Service

1. From the project root, open a separate terminal:
   ```bash
   cd cv-service
   .\.venv\Scripts\Activate.ps1
   ```

2. Run the synthetic vehicle detection demonstration:
   ```bash
   python main.py --demo
   ```

---

## 11. Automated Verification & Testing

### A. Backend Automated Test Suites (Person B)
The backend test harness uses the Node.js built-in test runner against the isolated `smart_mall_parking_test` database:
```bash
cd server
node --test --test-concurrency=1 tests/reservation.test.js tests/cvUpdate.test.js
```
- **Total Tests:** **43 passed** (0 failed, 0 skipped).
- **Coverage:** Complete reservation lifecycle, concurrency race conditions, slot ownership validation, camera authorization, frame hysteresis thresholds, timestamp ordering, and CV reservation interlocking.

### B. Computer Vision Automated Test Suites (Person A)
The CV test suite runs via Pytest inside the dedicated virtual environment (`cv-service/.venv`):
```bash
cd cv-service
.\.venv\Scripts\Activate.ps1
python -m pytest -v
```
- **Total Tests:** **135 tests total**.
- **Offline Tests (99 passed):** Unit, detector, ROI, slot mapper, tracker, temporal stabilizer, API client, adapter, and pipeline tests execute fully offline without requiring a running backend.
- **Live Integration Tests (36 passed):** When `server/startTestServer.js` is running on `http://localhost:5000` connected to `smart_mall_parking_test`, all 36 live tests pass against the live Express endpoints. *(Note: If the backend is offline, these 36 tests safely skip via `@live_test`)*.

### C. Visitor Client End-to-End Integration Suite (Person A)
The visitor client integration test suite runs via Node.js ES modules:
```bash
cd visitor-client
node tests/e2e_integration.test.mjs
```
- **Total Tests:** **58 passed** (0 failed, 0 skipped).
- **Coverage:** 6 scenarios covering CV-to-backend integration (A), parking availability & filtering (B), recommendation system & Dijkstra fallback (C), reservation lifecycle (D), reservation & CV interlocking safety (E), and error handling & concurrency (F).

### D. Production Build Verification
- **Admin Dashboard:**
  ```bash
  cd admin-dashboard
  npm run build
  ```
  **Result:** **0 errors.** Production bundle generated in `admin-dashboard/dist/`.
- **Visitor Client:**
  ```bash
  cd visitor-client
  npm run build
  ```
  **Result:** **0 errors.** Production bundle generated in `visitor-client/dist/`.

---

## 12. Current Project Status & Limitations

### Completed & Verified (Person A):
- [x] Computer vision to backend HTTP contract compatibility (`POST /api/slots/cv-update`).
- [x] Temporal state stabilizer with frame hysteresis (3-frame occupied, 5-frame available).
- [x] Initial state suppression and reserved/maintenance bay protection.
- [x] Camera authorization and monotonic timestamp tracking per camera.
- [x] 135 CV automated tests (99 offline passed, 36 live passed).
- [x] Visitor client live slot fetching, connection health indicators, and automatic polling.
- [x] Backend-first shortest path recommendation with Dijkstra fallback and route enrichment.
- [x] Visitor reservation lifecycle (Booking modal, active countdown banner, cancellation, slot release).
- [x] Privacy safeguards: zero PII persisted in browser storage (`reservationId` only).
- [x] 58/58 visitor client end-to-end integration tests.
- [x] Visitor client production build (0 errors).

### Completed & Verified (Person B):
- [x] Express backend architecture, schemas, and REST APIs.
- [x] Dijkstra shortest-path recommendation algorithm with graph distance calculation.
- [x] Full reservation lifecycle (Creation, Listing, Detail Modal, Cancellation, Auto-Expiry).
- [x] Concurrency control via MongoDB ACID transactions.
- [x] Computer vision update validation, frame hysteresis, and reservation protection.
- [x] Complete Admin Dashboard (5 KPI cards, Slot CRUD, Reservation Management, Detail Modal, Cancellation).
- [x] 43/43 automated backend integration tests.
- [x] Dedicated isolated test server entry point (`server/startTestServer.js`).

### Genuine Limitations & Future Work:
1. **Synthetic & Static Media Testing:** All CV automated tests execute against synthetic video files and static frames. Connecting to physical mall CCTV cameras over RTSP represents a physical deployment step.
2. **Single Calibrated Camera (`CAM-B1-01`):** Only `CAM-B1-01` is actively configured and authorized for bays `B1-A01` through `B1-A08`. Camera `CAM-B1-02` is uncalibrated and deliberately rejected with `403 Forbidden` by backend safety policy.
3. **Accessibility Availability with Test Data:** When no parking spaces marked `accessible: true` are available in the test database, recommendation queries return 0 results. The frontend displays a friendly empty state (*"No accessible parking spaces currently available"*).
4. **Single Active Reservation per Browser Session:** The visitor dashboard UI is designed for single-visitor booking workflows; creating a subsequent reservation requires cancelling or completing the active reservation.
5. **MongoDB Replica Set Requirement:** Multi-document transactions require MongoDB Atlas or a local replica set; standalone single-node MongoDB without replica sets cannot execute transactional reservations.
6. **Scheduled Expiry Worker:** Reservation expiry sweeps currently run automatically on API request triggers; a standing cron job or agenda worker could be added for independent timer sweeps during low-traffic periods.

---

## 13. License

This project is developed for educational and academic purposes as a college engineering project.
