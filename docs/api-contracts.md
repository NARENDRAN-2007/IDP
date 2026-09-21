# Emergency Response Platform — API Contracts

Base URL: `http://localhost:8000/api`

## 1. Emergency Routes (`/api/emergency`)

### `POST /trigger`
**Request Body:**
```json
{
  "lat": 13.0827,
  "lng": 80.2707,
  "locationSource": "gps" | "approximate"
}
```
**Response (Success):**
```json
{
  "ok": true,
  "data": {
    "requestId": "REQ1758441600000",
    "ambulance": { "id": "A001", "lat": 13.0800, "lng": 80.2700, "status": "assigned" },
    "provisionalHospital": { "id": "H001", "name": "Government General Hospital" }
  }
}
```

---

### `POST /:id/symptoms`
**Request Body:**
```json
{
  "symptomsText": "severe chest pain and unconscious"
}
```
**Response (Success):**
```json
{
  "ok": true,
  "data": {
    "severityLevel": 1,
    "requiredSpecialty": "cardiac",
    "rematchedHospitalRanked": [ ... ],
    "holdId": "HOLD1",
    "holdExpiresAt": 1758441630000
  }
}
```

---

### `POST /:id/confirm-hospital`
**Response (Success):**
```json
{
  "ok": true,
  "data": {
    "status": "BED_CONFIRMED",
    "confirmedHospitalId": "H001"
  }
}
```

---

### `GET /:id/status`
**Response:**
```json
{
  "ok": true,
  "data": {
    "id": "REQ1758441600000",
    "status": "BED_HELD",
    "patientLocation": { "lat": 13.0827, "lng": 80.2707 },
    "activeHoldId": "HOLD1",
    "statusLog": [ ... ]
  }
}
```

---

## 2. Resource Routes

- `GET /api/hospitals`: List all hospitals & bed capacities.
- `GET /api/ambulances`: List all ambulance units & statuses.
- `POST /api/simulate/reset`: Re-seed in-memory store state.
