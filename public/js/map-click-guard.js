export function markerTapMatchesMapClick(tap, point, now, maxAgeMs = 750, maxDistance = 36) {
  if (!tap || !point || ![tap.x, tap.y, tap.at, point.x, point.y, now].every(Number.isFinite)) return false;
  const age = now - tap.at;
  return age >= 0 && age <= maxAgeMs && Math.hypot(point.x - tap.x, point.y - tap.y) <= maxDistance;
}
