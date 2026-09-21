const { updateStatus } = require('../state/store');
const HOLD_TIMEOUT_MS = 30000;
const MAX_CASCADES = 5;

function cancelPreviousHold(request, store) {
  if (!request || !request.activeHoldId) return;
  const oldHold = store.holds[request.activeHoldId];
  if (oldHold && oldHold.status === 'pending') {
    if (oldHold.timer) clearTimeout(oldHold.timer);
    const hospital = store.hospitals.find((h) => h.id === oldHold.hospitalId);
    if (hospital && hospital.beds && hospital.beds[oldHold.bedType]) {
      hospital.beds[oldHold.bedType].available += 1;
    }
    oldHold.status = 'expired';
  }
  request.activeHoldId = null;
}

function reserveBedProvisional(hospital, bedType, request, store) {
  if (!hospital || !hospital.beds || !hospital.beds[bedType] || hospital.beds[bedType].available <= 0) {
    throw new Error('NoAvailabilityError');
  }

  // Cancel any existing pending hold for this request before placing a new one
  cancelPreviousHold(request, store);

  hospital.beds[bedType].available -= 1;
  const holdId = `HOLD${store.nextHoldId++}`;
  const hold = {
    holdId,
    requestId: request.id,
    hospitalId: hospital.id,
    bedType,
    createdAt: Date.now(),
    expiresAt: Date.now() + HOLD_TIMEOUT_MS,
    status: 'pending'
  };

  store.holds[holdId] = hold;
  request.activeHoldId = holdId;
  request.provisionalHospitalId = hospital.id;
  updateStatus(request, 'BED_HELD');

  hold.timer = setTimeout(() => {
    if (hold.status === 'pending') {
      releaseAndCascade(holdId, store);
    }
  }, HOLD_TIMEOUT_MS);

  return hold;
}

function confirmReservation(holdId, store) {
  const hold = store.holds[holdId];
  if (!hold || hold.status !== 'pending') return false;

  if (hold.timer) clearTimeout(hold.timer);
  hold.status = 'confirmed';

  const request = store.requests[hold.requestId];
  if (request) {
    updateStatus(request, 'BED_CONFIRMED');
    request.confirmedHospitalId = hold.hospitalId;
    request.provisionalHospitalId = hold.hospitalId;
    request.activeHoldId = null;
  }
  return true;
}

function releaseAndCascade(holdId, store) {
  const hold = store.holds[holdId];
  if (!hold || hold.status !== 'pending') return;

  if (hold.timer) clearTimeout(hold.timer);

  // Restore bed capacity for the specific hospital holding this reservation
  const hospital = store.hospitals.find((h) => h.id === hold.hospitalId);
  if (hospital && hospital.beds && hospital.beds[hold.bedType]) {
    hospital.beds[hold.bedType].available += 1;
  }
  hold.status = 'expired';

  const request = store.requests[hold.requestId];
  if (!request) return;

  // Only proceed with cascade if this hold is still the active hold for the request
  if (request.activeHoldId === holdId) {
    updateStatus(request, 'BED_HOLD_TIMED_OUT');
    request.activeHoldId = null;

    if (!request.candidateHospitals) request.candidateHospitals = [];
    
    // Remove the expired candidate
    if (request.candidateHospitals.length > 0 && request.candidateHospitals[0].id === hold.hospitalId) {
      request.candidateHospitals.shift();
    }

    request.cascadeCount = (request.cascadeCount || 0) + 1;

    // Loop through remaining candidates safely without throwing inside setTimeout
    while (request.candidateHospitals.length > 0 && request.cascadeCount <= MAX_CASCADES) {
      const nextHospital = request.candidateHospitals[0];
      try {
        const freshHospital = store.hospitals.find((h) => h.id === nextHospital.id);
        if (freshHospital) {
          reserveBedProvisional(freshHospital, hold.bedType, request, store);
          return; // Successfully reserved next candidate!
        }
      } catch (err) {
        // No availability at this candidate, shift and continue cascade loop
        request.candidateHospitals.shift();
        request.cascadeCount += 1;
      }
    }

    // Exhausted candidates
    updateStatus(request, 'NO_HOSPITAL_AVAILABLE');
  }
}

module.exports = { reserveBedProvisional, confirmReservation, releaseAndCascade, cancelPreviousHold, HOLD_TIMEOUT_MS };
