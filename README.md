# Availability-Aware Emergency Response & Bed Reservation Platform Backend

An availability-aware emergency dispatch platform featuring provisional hospital bed reservations with auto-expiring timeouts and multi-hospital cascades. Real-time ER/ICU capacity and specialty matching override simple geographical proximity.

## Key Features

- **Provisional Hold & Auto-Cascade**: 30-second provisional bed hold preventing double bookings while cascading to secondary facilities if unconfirmed.
- **Specialty & Severity Routing**: Natural language symptom processing maps emergencies to Level 1–4 severity, routing ICU/ER beds accordingly.
- **PM-JAY Empanelment Priority**: Prioritizes empanelled hospitals for initial dispatch.
- **Dynamic Radius Expansion**: Expands search grid in 10km steps (up to 100km) to ensure bed location.

## API Architecture

```text
emergency-response-platform/
├── .gitignore
├── README.md
├── backend/
│   ├── .env
│   ├── package.json
│   ├── server.js
│   ├── test-scenarios.js
│   ├── data/
│   │   ├── hospitals.seed.json (22 hospital units)
│   │   ├── ambulances.seed.json (10 ambulance units)
│   │   └── severityKeywords.json
│   ├── state/
│   │   └── store.js
│   ├── modules/
│   │   ├── distance.js
│   │   ├── severityClassifier.js
│   │   ├── ambulanceAllocator.js
│   │   ├── hospitalMatcher.js
│   │   ├── bedReservation.js
│   │   └── requestQueue.js
│   └── routes/
│       ├── emergency.routes.js
│       ├── hospitals.routes.js
│       ├── ambulances.routes.js
│       └── simulate.routes.js
└── docs/
    ├── test-scenarios.md
    ├── api-contracts.md
    └── data-schemas.md
```

## Getting Started

### 1. Start Backend Server
```bash
cd backend
npm install
npm start
```
The backend server starts on `http://localhost:8000`.

### 2. Run Verification Tests
```bash
cd backend
node test-scenarios.js
```
