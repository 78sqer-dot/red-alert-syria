export function zoneVisualKey(zone, style) {
  return [zone.lon, zone.lat, zone.km, style.color, style.active ? 1 : 0, style.dashed ? 1 : 0].join('|');
}

export function pulseVisualKey(zone, color, classicAircraft) {
  return [zone.lon, zone.lat, zone.km, color, classicAircraft ? 'aircraft' : 'standard'].join('|');
}
