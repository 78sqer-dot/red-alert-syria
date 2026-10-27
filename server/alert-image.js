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
import { SVG as BASE_GLYPHS } from '../public/js/marker-svgs.js';
import { EXTRA_SVG } from '../public/js/target-svgs.js';
import { zonePoints, alertZones } from './places.js';

const GLYPHS = { ...BASE_GLYPHS, ...EXTRA_SVG };
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
  ar: { breaking: 'خبر عاجل', uav: 'تحليق مسيّرة', uav_strike: 'استهداف بمسيّرة', warplane: 'تحليق طيران حربي', missile: 'إطلاق صواريخ', attack: 'هجوم', assassination: 'اغتيال', artillery: 'قصف مدفعي', explosion: 'انفجار', civil: 'تنبيه مدني', accident: 'حادث سير', protest: 'مظاهرة', fire: 'حريق', civil_plane: 'طائرة مدنية', quake: 'زلزال', weather: 'تحذير جوي' },
  en: { breaking: 'Breaking news', uav: 'Drone activity', uav_strike: 'Drone strike', warplane: 'Warplane activity', missile: 'Missile launch', attack: 'Attack', assassination: 'Assassination', artillery: 'Artillery shelling', explosion: 'Explosion', civil: 'Civil alert', accident: 'Traffic accident', protest: 'Protest', fire: 'Fire', civil_plane: 'Civil aircraft', quake: 'Earthquake', weather: 'Weather warning' },
};
const LEVELS = {
  caution: { ar: 'حيطة وحذر', en: 'Caution', color: '#fdba74' },
  danger: { ar: 'خطر', en: 'Danger', color: '#f87171' },
  urgent: { ar: 'عاجل', en: 'Urgent', color: '#f87171' },
  notice: { ar: 'تنبيه', en: 'Notice', color: '#fcd34d' },
  info: { ar: 'للعلم', en: 'For information', color: '#7dd3fc' },
};
// line icons (Lucide, ISC) for weather hazards in the image title — resvg has no emoji font
const HAZARD_ICON = {
  rain: ['M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242', 'M16 14v6', 'M8 14v6', 'M12 16v6'],
  snow: ['M2 12h20', 'M12 2v20', 'm20 16-4-4 4-4', 'm4 8 4 4-4 4', 'm16 4-4 4-4-4', 'm8 20 4-4 4 4'],
  wind: ['M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2', 'M9.6 4.6A2 2 0 1 1 11 8H2', 'M12.6 19.4A2 2 0 1 0 14 16H2'],
  storm: ['M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973', 'm13 12-3 5h4l-3 5'],
  heat: ['M12 9a4 4 0 0 0-2 7.5', 'M12 3v2', 'm6.6 18.4-1.4 1.4', 'M20 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z', 'M4 13H2', 'M6.34 7.34 4.93 5.93'],
  frost: ['M2 12h10', 'M9 4v16', 'm3 9 3 3-3 3', 'M12 6 9 9 6 6', 'm6 18 3-3 1.5 1.5', 'M20 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z'],
  dust: ['M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242', 'M16 17H7', 'M17 21H9'],
};
const hazardIconSvg = (k, x, y, size, color) => `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${HAZARD_ICON[k].map((d) => `<path d="${d}"/>`).join('')}</g>`;
const LEVEL_OF = { breaking: 'urgent', uav: 'caution', uav_strike: 'danger', warplane: 'caution', missile: 'danger', attack: 'danger', assassination: 'danger', artillery: 'danger', explosion: 'danger', civil: 'notice', accident: 'notice', protest: 'notice', fire: 'notice', civil_plane: 'info', quake: 'notice', weather: 'caution' };
const NOTE = {
  ar: { uav: 'ملاحظة: عدد الدوائر يدلّ على عدد المناطق لا على عدد المسيّرات', warplane: 'ملاحظة: الدائرة تدلّ على منطقة التحليق التقريبية', multi: 'ملاحظة: عدد الدوائر يدلّ على عدد المناطق المتأثرة', quake: 'ملاحظة: الدائرة تقريبية لمنطقة الشعور بالهزة، والمصدر مراصد الزلازل الدولية', weather: 'ملاحظة: الدائرة تقريبية للمنطقة المشمولة بالتحذير' },
  en: { uav: 'Note: the number of circles shows the number of areas, not the number of drones', warplane: 'Note: the circle shows the approximate flight area', multi: 'Note: the number of circles shows the number of affected areas', quake: 'Note: the circle approximates where the shaking may be felt (international seismic agencies)', weather: 'Note: the circle approximates the warned area' },
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
function markerSvg(type, cx, cy, k = 1, glyphOverride = null) {
  const t = ALERT_TYPES[type] || ALERT_TYPES.breaking;
  const g = GLYPHS[glyphOverride] || GLYPHS[t.glyph] || GLYPHS.other || '';
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
    const natural = type === 'quake' || type === 'weather';
    const col = natural ? t.ring : dashed ? '#2563eb' : '#dc2626';
    const fill = natural ? t.color : dashed ? '#3b82f6' : '#ef4444';
    o.push(`<defs><radialGradient id="zglow"><stop offset="0.5" stop-color="${fill}" stop-opacity="0.38"/><stop offset="0.75" stop-color="${fill}" stop-opacity="0.14"/><stop offset="1" stop-color="${fill}" stop-opacity="0"/></radialGradient></defs>`);
    for (const zn of zones) {
      const [x, y] = px(zn.lat, zn.lon);
      const r = Math.max(14, (zn.km * 1000) / mPerPx(zn.lat, z));
      o.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 2).toFixed(1)}" fill="url(#zglow)"/>`); // soft glow
      o.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" fill-opacity="0.2" stroke="${col}" stroke-width="${r > 40 ? 4.5 : 3}"${dashed ? ' stroke-dasharray="14 9"' : ''}/>`);
    }
    // a single area keeps its type icon; several areas show just their glowing circles (the title names the type)
    if ((type === 'breaking' || type === 'quake' || type === 'weather' || !t.zone) && zones.length === 1) { const [x, y] = px(center.lat, center.lon); o.push(markerSvg(type, x, y, 1, alert.marker_glyph)); }
  } else if (!country) {
    const [x, y] = px(center.lat, center.lon);
    o.push(markerSvg(type, x, y, 1, alert.marker_glyph));
  }
  // attribution (required by the tile licence)
  o.push(`<rect x="${W - 210}" y="${HEAD + MAP_H - 26}" width="210" height="26" fill="#ffffff" opacity="0.75"/>`);
  o.push(`<text x="${W - 10}" y="${HEAD + MAP_H - 8}" font-family="Noto Sans" font-size="14" fill="#475569" text-anchor="end">© OpenStreetMap contributors</text>`);
  o.push('</g>');

  // ---- header
  o.push(`<rect x="0" y="0" width="${W}" height="${HEAD}" fill="#0f172a"/><rect x="0" y="0" width="${W}" height="6" fill="#f97316"/>`);
  const FF = en ? 'Noto Sans' : 'Noto Kufi Arabic';
  const lvl = LEVELS[(type === 'weather' && alert.meta?.level === 2) || (type === 'quake' && (alert.meta?.mag ?? 0) >= 5) ? 'danger' : LEVEL_OF[type] || 'notice'];
  let head = (HEADLINE[en ? 'en' : 'ar'][type]) || (en ? t.en : t.ar);
  const mag = type === 'quake' ? (alert.meta?.mag ?? Number((String(alert.title || '').match(/([0-9]+(?:\.[0-9])?)/) || [])[1])) : null;
  if (alert.place?.head_ar) head = en ? alert.place.head_en || head : alert.place.head_ar;
  if (Number.isFinite(mag)) head = en ? `M${mag.toFixed(1)} earthquake` : `زلزال بقوة ${arDigits(mag.toFixed(1))}`;
  const short = en ? alert.place?.short_en : alert.place?.short_ar;
  const place = opts.placeLabel != null ? opts.placeLabel : short || (country ? (en ? 'Syria' : 'سوريا') : placeText(alert, lang));
  const titleSize = head.length > 16 ? 44 : 52;
  const hz = type === 'weather' && HAZARD_ICON[alert.meta?.hazard] ? alert.meta.hazard : '';
  const IC = titleSize; // icon box, same height as the title
  if (hz) o.push(hazardIconSvg(hz, en ? 36 : W - 36 - IC, 74 - IC * 0.86, IC, '#ffffff'));
  const tx = en ? 36 + (hz ? IC + 14 : 0) : W - 36 - (hz ? IC + 14 : 0); const anchor = en ? 'start' : 'end';
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

  // ---- channel watermark on the map (bottom-left, away from the OSM credit): forwarded or
  // cropped images still say where they came from
  o.push(channelBadge(16, HEAD + MAP_H - 16 - 46));
  // ---- footer: note (multi-circle / aircraft) + time
  const notes = NOTE[en ? 'en' : 'ar'];
  const note = type === 'uav' ? notes.uav : (type === 'quake' || type === 'weather') ? notes[type] : (zoned && zones.length > 1 ? notes.multi : type === 'warplane' ? notes.warplane : '');
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

const TG_PLANE = 'M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z';
export const CHANNEL_HANDLE = 't.me/Red_Alert_Syria';
export const badgeWidth = (h = 46) => Math.round(h + 8 + CHANNEL_HANDLE.length * Math.round(h * 0.46) * 0.53 + 18);
/** white pill: Telegram icon + t.me/Red_Alert_Syria (x,y = top-left, height 46) */
export function channelBadge(x, y, { h = 46, dark = false } = {}) {
  const label = CHANNEL_HANDLE;
  const fs = Math.round(h * 0.46);
  const w = badgeWidth(h);
  const r = h / 2; const ic = h - 12;
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${dark ? '#0b1220' : '#ffffff'}" fill-opacity="${dark ? 0.85 : 0.92}" stroke="${dark ? '#334155' : '#cbd5e1'}" stroke-width="1.2"/>`
    + `<circle cx="${x + 6 + ic / 2}" cy="${y + h / 2}" r="${ic / 2}" fill="#229ED9"/>`
    + `<path d="${TG_PLANE}" fill="#ffffff" transform="translate(${x + 6 + ic * 0.18} ${y + 6 + ic * 0.2}) scale(${(ic * 0.62) / 24})"/>`
    + `<text x="${x + h + 8}" y="${y + h / 2 + fs * 0.36}" font-family="Noto Sans" font-size="${fs}" font-weight="700" fill="${dark ? '#e2e8f0' : '#0f172a'}">${label}</text></g>`;
}
/** any SVG (same fonts as the cards) -> PNG */
export function svgToPng(svg, width) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Noto Kufi Arabic' } });
  return Buffer.from(r.render().asPng());
}
/** the site logo placed at x,y with height h -> { svg, w } */
export function logoAt(x, y, h) {
  const w = LOGO ? Math.min(h * 5, h * (LOGO.ratio || 2.5)) : 0;
  if (LOGO?.kind === 'svg') return { w, svg: LOGO.body.replace('<svg', `<svg x="${x}" y="${y}" width="${w}" height="${h}"`) };
  if (LOGO?.kind === 'img') return { w, svg: `<image x="${x}" y="${y}" width="${w}" height="${h}" xlink:href="${LOGO.href}"/>` };
  return { w: 0, svg: '' };
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


/** Build a channel-ready map card for a single border crossing. */
export async function borderImageSvg(crossing, status, opts = {}) {
  const BW = W; const HEAD = 144; const MAP_H = 680; const FOOT = 92; const HEIGHT = HEAD + MAP_H + FOOT;
  const { lat, lon } = crossing || {};
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('invalid border crossing coordinates');
  const z = 11;
  const cx = lon2x(lon, z); const cy = lat2y(lat, z);
  const left = cx - BW / 2; const top = cy - MAP_H / 2;
  const x0 = Math.floor(left / TILE); const x1 = Math.floor((left + BW) / TILE);
  const y0 = Math.floor(top / TILE); const y1 = Math.floor((top + MAP_H) / TILE);
  const timeoutMs = Number(opts.timeoutMs) || 6000;
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(fetchTile(z, x, y, timeoutMs).then((href) => ({ x, y, href })));
  const tiles = await Promise.all(jobs);
  const okTiles = tiles.filter((q) => q.href).length;
  if (okTiles < tiles.length * 0.6) throw new Error(`border map tiles unavailable (${okTiles}/${tiles.length})`);

  const color = /^#[0-9a-f]{6}$/i.test(String(status?.color || '')) ? status.color : '#94a3b8';
  const name = String(crossing.ar || crossing.name_ar || '');
  const other = String(crossing.other || crossing.other_ar || '');
  const country = String(crossing.country_ar || '');
  const label = [other, country].filter(Boolean).join(' — ');
  const statusLabel = String(status?.ar || 'غير معروف');
  const when = whenText(opts.timestamp || Date.now(), 'ar');
  const x = (cx - left).toFixed(1); const y = (cy - top + HEAD).toFixed(1);
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${BW}" height="${HEIGHT}" viewBox="0 0 ${BW} ${HEIGHT}">`);
  o.push('<rect width="100%" height="100%" fill="#ffffff"/>');
  o.push(`<clipPath id="border-map-clip"><rect x="0" y="${HEAD}" width="${BW}" height="${MAP_H}"/></clipPath><filter id="border-muted" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0.5"/></filter><g clip-path="url(#border-map-clip)"><rect x="0" y="${HEAD}" width="${BW}" height="${MAP_H}" fill="#f2efe9"/><g filter="url(#border-muted)">`);
  for (const q of tiles) {
    if (!q.href) continue;
    o.push(`<image x="${(q.x * TILE - left).toFixed(1)}" y="${(q.y * TILE - top + HEAD).toFixed(1)}" width="${TILE + 0.6}" height="${TILE + 0.6}" preserveAspectRatio="none" xlink:href="${q.href}"/>`);
  }
  o.push('</g>');
  o.push(`<rect x="0" y="${HEAD}" width="${BW}" height="${MAP_H}" fill="#ffffff" opacity="0.14"/>`);
  o.push(`<circle cx="${x}" cy="${y}" r="54" fill="${color}" opacity="0.22"/><circle cx="${x}" cy="${y}" r="36" fill="#ffffff" opacity="0.98"/><circle cx="${x}" cy="${y}" r="29" fill="${color}"/><circle cx="${x}" cy="${y}" r="8" fill="#ffffff"/>`);
  o.push(`<rect x="${BW - 224}" y="${HEAD + MAP_H - 28}" width="224" height="28" fill="#ffffff" opacity="0.82"/><text x="${BW - 10}" y="${HEAD + MAP_H - 9}" font-family="Noto Sans" font-size="14" fill="#475569" text-anchor="end">© OpenStreetMap contributors</text>`);
  o.push(channelBadge(16, HEAD + MAP_H - 16 - 46));
  o.push('</g>');
  o.push(`<rect x="0" y="0" width="${BW}" height="${HEAD}" fill="#0f172a"/><rect x="0" y="0" width="${BW}" height="6" fill="#f97316"/>`);
  o.push(`<text x="${BW - 34}" y="66" font-family="Noto Kufi Arabic" font-size="44" font-weight="800" fill="#ffffff" text-anchor="end" direction="rtl">معبر ${ttx(name)}</text>`);
  if (label) o.push(`<text x="${BW - 36}" y="112" font-family="Noto Kufi Arabic" font-size="26" font-weight="500" fill="#cbd5e1" text-anchor="end" direction="rtl">${ttx(label)}</text>`);
  o.push(`<circle cx="48" cy="101" r="13" fill="${color}"/><text x="420" y="111" font-family="Noto Kufi Arabic" font-size="28" font-weight="700" fill="${color}" text-anchor="end" direction="rtl">${ttx(statusLabel)}</text>`);
  o.push(`<rect x="0" y="${HEAD + MAP_H}" width="${BW}" height="${FOOT}" fill="#ffffff"/><rect x="0" y="${HEAD + MAP_H}" width="${BW}" height="1.5" fill="#e2e8f0"/><text x="${BW / 2}" y="${HEAD + MAP_H + 56}" font-family="Noto Kufi Arabic" font-size="21" fill="#64748b" text-anchor="middle" direction="rtl">حالة المعبر · ${ttx(when)}</text>`);
  o.push('</svg>');
  return o.join('');
}

/** Render the border map card to PNG. */
export async function renderBorderPng(crossing, status, opts = {}) {
  return svgToPng(await borderImageSvg(crossing, status, opts), OUT_W);
}


/** Build a map card for an explicitly published road-status report. */
export async function roadImageSvg(road, status, opts = {}) {
  const pts = (Array.isArray(road?.pts) ? road.pts : []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
  if (!pts.length) throw new Error('road report has no mappable points');
  const zones = pts.map((p) => ({ lat: p.lat, lon: p.lon, km: 2 }));
  const center = { lat: zones.reduce((sum, p) => sum + p.lat, 0) / zones.length, lon: zones.reduce((sum, p) => sum + p.lon, 0) / zones.length };
  const view = chooseView(zones, center); const z = view.z;
  const BW = W; const HEAD = 144; const MAP_H = 680; const FOOT = 92; const HEIGHT = HEAD + MAP_H + FOOT;
  const cx = lon2x(view.lon, z); const cy = lat2y(view.lat, z);
  const left = cx - BW / 2; const top = cy - MAP_H / 2;
  const x0 = Math.floor(left / TILE); const x1 = Math.floor((left + BW) / TILE);
  const y0 = Math.floor(top / TILE); const y1 = Math.floor((top + MAP_H) / TILE);
  const timeoutMs = Number(opts.timeoutMs) || 6000;
  const jobs = [];
  for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) jobs.push(fetchTile(z, tx, ty, timeoutMs).then((href) => ({ x: tx, y: ty, href })));
  const tiles = await Promise.all(jobs);
  const okTiles = tiles.filter((q) => q.href).length;
  if (okTiles < tiles.length * 0.6) throw new Error(`road map tiles unavailable (${okTiles}/${tiles.length})`);

  const color = /^#[0-9a-f]{6}$/i.test(String(status?.color || '')) ? status.color : '#94a3b8';
  const statusLabel = String(status?.ar || 'حالة طريق');
  const placeNames = pts.map((p) => p.name_ar).filter(Boolean);
  const roadLabel = placeNames.slice(0, 2).join('، ') + (placeNames.length > 2 ? ` +${placeNames.length - 2}` : '');
  const when = whenText(opts.timestamp || road.ts || Date.now(), 'ar');
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${BW}" height="${HEIGHT}" viewBox="0 0 ${BW} ${HEIGHT}">`);
  o.push('<rect width="100%" height="100%" fill="#ffffff"/>');
  o.push(`<clipPath id="road-map-clip"><rect x="0" y="${HEAD}" width="${BW}" height="${MAP_H}"/></clipPath><filter id="road-muted" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0.5"/></filter><g clip-path="url(#road-map-clip)"><rect x="0" y="${HEAD}" width="${BW}" height="${MAP_H}" fill="#f2efe9"/><g filter="url(#road-muted)">`);
  for (const q of tiles) {
    if (!q.href) continue;
    o.push(`<image x="${(q.x * TILE - left).toFixed(1)}" y="${(q.y * TILE - top + HEAD).toFixed(1)}" width="${TILE + 0.6}" height="${TILE + 0.6}" preserveAspectRatio="none" xlink:href="${q.href}"/>`);
  }
  o.push('</g>');
  o.push(`<rect x="0" y="${HEAD}" width="${BW}" height="${MAP_H}" fill="#ffffff" opacity="0.14"/>`);
  const radius = pts.length > 6 ? 17 : pts.length > 1 ? 21 : 28;
  for (const p of pts) {
    const px = (lon2x(p.lon, z) - left).toFixed(1); const py = (lat2y(p.lat, z) - top + HEAD).toFixed(1);
    o.push(`<circle cx="${px}" cy="${py}" r="${radius + 19}" fill="${color}" opacity="0.16"/><circle cx="${px}" cy="${py}" r="${radius + 7}" fill="#ffffff" opacity="0.98"/><circle cx="${px}" cy="${py}" r="${radius}" fill="${color}"/><circle cx="${px}" cy="${py}" r="6" fill="#ffffff"/>`);
  }
  o.push(`<rect x="${BW - 224}" y="${HEAD + MAP_H - 28}" width="224" height="28" fill="#ffffff" opacity="0.82"/><text x="${BW - 10}" y="${HEAD + MAP_H - 9}" font-family="Noto Sans" font-size="14" fill="#475569" text-anchor="end">© OpenStreetMap contributors</text>`);
  o.push(channelBadge(16, HEAD + MAP_H - 16 - 46));
  o.push('</g>');
  o.push(`<rect x="0" y="0" width="${BW}" height="${HEAD}" fill="#0f172a"/><rect x="0" y="0" width="${BW}" height="6" fill="#f97316"/>`);
  o.push(`<text x="${BW - 34}" y="66" font-family="Noto Kufi Arabic" font-size="44" font-weight="800" fill="#ffffff" text-anchor="end" direction="rtl">حالة طريق</text>`);
  if (roadLabel) o.push(`<text x="${BW - 36}" y="112" font-family="Noto Kufi Arabic" font-size="25" font-weight="500" fill="#cbd5e1" text-anchor="end" direction="rtl">${ttx(roadLabel)}</text>`);
  o.push(`<circle cx="48" cy="101" r="13" fill="${color}"/><text x="420" y="111" font-family="Noto Kufi Arabic" font-size="28" font-weight="700" fill="${color}" text-anchor="end" direction="rtl">${ttx(statusLabel)}</text>`);
  o.push(`<rect x="0" y="${HEAD + MAP_H}" width="${BW}" height="${FOOT}" fill="#ffffff"/><rect x="0" y="${HEAD + MAP_H}" width="${BW}" height="1.5" fill="#e2e8f0"/><text x="${BW / 2}" y="${HEAD + MAP_H + 56}" font-family="Noto Kufi Arabic" font-size="21" fill="#64748b" text-anchor="middle" direction="rtl">حالة الطريق · ${ttx(when)}</text>`);
  o.push('</svg>');
  return o.join('');
}

/** Render the road-status map card to PNG. */
export async function renderRoadPng(road, status, opts = {}) {
  return svgToPng(await roadImageSvg(road, status, opts), OUT_W);
}
