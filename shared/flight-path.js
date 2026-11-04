// Schematic movement paths for direction-only reports. These are visual cues, not tracked aircraft coordinates.
// The southwest gate is near the Syrian boundary by Quneitra; the path is illustrative, never a real flight track.
const OUTSIDE = [35.65, 33.10];
const BORDER_GATE = [35.817, 33.113];
const QUNEITRA_SIDE = [35.90, 33.05];
const DARA_NORTH = [36.05, 32.78];
const DARA_CENTER = [36.105, 32.62];

/** Return only the two stored endpoints; general/country targets have no precise route. */
export function directFlightPath(origin, destination) {
  const point = (location) => {
    const longitude = location?.longitude;
    const latitude = location?.latitude;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
      || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
    return [longitude, latitude];
  };
  const from = point(origin);
  const to = point(destination);
  if (!from || !to || (from[0] === to[0] && from[1] === to[1])) return [];
  return [from, to];
}


/** Bearing from saved direct-route endpoints only; invalid or absent routes have no bearing. */
export function directFlightBearing(origin, destination) {
  const path = directFlightPath(origin, destination);
  if (path.length !== 2) return null;
  const [[lon1, lat1], [lon2, lat2]] = path;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(deltaLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLon);
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return Number.isFinite(bearing) ? bearing : null;
}

// The plane artwork points northeast (45°); the top-down UAV artwork points north (0°).
export function aircraftRotation(aircraft, bearing) {
  if (!Number.isFinite(bearing)) return 0;
  const artworkForward = aircraft === 'uav' ? 0 : 45;
  return ((bearing - artworkForward) % 360 + 360) % 360;
}

export function flightPath(direction, target = null) {
  const base = [OUTSIDE, BORDER_GATE, QUNEITRA_SIDE, DARA_NORTH, DARA_CENTER].map((p) => [...p]);
  const point = Array.isArray(target) ? target : target && Number.isFinite(target.longitude) && Number.isFinite(target.latitude)
    ? [target.longitude, target.latitude] : null;
  const entering = point ? [...base, [...point]] : base;
  // "Toward Syria" only indicates approach to Syrian airspace. Do not treat the
  // selected report location as a confirmed destination and draw an invented
  // track across the country; detailed internal movement uses entering_syria.
  if (direction === 'toward_syria') return [OUTSIDE, BORDER_GATE].map((p) => [...p]);
  if (direction === 'entering_syria') return entering;
  if (direction === 'leaving_syria') return entering.reverse();
  return [];
}

/** Return an interpolated [lon, lat, bearing] position, moving at a steady ground speed. */
export function flightPosition(path, progress) {
  if (!Array.isArray(path) || path.length < 2) return null;
  const segments = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [lon1, lat1] = path[i];
    const [lon2, lat2] = path[i + 1];
    const dx = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    const dy = lat2 - lat1;
    const length = Math.hypot(dx, dy);
    segments.push({ lon1, lat1, lon2, lat2, dx, dy, length });
    total += length;
  }
  if (!total) return null;
  let remaining = Math.max(0, Math.min(1, Number(progress) || 0)) * total;
  for (const s of segments) {
    if (remaining <= s.length || s === segments.at(-1)) {
      const t = s.length ? Math.max(0, Math.min(1, remaining / s.length)) : 0;
      return {
        lon: s.lon1 + (s.lon2 - s.lon1) * t,
        lat: s.lat1 + (s.lat2 - s.lat1) * t,
        bearing: (Math.atan2(s.dx, s.dy) * 180 / Math.PI + 360) % 360,
      };
    }
    remaining -= s.length;
  }
  return null;
}
