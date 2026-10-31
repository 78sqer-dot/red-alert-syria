// Schematic movement paths for direction-only reports. These are visual cues, not tracked aircraft coordinates.
// The southwest gate is near the Syrian boundary by Quneitra; the path is illustrative, never a real flight track.
const OUTSIDE = [35.65, 33.10];
const BORDER_GATE = [35.817, 33.113];
const QUNEITRA_SIDE = [35.90, 33.05];
const DARA_NORTH = [36.05, 32.78];
const DARA_CENTER = [36.105, 32.62];

export function flightPath(direction) {
  if (direction === 'toward_syria') return [OUTSIDE, BORDER_GATE].map((p) => [...p]);
  const entering = [OUTSIDE, BORDER_GATE, QUNEITRA_SIDE, DARA_NORTH, DARA_CENTER].map((p) => [...p]);
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
