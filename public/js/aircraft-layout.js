// Scale only the SVG airframes, never the orbit: each path must cover its own displayed circle.
export function squadLayout(radiusPx) {
  const radius = Number.isFinite(radiusPx) ? Math.max(0, radiusPx) : 0;
  return {
    flightRadius: Math.max(10, Math.round(radius)),
    planeScale: Math.round(Math.min(0.95, 0.7 + radius / 260) * 100) / 100,
  };
}
