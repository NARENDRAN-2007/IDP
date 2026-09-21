# Emergency Response Platform — Data Schemas

## 1. Hospital Schema (`hospitals.seed.json`)
```json
{
  "id": "H001",
  "name": "Government General Hospital",
  "lat": 13.0827,
  "lng": 80.2707,
  "specialties": ["trauma", "cardiac", "general", "pediatric", "burns", "obstetric"],
  "beds": {
    "ER":      { "total": 10, "available": 3 },
    "ICU":     { "total": 6,  "available": 1 },
    "General": { "total": 40, "available": 12 }
  },
  "empanelled": true,
  "lastUpdated": "2026-09-21T10:00:00Z"
}
```

## 2. Ambulance Schema (`ambulances.seed.json`)
```json
{
  "id": "A001",
  "lat": 13.0500,
  "lng": 80.2200,
  "status": "free" | "assigned",
  "currentRequestId": "REQ0001" | null
}
```

## 3. Emergency Request Schema (`store.requests[id]`)
```json
{
  "id": "REQ0001",
  "createdAt": 1758441600000,
  "patientLocation": { "lat": 13.06, "lng": 80.25 },
  "locationSource": "gps" | "approximate",
  "status": "CREATED" | "LOCATION_CAPTURED" | "AMBULANCE_ALLOCATED" | "PROVISIONAL_HOSPITAL_MATCHED" | "SYMPTOMS_RECEIVED" | "SEVERITY_CLASSIFIED" | "HOSPITAL_REMATCHED" | "BED_HELD" | "BED_CONFIRMED" | "BED_HOLD_TIMED_OUT" | "NO_HOSPITAL_AVAILABLE" | "NO_AMBULANCE_AVAILABLE",
  "symptomsText": "chest pain",
  "severityLevel": 1,
  "requiredSpecialty": "cardiac",
  "assignedAmbulanceId": "A001",
  "provisionalHospitalId": "H001",
  "confirmedHospitalId": "H001",
  "candidateHospitals": [],
  "activeHoldId": "HOLD1",
  "cascadeCount": 0,
  "statusLog": [{ "status": "CREATED", "at": 1758441600000 }]
}
```

## 4. Bed Hold Schema (`store.holds[holdId]`)
```json
{
  "holdId": "HOLD1",
  "requestId": "REQ0001",
  "hospitalId": "H001",
  "bedType": "ER" | "ICU",
  "createdAt": 1758441600000,
  "expiresAt": 1758441630000,
  "status": "pending" | "confirmed" | "expired"
}
```
