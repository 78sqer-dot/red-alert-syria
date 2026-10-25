// Earthquake alerts: polls EMSC + USGS for quakes felt in Syria, posts each one once (auto, no review)
// to the channel and the map as a normal alert (type "quake"), deduplicated across the two sources.
import { store } from './store.js';
import { config } from './config.js';
import { places, locationFrom } from './places.js';

const UA = 'RedAlertSyria/1.0 (+https://red-alert-syria.onrender.com)';
const BOX = { minlat: 28.5, maxlat: 40.5, minlon: 31, maxlon: 46 };
const POLL_MS = 2 * 60_000;
const MAX_AGE_MS = 90 * 60_000; // never post a quake older than this (first boot, outages)
const R = { api: null, started: false, lastPoll: 0, lastErr: {}, lastEvents: [] };

export function quakeState() {
  const svc = (store.state.svc ||= {});
  const q = (svc.quakes ||= {});
  q.on ??= true;
  q.seen ||= {}; // source event id -> ms
  q.posted ||= []; // [{t, lat, lon, mag, id}] for cross-source dedup
  return q;
}
const save = () => store.persist();

// ---------------------------------------------------------------- geometry & wording
const RAD = Math.PI / 180;
export function km(a, b) {
  const dLat = (b.lat - a.lat) * RAD; const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
const DIRS_AR = ['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب'];
const DIRS_EN = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const dirIdx = (deg) => Math.round(deg / 45) % 8;
const BIG = places.filter((p) => p.rank <= 1); // governorate capitals
const ALL = places.filter((p) => p.rank <= 7);
const TOWNS = places.filter((p) => p.rank <= 5);
function nearest(list, e) {
  let best = null; let bd = Infinity;
  for (const p of list) {
    const d = km(e, p);
    if (d < bd) { bd = d; best = p; }
  }
  return { p: best, d: bd };
}
const REGIONS = [
  [/SYRIA/i, 'سوريا', 'Syria'], [/TURKEY|TÜRKIYE|TURKIYE/i, 'تركيا', 'Türkiye'], [/LEBANON/i, 'لبنان', 'Lebanon'],
  [/IRAQ/i, 'العراق', 'Iraq'], [/JORDAN/i, 'الأردن', 'Jordan'], [/CYPRUS/i, 'قبرص', 'Cyprus'],
  [/ISRAEL|WEST BANK|DEAD SEA|PALESTIN|GAZA/i, 'فلسطين المحتلة', 'Palestine'], [/IRAN/i, 'إيران', 'Iran'],
  [/MEDITERRANEAN/i, 'شرق البحر المتوسط', 'Eastern Mediterranean'], [/EGYPT|SINAI/i, 'مصر', 'Egypt'],
  [/SAUDI/i, 'السعودية', 'Saudi Arabia'],
];
function regionOf(text) {
  for (const [re, ar, en] of REGIONS) if (re.test(text || '')) return { ar, en };
  return null;
}
/** felt-in-Syria rule: small quakes only when inside/at the edge of Syria, bigger ones farther away */
export function isRelevant(e) {
  const { d } = nearest(ALL, e);
  const m = e.mag;
  if (!Number.isFinite(m)) return false;
  if (d <= 30) return m >= 3.0;
  if (d <= 100) return m >= 4.0;
  if (d <= 250) return m >= 5.0;
  if (d <= 600) return m >= 6.0;
  return false;
}
const strength = (m, en) => (m >= 6 ? (en ? 'very strong' : 'قوي جداً') : m >= 5 ? (en ? 'strong' : 'قوي') : m >= 4 ? (en ? 'moderate' : 'متوسط') : (en ? 'light' : 'خفيف'));
/** approximate radius (km) of the area where the shaking may be felt (map circle) */
export const feltKm = (m) => Math.round(Math.max(6, Math.min(220, 8 * 2.8 ** (m - 3))));

export function describe(e) {
  const inSyria = nearest(ALL, e);
  const city = nearest(BIG, e);
  const region = regionOf(e.region);
  const syria = inSyria.d <= 15 && (!region || region.ar === 'سوريا');
  const m = Math.round(e.mag * 10) / 10;
  const ms = m.toFixed(1);
  const d = Math.round(city.d);
  const di = dirIdx(bearing(city.p, e));
  let loc;
  if (syria) {
    const town = nearest(TOWNS, e);
    const near = town.d <= 20 ? town.p : inSyria.p;
    inSyria.d = town.d <= 20 ? town.d : inSyria.d;
    const nearTxt = inSyria.d < 4 ? `${near.ar}` : `قرب ${near.ar}`;
    const nearEn = inSyria.d < 4 ? near.en : `Near ${near.en}`;
    loc = { ...locationFrom({ placeId: near.id }), scope: 'point', name_ar: nearTxt, name_en: nearEn };
  } else {
    const where = region ? ` (${region.ar})` : '';
    const whereEn = region ? ` (${region.en})` : '';
    loc = {
      scope: 'point',
      name_ar: d < 5 ? `${city.p.ar}${where}` : `على بعد ${d} كم ${DIRS_AR[di]} ${city.p.ar}${where}`,
      name_en: d < 5 ? `${city.p.en}${whereEn}` : `${d} km ${DIRS_EN[di]} of ${city.p.en}${whereEn}`,
      // short header label for the image: "تركيا · 198 كم شمال غرب حلب"
      short_ar: `${region ? region.ar + ' · ' : ''}${d} كم ${DIRS_AR[di]} ${city.p.ar}`,
      short_en: `${region ? region.en + ' · ' : ''}${d} km ${DIRS_EN[di]} of ${city.p.en}`,
    };
  }
  loc.latitude = Number(e.lat.toFixed(4)); loc.longitude = Number(e.lon.toFixed(4));
  loc.zone_km = feltKm(m);
  const depth = Number.isFinite(e.depth) ? Math.max(1, Math.round(e.depth)) : null;
  const descAr = [
    `زلزال ${strength(m)} بقوة ${ms} درجة${depth ? `، على عمق ${depth} كم` : ''}.`,
    syria ? null : `مركزه ${region ? `في ${region.ar}، ` : ''}على بعد نحو ${d} كم ${DIRS_AR[di]} ${city.p.ar}.`,
    m >= 4.5 ? 'إذا شعرت بهزة: ابتعد عن النوافذ والجدران الخارجية، وإذا كنت في الداخل احتمِ تحت طاولة متينة، ولا تستخدم المصعد.' : null,
  ].filter(Boolean).join('\n');
  return {
    type: 'quake',
    title: `زلزال بقوة ${ms} — ${loc.name_ar}`,
    title_en: `M${ms} earthquake — ${loc.name_en}`,
    description: descAr,
    location: loc,
    areas: [loc.name_ar],
    ttlMin: m >= 5 ? 180 : 120,
    source: 'quake',
    author: { id: 0, name: e.src.toUpperCase() },
    meta: { mag: m, depth, src: e.src, ids: [e.id], at: new Date(e.t).toISOString(), inSyria: syria },
  };
}

// ---------------------------------------------------------------- sources
async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(25_000) });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString().slice(0, 19);
async function fromEmsc() {
  const u = `https://www.seismicportal.eu/fdsnws/event/1/query?format=json&start=${isoAgo(6 * 3600_000)}&minlat=${BOX.minlat}&maxlat=${BOX.maxlat}&minlon=${BOX.minlon}&maxlon=${BOX.maxlon}&minmag=2.8&limit=100&orderby=time`;
  const j = await getJson(u);
  return (j?.features || []).map((f) => {
    const p = f.properties || {};
    return { src: 'emsc', id: 'emsc:' + (p.unid || f.id), t: Date.parse(p.time), lat: Number(p.lat), lon: Number(p.lon), depth: Number(p.depth), mag: Number(p.mag), region: p.flynn_region || '' };
  });
}
async function fromUsgs() {
  const u = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${isoAgo(6 * 3600_000)}&minlatitude=${BOX.minlat}&maxlatitude=${BOX.maxlat}&minlongitude=${BOX.minlon}&maxlongitude=${BOX.maxlon}&minmagnitude=2.8&orderby=time&limit=100`;
  const j = await getJson(u);
  return (j?.features || []).map((f) => {
    const p = f.properties || {}; const c = f.geometry?.coordinates || [];
    return { src: 'usgs', id: 'usgs:' + f.id, t: Number(p.time), lat: Number(c[1]), lon: Number(c[0]), depth: Number(c[2]), mag: Number(p.mag), region: p.place || '' };
  });
}
/** same physical event reported by two agencies */
export const sameQuake = (a, b) => Math.abs(a.t - b.t) < 120_000 && km(a, b) < 120;

// ---------------------------------------------------------------- posting
async function publish(input) {
  const { publishInput } = await import('./bot.js');
  const api = R.api?.();
  if (!api) throw new Error('admin bot not ready');
  const toChannel = quakeState().on && Boolean(config.channel);
  return publishInput(api, input, { toChannel });
}
async function maybeUpdate(prev, e) {
  // a later / other-agency magnitude differs noticeably -> fix the live alert text (map + channel post)
  if (!prev.id || Math.abs(prev.mag - e.mag) < 0.4) return;
  const a = store.getAlert(prev.id);
  if (!a || !a.is_active) return;
  const fresh = describe({ ...e, lat: prev.lat, lon: prev.lon });
  prev.mag = Math.round(e.mag * 10) / 10;
  store.updateAlert(a.id, { title: fresh.title, title_en: fresh.title_en, description: fresh.description, meta: { ...(a.meta || {}), mag: prev.mag } });
  try { const { refreshChannelPost } = await import('./bot.js'); await refreshChannelPost(R.api?.(), store.getAlert(a.id), false); } catch (err) { console.warn('[quake] channel edit failed', err.message); }
}

export async function pollQuakes({ dry = false } = {}) {
  const st = quakeState();
  R.lastPoll = Date.now();
  const lists = await Promise.all([
    fromEmsc().then((x) => { R.lastErr.emsc = ''; return x; }).catch((e) => { R.lastErr.emsc = e.message; return []; }),
    fromUsgs().then((x) => { R.lastErr.usgs = ''; return x; }).catch((e) => { R.lastErr.usgs = e.message; return []; }),
  ]);
  const now = Date.now();
  const events = lists.flat().filter((e) => Number.isFinite(e.t) && Number.isFinite(e.lat) && Number.isFinite(e.lon) && Number.isFinite(e.mag))
    .sort((a, b) => a.t - b.t);
  R.lastEvents = events.slice(-30).map((e) => ({ ...e, relevant: isRelevant(e) }));
  const out = [];
  let changed = false;
  for (const e of events) {
    if (st.seen[e.id]) continue;
    st.seen[e.id] = now; changed = true;
    const prev = st.posted.find((p) => sameQuake(p, e));
    if (prev) { if (!dry) await maybeUpdate(prev, e); continue; }
    if (!isRelevant(e)) continue;
    if (now - e.t > MAX_AGE_MS) continue;
    // swarm guard: at most 6 posts per hour; small aftershocks right next to a posted one are skipped
    const hour = st.posted.filter((p) => now - p.at < 3600_000);
    if (hour.length >= 6) continue;
    if (e.mag < 4.5 && hour.some((p) => km(p, e) < 40 && p.mag >= e.mag)) continue;
    const input = describe(e);
    const rec = { t: e.t, lat: e.lat, lon: e.lon, mag: input.meta.mag, at: now, id: null };
    st.posted.push(rec);
    if (dry) { out.push(input); continue; }
    try {
      const a = await publish(input);
      rec.id = a?.id || null;
      out.push(a);
      console.log(`[quake] posted M${input.meta.mag} ${input.location.name_en} (${e.src})`);
    } catch (err) {
      console.error('[quake] publish failed', err.description || err.message);
    }
  }
  // prune memory
  for (const [k, v] of Object.entries(st.seen)) if (now - v > 3 * 86400_000) { delete st.seen[k]; changed = true; }
  st.posted = st.posted.filter((p) => now - p.at < 2 * 86400_000);
  if (changed && !dry) save();
  return out;
}

export function startQuakes(getApi) {
  R.api = getApi;
  if (R.started) return;
  R.started = true;
  let busy = false;
  const tick = async () => {
    if (busy || !quakeState().on) return;
    busy = true;
    try { await pollQuakes(); } catch (e) { console.error('[quake] poll failed', e.message); } finally { busy = false; }
  };
  setTimeout(tick, 25_000).unref();
  setInterval(tick, POLL_MS).unref();
}
export function quakesDebug() {
  const st = quakeState();
  return { on: st.on, lastPoll: R.lastPoll, errors: R.lastErr, posted: st.posted, seen: Object.keys(st.seen).length, recent: R.lastEvents };
}

// ---------------------------------------------------------------- owner menu
export function registerQuakeTools(bot, h) {
  const en = (ctx) => h.langOf(ctx) === 'en';
  const txt = (ctx) => {
    const st = quakeState();
    const last = st.posted.filter((p) => p.id).slice(-3).reverse()
      .map((p) => `• M${p.mag} — ${new Intl.DateTimeFormat(en(ctx) ? 'en-GB' : 'ar-SY', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(p.t))}`).join('\n');
    return en(ctx)
      ? `🌍 <b>Earthquake alerts</b>\n\nStatus: <b>${st.on ? '✅ On' : '⏸ Off'}</b>\nSources: EMSC + USGS, checked every 2 minutes.\nPosted automatically to the channel and the map when felt in Syria:\n• inside Syria M3+ · within 100 km M4+ · within 250 km M5+ · farther M6+\n\n<b>Recent:</b>\n${last || '— none yet'}`
      : `🌍 <b>تنبيهات الزلازل</b>\n\nالحالة: <b>${st.on ? '✅ مفعّلة' : '⏸ موقوفة'}</b>\nالمصادر: EMSC وUSGS، فحص كل دقيقتين.\nبتنشر لحالها بالقناة وعلى الخريطة إذا الهزة ممكن تنحس بسوريا:\n• داخل سوريا من 3 درجات · لحد 100 كم من 4 · لحد 250 كم من 5 · أبعد من 6\n\n<b>آخر الهزات:</b>\n${last || '— لسا ما في'}`;
  };
  const kb = (ctx) => ({ inline_keyboard: [
    [{ text: quakeState().on ? (en(ctx) ? '⏸ Turn off' : '⏸ إيقاف') : (en(ctx) ? '▶️ Turn on' : '▶️ تشغيل'), callback_data: 'qk:toggle' }],
    [{ text: en(ctx) ? '🏠 Menu' : '🏠 القائمة', callback_data: 'home' }],
  ] });
  bot.callbackQuery('qk', async (ctx) => {
    if (!h.owner(ctx)) return ctx.answerCallbackQuery().catch(() => {});
    await ctx.answerCallbackQuery().catch(() => {});
    await h.show(ctx, txt(ctx), kb(ctx));
  });
  bot.callbackQuery('qk:toggle', async (ctx) => {
    if (!h.owner(ctx)) return ctx.answerCallbackQuery().catch(() => {});
    const st = quakeState(); st.on = !st.on; save();
    await ctx.answerCallbackQuery({ text: st.on ? '✅' : '⏸' }).catch(() => {});
    await h.show(ctx, txt(ctx), kb(ctx));
  });
}
