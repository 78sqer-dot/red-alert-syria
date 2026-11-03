export function zoneVisualKey(zone, style) {
  return [zone.lon, zone.lat, zone.km, style.color, style.active ? 1 : 0, style.dashed ? 1 : 0].join('|');
}

/** Count unique, valid geographic circle definitions for one activity. */
export function countUniqueZoneCircles(zones) {
  const keys = new Set();
  for (const zone of Array.isArray(zones) ? zones : []) {
    if (!zone || !Number.isFinite(zone.lon) || !Number.isFinite(zone.lat) || !Number.isFinite(zone.km)) continue;
    keys.add([zone.lon, zone.lat, zone.km].join('|'));
  }
  return keys.size;
}

export function pulseVisualKey(zone, color, classicAircraft) {
  return [zone.lon, zone.lat, zone.km, color, classicAircraft ? 'aircraft' : 'standard'].join('|');
}
