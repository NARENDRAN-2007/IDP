# Emergency Response Platform — Test Scenarios

This document outlines the core test scenarios verified by the platform's automated and manual testing suites.

| # | Scenario | Setup / Condition | Expected Outcome |
|---|---|---|---|
| **A** | **Direct Match** | Patient near a hospital with `ER.available > 0`, general symptom text | Provisional hospital set to nearest available facility. |
| **B** | **Cascade on Full Hospital** | Patient's nearest hospital seeded with `ER.available = 0` | Provisional matching skips full hospital, returns next-nearest available facility. |
| **C** | **Radius Expansion** | Patient placed in coordinate where no hospital is within 10km | Search grid expands in 10km increments up to 100km until a facility with capacity is found. |
| **D** | **Severity Tiebreak** | Two concurrent requests within 5000ms competing for a single ICU bed | Request with lower `severityLevel` (higher urgency, Level 1 > Level 3) gets the hold reservation. |
| **E** | **Hold Timeout Cascade** | Patient bed hold created but confirmation is delayed > 30 seconds | Hold status transitions to `expired`, bed count is released (+1), next candidate hospital is automatically held, and status log shows `BED_HOLD_TIMED_OUT`. |
