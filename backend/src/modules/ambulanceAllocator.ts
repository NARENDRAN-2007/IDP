import { haversineDistanceKm } from './distance.js';

export interface AmbulanceRecord {
  id: string;
  plate: string;
  lat: number;
  lng: number;
  status: string;
  currentRequestId?: string | null;
}

export function findNearestFreeAmbulance(
  patientLocation: { lat: number; lng: number },
  ambulanceList: AmbulanceRecord[]
): AmbulanceRecord | null {
  const free = ambulanceList.filter((a) => a.status === 'free');
  if (free.length === 0) return null;

  return free
    .map((a) => ({
      a,
      d: haversineDistanceKm(patientLocation.lat, patientLocation.lng, a.lat, a.lng)
    }))
    .sort((x, y) => x.d - y.d)[0].a;
}
