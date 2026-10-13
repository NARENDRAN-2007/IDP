/**
 * routingService.js
 * Calls OpenRouteService Directions API (driving-car) for real
 * road-distance and drive-time between two coordinates.
 *
 * Free-tier limit: ~40 req/min, ~2000/day.
 * Only called for the SINGLE top-ranked hospital, not the full list.
 */

const ORS_BASE = 'https://api.openrouteservice.org/v2/directions/driving-car';

/**
 * @param {number} originLat
 * @param {number} originLng
 * @param {number} destLat
 * @param {number} destLng
 * @returns {Promise<{distanceKm: number|null, durationMin: number|null}>}
 */
async function getRouteInfo(originLat, originLng, destLat, destLng) {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    console.warn('[routingService] ORS_API_KEY not set in environment — returning nulls');
    return { distanceKm: null, durationMin: null };
  }

  try {
    const response = await fetch(ORS_BASE, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        coordinates: [
          [originLng, originLat],   // ORS uses [lng, lat] order
          [destLng, destLat],
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[routingService] ORS returned HTTP ${response.status}: ${text}`);
      return { distanceKm: null, durationMin: null };
    }

    const json = await response.json();

    if (!json.routes || json.routes.length === 0 || !json.routes[0].summary) {
      console.warn('[routingService] ORS response missing routes/summary:', JSON.stringify(json).slice(0, 300));
      return { distanceKm: null, durationMin: null };
    }

    const { distance, duration } = json.routes[0].summary;
    return {
      distanceKm: Math.round((distance / 1000) * 10) / 10,   // meters → km, 1 decimal
      durationMin: Math.round(duration / 60),                  // seconds → minutes, whole
    };
  } catch (err) {
    console.error('[routingService] ORS call failed:', err.message || err);
    return { distanceKm: null, durationMin: null };
  }
}

module.exports = { getRouteInfo };
