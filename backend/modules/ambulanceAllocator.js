const { haversineDistanceKm } = require('./distance');

function findNearestFreeAmbulance(patientLocation, ambulanceList) {
  const free = ambulanceList.filter((a) => a.status === 'free');
  if (free.length === 0) return null;
  return free
    .map((a) => ({ a, d: haversineDistanceKm(patientLocation.lat, patientLocation.lng, a.lat, a.lng) }))
    .sort((x, y) => x.d - y.d)[0].a;
}

function allocateAmbulance(ambulance, request) {
  ambulance.status = 'assigned';
  const reqId = typeof request === 'string' ? request : request.id;
  ambulance.currentRequestId = reqId;
  if (typeof request === 'object' && request !== null) {
    request.assignedAmbulanceId = ambulance.id;
  }
}

function unallocateAmbulance(ambulance, request) {
  if (ambulance) {
    ambulance.status = 'free';
    ambulance.currentRequestId = null;
  }
  if (typeof request === 'object' && request !== null) {
    request.assignedAmbulanceId = null;
  }
}

module.exports = { findNearestFreeAmbulance, allocateAmbulance, unallocateAmbulance };
