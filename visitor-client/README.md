# Visitor Client — Smart Mall Parking System

A modern, responsive web application for mall visitors providing real-time parking space visualization, shortest-path guidance, and transactional bay reservations across two basement levels (B1 and B2).

---

## 1. Technology Stack

- **Framework:** React 19 (`react`, `react-dom`)
- **Build Tool:** Vite 6 (`vite`, `@vitejs/plugin-react`)
- **Routing:** React Router 7 (`react-router-dom`)
- **Icons:** Lucide React (`lucide-react`)
- **Pathfinding Algorithm:** Dijkstra's shortest-path algorithm (client-side fallback)
- **Styling:** Modular CSS with CSS Custom Properties and responsive design

---

## 2. Directory Structure

```text
visitor-client/
├── dist/                          # Production build output
├── public/                        # Static assets and icons
├── src/
│   ├── algorithms/
│   │   └── dijkstra.js            # Client-side Dijkstra graph pathfinding fallback
│   ├── components/
│   │   ├── ActiveReservationBanner.jsx  # Floating banner with live countdown and cancel
│   │   ├── DataSourceBanner.jsx         # Connectivity indicator (Live vs Demo Mode)
│   │   ├── FloorSwitcher.jsx            # Floor selector (B1 / B2)
│   │   ├── Header.jsx                   # Application header with real-time stats
│   │   ├── ParkingFloorMap.jsx          # SVG multi-floor parking map layout
│   │   ├── ParkingSlotCard.jsx          # Individual slot representation card
│   │   ├── RecommendationCard.jsx       # Nearest-slot card with step-by-step route
│   │   ├── ReservationModal.jsx         # Booking modal with input validation
│   │   ├── RouteOverlay.jsx             # Visual shortest-path route on floor map
│   │   ├── SlotDetailsDrawer.jsx        # Slide-over panel for slot inspection & booking
│   │   ├── StatusLegend.jsx             # Color-coded slot status legend
│   │   └── VisitorPreferences.jsx       # Gate, vehicle type, and accessibility controls
│   ├── data/
│   │   ├── mockSlots.js                 # Fallback offline parking bays & statistics
│   │   ├── parkingGraph.js              # 34-node, 33-edge garage navigation network
│   │   └── topology.js                  # Shared facility layout, floors, and gates
│   ├── hooks/
│   │   └── useParking.js                # Live polling hook with auto-refresh and fallback
│   ├── pages/
│   │   ├── HomePage.jsx                 # Landing navigation view
│   │   └── VisitorDashboard.jsx         # Main visitor interactive dashboard
│   ├── services/
│   │   ├── recommendationService.js     # Backend-first recommendation & route enrichment
│   │   ├── reservationService.js        # Reservation lifecycle API client
│   │   └── slotService.js               # Slot data API client and normalization
│   ├── styles/
│   │   ├── App.css                      # Unified component styling
│   │   └── index.css                    # Base styling and CSS variables
│   ├── App.jsx                          # Router and root component
│   └── main.jsx                         # Application entry point
├── tests/
│   └── e2e_integration.test.mjs         # 58-test end-to-end integration test suite
├── index.html                           # HTML template
├── package.json                         # Project dependencies and npm scripts
└── vite.config.js                       # Vite configuration
```

---

## 3. Setup & Installation

### Prerequisites
- **Node.js:** v18.0.0 or higher (v20+ recommended)
- **npm:** v9.0.0 or higher
- **Backend Server:** Express backend running on `http://localhost:5000` (optional for offline demo mode)

### Installation Steps

1. Navigate to the `visitor-client` directory:
   ```bash
   cd visitor-client
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Environment Variables (Optional):
   Create a `.env` file in `visitor-client/` to override the API endpoint if running on a custom port:
   ```env
   VITE_API_URL=http://localhost:5000/api
   ```
   *(Defaults to `http://localhost:5000/api` if omitted).*

4. Start Development Server:
   ```bash
   npm run dev
   ```
   The application will be available at `http://localhost:5173`.

5. Build for Production:
   ```bash
   npm run build
   ```
   Generates optimized assets in the `dist/` directory.

---

## 4. Architecture & Key Features

### A. Live Slot Polling & Connectivity Handling (`useParking.js`)
- **Automatic Polling:** Automatically queries `GET /api/slots` every 20 seconds (`REFRESH_INTERVAL_MS = 20_000`).
- **Connection States:** Exposes `isBackendOnline` (`true`, `false`, or `null`).
- **Manual Refresh:** Provides a manual refresh trigger that updates slot occupancy immediately without full page reload.
- **Graceful Fallback:** If the backend is unreachable or returns a network error, the hook falls back seamlessly to `INITIAL_MOCK_SLOTS` and sets `dataSource = 'mock'`.

### B. Intelligent Recommendation Engine (`recommendationService.js`)
- **Backend-First Strategy:** Calls `GET /api/slots/recommend?gateId=...&vehicleType=...&accessible=...`.
- **Client-Side Dijkstra Fallback:** When offline, computes shortest path using Dijkstra's algorithm over the 34-node parking graph defined in `parkingGraph.js`.
- **Navigation Enrichment:** Computes estimated indoor transit times (assuming ~12 km/h plus parking maneuver time) and constructs human-readable turn-by-turn driving steps (e.g., *"Enter through Gate A"*, *"Turn into Aisle 1"*, *"Park in bay B1-A01"*).

### C. Visitor Reservation Lifecycle (`reservationService.js`)
- **Reservation Booking:** Visitors select an available bay and submit customer name, vehicle plate number, and vehicle type (`POST /api/reservations`).
- **Transactional Protection:** Slots are reserved with 30-minute validity enforced by the backend expiry timestamp (`expiryTime`).
- **Session Restoration:** On page reload, the client inspects `localStorage` for `smart_mall_active_res_id`. If present, it queries `GET /api/reservations/:id` to restore the active booking and countdown.
- **Countdown & Auto-Expiry:** A floating banner displays remaining minutes and seconds. When `expiryTime` is reached, the banner switches to an expired state and prompts slot release.
- **Cancellation:** Visitors can cancel their booking at any time (`PATCH /api/reservations/:id/cancel`), immediately releasing the slot to `available` and clearing the client state.
- **Privacy Guarantee:** The client strictly stores **only** the reservation ID in `localStorage`. Zero Personally Identifiable Information (no customer names, phone numbers, or license plate numbers) is persisted locally.

---

## 5. End-to-End Integration Testing

The visitor client includes an automated integration test suite that tests the client services against backend contracts without requiring browser automation.

### Test Suite Location
- [`visitor-client/tests/e2e_integration.test.mjs`](file:///c:/Users/Shubhi%20Singh/Smart-Mall-Parking-System_cv/visitor-client/tests/e2e_integration.test.mjs)

### Execution Command
Run the tests using Node.js built-in ES module execution:
```bash
cd visitor-client
node tests/e2e_integration.test.mjs
```

### Coverage (58 Passed Tests)
The test suite validates 6 end-to-end integration scenarios:
- **Scenario A (CV-to-Backend Integration):** Validates normalized slot status propagation, timestamp handling, and batch response parsing.
- **Scenario B (Parking Availability & Filtering):** Validates floor-level filtering (B1/B2), vehicle type compatibility (`car`, `motorcycle`), and accessibility flags.
- **Scenario C (Recommendation System):** Validates Dijkstra shortest path, route distance calculations, turn-by-turn step generation, and accessible slot fallbacks.
- **Scenario D (Reservation Lifecycle):** Validates reservation creation (`POST`), detail restoration (`GET`), cancellation (`PATCH`), and slot status transitions.
- **Scenario E (Reservation & CV Interlocking):** Validates that slots under active reservation are protected against unauthorized CV status overwrites.
- **Scenario F (Error Handling & Edge Cases):** Validates handling of `400 Bad Request`, `404 Not Found`, `409 Conflict` (double-booking prevention), duplicate cancellation attempts, and network errors.

> **Note on Live Testing:** When running against a live backend, ensure the test server is started via `node startTestServer.js` connected to `smart_mall_parking_test`. The test suite runs in standalone self-contained mode when the backend is offline.

---

## 6. Known Limitations

1. **Accessibility Recommendations with Limited Test Data:**
   If no available parking slots are marked with `accessible: true` in the active database, recommendation requests with `accessibleOnly=true` return 0 results. The frontend displays a friendly notice (*"No accessible parking spaces currently available"*) without crashing.
2. **Single Active Reservation per Browser Session:**
   The visitor client UI tracks one active reservation per browser session. To create a new reservation, the visitor must cancel or let the existing reservation expire.
3. **Offline Mode Reservation Restrictions:**
   When operating in Offline Demo Mode, reservations are disabled because transactions require an authoritative backend and MongoDB session.
4. **Local Storage Clearing:**
   Clearing browser cache or local storage removes `smart_mall_active_res_id`. The backend reservation remains active until its 30-minute expiry window lapses, but the client will no longer show the active countdown banner.
