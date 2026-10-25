// 💱 Daily prices bulletin: exchange rates (parallel market + Central Bank official bulletin), gold and
// fuel, in NEW Syrian lira (old lira = new × 100). Posted to the channel every morning as a branded
// image + short caption; the website shows the same numbers (/api/prices).
// Sources:
//  - sp-today.com ("الليرة اليوم"): parallel-market rates, gold per gram, official fuel & electricity
//    prices. Data is embedded in the Next.js page (self.__next_f chunks); values are in OLD lira.
//  - Central Bank of Syria daily bulletin: cb.gov.sy is behind a JS challenge, so the bulletin image
//    posted every day (~13:00 Damascus) by the official channel @AlekhbariahSY is read with Gemini
//    and sanity-checked. The morning bulletin therefore carries the latest official bulletin (its date
//    is printed).
// Wrong numbers are worse than none: every value is range-checked; stale or missing parallel-market
// data -> nothing is posted and the owner gets a private notice.
import { InlineKeyboard, InputFile } from 'grammy';
import { config } from './config.js';
import { store } from './store.js';
import { damascusParts } from './stats-image.js';
import { svgToPng, channelBadge, badgeWidth } from './alert-image.js';
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
    usd_buy: { type: 'NUMBER', nullable: true }, usd_sell: { type: 'NUMBER', nullable: true },
    eur_buy: { type: 'NUMBER', nullable: true }, eur_sell: { type: 'NUMBER', nullable: true },
    try_buy: { type: 'NUMBER', nullable: true }, try_sell: { type: 'NUMBER', nullable: true },
  },
  required: ['is_bulletin', 'usd_buy', 'usd_sell'],
};
/** the newest official-bulletin post (text + image url) on a public Telegram channel */
export async function latestBulletinPost() {
  const q = encodeURIComponent('النشرة الرسمية لأسعار العملات');
  const r = await fetch(`https://t.me/s/AlekhbariahSY?q=${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`telegram HTTP ${r.status}`);
  const html = await r.text();
  const posts = html.split('<div class="tgme_widget_message_wrap').slice(1).map((p) => {
    const id = (p.match(/data-post="([^"]+)"/) || [])[1];
    const dt = (p.match(/datetime="([^"]+)"/) || [])[1];
    const txt = ((p.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '').replace(/<[^>]+>/g, ' ');
    const img = (p.match(/tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/) || [])[1];
    return { id, ts: Date.parse(dt || ''), txt, img };
  }).filter((p) => p.id && p.img && /المصرف المركزي/.test(p.txt) && /النشرة\s+الرسمية/.test(p.txt) && /العملات/.test(p.txt));
  posts.sort((a, b) => b.ts - a.ts);
  return posts[0] || null;
}
export async function ocrBulletin(imgUrl) {
  const key = process.env.GEMINI_API_KEY || '';
  if (!key) throw new Error('no GEMINI_API_KEY');
  const ir = await fetch(imgUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25_000) });
  if (!ir.ok) throw new Error(`image HTTP ${ir.status}`);
  const b64 = Buffer.from(await ir.arrayBuffer()).toString('base64');
  const models = (process.env.PRICES_AI_MODELS || 'gemini-flash-latest,gemini-flash-lite-latest,gemini-2.5-flash').split(',').map((s) => s.trim()).filter(Boolean);
  const prompt = 'This image should be the official daily exchange-rate bulletin of the Central Bank of Syria (مصرف سورية المركزي - نشرة أسعار العملات). '
    + 'Read the table EXACTLY as printed. Return the buy (شراء) and sell (مبيع) rate in Syrian pounds for: US dollar (دولار أمريكي), Euro (يورو), Turkish lira (ليرة تركية). '
    + 'Return numbers exactly as printed (e.g. 121.50). bulletin_date: the bulletin date printed on the image as YYYY-MM-DD if visible. is_bulletin=true when the image shows an exchange-rate table in Syrian pounds (any design, e.g. a TV channel graphic).';
  let last;
  for (const m of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'image/jpeg', data: b64 } }, { text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: OCR_SCHEMA } }),
        signal: AbortSignal.timeout(45_000),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${m}: HTTP ${res.status} ${(j.error?.message || '').slice(0, 100)}`);
      return JSON.parse((j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
    } catch (e) { last = e; }
  }
  throw last || new Error('OCR failed');
}
export function checkOfficial(o, sp) {
  if (!o || (!o.is_bulletin && !Number.isFinite(o.usd_buy))) return 'not a bulletin';
  const inR = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
  if (!inR(o.usd_buy, 40, 2000) || !inR(o.usd_sell, 40, 2000) || o.usd_sell < o.usd_buy || o.usd_sell / o.usd_buy > 1.05) return 'USD official out of range';
  if (o.eur_buy != null && !inR(o.eur_buy / o.usd_buy, 0.9, 1.5)) return 'EUR official implausible';
  if (sp?.usd?.buy && !inR(o.usd_buy / sp.usd.buy, 0.6, 1.25)) return 'official too far from market';
  return null;
}
export async function fetchOfficial(sp) {
  const post = await latestBulletinPost();
  if (!post) throw new Error('no bulletin post found');
  const st = pricesState();
  if (st.official?.post === post.id && st.official?.usd) return st.official; // already read
  const o = await ocrBulletin(post.img);
  const bad = checkOfficial(o, sp || st.sp);
  if (bad) throw new Error(`official bulletin rejected: ${bad}`);
  const p = damascusParts(post.ts);
  return {
    src: 'cb.gov.sy (via @AlekhbariahSY)', post: post.id, url: `https://t.me/${post.id}`, date: p.date, ts: post.ts,
    usd: { buy: o.usd_buy, sell: o.usd_sell },
    eur: o.eur_buy ? { buy: o.eur_buy, sell: o.eur_sell || null } : null,
    try: o.try_buy ? { buy: o.try_buy, sell: o.try_sell || null } : null,
  };
}

// ---------------------------------------------------------------- refresh loop
const R = { busy: false, lastSpTry: 0, lastOffTry: 0, spErr: '', offErr: '' };
export async function refreshPrices({ force = false } = {}) {
  if (R.busy) return pricesState();
  R.busy = true;
  const st = pricesState();
  try {
    if (force || Date.now() - R.lastSpTry > 25 * 60_000) {
      R.lastSpTry = Date.now();
      try {
        const sp = await fetchSpToday();
        const bad = checkSp(sp);
        if (bad) { R.spErr = bad; console.warn('[prices] sp-today rejected:', bad); }
        else { st.sp = sp; st.spAt = Date.now(); R.spErr = ''; save(false); }
      } catch (e) { R.spErr = e.message; console.warn('[prices] sp-today failed:', e.message); }
    }
    const p = damascusParts();
    const haveToday = st.official?.date === p.date;
    // the official bulletin appears ~13:00 Damascus on working days: look for it from 12:30, every 30 min
    if ((force || !st.official || (!haveToday && p.hm >= '12:30')) && Date.now() - R.lastOffTry > (force ? 60_000 : 30 * 60_000)) {
      R.lastOffTry = Date.now();
      try {
        const o = await fetchOfficial(st.sp);
        if (o.post !== st.official?.post) { st.official = o; save(false); console.log(`[prices] official bulletin ${o.date}: USD ${o.usd.buy}/${o.usd.sell}`); }
        R.offErr = '';
      } catch (e) { R.offErr = e.message; console.warn('[prices] official failed:', e.message); }
    }
  } finally { R.busy = false; }
  return st;
}
export function pricesDebug() { const st = pricesState(); return { cfg: st.cfg, spAt: st.spAt, spErr: R.spErr, offErr: R.offErr, official: st.official ? { date: st.official.date, usd: st.official.usd } : null, usd: st.sp?.usd }; }

/** public JSON for the website */
export function publicPrices() {
  const st = pricesState();
  if (!st.sp) return { ok: false };
  const { sp, official } = st;
  return {
    ok: true, unit: 'new_syp', oldFactor: 100,
    market: { at: sp.at, src: 'sp-today.com', usd: sp.usd, eur: sp.eur, try: sp.try, sar: sp.sar, aed: sp.aed },
    official: official ? { date: official.date, url: official.url, usd: official.usd, eur: official.eur, try: official.try } : null,
    gold: { at: sp.goldAt, ...sp.gold },
    fuel: { at: sp.fuelAt, items: sp.fuel },
    power: { at: sp.powerAt, items: sp.power },
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

export function pricesSvg(st, now = Date.now()) {
  const { sp, official } = st;
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
  // exchange table
  y += 26;
  const rows = [
    ['🇺🇸', 'دولار أمريكي', sp.usd], ['🇪🇺', 'يورو', sp.eur], ['🇹🇷', 'ليرة تركية', sp.try],
  ].filter((r) => r[2]);
  const rowH = 96; const th = 64 + rows.length * rowH + (official ? 132 : 0);
  o.push(card(P, y, W - 2 * P, th));
  const cBuy = P + 380; const cSell = P + 150; const cName = R - 32;
  o.push(text(cName, y + 44, 'السوق الموازية (دمشق)', { size: 22, weight: 700, fill: '#9ca3af' }));
  o.push(text(cBuy, y + 44, 'شراء', { size: 22, weight: 700, fill: '#9ca3af', anchor: 'middle' }));
  o.push(text(cSell, y + 44, 'مبيع', { size: 22, weight: 700, fill: '#9ca3af', anchor: 'middle' }));
  let ry = y + 64;
  for (const [, name, r] of rows) {
    o.push(`<rect x="${P + 20}" y="${ry}" width="${W - 2 * P - 40}" height="1" fill="#1f2937"/>`);
    o.push(text(cName, ry + 58, name, { size: 32, weight: 700, fill: '#ffffff' }));
    const a = arrow(r.change);
    o.push(text(cName - (name.length * 19 + 22), ry + 56, `${a.s}${Math.abs(r.change || 0).toFixed(2)}%`, { size: 19, weight: 700, fill: a.c, family: 'Noto Sans' }));
    o.push(text(cBuy, ry + 52, fmtNew(r.buy), { size: 38, weight: 800, fill: '#ffffff', anchor: 'middle', family: 'Noto Sans' }));
    o.push(text(cBuy, ry + 80, `${fmtOld(r.buy)} قديمة`, { size: 17, weight: 500, fill: '#6b7280', anchor: 'middle' }));
    o.push(text(cSell, ry + 52, fmtNew(r.sell), { size: 38, weight: 800, fill: '#ffffff', anchor: 'middle', family: 'Noto Sans' }));
    o.push(text(cSell, ry + 80, `${fmtOld(r.sell)} قديمة`, { size: 17, weight: 500, fill: '#6b7280', anchor: 'middle' }));
    ry += rowH;
  }
  if (official) {
    o.push(`<rect x="${P + 20}" y="${ry + 6}" width="${W - 2 * P - 40}" height="114" rx="16" fill="#0b2a1f" stroke="#065f46"/>`);
    o.push(text(cName, ry + 46, 'السعر الرسمي — مصرف سورية المركزي', { size: 23, weight: 700, fill: '#6ee7b7' }));
    o.push(text(cName, ry + 84, `دولار: ${fmtNew(official.usd.buy)} / ${fmtNew(official.usd.sell)}${official.eur ? `  ·  يورو: ${fmtNew(official.eur.buy)} / ${fmtNew(official.eur.sell)}` : ''}`, { size: 25, weight: 700, fill: '#ffffff' }));
    o.push(text(P + 40, ry + 46, `نشرة ${dateLabel(official.date)}`, { size: 19, weight: 600, fill: '#6ee7b7', anchor: 'start' }));
    o.push(text(P + 40, ry + 84, 'شراء / مبيع', { size: 18, weight: 500, fill: '#9ca3af', anchor: 'start' }));
  }
  y += th + 34;
  // gold
  const g = sp.gold || {};
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
  const F = sp.fuel || {};
  const fl = [['بنزين 90', F.benzin, 'لتر'], ['بنزين 95', F['gasoline-95'], 'لتر'], ['مازوت', F.diesel, 'لتر'], ['غاز منزلي', F.gas, 'أسطوانة']].filter((x) => x[1]?.price);
  if (fl.length) {
    o.push(text(R, y + 34, 'المحروقات — السعر الرسمي', { size: 34, weight: 800, fill: '#ffffff' }));
    if (sp.fuelAt) o.push(text(P, y + 34, `منذ ${dateLabel(String(sp.fuelAt).slice(0, 10))}`, { size: 20, weight: 600, fill: '#9ca3af', anchor: 'start' }));
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
  }
  // footer
  H = Math.round(y + 150);
  const fy = H - 40;
  o.push(text(R, fy - 74, 'السوق الموازية: متوسط أسعار دمشق · المحروقات: التسعيرة الرسمية · الذهب: سعر المبيع', { size: 17, weight: 500, fill: '#6b7280' }));
  o.push(text(R, fy - 48, 'الأسعار للاطلاع وقد تختلف بين المحافظات والمحلات · كل 1 ليرة جديدة = 100 ليرة قديمة', { size: 17, weight: 500, fill: '#6b7280' }));
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
  const { sp, official } = st;
  const L = [];
  L.push(`💱 <b>نشرة الأسعار — ${dayLabel(now)}</b>`, '');
  L.push('<b>السوق الموازية (دمشق)</b> — شراء / مبيع:');
  if (sp.usd) L.push(`🇺🇸 الدولار: <b>${fmtNew(sp.usd.buy)}</b> / <b>${fmtNew(sp.usd.sell)}</b>`);
  if (sp.eur) L.push(`🇪🇺 اليورو: <b>${fmtNew(sp.eur.buy)}</b> / <b>${fmtNew(sp.eur.sell)}</b>`);
  if (sp.try) L.push(`🇹🇷 التركية: <b>${fmtNew(sp.try.buy)}</b> / <b>${fmtNew(sp.try.sell)}</b>`);
  if (official) L.push(`🏦 الرسمي (المركزي، نشرة ${dateLabel(official.date)}): الدولار <b>${fmtNew(official.usd.buy)}</b> / <b>${fmtNew(official.usd.sell)}</b>`);
  const g = sp.gold || {};
  if (g.k21) L.push('', `🟡 ذهب عيار 21: <b>${fmtNew(g.k21.sell || g.k21.buy)}</b> · عيار 18: <b>${fmtNew(g.k18?.sell || g.k18?.buy)}</b> ل.س للغرام`);
  const F = sp.fuel || {};
  if (F.benzin || F.diesel) L.push(`⛽ بنزين 90: <b>${fmtNew(F.benzin?.price)}</b> · مازوت: <b>${fmtNew(F.diesel?.price)}</b> · غاز: <b>${fmtNew(F.gas?.price)}</b>`);
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
  const bad = checkSp(st.sp);
  if (bad) return { ok: false, why: bad };
  return { ok: true, st };
}
export async function postBulletin(api, { chatId = config.channel, test = false } = {}) {
  const r = await readyData();
  if (!r.ok) return r;
  const png = renderPricesPng(r.st);
  const head = test ? '🧪 <b>معاينة خاصة — لم تُنشر في القناة.</b>\nهكذا ستظهر نشرة الأسعار:\n\n' : '';
  const m = await api.sendPhoto(chatId, new InputFile(png, `prices-${damascusParts().date}.png`), { caption: (head + pricesCaption(r.st)).slice(0, 1024), parse_mode: 'HTML', reply_markup: test ? undefined : postKb() });
  return { ok: true, message_id: m.message_id, official: !!r.st.official };
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
        if (!r.official) await notifyOwners(api, 'ℹ️ نُشرت نشرة الأسعار اليوم بدون السعر الرسمي (تعذّر قراءة نشرة المصرف المركزي).');
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
    const st = pricesState(); const c = st.cfg; const sp = st.sp; const of = st.official;
    const status = sp ? `💵 الدولار الآن (موازي): <b>${fmtNew(sp.usd?.buy)} / ${fmtNew(sp.usd?.sell)}</b>\n🏦 الرسمي: ${of ? `<b>${fmtNew(of.usd.buy)} / ${fmtNew(of.usd.sell)}</b> (نشرة ${dateLabel(of.date)})` : '—'}` : '⏳ لسا ما وصلت بيانات الأسعار.';
    return en(ctx)
      ? `💱 <b>Daily prices bulletin</b>\n\nStatus: <b>${c.on ? '✅ On' : '⏸ Off'}</b>\nTime: <b>${c.time}</b> (Damascus)\n\nEvery morning the bot posts an image with exchange rates (parallel + official), gold and fuel prices in the channel. If the numbers can't be verified that day nothing is posted and you get a private notice.\n\n${status}${c.last ? `\nLast run: ${c.last}` : ''}`
      : `💱 <b>نشرة الأسعار اليومية</b>\n\nالحالة: <b>${c.on ? '✅ مفعّلة' : '⏸ متوقفة'}</b>\nالوقت: <b>${c.time}</b> بتوقيت دمشق\n\nكل صباح ينشر البوت بالقناة صورة فيها أسعار الصرف (الموازي والرسمي) والذهب والمحروقات. إذا ما قدرنا نتأكد من الأرقام بهداك اليوم ما بينشر شي وبتوصلك رسالة خاصة.\n\n${status}${c.last ? `\nآخر تشغيل: ${c.last}` : ''}`;
  };
  const kb = (ctx) => {
    const c = pricesState().cfg; const e = en(ctx);
    const k = new InlineKeyboard().text(c.on ? (e ? '⏸ Turn off' : '⏸ إيقاف') : (e ? '▶️ Turn on' : '▶️ تشغيل'), c.on ? 'px:off' : 'px:on').row();
    PRICE_TIMES.forEach((t, i) => { k.text((t === c.time ? '✅ ' : '') + t, `px:t:${t}`); if (i % 3 === 2) k.row(); });
    return k.text(e ? '📤 Send me a preview' : '📤 أرسل لي معاينة', 'px:test').row()
      .text(e ? '📢 Post in the channel now' : '📢 انشرها بالقناة الآن', 'px:now').row()
      .text(h.L(ctx).btnHome, 'home');
  };
  bot.callbackQuery('px', (ctx) => onlyOwner(ctx, async () => { await ctx.answerCallbackQuery(); await h.show(ctx, txt(ctx), kb(ctx)); }));
  bot.callbackQuery(/^px:(on|off)$/, (ctx) => onlyOwner(ctx, async () => {
    const c = pricesState().cfg; const on = ctx.match[1] === 'on';
    if (on && !c.on) { const p = damascusParts(); if (p.hm >= c.time) c.last = p.date; }
    c.on = on; save();
    await ctx.answerCallbackQuery(on ? 'تم التشغيل' : 'تم الإيقاف');
    await h.show(ctx, txt(ctx), kb(ctx));
  }));
  bot.callbackQuery(/^px:t:(\d\d:\d\d)$/, (ctx) => onlyOwner(ctx, async () => {
    const t = ctx.match[1]; if (!PRICE_TIMES.includes(t)) return ctx.answerCallbackQuery();
    const c = pricesState().cfg; c.time = t; const p = damascusParts(); if (p.hm >= t) c.last = p.date; save();
    await ctx.answerCallbackQuery(`⏰ ${t}`);
    await h.show(ctx, txt(ctx), kb(ctx));
  }));
  bot.callbackQuery('px:test', (ctx) => onlyOwner(ctx, async () => {
    await ctx.answerCallbackQuery(en(ctx) ? 'Preparing…' : 'جارٍ التجهيز…');
    await ctx.replyWithChatAction('upload_photo').catch(() => {});
    try {
      const r = await postBulletin(ctx.api, { chatId: ctx.chat.id, test: true });
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
