const finite = (value) => Number.isFinite(Number(value));

export function distanceKm(a, b) {
  const lat1 = Number(a?.lat ?? a?.latitude);
  const lon1 = Number(a?.lon ?? a?.longitude);
  const lat2 = Number(b?.lat ?? b?.latitude);
  const lon2 = Number(b?.lon ?? b?.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)
    || Math.abs(lat1) > 90 || Math.abs(lat2) > 90 || Math.abs(lon1) > 180 || Math.abs(lon2) > 180) return null;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

const key = (value) => String(value || '').normalize('NFKD')
  .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/\s+/g, ' ').trim().toLowerCase();

export function matchesFollowArea(alert, area) {
  if (!area || typeof area !== 'object') return true;
  if (alert?.scope === 'country') return true;

  const locations = [alert?.place, ...(Array.isArray(alert?.more) ? alert.more : [])].filter(Boolean);
  if (area.type === 'governorate') {
    const code = String(area.code || '');
    const names = new Set([key(area.name_ar), key(area.name_en)].filter(Boolean));
    return locations.some((place) => {
      const placeCode = String(place.governorate ?? place.governorate_code ?? place.gov ?? '');
      if (code && placeCode === code) return true;
      return [place.governorate_ar, place.governorate_en].some((name) => names.has(key(name)));
    });
  }

  if (area.type !== 'place') return false;
  const placeId = String(area.placeId ?? area.id ?? '');
  if (placeId && String(alert?.location?.place_id ?? '') === placeId) return true;

  const areaNames = new Set([key(area.name_ar), key(area.name_en)].filter(Boolean));
  if (areaNames.size && locations.some((place) => {
    const names = [place.name_ar, place.name_en].map(key);
    const placeCode = String(place.governorate ?? place.governorate_code ?? place.gov ?? '');
    return names.some((name) => areaNames.has(name)) && (!area.code || !placeCode || String(area.code) === placeCode);
  })) return true;

  const center = { lat: area.lat ?? area.latitude, lon: area.lon ?? area.longitude };
  if (!finite(center.lat) || !finite(center.lon)) return false;
  const radius = Math.min(50, Math.max(0, Number(area.radiusKm) || 2.2));
  const circles = [];
  if (alert?.location) circles.push({ ...alert.location, km: 0 });
  if (Array.isArray(alert?.zones)) circles.push(...alert.zones);
  return circles.some((circle) => {
    const distance = distanceKm(center, circle);
    const circleRadius = Math.min(100, Math.max(0, Number(circle?.km) || 0));
    return distance != null && distance <= radius + circleRadius;
  });
}
