const { haversineDistanceKm } = require('./distance');
const RADIUS_STEP_KM = 10;
const MAX_RADIUS_KM = 100;

function provisionalMatch(request, hospitals) {
  const initialRadius = request.locationSource === 'approximate' ? 20 : RADIUS_STEP_KM;
  for (let radius = initialRadius; radius <= MAX_RADIUS_KM; radius += RADIUS_STEP_KM) {
    const candidates = hospitals
      .filter((h) => haversineDistanceKm(request.patientLocation.lat, request.patientLocation.lng, h.lat, h.lng) <= radius)
      .filter((h) => h.beds && h.beds.ER && h.beds.ER.available > 0);
    if (candidates.length > 0) {
      return candidates.sort((a, b) => {
        if (a.empanelled !== b.empanelled) return a.empanelled ? -1 : 1;
        return haversineDistanceKm(request.patientLocation.lat, request.patientLocation.lng, a.lat, a.lng) -
               haversineDistanceKm(request.patientLocation.lat, request.patientLocation.lng, b.lat, b.lng);
      })[0];
    }
  }
  return null;
}

function rematchWithSeverity(requestOrLoc, requiredSpecialty, bedType, hospitals) {
  let patientLocation = requestOrLoc;
  let locationSource = 'gps';

  if (requestOrLoc && requestOrLoc.patientLocation) {
    patientLocation = requestOrLoc.patientLocation;
    locationSource = requestOrLoc.locationSource || 'gps';
  }

  const initialRadius = locationSource === 'approximate' ? 20 : RADIUS_STEP_KM;

  // Gather all hospitals within max radius that have the required bed availability
  const availableHospitals = hospitals.filter((h) => {
    const dist = haversineDistanceKm(patientLocation.lat, patientLocation.lng, h.lat, h.lng);
    return dist <= MAX_RADIUS_KM && h.beds && h.beds[bedType] && h.beds[bedType].available > 0;
  });

  if (availableHospitals.length === 0) return [];

  // Sort hospitals by:
  // 1. Specialty match (has required specialty vs not)
  // 2. Empanelled status (PM-JAY empanelled true > false)
  // 3. Haversine distance ascending
  // 4. Bed availability descending
  return availableHospitals.sort((a, b) => {
    const hasSpecA = a.specialties && a.specialties.includes(requiredSpecialty);
    const hasSpecB = b.specialties && b.specialties.includes(requiredSpecialty);

    if (hasSpecA !== hasSpecB) return hasSpecA ? -1 : 1;
    if (a.empanelled !== b.empanelled) return a.empanelled ? -1 : 1;

    const distA = haversineDistanceKm(patientLocation.lat, patientLocation.lng, a.lat, a.lng);
    const distB = haversineDistanceKm(patientLocation.lat, patientLocation.lng, b.lat, b.lng);
    if (Math.abs(distA - distB) > 0.01) return distA - distB;

    const availA = a.beds[bedType]?.available || 0;
    const availB = b.beds[bedType]?.available || 0;
    return availB - availA;
  });
}

module.exports = { provisionalMatch, rematchWithSeverity };
