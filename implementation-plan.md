# Emergency Response Platform — As-Built Implementation Plan & System Documentation

This document records the exact, as-built technical implementation of the Availability-Aware Emergency Response & Bed Reservation Platform. All schemas, signatures, route contracts, state machines, and flows described herein are drawn directly from the codebase as implemented in `backend/` and `frontend/`.

---

## 1. As-Built Directory & File Structure

```text
c:/IDP/IDP/
├── .gitignore
├── README.md
├── implementation-plan.md
├── docs/
│   ├── api-contracts.md
│   ├── data-schemas.md
│   └── test-scenarios.md
├── backend/
│   ├── .env
│   ├── package.json
│   ├── package-lock.json
│   ├── server.js
│   ├── test-scenarios.js
│   ├── data/
│   │   ├── ambulances.seed.json      # 10 ambulance records (A001 - A010)
│   │   ├── hospitals.seed.json       # 22 hospital records (H001 - H022)
│   │   └── severityKeywords.json    # 12 keyword-to-severity mappings
│   ├── modules/
│   │   ├── ambulanceAllocator.js     # Nearest free ambulance matching & allocation
│   │   ├── bedReservation.js         # Provisional holds, 30s timers, cascade releases
│   │   ├── distance.js               # Haversine distance calculator
│   │   ├── hospitalMatcher.js        # Provisional match & severity rematching
│   │   ├── requestQueue.js           # 5-second conflict window & severity tiebreak
│   │   ├── routingService.js         # OpenRouteService driving distance & ETA
│   │   └── severityClassifier.js     # Keyword-based clinical symptom classifier
│   ├── routes/
│   │   ├── ambulances.routes.js      # GET /api/ambulances
│   │   ├── emergency.routes.js       # Core emergency trigger, symptoms, confirm, status
│   │   ├── hospitals.routes.js       # GET /api/hospitals
│   │   └── simulate.routes.js        # POST /api/simulate/reset
│   └── state/
│       └── store.js                  # In-memory database store & status logger
└── frontend/
    ├── package.json                  # React 19, Vite, TailwindCSS v4, Wouter, Radix UI
    ├── pnpm-lock.yaml
    ├── tsconfig.json
    ├── tsconfig.node.json
    ├── vite.config.ts                # Dev server (port 3000), path aliases (@, @shared)
    ├── server/
    │   └── index.ts                  # Production Express static file server
    ├── shared/
    │   └── const.ts                  # Session & cookie constants
    └── client/
        ├── index.html
        └── src/
            ├── App.tsx               # Wouter routing, ThemeProvider, Toaster
            ├── const.ts
            ├── index.css             # Design tokens, variables, custom utilities
            ├── main.tsx              # React DOM entrypoint
            ├── components/
            │   ├── ErrorBoundary.tsx
            │   ├── ManusDialog.tsx
            │   ├── Map.tsx           # Google Maps JS API wrapper (not mounted in Home)
            │   └── ui/               # 53 Radix/shadcn UI components
            ├── contexts/
            │   └── ThemeContext.tsx  # Theme provider
            ├── hooks/
            │   ├── useComposition.ts
            │   ├── useMobile.tsx
            │   └── usePersistFn.ts
            ├── lib/
            │   └── utils.ts          # clsx + twMerge utility
            └── pages/
                ├── Home.tsx          # Main operations console dashboard
                └── NotFound.tsx      # 404 fallback page
```

---

## 2. Real Data Schemas (Extracted from Code & JSON)

### 2.1 Hospital Schema (`backend/data/hospitals.seed.json`)
22 hospital units (`H001` to `H022`) located across the Chennai metropolitan area.

```typescript
interface Hospital {
  id: string;               // e.g. "H001"
  name: string;             // e.g. "Government General Hospital"
  lat: number;              // Latitude, e.g. 13.0827
  lng: number;              // Longitude, e.g. 80.2707
  specialties: string[];    // e.g. ["trauma", "cardiac", "general", "pediatric", "burns", "obstetric"]
  beds: {
    ER: {
      total: number;        // e.g. 10
      available: number;    // e.g. 3
    };
    ICU: {
      total: number;        // e.g. 6
      available: number;    // e.g. 1
    };
    General: {
      total: number;        // e.g. 40
      available: number;    // e.g. 12
    };
  };
  empanelled: boolean;      // PM-JAY empanelled flag (true / false)
  lastUpdated: string;      // ISO timestamp, e.g. "2026-09-21T10:00:00Z"
}
```

### 2.2 Ambulance Schema (`backend/data/ambulances.seed.json`)
10 ambulance units (`A001` to `A010`).

```typescript
interface Ambulance {
  id: string;                       // e.g. "A001"
  lat: number;                      // Latitude, e.g. 13.0800
  lng: number;                      // Longitude, e.g. 80.2700
  status: "free" | "assigned";       // Unit availability state
  currentRequestId: string | null;  // Linked request ID or null
}
```

### 2.3 Severity Keywords Dictionary (`backend/data/severityKeywords.json`)
Matches symptom text substrings (case-insensitive) to triage urgency levels and specialties.

```json
{
  "unconscious":          { "level": 1, "specialty": "trauma" },
  "not breathing":        { "level": 1, "specialty": "trauma" },
  "chest pain":           { "level": 1, "specialty": "cardiac" },
  "heavy bleeding":       { "level": 1, "specialty": "trauma" },
  "accident":             { "level": 2, "specialty": "trauma" },
  "difficulty breathing": { "level": 2, "specialty": "general" },
  "severe burns":         { "level": 2, "specialty": "burns" },
  "labor pain":           { "level": 2, "specialty": "obstetric" },
  "high fever":           { "level": 3, "specialty": "general" },
  "fracture":             { "level": 3, "specialty": "general" },
  "vomiting":             { "level": 4, "specialty": "general" },
  "minor injury":         { "level": 4, "specialty": "general" }
}
```

### 2.4 In-Memory Store Schema (`backend/state/store.js`)

```typescript
interface Store {
  hospitals: Hospital[];                     // Deep clone of hospitals.seed.json on init/reset
  ambulances: Ambulance[];                   // Deep clone of ambulances.seed.json on init/reset
  requests: Record<string, EmergencyRequest>;// Keyed by requestId (e.g. "REQ1758441600000")
  holds: Record<string, BedHold>;            // Keyed by holdId (e.g. "HOLD1")
  nextHoldId: number;                        // Integer counter starting at 1
}
```

### 2.5 Emergency Request Schema (`store.requests[requestId]`)
Instantiated in `POST /api/emergency/trigger` and mutated across the request lifecycle.

```typescript
interface EmergencyRequest {
  id: string;                                // `REQ${Date.now()}`
  createdAt: number;                         // Timestamp (ms), Date.now()
  patientLocation: {
    lat: number;
    lng: number;
  };
  locationSource: "gps" | "approximate";     // Default "gps"
  status: RequestStatus;                     // State machine enum (detailed in section 5)
  symptomsText: string;                      // Captured patient symptoms or empty string
  severityLevel: 1 | 2 | 3 | 4 | null;       // 1 (Critical), 2 (Serious), 3 (Moderate), 4 (Minor)
  requiredSpecialty: string | null;          // "trauma" | "cardiac" | "burns" | "obstetric" | "general"
  assignedAmbulanceId: string | null;        // Assigned ambulance ID or null
  provisionalHospitalId: string | null;      // Currently targeted hospital ID
  confirmedHospitalId: string | null;        // Final confirmed hospital ID
  candidateHospitals: Hospital[];            // Re-ranked candidate list for cascading
  activeHoldId: string | null;               // Currently active hold ID (e.g. "HOLD1") or null
  cascadeCount: number;                      // Count of timeout cascade occurrences
  statusLog: StatusLogEntry[];               // Chronological audit trail of status transitions
}

interface StatusLogEntry {
  status: RequestStatus;
  at: number;                                // Timestamp (ms)
}
```

### 2.6 Bed Hold Schema (`store.holds[holdId]`)
Instantiated in `reserveBedProvisional()` in `backend/modules/bedReservation.js`.

```typescript
interface BedHold {
  holdId: string;                            // `HOLD${store.nextHoldId++}`
  requestId: string;                         // Associated EmergencyRequest.id
  hospitalId: string;                        // Associated Hospital.id
  bedType: "ER" | "ICU";                     // Allocated bed department
  createdAt: number;                         // Hold placement timestamp (ms)
  expiresAt: number;                         // Hold expiration timestamp (`createdAt + 30000`)
  status: "pending" | "confirmed" | "expired";
  timer?: NodeJS.Timeout | null;             // Active setTimeout reference (30,000ms)
}
```

### 2.7 OpenRouteService Routing Info Schema (`backend/modules/routingService.js`)

```typescript
interface RouteInfo {
  distanceKm: number | null;                 // Road driving distance in km (rounded to 1 decimal place)
  durationMin: number | null;                // Driving duration in minutes (rounded to whole integer)
}
```

---

## 3. Real Function Signatures & Module Specifications

### 3.1 `backend/modules/distance.js`
- **`haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number`**
  Calculates great-circle distance between two GPS coordinates using the Haversine formula ($R = 6371$ km).

### 3.2 `backend/modules/severityClassifier.js`
- **`classifySeverity(symptomsText: string): { level: number, specialty: string }`**
  Scans lowercase `symptomsText` against `severityKeywords.json`. If matches exist, sorts by `level` ascending (lowest numerical level = highest urgency) and returns the top match `{ level, specialty }`. If no keyword matches, defaults to `{ level: 3, specialty: 'general' }`.

### 3.3 `backend/modules/ambulanceAllocator.js`
- **`findNearestFreeAmbulance(patientLocation: { lat: number, lng: number }, ambulanceList: Ambulance[]): Ambulance | null`**
  Filters ambulances where `status === 'free'`, computes `haversineDistanceKm` to `patientLocation`, and returns the nearest unit, or `null` if none are free.
- **`allocateAmbulance(ambulance: Ambulance, request: EmergencyRequest | string): void`**
  Sets `ambulance.status = 'assigned'`, assigns `ambulance.currentRequestId`, and sets `request.assignedAmbulanceId = ambulance.id`.
- **`unallocateAmbulance(ambulance: Ambulance | null, request: EmergencyRequest | null): void`**
  Sets `ambulance.status = 'free'`, `ambulance.currentRequestId = null`, and clears `request.assignedAmbulanceId = null`.

### 3.4 `backend/modules/hospitalMatcher.js`
- **`provisionalMatch(request: EmergencyRequest, hospitals: Hospital[]): Hospital | null`**
  Radius-cascading hospital search. Initial radius is `20` km if `request.locationSource === 'approximate'`, otherwise `10` km. Expands in steps of `10` km up to `100` km (`MAX_RADIUS_KM`). Filters hospitals within radius having `beds.ER.available > 0`. Sorts candidates within the first matching radius band by:
  1. `empanelled` (true before false)
  2. Haversine distance ascending
  Returns the top candidate or `null`.
- **`rematchWithSeverity(requestOrLoc: EmergencyRequest | { lat: number, lng: number }, requiredSpecialty: string, bedType: "ER" | "ICU", hospitals: Hospital[]): Hospital[]`**
  Evaluates all hospitals within `100` km (`MAX_RADIUS_KM`) having `beds[bedType].available > 0`. Sorts by:
  1. Specialty match: `specialties.includes(requiredSpecialty)`
  2. Empanelled status: `empanelled === true`
  3. Haversine distance ascending
  4. Bed availability descending: `beds[bedType].available`
  Returns all matching hospitals ranked.

### 3.5 `backend/modules/bedReservation.js`
- **`cancelPreviousHold(request: EmergencyRequest, store: Store): void`**
  If `request.activeHoldId` points to an existing pending hold, clears its `timer`, increments `hospital.beds[oldHold.bedType].available += 1`, marks hold status as `'expired'`, and resets `request.activeHoldId = null`.
- **`reserveBedProvisional(hospital: Hospital, bedType: "ER" | "ICU", request: EmergencyRequest, store: Store): BedHold`**
  Validates `hospital.beds[bedType].available > 0` (throws `Error('NoAvailabilityError')` if 0). Cancels any prior hold via `cancelPreviousHold()`. Decrements bed availability (`-1`). Creates new `BedHold` with `expiresAt = Date.now() + 30000`. Assigns `request.activeHoldId = holdId`, sets `request.provisionalHospitalId = hospital.id`, updates status to `'BED_HELD'`, and arms a 30,000ms `setTimeout` to call `releaseAndCascade(holdId, store)`.
- **`confirmReservation(holdId: string, store: Store): boolean`**
  Validates hold exists and is `'pending'`. Clears timer, marks hold `'confirmed'`, updates request status to `'BED_CONFIRMED'`, sets `request.confirmedHospitalId = hold.hospitalId`, `request.provisionalHospitalId = hold.hospitalId`, and clears `request.activeHoldId = null`. Returns `true` (or `false` if invalid/expired).
- **`releaseAndCascade(holdId: string, store: Store): void`**
  If hold is pending, clears timer, restores bed capacity (`+1`), marks hold `'expired'`. If `request.activeHoldId === holdId`:
  1. Updates request status to `'BED_HOLD_TIMED_OUT'`
  2. Clears `request.activeHoldId = null`
  3. Shifts the expired hospital out of `request.candidateHospitals`
  4. Increments `request.cascadeCount += 1`
  5. Iterates through remaining candidates (up to `MAX_CASCADES = 5`), attempting `reserveBedProvisional()`.
  6. If all candidates fail or list is empty, updates request status to `'NO_HOSPITAL_AVAILABLE'`.
- **Constants Exported**:
  - `HOLD_TIMEOUT_MS = 30000` (30 seconds)
  - `MAX_CASCADES = 5`

### 3.6 `backend/modules/requestQueue.js`
- **`resolveConflict(requestA: EmergencyRequest, requestB: EmergencyRequest): [EmergencyRequest, EmergencyRequest]`**
  Arbitrates concurrency between two requests:
  - If timestamp difference `|requestA.createdAt - requestB.createdAt| > 5000` ms, orders strictly FCFS by `createdAt`.
  - Within 5000ms (`CONFLICT_WINDOW_MS`), orders by `severityLevel` ascending (Level 1 before Level 3). If severity is equal, breaks tie using `createdAt`.
- **`enqueueRequest(request: EmergencyRequest, processCallback: (req: EmergencyRequest) => void): void`**
  Enqueues request into `pendingQueue`, schedules `processQueue()` with debounce/interval.
- **Constants Exported**:
  - `CONFLICT_WINDOW_MS = 5000` (5 seconds)

### 3.7 `backend/modules/routingService.js`
- **`async function getRouteInfo(originLat: number, originLng: number, destLat: number, destLng: number): Promise<RouteInfo>`**
  Queries OpenRouteService `POST https://api.openrouteservice.org/v2/directions/driving-car` with header `Authorization: process.env.ORS_API_KEY` and coordinates `[[originLng, originLat], [destLng, destLat]]`. Returns `{ distanceKm, durationMin }`. If `ORS_API_KEY` is undefined or the API fails, logs a warning and gracefully resolves `{ distanceKm: null, durationMin: null }`.

### 3.8 `backend/state/store.js`
- **`updateStatus(request: EmergencyRequest, newStatus: RequestStatus): void`**
  Mutates `request.status = newStatus`, initializes `request.statusLog` if missing, and appends `{ status: newStatus, at: Date.now() }`.
- **`resetStore(): void`**
  Clears all active hold `setTimeout` handles across `store.holds`, re-reads fresh seed JSON files for hospitals and ambulances, resets `store.requests = {}`, `store.holds = {}`, and `store.nextHoldId = 1`.

---

## 4. Real API Contracts (Verified Against Route Handlers)

Base URL: `http://localhost:8000/api`

### 4.1 Emergency Routes (`backend/routes/emergency.routes.js`)

#### `GET /api/emergency/requests` & `GET /api/emergency/`
- **Description**: Returns all requests currently stored in memory.
- **Success Response (200 OK)**:
```json
{
  "ok": true,
  "data": [ /* Array of EmergencyRequest objects */ ]
}
```

---

#### `POST /api/emergency/trigger`
- **Description**: Initiates emergency dispatch. Locks location, assigns nearest free ambulance, finds provisional ER hospital, and establishes an initial provisional ER bed hold.
- **Request Body**:
```json
{
  "lat": 13.0827,
  "lng": 80.2707,
  "locationSource": "gps" | "approximate"
}
```
- **Success Response (200 OK)**:
```json
{
  "ok": true,
  "data": {
    "requestId": "REQ1758441600000",
    "ambulance": {
      "id": "A001",
      "lat": 13.0800,
      "lng": 80.2700,
      "status": "assigned",
      "currentRequestId": "REQ1758441600000"
    },
    "provisionalHospital": {
      "id": "H001",
      "name": "Government General Hospital",
      "lat": 13.0827,
      "lng": 80.2707,
      "specialties": ["trauma", "cardiac", "general", "pediatric", "burns", "obstetric"],
      "beds": { "ER": { "total": 10, "available": 2 }, "ICU": { "total": 6, "available": 1 }, "General": { "total": 40, "available": 12 } },
      "empanelled": true,
      "lastUpdated": "2026-09-21T10:00:00Z"
    },
    "holdId": "HOLD1",
    "holdExpiresAt": 1758441630000,
    "routeInfo": {
      "distanceKm": 1.2,
      "durationMin": 4
    }
  }
}
```
- **Error Responses**:
  - No ambulance free:
    ```json
    { "ok": false, "data": null, "error": "NO_AMBULANCE_AVAILABLE" }
    ```
  - No hospital available in radius:
    ```json
    { "ok": true, "data": { "requestId": "REQ1758441600000", "ambulance": null, "provisionalHospital": null } }
    ```

---

#### `POST /api/emergency/:id/symptoms`
- **Description**: Submits patient symptoms text, classifies severity (1–4), determines required specialty and bed type (Level 1 $\rightarrow$ ICU, Levels 2–4 $\rightarrow$ ER), re-ranks hospitals across the 100km radius, cancels the initial trigger hold, and places a new provisional hold on the top-ranked facility.
- **Request Parameters**: `id` (e.g. `REQ1758441600000`)
- **Request Body**:
```json
{
  "symptomsText": "severe chest pain and unconscious"
}
```
- **Success Response (200 OK)**:
```json
{
  "ok": true,
  "data": {
    "severityLevel": 1,
    "requiredSpecialty": "cardiac",
    "rematchedHospitalRanked": [ /* Array of Hospital objects ranked by match criteria */ ],
    "holdId": "HOLD2",
    "holdExpiresAt": 1758441630000,
    "routeInfo": {
      "distanceKm": 1.2,
      "durationMin": 4
    }
  }
}
```
- **Error Responses**:
  - Request ID not found:
    ```json
    { "ok": false, "data": null, "error": "NOT_FOUND" }
    ```
  - No candidate hospital available:
    ```json
    { "ok": true, "data": { "severityLevel": 1, "requiredSpecialty": "cardiac", "rematchedHospitalRanked": [] } }
    ```

---

#### `POST /api/emergency/:id/confirm-hospital`
- **Description**: Confirms the active provisional bed hold, clearing the timeout timer and transitioning the hold and request to confirmed status.
- **Request Parameters**: `id`
- **Success Response (200 OK)**:
```json
{
  "ok": true,
  "data": {
    "status": "BED_CONFIRMED",
    "confirmedHospitalId": "H001"
  }
}
```
- **Error Responses**:
  - No active hold on request:
    ```json
    { "ok": false, "data": null, "error": "NO_ACTIVE_HOLD" }
    ```
  - Hold has already expired or is invalid:
    ```json
    { "ok": false, "data": null, "error": "HOLD_EXPIRED_OR_INVALID" }
    ```

---

#### `GET /api/emergency/:id/status`
- **Description**: Fetches the full current state and audit log of the emergency request.
- **Request Parameters**: `id`
- **Success Response (200 OK)**:
```json
{
  "ok": true,
  "data": {
    "id": "REQ1758441600000",
    "createdAt": 1758441600000,
    "patientLocation": { "lat": 13.0827, "lng": 80.2707 },
    "locationSource": "gps",
    "status": "BED_HELD",
    "symptomsText": "chest pain",
    "severityLevel": 1,
    "requiredSpecialty": "cardiac",
    "assignedAmbulanceId": "A001",
    "provisionalHospitalId": "H001",
    "confirmedHospitalId": null,
    "candidateHospitals": [ /* ranked candidates */ ],
    "activeHoldId": "HOLD2",
    "cascadeCount": 0,
    "statusLog": [
      { "status": "CREATED", "at": 1758441600000 },
      { "status": "LOCATION_CAPTURED", "at": 1758441600000 },
      { "status": "AMBULANCE_ALLOCATED", "at": 1758441600001 },
      { "status": "PROVISIONAL_HOSPITAL_MATCHED", "at": 1758441600002 },
      { "status": "BED_HELD", "at": 1758441600003 },
      { "status": "SYMPTOMS_RECEIVED", "at": 1758441605000 },
      { "status": "SEVERITY_CLASSIFIED", "at": 1758441605001 },
      { "status": "HOSPITAL_REMATCHED", "at": 1758441605002 },
      { "status": "BED_HELD", "at": 1758441605003 }
    ]
  }
}
```
- **Error Response**:
  - Request ID not found:
    ```json
    { "ok": false, "data": null, "error": "NOT_FOUND" }
    ```

---

### 4.2 Resource & Simulation Routes

#### `GET /api/hospitals` (`backend/routes/hospitals.routes.js`)
- **Success Response (200 OK)**:
```json
{
  "ok": true,
  "data": [ /* Array of all 22 Hospital objects with live bed counts */ ]
}
```

#### `GET /api/ambulances` (`backend/routes/ambulances.routes.js`)
- **Success Response (200 OK)**:
```json
{
  "ok": true,
  "data": [ /* Array of all 10 Ambulance objects with status and currentRequestId */ ]
}
```

#### `POST /api/simulate/reset` (`backend/routes/simulate.routes.js`)
- **Description**: Resets in-memory state, cancels pending hold timers, and re-loads seed data.
- **Success Response (200 OK)**:
```json
{
  "ok": true,
  "message": "State re-seeded successfully"
}
```

---

## 5. As-Coded Request & Status State Machine

### 5.1 Exact Status String Values
The system defines and transitions through exactly 12 status values across `store.updateStatus()`:
1. `CREATED`
2. `LOCATION_CAPTURED`
3. `AMBULANCE_ALLOCATED`
4. `PROVISIONAL_HOSPITAL_MATCHED`
5. `SYMPTOMS_RECEIVED`
6. `SEVERITY_CLASSIFIED`
7. `HOSPITAL_REMATCHED`
8. `BED_HELD`
9. `BED_CONFIRMED`
10. `BED_HOLD_TIMED_OUT`
11. `NO_HOSPITAL_AVAILABLE`
12. `NO_AMBULANCE_AVAILABLE`

### 5.2 Transition Lifecycle Diagram

```text
[POST /trigger]
      │
      ▼
   CREATED
      │
      ▼
LOCATION_CAPTURED
      │
      ├── (No free ambulance) ──────────────────────────► NO_AMBULANCE_AVAILABLE [Terminal]
      ▼
AMBULANCE_ALLOCATED
      │
      ├── (No ER hospital in 10-100km) ────────────────► NO_HOSPITAL_AVAILABLE  [Terminal]
      ▼                                                  (Ambulance unallocated)
PROVISIONAL_HOSPITAL_MATCHED
      │
      ▼
   BED_HELD (Initial ER hold HOLD1 created, 30s timer started)
      │
      │  [POST /:id/symptoms]
      ▼
SYMPTOMS_RECEIVED
      │
      ▼
SEVERITY_CLASSIFIED (Level 1-4, BedType ICU/ER)
      │
      ▼
HOSPITAL_REMATCHED
      │
      ├── (0 candidates in 100km) ─────────────────────► NO_HOSPITAL_AVAILABLE  [Terminal]
      ▼
   BED_HELD (Previous hold HOLD1 released; new HOLD2 created, new 30s timer)
      │
      ├───────────────────────────────┐
      │ [POST /:id/confirm-hospital]  │ [Timer expires after 30s]
      ▼                               ▼
BED_CONFIRMED [Terminal Success]  BED_HOLD_TIMED_OUT
                                      │
                                      ├── (Has next candidate in candidateHospitals)
                                      │   ▼
                                      │  BED_HELD (Cascaded hold placed, new 30s timer)
                                      │
                                      └── (Exhausted candidates / cascadeCount > 5)
                                          ▼
                                      NO_HOSPITAL_AVAILABLE [Terminal Failure]
```

---

## 6. Frontend Architecture & Flow

### 6.1 Framework & Stack
- **Framework**: React 19 + TypeScript + Vite 7 + Wouter (client-side routing)
- **Styling**: TailwindCSS v4 with dark/light variables in `frontend/client/src/index.css`
- **Component Primitives**: Radix UI primitives with Lucide icons

### 6.2 Application Component Structure
- `App.tsx`: Sets up `ThemeProvider`, `TooltipProvider`, `Toaster` (Sonner), and `Switch` router targeting `Home.tsx` and `NotFound.tsx`.
- `pages/Home.tsx`: Single-page coordination console containing:
  - Header with clock, live indicator, and `Reset Demo` button
  - **Step 1 Card**: Lat/Lng input + Location Source toggle (GPS vs Approximate) + `Trigger Emergency` button
  - **Two-Column Resource Grid**:
    - Left: Ambulance ID, status badge, coordinates, and simulated en-route progress bar
    - Right: Hospital name, PM-JAY empanelled badge, driving distance & duration (from ORS), and specialty badge
  - **Bed Hold Banner & Countdown**: 30-second ticking countdown (`holdExpiresAt - Date.now()`) with color transitions (`safe` $> 20$s $\rightarrow$ `warning` $10-20$s $\rightarrow$ `urgent` $< 10$s $\rightarrow$ `expired` $\le 0$s)
  - **Confirm Hospital Button**: Submits `POST /:id/confirm-hospital` to secure bed
  - **Step 2 Card**: Symptoms text area + `Submit Symptoms` button
  - **Step 3 / Match Card**: Severity indicator (Level 1–4), Bed type, required specialty, and interactive ranked hospital table with distance/ETA and specialty badges
  - **Patient Brief Panel**: Request ID, formatted status, location source, and relative time
  - **Audit Trail Timeline**: Accordion showing full history of status changes from `statusLog` with relative timestamps

### 6.3 Polling & State Synchronization
- **Poll Interval**: 2000ms (`setInterval`) when `isPolling === true && requestId !== null`.
- **Endpoint**: `GET /api/emergency/${requestId}/status`.
- **Hold Expiry Synchronization**: When the polled `data.activeHoldId` differs from `prevHoldId` in state (e.g. on cascade), the countdown is re-synchronized using the newest `BED_HELD` event in `statusLog` (`latestBedHeld.at + 30000`).
- **Terminal Polling Termination**: Polling automatically stops if status reaches `BED_CONFIRMED`, `NO_HOSPITAL_AVAILABLE`, or `NO_AMBULANCE_AVAILABLE`.

---

## 7. Deviations from Spec

The following items represent discrepancies between original project specifications / conceptual designs and the actual code as built:

1. **Early Bed Reservation on Initial Trigger**:
   - *Spec*: Ambulance-first dispatch was conceived to dispatch an ambulance immediately on trigger, capturing symptoms in parallel *before* locking a specific hospital bed reservation.
   - *Actual Code* (`emergency.routes.js:61-67`): On `POST /trigger`, the system immediately calls `reserveBedProvisional(hospital, 'ER', request, store)`. This places an ER bed hold (`HOLD1`) and starts a 30s countdown before symptoms are even submitted. When `POST /:id/symptoms` is subsequently called, `reserveBedProvisional` must cancel and release this initial ER bed hold before creating a second hold (ICU or ER).

2. **Ambulance De-allocation on Hospital Unavailability**:
   - *Spec*: Ambulance allocation was intended to be independent of hospital availability during initial dispatch.
   - *Actual Code* (`emergency.routes.js:52-56`): If `provisionalMatch` finds no ER hospital within 100km during `POST /trigger`, the code invokes `unallocateAmbulance(ambulance, request)` and marks the request as `NO_HOSPITAL_AVAILABLE`, canceling the ambulance dispatch entirely.

3. **Unused Request Queue (`requestQueue.js`) / Concurrency Tiebreak Bypassed at API Layer**:
   - *Spec*: Two concurrent requests arriving within 5000ms competing for a single bed should be arbitrated using FCFS with severity tiebreak (Level 1 takes priority over Level 3).
   - *Actual Code*: While `backend/modules/requestQueue.js` provides `resolveConflict()` and `enqueueRequest()`, and is imported in `emergency.routes.js:8`, **neither function is invoked in `emergency.routes.js`**. All bed reservations in `POST /trigger` and `POST /:id/symptoms` execute immediately and synchronously. The 5-second queue arbitration is present in module code and tested in unit tests, but bypassed in the HTTP route handlers.

4. **Radius Cascading Omitted in Severity Rematching**:
   - *Spec*: The hospital search should expand in 10km radius increments up to 100km to find the closest appropriate facility.
   - *Actual Code* (`hospitalMatcher.js:22-60`): `provisionalMatch()` implements the 10km step loop, but `rematchWithSeverity()` does **not** loop across radius steps. It queries all hospitals within `100` km at once and sorts them globally by specialty match, then empanelment, then distance. Consequently, a hospital 90km away with the required specialty will rank ahead of an empanelled hospital 5km away without the specialty.

5. **API Response Contract Discrepancies vs `docs/api-contracts.md`**:
   - `POST /trigger`: Returns `holdId`, `holdExpiresAt`, and `routeInfo` in `data`, which were omitted in `docs/api-contracts.md`.
   - `POST /:id/symptoms`: Returns `routeInfo` from OpenRouteService for the top candidate, which was not documented in `docs/api-contracts.md`.
   - `GET /api/emergency/requests`: Implemented at line 12 of `emergency.routes.js`, but missing from `docs/api-contracts.md`.

6. **Frontend Map Component Not Mounted**:
   - *Code*: `frontend/client/src/components/Map.tsx` provides a full Google Maps JS API integration using the Forge proxy.
   - *Actual UI*: `frontend/client/src/pages/Home.tsx` does not render `MapView` or any Google Maps canvas. The interface is entirely composed of coordinate badges, progress bars, and status cards.

7. **OpenRouteService API Key Requirement**:
   - *Code*: `backend/modules/routingService.js` expects `ORS_API_KEY` in `backend/.env`. If unset, it returns `{ distanceKm: null, durationMin: null }`, and the frontend gracefully displays `"Distance unavailable"`.

---

## 8. Future: Hardware Integration Note

An in-ambulance IoT hardware unit (comprising an ESP32 microcontroller, GPS receiver, patient vital sensors [SpO2/HR/ECG], and a 4G LTE cellular uplink) will later report telemetry into a dedicated `vitals` data field on the `EmergencyRequest` and a hardware-reporting endpoint (e.g. `POST /api/emergency/:id/vitals` or telemetry ingestion webhook). Hardware integration code and endpoints are intentionally omitted from this run.
