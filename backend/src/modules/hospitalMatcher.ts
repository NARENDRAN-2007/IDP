import { haversineDistanceKm } from './distance.js';

export interface HospitalCandidate {
  id: string;
  name: string;
  lat: number;
  lng: number;
  specialties: string[];
  empanelled: boolean;
  beds: {
    ER?: { total: number; available: number };
    ICU?: { total: number; available: number };
    General?: { total: number; available: number };
  };
}

const RADIUS_STEP_KM = 10;
const MAX_RADIUS_KM = 100;

/**
 * Provisional Match (Plan 1.5, Gap 7):
 * Matches an emergency patient to an ER bed before symptoms are known.
 * Expands radius in 10 km steps up to 100 km (20 km start if location is approximate).
 * Sorts candidates by: empanelled (true first), then Haversine distance.
 */
export function provisionalMatch(
  patientLocation: { lat: number; lng: number },
  hospitals: HospitalCandidate[],
  locationSource: 'gps' | 'approximate' = 'gps'
): HospitalCandidate | null {
  const initialRadius = locationSource === 'approximate' ? 20 : RADIUS_STEP_KM;

  for (let radius = initialRadius; radius <= MAX_RADIUS_KM; radius += RADIUS_STEP_KM) {
    const candidates = hospitals
      .filter((h) => haversineDistanceKm(patientLocation.lat, patientLocation.lng, h.lat, h.lng) <= radius)
      .filter((h) => h.beds?.ER && h.beds.ER.available > 0);

    if (candidates.length > 0) {
      return candidates.sort((a, b) => {
        if (a.empanelled !== b.empanelled) return a.empanelled ? -1 : 1;
        return (
          haversineDistanceKm(patientLocation.lat, patientLocation.lng, a.lat, a.lng) -
          haversineDistanceKm(patientLocation.lat, patientLocation.lng, b.lat, b.lng)
        );
      })[0];
    }
  }

  return null;
}

/**
 * Rematch with Severity (Plan 5.4 Option A - Radius Loop Ranking):
 * Iterates in 10 km bands up to 100 km.
 * Within each band, candidates with required bed availability are sorted by:
 * 1. Specialty match (has requiredSpecialty)
 * 2. Empanelled (true > false)
 * 3. Haversine distance ascending
 * 4. Bed availability descending
 * Returns as soon as a band has candidates!
 */
export function rematchWithSeverity(
  patientLocation: { lat: number; lng: number },
  requiredSpecialty: string,
  bedType: 'ER' | 'ICU' | 'General',
  hospitals: HospitalCandidate[],
  locationSource: 'gps' | 'approximate' = 'gps'
): HospitalCandidate[] {
  const initialRadius = locationSource === 'approximate' ? 20 : RADIUS_STEP_KM;

  for (let radius = initialRadius; radius <= MAX_RADIUS_KM; radius += RADIUS_STEP_KM) {
    const bandCandidates = hospitals.filter((h) => {
      const dist = haversineDistanceKm(patientLocation.lat, patientLocation.lng, h.lat, h.lng);
      return dist <= radius && (h.beds?.[bedType]?.available ?? 0) > 0;
    });

    if (bandCandidates.length > 0) {
      return bandCandidates.sort((a, b) => {
        const hasSpecA = a.specialties?.includes(requiredSpecialty);
        const hasSpecB = b.specialties?.includes(requiredSpecialty);

        if (hasSpecA !== hasSpecB) return hasSpecA ? -1 : 1;
        if (a.empanelled !== b.empanelled) return a.empanelled ? -1 : 1;

        const distA = haversineDistanceKm(patientLocation.lat, patientLocation.lng, a.lat, a.lng);
        const distB = haversineDistanceKm(patientLocation.lat, patientLocation.lng, b.lat, b.lng);
        if (Math.abs(distA - distB) > 0.01) return distA - distB;

        const availA = a.beds?.[bedType]?.available || 0;
        const availB = b.beds?.[bedType]?.available || 0;
        return availB - availA;
      });
    }
  }

  return [];
}
