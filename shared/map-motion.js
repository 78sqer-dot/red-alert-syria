const FOCUS_ZOOM = Object.freeze({ place: 11, point: 11.5, district: 9.5, governorate: 8 });

export function alertFocusZoom(scope, currentZoom) {
  const preferred = FOCUS_ZOOM[scope] || 9;
  if (!Number.isFinite(currentZoom)) return preferred;
  return Math.min(13, Math.max(preferred, Math.min(currentZoom, preferred + 0.85)));
}

export function alertTransitionDuration(distanceKm) {
  const distance = Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  return Math.round(Math.max(650, Math.min(1450, 650 + distance * 0.32)));
}

export function distanceKm(from, to) {
  if (!Array.isArray(from) || !Array.isArray(to) || ![...from, ...to].every(Number.isFinite)) return 0;
  const rad = Math.PI / 180;
  const lat1 = from[1] * rad;
  const lat2 = to[1] * rad;
  const dLat = (to[1] - from[1]) * rad;
  const dLon = (to[0] - from[0]) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
