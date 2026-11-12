# Smart Mall Parking Management System

An intelligent multi-floor parking management system designed to simplify parking operations in shopping malls through centralized slot management, shortest-path recommendations, and automated vehicle occupancy detection.

## Project Overview

The Smart Mall Parking Management System aims to provide an organized and efficient way to manage parking spaces across multiple basement floors.

The system is designed around three major components:

- **Visitor Interface:** Allows visitors to view parking availability and find suitable parking spaces.
- **Admin Dashboard:** Enables administrators to monitor parking statistics and manage parking slots.
- **Backend and Database:** Handles parking data, slot management, validation, and shortest-path recommendations.

Computer vision integration using OpenCV and YOLO is planned to support automated vehicle detection and parking occupancy updates.

## Technology Stack

| Component | Technologies |
|---|---|
| Frontend | React, JavaScript, CSS |
| Backend | Node.js, Express.js |
| Database | MongoDB Atlas, Mongoose |
| Pathfinding | Dijkstra's Algorithm |
| Computer Vision | Python, OpenCV, YOLO (planned integration) |
| Icons | Lucide React |

## System Architecture

```text
             Visitor Interface
                    |
                    |
              Express API
                    |
          ---------------------
          |                   |
     MongoDB Atlas       Recommendation
          |              Algorithm
          |                   |
          ---------------------
                    |
              Admin Dashboard

        Python Computer Vision
          (Integration Pending)
                    |
              Express API
```

The Express backend acts as the central interface between the application and MongoDB. The frontend and future computer-vision service communicate with the backend through REST APIs.

## Parking Layout

The prototype consists of two basement floors with 12 parking spaces on each floor.

**Total Capacity: 24 Parking Slots**

| Floor | Slot IDs | Capacity |
|---|---|---:|
| B1 | B1-A01 to B1-A12 | 12 |
| B2 | B2-A01 to B2-A12 | 12 |
| **Total** | | **24** |

### Navigation Nodes

The parking graph uses consistent identifiers across the system.

**Entry and Exit Gates**
- `B1-GA` – Gate A
- `B1-GB` – Gate B

**Ramp Connections**
- `B1-R1`
- `B2-R1`

**Junction Nodes**
- `B1-J1`, `B1-J2`, `B1-J3`
- `B2-J1`, `B2-J2`, `B2-J3`

These identifiers are used by the backend parking graph and should remain consistent across frontend maps and future integrations.

## Implemented Features

### Backend

- Express.js server with MongoDB Atlas connectivity.
- Mongoose-based parking slot schema.
- REST APIs for creating, retrieving, updating, and deleting parking slots.
- Validation of slot IDs, floor assignments, vehicle types, and graph nodes.
- Duplicate slot and graph-node assignment checks.
- Parking capacity validation:
  - Maximum 24 slots overall.
  - Maximum 12 slots per floor.
- Filtering by floor, status, vehicle type, and accessibility.
- Protection against deleting occupied or reserved parking slots.
- Database seeding for 24 parking spaces.

### Parking Recommendation

Dijkstra's shortest-path algorithm is implemented to recommend available parking spaces based on the selected entry gate.

Recommendations consider:
- Entry gate.
- Vehicle type.
- Parking availability.
- Accessibility requirements.

The API returns recommended parking slots along with their calculated graph distances and paths.

### Admin Dashboard

The React-based admin dashboard provides:

- Overview of total parking capacity.
- Available, occupied, and maintenance slot statistics.
- Floor-wise parking statistics.
- Automatic data refresh.
- Parking slot search and filtering.
- Accessibility filtering.
- Add new parking slots.
- Edit existing parking slot details.
- Delete eligible parking slots.
- Update parking slot statuses.
- Error messages and retry functionality.

## Parking Slot Data Model

Each parking slot is represented using the following fields:

| Field | Description |
|---|---|
| `slotId` | Unique parking identifier, e.g. `B1-A01` |
| `floor` | `B1` or `B2` |
| `status` | `available`, `occupied`, `reserved`, or `maintenance` |
| `vehicleType` | Supported vehicle types: `car`, `bike` |
| `accessible` | Accessibility indicator |
| `nodeId` | Corresponding parking graph node |
| `location` | X and Y coordinates |

The database also maintains creation and update timestamps.

## API Reference

Base URL:

```text
http://localhost:5000/api/slots
```

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Retrieve all parking slots |
| GET | `/:slotId` | Retrieve a specific slot |
| POST | `/` | Create a parking slot |
| PATCH | `/:slotId` | Update parking slot details |
| DELETE | `/:slotId` | Delete a parking slot |
| GET | `/stats` | Retrieve parking statistics |
| GET | `/recommend` | Get shortest-path parking recommendations |

### Example API Requests

**Retrieve all parking slots**

```http
GET /api/slots
```

**Filter available slots on B1**

```http
GET /api/slots?floor=B1&status=available
```

**Retrieve parking statistics**

```http
GET /api/slots/stats
```

**Recommend parking for a car entering through Gate A**

```http
GET /api/slots/recommend?gateId=B1-GA&vehicleType=car
```

**Recommend accessible parking**

```http
GET /api/slots/recommend?gateId=B1-GA&vehicleType=car&accessible=true
```

## Project Structure

```text
Smart-Mall-Parking-System/
│
├── server/
│   ├── algorithms/
│   │   └── dijkstra.js
│   │
│   ├── config/
│   │   └── db.js
│   │
│   ├── data/
│   │   └── parkingGraph.js
│   │
│   ├── models/
│   │   └── ParkingSlot.js
│   │
│   ├── routes/
│   │   └── slotRoutes.js
│   │
│   ├── seed/
│   │   └── seedSlots.js
│   │
│   ├── .env
│   ├── package.json
│   └── server.js
│
├── admin-dashboard/
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── App.jsx
│   │   ├── App.css
│   │   ├── index.css
│   │   └── main.jsx
│   │
│   ├── package.json
│   └── vite.config.js
│
└── README.md
```

## Getting Started

### Prerequisites

- Node.js and npm
- MongoDB Atlas account
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/Shreya-Sharma03/Smart-Mall-Parking-System.git
cd Smart-Mall-Parking-System
```

### 2. Set Up the Backend

```bash
cd server
npm install
```

Create a `.env` file inside the `server` directory:

```env
MONGO_URI=your_mongodb_connection_string
PORT=5000
```

Replace the placeholder with your MongoDB Atlas connection string.

**Important:** Keep `.env` private. Do not commit database credentials to GitHub.

### 3. Seed the Parking Slots

From the `server` directory, run:

```bash
node seed/seedSlots.js
```

This initializes the 24 parking slots using the identifiers defined in the parking graph.

The seed script uses upsert operations to avoid creating duplicate records when executed again.

### 4. Start the Backend

From the `server` directory:

```bash
npm run dev
```

The backend runs at:

```text
http://localhost:5000
```

### 5. Start the Admin Dashboard

Open another terminal from the project root:

```bash
cd admin-dashboard
npm install
npm run dev
```

Open the local Vite URL displayed in the terminal, usually:

```text
http://localhost:5173
```

Keep both the backend and frontend terminals running while using the dashboard.

## Current Development Status

| Component | Status |
|---|---|
| Express backend | Implemented |
| MongoDB integration | Implemented |
| Parking slot CRUD APIs | Implemented |
| Parking graph | Implemented |
| Dijkstra recommendation | Implemented |
| Database seeding | Implemented |
| Admin dashboard | Implemented |
| Dashboard statistics and filters | Implemented |
| Visitor-facing frontend | Pending development |
| OpenCV and YOLO vehicle detection | Pending development |
| Camera-to-slot mapping | Pending development |
| Automated camera occupancy updates | Pending integration |
| Complete end-to-end integration | Pending |

## Future Enhancements

- Visitor-facing parking interface.
- Real-time vehicle detection using OpenCV and YOLO.
- Camera-to-parking-slot mapping.
- Automated occupancy updates through backend APIs.
- Integration of visitor navigation with the parking graph.
- Complete end-to-end testing of the integrated system.
