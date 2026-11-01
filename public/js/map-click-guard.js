export function markerTapMatchesMapClick(tap, point, now, maxAgeMs = 280, maxDistance = 14) {
  if (!tap || !point || ![tap.x, tap.y, tap.at, point.x, point.y, now].every(Number.isFinite)) return false;
  const age = now - tap.at;
  return age >= 0 && age <= maxAgeMs && Math.hypot(point.x - tap.x, point.y - tap.y) <= maxDistance;
}
