export function zoneHitAt(hits, point, project, { minRadiusPx = 20, paddingPx = 8 } = {}) {
  if (!Array.isArray(hits) || !hits.length || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || typeof project !== 'function') return null;
  let best = null;
  let bestDistance = Infinity;
  for (const hit of hits) {
    const center = project([hit.lon, hit.lat]);
    if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) continue;
    const distance = Math.hypot(point.x - center.x, point.y - center.y);
    const radius = Math.max(minRadiusPx, (Number.isFinite(hit.radiusPx) ? hit.radiusPx : 0) + paddingPx);
    if (distance > radius) continue;
    const tied = Math.abs(distance - bestDistance) <= 0.75;
    const moreSpecific = best && (hit.km < best.km - 0.01 || (Math.abs(hit.km - best.km) <= 0.01 && (hit.live > best.live || (hit.live === best.live && hit.ts > best.ts))));
    if (!best || distance < bestDistance - 0.75 || (tied && moreSpecific)) {
      best = hit;
      bestDistance = distance;
    }
  }
  return best;
}
