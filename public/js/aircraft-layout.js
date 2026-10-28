// Keep the warplane squad and its flight path readable at country scale without replacing it with a static icon.
export function squadLayout(radiusPx) {
  const radius = Number.isFinite(radiusPx) ? Math.max(0, radiusPx) : 0;
  return {
    flightRadius: Math.max(10, Math.min(130, Math.round(radius))),
    planeScale: Math.round(Math.min(1, 0.88 + radius / 600) * 100) / 100,
    formationScale: Math.round(Math.max(0.9, Math.min(1, radius / 36)) * 100) / 100,
  };
}
