// Display-only override for the one existing alert the owner asked to show with one drone.
// The alert's saved text and general drone classification remain unchanged.
const SINGLE_DRONE_DISPLAY_ALERT_IDS = new Set([
  'a547f1dc-073a-4c81-a8cb-ae921c7d75e4',
]);

export function mapDroneCount(alert) {
  if (SINGLE_DRONE_DISPLAY_ALERT_IDS.has(alert?.id)) return 1;
  return Math.max(1, Math.min(3, Number(alert?.drones) || 1));
}

export function hasSecondaryDrone(alert) {
  return alert?.drone_presence === true;
}
