// Keep grouped map markers distinct without visually moving them outside the country.
export function pointInGeoJSON(data, longitude, latitude) {
  if (!data || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return false;
  const pointInRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const cross = (longitude - xi) * (yj - yi) - (latitude - yi) * (xj - xi);
      if (Math.abs(cross) < 1e-10 && longitude >= Math.min(xi, xj) - 1e-10 && longitude <= Math.max(xi, xj) + 1e-10 && latitude >= Math.min(yi, yj) - 1e-10 && latitude <= Math.max(yi, yj) + 1e-10) return true;
      if ((yi > latitude) !== (yj > latitude) && longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const polygonContains = (rings) => rings.length > 0 && pointInRing(rings[0]) && !rings.slice(1).some(pointInRing);
  const geometryContains = (geometry) => {
    if (!geometry) return false;
    if (geometry.type === 'Polygon') return polygonContains(geometry.coordinates);
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(polygonContains);
    return false;
  };
  if (data.type === 'Feature') return geometryContains(data.geometry);
  if (data.type === 'FeatureCollection') return data.features.some((feature) => geometryContains(feature.geometry));
  return geometryContains(data);
}

export function chooseClusterOffset(index, count, accepts, used = new Set()) {
  if (count <= 1) return [0, 0];
  const desired = (index / count) * Math.PI * 2 - Math.PI / 2;
  const directions = Array.from({ length: 16 }, (_, i) => i * (Math.PI / 8))
    .sort((a, b) => angularDistance(a, desired) - angularDistance(b, desired));
  const seen = new Set();
  for (const radius of [26, 20, 14, 8, 0]) {
    for (const angle of directions) {
      const offset = [Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)];
      const key = offset.join(',');
      if (seen.has(key) || used.has(key)) continue;
      seen.add(key);
      if (accepts(offset)) {
        used.add(key);
        return offset;
      }
    }
  }
  const fallback = [Math.round(Math.cos(desired) * 26), Math.round(Math.sin(desired) * 26)];
  used.add(fallback.join(','));
  return fallback;
}

function angularDistance(a, b) {
  const delta = Math.abs(a - b) % (Math.PI * 2);
  return Math.min(delta, Math.PI * 2 - delta);
}
