// A schematic screen-space offset for the warplane marker, not a flight track.
// It follows the map's projected east direction and leaves the alert itself pinned.
const FALLBACK_EAST_OFFSET = Object.freeze({ x: 110, y: 0 });

export function warplaneEastOffset(map, location, viewportWidth = 430, markerScale = 0.5) {
  const longitude = Number(location?.longitude);
  const latitude = Number(location?.latitude);
  if (!map || typeof map.project !== 'function' || !Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return { ...FALLBACK_EAST_OFFSET };
  }

  try {
    const origin = map.project([longitude, latitude]);
    const east = map.project([longitude + 0.1, latitude]);
    const dx = Number(east?.x) - Number(origin?.x);
    const dy = Number(east?.y) - Number(origin?.y);
    const projectedLength = Math.hypot(dx, dy);
    if (!Number.isFinite(projectedLength) || projectedLength < 1e-6) return { ...FALLBACK_EAST_OFFSET };

    const width = Number(viewportWidth);
    const safeWidth = Number.isFinite(width) && width > 0 ? width : 430;
    const screenDistance = Math.max(96, Math.min(150, safeWidth * 0.25));
    const scale = Number(markerScale);
    const outerScale = Math.max(0.1, (Number.isFinite(scale) && scale > 0 ? scale : 0.5) * 1.3);
    const localDistance = screenDistance / outerScale;
    return {
      x: Math.round((dx / projectedLength) * localDistance * 100) / 100,
      y: Math.round((dy / projectedLength) * localDistance * 100) / 100,
    };
  } catch {
    return { ...FALLBACK_EAST_OFFSET };
  }
}
