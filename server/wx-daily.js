// 🌤 Official weather warnings + daily morning weather bulletin.
//  - publicWeather(): only official CAP warnings and links from Syria's National Meteorological Center.
//  - Numeric forecast data is deliberately not published by the website or the morning bulletin.
//  - Morning bulletin: a branded image + short caption in the channel (default 08:00 Damascus), its own
//    post (the prices bulletin stays separate). On/off, time, preview and "post now" in the owner menu.
import { InlineKeyboard, InputFile } from 'grammy';
import { config } from './config.js';
import { store } from './store.js';
import { governorates } from './places.js';
import { damascusParts } from './stats-image.js';
import { svgToPng, channelBadge } from './alert-image.js';
import { EXTRA_POINTS, HAZARDS } from './weather.js';
import { officialWeatherMeta, officialWeatherWarnings, DAILY_BULLETIN_INDEX } from './weather-official.js';
import { WX_LABEL, WX_EMOJI, wxKind, wxIconSvg } from '../shared/wx-icons.js';
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
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const siteUrl = () => (config.publicUrl || 'https://red-alert-syria.onrender.com').replace(/\/$/, '');
const AR_MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const LRM = '\u200E';
const TTL = 30 * 60_000;
const R = { data: null, at: 0, busy: null, err: '', retryAt: 0 };
const WX_CACHE_KEY = 'wxDailyCache';

function restoreWeatherCache() {
  if (R.data) return;
  const c = store.state?.svc?.[WX_CACHE_KEY];
  if (c?.v === 1 && Array.isArray(c.data) && c.data.length >= 10 && Number.isFinite(c.at)) {
    R.data = c.data;
    R.at = c.at;
  }
}
function persistWeatherCache() {
  try {
    (store.state.svc ||= {})[WX_CACHE_KEY] = { v: 1, at: R.at, data: R.data };
    store.persist();
  } catch (e) { console.warn('[wx] cache persistence failed:', e.message); }
}

// regions for the bulletin (north → south → east)
export const REGIONS = [
  { ar: 'الساحل', en: 'Coast', govs: ['02', '14'] },
  { ar: 'الشمال', en: 'North', govs: ['09', '12'] },
  { ar: 'الوسط', en: 'Centre', govs: ['11', '10'] },
  { ar: 'الجنوب', en: 'South', govs: ['13', '08', '06', '05', '03'] },
  { ar: 'الشرق', en: 'East', govs: ['04', '07', '01'] },
];

// ---------------------------------------------------------------- data
async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'RedAlertSyria/1.0' }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const round = (v) => (Number.isFinite(v) ? Math.round(v) : null);
function pointsList() {
  return [
    ...governorates.filter((g) => Number.isFinite(g.lat)).map((g) => ({ id: g.code, gov: g.code, lat: g.lat, lon: g.lon, ar: g.ar, en: g.en, main: 1 })),
    ...EXTRA_POINTS.map((p, i) => ({ id: `x${i + 1}`, gov: p.gov, lat: p.lat, lon: p.lon, ar: p.label, en: p.en || p.label, main: 0 })),
  ];
}
async function fetchAll() {
  const P = pointsList();
  const lat = P.map((p) => p.lat).join(','); const lon = P.map((p) => p.lon).join(',');
  const tz = encodeURIComponent(config.timezone || 'Asia/Damascus');
  const [fc, aq] = await Promise.all([
    getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,is_day,relative_humidity_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,snowfall_sum,wind_gusts_10m_max&timezone=${tz}&forecast_days=2`),
    getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=dust&hourly=dust&timezone=${tz}&forecast_days=2`).catch(() => null),
  ]);
  const fcs = Array.isArray(fc) ? fc : [fc];
  const aqs = aq ? (Array.isArray(aq) ? aq : [aq]) : [];
  const out = [];
  P.forEach((p, i) => {
    const f = fcs[i]; const cur = f?.current; const d = f?.daily;
    if (!cur || !d?.time) return;
    const a = aqs[i];
    const dustDay = {};
    if (a?.hourly?.time) a.hourly.time.forEach((t, k) => { const v = a.hourly.dust[k]; const day = t.slice(0, 10); if (Number.isFinite(v)) dustDay[day] = Math.max(dustDay[day] || 0, v); });
    const dustNow = Number.isFinite(a?.current?.dust) ? a.current.dust : 0;
    const now = {
      t: round(cur.temperature_2m), wind: round(cur.wind_speed_10m), gust: round(cur.wind_gusts_10m), hum: round(cur.relative_humidity_2m),
      day: cur.is_day ? 1 : 0, code: cur.weather_code, dust: round(dustNow),
    };
    now.k = wxKind({ code: now.code, wind: now.wind, gust: now.gust, dust: dustNow, day: now.day });
    const days = d.time.map((day, k) => {
      const x = { day, max: round(d.temperature_2m_max[k]), min: round(d.temperature_2m_min[k]), rain: Math.round((d.precipitation_sum[k] || 0) * 10) / 10,
        pop: round(d.precipitation_probability_max?.[k]), snow: Math.round((d.snowfall_sum[k] || 0) * 10) / 10, gust: round(d.wind_gusts_10m_max[k]), code: d.weather_code[k], dust: round(dustDay[day] || 0) };
      x.k = wxKind({ code: x.code, gust: x.gust, dust: x.dust, day: 1, daily: true });
      return x;
    });
    out.push({ ...p, now, days });
  });
  if (out.filter((p) => p.main).length < 10) throw new Error(`only ${out.length} points`);
  return out;
}
/** cached current + 2-day forecast; `maxAge` lets the bulletin ask for fresher data */
export async function getWeather({ maxAge = TTL } = {}) {
  restoreWeatherCache();
  const now = Date.now();
  if (R.data && now - R.at < maxAge) return R.data;
  if (R.retryAt && now < R.retryAt) {
    if (R.data && now - R.at < 12 * 3600_000) return R.data;
    throw new Error(R.err || 'Open-Meteo temporarily unavailable');
  }
  if (!R.busy) {
    R.busy = fetchAll().then((d) => { R.data = d; R.at = Date.now(); R.err = ''; R.retryAt = 0; persistWeatherCache(); return d; })
      .catch((e) => { R.err = e.message; R.retryAt = Date.now() + (e.message.includes('429') ? 15 * 60_000 : 2 * 60_000); if (R.data && Date.now() - R.at < 12 * 3600_000) return R.data; throw e; })
      .finally(() => { R.busy = null; });
  }
  return R.busy;
}
const govOf = (code) => governorates.find((g) => g.code === code);
const ALERT_EMOJI = { rain: '🌧', snow: '❄️', wind: '💨', storm: '⛈', heat: '🌡', frost: '🥶', dust: '🌫', fog: '🌫' };
function alertHazard(a) {
  if (HAZARDS[a.meta?.hazard]) return a.meta.hazard;
  const t = `${a.title || ''} ${a.title_en || ''} ${a.description || ''} ${a.description_en || ''}`.toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه');
  if (/ثلج|ثلوج|تساقط الثلوج|snow/.test(t)) return 'snow';
  if (/غبار|عجاج|dust storm|dust/.test(t)) return 'dust';
  if (/عواصف رعديه|عاصفه رعديه|رعد|برق|thunderstorm|thunder/.test(t)) return 'storm';
  if (/رياح|هبات|wind/.test(t)) return 'wind';
  if (/امطار|مطر|rain/.test(t)) return 'rain';
  if (/موجه حر|حراره مرتفعه|heat wave|extreme heat/.test(t)) return 'heat';
  if (/صقيع|frost|freezing/.test(t)) return 'frost';
  if (/ضباب|fog/.test(t)) return 'fog';
  return '';
}
/** active weather warnings (published alerts) per governorate code */
export function activeWarnings() {
  const out = [];
  for (const a of store.activeAlerts()) {
    if (a.type !== 'weather') continue;
    const govs = new Set();
    for (const x of [a.place, ...(a.extra || [])]) {
      if (!x) continue;
      if (x.governorate) govs.add(x.governorate);
      else { const g = governorates.find((y) => y.ar === x.governorate_ar); if (g) govs.add(g.code); }
    }
    const hazard = alertHazard(a); const hz = HAZARDS[hazard]; const level = a.meta?.level || 1;
    const channel = String(config.channel || '');
    const url = a.telegram_url || (a.channel_message_id && channel.startsWith('@') ? `https://t.me/${channel.slice(1)}/${a.channel_message_id}` : '');
    out.push({ id: a.id, hazard, level, day: a.meta?.day || '', govs: [...govs], local: true, official: false,
      source: 'Red Alert Syria', source_en: 'Red Alert Syria', url, at: a.timestamp || null,
      details: a.description || '', details_en: a.description_en || '',
      ar: hz ? `${level === 2 ? 'تحذير شديد' : 'تحذير'}: ${hz.ar}` : (a.title || 'تحذير جوي'),
      en: hz ? `${level === 2 ? 'Severe warning' : 'Warning'}: ${hz.en}` : (a.title_en || 'Weather warning'),
      emoji: hz?.emoji || ALERT_EMOJI[hazard] || '⛈', expires_at: a.expires_at });
  }
  return out;
}
export async function allWeatherWarnings({ waitMs = 0 } = {}) {
  const official = await officialWeatherWarnings({ waitMs }).catch(() => []);
  const local = activeWarnings();
  const out = [...official];
  for (const w of local) {
    const duplicate = out.some((x) => x.hazard === w.hazard && x.govs.some((c) => w.govs.includes(c)) && (!x.day || !w.day || x.day === w.day));
    if (!duplicate) out.push(w);
  }
  return out;
}
export async function publicWeather() {
  const [warnings, official] = await Promise.all([
    officialWeatherWarnings({ waitMs: 2_000 }),
    officialWeatherMeta(),
  ]);
  return { ok: true, at: Date.now(), src: 'المركز الوطني للأرصاد الجوية', forecastsAvailable: false,
    official: { ...official, warningSource: 'المركز الوطني للأرصاد الجوية / وزارة الطوارئ وإدارة الكوارث', mapUrl: 'https://climweb.med.gov.sy/mapviewer' },
    warnings: warnings.filter((w) => w.official), points: [] };
}
export const weatherNowDebug = () => ({ at: R.at, err: R.err, points: R.data?.length || 0 });

// ---------------------------------------------------------------- bulletin state
export const WXB_TIMES = ['07:00', '07:30', '08:00', '08:30', '09:30'];
export function wxbState() {
  const s = (store.state.svc ||= {});
  const b = (s.wxb ||= {});
  b.cfg ||= { on: false, time: '08:00', last: null }; // off until the owner turns it on from the menu
  if (!WXB_TIMES.includes(b.cfg.time)) b.cfg.time = '08:00';
  // the very first build switched it on by default before the owner saw a preview: off once, then the owner decides
  if (b.cfg.v !== 2) { b.cfg.on = false; b.cfg.v = 2; }
  // owner approved the preview and said «أي شغلها» (2026-10-25): switch on once, first run the next 08:00
  if (b.cfg.v === 2) {
    b.cfg.on = true; b.cfg.v = 3;
    const p = damascusParts(); if (p.hm >= b.cfg.time) b.cfg.last = p.date; // a time already passed today starts tomorrow
    else if (b.cfg.last === p.date) b.cfg.last = null;
  }
  return b;
}
const save = (soon = true) => store.persist({ backupSoon: soon });
const dayLabel = (ms) => { const p = damascusParts(ms); return `${AR_DAYS[p.wd]} ${p.d} ${AR_MONTHS[p.m - 1]} ${p.y}`; };
const T = (v) => (v == null ? '—' : `${v}°`);
const todayOf = (p, date) => p.days.find((d) => d.day === date) || p.days[0];

// ---------------------------------------------------------------- image
function text(x, y, s, { size = 24, weight = 400, fill = '#e5e7eb', anchor = 'end', family = 'Noto Kufi Arabic', opacity = 1 } = {}) {
  return `<text x="${x}" y="${y}" font-family="${family}, Noto Sans" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${opacity < 1 ? ` opacity="${opacity}"` : ''}>${esc(s)}</text>`;
}
const HZ_KIND = { rain: 'rain', snow: 'snow', wind: 'wind', storm: 'storm', heat: 'sun', frost: 'snow', dust: 'dust', fog: 'fog' };
export function wxBulletinSvg(pts, warns, now = Date.now()) {
  const date = damascusParts(now).date;
  const W = 1080; const P = 48; const RX = W - P;
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="__H__" viewBox="0 0 ${W} __H__">`);
  o.push(`<defs>
    <radialGradient id="glow" cx="85%" cy="0%" r="75%"><stop offset="0" stop-color="#38bdf8" stop-opacity="0.22"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></radialGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1220"/><stop offset="1" stop-color="#070a12"/></linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.025" stroke-width="1"/></pattern>
  </defs>`);
  o.push(`<rect width="${W}" height="__H__" fill="url(#bg)"/><rect width="${W}" height="__H__" fill="url(#grid)"/><rect width="${W}" height="560" fill="url(#glow)"/>`);
  o.push(`<rect x="0" y="0" width="${W}" height="8" fill="#ef233c"/>`);
  const ls = 84; const hy = 44;
  if (LOGO) o.push(LOGO.replace('<svg ', `<svg x="${RX - ls}" y="${hy}" width="${ls}" height="${ls}" `));
  o.push(text(RX - ls - 22, hy + 40, 'RED ALERT SYRIA', { size: 30, weight: 700, fill: '#ffffff', family: 'Noto Sans' }));
  o.push(text(RX - ls - 22, hy + 76, 'نشرة الطقس اليومية', { size: 22, weight: 500, fill: '#9ca3af' }));
  const pill = dayLabel(now); const pw = Math.max(240, pill.length * 14 + 56);
  o.push(`<rect x="${P}" y="${hy + 18}" width="${pw}" height="50" rx="25" fill="#38bdf8" fill-opacity="0.14" stroke="#38bdf8" stroke-opacity="0.55"/>`);
  o.push(text(P + pw / 2, hy + 51, pill, { size: 21, weight: 600, fill: '#bae6fd', anchor: 'middle' }));
  let y = 205;
  o.push(text(RX, y, 'النشرة الرسمية للطقس', { size: 44, weight: 800, fill: '#ffffff' }));
  o.push(text(P, y, 'المركز الوطني للأرصاد الجوية', { size: 20, weight: 600, fill: '#7dd3fc', anchor: 'start' }));
  y += 30;
  // active warnings: one line each (max 2)
  const wl = warns.slice(0, 2);
  for (const w of wl) {
    const lv2 = w.level === 2; const col = lv2 ? '#f87171' : '#fbbf24';
    const names = w.govs.map((c) => govOf(c)?.ar).filter(Boolean);
    const line = `${w.ar}${names.length ? ` — ${names.slice(0, 4).join('، ')}${names.length > 4 ? ` و${names.length - 4} غيرها` : ''}` : ''}`;
    o.push(`<rect x="${P}" y="${y}" width="${W - 2 * P}" height="72" rx="18" fill="${lv2 ? '#3b0d0d' : '#2d2006'}" stroke="${col}" stroke-opacity="0.6"/>`);
    o.push(wxIconSvg(HZ_KIND[w.hazard] || 'storm', RX - 24 - 40, y + 16, 40, col));
    o.push(text(RX - 80, y + 47, line.length > 58 ? line.slice(0, 57) + '…' : line, { size: 26, weight: 700, fill: '#ffffff' }));
    y += 86;
  }
  if (!wl.length) {
    o.push(`<rect x="${P}" y="${y}" width="${W - 2 * P}" height="72" rx="18" fill="#111827" stroke="#334155"/>`);
    o.push(text(RX - 24, y + 45, 'لا توجد تنبيهات رسمية نشطة ظاهرة في موجز المركز عند آخر تحقق', { size: 22, weight: 600, fill: '#cbd5e1' }));
    y += 86;
  }
  y += 6;
  const byGov = new Map(pts.filter((p) => p.main).map((p) => [p.gov, p]));
  const gap = 16; const ch = 132;
  for (const rg of REGIONS) {
    const items = rg.govs.map((c) => byGov.get(c)).filter(Boolean);
    if (!items.length) continue;
    o.push(text(RX, y + 30, rg.ar, { size: 26, weight: 800, fill: '#7dd3fc' }));
    o.push(`<rect x="${P}" y="${y + 20}" width="${W - 2 * P - rg.ar.length * 17 - 30}" height="1" fill="#1f2937"/>`);
    y += 48;
    items.forEach((p, i) => {
      // 3 per row; a short last row (or a 2-governorate region) gets wider cards instead of empty slots
      const row0 = Math.floor(i / 3) * 3; const inRow = Math.min(3, items.length - row0); const col = i - row0;
      if (i && !col) y += ch + gap;
      const cw = (W - 2 * P - gap * (inRow - 1)) / inRow;
      const x = RX - (col + 1) * cw - col * gap;
      const d = todayOf(p, date);
      o.push(`<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="20" fill="#111827" stroke="#1f2937" stroke-width="1.5"/>`);
      o.push(text(x + cw - 22, y + 44, p.ar, { size: 28, weight: 800, fill: '#ffffff' }));
      o.push(text(x + cw - 22, y + 76, WX_LABEL.ar[d.k], { size: 20, weight: 600, fill: '#94a3b8' }));
      o.push(`<circle cx="${x + 54}" cy="${y + 50}" r="32" fill="#ffffff" fill-opacity="0.06"/>`);
      o.push(wxIconSvg(d.k, x + 34, y + 30, 40, '#e2e8f0'));
      o.push(text(x + cw - 22, y + 116, `${T(d.max)}`, { size: 38, weight: 800, fill: '#ffffff', family: 'Noto Sans' }));
      const mx = `${T(d.max)}`.length * 23 + 12;
      o.push(text(x + cw - 22 - mx, y + 116, `/ ${T(d.min)}`, { size: 26, weight: 600, fill: '#94a3b8', family: 'Noto Sans' }));
      if (d.pop >= 30 || d.rain >= 1) o.push(text(x + 24, y + 116, `${d.pop ?? 0}%`, { size: 22, weight: 700, fill: '#60a5fa', anchor: 'start', family: 'Noto Sans' }));
      else if (d.gust >= 45) o.push(text(x + 24, y + 116, `${d.gust} km/h`, { size: 18, weight: 700, fill: '#5eead4', anchor: 'start', family: 'Noto Sans' }));
    });
    y += ch + 26;
  }
  if (!pts.length) {
    o.push(`<rect x="${P}" y="${y}" width="${W - 2 * P}" height="112" rx="20" fill="#0b1723" stroke="#1e3a5f"/>`);
    o.push(text(RX - 24, y + 45, 'التوقعات التفصيلية تُنشر في النشرة الحكومية الرسمية', { size: 23, weight: 700, fill: '#e2e8f0' }));
    o.push(text(RX - 24, y + 82, 'افتح رابط النشرة في نص المنشور للاطلاع على أحدث التفاصيل', { size: 19, weight: 500, fill: '#94a3b8' }));
    y += 134;
  }
  const H = Math.round(y + 130);
  const fy = H - 40;
  o.push(text(RX, fy - 52, 'المصدر: المركز الوطني للأرصاد الجوية · موجز التحذيرات الحكومي الرسمي', { size: 17, weight: 500, fill: '#6b7280' }));
  o.push(`<rect x="${P}" y="${fy - 32}" width="${W - 2 * P}" height="1" fill="#1f2937"/>`);
  o.push(text(RX, fy + 6, 'red-alert-syria.onrender.com', { size: 21, weight: 700, fill: '#cbd5e1', family: 'Noto Sans' }));
  o.push(channelBadge(P, fy - 40 + 14, { h: 40, dark: true }));
  o.push('</svg>');
  return o.join('\n').replaceAll('__H__', String(H));
}

// ---------------------------------------------------------------- caption
export function wxBulletinCaption(pts, warns, now = Date.now(), official = null) {
  const L = [`🌤 <b>نشرة الطقس — ${dayLabel(now)}</b>`, ''];
  if (!warns.length) L.push('لا توجد تنبيهات رسمية نشطة ظاهرة في موجز المركز عند آخر تحقق.');
  for (const w of warns.slice(0, 2)) {
    const names = w.govs.map((c) => govOf(c)?.ar).filter(Boolean);
    L.push('', `⚠️ <b>${esc(w.ar)}</b> ${w.emoji}${names.length ? ` — ${esc(names.slice(0, 5).join('، '))}${names.length > 5 ? ' وغيرها' : ''}` : ''}`);
  }
  L.push('', '<i>نعرض التحذيرات الحكومية فقط، ولا ننشر توقعات عددية من مصادر خارجية.</i>');
  L.push(`📡 <a href="${esc(official?.url || DAILY_BULLETIN_INDEX)}">النشرة الرسمية اليومية</a>`);
  L.push(`🗺 <a href="https://climweb.med.gov.sy/mapviewer">خريطة المركز الرسمية</a> · <a href="${esc(CAP_FEED_URL)}">موجز التحذيرات الرسمي</a>`);
  return L.join('\n');
}

// ---------------------------------------------------------------- posting
function postKb() {
  const kb = new InlineKeyboard().url('🌤 الطقس على الخريطة', `${siteUrl()}/ar/#weather`);
  if (config.reportBotUsername) kb.url('📨 أرسل بلاغاً', `https://t.me/${config.reportBotUsername}?start=report`);
  return kb;
}
async function readyData() {
  await officialWeatherWarnings({ waitMs: 2_000 }).catch(() => []);
  return { ok: true, pts: [] };
}
export async function renderWxBulletin(now = Date.now()) {
  const r = await readyData();
  if (!r.ok) return r;
  const [warns, official] = await Promise.all([officialWeatherWarnings({ waitMs: 45_000 }), officialWeatherMeta()]);
  return { ok: true, png: svgToPng(wxBulletinSvg(r.pts, warns, now), 1080), caption: wxBulletinCaption(r.pts, warns, now, official) };
}
export async function postWxBulletin(api, { chatId = config.channel, test = false, en = false } = {}) {
  const r = await renderWxBulletin();
  if (!r.ok) return r;
  const head = test ? (en ? '🧪 <b>Preview</b> — private to you, not posted in the channel.\nThis is how the weather bulletin will look every morning (in Arabic, as in the channel):\n\n' : '🧪 <b>معاينة</b> — خاصة إلك، ما نُشرت بالقناة.\nهيك رح تطلع نشرة الطقس كل صبح:\n\n') : '';
  const tail = test ? (en ? '\n\n▶️ <i>The bulletin is off until you turn it on: Menu → 🌤 Weather bulletin → “Turn on”.</i>' : `\n\n▶️ <i>النشرة متوقفة لحد ما تشغّلها: القائمة ← 🌤 نشرة الطقس ← «تشغيل».</i>`) : '';
  const m = await api.sendPhoto(chatId, new InputFile(r.png, `weather-${damascusParts().date}.png`), { caption: (head + r.caption + (wxbState().cfg.on ? '' : tail)).slice(0, 1024), parse_mode: 'HTML', reply_markup: test ? undefined : postKb() });
  return { ok: true, message_id: m.message_id };
}
async function notifyOwners(api, text) {
  for (const id of config.ownerIds || []) { try { await api.sendMessage(id, text, { parse_mode: 'HTML' }); } catch { /* ignore */ } }
}
let started = false;
export function startWxBulletin(getApi) {
  if (started) return;
  started = true;
  officialWeatherWarnings({ waitMs: 0 }); // warm the official CAP cache in the background after boot
  const c0 = wxbState().cfg; const p0 = damascusParts();
  if (!c0.last && p0.hm >= c0.time) { c0.last = p0.date; save(false); } // first boot after the time: start tomorrow
  save(false); // persist the one-time switch/migrations right away
  let busy = false;
  const tick = async () => {
    const c = wxbState().cfg;
    if (busy) return;
    const api = getApi();
    if (!api) return;
    if (!c.on || !config.channel) return;
    const p = damascusParts();
    if (p.hm < c.time || c.last === p.date) return;
    busy = true;
    c.last = p.date; save(); // mark first: never twice the same day
    try {
      const r = await postWxBulletin(api);
      if (!r.ok) {
        console.warn(`[wxb] ${p.date}: not posted — ${r.why}`);
        await notifyOwners(api, `⚠️ <b>نشرة الطقس ما نُشرت اليوم</b>\n\nالسبب: ${esc(r.why)}\nتقدر تجرب لاحقاً من القائمة ← 🌤 نشرة الطقس ← «انشرها الآن».`);
      } else console.log(`[wxb] ${p.date}: bulletin posted`);
    } catch (e) {
      console.error('[wxb] post failed', e.description || e.message);
      await notifyOwners(api, `⚠️ تعذّر نشر نشرة الطقس: ${esc(e.description || e.message)}`);
    } finally { busy = false; }
  };
  setInterval(tick, 30_000).unref();
  setTimeout(tick, 25_000).unref();
}

// ---------------------------------------------------------------- owner menu (publishing bot)
export function registerWxBulletinTools(bot, h) {
  const en = (ctx) => h.langOf(ctx) === 'en';
  const onlyOwner = async (ctx, fn) => { if (!h.owner(ctx)) return ctx.answerCallbackQuery().catch(() => {}); return fn(); };
  const txt = (ctx) => {
    const c = wxbState().cfg;
    return en(ctx)
      ? `🌤 <b>Morning official weather bulletin</b>\n\nStatus: <b>${c.on ? '✅ On' : '⏸ Off'}</b>\nTime: <b>${c.time}</b> (Damascus)\n\nThe channel bulletin now contains only warnings and links published by Syria’s National Meteorological Center. Third-party numeric forecasts are not published.${c.last ? `\n\nLast run: ${c.last}` : ''}`
      : `🌤 <b>النشرة الجوية الرسمية الصباحية</b>\n\nالحالة: <b>${c.on ? '✅ مفعّلة' : '⏸ متوقفة'}</b>\nالوقت: <b>${c.time}</b> بتوقيت دمشق\n\nالنشرة تعرض فقط التحذيرات والروابط المنشورة من المركز الوطني للأرصاد الجوية. أوقفنا توقعات المصادر الخارجية ولن ننشرها كأنها رسمية.${c.last ? `\n\nآخر تشغيل: ${c.last}` : ''}`;
  };
  const kb = (ctx) => {
    const c = wxbState().cfg; const e = en(ctx);
    const k = new InlineKeyboard().text(c.on ? (e ? '⏸ Turn off' : '⏸ إيقاف') : (e ? '▶️ Turn on' : '▶️ تشغيل'), c.on ? 'wxb:off' : 'wxb:on').row();
    WXB_TIMES.forEach((t, i) => { k.text((t === c.time ? '✅ ' : '') + t, `wxb:t:${t}`); if (i % 3 === 2) k.row(); });
    if (WXB_TIMES.length % 3) k.row();
    return k.text(e ? '📤 Send me a preview' : '📤 أرسل لي معاينة', 'wxb:test').row()
      .text(e ? '📢 Post in the channel now' : '📢 انشرها بالقناة الآن', 'wxb:now').row()
      .text(e ? '⛈ Weather warnings' : '⛈ تحذيرات الطقس', 'wx').text(h.L(ctx).btnHome, 'home');
  };
  const show = (ctx) => h.show(ctx, txt(ctx), kb(ctx));
  bot.callbackQuery('wxb', (ctx) => onlyOwner(ctx, async () => { await ctx.answerCallbackQuery().catch(() => {}); await show(ctx); }));
  bot.callbackQuery(/^wxb:(on|off)$/, (ctx) => onlyOwner(ctx, async () => { wxbState().cfg.on = ctx.match[1] === 'on'; save(); await ctx.answerCallbackQuery('✅').catch(() => {}); await show(ctx); }));
  bot.callbackQuery(/^wxb:t:(\d\d:\d\d)$/, (ctx) => onlyOwner(ctx, async () => {
    const t = ctx.match[1]; if (!WXB_TIMES.includes(t)) return ctx.answerCallbackQuery().catch(() => {});
    const c = wxbState().cfg; c.time = t;
    const p = damascusParts(); if (p.hm >= t && c.last !== p.date) c.last = p.date; // a time already passed today starts tomorrow
    save(); await ctx.answerCallbackQuery(`✅ ${t}`).catch(() => {}); await show(ctx);
  }));
  bot.callbackQuery('wxb:test', (ctx) => onlyOwner(ctx, async () => {
    await ctx.answerCallbackQuery(en(ctx) ? 'Preparing…' : 'عم جهّزها…').catch(() => {});
    try {
      const r = await postWxBulletin(ctx.api, { chatId: ctx.chat.id, test: true, en: en(ctx) });
      if (!r.ok) await ctx.reply(`⚠️ ${esc(r.why)}`, { parse_mode: 'HTML' });
    } catch (e) { await ctx.reply(`⚠️ ${esc(e.description || e.message)}`, { parse_mode: 'HTML' }).catch(() => {}); }
  }));
  bot.callbackQuery('wxb:now', (ctx) => onlyOwner(ctx, async () => {
    await ctx.answerCallbackQuery().catch(() => {});
    await h.show(ctx, en(ctx) ? '📢 Post today\'s weather bulletin in the channel now?' : '📢 أنشر نشرة طقس اليوم بالقناة هلق؟', new InlineKeyboard().text(en(ctx) ? '✅ Yes, post' : '✅ إي، انشر', 'wxb:now:y').text(en(ctx) ? '↩️ Back' : '↩️ رجوع', 'wxb'));
  }));
  bot.callbackQuery('wxb:now:y', (ctx) => onlyOwner(ctx, async () => {
    await ctx.answerCallbackQuery(en(ctx) ? 'Posting…' : 'جارٍ النشر…').catch(() => {});
    try {
      const r = await postWxBulletin(ctx.api);
      if (r.ok) { wxbState().cfg.last = damascusParts().date; save(); }
      await h.show(ctx, r.ok ? '✅ نُشرت نشرة الطقس بالقناة.' : `⚠️ ما نُشرت: ${esc(r.why)}`, new InlineKeyboard().text('🌤 نشرة الطقس', 'wxb').text(h.L(ctx).btnHome, 'home'));
    } catch (e) { await h.show(ctx, `⚠️ ${esc(e.description || e.message)}`, new InlineKeyboard().text(h.L(ctx).btnHome, 'home')); }
  }));
}

/** Owner-key diagnostics: bulletin switch + the next scheduled run (Damascus time). */
export function wxBulletinDebug() {
  const c = wxbState().cfg; const p = damascusParts();
  let next = null;
  if (c.on) {
    const today = !(p.hm >= c.time || c.last === p.date);
    const d = new Date(Date.UTC(p.y, p.m - 1, p.d + (today ? 0 : 1)));
    next = `${d.toISOString().slice(0, 10)} ${c.time} Asia/Damascus`;
  }
  return { on: c.on, time: c.time, last: c.last, v: c.v, nowDamascus: `${p.date} ${p.hm}`, next, channel: Boolean(config.channel) };
}
