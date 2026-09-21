const express = require('express');
const router = express.Router();
const { store, updateStatus } = require('../state/store');
const { findNearestFreeAmbulance, allocateAmbulance, unallocateAmbulance } = require('../modules/ambulanceAllocator');
const { provisionalMatch, rematchWithSeverity } = require('../modules/hospitalMatcher');
const { classifySeverity } = require('../modules/severityClassifier');
const { reserveBedProvisional, confirmReservation } = require('../modules/bedReservation');
const { enqueueRequest } = require('../modules/requestQueue');

// Point 10: GET /api/emergency/requests lists all active emergency requests
router.get('/requests', (req, res) => {
  res.json({ ok: true, data: Object.values(store.requests) });
});

router.get('/', (req, res) => {
  res.json({ ok: true, data: Object.values(store.requests) });
});

router.post('/trigger', (req, res) => {
  const { lat, lng, locationSource } = req.body;
  const request = {
    id: `REQ${Date.now()}`,
    createdAt: Date.now(),
    patientLocation: { lat, lng },
    locationSource: locationSource || 'gps',
    status: 'CREATED',
    symptomsText: '',
    severityLevel: null,
    requiredSpecialty: null,
    assignedAmbulanceId: null,
    provisionalHospitalId: null,
    confirmedHospitalId: null,
    candidateHospitals: [],
    activeHoldId: null,
    cascadeCount: 0,
    statusLog: []
  };
  store.requests[request.id] = request;
  updateStatus(request, 'LOCATION_CAPTURED');

  const ambulance = findNearestFreeAmbulance(request.patientLocation, store.ambulances);
  if (!ambulance) {
    updateStatus(request, 'NO_AMBULANCE_AVAILABLE');
    return res.json({ ok: false, data: null, error: 'NO_AMBULANCE_AVAILABLE' });
  }
  
  allocateAmbulance(ambulance, request);
  updateStatus(request, 'AMBULANCE_ALLOCATED');

  const hospital = provisionalMatch(request, store.hospitals);
  if (!hospital) {
    unallocateAmbulance(ambulance, request);
    updateStatus(request, 'NO_HOSPITAL_AVAILABLE');
    return res.json({ ok: true, data: { requestId: request.id, ambulance: null, provisionalHospital: null } });
  }

  request.provisionalHospitalId = hospital.id;
  updateStatus(request, 'PROVISIONAL_HOSPITAL_MATCHED');

  // Point 7: Reserve an initial ER provisional bed hold right on trigger
  let initialHold = null;
  try {
    initialHold = reserveBedProvisional(hospital, 'ER', request, store);
  } catch (err) {
    // ER hold failed, skip initial hold but preserve provisional match
  }

  res.json({ 
    ok: true, 
    data: { 
      requestId: request.id, 
      ambulance, 
      provisionalHospital: hospital, 
      holdId: initialHold ? initialHold.holdId : null,
      holdExpiresAt: initialHold ? initialHold.expiresAt : null 
    } 
  });
});

router.post('/:id/symptoms', (req, res) => {
  const request = store.requests[req.params.id];
  if (!request) {
    return res.json({ ok: false, data: null, error: 'NOT_FOUND' });
  }
  request.symptomsText = req.body.symptomsText;
  updateStatus(request, 'SYMPTOMS_RECEIVED');

  const { level, specialty } = classifySeverity(request.symptomsText);
  request.severityLevel = level;
  request.requiredSpecialty = specialty;
  updateStatus(request, 'SEVERITY_CLASSIFIED');

  const bedType = level === 1 ? 'ICU' : 'ER';

  // Points 8 & 9: Pass full request to preserve locationSource & empanelment across full candidate list
  const ranked = rematchWithSeverity(request, specialty, bedType, store.hospitals);
  request.candidateHospitals = ranked;
  updateStatus(request, 'HOSPITAL_REMATCHED');

  if (ranked.length === 0) { 
    updateStatus(request, 'NO_HOSPITAL_AVAILABLE'); 
    return res.json({ ok: true, data: { severityLevel: level, requiredSpecialty: specialty, rematchedHospitalRanked: [] } }); 
  }

  // Point 1, 4, 11: Safely reserve bed at top ranked candidate, updating provisionalHospitalId
  try {
    const topCandidate = ranked[0];
    request.provisionalHospitalId = topCandidate.id;
    const hold = reserveBedProvisional(topCandidate, bedType, request, store);
    res.json({ 
      ok: true, 
      data: { 
        severityLevel: level, 
        requiredSpecialty: specialty, 
        rematchedHospitalRanked: ranked, 
        holdId: hold.holdId, 
        holdExpiresAt: hold.expiresAt 
      } 
    });
  } catch (err) {
    updateStatus(request, 'NO_HOSPITAL_AVAILABLE');
    res.json({ ok: true, data: { severityLevel: level, requiredSpecialty: specialty, rematchedHospitalRanked: [] } });
  }
});

router.post('/:id/confirm-hospital', (req, res) => {
  const request = store.requests[req.params.id];
  if (!request || !request.activeHoldId) {
    return res.json({ ok: false, data: null, error: 'NO_ACTIVE_HOLD' });
  }

  // Point 3: confirmReservation verifies pending status and returns boolean
  const success = confirmReservation(request.activeHoldId, store);
  if (!success) {
    return res.json({ ok: false, data: null, error: 'HOLD_EXPIRED_OR_INVALID' });
  }

  res.json({ ok: true, data: { status: request.status, confirmedHospitalId: request.confirmedHospitalId } });
});

router.get('/:id/status', (req, res) => {
  const request = store.requests[req.params.id];
  if (!request) return res.json({ ok: false, data: null, error: 'NOT_FOUND' });
  res.json({ ok: true, data: request });
});

module.exports = router;
