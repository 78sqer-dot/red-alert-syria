import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync(new URL('../data/places.json', import.meta.url), 'utf8'));

export const governorates = raw.governorates; // [{code, ar, en, lat, lon}]
export const districts = raw.districts; // [{code, gov, ar, en}]
export const places = raw.places.map(([id, ar, en, lat, lon, gov, dist, rank]) => ({ id, ar, en, lat, lon, gov, dist, rank }));

const govByCode = new Map(governorates.map((g) => [g.code, g]));
const distByCode = new Map(districts.map((d) => [d.code, d]));
const placeById = new Map(places.map((p) => [p.id, p]));

// Use the governorate capital as the governorate "centre".
const CAPITALS = { '13': 170654, '08': 170654, '09': 170063, '11': 169577, '10': 170017, '02': 173576, '14': 163345, '12': 169389, '06': 170905, '05': 172408, '03': 173334, '07': 170794, '04': 172955, '01': 173811 };
for (const g of governorates) {
  const cap = placeById.get(CAPITALS[g.code]);
  if (cap) { g.lat = cap.lat; g.lon = cap.lon; }
  // Rif Dimashq's seat is Damascus city itself; use a point in the rural belt instead (between Al-Tall and Douma).
  if (g.code === '08') { g.lat = 33.62; g.lon = 36.45; }
}
// District centre = its highest-ranked place.
for (const d of districts) {
  const best = places.filter((p) => p.dist === d.code).sort((a, b) => a.rank - b.rank)[0];
  if (best) { d.lat = best.lat; d.lon = best.lon; }
}

export const getGov = (code) => govByCode.get(code);
export const getDist = (code) => distByCode.get(code);
export const getPlace = (id) => placeById.get(Number(id));
export const districtsOf = (gov) => districts.filter((d) => d.gov === gov && places.some((p) => p.dist === d.code));
export const placesOf = (dist) => places.filter((p) => p.dist === dist).sort((a, b) => a.rank - b.rank || a.ar.localeCompare(b.ar, 'ar'));

export function normalizeArabic(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // tashkeel + tatweel
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const stripAl = (s) => s.split(' ').map((w) => (w.startsWith('ال') && w.length > 3 ? w.slice(2) : w)).join(' ');

const index = places.map((p) => {
  const n = normalizeArabic(p.ar);
  return { p, n, n2: stripAl(n), en: normalizeArabic(p.en) };
});

export function searchPlaces(query, limit = 10) {
  const q = normalizeArabic(query);
  if (q.length < 2) return [];
  const q2 = stripAl(q);
  const scored = [];
  for (const it of index) {
    let s = -1;
    if (it.n === q || it.n2 === q2) s = 100;
    else if (it.n.startsWith(q) || it.n2.startsWith(q2)) s = 70;
    else if (it.en === q) s = 90;
    else if (it.en.startsWith(q)) s = 60;
    else if (it.n.includes(q) || it.n2.includes(q2)) s = 40;
    else if (it.en.includes(q)) s = 30;
    if (s >= 0) scored.push([s - it.p.rank * 2, it.p]);
  }
  // Governorates & districts can be matched too.
  for (const g of governorates) {
    const n = normalizeArabic(g.ar);
    if (n === q || stripAl(n) === q2 || normalizeArabic(g.en) === q) scored.push([120, { gov: g.code, ar: g.ar, en: g.en, lat: g.lat, lon: g.lon, scope: 'governorate', id: 'g' + g.code }]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const out = [];
  const seen = new Set();
  for (const [, p] of scored) {
    const k = p.id;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/** Build a location object stored on alerts. */
export function locationFrom({ placeId, distCode, govCode, lat, lon, label }) {
  if (placeId) {
    const p = getPlace(placeId);
    if (!p) return null;
    const d = getDist(p.dist);
    const g = getGov(p.gov);
    return { scope: 'place', place_id: p.id, rank: p.rank, district: p.dist, name_ar: p.ar, name_en: p.en, district_ar: d?.ar, district_en: d?.en, governorate: p.gov, governorate_ar: g?.ar, governorate_en: g?.en, latitude: p.lat, longitude: p.lon };
  }
  if (distCode) {
    const d = getDist(distCode);
    if (!d) return null;
    const g = getGov(d.gov);
    return { scope: 'district', district: d.code, name_ar: d.ar, name_en: d.en, district_ar: d.ar, district_en: d.en, governorate: d.gov, governorate_ar: g?.ar, governorate_en: g?.en, latitude: d.lat, longitude: d.lon };
  }
  if (govCode) {
    const g = getGov(govCode);
    if (!g) return null;
    return { scope: 'governorate', name_ar: g.ar, name_en: g.en, governorate: g.code, governorate_ar: g.ar, governorate_en: g.en, latitude: g.lat, longitude: g.lon };
  }
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    // nearest known place for naming
    let best = null; let bd = Infinity;
    for (const p of places) {
      const dd = (p.lat - lat) ** 2 + (p.lon - lon) ** 2;
      if (dd < bd && p.rank <= 6) { bd = dd; best = p; }
    }
    const near = best ? locationFrom({ placeId: best.id }) : {};
    return { ...near, scope: 'point', name_ar: label || (best ? `قرب ${best.ar}` : 'موقع محدد'), name_en: label || (best ? `Near ${best.en}` : 'Pinned location'), latitude: Number(lat.toFixed(5)), longitude: Number(lon.toFixed(5)) };
  }
  return { scope: 'country', name_ar: 'سوريا', name_en: 'Syria', latitude: null, longitude: null };
}

export function insideSyriaBox(lat, lon) {
  return lat > 32.2 && lat < 37.5 && lon > 35.5 && lon < 42.5;
}

// ---------------------------------------------------------------- affected-area circles
// Like the original map: several smaller circles, one over each affected locality, instead of one
// huge disc. A single place gets one circle; a district / governorate gets circles over its most
// important localities (by rank), spread out so they overlap only slightly.
const kmBetween = (a, b) => {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const zoneCache = new Map();
// circle radius sized to the place: big city > town > village > neighbourhood
export function placeKm(loc) {
  const r = Number.isFinite(loc?.rank) ? loc.rank : null;
  if (r == null) return 2.2;
  return r <= 1 ? 4.5 : r === 2 ? 3.2 : r === 3 ? 2.4 : r <= 5 ? 1.8 : 1.3;
}
// every circle of an alert: its main area + each extra area picked in the bot (one or more circles each)
export function alertZones(a) {
  const out = [];
  const add = (loc, scope) => {
    for (const z of zonePoints(loc, scope)) {
      if (out.some((q) => kmBetween(q, z) < Math.max(0.6, Math.min(q.km, z.km) * 0.5))) continue; // same spot twice
      out.push(z);
    }
  };
  if (a.location && Number.isFinite(a.location.latitude)) add({ ...(a.place || {}), ...a.location }, a.scope);
  for (const x of a.extra || []) if (x && Number.isFinite(x.latitude)) add(x, x.scope);
  return out;
}
export function zonePoints(loc, scope) {
  if (!loc || !Number.isFinite(loc.latitude)) return [];
  const one = [{ lat: loc.latitude, lon: loc.longitude, km: placeKm(loc) }];
  if (scope !== 'district' && scope !== 'governorate') return one;
  let distCode = loc.district;
  if (scope === 'district' && !distCode) distCode = districts.find((d) => d.ar === loc.district_ar && (!loc.governorate || d.gov === loc.governorate))?.code;
  const key = scope + ':' + (scope === 'district' ? distCode : loc.governorate);
  if (zoneCache.has(key)) return zoneCache.get(key);
  const pool = places
    .filter((p) => (scope === 'district' ? p.dist === distCode : p.gov === loc.governorate))
    .sort((a, b) => a.rank - b.rank);
  if (!pool.length) return one;
  const max = scope === 'governorate' ? 6 : 5;
  let picked = [];
  let sep = scope === 'governorate' ? 9 : 6;
  for (; sep >= 1.2; sep *= 0.6) {
    picked = [];
    for (const p of pool) {
      if (picked.every((q) => kmBetween(p, q) >= sep)) picked.push(p);
      if (picked.length >= max) break;
    }
    if (picked.length >= Math.min(4, pool.length)) break;
  }
  const km = Math.max(1.6, Math.min(4, sep * 0.62));
  const out = picked.map((p) => ({ lat: p.lat, lon: p.lon, km: +km.toFixed(2) }));
  zoneCache.set(key, out);
  return out;
}
