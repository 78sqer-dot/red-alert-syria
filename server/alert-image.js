// Per-alert map card for the Telegram channel (like redalert.com.lb's channel images):
// navy header (title + severity + place, logo + site domain), a light street/topographic map
// zoomed on the affected place with the red impact circle(s) / marker, and a short note footer.
// Pure SVG -> PNG with resvg; map = raster tiles (CARTO Voyager, OSM fallback), cached in memory.
// Swap the logo by replacing public/img/logo-wordmark.svg (or set ALERT_IMAGE_LOGO to an .svg/.png).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { ALERT_TYPES } from '../shared/types.js';
import { SVG as GLYPHS } from '../public/js/marker-svgs.js';
import { zonePoints, alertZones } from './places.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(ROOT, 'assets', 'fonts');
// only the faces this card uses (fewer fonts = less CPU per render on the small Render instance)
const FONT_FILES = ['NotoKufiArabic-Regular.ttf', 'NotoKufiArabic-Bold.ttf', 'NotoKufiArabic-ExtraBold.ttf', 'NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'].map((f) => path.join(FONT_DIR, f)).filter((f) => fs.existsSync(f));
const TZ = 'Asia/Damascus';

const W = 1024;            // layout width (SVG units)
const OUT_W = Number(process.env.ALERT_IMAGE_WIDTH) || 820; // PNG width: 820 = map tiles at native size (fast, sharp)
const HEAD = 136;          // header height (incl. 6px accent bar)
const MAP_H = 768;         // map height
const FOOT = 84;           // footer height
const H = HEAD + MAP_H + FOOT;
const TILE = 320;          // display size of one 256px OSM tile (x1.25 -> readable labels)

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Noto Kufi Arabic here was extended with Latin punctuation (: · - ( ) …) so mixed lines render in one font.
const ttx = esc;
const arDigits = (s) => String(s).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

// ------------------------------------------------------------------ logo (easy to swap)
function loadLogo() {
  const file = process.env.ALERT_IMAGE_LOGO || path.join(ROOT, '..', 'public', 'img', 'logo-wordmark.svg');
  try {
    if (/\.svg$/i.test(file)) {
      const s = fs.readFileSync(file, 'utf8').replace(/<\?xml[^>]*>/, '');
      const vb = s.match(/viewBox="([\d.\s-]+)"/);
      const [, , vw, vh] = vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 928, 372];
      return { kind: 'svg', body: s.replace(/<svg([^>]*?)\s(width|height)="[^"]*"/g, '<svg$1').replace(/<svg([^>]*?)\s(width|height)="[^"]*"/g, '<svg$1'), ratio: vw / vh };
    }
    const b = fs.readFileSync(file);
    const mime = /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png';
    const ratio = mime === 'image/png' ? b.readUInt32BE(16) / b.readUInt32BE(20) : 2.5;
    return { kind: 'img', href: `data:${mime};base64,${b.toString('base64')}`, ratio };
  } catch { return null; }
}
let LOGO = loadLogo();
export function reloadLogo() { LOGO = loadLogo(); }

// ------------------------------------------------------------------ texts per type
const HEADLINE = {
  ar: { breaking: 'خبر عاجل', uav: 'تحليق مسيّرة', warplane: 'تحليق طيران حربي', missile: 'إطلاق صواريخ', attack: 'هجوم', artillery: 'قصف مدفعي', civil: 'تنبيه مدني', accident: 'حادث سير', protest: 'مظاهرة', fire: 'حريق', civil_plane: 'طائرة مدنية' },
  en: { breaking: 'Breaking news', uav: 'Drone activity', warplane: 'Warplane activity', missile: 'Missile launch', attack: 'Attack', artillery: 'Artillery shelling', civil: 'Civil alert', accident: 'Traffic accident', protest: 'Protest', fire: 'Fire', civil_plane: 'Civil aircraft' },
};
const LEVELS = {
  caution: { ar: 'حيطة وحذر', en: 'Caution', color: '#fdba74' },
  danger: { ar: 'خطر', en: 'Danger', color: '#f87171' },
  urgent: { ar: 'عاجل', en: 'Urgent', color: '#f87171' },
  notice: { ar: 'تنبيه', en: 'Notice', color: '#fcd34d' },
  info: { ar: 'للعلم', en: 'For information', color: '#7dd3fc' },
};
const LEVEL_OF = { breaking: 'urgent', uav: 'caution', warplane: 'caution', missile: 'danger', attack: 'danger', artillery: 'danger', civil: 'notice', accident: 'notice', protest: 'notice', fire: 'notice', civil_plane: 'info' };
const NOTE = {
  ar: { uav: 'ملاحظة: عدد الدوائر يدلّ على عدد المناطق لا على عدد المسيّرات', warplane: 'ملاحظة: الدائرة تدلّ على منطقة التحليق التقريبية', multi: 'ملاحظة: عدد الدوائر يدلّ على عدد المناطق المتأثرة' },
  en: { uav: 'Note: the number of circles shows the number of areas, not the number of drones', warplane: 'Note: the circle shows the approximate flight area', multi: 'Note: the number of circles shows the number of affected areas' },
};
const AR_MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function whenText(ms, lang) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return lang === 'en'
    ? `${+o.day} ${EN_MONTHS[o.month - 1]} ${o.year} · ${o.hour}:${o.minute} (Damascus time)`
    : arDigits(`${+o.day} ${AR_MONTHS[o.month - 1]} ${o.year}، الساعة ${o.hour}:${o.minute} بتوقيت دمشق`);
}
function placeText(a, lang) {
  const l = { ...(a.location || {}), ...(a.place || {}) };
  const en = lang === 'en';
  const name = en ? (l.name_en || l.name_ar) : (l.name_ar || l.name_en);
  const parts = [name];
  const dist = en ? l.district_en : l.district_ar;
  const gov = en ? l.governorate_en : l.governorate_ar;
  for (const p of [dist, gov]) {
    if (!p) continue;
    const norm = (s) => String(s).replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/^(محافظة|منطقة|ناحية)\s+/, '').trim().toLowerCase();
    if (parts.some((q) => q && (norm(q) === norm(p) || norm(q).includes(norm(p)) || norm(p).includes(norm(q))))) continue;
    parts.push(p);
  }
  return parts.filter(Boolean).join(en ? ', ' : '، ');
}

// ------------------------------------------------------------------ geometry
const lon2x = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z;
const lat2y = (lat, z) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z; };
const mPerPx = (lat, z) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** z);

// Pick the view: centre + integer tile zoom so every circle fits with margin, single places close-up.
function chooseView(zones, center) {
  const pts = zones.length ? zones : [{ lat: center.lat, lon: center.lon, km: 1.5 }];
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lon0 = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
  let best = 8;
  for (let z = 13; z >= 7; z--) {
    const xs = pts.map((p) => lon2x(p.lon, z)); const ys = pts.map((p) => lat2y(p.lat, z));
    const rpx = Math.max(...pts.map((p) => (p.km * 1000) / mPerPx(p.lat, z)));
    const w = Math.max(...xs) - Math.min(...xs) + 2 * rpx; const h = Math.max(...ys) - Math.min(...ys) + 2 * rpx;
    const single = pts.length === 1 ? rpx <= 150 : true;
    if (w <= W - 180 && h <= MAP_H - 170 && single) { best = z; break; }
  }
  return { z: best, lat: lat0, lon: lon0 };
}

// ------------------------------------------------------------------ tiles
const PROVIDERS = [
  (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  (z, x, y) => `https://${'abc'[(x + y) % 3]}.tile.openstreetmap.fr/hot/${z}/${x}/${y}.png`,
];
const UA = 'RedAlertSyria/1.0 (+https://red-alert-syria.onrender.com)';
const tileCache = new Map(); // key -> data URI (LRU, ~150 tiles)
async function fetchTile(z, x, y, timeoutMs) {
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) { const v = tileCache.get(key); tileCache.delete(key); tileCache.set(key, v); return v; }
  for (const url of PROVIDERS) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
      const r = await fetch(url(z, x, y), { headers: { 'User-Agent': UA }, signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const b = Buffer.from(await r.arrayBuffer());
      if (b.length < 100) continue;
      const v = `data:image/png;base64,${b.toString('base64')}`;
      tileCache.set(key, v);
      while (tileCache.size > 150) tileCache.delete(tileCache.keys().next().value);
      return v;
    } catch { /* try next provider */ }
  }
  return null;
}

// ------------------------------------------------------------------ marker for point alerts
function markerSvg(type, cx, cy, k = 1) {
  const t = ALERT_TYPES[type] || ALERT_TYPES.breaking;
  const g = GLYPHS[t.glyph] || GLYPHS.other || '';
  const r = 30 * k; const s = r * 1.2;
  const bg = t.marker === 'static' ? (t.disc || t.color) : (t.icon || t.color);
  return `<circle cx="${cx}" cy="${cy}" r="${r + 22}" fill="${t.color}" opacity="0.16"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${r + 4}" fill="#ffffff" opacity="0.95"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${bg}"/>`
    + `<svg x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" viewBox="0 0 512 512"><g fill="#ffffff">${g}</g></svg>`;
}

// ------------------------------------------------------------------ main
export async function alertImageSvg(alert, opts = {}) {
  const { lang = 'ar', timeoutMs = 6000 } = opts;
  const en = lang === 'en';
  const type = ALERT_TYPES[alert.type] ? alert.type : 'breaking';
  const t = ALERT_TYPES[type];
  const loc = alert.location || {};
  const country = alert.scope === 'country' || !Number.isFinite(loc.latitude);
  const center = country ? { lat: 34.85, lon: 38.6 } : { lat: loc.latitude, lon: loc.longitude };
  // every alert type: a glowing circle over each affected area (main area + extra areas)
  const zoned = !country;
  let zones = [];
  if (zoned) {
    zones = Array.isArray(alert.zones) && alert.zones.length ? alert.zones : alertZones({ ...alert, location: loc });
    if (!zones.length) zones = [{ lat: center.lat, lon: center.lon, km: 2.2 }];
  }
  const view = chooseView(zoned ? zones : [{ lat: center.lat, lon: center.lon, km: 1.6 }], center);
  if (country) view.z = 7;
  else if (zones.length === 1) view.z = Math.min(view.z, 12);
  const { z } = view;
  const cx = lon2x(view.lon, z); const cy = lat2y(view.lat, z);
  const left = cx - W / 2; const top = cy - MAP_H / 2;
  const x0 = Math.floor(left / TILE); const x1 = Math.floor((left + W) / TILE);
  const y0 = Math.floor(top / TILE); const y1 = Math.floor((top + MAP_H) / TILE);
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(fetchTile(z, x, y, timeoutMs).then((href) => ({ x, y, href })));
  const tiles = await Promise.all(jobs);
  const okTiles = tiles.filter((q) => q.href).length;
  if (okTiles < tiles.length * 0.6) throw new Error(`map tiles unavailable (${okTiles}/${tiles.length})`);

  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  o.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  // ---- map
  o.push(`<clipPath id="mc"><rect x="0" y="${HEAD}" width="${W}" height="${MAP_H}"/></clipPath><filter id="mute" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0.42"/></filter><g clip-path="url(#mc)"><rect x="0" y="${HEAD}" width="${W}" height="${MAP_H}" fill="#f2efe9"/>`);
  o.push('<g filter="url(#mute)">');
  for (const q of tiles) {
    if (!q.href) continue;
    o.push(`<image x="${(q.x * TILE - left).toFixed(1)}" y="${(q.y * TILE - top + HEAD).toFixed(1)}" width="${TILE + 0.6}" height="${TILE + 0.6}" preserveAspectRatio="none" xlink:href="${q.href}"/>`);
  }
  o.push('</g>');
  // soften the basemap a little so the alert stands out (like the reference)
  o.push(`<rect x="0" y="${HEAD}" width="${W}" height="${MAP_H}" fill="#ffffff" opacity="0.18"/>`);
  const px = (lat, lon) => [lon2x(lon, z) - left, lat2y(lat, z) - top + HEAD];
  if (zoned) {
    const dashed = t.zone === 'dashed';
    const col = dashed ? '#2563eb' : '#dc2626';
    const fill = dashed ? '#3b82f6' : '#ef4444';
    o.push(`<defs><radialGradient id="zglow"><stop offset="0.5" stop-color="${fill}" stop-opacity="0.38"/><stop offset="0.75" stop-color="${fill}" stop-opacity="0.14"/><stop offset="1" stop-color="${fill}" stop-opacity="0"/></radialGradient></defs>`);
    for (const zn of zones) {
      const [x, y] = px(zn.lat, zn.lon);
      const r = Math.max(14, (zn.km * 1000) / mPerPx(zn.lat, z));
      o.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 2).toFixed(1)}" fill="url(#zglow)"/>`); // soft glow
      o.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" fill-opacity="0.2" stroke="${col}" stroke-width="${r > 40 ? 4.5 : 3}"${dashed ? ' stroke-dasharray="14 9"' : ''}/>`);
    }
    // a single area keeps its type icon; several areas show just their glowing circles (the title names the type)
    if ((type === 'breaking' || !t.zone) && zones.length === 1) { const [x, y] = px(center.lat, center.lon); o.push(markerSvg(type, x, y)); }
  } else if (!country) {
    const [x, y] = px(center.lat, center.lon);
    o.push(markerSvg(type, x, y));
  }
  // attribution (required by the tile licence)
  o.push(`<rect x="${W - 210}" y="${HEAD + MAP_H - 26}" width="210" height="26" fill="#ffffff" opacity="0.75"/>`);
  o.push(`<text x="${W - 10}" y="${HEAD + MAP_H - 8}" font-family="Noto Sans" font-size="14" fill="#475569" text-anchor="end">© OpenStreetMap contributors</text>`);
  o.push('</g>');

  // ---- header
  o.push(`<rect x="0" y="0" width="${W}" height="${HEAD}" fill="#0f172a"/><rect x="0" y="0" width="${W}" height="6" fill="#f97316"/>`);
  const FF = en ? 'Noto Sans' : 'Noto Kufi Arabic';
  const lvl = LEVELS[LEVEL_OF[type] || 'notice'];
  const head = (HEADLINE[en ? 'en' : 'ar'][type]) || (en ? t.en : t.ar);
  const place = opts.placeLabel != null ? opts.placeLabel : (country ? (en ? 'Syria' : 'سوريا') : placeText(alert, lang));
  const titleSize = head.length > 16 ? 44 : 52;
  const tx = en ? 36 : W - 36; const anchor = en ? 'start' : 'end';
  o.push(`<text x="${tx}" y="74" font-family="${FF}" font-size="${titleSize}" font-weight="800" fill="#ffffff" text-anchor="${anchor}"${en ? '' : ' direction="rtl"'}>${ttx(head)}</text>`);
  // severity dot + label + place
  const sub = `${en ? lvl.en : lvl.ar}`;
  const dotX = en ? 50 : W - 50;
  o.push(`<circle cx="${dotX}" cy="107" r="13" fill="${lvl.color}"/>`);
  const sx = en ? 74 : W - 74;
  const placeMax = 34;
  const placeShort = place.length > placeMax ? place.slice(0, placeMax - 1) + '…' : place;
  o.push(`<text x="${sx}" y="118" font-family="${FF}" font-size="30" font-weight="700" text-anchor="${anchor}"${en ? '' : ' direction="rtl"'}><tspan fill="${lvl.color}">${ttx(sub)}</tspan>${placeShort ? `<tspan fill="#cbd5e1" font-weight="500">${ttx(' · ' + placeShort)}</tspan>` : ''}</text>`);
  // logo + domain on the other side
  const domain = (process.env.PUBLIC_URL || 'https://red-alert-syria.onrender.com').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const lh = 50; const lw = LOGO ? Math.min(220, lh * (LOGO.ratio || 2.5)) : 0;
  const lx = en ? W - 36 - lw : 36;
  if (LOGO?.kind === 'svg') o.push(LOGO.body.replace('<svg', `<svg x="${lx}" y="28" width="${lw}" height="${lh}"`));
  else if (LOGO?.kind === 'img') o.push(`<image x="${lx}" y="28" width="${lw}" height="${lh}" xlink:href="${LOGO.href}"/>`);
  o.push(`<text x="${en ? W - 36 : 36}" y="112" font-family="Noto Sans" font-size="${domain.length > 24 ? 22 : 26}" font-weight="700" fill="#cbd5e1" text-anchor="${en ? 'end' : 'start'}">${esc(domain)}</text>`);

  // ---- footer: note (multi-circle / aircraft) + time
  const notes = NOTE[en ? 'en' : 'ar'];
  const note = type === 'uav' ? notes.uav : (zoned && zones.length > 1 ? notes.multi : type === 'warplane' ? notes.warplane : '');
  const when = whenText(alert.timestamp || Date.now(), lang);
  const fy = HEAD + MAP_H;
  o.push(`<rect x="0" y="${fy}" width="${W}" height="${FOOT}" fill="#ffffff"/><rect x="0" y="${fy}" width="${W}" height="1.5" fill="#e2e8f0"/>`);
  const fx = W / 2;
  if (note) {
    o.push(`<text x="${fx}" y="${fy + 34}" font-family="${FF}" font-size="21" fill="#94a3b8" text-anchor="middle"${en ? '' : ' direction="rtl"'}>${ttx(note)}</text>`);
    o.push(`<text x="${fx}" y="${fy + 66}" font-family="${FF}" font-size="19" fill="#94a3b8" text-anchor="middle"${en ? '' : ' direction="rtl"'}>${ttx(when)}</text>`);
  } else {
    o.push(`<text x="${fx}" y="${fy + 50}" font-family="${FF}" font-size="21" fill="#94a3b8" text-anchor="middle"${en ? '' : ' direction="rtl"'}>${ttx(when)}</text>`);
  }
  o.push('</svg>');
  return o.join('');
}

/** Render the alert card to PNG. Throws on failure (callers fall back to a text post). */
export async function renderAlertPng(alert, opts = {}) {
  const svg = await alertImageSvg(alert, opts);
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: OUT_W },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Noto Kufi Arabic' },
  });
  return Buffer.from(r.render().asPng());
}
