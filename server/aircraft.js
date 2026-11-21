// Live military-aircraft layer: adsb.lol open API (BSD-3, no key, ~500 req/day/IP anonymous).
// One shared upstream fetch per 10 minutes regardless of visitor count; clients poll our
// tiny cached JSON instead. The layer corroborates spotter reports with real tracks.
const FETCH_MS = 10 * 60_000;
const BOX = { minLat: 29, maxLat: 39.5, minLon: 32, maxLon: 46.5 };
const UPSTREAMS = [
  'https://api.adsb.lol/v2/mil',
  'https://api.adsb.lol/v2/lat/35.2/lon/38.4/dist/250',
];
let cache = { at: 0, data: { at: null, aircraft: [] } };
let lastError = null;

async function fetchUpstream(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`adsb.lol ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMilitary() {
  let j = null;
  const errs = [];
  for (const url of UPSTREAMS) {
    try { j = await fetchUpstream(url); break; } catch (e) { errs.push(`${url}: ${e.message}`); }
  }
  if (!j) throw new Error(errs.join(' | '));
  {
    const ac = Array.isArray(j.ac) ? j.ac : [];
    const out = [];
    for (const a of ac) {
      if (typeof a.lat !== 'number' || typeof a.lon !== 'number') continue;
      if (a.lat < BOX.minLat || a.lat > BOX.maxLat || a.lon < BOX.minLon || a.lon > BOX.maxLon) continue;
      out.push({
        hex: a.hex,
        cs: (a.flight || '').trim() || null,
        t: a.t || null,
        cat: a.category || null,
        lat: a.lat,
        lon: a.lon,
        trk: typeof a.track === 'number' ? a.track : (typeof a.true_heading === 'number' ? a.true_heading : null),
        alt: typeof a.alt_baro === 'number' ? a.alt_baro : null,
      });
      if (out.length >= 200) break;
    }
    return { at: new Date().toISOString(), aircraft: out };
  }
}

export async function aircraftFeed() {
  if (cache.data && Date.now() - cache.at < FETCH_MS) return cache.data;
  try {
    cache = { at: Date.now(), data: await fetchMilitary() };
  } catch (e) {
    lastError = `${new Date().toISOString()} ${e.message}`;
    console.warn('[aircraft] upstream fetch failed:', e.message);
    // serve stale
  }
  return cache.data;
}

export function aircraftState() {
  return { cachedAt: cache.at ? new Date(cache.at).toISOString() : null, count: cache.data?.aircraft?.length ?? 0, lastError };
}
