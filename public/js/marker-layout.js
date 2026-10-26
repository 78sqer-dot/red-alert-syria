// Same-place alerts share one visible, exactly anchored marker rather than being
// displaced away from their affected-area circles or across a national border.
export function groupAlerts(alerts, selectedId = null) {
  const groups = new Map();
  for (const alert of alerts) {
    const location = alert.location;
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) continue;
    const key = `${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(alert);
  }
  return [...groups.entries()].map(([key, members]) => ({
    key,
    alerts: members,
    representative: members.find((alert) => alert.id === selectedId) || members[0],
  }));
}

export function nextAlertId(group, selectedId = null) {
  if (!group || !group.alerts.length) return null;
  const index = group.alerts.findIndex((alert) => alert.id === selectedId);
  return group.alerts[index < 0 ? 0 : (index + 1) % group.alerts.length].id;
}
