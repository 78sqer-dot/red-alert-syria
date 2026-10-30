// 💱 Daily prices bulletin: Central Bank exchange rates and official fuel decisions only, in NEW Syrian
// lira (old lira = new × 100). Unofficial market quotes, gold and aggregator tariffs are not published.
// Sources:
//  - Central Bank of Syria: official page bulletins, read with Gemini and dated from the printed issue date.
//  - Fuel: SANA's official feed for Ministry of Energy / pricing-committee decisions.
// Wrong numbers are worse than none: every value is range-checked; with no verified official data, nothing is posted.
import { InlineKeyboard, InputFile } from 'grammy';
import { config } from './config.js';
import { store } from './store.js';
import { damascusParts } from './stats-image.js';
import { svgToPng, channelBadge, badgeWidth } from './alert-image.js';
import { fetchSanaFuel, mergeFuel, fuelView, STALE_H } from './fuel.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOGO = (() => {
  try {
    return fs.readFileSync(path.join(ROOT, '..', 'public', 'img', 'icon.svg'), 'utf8').replace(/<\?xml[^>]*>/, '')
      .replace(/<svg([^>]*?)\s(width|height)="[^"]*"/, '<svg$1').replace(/<svg([^>]*?)\s(width|height)="[^"]*"/, '<svg$1');
  } catch { return ''; }
})();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const CB_FACEBOOK_PAGE_ID = '100069248257915';
const CB_FACEBOOK_URL = 'https://www.facebook.com/cb.gov.sy/';
const CB_FACEBOOK_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Linux"',
  'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1', 'Upgrade-Insecure-Requests': '1',
};
const H_MS = 3600_000;
const AR_MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const siteUrl = () => (config.publicUrl || 'https://red-alert-syria.onrender.com').replace(/\/$/, '');
export const PRICE_TIMES = ['08:00', '08:30', '09:00', '09:30', '10:00', '11:00'];

// ---------------------------------------------------------------- state
export function pricesState() {
  const s = (store.state.svc ||= {});
  const p = (s.prices ||= {});
  p.cfg ||= { on: true, time: '09:00', last: null };
  if (!PRICE_TIMES.includes(p.cfg.time)) p.cfg.time = '09:00';
  return p;
}
const save = (soon = true) => store.persist({ backupSoon: soon });

// ---------------------------------------------------------------- number helpers
/** new-lira value with sensible decimals: 142.5 -> "142.50", 16018 -> "16,018" */
export function fmtNew(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const d = v < 10 ? 2 : v < 1000 ? 2 : 0;
  const s = v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return d ? s.replace(/\.00$/, '') : s;
}
export const fmtOld = (v) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v * 100).toLocaleString('en-US'));
const n100 = (x) => (Number.isFinite(Number(x)) ? Math.round(Number(x)) / 100 : null);

// ---------------------------------------------------------------- sp-today
function balanced(s, i) {
  let d = 0; let inS = false; let e = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inS) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') inS = false; continue; }
    if (c === '"') inS = true; else if (c === '{' || c === '[') d++; else if (c === '}' || c === ']') { d--; if (!d) return s.slice(i, j + 1); }
  }
  return null;
}
function pickJson(chunks, marker, whole = false) {
  const i = chunks.indexOf(marker);
  if (i < 0) return null;
  const k = whole ? i : i + marker.length - 1; // the whole marker object, or the value after the key
  try { return JSON.parse(balanced(chunks, k)); } catch { return null; }
}
/** parse the sp-today home page HTML -> normalized prices (new lira) */
export function parseSpToday(html) {
  const chunks = [...String(html).matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return ''; } }).join('');
  const home = pickJson(chunks, '{"lang":"ar","data":{', true);
  return parseSpData(home?.data || {}, pickJson(chunks, '"energy":{') || {});
}
/** sp-today data objects (home page embed, or api-v2 overview + energy) -> normalized prices (new lira) */
export function parseSpData(data, energy) {
  const rate = (code) => {
    const r = (data.rates || []).find((x) => x.code === code);
    const c = r?.cities?.damascus;
    if (!c) return null;
    return { buy: n100(c.buy), sell: n100(c.sell), change: Number(c.change) || 0, at: r.updated_at || null, aleppo: null };
  };
  const karat = (k) => {
    const g = (data.gold?.karats || []).find((x) => x.karat === k);
    const c = g?.cities?.damascus;
    return c ? { buy: n100(c.buy), sell: n100(c.sell), change: Number(c.change) || 0 } : null;
  };
  const fuel = {};
  for (const f of energy.fuel_types || []) fuel[f.slug] = { price: n100(f.price_syp), usd: f.price_usd, name: f.name, unit: f.unit, at: f.updated_at };
  const power = (energy.electricity_tiers || []).map((t) => ({ slug: t.slug, name: t.name, unit: t.unit, price: n100(t.price_syp), at: t.updated_at }));
  return {
    src: 'sp-today.com',
    at: data.currencies_updated_at || data.updated_at || null,
    goldAt: data.gold_updated_at || null,
    usd: rate('USD'), eur: rate('EUR'), try: rate('TRY'), sar: rate('SAR'), aed: rate('AED'),
    gold: { k24: karat('24K'), k21: karat('21K'), k18: karat('18K'), ounce: Number(data.gold?.ounce?.price_usd || data.gold?.spot_price?.price_usd) || null },
    fuel,
    fuelAt: energy.fuel_updated_at || null,
    power,
    powerAt: energy.electricity_updated_at || null,
  };
}
/** range checks: anything implausible -> reason string (null = fine) */
export function checkSp(p, now = Date.now()) {
  if (!p) return 'no data';
  const inR = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
  if (!p.usd || !inR(p.usd.buy, 40, 2000) || !inR(p.usd.sell, 40, 2000) || p.usd.sell < p.usd.buy) return 'USD rate missing or out of range';
  if (p.eur && (!inR(p.eur.buy / p.usd.buy, 0.9, 1.5))) return 'EUR/USD ratio implausible';
  if (p.try && (!inR(p.usd.buy / p.try.buy, 10, 120))) return 'TRY rate implausible';
  const k21 = p.gold?.k21?.buy;
  if (k21 != null && !inR(k21 / p.usd.buy, 40, 400)) return 'gold 21K implausible';
  const at = Date.parse(p.at || '');
  if (!Number.isFinite(at) || now - at > 30 * H_MS) return 'parallel-market rates older than 30 hours';
  return null;
}
export async function fetchSpToday() {
  // sp-today's CDN blocks some datacenter IPs (Render gets HTTP 403), so fall back to a read-proxy
  // that returns the same raw HTML (same embedded data, parsed and sanity-checked the same way).
  const tries = [
    ['direct', 'https://sp-today.com/', { 'User-Agent': UA, 'Accept-Language': 'ar,en;q=0.8' }],
    ['api', null, null],
    ['proxy', 'https://r.jina.ai/https://sp-today.com/', { 'X-Return-Format': 'html', 'X-Engine': 'direct', 'X-No-Cache': 'true' }],
  ];
  const errs = [];
  for (const [how, url, headers] of tries) {
    try {
      if (how === 'api') {
        // the site's own JSON API (the browser calls it from https://sp-today.com)
        const h = { 'User-Agent': UA, Origin: 'https://sp-today.com', Referer: 'https://sp-today.com/', Accept: 'application/json' };
        const get = async (path) => {
          const r = await fetch(`https://api-v2.sp-today.com/api/v1/${path}`, { headers: h, signal: AbortSignal.timeout(25_000) });
          if (!r.ok) throw new Error(`api ${path.split('?')[0]} HTTP ${r.status}`);
          const j = await r.json();
          if (!j?.ok || !j.data) throw new Error(`api ${path.split('?')[0]} not ok`);
          return j.data;
        };
        const data = await get('overview?lang=ar&city=damascus');
        const energy = await get('energy?lang=ar').catch(() => ({}));
        const out = parseSpData(data, energy);
        if (!out?.usd?.buy) throw new Error('no rates in api');
        out.via = how;
        return out;
      }
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(how === 'proxy' ? 45_000 : 25_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const out = parseSpToday(await r.text());
      if (!out?.usd?.buy) throw new Error('no rates in page');
      out.via = how;
      return out;
    } catch (e) { errs.push(`${how}: ${e.message}`); }
  }
  throw new Error(`sp-today ${errs.join('; ')}`);
}

// ---------------------------------------------------------------- Central Bank (official bulletin)
const OCR_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_bulletin: { type: 'BOOLEAN' },
    bulletin_date: { type: 'STRING', nullable: true },
    bulletin_no: { type: 'STRING', nullable: true },
    usd_buy: { type: 'NUMBER', nullable: true }, usd_sell: { type: 'NUMBER', nullable: true },
    eur_buy: { type: 'NUMBER', nullable: true }, eur_sell: { type: 'NUMBER', nullable: true },
    try_buy: { type: 'NUMBER', nullable: true }, try_sell: { type: 'NUMBER', nullable: true },
  },
  required: ['is_bulletin', 'usd_buy', 'usd_sell'],
};
/** Public photo candidates from the official Central Bank Facebook page, newest first. */
export async function latestBulletinPosts() {
  const r = await fetch(CB_FACEBOOK_URL, { headers: CB_FACEBOOK_HEADERS, signal: AbortSignal.timeout(35_000) });
  if (!r.ok) throw new Error(`Central Bank Facebook HTTP ${r.status}`);
  if (/\/login\//i.test(r.url || '')) throw new Error('Central Bank Facebook redirected to login');
  const html = await r.text();
  const posts = []; const seen = new Set();
  const re = /"__typename":"Photo","id":"(\d{13,17})","viewer_image":\{"uri":"((?:\\.|[^"\\])*?)","height":(\d+),"width":(\d+)\}/g;
  for (const m of html.matchAll(re)) {
    const id = m[1]; const height = Number(m[3]); const width = Number(m[4]);
    if (seen.has(id) || width < 800 || height < 1000 || height / width < 1.1) continue;
    const block = html.slice(m.index, m.index + 4200);
    const owner = block.match(/"owner":\{"__typename":"(?:User|Page)","id":"(\d+)"/);
    if (owner && owner[1] !== CB_FACEBOOK_PAGE_ID) continue;
    seen.add(id);
    const img = JSON.parse(`"${m[2]}"`);
    posts.push({ id, ts: Date.now(), img, url: `https://www.facebook.com/photo/?fbid=${id}` });
    if (posts.length >= 8) break;
  }
  return posts;
}
export async function latestBulletinPost() { return (await latestBulletinPosts())[0] || null; }
export async function ocrBulletin(imgUrl) {
  const key = process.env.GEMINI_API_KEY || '';
  if (!key) throw new Error('no GEMINI_API_KEY');
  const ir = await fetch(imgUrl, { headers: { 'User-Agent': CB_FACEBOOK_HEADERS['User-Agent'], Referer: 'https://www.facebook.com/', Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' }, signal: AbortSignal.timeout(25_000) });
  if (!ir.ok) throw new Error(`image HTTP ${ir.status}`);
  const mimeType = (ir.headers.get('content-type') || 'image/jpeg').split(';')[0];
  if (!mimeType.startsWith('image/')) throw new Error(`unexpected image content type ${mimeType}`);
  const b64 = Buffer.from(await ir.arrayBuffer()).toString('base64');
  const configured = (process.env.PRICES_AI_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Always keep working fallbacks after any Render override; a retired model must not block the official rate.
  const models = [...new Set([...configured, 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-3.5-flash', 'gemini-2.5-flash'])];
  const prompt = 'This image should be the official daily exchange-rate bulletin of the Central Bank of Syria (مصرف سورية المركزي - نشرة أسعار العملات). '
    + 'Read the table EXACTLY as printed. Return the buy (شراء) and sell (مبيع) rate in Syrian pounds for: US dollar (دولار أمريكي), Euro (يورو), Turkish lira (ليرة تركية). '
    + 'Return numbers exactly as printed (e.g. 121.50). Also read the bulletin number if visible. bulletin_date: the issue date printed on the image as YYYY-MM-DD. is_bulletin=true only when this is an official Central Bank exchange-rate bulletin, not just any image that mentions prices.';
  const errors = [];
  for (const m of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimeType, data: b64 } }, { text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: OCR_SCHEMA } }),
        signal: AbortSignal.timeout(45_000),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(`${m}: HTTP ${res.status} ${(j.error?.message || '').slice(0, 180)}`);
        if ([401, 403, 429].includes(res.status)) err.fatal = true;
        throw err;
      }
      return JSON.parse((j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
    } catch (e) { errors.push(e.message); if (e.fatal) break; }
  }
  throw new Error(`Gemini OCR failed: ${errors.join(' | ').slice(0, 1000) || 'no compatible model'}`);
}
export function checkOfficial(o, sp) {
  if (!o || o.is_bulletin !== true) return 'not a bulletin';
  const inR = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
  if (!inR(o.usd_buy, 40, 2000) || !inR(o.usd_sell, 40, 2000) || o.usd_sell < o.usd_buy || o.usd_sell / o.usd_buy > 1.05) return 'USD official out of range';
  if (o.eur_buy != null && !inR(o.eur_buy / o.usd_buy, 0.9, 1.5)) return 'EUR official implausible';
  if (sp?.usd?.buy && !inR(o.usd_buy / sp.usd.buy, 0.6, 1.25)) return 'official too far from market';
  return null;
}
export async function fetchOfficial(sp) {
  const posts = await latestBulletinPosts();
  if (!posts.length) throw new Error('no public Central Bank portrait photos found');
  const st = pricesState();
  const checkedAt = Date.now(); const errors = [];
  for (const post of posts) {
    if (st.official?.source === 'facebook' && st.official.post === post.id && st.official.usd) return { ...st.official, checkedAt };
    if (R.ignoredPhotoIds.has(post.id)) continue;
    try {
      const o = await ocrBulletin(post.img);
      if (o?.is_bulletin !== true) { R.ignoredPhotoIds.add(post.id); errors.push(`${post.id}: not a bulletin`); continue; }
      const bad = checkOfficial(o, null);
      if (bad) { R.ignoredPhotoIds.add(post.id); errors.push(`${post.id}: ${bad}`); continue; }
      const imageDate = String(o.bulletin_date || '').trim().match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
      const dateMs = imageDate ? Date.parse(`${imageDate}T12:00:00+03:00`) : NaN;
      if (!Number.isFinite(dateMs) || dateMs > Date.now() + 2 * 86_400_000 || Date.now() - dateMs > 31 * 86_400_000) {
        R.ignoredPhotoIds.add(post.id); errors.push(`${post.id}: missing or implausible printed bulletin date`); continue;
      }
      R.ignoredPhotoIds.delete(post.id);
      return {
        source: 'facebook', src: 'مصرف سورية المركزي — فيسبوك رسمي', post: post.id, url: post.url,
        date: imageDate, ts: post.ts, checkedAt, bulletinNo: String(o.bulletin_no || '').trim(),
        usd: { buy: o.usd_buy, sell: o.usd_sell },
        eur: o.eur_buy ? { buy: o.eur_buy, sell: o.eur_sell || null } : null,
        try: o.try_buy ? { buy: o.try_buy, sell: o.try_sell || null } : null,
      };
    } catch (e) {
      errors.push(`${post.id}: ${e.message}`);
      if (/Gemini OCR failed/.test(e.message)) break;
    }
  }
  if (st.official?.source === 'facebook' && st.official.usd) return { ...st.official, checkedAt };
  throw new Error(`no verified Facebook exchange bulletin among recent photos: ${errors.join(' | ').slice(0, 700) || 'no usable portrait image'}`);
}

// ---------------------------------------------------------------- refresh loop
const R = { busy: false, lastSpTry: 0, lastOffTry: 0, lastSanaTry: 0, spErr: '', offErr: '', sanaErr: '', ignoredPhotoIds: new Set() };
// ⛽ Public fuel prices come only from official government decisions carried by SANA.
async function refreshFuel(st, { force = false } = {}) {
  const now = Date.now();
  if (!force && st.fuel?.official && now - (st.fuel.checked || 0) < 6 * H_MS) return;
  if (!force && now - R.lastSanaTry < 30 * 60_000) return;
  R.lastSanaTry = now;
  let sana = null;
  try { sana = await fetchSanaFuel(); R.sanaErr = ''; } catch (e) { R.sanaErr = e.message; console.warn('[prices] SANA fuel feed failed:', e.message); }
  if (!sana) return;
  const f = (st.fuel ||= {});
  const { changed } = mergeFuel(f, [sana], now);
  save(false);
  const api = typeof R2.api === 'function' ? R2.api() : R2.api;
  if (!api) return;
  if (changed) {
    console.log('[prices] fuel prices changed', JSON.stringify(f.items));
    const L = Object.entries(f.items).map(([k, v]) => `• ${v.name}: <b>${fmtNew(f.prev?.items?.[k]?.price)}</b> ← <b>${fmtNew(v.price)}</b>`);
    await notifyOwners(api, `⛽ <b>تغيّرت أسعار المحروقات الرسمية</b> (من ${dateLabel(f.since)})\n\n${L.join('\n')}\n\nالمصدر: ${f.srcs.join(' + ')}${f.url ? `\nقرار سانا الرسمي: ${f.url}` : ''}`).catch(() => {});
  }
}
/** an official pricing decision showed up in the news: re-check fuel soon (sources update a bit later) */
export function fuelRecheckSoon() {
  for (const ms of [20 * 60_000, 2 * H_MS]) {
    setTimeout(() => { R.fuelDue = true; R.lastSpTry = 0; refreshPrices().catch(() => {}); }, ms).unref?.();
  }
}
export async function refreshPrices({ force = false, forceOfficial = false } = {}) {
  if (R.busy) {
    if (forceOfficial) throw new Error('price refresh already in progress');
    return pricesState();
  }
  R.busy = true;
  const st = pricesState();
  try {
    // Purge legacy unofficial market, gold and electricity-tariff snapshots from persistent state.
    if (st.sp || st.spAt) { delete st.sp; delete st.spAt; save(false); }
    await refreshFuel(st, { force });
    const p = damascusParts();
    const currentOfficial = trustedOfficial(st.official);
    const haveToday = currentOfficial?.date === p.date;
    const needsSourceMigration = !!st.official && !currentOfficial;
    // the official bulletin appears ~13:00 Damascus on working days: look for it from 12:30, every 30 min
    if (forceOfficial || ((force || !currentOfficial || needsSourceMigration || (!haveToday && p.hm >= '12:30')) && Date.now() - R.lastOffTry > (force ? 60_000 : 30 * 60_000))) {
      R.lastOffTry = Date.now();
      try {
        const o = await fetchOfficial(null);
        if (o.post !== st.official?.post || o.src !== st.official?.src || o.checkedAt !== st.official?.checkedAt) { st.official = o; save(false); console.log(`[prices] official bulletin ${o.date}: USD ${o.usd.buy}/${o.usd.sell}`); }
        R.offErr = '';
      } catch (e) { R.offErr = e.message; console.warn('[prices] official failed:', e.message); }
    }
  } finally { R.busy = false; }
  return st;
}
export function pricesDebug() { const st = pricesState(); return { cfg: st.cfg, spAt: st.spAt, spErr: R.spErr, offErr: R.offErr, sypErr: R.sypErr, sanaErr: R.sanaErr, fuel: st.fuel ? { since: st.fuel.since, checked: st.fuel.checked, srcs: st.fuel.srcs, official: st.fuel.official, url: st.fuel.url, conflict: st.fuel.conflict, items: Object.fromEntries(Object.entries(st.fuel.items || {}).map(([k, v]) => [k, v.price])) } : null, official: trustedOfficial(st.official) ? { source: st.official.source, date: st.official.date, checkedAt: st.official.checkedAt, bulletinNo: st.official.bulletinNo, src: st.official.src, url: st.official.url, usd: st.official.usd, eur: st.official.eur, try: st.official.try } : null, usd: st.sp?.usd }; }
const trustedOfficial = (o) => {
  if (o?.source !== 'facebook') return null;
  try { return ['facebook.com', 'www.facebook.com'].includes(new URL(o.url).hostname) ? o : null; } catch { return null; }
};

/** fuel for the site/bulletin: an official decision only; never fall back to a market quote. */
function fuelOf(st, now = Date.now()) {
  if (!st.fuel?.official || !st.fuel?.items) return null;
  const view = fuelView(st.fuel, now);
  return view.stale ? { ...view, items: {} } : view;
}
function fuelPublic(st) {
  const v = fuelOf(st);
  return v ? { at: v.since, since: v.since, checked: v.checked, stale: v.stale, staleH: STALE_H, official: true, url: v.url, tiersSrc: v.tiersSrc, srcs: v.srcs, items: v.stale ? {} : v.items } : { items: {} };
}
/** public JSON for the website */
export function publicPrices() {
  const st = pricesState();
  const official = trustedOfficial(st.official);
  const fuel = fuelPublic(st);
  const hasFuel = fuel.official && Object.keys(fuel.items || {}).length > 0;
  if (!official?.usd && !hasFuel) return { ok: false };
  return {
    ok: true, unit: 'new_syp', oldFactor: 100,
    official: official ? { source: official.source, date: official.date, checkedAt: official.checkedAt, bulletinNo: official.bulletinNo, url: official.url, usd: official.usd, eur: official.eur, try: official.try } : null,
    fuel,
  };
}

// ---------------------------------------------------------------- image
function text(x, y, s, { size = 24, weight = 400, fill = '#e5e7eb', anchor = 'end', family = 'Noto Kufi Arabic', opacity = 1 } = {}) {
  return `<text x="${x}" y="${y}" font-family="${family}, Noto Sans" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${opacity < 1 ? ` opacity="${opacity}"` : ''}>${esc(s)}</text>`;
}
const card = (x, y, w, h, r = 22, fill = '#111827', stroke = '#1f2937') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
const arrow = (ch) => (!ch ? { s: '', c: '#9ca3af' } : ch > 0 ? { s: '+', c: '#fb7185' } : { s: '-', c: '#34d399' });
const dayLabel = (ms) => { const p = damascusParts(ms); return `${AR_DAYS[p.wd]} ${p.d} ${AR_MONTHS[p.m - 1]} ${p.y}`; };
const dateLabel = (iso) => { const [y, m, d] = String(iso || '').split('-').map(Number); return y ? `${d} ${AR_MONTHS[m - 1]}` : ''; };
const CHECK_FMT = new Intl.DateTimeFormat('ar-SY-u-nu-latn', { timeZone: 'Asia/Damascus', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const checkedLabel = (ms) => (Number.isFinite(Number(ms)) ? CHECK_FMT.format(new Date(Number(ms))) : '—');
const ltrNum = (value) => `\u2066${value}\u2069`;

export function pricesSvg(st, now = Date.now()) {
  const official = trustedOfficial(st.official);
  const W = 1080; const P = 48; const R = W - P;
  let H = 1500;
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="__H__" viewBox="0 0 ${W} __H__">`);
  o.push(`<defs>
    <radialGradient id="glow" cx="85%" cy="0%" r="75%"><stop offset="0" stop-color="#f59e0b" stop-opacity="0.22"/><stop offset="1" stop-color="#f59e0b" stop-opacity="0"/></radialGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1220"/><stop offset="1" stop-color="#070a12"/></linearGradient>
    <linearGradient id="gold" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#d97706"/></linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.025" stroke-width="1"/></pattern>
  </defs>`);
  o.push(`<rect width="${W}" height="__H__" fill="url(#bg)"/><rect width="${W}" height="__H__" fill="url(#grid)"/><rect width="${W}" height="560" fill="url(#glow)"/>`);
  o.push(`<rect x="0" y="0" width="${W}" height="8" fill="#ef233c"/>`);
  // header
  const ls = 84; const hy = 44;
  if (LOGO) o.push(LOGO.replace('<svg ', `<svg x="${R - ls}" y="${hy}" width="${ls}" height="${ls}" `));
  o.push(text(R - ls - 22, hy + 40, 'RED ALERT SYRIA', { size: 30, weight: 700, fill: '#ffffff', family: 'Noto Sans' }));
  o.push(text(R - ls - 22, hy + 76, 'نشرة الأسعار اليومية', { size: 22, weight: 500, fill: '#9ca3af' }));
  const pill = dayLabel(now); const pw = Math.max(240, pill.length * 14 + 56);
  o.push(`<rect x="${P}" y="${hy + 18}" width="${pw}" height="50" rx="25" fill="#f59e0b" fill-opacity="0.14" stroke="#f59e0b" stroke-opacity="0.55"/>`);
  o.push(text(P + pw / 2, hy + 51, pill, { size: 21, weight: 600, fill: '#fde68a', anchor: 'middle' }));
  let y = 205;
  o.push(text(R, y, 'أسعار الصرف', { size: 44, weight: 800, fill: '#ffffff' }));
  o.push(text(P, y, 'بالليرة الجديدة', { size: 22, weight: 600, fill: '#fbbf24', anchor: 'start' }));
  // Central Bank bulletin only; no parallel-market or commercial aggregator quotes.
  y += 26;
  const officialRows = official ? [['دولار أمريكي', official.usd], official.eur?.buy ? ['يورو', official.eur] : null, official.try?.buy ? ['ليرة تركية', official.try] : null].filter(Boolean) : [];
  const th = official ? 146 + officialRows.length * 34 : 104;
  o.push(card(P, y, W - 2 * P, th));
  const cBuy = P + 380; const cSell = P + 150; const cName = R - 32;
  if (official) {
    o.push(text(cName, y + 40, 'السعر الرسمي — مصرف سورية المركزي', { size: 23, weight: 700, fill: '#6ee7b7' }));
    o.push(text(P + 40, y + 40, `نشرة ${dateLabel(official.date)}${official.bulletinNo ? ` · رقم ${official.bulletinNo}` : ''}`, { size: 17, weight: 600, fill: '#6ee7b7', anchor: 'start' }));
    o.push(text(cBuy, y + 68, 'شراء', { size: 17, weight: 600, fill: '#9ca3af', anchor: 'middle' }));
    o.push(text(cSell, y + 68, 'مبيع', { size: 17, weight: 600, fill: '#9ca3af', anchor: 'middle' }));
    officialRows.forEach(([name, rate], i) => {
      const cy = y + 98 + i * 34;
      o.push(`<rect x="${P + 30}" y="${cy - 22}" width="${W - 2 * P - 60}" height="1" fill="#164e3c"/>`);
      o.push(text(cName, cy, name, { size: 19, weight: 700, fill: '#ffffff' }));
      o.push(text(cBuy, cy, fmtNew(rate.buy), { size: 21, weight: 700, fill: '#ffffff', anchor: 'middle', family: 'Noto Sans' }));
      o.push(text(cSell, cy, fmtNew(rate.sell), { size: 21, weight: 700, fill: '#ffffff', anchor: 'middle', family: 'Noto Sans' }));
    });
    o.push(text(P + 40, y + th - 18, 'المصدر: نشرة مصرف سورية المركزي الرسمية', { size: 15, weight: 500, fill: '#9ca3af', anchor: 'start' }));
  } else o.push(text(R - 30, y + 62, 'لا تتوفر حالياً نشرة صرف رسمية موثقة', { size: 22, weight: 600, fill: '#cbd5e1' }));
  y += th + 34;
  // gold
  const g = {};
  const gk = [['عيار 21', g.k21], ['عيار 18', g.k18], ['عيار 24', g.k24]].filter((x) => x[1]);
  if (gk.length) {
    o.push(text(R, y + 34, 'الذهب — سعر الغرام', { size: 34, weight: 800, fill: '#ffffff' }));
    if (g.ounce) o.push(text(P, y + 34, `الأونصة عالمياً: ${g.ounce.toLocaleString('en-US')} دولار`, { size: 22, weight: 600, fill: '#fbbf24', anchor: 'start' }));
    y += 56;
    const gap = 18; const cw = (W - 2 * P - gap * (gk.length - 1)) / gk.length; const ch = 150;
    gk.forEach(([lbl, k], i) => {
      const x = R - (i + 1) * cw - i * gap;
      o.push(card(x, y, cw, ch, 20, '#14110a', '#3f2f0b'));
      o.push(`<rect x="${x}" y="${y}" width="${cw}" height="6" rx="3" fill="url(#gold)"/>`);
      o.push(text(x + cw - 24, y + 46, lbl, { size: 24, weight: 700, fill: '#fde68a' }));
      o.push(text(x + cw / 2, y + 98, fmtNew(k.sell || k.buy), { size: 40, weight: 800, fill: '#ffffff', anchor: 'middle', family: 'Noto Sans' }));
      o.push(text(x + cw / 2, y + 130, `${fmtOld(k.sell || k.buy)} قديمة`, { size: 17, weight: 500, fill: '#78716c', anchor: 'middle' }));
    });
    y += ch + 34;
  }
  // fuel
  const FV = fuelOf(st, now);
  const F = FV && !FV.stale ? FV.items : {}; // decision older than STALE_H -> no fuel section at all
  const fl = [['بنزين 90', F.benzin, 'لتر'], ['بنزين 95', F['gasoline-95'], 'لتر'], ['مازوت', F.diesel, 'لتر'], ['غاز منزلي', F.gas, 'أسطوانة']].filter((x) => x[1]?.price);
  if (fl.length) {
    o.push(text(R, y + 34, 'المحروقات — تسعيرة رسمية منشورة', { size: 34, weight: 800, fill: '#ffffff' }));
    if (FV.since) o.push(text(P, y + 34, `تاريخ التسعيرة ${dateLabel(FV.since)}`, { size: 20, weight: 600, fill: '#9ca3af', anchor: 'start' }));
    y += 56;
    const gap = 16; const cw = (W - 2 * P - gap * (fl.length - 1)) / fl.length; const ch = 140;
    fl.forEach(([lbl, f, unit], i) => {
      const x = R - (i + 1) * cw - i * gap;
      o.push(card(x, y, cw, ch, 20));
      o.push(text(x + cw / 2, y + 44, lbl, { size: 23, weight: 700, fill: '#93c5fd', anchor: 'middle' }));
      o.push(text(x + cw / 2, y + 94, fmtNew(f.price), { size: 36, weight: 800, fill: '#ffffff', anchor: 'middle', family: 'Noto Sans' }));
      o.push(text(x + cw / 2, y + 124, `لكل ${unit} · ${fmtOld(f.price)} قديمة`, { size: 16, weight: 500, fill: '#6b7280', anchor: 'middle' }));
    });
    y += ch + 30;
    const t150 = F['diesel-150']; const t115 = F['diesel-115'];
    if (t150 || t115) {
      const parts = [t150 && `مازوت صنف ثاني ${fmtNew(t150.price)}`, t115 && `مازوت مدعوم للتدفئة والزراعة ${fmtNew(t115.price)}`].filter(Boolean);
      o.push(text(R, y + 6, `${parts.join(' · ')} ل.س لكل لتر (وزارة الطاقة)`, { size: 19, weight: 600, fill: '#9ca3af' }));
      y += 34;
    }
  }
  // footer
  H = Math.round(y + 150);
  const fy = H - 40;
  o.push(text(R, fy - 74, 'المصدر: مصرف سورية المركزي وقرارات المحروقات الحكومية المنشورة عبر سانا', { size: 17, weight: 500, fill: '#6b7280' }));
  o.push(text(R, fy - 48, 'لا تُعرض أسعار السوق الموازي أو الأسعار التجارية غير الرسمية · كل 1 ليرة جديدة تعادل 100 ليرة قديمة', { size: 17, weight: 500, fill: '#6b7280' }));
  o.push(`<rect x="${P}" y="${fy - 32}" width="${W - 2 * P}" height="1" fill="#1f2937"/>`);
  o.push(text(R, fy + 6, 'red-alert-syria.onrender.com', { size: 21, weight: 700, fill: '#cbd5e1', family: 'Noto Sans' }));
  const bh = 40; const bw = badgeWidth(bh);
  o.push(channelBadge(P, fy - bh + 14, { h: bh, dark: true }));
  void bw;
  o.push('</svg>');
  return o.join('\n').replaceAll('__H__', String(H));
}
export const renderPricesPng = (st, now) => svgToPng(pricesSvg(st, now), 1080);

export function pricesCaption(st, now = Date.now()) {
  const official = trustedOfficial(st.official);
  const L = [];
  L.push(`💱 <b>نشرة الأسعار — ${dayLabel(now)}</b>`, '');
  if (official) {
    L.push(`🏦 الرسمي — مصرف سورية المركزي، نشرة ${dateLabel(official.date)}${official.bulletinNo ? ` رقم ${esc(official.bulletinNo)}` : ''}:`);
    L.push(`🇺🇸 الدولار — شراء <b>${ltrNum(fmtNew(official.usd.buy))}</b> / مبيع <b>${ltrNum(fmtNew(official.usd.sell))}</b>`);
    if (official.eur) L.push(`🇪🇺 اليورو — شراء <b>${ltrNum(fmtNew(official.eur.buy))}</b> / مبيع <b>${ltrNum(fmtNew(official.eur.sell))}</b>`);
    if (official.try) L.push(`🇹🇷 التركية — شراء <b>${ltrNum(fmtNew(official.try.buy))}</b> / مبيع <b>${ltrNum(fmtNew(official.try.sell))}</b>`);
    if (official.checkedAt) L.push(`<i>آخر تحقق: ${esc(checkedLabel(official.checkedAt))}</i>`);
  }
  if (official?.url) L.push(`🔗 <a href="${esc(official.url)}">صفحة مصرف سورية المركزي الرسمية على فيسبوك</a>`);
  const FV = fuelOf(st, now);
  const F = FV && !FV.stale ? FV.items : {};
  if (F.benzin || F.diesel) {
    const t = F['diesel-150'] ? ` (صنف ثاني ${fmtNew(F['diesel-150'].price)})` : '';
    L.push(`⛽ بنزين 90: <b>${fmtNew(F.benzin?.price)}</b> · مازوت: <b>${fmtNew(F.diesel?.price)}</b>${t} · غاز: <b>${fmtNew(F.gas?.price)}</b>`);
    if (FV.since) L.push(`<i>المحروقات: ${FV.official ? 'قرار رسمي منشور' : 'بيانات مصدر ثانوي'} منذ ${dateLabel(FV.since)}</i>`);
    if (FV.url) L.push(`🔗 <a href="${esc(FV.url)}">قرار المحروقات لدى سانا</a>`);
  }
  if (FV?.stale && FV.since) L.push(`⛽ آخر قرار رسمي للمحروقات بتاريخ ${dateLabel(FV.since)}؛ استبعدنا الأسعار من نشرة اليوم لقدمها.`);
  L.push('', '<i>بالليرة الجديدة · القديمة = ×100</i>');
  L.push(`📊 كل الأسعار على الموقع: ${siteUrl()}/ar/#prices`);
  return L.join('\n');
}

// ---------------------------------------------------------------- posting
const R2 = { api: null, owners: () => [] };
function postKb() {
  const kb = new InlineKeyboard().url('📊 الأسعار على الموقع', `${siteUrl()}/ar/#prices`);
  kb.url('🗺 الخريطة الحية', `${siteUrl()}/ar/`);
  return kb;
}
/** ready -> { ok, st } / not ready -> { ok:false, why } */
async function readyData() {
  const st = await refreshPrices({ force: true });
  const official = trustedOfficial(st.official);
  const fuel = fuelOf(st);
  const hasFuel = !!fuel && !fuel.stale && Object.keys(fuel.items || {}).length > 0;
  if (!official?.usd && !hasFuel) return { ok: false, why: 'No current verified Central Bank bulletin or official fuel-price decision is available.' };
  return { ok: true, st, official: !!official?.usd };
}
export async function postBulletin(api, { chatId = config.channel, test = false, en = false } = {}) {
  const r = await readyData();
  if (!r.ok) return r;
  const png = renderPricesPng(r.st);
  const head = test ? (en ? '🧪 <b>Private preview — not posted in the channel.</b>\nThis is how the price bulletin will look (in Arabic, as in the channel):\n\n' : '🧪 <b>معاينة خاصة — لم تُنشر في القناة.</b>\nهكذا ستظهر نشرة الأسعار:\n\n') : '';
  const m = await api.sendPhoto(chatId, new InputFile(png, `prices-${damascusParts().date}.png`), { caption: (head + pricesCaption(r.st)).slice(0, 1024), parse_mode: 'HTML', reply_markup: test ? undefined : postKb() });
  return { ok: true, message_id: m.message_id, official: r.official };
}
async function notifyOwners(api, text) {
  for (const id of config.ownerIds || []) { try { await api.sendMessage(id, text, { parse_mode: 'HTML' }); } catch { /* ignore */ } }
}
let started = false;
export function startPrices(getApi) {
  R2.api = getApi;
  if (started) return;
  started = true;
  setTimeout(() => refreshPrices().catch(() => {}), 20_000).unref();
  setInterval(() => refreshPrices().catch(() => {}), 10 * 60_000).unref();
  const c0 = pricesState().cfg; const p0 = damascusParts();
  if (!c0.last && p0.hm >= c0.time) { c0.last = p0.date; save(false); } // first boot after the time: start tomorrow
  let busy = false;
  const tick = async () => {
    const st = pricesState(); const c = st.cfg;
    if (!c.on || busy || !config.channel) return;
    const p = damascusParts();
    if (p.hm < c.time || c.last === p.date) return;
    const api = getApi();
    if (!api) return;
    busy = true;
    c.last = p.date; save(); // mark first: never twice the same day
    try {
      const r = await postBulletin(api);
      if (!r.ok) {
        console.warn(`[prices] ${p.date}: not posted — ${r.why}`);
        await notifyOwners(api, `⚠️ <b>نشرة الأسعار لم تُنشر اليوم</b>\n\nالسبب: ${esc(r.why)}\nما نشرنا أرقام غير مؤكدة. تقدر تجرب لاحقاً من القائمة ← 💱 نشرة الأسعار ← «انشر الآن».`);
      } else {
        console.log(`[prices] ${p.date}: bulletin posted (official: ${r.official})`);
        if (!r.official) await notifyOwners(api, 'ℹ️ نُشرت النشرة ببيانات المحروقات الرسمية فقط؛ تعذّر التحقق من نشرة صرف حديثة للمصرف المركزي.');
      }
    } catch (e) {
      console.error('[prices] post failed', e.description || e.message);
      await notifyOwners(api, `⚠️ تعذّر نشر نشرة الأسعار: ${esc(e.description || e.message)}`);
    } finally { busy = false; }
  };
  setInterval(tick, 30_000).unref();
  setTimeout(tick, 12_000).unref();
}

// ---------------------------------------------------------------- owner menu (publishing bot)
export function registerPriceTools(bot, h) {
  const en = (ctx) => h.langOf(ctx) === 'en';
  const onlyOwner = async (ctx, fn) => { if (!h.owner(ctx)) return ctx.answerCallbackQuery().catch(() => {}); return fn(); };
  const txt = (ctx) => {
    const st = pricesState(); const c = st.cfg; const of = trustedOfficial(st.official);
    const status = of?.usd
      ? (en(ctx) ? `🏦 Official USD: <b>${fmtNew(of.usd.buy)} / ${fmtNew(of.usd.sell)}</b> (bulletin ${dateLabel(of.date)})` : `🏦 الدولار الرسمي: <b>${fmtNew(of.usd.buy)} / ${fmtNew(of.usd.sell)}</b> (نشرة ${dateLabel(of.date)})`)
      : (en(ctx) ? '⏳ No recent official exchange-rate bulletin is available.' : '⏳ لا تتوفر نشرة صرف رسمية حديثة حالياً.');
    return en(ctx)
      ? `💱 <b>Daily official prices bulletin</b>\n\nStatus: <b>${c.on ? '✅ On' : '⏸ Off'}</b>\nTime: <b>${c.time}</b> (Damascus)\n\nThe channel shows Central Bank exchange bulletins and official government fuel-price decisions only. Parallel-market rates and gold are excluded. If no verified official data is available, nothing is posted.${c.last ? `\n\nLast run: ${c.last}` : ''}\n\n${status}`
      : `💱 <b>نشرة الأسعار الرسمية اليومية</b>\n\nالحالة: <b>${c.on ? '✅ مفعّلة' : '⏸ متوقفة'}</b>\nالوقت: <b>${c.time}</b> بتوقيت دمشق\n\nنعرض نشرة مصرف سورية المركزي وقرارات المحروقات الحكومية فقط. أزلنا أسعار السوق الموازي والذهب والتسعيرات غير المثبتة. إذا ما توفر مصدر رسمي موثوق ما بيننشر أي رقم.${c.last ? `\n\nآخر تشغيل: ${c.last}` : ''}\n\n${status}`;
  };
  const kb = (ctx) => {
    const c = pricesState().cfg; const e = en(ctx);
    const k = new InlineKeyboard().text(c.on ? (e ? '⏸ Turn off' : '⏸ إيقاف') : (e ? '▶️ Turn on' : '▶️ تشغيل'), c.on ? 'px:off' : 'px:on').row();
    PRICE_TIMES.forEach((t, i) => { k.text((t === c.time ? '✅ ' : '') + t, `px:t:${t}`); if (i % 3 === 2) k.row(); });
    return k.text(e ? '🔄 Check for updates' : '🔄 تحقّق من تحديث النشرة', 'px:refresh').row()
      .text(e ? '📤 Send me a preview' : '📤 أرسل لي معاينة', 'px:test').row()
      .text(e ? '📢 Post in the channel now' : '📢 انشرها بالقناة الآن', 'px:now').row()
      .text(h.L(ctx).btnHome, 'home');
  };
  bot.callbackQuery('px', (ctx) => onlyOwner(ctx, async () => { await ctx.answerCallbackQuery(); await h.show(ctx, txt(ctx), kb(ctx)); }));
  bot.callbackQuery(/^px:(on|off)$/, (ctx) => onlyOwner(ctx, async () => {
    const c = pricesState().cfg; const on = ctx.match[1] === 'on';
    if (on && !c.on) { const p = damascusParts(); if (p.hm >= c.time) c.last = p.date; }
    c.on = on; save();
    await ctx.answerCallbackQuery(en(ctx) ? (on ? 'Turned on' : 'Turned off') : (on ? 'تم التشغيل' : 'تم الإيقاف'));
    await h.show(ctx, txt(ctx), kb(ctx));
  }));
  bot.callbackQuery(/^px:t:(\d\d:\d\d)$/, (ctx) => onlyOwner(ctx, async () => {
    const t = ctx.match[1]; if (!PRICE_TIMES.includes(t)) return ctx.answerCallbackQuery();
    const c = pricesState().cfg; c.time = t; const p = damascusParts(); if (p.hm >= t) c.last = p.date; save();
    await ctx.answerCallbackQuery(`⏰ ${t}`);
    await h.show(ctx, txt(ctx), kb(ctx));
  }));
  bot.callbackQuery('px:refresh', (ctx) => onlyOwner(ctx, async () => {
    await ctx.answerCallbackQuery(en(ctx) ? 'Checking the official bulletin…' : 'جارٍ التحقق من النشرة الرسمية…');
    await ctx.replyWithChatAction('typing').catch(() => {});
    const before = trustedOfficial(pricesState().official);
    const resultKb = (changed = false) => {
      const k = new InlineKeyboard();
      if (changed) k.text(en(ctx) ? '📢 Publish updated bulletin' : '📢 انشر النشرة المحدّثة', 'px:now').row();
      return k.text(en(ctx) ? '💱 Prices bulletin' : '💱 نشرة الأسعار', 'px').text(h.L(ctx).btnHome, 'home');
    };
    try {
      const st = await refreshPrices({ force: true, forceOfficial: true });
      const official = trustedOfficial(st.official);
      if (!official || R.offErr) {
        const why = R.offErr ? `\n\n${esc(R.offErr).slice(0, 500)}` : '';
        const message = en(ctx) ? '⚠️ Could not verify the official source right now; no bulletin was published.' : '⚠️ تعذّر التحقق من المصدر الرسمي حالياً؛ ما نُشرت أي نشرة.';
        return h.show(ctx, message + why, resultKb());
      }
      const signature = (o) => JSON.stringify(o ? [o.post, o.date, o.bulletinNo, o.usd?.buy, o.usd?.sell, o.eur?.buy, o.eur?.sell, o.try?.buy, o.try?.sell] : null);
      const changed = signature(before) !== signature(official);
      const lines = [
        changed
          ? (en(ctx) ? '🆕 <b>A new official bulletin was found.</b>' : '🆕 <b>تم العثور على نشرة رسمية جديدة.</b>')
          : (en(ctx) ? '✅ <b>Checked the official source; no newer bulletin was found.</b>' : '✅ <b>تم فحص المصدر الرسمي؛ ما في نشرة أحدث.</b>'),
        `${en(ctx) ? 'Central Bank of Syria — bulletin' : 'مصرف سورية المركزي — نشرة'} ${esc(dateLabel(official.date))}${official.bulletinNo ? ` ${en(ctx) ? 'No.' : 'رقم'} ${esc(official.bulletinNo)}` : ''}:`,
        `${en(ctx) ? 'USD' : 'الدولار'}: ${en(ctx) ? 'buy' : 'شراء'} <b>${fmtNew(official.usd.buy)}</b> · ${en(ctx) ? 'sell' : 'مبيع'} <b>${fmtNew(official.usd.sell)}</b>`,
        ...(official.eur ? [`${en(ctx) ? 'EUR' : 'اليورو'}: ${en(ctx) ? 'buy' : 'شراء'} <b>${fmtNew(official.eur.buy)}</b> · ${en(ctx) ? 'sell' : 'مبيع'} <b>${fmtNew(official.eur.sell)}</b>`] : []),
        ...(official.try ? [`${en(ctx) ? 'TRY' : 'الليرة التركية'}: ${en(ctx) ? 'buy' : 'شراء'} <b>${fmtNew(official.try.buy)}</b> · ${en(ctx) ? 'sell' : 'مبيع'} <b>${fmtNew(official.try.sell)}</b>`] : []),
        `${en(ctx) ? 'Source' : 'المصدر'}: <a href="${esc(official.url)}">${en(ctx) ? 'official Central Bank page' : 'صفحة المصرف المركزي الرسمية'}</a>`,
      ];
      await h.show(ctx, lines.join('\n'), resultKb(changed));
    } catch (e) {
      await h.show(ctx, `${en(ctx) ? '⚠️ The bulletin check failed' : '⚠️ تعذّر فحص النشرة'}: ${esc(e.message)}`, resultKb());
    }
  }));
  bot.callbackQuery('px:test', (ctx) => onlyOwner(ctx, async () => {
    await ctx.answerCallbackQuery(en(ctx) ? 'Preparing…' : 'جارٍ التجهيز…');
    await ctx.replyWithChatAction('upload_photo').catch(() => {});
    try {
      const r = await postBulletin(ctx.api, { chatId: ctx.chat.id, test: true, en: en(ctx) });
      if (!r.ok) await ctx.reply(`⚠️ ما في بيانات مؤكدة حالياً: ${esc(r.why)}`, { parse_mode: 'HTML' });
    } catch (e) { await ctx.reply(`⚠️ ${esc(e.description || e.message)}`, { parse_mode: 'HTML' }); }
  }));
  bot.callbackQuery('px:now', (ctx) => onlyOwner(ctx, async () => {
    await ctx.answerCallbackQuery();
    await h.show(ctx, en(ctx) ? '📢 Post today\'s prices bulletin in the channel now?' : '📢 أنشر نشرة أسعار اليوم بالقناة هلق؟', new InlineKeyboard().text(en(ctx) ? '✅ Yes, post' : '✅ إي، انشر', 'px:now:y').text(en(ctx) ? '↩️ Back' : '↩️ رجوع', 'px'));
  }));
  bot.callbackQuery('px:now:y', (ctx) => onlyOwner(ctx, async () => {
    await ctx.answerCallbackQuery(en(ctx) ? 'Posting…' : 'جارٍ النشر…');
    try {
      const r = await postBulletin(ctx.api);
      if (r.ok) { const c = pricesState().cfg; c.last = damascusParts().date; save(); }
      await h.show(ctx, r.ok ? '✅ نُشرت نشرة الأسعار بالقناة.' : `⚠️ ما نُشرت: ${esc(r.why)}`, new InlineKeyboard().text('💱 نشرة الأسعار', 'px').text(h.L(ctx).btnHome, 'home'));
    } catch (e) { await h.show(ctx, `⚠️ ${esc(e.description || e.message)}`, new InlineKeyboard().text(h.L(ctx).btnHome, 'home')); }
  }));
}
