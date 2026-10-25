import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync(new URL('../data/places.json', import.meta.url), 'utf8'));

export const governorates = raw.governorates; // [{code, ar, en, lat, lon}]
export const districts = raw.districts; // [{code, gov, ar, en}]
export const subdistricts = raw.subdistricts || []; // [{code, dist, gov, ar, en}] (ناحية, OCHA COD-AB)
// alt: other Arabic spellings / old names, used by the search only
export const places = raw.places.map(([id, ar, en, lat, lon, gov, dist, rank, sub = '', alt = []]) => ({ id, ar, en, lat, lon, gov, dist, rank, sub, alt }));
// Well-known regions the news names as one area ("حوض اليرموك", "سهل الغاب"...): a wider circle over the
// region itself instead of a same-named neighbourhood (e.g. حي اليرموك inside Daraa city). Never a
// district / sub-district centre, never used to name a pinned point.
const REGIONS = [
  [990000001, 'حوض اليرموك', 'Yarmouk Basin', 32.786, 35.878, '06', '170904', '120003', ['منطقة حوض اليرموك', 'اليرموك', 'حوض نهر اليرموك'], 7.5],
  [990000002, 'اللجاة', 'Al-Lajat', 33.04, 36.4, '06', '169339', '', ['منطقة اللجاة', 'اللجا'], 10],
  [990000003, 'سهل الغاب', 'Al-Ghab Plain', 35.6, 36.34, '10', '173885', '', ['الغاب', 'منطقة الغاب', 'منطقة سهل الغاب'], 9],
  [990000004, 'جبل الشيخ', 'Mount Hermon', 33.39, 35.86, '08', '165928', '030801', ['جبل حرمون', 'قمة جبل الشيخ', 'سفوح جبل الشيخ'], 6],
  [990000005, 'وادي بردى', 'Wadi Barada', 33.628, 36.125, '08', '172060', '', ['منطقة وادي بردى', 'قرى وادي بردى'], 4.5],
];
for (const [id, ar, en, lat, lon, gov, dist, sub, alt, km] of REGIONS) places.push({ id, ar, en, lat, lon, gov, dist, rank: 2, sub, alt, region: true, km });

const govByCode = new Map(governorates.map((g) => [g.code, g]));
const distByCode = new Map(districts.map((d) => [d.code, d]));
const placeById = new Map(places.map((p) => [p.id, p]));
const subByCode = new Map(subdistricts.map((x) => [x.code, x]));

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
  const best = places.filter((p) => p.dist === d.code && p.rank < 9 && !p.region).sort((a, b) => a.rank - b.rank)[0];
  if (best) { d.lat = best.lat; d.lon = best.lon; d.center = best.id; }
}

export const getGov = (code) => govByCode.get(code);
export const getDist = (code) => distByCode.get(code);
export const getPlace = (id) => placeById.get(Number(id));
export const districtsOf = (gov) => districts.filter((d) => d.gov === gov && places.some((p) => p.dist === d.code));
// towns first (by size), then every village / hamlet / neighbourhood in alphabetical order
const byMenu = (a, b) => (a.rank <= 4 || b.rank <= 4 ? a.rank - b.rank : 0) || a.ar.localeCompare(b.ar, 'ar');
// camps (rank 9) are search-only: never listed in the district menus
export const placesOf = (dist) => places.filter((p) => p.dist === dist && p.rank < 9).sort(byMenu);
export const getSub = (code) => subByCode.get(code);
// sub-districts of a district that actually hold places (in the district's own order: its centre first)
export function subsOf(dist) {
  const n = new Map();
  for (const p of places) if (p.dist === dist && p.sub) n.set(p.sub, (n.get(p.sub) || 0) + 1);
  return [...n.keys()].map((c) => subByCode.get(c)).filter(Boolean)
    .sort((a, b) => (b.ar.startsWith('مركز') - a.ar.startsWith('مركز')) || a.ar.localeCompare(b.ar, 'ar'));
}
export const placesOfSub = (dist, sub) => places.filter((p) => p.dist === dist && p.sub === sub && p.rank < 9).sort(byMenu);

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

// loose key: no spaces, no article, final ا / ه / ي alike (كفرنبل = كفر نبل, عامودا = عامودة)
const loose = (n) => stripAl(n).replace(/\s+/g, '').replace(/[اهي]$/, 'ه');
const index = places.map((p) => {
  const names = [p.ar, ...(p.alt || [])].map(normalizeArabic).filter(Boolean);
  return { p, names, n2s: names.map(stripAl), ls: names.map(loose), en: normalizeArabic(p.en) };
});

export function searchPlaces(query, limit = 10) {
  const res = searchNames(query, limit);
  if (res.some((p) => !p.scope)) return res;
  // "عران الباب" / "الحانوتة، حلب": town + its district / governorate / ناحية
  // also "المعكر ريف القنيطرة" / "المعكر بريف القنيطرة الجنوبي" / "المعكر في القنيطرة": filler words dropped
  // ("ريف دمشق" stays: it is a governorate's name)
  let w = normalizeArabic(query).replace(/[،,\-–]/g, ' ').split(/\s+/).filter(Boolean);
  if (w.length >= 2) {
    const f = [w[0]];
    for (let i = 1; i < w.length; i++) {
      let x = w[i];
      if ((x === 'ريف' || x === 'بريف') && w[i + 1] === 'دمشق') { f.push('ريف'); continue; }
      if (FILL.has(x)) continue;
      if (/^ب(?=ال\S{2})/.test(x) && i === w.length - 1) x = x.slice(1); // "بالقنيطرة"
      f.push(x);
    }
    if (f.length >= 2) w = f;
  }
  for (let k = Math.min(3, w.length - 1); k >= 1; k--) {
    const tail = stripAl(w.slice(-k).join(' '));
    const inArea = (p) => [getDist(p.dist)?.ar, getGov(p.gov)?.ar, subByCode.get(p.sub)?.ar].some((x) => x && stripAl(normalizeArabic(x).replace(/^مركز /, '')) === tail);
    const hits = searchNames(w.slice(0, -k).join(' '), 200).filter((p) => !p.scope && inArea(p));
    if (hits.length) return hits.slice(0, limit);
  }
  return res;
}
const FILL = new Set(['ريف', 'بريف', 'في', 'محافظه', 'بمحافظه', 'منطقه', 'بمنطقه', 'ناحيه', 'الشرقي', 'الغربي', 'الشمالي', 'الجنوبي', 'الاوسط']);
function searchNames(query, limit) {
  const q = normalizeArabic(query);
  if (q.length < 2) return [];
  const q2 = stripAl(q);
  const ql = loose(q);
  const scored = [];
  for (const it of index) {
    let s = -1;
    for (let i = 0; i < it.names.length; i++) {
      const n = it.names[i], n2 = it.n2s[i], l = it.ls[i];
      const bonus = i === 0 ? 0 : -3; // the shown name before an alternative spelling
      let t = -1;
      if (n === q || n2 === q2) t = 100;
      else if (l === ql) t = 95;
      else if (n.startsWith(q) || n2.startsWith(q2)) t = 70;
      else if (ql.length >= 3 && l.startsWith(ql)) t = 65;
      else if (n.includes(q) || n2.includes(q2)) t = 40;
      else if (ql.length >= 4 && l.includes(ql)) t = 35;
      if (t >= 0 && t + bonus > s) s = t + bonus;
    }
    if (s < 0) {
      if (it.en === q) s = 90;
      else if (it.en.startsWith(q)) s = 60;
      else if (it.en.includes(q)) s = 30;
    }
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
    return { scope: 'place', place_id: p.id, rank: p.rank, ...(p.region ? { region: true, area_km: p.km } : {}), district: p.dist, name_ar: p.ar, name_en: p.en, district_ar: d?.ar, district_en: d?.en, governorate: p.gov, governorate_ar: g?.ar, governorate_en: g?.en, latitude: p.lat, longitude: p.lon };
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
      if (dd < bd && p.rank <= 6 && !p.region) { bd = dd; best = p; }
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
  if (Number.isFinite(loc?.area_km)) return loc.area_km; // a whole region (حوض اليرموك...)
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
  // earthquakes / weather: one circle with an explicit radius (felt area / warned area)
  if (a.place && Number.isFinite(a.place.zone_km) && a.location && Number.isFinite(a.location.latitude)) {
    out.push({ lat: a.location.latitude, lon: a.location.longitude, km: a.place.zone_km });
    for (const x of a.extra || []) if (x && Number.isFinite(x.latitude)) out.push({ lat: x.latitude, lon: x.longitude, km: Number.isFinite(x.zone_km) ? x.zone_km : a.place.zone_km });
    return out;
  }
  if (a.location && Number.isFinite(a.location.latitude)) add({ ...(a.place || {}), ...a.location }, a.scope);
  for (const x of a.extra || []) if (x && Number.isFinite(x.latitude)) add(x, x.scope);
  return out;
}
export function zonePoints(loc, scope) {
  if (!loc || !Number.isFinite(loc.latitude)) return [];
  if (scope !== 'district' && scope !== 'governorate') return [{ lat: loc.latitude, lon: loc.longitude, km: placeKm(loc) }];
  // A whole district / governorate is shown as ONE circle on its main city, sized to that city
  // (not spread over the surrounding villages). More circles appear only for areas added with ➕.
  let distCode = loc.district;
  if (scope === 'district' && !distCode) distCode = districts.find((d) => d.ar === loc.district_ar && (!loc.governorate || d.gov === loc.governorate))?.code;
  const key = scope + ':' + (scope === 'district' ? distCode : loc.governorate) + ':' + loc.latitude + ',' + loc.longitude;
  if (zoneCache.has(key)) return zoneCache.get(key);
  let center = null;
  if (scope === 'governorate') center = placeById.get(CAPITALS[loc.governorate]);
  else center = places.filter((p) => p.dist === distCode).sort((a, b) => a.rank - b.rank)[0];
  // keep the alert's own point; take the size from the centre city's rank when it is that city
  const near = center && kmBetween({ lat: center.lat, lon: center.lon }, { lat: loc.latitude, lon: loc.longitude }) < 3;
  const km = near ? Math.max(3.2, placeKm(center)) : 3.2;
  const out = [{ lat: loc.latitude, lon: loc.longitude, km }];
  zoneCache.set(key, out);
  return out;
}

// "📍 مركز منبج": the main city of a district / governorate (a single place, one circle on the map)
export const centerOfDist = (code) => { const d = getDist(code); return d && d.center ? getPlace(d.center) : null; };
export const capitalOf = (gov) => getPlace(CAPITALS[gov]) || null;
export const centerOfSub = (dist, sub) => places.filter((p) => p.dist === dist && p.sub === sub && p.rank < 9 && !p.region).sort((a, b) => a.rank - b.rank)[0] || null;
// Nothing found for "مخيم الرسم منبج" / "مخيمات الرسم": suggest the centres of the areas named in the
// text (city / district / governorate), plus the area already picked in the menu.
export function centerSuggestions(text, { gov = '', dist = '', sub = '' } = {}, limit = 4) {
  const out = [];
  const push = (p) => { if (p && !out.some((x) => x.id === p.id)) out.push(p); };
  const w = normalizeArabic(text).replace(/[،,\-–()]/g, ' ').split(/\s+/).filter((x) => x.length >= 2 && !FILL.has(x) && !/^مخيم/.test(x));
  const grams = [];
  for (let i = 0; i < w.length; i++) { grams.push(w[i]); if (w[i + 1]) grams.push(w[i] + ' ' + w[i + 1]); }
  for (const g of grams.sort((a, b) => b.length - a.length)) {
    const k = stripAl(g.replace(/^ب(?=\S{3})/, ''));
    for (const d of districts) if (stripAl(normalizeArabic(d.ar)) === k) push(centerOfDist(d.code));
    for (const v of governorates) if (stripAl(normalizeArabic(v.ar)) === k) push(capitalOf(v.code));
    for (const p of searchNames(g, 6)) if (!p.scope && p.rank <= 4 && stripAl(normalizeArabic(p.ar)) === k) push(p);
  }
  if (sub && dist) push(centerOfSub(dist, sub));
  if (dist) push(centerOfDist(dist));
  if (gov) push(capitalOf(gov));
  return out.filter(Boolean).slice(0, limit);
}

// an alert pinned on a small place whose text names a whole region of the same governorate
// ("... في أجواء منطقة حوض اليرموك" pinned on حي اليرموك in Daraa city) -> that region's location
export function regionFix(loc, text) {
  if (!loc || loc.scope === 'country' || loc.region) return null;
  const t = ' ' + normalizeArabic(text) + ' ';
  for (const p of places) {
    if (!p.region) continue;
    const gc = loc.governorate != null && loc.governorate !== '' ? String(loc.governorate).padStart(2, '0') : '';
    if (gc ? gc !== p.gov : loc.governorate_ar && normalizeArabic(getGov(p.gov)?.ar || '') !== normalizeArabic(loc.governorate_ar)) continue;
    const names = [p.ar, ...(p.alt || [])].map(normalizeArabic).filter((n) => n.includes(' ')); // full names only ("حوض اليرموك")
    if (!names.some((n) => t.includes(' ' + n + ' '))) continue;
    const cur = loc.place_id ? getPlace(Number(loc.place_id)) : null;
    const curName = normalizeArabic(cur?.ar || loc.name_ar || '');
    // only when the current place is near the region or shares a word with it (اليرموك / حوض اليرموك)
    const share = !!curName && normalizeArabic(p.ar).split(' ').some((w) => w.length > 3 && curName.includes(w));
    if (!share && kmBetween({ lat: loc.latitude, lon: loc.longitude }, p) > p.km * 3) continue;
    return locationFrom({ placeId: p.id });
  }
  return null;
}
