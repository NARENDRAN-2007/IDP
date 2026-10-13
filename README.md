# Availability-Aware Emergency Response & Bed Reservation Platform

An availability-aware emergency dispatch platform featuring provisional hospital bed reservations with auto-expiring timeouts and multi-hospital cascades. Real-time ER/ICU capacity, specialty matching, and PM-JAY empanelment override simple geographical proximity.

---

## Architecture & Directory Structure

```text
emergency-response-platform/
├── .gitignore
├── README.md
├── implementation-plan.md            # Detailed as-built technical specification & audit
├── docs/
│   ├── api-contracts.md              # Initial API contracts reference
│   ├── data-schemas.md               # Initial data schemas reference
│   └── test-scenarios.md             # Core verification test scenarios
├── backend/
│   ├── .env                          # Environment configuration (e.g. ORS_API_KEY)
│   ├── package.json                  # Express backend dependencies
│   ├── package-lock.json
│   ├── server.js                     # Express app entrypoint (port 8000)
│   ├── test-scenarios.js             # Automated rectification test suite
│   ├── data/
│   │   ├── ambulances.seed.json      # 10 ambulance units (A001–A010)
│   │   ├── hospitals.seed.json       # 22 Chennai hospital units (H001–H022)
│   │   └── severityKeywords.json    # Clinical symptom keyword classification map
│   ├── state/
│   │   └── store.js                  # In-memory reactive store, hold timers, and status logger
│   ├── modules/
│   │   ├── distance.js               # Haversine distance calculator
│   │   ├── severityClassifier.js     # Keyword-based severity & specialty triage
│   │   ├── ambulanceAllocator.js     # Nearest free ambulance allocator
│   │   ├── hospitalMatcher.js        # Provisional match & severity rematching
│   │   ├── bedReservation.js         # Provisional bed holds, 30s timers, auto-cascades
│   │   ├── requestQueue.js           # 5-second conflict window & severity tiebreak logic
│   │   └── routingService.js         # OpenRouteService driving distance & ETA provider
│   └── routes/
│       ├── emergency.routes.js       # /api/emergency (trigger, symptoms, confirm, status)
│       ├── hospitals.routes.js       # /api/hospitals
│       ├── ambulances.routes.js      # /api/ambulances
│       └── simulate.routes.js        # /api/simulate/reset
└── frontend/
    ├── package.json                  # React 19, Vite, TailwindCSS v4, Wouter, Radix UI
    ├── pnpm-lock.yaml
    ├── vite.config.ts                # Vite dev server configuration (port 3000)
    ├── server/
    │   └── index.ts                  # Production Express static file server
    └── client/
        ├── index.html
        └── src/
            ├── App.tsx               # App routing & providers
            ├── index.css             # Operations console design system & tokens
            ├── main.tsx              # React DOM entrypoint
            ├── components/
            │   ├── ErrorBoundary.tsx
            │   ├── Map.tsx           # Google Maps wrapper
            │   └── ui/               # Radix UI primitives
            └── pages/
                ├── Home.tsx          # Real-time Emergency Response Operations Console
                └── NotFound.tsx      # 404 page
```

---

## Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or pnpm

---

### 1. Start Backend Server

```bash
cd backend
npm install
npm start
```
The backend API server starts at **`http://localhost:8000`**.

> **Note on Routing & Drive Times**: To enable real road distance and driving ETA calculations, add your OpenRouteService API key in `backend/.env`:
> ```env
> ORS_API_KEY=your_openrouteservice_api_key_here
> ```
> If omitted, the platform gracefully falls back to straight-line distance estimates.

---

### 2. Start Frontend Operations Console

In a separate terminal window:

```bash
cd frontend
pnpm install   # or: npm install
pnpm dev       # or: npm run dev
```
The frontend dashboard starts at **`http://localhost:3000`** and automatically connects to the backend API at `http://localhost:8000/api`.

---

### 3. Run Backend Test Suite

To verify store initialisation, hold timer safety, phantom confirmation protection, duplicate submit handling, empanelment priority, and cascading:

```bash
cd backend
node test-scenarios.js
```

---

## Actual Demo Flow (Verified Against Code)

Follow this step-by-step flow in the frontend operations console (`http://localhost:3000`):

1. **Step 1 — Locate & Trigger Emergency**:
   - Enter patient latitude and longitude (default: Chennai coordinates `13.0827`, `80.2707`).
   - Select location source (**GPS** [10km initial radius] or **Approximate** [20km initial radius]).
   - Click **Trigger Emergency** (`POST /api/emergency/trigger`).
   - *Outcome*:
     - The nearest free ambulance (e.g. `A001`) is allocated and marked `assigned`.
     - The nearest PM-JAY empanelled hospital with available ER beds is provisionally matched.
     - An initial ER provisional hold (`HOLD1`) is placed, decrements hospital ER bed count, and starts a **30-second countdown timer**.
     - Live status polling initiates every 2 seconds (`GET /api/emergency/:id/status`).

2. **Step 2 — Clinical Symptom Triage**:
   - In the triage card, input patient symptoms (e.g. `"severe chest pain and unconscious"`).
   - Click **Submit Symptoms** (`POST /api/emergency/:id/symptoms`).
   - *Outcome*:
     - Triage classifier evaluates keywords: classifies severity level (Level 1: Critical) and required specialty (`cardiac`).
     - Maps to department: Level 1 $\rightarrow$ ICU bed; Levels 2–4 $\rightarrow$ ER bed.
     - Re-ranks all hospitals within 100km prioritizing specialty match, PM-JAY empanelment, and distance.
     - Cancels initial ER hold (restoring bed) and places a new provisional hold on the top-ranked facility (e.g. `HOLD2`), resetting the 30-second countdown.

3. **Step 3 — Bed Confirmation (Standard Path)**:
   - Click **Confirm Hospital** (`POST /api/emergency/:id/confirm-hospital`) before the 30-second timer elapses.
   - *Outcome*:
     - Provisional hold transitions to `confirmed`.
     - Request status updates to `BED_CONFIRMED`.
     - Timer stops, countdown displays green confirmation banner, and polling terminates.

4. **Step 4 — Hold Timeout & Automatic Cascade (Edge Case Path)**:
   - To observe automated hospital cascading, trigger an emergency and submit symptoms, but do not click Confirm.
   - Let the 30-second countdown reach `0s`.
   - *Outcome*:
     - Backend timer fires `releaseAndCascade()`.
     - Expired hold is marked `expired` and hospital bed capacity is restored (+1).
     - Request status transitions to `BED_HOLD_TIMED_OUT`.
     - Engine automatically shifts candidate list and places a new provisional hold on candidate #2 (`BED_HELD`).
     - Frontend receives the new `activeHoldId` on its next 2s poll, displays `"Reassigned 1 time due to timeout"`, and resets the countdown timer for 30s.
     - Cascades continue up to a maximum of 5 iterations before terminating at `NO_HOSPITAL_AVAILABLE`.

5. **Resetting the Simulation**:
   - Click **Reset Demo** in the top navigation bar at any time (`POST /api/simulate/reset`).
   - Cancels all active timers, clears requests/holds, and restores all hospital and ambulance seed data to pristine initial states.
