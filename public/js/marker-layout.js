// Exact-coordinate grouping remains available for callers that need geographic identity.
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

// Cluster visually overlapping markers in screen pixels, without changing source coordinates.
// A spatial grid keeps the work close to O(n) for the many move/zoom-end refreshes.
export function clusterAlertsByScreen(alerts, map, selectedId = null, radiusPx = 34) {
  if (!map || typeof map.project !== 'function') return groupAlerts(alerts, selectedId);
  const radius = Number.isFinite(radiusPx) && radiusPx > 0 ? radiusPx : 34;
  const radiusSquared = radius * radius;
  const positioned = [];

  alerts.forEach((alert, index) => {
    const location = alert.location;
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return;
    let point;
    try { point = map.project([location.longitude, location.latitude]); } catch { return; }
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    positioned.push({ alert, index, x: point.x, y: point.y });
  });

  // Keep the selected marker as the cluster anchor when a selection changes its representative.
  positioned.sort((a, b) => Number(b.alert.id === selectedId) - Number(a.alert.id === selectedId) || a.index - b.index);
  const cells = new Map();
  const clusters = [];
  for (const item of positioned) {
    const cellX = Math.floor(item.x / radius);
    const cellY = Math.floor(item.y / radius);
    let nearest = null;
    let nearestDistance = radiusSquared;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const candidates = cells.get(`${cellX + dx},${cellY + dy}`) || [];
      for (const clusterIndex of candidates) {
        const cluster = clusters[clusterIndex];
        const distance = (item.x - cluster.x) ** 2 + (item.y - cluster.y) ** 2;
        if (distance <= nearestDistance) { nearest = clusterIndex; nearestDistance = distance; }
      }
    }
    if (nearest === null) {
      nearest = clusters.length;
      clusters.push({ x: item.x, y: item.y, members: [] });
      const key = `${cellX},${cellY}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(nearest);
    }
    clusters[nearest].members.push(item);
  }

  return clusters
    .map(({ members }) => {
      members.sort((a, b) => a.index - b.index);
      const membersAlerts = members.map(({ alert }) => alert);
      const ids = membersAlerts.map((alert) => String(alert.id)).sort();
      return {
        key: JSON.stringify(ids),
        alerts: membersAlerts,
        representative: membersAlerts.find((alert) => alert.id === selectedId) || membersAlerts[0],
        _firstIndex: members[0].index,
      };
    })
    .sort((a, b) => a._firstIndex - b._firstIndex)
    .map(({ _firstIndex, ...cluster }) => cluster);
}

export function nextAlertId(group, selectedId = null) {
  if (!group || !group.alerts.length) return null;
  const index = group.alerts.findIndex((alert) => alert.id === selectedId);
  return group.alerts[index < 0 ? 0 : (index + 1) % group.alerts.length].id;
}
