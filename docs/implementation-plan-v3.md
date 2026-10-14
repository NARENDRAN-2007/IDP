# Availability-Aware Emergency Response & Bed Reservation Platform
## Complete Implementation Plan (v3: Hospital + Ambulance Dashboards in Active Build Scope)

> **Scope:** Chennai metropolitan area. 22 hospitals, 10 ambulances, 4 role-based dashboards (Patient, Ambulance, Hospital, DevOps), and an in-ambulance ESP32 unit for live location and patient vitals.
>
> **Assumptions made in this plan (change if wrong):**
> 1. Device uplink starts as **HTTPS POST** (simplest with the SIM7600). Topic and payload design are MQTT-ready, so migrating later is easy.
> 2. The frontend is **one React app with four role-based route trees**, sharing components (reuses the existing React 19 + Vite + Tailwind v4 + shadcn stack).
> 3. Vitals are **HR and SpO2 only** (MAX30102). No ECG sensor is in the hardware list.
> 4. Vitals readings are labeled **non-clinical / demo-grade** everywhere they are displayed.
>
> **Current build focus (this revision):** Only the **Hospital dashboard** and **Ambulance dashboard** are in active build scope. The **Patient dashboard** and **DevOps dashboard** remain fully designed in this document — nothing about them is deleted or deprioritized in design quality — but neither is being built right now. Every piece of backend, data model, and real-time infrastructure that Hospital and Ambulance depend on (auth, device ingest, hold lifecycle, Socket.IO rooms for those two roles, the simulator) is in scope. Work that exists only to serve Patient or DevOps (patient-facing SOS UI, ticketing UI, fleet-wide DevOps views) is explicitly deferred. Each section below marks what's active vs. deferred where it matters.

---

## Table of Contents
1. Project summary
2. Pre-review corrections (doc vs. code mismatches)
3. System architecture
4. Hardware plan
5. Backend plan
6. Data model
7. API specification
8. Real-time layer (Socket.IO)
9. Dashboard specifications
10. How the four dashboards connect
11. End-to-end scenarios
12. DevOps: alerts, errors, tickets
13. Security and privacy
14. Repository structure
15. Testing plan
16. Phased build plan
17. Demo plan and fallbacks
18. Risks and mitigations
19. Open decisions

---

## 1. Project summary

### 1.1 Problem
Emergency apps usually route patients to the *nearest* hospital with no knowledge of bed capacity, specialty, or scheme empanelment. Ambulances arrive at full hospitals, and time is lost.

### 1.2 Solution
An availability-aware dispatch platform that:
1. Dispatches the nearest free ambulance.
2. Finds a hospital with a free bed that matches the patient's severity and specialty.
3. **Holds the bed for 30 seconds** (provisional hold), and **cascades automatically** to the next hospital if unconfirmed.
4. Streams live ambulance location and patient vitals to the hospital before arrival.
5. Gives each stakeholder (patient, driver, hospital staff, operations) a dedicated dashboard over one shared backend.

### 1.3 Current state (as built)
- Node.js/Express backend, in-memory store, 7 core modules, 5 passing test scenarios.
- React dashboard (single operations console), polling every 2 s.
- No persistence, no auth, no real-time push, no hardware, and the request queue is designed but **not yet wired into the routes** (see 5.3).

### 1.4 Target state
Persistent, authenticated, real-time, multi-role platform with live hardware telemetry and an operations/ticketing console.

**For this build phase**, "target state" narrows to: Hospital and Ambulance dashboards fully functional, authenticated, real-time, and backed by persistent storage — including everything they depend on (device ingest, hold lifecycle, matching). Patient and DevOps reaching this same target state is future work, not this phase's exit criteria.

### 1.5 Core algorithms (retained)
| Module | Algorithm |
|---|---|
| `distance.js` | Haversine great-circle distance (R = 6371 km) — used for fast candidate filtering; final route and ETA come from `routingService.js` (OpenRouteService), not instead of it |
| `severityClassifier.js` | Rule-based keyword classifier: keyword substring match, lowest level number wins, default level 3 / general |
| `ambulanceAllocator.js` | Nearest free ambulance by Haversine |
| `hospitalMatcher.js` | `provisionalMatch`: radius cascade 10 km (20 km if approximate) up to 100 km, sort by empanelled then distance. `rematchWithSeverity`: **radius-loop ranking (fix per 5.4, Option A)** — iterate 10 km bands up to 100 km; within each band, sort by specialty match, empanelled, distance, beds; return as soon as a band has candidates. **Known limitation:** a strong match just outside a band boundary can still lose to a weaker match just inside it — see 5.4 |
| `bedReservation.js` | Provisional hold (30 s), confirm, release-and-cascade (max 5) — the ER hold placed at trigger time is an intentional design choice, see 5.6. Atomicity model specified in 5.3a |
| `requestQueue.js` | 5 s conflict window, FCFS outside it, severity tiebreak inside it. **Designed but not yet wired into the live request routes** — see 5.3 for the wiring plan |
| `routingService.js` | OpenRouteService distance/ETA with graceful null fallback |

---

## 2. Pre-review corrections (doc vs. code mismatches)

Fix these before any panel review. A reviewer reading the code will find them.

| # | Documentation claims | Code actually does | Fix |
|---|---|---|---|
| 1 | The 5 s queue resolves two patients competing for the last ICU bed | `requestQueue.js` is imported but **never called** in `emergency.routes.js` | Wire `enqueueRequest` / `resolveConflict` into `trigger` and `symptoms` (see 5.3) |
| 2 | Dynamic radius expansion applies to ranking | `rematchWithSeverity` queries all 100 km at once; a 90 km specialty hospital can outrank a 5 km empanelled one | Loop radius bands in rematch, or add a distance penalty (see 5.4) |
| 3 | "NLP classifier" | Rule-based keyword matching | Call it a *rule-based classifier* |
| 4 | Level 1 examples include "cardiac arrest" | Keyword is not in `severityKeywords.json` | Expand the dictionary (see 5.5) |
| 5 | Level 2-4 specialty is Orthopedics | Dictionary maps fracture to `general` | Align doc and data — standardize on `general` |
| 6 | Haversine used *instead of* a navigation API | OpenRouteService is also used for ETA | Reword: Haversine for fast filtering, ORS for final route and ETA |
| 7 | Early bed hold is not described | An ER hold is placed at trigger time, before symptoms | Document as a deliberate design choice (see 5.6) |
| 8 | `docs/api-contracts.md` | Missing `holdId`, `holdExpiresAt`, `routeInfo`, and `GET /emergency/requests` | Update docs (in this document, reflected in Section 7) |
| 9 | Hardware spec mentions ECG | Hardware list has no ECG sensor | Remove ECG from spec |
| 10 | `Map.tsx` exists | Not mounted anywhere | Mount in Patient, Ambulance, Hospital, DevOps dashboards (**this build: Ambulance and Hospital only — see 9**) |

### 2.11 Known Functional Gaps

Gaps carried over from the prior revision, plus two newly surfaced and addressed in this one.

1. **Request queue not wired in (relates to row 1, Section 5.3).** Still open. This is in active scope for this build, since concurrent-bed conflicts are a Hospital-dashboard-visible problem (`QUEUE_PRIORITIZED` shows in the audit trail the hospital sees).
2. **Rematch ranking is flat, not radius-looped (relates to row 2, Section 5.4).** The radius-loop fix is in active scope. Its own residual band-edge limitation is now documented inline in 1.5 and 5.4 rather than left implicit.
3. **Severity dictionary is missing key Level 1 keywords (relates to row 4, Section 5.5).** Still open, in active scope — the Ambulance dashboard's paramedic-submitted symptoms depend on this classifier.
4. **Fracture specialty mapping (relates to row 5, Section 5.5/6.1).** Standardized on `general`. Not in active scope to change further.
5. **`Map.tsx` is not mounted anywhere (relates to row 10, Section 9, 10.4).** In active scope for Ambulance and Hospital only this phase; mounting it into Patient and DevOps is deferred along with those dashboards.
6. **ECG is out of scope; MAX30102 is the only vitals source.** Unchanged, not a gap requiring action.
7. **Contradiction, not resolved:** whether `provisionalMatch`'s "empanelled then distance" ordering (no specialty term) is intentional, given symptoms aren't known yet at trigger time, or itself needs the same ranking review as row 2. Still unresolved — noted here rather than guessed. This directly affects the Hospital dashboard's incoming board (which hospital shows up first, before symptoms arrive), so it should be settled before Phase 4 build work, not after.
8. **Newly surfaced: cross-store hold atomicity was unspecified.** Earlier revisions asserted holds "must be atomic" (5.3, 5.6, 5.7, 18) without saying how that holds across two separate stores (Postgres for `bed_holds`/bed counts, Redis for hold-expiry timers). **Resolved in this revision** — see 5.3a. Postgres is now the sole source of truth for hold status; Redis/BullMQ is demoted to a scheduling trigger only. Flagging here because this was a real gap in the design, not just wording.
9. **Newly surfaced: `doctors_on_duty` was modeled, editable, and displayed, but never used by matching.** **Resolved in this revision** — see 6.1 and 9.3. It's now explicitly documented as informational-only (hospital staff prep context), not a matching input. If future work wants it to affect matching, that's a new change, not a bug fix.
10. **SOS trigger security, rate limiting, and Patient-facing auth remain open**, but are **deliberately out of this phase's scope** since the Patient dashboard isn't being built. The `POST /api/emergency/trigger` endpoint still exists (Hospital and Ambulance both depend on requests entering the system somehow), but for this phase it's driven by the simulator (4.7) or a minimal internal test trigger, not a public patient-facing form — see 11, 13, 17.1. This must be revisited before any patient-facing deployment.

---

## 3. System architecture

```
┌─────────────────────── AMBULANCE UNIT ───────────────────────┐
│ ESP32 ── UART1 ── NEO-6M (GPS)                               │
│   │── I2C ── MAX30102 (HR/SpO2) + OLED 0.96"                 │
│   └── UART2 ── SIM7600/7670 (4G) ───────────┐                │
└─────────────────────────────────────────────┼────────────────┘
                                              │ HTTPS (MQTT-ready)
                                              ▼
┌──────────────────────── BACKEND (Node/Express) ───────────────────────┐
│ Device ingest │ REST API │ Socket.IO hub │ Core modules (7)            │
│ Auth/RBAC │ Alert engine │ Ticket service │ Hold-timer worker          │
└───────┬───────────────────────────────┬────────────────────────────────┘
        ▼                               ▼
   PostgreSQL (persistent)         Redis (live state, hold timers, locks, pub/sub)
        ▲
        │ REST + Socket.IO rooms
 ┌──────┴────────┬───────────────┬──────────────┬──────────────┐
 │ Patient       │ Ambulance     │ Hospital     │ DevOps       │
 │ dashboard     │ dashboard     │ dashboard    │ dashboard    │
 │ (deferred)    │ (ACTIVE)      │ (ACTIVE)     │ (deferred)   │
 └───────────────┴───────────────┴──────────────┴──────────────┘
```

**Principle:** dashboards never talk to each other. All communication goes through the backend, which is the single source of truth and pushes events only to the rooms that need them.

### 3.1 Technology stack
| Layer | Choice |
|---|---|
| Backend | Node.js 20+, Express |
| Real-time | Socket.IO (rooms) — this phase: `ambulance:{id}` and `hospital:{id}` rooms active; `devops` room deferred |
| Database | PostgreSQL — sole source of truth for hold/bed state (5.3a) |
| Cache / locks / timers | Redis (+ BullMQ for delayed jobs) — scheduling trigger only, not a second source of truth (5.3a) |
| Auth | JWT (access + refresh), role-based access control — this phase: `driver` and `hospital_staff` roles active; `patient` and `devops` roles deferred |
| Device link | HTTPS POST (phase 1), MQTT over TLS (optional later) |
| Frontend | React 19, TypeScript, Vite, Tailwind v4, shadcn/Radix, Wouter |
| Maps | Google Maps JS API via existing `Map.tsx` (or Leaflet + OSM as a free alternative) — **mounting in progress for Ambulance and Hospital dashboards this phase; Patient/DevOps mounting deferred** |
| Routing/ETA | OpenRouteService — used alongside Haversine (fast filtering), not as a replacement for it |
| Firmware | ESP32 Arduino framework (C++), TinyGSM, ArduinoJson, TinyGPS++ |
| Logging | pino (structured JSON) |

---

## 4. Hardware plan

*Hardware is in active scope this phase: the Ambulance dashboard's vitals panel and device-status widgets depend on it (or the simulator as a stand-in).*

### 4.1 Bill of materials
| Component | Qty | Purpose |
|---|---|---|
| ESP32 DevKit V1 (WROOM-32) | 1 | Main controller |
| MAX30102 | 1 | Heart rate and SpO2 (only vitals sensor in scope — no ECG) |
| NEO-6M GPS module | 1 | Ambulance location |
| SIM7600 / SIM7670 4G module | 1 | Cellular uplink |
| SIM card with data | 1 | Internet connectivity |
| 0.96" I2C OLED | 1 | Local display of HR, SpO2, status |
| Breadboard | 1 | Prototyping |
| Jumper wires | 1 set | Connections |
| USB cable | 1 | Programming and power |
| 5V power bank | 1 | Portable power |

**Recommended additions:** 1000 µF electrolytic capacitor (near the SIM module), a 5V/2A supply for the SIM module, a small enclosure, and a status LED.

### 4.2 Wiring (suggested pins; verify against your module's silkscreen)
| Module | Interface | ESP32 pins | Notes |
|---|---|---|---|
| NEO-6M | UART1 | RX=16, TX=17 | Needs open sky; cold start can take 1-2 min |
| SIM7600/7670 | UART2 | RX=26, TX=27, PWRKEY=GPIO 4 | Control with AT commands via TinyGSM |
| MAX30102 | I2C 0x57 | SDA=21, SCL=22 | 3.3 V logic |
| OLED | I2C 0x3C | SDA=21, SCL=22 | Shares the I2C bus |
| Status LED | GPIO | GPIO 2 | Blink patterns for state |

### 4.3 Hardware risks to handle
1. **Power:** the SIM7600 draws current spikes of about 2 A during transmission. A weak power bank or breadboard rail causes random resets. Use a 5V/2A source, a 1000 µF capacitor near the module, and short thick wires.
2. **MAX30102 accuracy:** finger-based, demo-grade. Label as non-clinical.
3. **GPS indoors:** no fix. Demo outdoors or use the simulator.
4. **SIM7600 variants:** some include built-in GNSS, which can serve as a backup location source.
5. **Signal:** 4G coverage varies. Firmware must buffer offline.

### 4.4 Firmware design

**Tasks (FreeRTOS or cooperative loop):**
| Task | Rate | Behavior |
|---|---|---|
| GPS read | 1 Hz | Parse NMEA, keep last good fix |
| Vitals read | 1 Hz (only when patient flag on) | Compute HR/SpO2 from MAX30102, validity flag |
| Telemetry send | location every 3 s, vitals every 2 s | Batch and POST |
| Heartbeat | every 15 s | Battery, RSSI, GPS fix, uptime, firmware version |
| OLED refresh | 1 Hz | Show HR, SpO2, GPS fix, link status |
| Command poll | every 5 s (HTTP) or subscription (MQTT) | Receive `patient_onboard` and `patient_offboard` commands |

**Behavior rules:**
- **Offline buffer:** ring buffer of recent readings in RAM (and optionally SPIFFS). Flush in order on reconnect, marking `buffered: true`.
- **GPS loss:** send last known position with `stale: true`.
- **Device auth:** each unit has a unique `deviceId` and secret (HTTPS bearer token or MQTT credentials) tied to one `ambulanceId`.
- **Watchdog:** hardware watchdog to recover from hangs.
- **OTA updates:** optional later phase.
- **Vitals only attach to a request** after the backend sends `patient_onboard {requestId}`.

### 4.5 Device API (phase 1: HTTPS)
All requests carry `Authorization: Bearer <device-token>`.

| Endpoint | Rate | Payload |
|---|---|---|
| `POST /api/device/location` | 3 s | `{ambulanceId, lat, lng, speed, heading, ts, stale}` |
| `POST /api/device/vitals` | 2 s while patient on board | `{ambulanceId, requestId, hr, spo2, valid, ts}` (MAX30102 only — no ECG channel) |
| `POST /api/device/heartbeat` | 15 s | `{ambulanceId, battery, rssi, gpsFix, fw, uptime}` |
| `GET /api/device/commands` | 5 s | Returns pending commands, e.g. `{type:"patient_onboard", requestId}` |
| `POST /api/device/batch` | on reconnect | Array of buffered readings |

### 4.6 MQTT-ready topic map (for later migration)
| Topic | Direction |
|---|---|
| `amb/{id}/location` | device → backend |
| `amb/{id}/vitals` | device → backend |
| `amb/{id}/heartbeat` | device → backend |
| `amb/{id}/cmd` | backend → device |

### 4.7 Simulator (build early)
A software ambulance that replays a route through the same device endpoints. Provide:
- `POST /api/simulate/ambulance-gps` (starts a route for a given ambulance toward a target)
- A scripted vitals generator (normal, deteriorating, spike)

**This phase, the simulator also stands in for the Patient dashboard**: `POST /api/simulate/load` (4.7, 7.7) is how test SOS requests enter the system for Hospital/Ambulance testing, since the real patient-facing trigger UI isn't being built yet (see 2.11 gap 10). This lets every in-scope dashboard be developed and demoed without hardware, and is the live-demo fallback.

---

## 5. Backend plan

### 5.1 What stays
All seven modules are kept. The changes are around them: persistence, locking, real-time, auth.

### 5.2 Required changes
| Area | Current | Target |
|---|---|---|
| Storage | In-memory `store.js` | PostgreSQL for entities, Redis for live state |
| Hold timers | `setTimeout` (lost on restart) | Redis expiring keys or BullMQ delayed jobs, restored on boot |
| Concurrency | Immediate, unsynchronized (queue not yet wired in) | Request queue wired in; atomic bed decrement in a DB transaction (`SELECT ... FOR UPDATE`) — see 5.3a for the full consistency model |
| Updates | Client polls every 2 s | Socket.IO push |
| Auth | None | JWT + roles + device tokens — this phase: `driver`, `hospital_staff`, and device tokens active; `patient`, `devops` deferred |
| Hospital data | Seed JSON | Editable by hospital staff, seed used only for initialization |
| Error handling | Ad hoc | Central Express error handler and structured logging |

### 5.3 Wiring the request queue

**Status: designed but not yet wired into the live routes** (see 2.11, gap 1). The flow below is the target wiring, not current behavior. **In active scope for this phase** — the Hospital dashboard's audit trail and the Ambulance dashboard's reassignment alerts both depend on queue arbitration actually running.

```text
POST /trigger or /symptoms
   └─> enqueueRequest(request, processCallback)
         └─> resolveConflict(a, b) for requests within 5 s
               └─> process in resolved order:
                     allocate ambulance -> match hospital -> atomic bed hold
```
Requirements:
- The bed decrement and hold creation must be one **atomic** operation, so two requests can never take the same last bed.
- Log the arbitration outcome in `request_status_log` (for example `QUEUE_PRIORITIZED`), so it is visible in the audit trail and demonstrable.

### 5.3a Hold/bed atomicity model (new this revision)

Earlier revisions asserted holds "must be atomic" in several places without specifying how that holds across two stores. This is now resolved, since it directly affects whether the Hospital dashboard's bed counts can ever be trusted:

- **PostgreSQL is the single source of truth for hold and bed state.** The hold's `status` (`pending`/`confirmed`/`expired`/`consumed`/`released`) and the `hospital_beds.available` decrement are written in the **same DB transaction**, using `SELECT ... FOR UPDATE` on the bed row. No other store is authoritative over this state.
- **Redis/BullMQ is a scheduling trigger only**, not a second copy of hold state. A BullMQ delayed job is enqueued alongside the DB transaction purely to wake a worker at `expiresAt`. When that job fires, the worker re-reads the hold's current status from Postgres before acting — if the hold was already confirmed or released by the time the timer fires, the worker is a no-op. This means a lost or duplicated Redis job can delay or double-trigger a *check*, but can never itself corrupt bed state, because all actual state changes still go through the Postgres transaction.
- **Restart recovery (5.7)** follows the same rule: on boot, the worker queries Postgres for `bed_holds` rows with `status = 'pending'` and re-arms BullMQ timers from that — Postgres is the one source rebuilt from, never the reverse.
- This resolves 2.11 gap 8 and should be treated as a firm constraint on implementation, not a suggestion.

### 5.4 Fixing rematch ranking
Choose one:
- **Option A (radius loop):** iterate 10 km bands up to 100 km. In each band, sort by specialty match, empanelled, distance, beds. Return as soon as a band has candidates.
- **Option B (scored ranking):** compute a score such as `score = specialtyMatch*W1 + empanelled*W2 - distanceKm*W3 + beds*W4`, with documented weights. Specialty should dominate within a sensible radius but not override a large distance gap.

Recommendation: Option A for explainability in a review. This is the ranking approach assumed everywhere else in this document that `rematchWithSeverity` is described.

**Known limitation of Option A, acknowledged rather than hidden:** a candidate just outside a 10 km band boundary can still lose to a weaker candidate just inside it (e.g., a 9 km general hospital vs. an 11 km specialty match) — the fix narrows the original bug (90 km beating 5 km) but doesn't eliminate band-edge cases. Given this build only covers 22 hospitals in one metro area, band-edge collisions are expected to be rare in practice; if the Hospital dashboard's accept/reject data shows this happening often, switch to Option B. Not switching now, to keep review explainability, but this is a revisit trigger, not a closed question.

### 5.5 Severity dictionary expansion
Add at least: `cardiac arrest`, `stroke`, `seizure`, `choking`, `unresponsive`, `severe allergic reaction`, `head injury`, `road accident`, `gunshot`, `stab`, `pregnancy bleeding`, `poisoning`, `drowning`. These are **planned additions, not yet live** in `severityKeywords.json` (see 2.11, gap 3). Keep levels 1-4 and specialties aligned to the hospital `specialties` vocabulary (now enumerated in 6.1) — `fracture` maps to `general`. Add unit tests for every keyword.

**Suggested specialty mapping for this phase** (needed because the earlier revision referenced a `specialties` vocabulary without ever listing it — see 6.1):

| Keyword(s) | Specialty |
|---|---|
| cardiac arrest, chest pain | `cardiac` |
| stroke, seizure, unresponsive, head injury | `neuro` |
| road accident, gunshot, stab, fracture | `general` |
| severe allergic reaction, choking, drowning, poisoning | `general` |
| pregnancy bleeding | `obstetric` |

This is a working default for this build, not a claim that it existed before — flagged as new.

### 5.6 Early-hold design note
The system places an ER hold at trigger time, before symptoms are known, **as a deliberate design choice**, to protect a bed while symptoms are collected. When symptoms arrive, the first hold is released and a second is placed (ICU for level 1). The release and re-hold are one atomic step per the model in 5.3a, so the bed is never double-counted.

### 5.7 Hold lifecycle
```text
reserveBedProvisional -> hold(pending, expiresAt = now+30s) -> timer armed
   ├─ confirm (staff or paramedic) within 30 s -> confirmed, bed stays consumed
   ├─ hospital rejects -> release + cascade immediately
   └─ timeout -> release + cascade to next candidate (max 5) -> else NO_HOSPITAL_AVAILABLE
```
On server boot, rebuild timers from `bed_holds` rows where `status = 'pending'` and `expiresAt > now` (Postgres is the source rebuilt from — see 5.3a), and expire those already past due.

### 5.8 Release of ambulance and bed after handover
- Hospital staff press **Patient arrived**: request becomes `COMPLETED`, the hold becomes `consumed`, the ambulance returns to `free`, and the patient's bed is deducted permanently until staff update availability.
- Patient cancels: release the hold, free the ambulance, request becomes `CANCELLED`. **This phase, "patient cancels" has no patient UI to trigger it from** — cancellation is tested via the simulator or a direct API call until the Patient dashboard is built. The hold lifecycle itself is unaffected.

### 5.9 Extended status values
Existing 12 statuses, plus:
`HOSPITAL_ACCEPTED`, `HOSPITAL_REJECTED`, `PATIENT_PICKED_UP`, `EN_ROUTE_TO_HOSPITAL`, `ARRIVED_AT_HOSPITAL`, `COMPLETED`, `CANCELLED`, `QUEUE_PRIORITIZED`.

---

## 6. Data model

### 6.1 Tables
```sql
users(id, name, email, phone, password_hash, role, entity_id, created_at)
  -- role: patient | driver | hospital_staff | devops
  -- entity_id: ambulance_id for drivers, hospital_id for staff
  -- this phase: driver and hospital_staff rows are what's actually created/used

hospitals(id, name, lat, lng, specialties text[], empanelled bool, last_updated)
  -- specialties vocabulary for this phase: general | cardiac | neuro | obstetric
  -- (see 5.5 for the keyword-to-specialty mapping this vocabulary supports)
hospital_beds(hospital_id, bed_type, total, available, updated_at, updated_by)
  -- bed_type: ER | ICU | General
doctors_on_duty(id, hospital_id, specialty, count, shift_start, shift_end)
  -- informational only: shown to hospital staff for pre-arrival prep (9.3).
  -- NOT a matching input — hospitalMatcher ranks on specialty/empanelled/distance/beds
  -- only (1.5, 5.4). If this should affect matching later, that's new scope, not a fix.

ambulances(id, plate, status, current_request_id, lat, lng, last_seen)
devices(id, ambulance_id, token_hash, fw_version, last_heartbeat, battery, rssi, gps_fix, status)

requests(id, patient_user_id, created_at, lat, lng, location_source, status,
         symptoms_text, severity_level, required_specialty, bed_type,
         assigned_ambulance_id, provisional_hospital_id, confirmed_hospital_id,
         active_hold_id, cascade_count, completed_at)
request_candidates(request_id, hospital_id, rank)
request_status_log(id, request_id, status, at, meta jsonb)

bed_holds(id, request_id, hospital_id, bed_type, created_at, expires_at, status)
  -- status: pending | confirmed | expired | consumed | released
  -- this table is the sole source of truth for hold state — see 5.3a

location_pings(id, ambulance_id, request_id, lat, lng, speed, stale, ts)
vitals_readings(id, request_id, ambulance_id, hr, spo2, valid, ts)
  -- HR and SpO2 from MAX30102 only; no ECG column

alerts(id, type, severity, source_type, source_id, message, status, created_at)
  -- this phase: table exists (hold-timeout and device-offline conditions still need
  -- to be detected for Hospital/Ambulance alerting), but the DevOps alert *dashboard*
  -- that consumes this table is deferred (see 9.4, 12)
tickets(id, title, description, severity, source, linked_request_id,
        linked_device_id, linked_hospital_id, assignee_id, status,
        created_at, updated_at, resolved_at)
  -- deferred along with the DevOps dashboard; table defined for schema completeness only
ticket_comments(id, ticket_id, author_id, body, created_at)
system_logs(id, level, service, request_id, device_id, message, stack, ts)
audit_access_log(id, user_id, entity, entity_id, action, ts)
```

### 6.2 Indexes
`requests(status)`, `bed_holds(status, expires_at)`, `location_pings(ambulance_id, ts desc)`, `vitals_readings(request_id, ts desc)`, `alerts(status)`, `tickets(status, severity)`, `system_logs(ts, level)`.

### 6.3 Retention
- `location_pings` and `vitals_readings`: keep full detail for a short window (for example 30 days), then aggregate or archive.
- `system_logs`: rotate by age.
- `request_status_log`, `tickets`: keep permanently.

---

## 7. API specification

All responses use `{ ok, data, error }`. All endpoints except sign-in and SOS require a JWT. Roles are enforced server-side.

### 7.1 Auth
| Endpoint | Description |
|---|---|
| `POST /api/auth/register` | Patient sign-up — **deferred; not called by anything in this phase** |
| `POST /api/auth/login` | Returns access and refresh tokens — **active for `driver` and `hospital_staff`** |
| `POST /api/auth/refresh` | Refresh the access token |
| `GET /api/auth/me` | Current user and role |

### 7.2 Emergency (existing, extended)
| Endpoint | Role | Description |
|---|---|---|
| `POST /api/emergency/trigger` | patient | Start dispatch; returns request, ambulance, provisional hospital, hold (`holdId`, `holdExpiresAt`), `routeInfo`. **This phase: invoked by the simulator (4.7) or an internal test trigger, not a patient UI** |
| `POST /api/emergency/:id/symptoms` | patient, driver | Classify (rule-based keyword classifier), rematch (radius-loop ranking per 5.4), new hold (`holdId`, `holdExpiresAt`). **Active via driver/paramedic form on the Ambulance dashboard** |
| `POST /api/emergency/:id/confirm-hospital` | driver, hospital_staff | Confirm the active hold (`holdId`) — **active, used by both in-scope dashboards** |
| `POST /api/emergency/:id/cancel` | patient | Cancel and release — **deferred UI; reachable via simulator/API for testing** |
| `GET /api/emergency/:id/status` | participants, devops | Full state (including `holdId`, `holdExpiresAt` if a hold is active) and audit log — **active for driver/hospital_staff** |
| `GET /api/emergency/:id/track` | patient | Ambulance position, ETA, hospital, `routeInfo` — **deferred (Patient dashboard consumer); Hospital dashboard gets equivalent data via `/hospitals/:id/incoming`** |
| `GET /api/emergency/requests` | devops | All requests (paginated, filterable) — **deferred along with DevOps dashboard** |

### 7.3 Ambulance *(active this phase)*
| Endpoint | Description |
|---|---|
| `GET /api/ambulances/:id/assignment` | Current dispatch |
| `POST /api/ambulances/:id/status` | `en_route`, `arrived_patient`, `patient_loaded`, `arrived_hospital` |
| `POST /api/emergency/:id/paramedic-notes` | Symptoms, equipment needed, blood group |
| `POST /api/emergency/:id/vitals` | Manual or fallback vitals if hardware is down |

### 7.4 Hospital *(active this phase)*
| Endpoint | Description |
|---|---|
| `GET /api/hospitals/:id/incoming` | Incoming and provisional patients |
| `PATCH /api/hospitals/:id/beds` | Update bed counts by type |
| `PATCH /api/hospitals/:id/doctors` | Update on-duty doctors by specialty (informational only — see 6.1) |
| `POST /api/hospitals/:id/incoming/:reqId/accept` | Accept patient (confirms hold) |
| `POST /api/hospitals/:id/incoming/:reqId/reject` | Reject with a reason (triggers cascade) |
| `POST /api/hospitals/:id/incoming/:reqId/arrived` | Mark patient arrived, close request |

### 7.5 Device (see section 4.5) *(active this phase)*
`POST /api/device/location`, `/vitals`, `/heartbeat`, `/batch`, `GET /api/device/commands`.

### 7.6 DevOps *(deferred this phase — endpoints specified for continuity, not built now)*
| Endpoint | Description |
|---|---|
| `GET /api/devops/health` | Backend, DB, Redis, broker, ORS status |
| `GET /api/devops/devices` | Fleet status |
| `GET /api/devops/logs` | Filter by level, service, requestId, deviceId, time |
| `GET /api/devops/alerts`, `PATCH /alerts/:id` | List, acknowledge, resolve |
| `GET /api/devops/metrics` | Dispatch time, cascade rate, hold-timeout rate, uptime |
| `GET/POST /api/tickets`, `GET/PATCH /api/tickets/:id`, `POST /api/tickets/:id/comments` | Ticket CRUD |
| `GET /api/devops/requests/:id/replay` | Ordered timeline for debugging |

### 7.7 Simulation *(active this phase — stands in for the deferred Patient dashboard, see 4.7)*
`POST /api/simulate/reset`, `POST /api/simulate/ambulance-gps`, `POST /api/simulate/vitals`, `POST /api/simulate/load` (creates N concurrent requests for conflict testing). Restrict to non-production or devops role.

### 7.8 Error codes
`NO_AMBULANCE_AVAILABLE`, `NO_HOSPITAL_AVAILABLE`, `NO_ACTIVE_HOLD`, `HOLD_EXPIRED_OR_INVALID`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `RATE_LIMITED`.

---

## 8. Real-time layer (Socket.IO)

### 8.1 Connection and rooms
On connect, the client sends its JWT. The server validates it and auto-joins rooms by role. Clients cannot join arbitrary rooms.

| Room | Members | Purpose | This phase |
|---|---|---|---|
| `request:{id}` | Patient, assigned driver, assigned hospital staff | All updates for one emergency | **Active** (minus the patient member) |
| `ambulance:{id}` | That ambulance's driver | Dispatch, reassignment, commands | **Active** |
| `hospital:{id}` | Staff of that hospital | Incoming patients, bed and hold changes | **Active** |
| `devops` | DevOps users | Alerts, fleet state, errors | **Deferred** |

### 8.2 Event catalog
| Event | Emitted when | Payload (summary) | Delivered to |
|---|---|---|---|
| `request.created` | SOS received | requestId, location | patient, devops *(this phase: neither consumer is built; event still fires for log/debug)* |
| `ambulance.assigned` | Allocation done | ambulance, ETA | patient, driver |
| `hospital.provisional` | First match and hold | hospital, holdId, expiresAt, route | patient, driver, hospital (pending) |
| `severity.classified` | After symptoms | level, specialty, bedType | patient, driver, hospital |
| `hospital.rematched` | After rematch (radius-loop ranking) | ranked list, new hospital | patient, driver, new hospital; old hospital gets `incoming.cancelled` |
| `hold.created` | New hold | holdId, hospitalId, expiresAt | driver, hospital |
| `hold.cascaded` | Timeout or reject | oldHospital, newHospital, reason | driver (**loud alert**), patient, both hospitals |
| `hospital.accepted` / `hospital.rejected` | Staff action | reason | driver, patient, devops |
| `bed.confirmed` | Hold confirmed | hospitalId | all request participants |
| `ambulance.location` | Each ping | lat, lng, speed, stale | patient, assigned hospital, devops |
| `vitals.update` | Each reading | hr, spo2, valid, ts | driver, assigned hospital, devops |
| `ambulance.status` | Driver status button | status | patient, hospital |
| `beds.updated` | Staff edits beds | counts | that hospital, devops |
| `request.completed` | Arrival and handover | summary | all participants |
| `device.offline` / `alert.raised` | Alert engine | alert | devops *(deferred consumer; see 12)* |
| `ticket.created` / `ticket.updated` | Ticket service | ticket | devops, ticket reporter *(deferred)* |

### 8.3 Reliability
- Every event carries `{eventId, requestId?, ts}`.
- On reconnect, the client calls `GET /status` (or `/incoming`, `/assignment`) to re-sync, so a dropped socket never leaves a dashboard stale.
- Throttle `ambulance.location` fan-out to about one event per 2-3 s per ambulance.
- Keep the 2 s polling code as a fallback if the socket is down for more than 10 s.

---

## 9. Dashboard specifications

### 9.1 Patient dashboard (mobile-first)
**Build status: Deferred.** Fully designed below for continuity; nothing here is being built this phase. Revisit once Hospital and Ambulance are solid.

**Goal:** one-tap help and calm, clear status.

| Screen / widget | Details |
|---|---|
| SOS | Big button; GPS capture; fallback to approximate location with a visible notice |
| Symptoms | Free text plus quick-select chips (chest pain, accident, breathing difficulty, bleeding, labor pain, burns) |
| Live tracking | Map with ambulance position, route, ETA |
| Assigned hospital | Name, distance, ETA, "bed secured" badge |
| Status timeline | Plain-language rendering of `statusLog` ("Ambulance assigned", "Hospital ready") |
| Reassignment notice | Calm message when the hospital changes |
| Contacts | Auto-SMS to an emergency contact with a tracking link (optional) |
| Cancel | Cancel the request with confirmation |

Design rules: minimal text, large touch targets, no technical terms, works on weak networks.

### 9.2 Ambulance dashboard (driver/paramedic tablet)
**Build status: Active — core focus of this phase.**

| Screen / widget | Details |
|---|---|
| Dispatch alert | Sound plus full-screen: patient location, severity, route |
| Navigation | Pickup route, then hospital route (map plus deep link to a navigation app) — `Map.tsx` mounting here is part of this phase's work, not deferred |
| Reassignment alert | Full-screen loud alert when destination changes |
| Status buttons | Arrived at patient, patient loaded, arrived at hospital |
| Vitals panel | Live HR/SpO2 from hardware (MAX30102 only) or simulator, validity indicator, device status |
| Paramedic form | Symptoms, equipment needed, blood group, notes |
| Hold banner | Countdown to hold expiry and confirm button |
| Device status | GPS fix, 4G signal, battery, last sync |
| Offline mode | Cache route, queue actions, sync when online |
| Fallback GPS | Use tablet GPS when the device is offline |

**Exit criteria for "works without any problem":** dispatch alert fires reliably on allocation; vitals panel never shows stale data without the validity/staleness indicator reflecting it; hold countdown matches the server's `holdExpiresAt` within a few seconds even after a socket reconnect (8.3); reassignment alert fires on every cascade, not just the first.

### 9.3 Hospital dashboard (ER desk)
**Build status: Active — core focus of this phase.**

| Screen / widget | Details |
|---|---|
| Incoming board | Cards per patient: ETA, severity, symptoms, required specialty, live vitals, status (provisional / accepted) |
| Accept / reject | Reject requires a reason, triggers cascade |
| Hold countdown | Provisional hold timer per incoming patient |
| Bed management | Plus/minus controls for ER, ICU, General; last-updated stamp |
| Doctors on duty | Count by specialty — **informational display only, not a matching input (see 6.1, 2.11 gap 9)** |
| Pre-arrival prep | Equipment, blood group, severity-based checklist |
| Ambulance tracking | Map of incoming ambulances with ETA — `Map.tsx` mounting here is part of this phase's work |
| Handover | "Patient arrived" button closes the request |
| History | Past patients and outcomes for the hospital |

**Exit criteria for "works without any problem":** bed counts shown always match Postgres exactly (5.3a) — no drift, no race where two staff edits or a concurrent hold decrement can disagree; reject always cascades within the same request lifecycle (no orphaned pending state); hold countdowns across multiple simultaneous incoming patients never cross-contaminate (each tied correctly to its own `holdId`).

### 9.4 DevOps dashboard
**Build status: Deferred.** Fully designed below for continuity; nothing here is being built this phase.

| Screen / widget | Details |
|---|---|
| System health | Backend, DB, Redis, ORS, socket count, error rate |
| Fleet map | All ambulances, status, stale flags |
| Device table | Online/offline, last heartbeat, battery, RSSI, GPS fix, firmware version |
| Live requests | All active requests with state and cascade count |
| Logs | Filter by level, service, requestId, deviceId, time range |
| Alerts | Open, acknowledged, resolved |
| Tickets | Kanban or table: create, assign, prioritize, comment, close |
| Request replay | Step through `statusLog` plus location and vitals timeline |
| Metrics | Average dispatch time, cascade rate, hold-timeout rate, hospital acceptance rate, uptime |
| Simulator controls | Reset, spawn load, run GPS simulation |

**Ticket fields:** id, title, description, severity (P1-P4), source (auto or manual), linked request/device/hospital, assignee, status (Open → In Progress → Resolved → Closed), created/updated/resolved timestamps, comments.

---

## 10. How the four dashboards connect

### 10.1 Connection model
```
Patient ──┐                              ┌── Patient
Driver ───┼── REST (actions) ──► Backend ┼── Driver
Hospital ─┤                              ├── Hospital
DevOps ───┘◄─ Socket.IO (live updates) ──┴── DevOps
```
- **Actions** (SOS, confirm, accept, update beds, create ticket) go over **REST**.
- **Live updates** come back over **Socket.IO rooms**.
- **Hardware** feeds the backend via the device API; the backend republishes to the right rooms.
- **This phase, only the Driver and Hospital legs of this diagram are live traffic.** Patient and DevOps legs are inert until those dashboards are built; the backend still emits the events (8.2), nothing consumes them yet.

### 10.2 Who sees what
| Data | Patient | Ambulance | Hospital | DevOps |
|---|---|---|---|---|
| Own request status | ✅ (deferred) | ✅ | ✅ (incoming only) | ✅ (deferred) |
| Ambulance live location | ✅ own (deferred) | ✅ own | ✅ incoming | ✅ all (deferred) |
| Raw vitals | ❌ (deferred) | ✅ | ✅ incoming | ✅ (deferred — revisit this grant before building DevOps; see assessment note below) |
| Symptoms and severity | ✅ own (deferred) | ✅ | ✅ incoming | ✅ (deferred) |
| Other hospitals' beds | ❌ | ❌ | ❌ own only | ✅ (deferred) |
| Logs, devices, tickets | ❌ | ❌ | ❌ | ✅ (deferred) |

*Note carried from review: DevOps getting the same raw-vitals access as the treating hospital was never justified against the "restrict health data by role" principle in 13. Flagging it here so it's revisited when DevOps is actually built, rather than inherited unexamined.*

### 10.3 Action-to-effect map
| Action by | Effect on other dashboards |
|---|---|
| Patient taps SOS *(this phase: simulator/API call instead)* | Driver gets dispatch; hospital sees provisional incoming |
| Paramedic submits symptoms | Hospital sees severity and prep info |
| Hospital accepts | Driver sees "bed secured" |
| Hospital rejects | Cascade runs; driver alerted of new destination; new hospital sees incoming |
| Hold times out | Same as reject, with reason `TIMEOUT` |
| Hospital staff edits beds | Matching engine uses new counts immediately |
| Ambulance device stops reporting | Driver sees "device offline, using tablet GPS" *(DevOps alert/ticket deferred)* |
| Driver presses "arrived at hospital" | Hospital sees arrival |
| Hospital presses "patient arrived" | Request completes; ambulance becomes free |

### 10.4 Frontend routing (single app, role-based)
```
/login
/patient/*     (role: patient)   — deferred
/driver/*      (role: driver)    — ACTIVE
/hospital/*    (role: hospital_staff) — ACTIVE
/devops/*      (role: devops)    — deferred
```
A shared layer provides: auth context, Socket.IO context, API client with token refresh, `Map` component (mounting into `/driver/*` and `/hospital/*` this phase — see 2.11 gap 5), status-timeline component, and the countdown component.

---

## 11. End-to-end scenarios

The scenarios below describe the **target flow**, once the fixes in Section 2 and the wiring in Section 5.3 are complete. **This phase, every scenario's SOS trigger is simulator/API-driven (4.7, 7.7), not a Patient-app tap** — the rest of each scenario (ambulance, hospital, hold lifecycle) is unchanged and is exactly what this phase needs to prove works.

### 11.1 Happy path
1. SOS triggered via simulator/test call. Backend creates the request, runs queue → allocator → `provisionalMatch` → atomic ER hold (HOLD1), placed intentionally before symptoms are known (design choice, see 5.6).
2. Driver gets a dispatch alert; hospital sees a provisional incoming patient.
3. Driver heads out. ESP32 (or simulator) reports GPS; hospital map updates live (requires `Map.tsx` mounted — active this phase, see 9.3).
4. Paramedic submits symptoms ("chest pain"). Rule-based keyword classifier returns level 1, cardiac. Rematch ranks hospitals using the radius-loop approach (5.4, Option A). HOLD1 released, HOLD2 (ICU) placed atomically per the model in 5.3a.
5. Backend sends `patient_onboard` to the device when the driver marks "patient loaded"; vitals (HR/SpO2, non-clinical) start flowing to driver and hospital.
6. Hospital staff accept → `BED_CONFIRMED`.
7. Driver marks "arrived at hospital"; staff press "patient arrived"; request completes; ambulance returns to `free`.

### 11.2 Timeout cascade
1. Hold expires at 30 s with no confirmation. The BullMQ timer fires and the worker re-checks hold status in Postgres before acting (5.3a).
2. Bed released, status `BED_HOLD_TIMED_OUT`, next candidate held (ranked via the radius-loop approach, 5.4).
3. Driver sees a full-screen reassignment alert; both hospitals are updated.
4. After 5 cascades or no candidates: `NO_HOSPITAL_AVAILABLE` logged (DevOps P1 alert/auto-ticket deferred — see 12).

### 11.3 Concurrent requests for the last ICU bed
*Depends on the request queue being wired in (5.3) — active scope this phase.*
1. Two simulator-triggered requests arrive within 5 s.
2. Queue orders by severity (level 1 before level 3) inside the window, FCFS outside it.
3. First processed request gets the atomic hold (5.3a); the other cascades to the next hospital.
4. `QUEUE_PRIORITIZED` is logged and visible on the Hospital dashboard's audit trail.

### 11.4 Hardware failure
1. Device heartbeat missing for 45 s. **This phase:** the driver dashboard's own device-status widget (9.2) must surface this directly — don't rely on a DevOps alert, since that consumer is deferred.
2. If a request is active, driver dashboard switches to tablet GPS and shows a banner.
3. If GPS is stale for 60 s on an active request, the hospital's incoming-board card for that patient should also flag staleness, since the hospital is the other live consumer of that location data.

### 11.5 Hospital rejects
1. Staff reject with a reason.
2. Immediate cascade; reason stored in the audit log and shown to the driver.

---

## 12. DevOps: alerts, errors, tickets

**Build status: Deferred as a dashboard.** The underlying alert *conditions* are still worth detecting and logging this phase (11.4 shows two of them now need a home on the Ambulance/Hospital dashboards directly, since there's no DevOps UI to send them to), but the DevOps console, ticketing UI, and ticket workflow below are not being built.

### 12.1 Auto-alert rules
| Condition | Severity | Auto-ticket |
|---|---|---|
| Device heartbeat missing > 45 s | P2 | Yes |
| GPS stale > 60 s during an active request | P1 | Yes |
| `cascadeCount >= 3` on a request | P2 | Yes |
| `NO_HOSPITAL_AVAILABLE` or `NO_AMBULANCE_AVAILABLE` | P1 | Yes |
| ORS failure rate high | P3 | Yes |
| Unhandled backend exception | P2 | Yes (with stack) |
| DB, Redis, or broker down | P1 | Yes |
| Battery < 20% on a device | P3 | Yes |
| Hospital bed data not updated for > N hours | P3 | Yes |

### 12.2 Rules for alerts and tickets
- **De-duplicate:** one open ticket per condition per entity.
- **Auto-resolve suggestion:** when the condition clears, mark the alert resolved and prompt the assignee to close the ticket.
- Always attach `requestId` / `deviceId` so the ticket links straight to the replay.

### 12.3 Error handling in the backend
- Central Express error middleware logs `{level, service, requestId, deviceId, message, stack, ts}`.
- Distinguish **operational errors** (validation, not found, no availability) from **bugs** (unhandled exceptions); only bugs auto-ticket.
- Wrap external calls (ORS) with timeout and retry-once; on failure return null route info (already implemented) and count failures for the alert rule.
- Graceful shutdown: persist pending holds and timers.

### 12.4 Metrics to compute
Average dispatch time (SOS → hold), cascade rate, hold-timeout rate, hospital acceptance rate, device uptime, average ETA error, requests per hour.

---

## 13. Security and privacy

**This phase's scope:** JWT auth and RBAC are required now for `driver` and `hospital_staff` — these are live, functioning dashboards handling real bed and vitals data. `patient` registration/auth and the full SOS-spam rate-limiting problem (see assessment note below) are deferred along with the Patient dashboard. Device auth is required now (Ambulance dashboard depends on it).

- **Passwords:** bcrypt/argon2. **Tokens:** short-lived JWT access tokens plus refresh tokens. Active for `driver`, `hospital_staff`.
- **RBAC:** enforced in middleware and in Socket.IO room joins. Hospital staff can only access their own `hospital_id`; drivers only their `ambulance_id`.
- **Device auth:** unique token per device, stored hashed; revoke capability needed even without a DevOps UI (a direct DB/admin-script revoke is acceptable this phase); rate-limit device endpoints.
- **Transport:** HTTPS/TLS everywhere; ESP32 must validate the server certificate (avoid `setInsecure()` outside prototypes).
- **Health data:** symptoms and vitals are sensitive. Restrict by role (driver + assigned hospital only, this phase — no DevOps grant exists yet to worry about), log access in `audit_access_log`, and define retention.
- **Input validation:** validate lat/lng ranges, text length, and enum values on every endpoint.
- **Rate limiting:** on auth endpoints, active this phase. **SOS/`trigger` rate limiting against spam is explicitly deferred**, because the endpoint has no public caller this phase (simulator/internal test trigger only, per 2.11 gap 10) — the hard problem (unauthenticated endpoint + legitimate burst traffic during mass-casualty events) needs to be designed deliberately when the Patient dashboard is built, not bolted on as an afterthought.
- **Secrets:** `.env` not committed; ORS key and JWT secrets via environment variables.
- **Simulation endpoints:** restricted to non-production use (no `devops` role gate yet, since that role is deferred — use an environment check instead for this phase).
- **Disclaimer:** state clearly that the system is a decision-support/dispatch aid and that vitals are non-clinical.

---

## 14. Repository structure (target)

```text
emergency-platform/
├── implementation-plan.md
├── docs/ (api-contracts.md, data-schemas.md, test-scenarios.md, hardware-wiring.md, runbook.md)
├── backend/
│   ├── server.js
│   ├── config/ (env, db, redis)
│   ├── db/ (migrations/, seeds/)
│   ├── data/ (seed JSON, severityKeywords.json)
│   ├── modules/ (distance, severityClassifier, ambulanceAllocator, hospitalMatcher,
│   │             bedReservation, requestQueue, routingService)
│   ├── services/ (alertEngine, ticketService, deviceIngest, metricsService)
│   │             # alertEngine/ticketService: condition-detection logic active,
│   │             # DevOps-facing delivery deferred (see 12)
│   ├── realtime/ (socket.js, rooms.js, events.js)
│   ├── middleware/ (auth, rbac, errorHandler, rateLimit, validate)
│   ├── routes/ (auth, emergency, ambulances, hospitals, device, devops, tickets, simulate)
│   │             # devops/, tickets/ routes defined for schema continuity, not wired to a UI
│   ├── jobs/ (holdTimeout worker, heartbeatMonitor, retentionCleanup)
│   └── tests/ (unit/, integration/, scenarios/)
├── frontend/
│   └── client/src/
│       ├── app/ (routes, role guards)
│       ├── contexts/ (Auth, Socket, Theme)
│       ├── lib/ (api client, socket client)
│       ├── components/ (Map [mounting into driver/ and hospital/ this phase — see 2.11], Countdown, StatusTimeline, VitalsCard, ui/)
│       └── pages/ (patient/ [deferred], driver/ [ACTIVE], hospital/ [ACTIVE], devops/ [deferred])
├── firmware/
│   └── ambulance-unit/ (main.ino, gps.cpp, vitals.cpp, modem.cpp, oled.cpp, config.h)
└── simulator/ (ambulance-route.js, vitals-generator.js)
```

---

## 15. Testing plan

### 15.1 Unit tests
- `distance`: known coordinate pairs.
- `severityClassifier`: every keyword, multi-keyword precedence, default case, case-insensitivity.
- `hospitalMatcher`: radius expansion, approximate-location start radius, specialty/empanelled/distance/bed ordering, the rematch fix (radius-loop, 5.4), **and an explicit test for the documented band-edge limitation so it's measured, not just acknowledged in prose**.
- `bedReservation`: hold, confirm, expire, cascade up to 5, restore on boot — **including a test that forces the BullMQ timer to fire after the DB hold was already confirmed, to verify the worker's re-check no-ops correctly (5.3a)**.
- `requestQueue`: inside-window severity ordering, outside-window FCFS, equal-severity tiebreak.
- `routingService`: success, timeout, missing key.

### 15.2 Integration tests
- Full flow over REST with a real test database.
- Atomicity: fire N parallel requests at M beds and assert no bed count goes negative and no double-assignment occurs.
- Restart recovery: restart the server with pending holds and verify timers resume from Postgres (5.3a).

### 15.3 Scenario tests (extend your existing five) — **this phase, all via simulator/API trigger, not Patient UI**
1. Direct match
2. Full hospital skipped
3. 100 km radius expansion
4. Severity tiebreak (through the real route handlers, once the queue is wired per 5.3)
5. 30 s timeout cascade
6. Hospital rejection cascade
7. Cascade exhaustion → `NO_HOSPITAL_AVAILABLE`
8. ~~Device offline → alert and ticket~~ → **this phase:** device offline → Ambulance dashboard banner + Hospital dashboard staleness flag (12, 11.4), not a DevOps ticket
9. Rematch: near empanelled vs. far specialty hospital (validates the radius-loop fix, 5.4)
10. ~~Patient cancel releases hold and ambulance~~ → **this phase:** API-triggered cancel releases hold and ambulance (no Patient UI to drive it from)

### 15.4 Real-time tests
- Room isolation: a hospital client must not receive another hospital's events.
- Reconnect re-sync — **this applies to `ambulance:{id}` and `hospital:{id}` rooms only this phase.**

### 15.5 Hardware tests
- Cold-start GPS fix time outdoors.
- 4G reconnect and buffer flush.
- Brown-out test under transmit load.
- 1-hour soak test.
- Vitals validity flag when the finger is removed.

### 15.6 Load test
Simulate 50 concurrent SOS requests and 10 devices posting at full rate; check latency and hold correctness. **No numeric latency target is defined anywhere in this document — set one before treating this test as pass/fail, not just "ran without crashing."**

---

## 16. Phased build plan

**This phase's execution order** (supersedes the original Phase 4-6 "hospital, then ambulance, then patient" ordering only in that Patient is removed from the current sequence entirely — DevOps was never in that original ordering and stays out):

| Phase | Deliverables | Exit criteria | Status |
|---|---|---|---|
| **0. Cleanup** | Fix doc/code mismatches (section 2), expand severity dictionary, update docs | Docs match code | Active |
| **1. Foundation** | PostgreSQL, Redis, migrations, auth and roles (driver + hospital_staff only), Socket.IO skeleton, central error handler and logging | Existing flow runs on DB with auth | Active |
| **2. Core hardening** | Wire the queue, atomic bed holds per 5.3a, Redis/BullMQ hold timers as triggers only, restart recovery, rematch fix, extended statuses | All scenario tests pass against the DB, including concurrency | Active |
| **3. Simulator** | Ambulance GPS and vitals simulator, plus `simulate/load` as the SOS entry point for this phase | Hospital and Ambulance dashboards can be built and tested without hardware or a Patient UI | Active |
| **4. Hospital dashboard** | Bed management, incoming board, accept/reject, handover, `Map.tsx` mounted | Staff bed edits change matching; exit criteria in 9.3 met | **Active — core focus** |
| **5. Ambulance dashboard** | Dispatch, navigation, status buttons, paramedic form, tablet-GPS fallback, `Map.tsx` mounted | Full ride works without hardware; exit criteria in 9.2 met | **Active — core focus** |
| **6. Hardware** | GPS first, then heartbeat, then MAX30102, OLED, offline buffer | Real GPS moves the Ambulance/Hospital maps; vitals reach the hospital | Active (needed by Phase 5) |
| **7. Patient dashboard** | SOS, symptoms, live tracking, timeline, cancel | Patient tracks the ambulance live | **Deferred** |
| **8. DevOps dashboard** | Health, fleet, logs, alerts, tickets, replay, metrics | Unplugging a device creates a ticket automatically | **Deferred** |
| **9. Hardening** | Security review, load test, soak test, docs, demo script | Demo runs reliably | **Partially active**: baseline security for driver/hospital/device auth is in scope now (13); full load/soak test and SOS-spam protection deferred to when Patient dashboard is built |

**Build order for this phase:** 0 → 1 → 2 → 3 → 4 → 5 → 6, with 4 and 5 able to proceed in parallel once 1-3 are done, since neither depends on the other being finished first. 7 and 8 are not scheduled; revisit after 4-6 are solid and tested per their stated exit criteria.

---

## 17. Demo plan and fallbacks

### 17.1 Demo script (about 5 minutes, Hospital + Ambulance only)

**Rewritten for this phase's scope** — the prior script assumed four live dashboards and a DevOps ticket demo; neither Patient nor DevOps is built, so those steps are cut rather than faked.

1. Show the two live dashboards side by side: Hospital (ER desk view) and Ambulance (driver/paramedic tablet).
2. Trigger an SOS via the simulator (not a patient tap — say so plainly rather than implying a hidden patient app); show ambulance assignment and the hospital's provisional incoming card with its hold countdown.
3. Simulator (or real ESP32 outdoors) moves the ambulance on both maps live.
4. Submit "chest pain" from the Ambulance dashboard's paramedic form; show severity 1 / cardiac classification, the rematch (radius-loop ranking), and the new ICU hold replacing the ER hold.
5. Hospital accepts; show "bed secured" reflected on the Ambulance dashboard.
6. Trigger a timeout cascade (or reject) and show the driver's full-screen reassignment alert and the hospital's updated incoming board.
7. Fire two concurrent simulated SOS requests for the last ICU bed; show `QUEUE_PRIORITIZED` in the Hospital dashboard's audit trail.
8. Driver marks arrival; hospital marks "patient arrived"; show the ambulance returning to `free` on the Ambulance dashboard.

*(Dropped from the prior script: the DevOps "unplug the device, show the auto-ticket" step — no DevOps dashboard to show it on this phase. Device-offline behavior is still demoable per 11.4's revised handling, as a banner on the Ambulance dashboard and a staleness flag on the Hospital dashboard, if you want to keep that beat.)*

### 17.2 Fallbacks
- GPS or 4G fails → switch to the simulator; same endpoints, same two dashboards.
- ORS fails → UI shows "Distance unavailable" (already handled); matching still works via Haversine.
- Socket drops → polling fallback (active for `ambulance:{id}` and `hospital:{id}` rooms).
- Pre-record a short video of the hardware working as insurance.

---

## 18. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| SIM7600 power brown-outs | Device resets | 5V/2A supply, capacitor, short wires |
| GPS no-fix indoors | No location | Outdoor demo, simulator, tablet GPS fallback |
| Double-booking a bed | Wrong dispatch | Atomic DB transaction per 5.3a, load test |
| Lost timers on restart | Beds stuck | Persist holds in Postgres, rebuild BullMQ timers on boot from Postgres (5.3a) |
| Spoofed device or fake SOS | False data | Device tokens, rate limits on device + auth endpoints; SOS-spam protection explicitly deferred (13) since there's no public trigger this phase |
| Vitals misread as clinical | Safety and credibility | Non-clinical label, validity flag |
| Scope too large | Missed deadline | **This revision's main mitigation: Patient and DevOps dashboards removed from active scope (16)**, simulator stands in for Patient, hospital/ambulance built in parallel |
| Doc and code drift | Review embarrassment | Section 2 fixes, update docs per phase |
| Stale bed data from hospitals | Bad matches | Last-updated stamps, stale-data alert surfaced directly on Hospital dashboard this phase (no DevOps alert consumer yet) |
| 4G latency | Slow updates | Offline buffer, throttled fan-out, ETA from last known |
| Radius-loop band-edge misranking (5.4) | Hospital dashboard shows a suboptimal match near a 10km boundary | Accepted risk at 22-hospital scale this phase; revisit with Option B if accept/reject data shows it happening often |

---

## 19. Open decisions

| # | Decision | Default in this plan |
|---|---|---|
| 1 | Device protocol: HTTPS POST or MQTT | HTTPS first, MQTT-ready topics |
| 2 | Frontend: one app with role routes, or four separate apps | One app, role routes; only `/driver/*` and `/hospital/*` built this phase |
| 3 | Map provider: Google Maps or Leaflet/OSM | Google Maps via existing `Map.tsx`; mounting into Ambulance and Hospital dashboards is active work this phase |
| 4 | Rematch fix: radius loop or scored ranking | Radius loop, with its band-edge limitation accepted for now (5.4) |
| 5 | Is this a demo/college project or a real deployment? | **Resolved for this phase**: current build targets a working Hospital+Ambulance system on real (or simulated) data — production-grade auth and atomicity where it matters (13, 5.3a), but patient-facing security hardening explicitly deferred. Revisit before any public/production deployment. |
| 6 | Who uses the ambulance dashboard: driver or paramedic | Both; driver sees navigation, paramedic sees forms and vitals (same tablet) |
| 7 | Hospital bed data: manual entry or HIS integration | Manual entry via dashboard |
| 8 | SMS provider for patient contact alerts (optional) | Skipped — moot while Patient dashboard is deferred |
| 9 *(new)* | How do SOS requests enter the system without a Patient UI? | Simulator (`/api/simulate/load`) and an internal test-trigger call for this phase (2.11 gap 10); must be redesigned, not reused as-is, once Patient dashboard work starts |
| 10 *(new)* | Does `doctors_on_duty` ever feed matching? | No, for now — informational display only on the Hospital dashboard (6.1, 9.3); open for later if there's a reason to weight it |

---

*End of plan.*
