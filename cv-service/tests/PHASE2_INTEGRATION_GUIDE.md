# Phase 2 — Live Integration Test Startup Guide

## Prerequisites

Before running Phase 2 live integration tests, the Express backend must be
started and connected to the **isolated test database** (`smart_mall_parking_test`).

## Step 1: Create `server/.env.test.local`

Create the file `server/.env.test.local` in the `Smart-Mall-Parking-System_cv` repository with:

```
TEST_MONGO_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/smart_mall_parking?retryWrites=true&w=majority
```

> **Important:** Use your MongoDB Atlas connection string. The `startTestServer.js`
> script automatically appends `dbName: "smart_mall_parking_test"` via Mongoose options,
> overriding the database name regardless of the URI's default database.

> **Safety:** This file is listed in `.gitignore` (`.env.*` pattern) and will NOT be
> committed to Git.

## Step 2: Start the Isolated Test Server

```bash
cd "c:\Users\Shubhi Singh\Smart-Mall-Parking-System_cv\server"
node startTestServer.js
```

Expected output:
```
Connecting to test database...
Verified connection to isolated test database: 'smart_mall_parking_test'
Smart Mall Parking Test Server running on http://localhost:5000
Database: smart_mall_parking_test
```

> **If `Mongoose.connect` fails:** Confirm your Atlas cluster allows connections from
> your machine's IP address. Add your IP in Atlas → Network Access → Add IP Address.

## Step 3: Seed the Test Database (via Person B's Node.js fixtures)

The backend's `beforeEach` test hooks seed the database automatically when
`node --test tests/cvUpdate.test.js` is run. For Phase 2 Python integration tests,
the test slots must exist in the database. Run Person B's Node.js test once to seed:

```bash
cd "c:\Users\Shubhi Singh\Smart-Mall-Parking-System_cv\server"
node --test --test-concurrency=1 tests/cvUpdate.test.js
```

This seeds B1-A01 through B1-A12 and B2-A01 through B2-A12 with these initial states:
- `B1-A01` to `B1-A04`: **available**
- `B1-A02`: **occupied** (for occupied→available scenario)
- `B1-A05`: **reserved** (protected slot test)
- `B1-A06`: **maintenance** (maintenance slot test)
- `B1-A07` to `B1-A08`: **available**
- `B1-A09` to `B1-A12`: **available** (CAM-B1-02 slots, camera disabled)
- `B2-A01` to `B2-A12`: **available**

## Step 4: Run Phase 2 Python Live Integration Tests

```bash
cd "c:\Users\Shubhi Singh\Smart-Mall-Parking-System_cv\cv-service"
python -m unittest discover -s tests -p "test_live_integration.py" -v
```

Or to run the full combined suite:

```bash
python -m unittest discover -s tests -p "test_*.py"
```

## Expected Results (when backend is running)

| Test Class | Tests | Expected |
|---|---|---|
| `TestPhase2LiveIntegration` | 31 tests | All pass (or legitimately skip for state conflicts) |
| `TestPhase2BackendOnlyContractVerification` | 5 tests | All pass |

## Test Coverage Map

| Phase 2 Scenario | Test IDs | Description |
|---|---|---|
| **A: Available → Occupied** | test_02, test_03, test_04 | 3-frame threshold, rejection below threshold, API client |
| **B: Occupied → Available** | test_05, test_06, test_07 | 5-frame threshold, rejection below threshold, API client |
| **C: Initial Available State** | test_08, test_09, test_10 | Zero-frame suppression, 4-frame suppression, 5-frame accepted |
| **D: Protected Slots** | test_11, test_12, test_13 | Reserved protection, maintenance protection, client handling |
| **E: Uncalibrated Camera** | test_14, test_15 | Backend 403 rejection, Python-level suppression |
| **F: Disabled/Wrong Camera** | test_16, test_17 | Unknown camera 400, cross-camera slot assignment |
| **Error Handling** | test_18 to test_30 | Invalid timestamps, missing fields, stale timestamps, future timestamps, duplicate slots, connection refused, duplicate suppression, monotonicity, API contract shape |
| **Backend Contract Verification** | test_b01 to test_b05 | Batch size limit, nonexistent slot, negative frames, CAM-B2-01, received count |
