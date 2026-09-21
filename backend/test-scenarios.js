const assert = require('assert');
const { store, resetStore, updateStatus } = require('./state/store');
const { haversineDistanceKm } = require('./modules/distance');
const { classifySeverity } = require('./modules/severityClassifier');
const { findNearestFreeAmbulance, allocateAmbulance, unallocateAmbulance } = require('./modules/ambulanceAllocator');
const { provisionalMatch, rematchWithSeverity } = require('./modules/hospitalMatcher');
const { reserveBedProvisional, confirmReservation, releaseAndCascade, HOLD_TIMEOUT_MS } = require('./modules/bedReservation');
const { resolveConflict, enqueueRequest } = require('./modules/requestQueue');

async function runAllTests() {
  console.log('=== STARTING EXTENDED RECTIFICATION VERIFICATION SUITE ===\n');

  // Test 1: Store & Module Initialisation
  console.log('--- Check 1: Store & Module Initialisation ---');
  resetStore();
  assert.strictEqual(store.hospitals.length, 22, 'Store should load 22 hospitals');
  assert.strictEqual(store.ambulances.length, 10, 'Store should load 10 ambulances');
  console.log('✔ Store initialisation verified (22 hospitals, 10 ambulances loaded)');

  // Test 2: Point 2 - Reset Timer Safety Check
  console.log('\n--- Check 2: Reset Timer Safety (Point 2) ---');
  resetStore();
  const reqReset = { id: 'REQ_RESET', createdAt: Date.now(), status: 'CREATED', statusLog: [] };
  store.requests[reqReset.id] = reqReset;
  const holdReset = reserveBedProvisional(store.hospitals[0], 'ER', reqReset, store);
  assert(holdReset.timer !== null, 'Hold timer should be active');
  resetStore(); // Reset store while hold timer is pending
  assert.strictEqual(Object.keys(store.holds).length, 0, 'Holds should be cleared');
  assert.strictEqual(Object.keys(store.requests).length, 0, 'Requests should be cleared');
  console.log('✔ Reset safety passed: active hold timers cleared without uncaught exception');

  // Test 3: Point 3 - Phantom Confirmation Prevention
  console.log('\n--- Check 3: Phantom Confirmation Protection (Point 3) ---');
  resetStore();
  const reqPhantom = { id: 'REQ_PHANTOM', createdAt: Date.now(), status: 'CREATED', statusLog: [] };
  store.requests[reqPhantom.id] = reqPhantom;
  const holdPhantom = reserveBedProvisional(store.hospitals[0], 'ER', reqPhantom, store);
  // Manually expire hold
  releaseAndCascade(holdPhantom.holdId, store);
  assert.strictEqual(holdPhantom.status, 'expired');
  const confirmResult = confirmReservation(holdPhantom.holdId, store);
  assert.strictEqual(confirmResult, false, 'confirmReservation must return false for an expired hold');
  assert.notStrictEqual(reqPhantom.status, 'BED_CONFIRMED', 'Request status should not become BED_CONFIRMED');
  console.log('✔ Phantom confirmation protection passed: expired holds cannot be confirmed');

  // Test 4: Point 4 - Duplicate Symptom Submits & Hold Leaks
  console.log('\n--- Check 4: Duplicate Symptom Submits (Point 4) ---');
  resetStore();
  const reqDup = { id: 'REQ_DUP', createdAt: Date.now(), status: 'CREATED', statusLog: [] };
  store.requests[reqDup.id] = reqDup;
  const initialAvail = store.hospitals[0].beds.ER.available;
  const hold1 = reserveBedProvisional(store.hospitals[0], 'ER', reqDup, store);
  assert.strictEqual(store.hospitals[0].beds.ER.available, initialAvail - 1);
  
  // Second submit replaces hold1 with hold2
  const hold2 = reserveBedProvisional(store.hospitals[1], 'ER', reqDup, store);
  assert.strictEqual(hold1.status, 'expired', 'Hold 1 should be explicitly expired when superceded');
  assert.strictEqual(store.hospitals[0].beds.ER.available, initialAvail, 'Hospital 0 bed restored');
  console.log('✔ Duplicate symptom submit test passed: previous holds released without leaking beds');

  // Test 5: Point 7 - Provisional Hold on Initial Trigger
  console.log('\n--- Check 5: Initial Trigger Provisional Hold (Point 7) ---');
  resetStore();
  const reqTrig = { id: 'REQ_TRIG', createdAt: Date.now(), patientLocation: { lat: 13.0827, lng: 80.2707 }, locationSource: 'gps', status: 'CREATED', statusLog: [] };
  store.requests[reqTrig.id] = reqTrig;
  const hospTrig = provisionalMatch(reqTrig, store.hospitals);
  const trigHold = reserveBedProvisional(hospTrig, 'ER', reqTrig, store);
  assert(trigHold.holdId !== null, 'Initial trigger must create an active bed hold');
  assert.strictEqual(reqTrig.activeHoldId, trigHold.holdId);
  console.log(`✔ Initial trigger hold created (${trigHold.holdId}) for hospital ${hospTrig.name}`);

  // Test 6: Points 8 & 9 - Extended Candidate List & Empanelment Priority
  console.log('\n--- Check 6: Extended Candidate List & Empanelment (Points 8 & 9) ---');
  resetStore();
  const reqExt = { patientLocation: { lat: 13.0827, lng: 80.2707 }, locationSource: 'approximate' };
  const rankedHospitals = rematchWithSeverity(reqExt, 'cardiac', 'ICU', store.hospitals);
  assert(rankedHospitals.length > 3, 'rematchWithSeverity must return full non-truncated candidate list across grid');
  assert.strictEqual(rankedHospitals[0].empanelled, true, 'Top candidate must prioritize empanelled hospital');
  console.log(`✔ Candidate list test passed (${rankedHospitals.length} candidates returned, top empanelled: ${rankedHospitals[0].empanelled})`);

  // Test 7: Point 11 - Stale Tracking Data & Ambulance Unallocate
  console.log('\n--- Check 7: Stale Status & Ambulance Unallocate (Point 11) ---');
  resetStore();
  const reqStale = { id: 'REQ_STALE', createdAt: Date.now(), patientLocation: { lat: 13.0827, lng: 80.2707 }, status: 'CREATED', statusLog: [] };
  const ambStale = store.ambulances[0];
  allocateAmbulance(ambStale, reqStale);
  assert.strictEqual(reqStale.assignedAmbulanceId, ambStale.id);
  assert.strictEqual(ambStale.status, 'assigned');
  
  unallocateAmbulance(ambStale, reqStale);
  assert.strictEqual(reqStale.assignedAmbulanceId, null, 'assignedAmbulanceId should be cleared on request');
  assert.strictEqual(ambStale.status, 'free', 'ambulance status should be free');
  console.log('✔ Stale status tracking test passed');

  // Test 8: Point 1 - Safe Cascade Loop without Uncaught Exception
  console.log('\n--- Check 8: Safe Cascade Loop (Point 1) ---');
  resetStore();
  const reqCasc = { id: 'REQ_CASC', createdAt: Date.now(), patientLocation: { lat: 13.0827, lng: 80.2707 }, status: 'CREATED', statusLog: [] };
  store.requests[reqCasc.id] = reqCasc;
  const candidatesCasc = rematchWithSeverity(reqCasc, 'trauma', 'ICU', store.hospitals);
  reqCasc.candidateHospitals = [...candidatesCasc];
  const initialCascHold = reserveBedProvisional(reqCasc.candidateHospitals[0], 'ICU', reqCasc, store);

  // Force candidate #2 capacity to 0 to test safe skip in cascade loop
  const cand2 = store.hospitals.find(h => h.id === reqCasc.candidateHospitals[1].id);
  cand2.beds.ICU.available = 0;

  // Trigger cascade
  releaseAndCascade(initialCascHold.holdId, store);
  assert.strictEqual(reqCasc.status, 'BED_HELD'); // Successfully cascaded past full candidate #2 to candidate #3
  assert.notStrictEqual(reqCasc.provisionalHospitalId, cand2.id);
  console.log(`✔ Safe cascade passed: skipped full candidate ${cand2.name}, cascaded to ${reqCasc.provisionalHospitalId}`);

  console.log('\n🎉 ALL RECTIFICATION & BUG FIX CHECKS PASSED SUCCESSFULLY!');
}

runAllTests().catch(err => {
  console.error('❌ RECTIFICATION TEST FAILED:', err);
  process.exit(1);
});
