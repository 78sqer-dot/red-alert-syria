// Schematic movement paths for direction-only reports. These are visual cues, not tracked aircraft coordinates.
// The southwest gate is near the Syrian boundary by Quneitra; the path is illustrative, never a real flight track.
const OUTSIDE = [35.65, 33.10];
const BORDER_GATE = [35.817, 33.113];
const QUNEITRA_SIDE = [35.90, 33.05];
const DARA_NORTH = [36.05, 32.78];
const DARA_CENTER = [36.105, 32.62];

// A stable illustrative map anchor, not a reported or observed aircraft coordinate.
export const ISRAEL_APPROX_REFERENCE = Object.freeze([35.50, 33.10]);
export const LEGACY_QUNEITRA_ALERT_ID = 'be418c7b-510c-458e-b8d9-0c504730c50b';
const near = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 1e-6;
/** Match only the known expired Sayda→Quneitra record; never infer an archive route for other alerts. */
export function isLegacyQuneitraArchiveAlert(alert) {
  const expiresAt = Date.parse(alert?.expires_at || '');
  const endedAt = Date.parse(alert?.ended_at || '');
  return alert?.id === LEGACY_QUNEITRA_ALERT_ID
    && alert.is_active === false
    && alert.type === 'air_movement'
    && alert.aircraft === 'warplane'
    && alert.flight_direction === 'toward_syria'
    && alert.flight_target?.scope === 'governorate'
    && alert.flight_target?.name_en === 'Quneitra'
    && near(alert.flight_target?.longitude, 35.82461)
    && near(alert.flight_target?.latitude, 33.12595)
    && alert.place?.name_ar === 'صيدا'
    && alert.place?.name_en === 'Sayda'
    && near(alert.location?.longitude, 35.87609)
    && near(alert.location?.latitude, 32.87622)
    && Number.isFinite(expiresAt)
    && Number.isFinite(endedAt)
    && endedAt >= expiresAt;
}
/** Historical map overlay only; the saved alert location and activity are not changed. */
export function legacyQuneitraArchivePath(alert) {
  return isLegacyQuneitraArchiveAlert(alert)
    ? referenceFlightPath('toward_syria', alert.flight_target)
    : [];
}

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

/** Build an explicitly schematic Israel-reference route to a selected Syrian governorate. */
export function referenceFlightPath(direction, target) {
  const longitude = target?.longitude;
  const latitude = target?.latitude;
  if (target?.scope !== 'governorate' || !Number.isFinite(longitude) || !Number.isFinite(latitude)
    || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return [];
  const endpoint = [longitude, latitude];
  const origin = [...ISRAEL_APPROX_REFERENCE];
  if (endpoint[0] === origin[0] && endpoint[1] === origin[1]) return [];
  if (direction === 'leaving_syria') return [endpoint, origin];
  if (direction === 'toward_syria' || direction === 'entering_syria') return [origin, endpoint];
  return [];
}

/** Bearing along the first segment of a validated line; never implies live tracking. */
export function flightPathBearing(path) {
  if (!Array.isArray(path) || path.length < 2) return null;
  const [from, to] = path;
  if (!Array.isArray(from) || !Array.isArray(to) || from.length < 2 || to.length < 2
    || ![from[0], from[1], to[0], to[1]].every(Number.isFinite)
    || (from[0] === to[0] && from[1] === to[1])) return null;
  const phi1 = from[1] * Math.PI / 180;
  const phi2 = to[1] * Math.PI / 180;
  const deltaLon = (to[0] - from[0]) * Math.PI / 180;
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
