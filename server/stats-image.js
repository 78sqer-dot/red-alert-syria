// Statistics image for the Telegram bots / channel (SVG -> PNG with resvg, Noto Kufi Arabic).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { channelBadge, badgeWidth } from './alert-image.js';
import { Resvg } from '@resvg/resvg-js';
import { ALERT_TYPES, TYPE_KEYS } from '../shared/types.js';
import { SVG as GLYPHS } from '../public/js/marker-svgs.js';
import { store } from './store.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(ROOT, 'assets', 'fonts');
const FONT_FILES = fs.readdirSync(FONT_DIR).filter((f) => f.endsWith('.ttf')).map((f) => path.join(FONT_DIR, f));
const LOGO = (() => {
  try {
    return fs.readFileSync(path.join(ROOT, '..', 'public', 'img', 'icon.svg'), 'utf8').replace(/<\?xml[^>]*>/, '')
      .replace(/<svg([^>]*?)\s(width|height)="[^"]*"/, '<svg$1').replace(/<svg([^>]*?)\s(width|height)="[^"]*"/, '<svg$1');
  } catch { return ''; }
})();

export const TZ = 'Asia/Damascus';
const W = 1200;
const H0 = 1560;
const AR_MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
// brighter variants of a few type colours so the bars read well on the dark card
const BAR = { missile: '#e5484d', attack: '#dc2626', civil: '#06b6d4', civil_plane: '#38bdf8' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = (n) => Number(n || 0).toLocaleString('en-US');

/** date parts of a timestamp in Damascus time */
export function damascusParts(ms = Date.now()) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
  const o = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday);
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, wd, date: `${o.year}-${o.month}-${o.day}`, hm: `${o.hour}:${o.minute}` };
}
/** UTC ms of 00:00 Damascus time on the day containing ms */
export function damascusMidnight(ms = Date.now()) {
  const p = damascusParts(ms);
  // offset = local wall clock - UTC
  const wall = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  const off = wall - Math.floor(ms / 60000) * 60000;
  return Date.UTC(p.y, p.m - 1, p.d) - off;
}
const fmtDay = (ms, lang) => {
  const p = damascusParts(ms);
  return lang === 'en' ? `${p.d} ${EN_MONTHS[p.m - 1]} ${p.y}` : `${AR_DAYS[p.wd]} ${p.d} ${AR_MONTHS[p.m - 1]} ${p.y}`;
};
const fmtShort = (ms, lang) => {
  const p = damascusParts(ms);
  return lang === 'en' ? `${p.d} ${EN_MONTHS[p.m - 1]}` : `${p.d} ${AR_MONTHS[p.m - 1]}`;
};

/**
 * Collect statistics for a period.
 * kind: 'day' (today since 00:00 Damascus), '24h', '7d', '30d'
 */
export function collectStats(kind = '24h', now = Date.now()) {
  const week = kind === 'week';
  if (week) kind = '7d';
  let from; let buckets; let bucketOf; let labels;
  if (kind === 'today') {
    from = damascusMidnight(now);
  } else if (kind === '7d' || kind === '30d') {
    from = damascusMidnight(now) - ((kind === '7d' ? 7 : 30) - 1) * 86400_000;
  } else {
    from = now - ({ '24h': 1, '7d': 7, '30d': 30 }[kind] || 1) * 86400_000;
  }
  const span = now - from;
  const prev = store.logBetween(from - span, from).length;
  const list = store.logBetween(from, now + 1);
  if (kind === 'today' || kind === 'day' || kind === '24h') {
    buckets = new Array(24).fill(0);
    if (kind === 'today') {
      bucketOf = (ms) => damascusParts(ms).h;
      labels = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
    } else {
      const startH = Math.floor(from / 3600_000);
      bucketOf = (ms) => Math.min(23, Math.max(0, Math.floor(ms / 3600_000) - startH));
      labels = Array.from({ length: 24 }, (_, i) => String(damascusParts((startH + i) * 3600_000).h).padStart(2, '0'));
    }
  } else {
    const days = kind === '7d' ? 7 : 30;
    buckets = new Array(days).fill(0);
    const start = damascusMidnight(now) - (days - 1) * 86400_000;
    bucketOf = (ms) => Math.min(days - 1, Math.max(0, Math.floor((ms - start + 3600_000) / 86400_000)));
    labels = Array.from({ length: days }, (_, i) => {
      const p = damascusParts(start + i * 86400_000 + 6 * 3600_000);
      return days === 7 ? { ar: AR_DAYS[p.wd], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.wd], d: p.d } : { ar: String(p.d), en: String(p.d), d: p.d };
    });
  }
  const byType = Object.fromEntries(TYPE_KEYS.map((k) => [k, 0]));
  const gov = new Map();
  const hours = new Array(24).fill(0);
  for (const e of list) hours[damascusParts(Date.parse(e.ts)).h] += 1;
  for (const e of list) {
    if (byType[e.ty] != null) byType[e.ty] += 1;
    buckets[bucketOf(Date.parse(e.ts))] += 1;
    const key = e.g || '_';
    const g = gov.get(key) || { ar: e.ga || 'عموم سوريا', en: e.ge || 'All Syria', n: 0 };
    g.n += 1;
    gov.set(key, g);
  }
  const activeIds = new Set(store.activeAlerts().map((a) => a.id));
  const active = list.filter((e) => activeIds.has(e.id)).length;
  const argmax = (arr) => arr.reduce((bi, v, i) => (v > arr[bi] ? i : bi), 0);
  const bd = argmax(buckets); const bh = argmax(hours);
  const topType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
  return {
    kind: week ? 'week' : kind, from, to: now,
    hours, busiestDay: buckets[bd] ? { label: labels[bd], n: buckets[bd] } : null, busiestHour: hours[bh] ? { h: bh, n: hours[bh] } : null,
    topType: topType && topType[1] ? { key: topType[0], n: topType[1] } : null, total: list.length, prev, active, ended: list.length - active,
    activeNow: activeIds.size, byType, byGov: [...gov.values()].sort((a, b) => b.n - a.n),
    buckets, labels, reports: list.filter((e) => e.src === 'report').length,
  };
}

const T = {
  ar: {
    brand: 'الإنذار الأحمر سوريا',
    title: { week: 'التقرير الأسبوعي', day: 'الملخص اليومي', '24h': 'إحصاءات آخر 24 ساعة', '7d': 'إحصاءات آخر 7 أيام', '30d': 'إحصاءات آخر 30 يوماً' },
    total: 'إجمالي التنبيهات', activeNow: 'نشطة الآن', ended: 'انتهت', vsPrev: { week: 'مقارنة بالأسبوع السابق', day: 'مقارنة بالأمس', '24h': 'مقارنة بالـ24 ساعة السابقة', '7d': 'مقارنة بالأسبوع السابق', '30d': 'مقارنة بالشهر السابق' },
    byType: 'حسب نوع الحدث', byGov: 'حسب المحافظة', chart: { week: 'النشاط اليومي', day: 'النشاط حسب الساعة', '24h': 'النشاط حسب الساعة', '7d': 'النشاط اليومي', '30d': 'النشاط اليومي' }, tz: 'بتوقيت دمشق',
    hl: { day: 'أكثر الأيام نشاطاً', hour: 'ساعة الذروة', type: 'الحدث الأكثر', gov: 'المحافظة الأكثر' }, alerts: 'تنبيه', none: 'لا توجد تنبيهات في هذه الفترة', civil: 'مدني', updated: 'آخر تحديث', noPrev: 'لا بيانات سابقة', same: 'بلا تغيير',
  },
  en: {
    brand: 'Live alerts map of Syria',
    title: { week: 'Weekly report', day: 'Daily summary', '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' },
    total: 'Total alerts', activeNow: 'Active now', ended: 'Ended', vsPrev: { week: 'vs. previous week', day: 'vs. yesterday', '24h': 'vs. previous 24h', '7d': 'vs. previous week', '30d': 'vs. previous month' },
    byType: 'By event type', byGov: 'By governorate', chart: { week: 'Daily activity', day: 'Activity by hour', '24h': 'Activity by hour', '7d': 'Daily activity', '30d': 'Daily activity' }, tz: 'Damascus time',
    hl: { day: 'Busiest day', hour: 'Peak hour', type: 'Top event', gov: 'Top governorate' }, alerts: 'alerts', none: 'No alerts in this period', civil: 'Civil', updated: 'Updated', noPrev: 'no earlier data', same: 'no change',
  },
};

function text(x, y, s, { size = 24, weight = 400, fill = '#e5e7eb', anchor = 'end', opacity = 1, family = 'Noto Kufi Arabic' } = {}) {
  return `<text x="${x}" y="${y}" font-family="${family}, Noto Sans" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${opacity < 1 ? ` opacity="${opacity}"` : ''}>${esc(s)}</text>`;
}
function glyph(key, cx, cy, r, bg) {
  const g = GLYPHS[key] || GLYPHS.other || '';
  const s = r * 1.15;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${bg}"/>`
    + `<svg x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" viewBox="0 0 512 512"><g fill="#ffffff">${g}</g></svg>`;
}
const card = (x, y, w, h, r = 22, fill = '#111827', stroke = '#1f2937') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;

export function statsSvg(st, lang = 'ar') {
  const t = T[lang] || T.ar;
  const rtl = lang !== 'en';
  const P = 56; // page padding
  const R = W - P; // right edge
  const A = rtl ? 'end' : 'start'; // anchor for the "leading" edge
  const lead = rtl ? R : P; // x of leading edge
  const out = [];
  const off = st.kind === 'week' ? 170 : 0; const H = H0 + off;
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  out.push(`<defs>
    <radialGradient id="glow" cx="${rtl ? '85%' : '15%'}" cy="0%" r="75%"><stop offset="0" stop-color="#ef233c" stop-opacity="0.32"/><stop offset="1" stop-color="#ef233c" stop-opacity="0"/></radialGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1220"/><stop offset="1" stop-color="#070a12"/></linearGradient>
    <linearGradient id="gov" x1="${rtl ? 1 : 0}" y1="0" x2="${rtl ? 0 : 1}" y2="0"><stop offset="0" stop-color="#ef233c"/><stop offset="1" stop-color="#ff6b7a"/></linearGradient>
    <linearGradient id="col" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#b3122b"/><stop offset="1" stop-color="#ff4d61"/></linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.025" stroke-width="1"/></pattern>
  </defs>`);
  out.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#grid)"/><rect width="${W}" height="620" fill="url(#glow)"/>`);
  out.push(`<rect x="0" y="0" width="${W}" height="8" fill="#ef233c"/>`);

  // ---- header: logo + brand (leading side), period pill (trailing side)
  const logoS = 92; const logoX = rtl ? R - logoS : P; const hy = 52;
  if (LOGO) out.push(LOGO.replace('<svg ', `<svg x="${logoX}" y="${hy}" width="${logoS}" height="${logoS}" `));
  const bx = rtl ? logoX - 24 : logoX + logoS + 24;
  out.push(text(bx, hy + 44, 'RED ALERT SYRIA', { size: 34, weight: 700, fill: '#ffffff', anchor: A, family: 'Noto Sans' }));
  out.push(text(bx, hy + 84, t.brand, { size: 24, weight: 500, fill: '#9ca3af', anchor: A }));
  let pill;
  if (st.kind === 'day' || st.kind === '24h') pill = fmtDay(st.to, lang);
  else {
    const a = damascusParts(st.from + 3600_000); const b = damascusParts(st.to);
    const sameM = a.m === b.m;
    pill = lang === 'en'
      ? `${sameM ? a.d : fmtShort(st.from + 3600_000, 'en')} to ${fmtShort(st.to, 'en')}`
      : `من ${sameM ? a.d : fmtShort(st.from + 3600_000, 'ar')} إلى ${fmtShort(st.to, 'ar')}`;
  }
  const pw = Math.max(220, pill.length * 15 + 56); const px = rtl ? P : R - pw;
  out.push(`<rect x="${px}" y="${hy + 22}" width="${pw}" height="52" rx="26" fill="#ef233c" fill-opacity="0.14" stroke="#ef233c" stroke-opacity="0.55"/>`);
  out.push(text(px + pw / 2, hy + 57, pill, { size: 22, weight: 600, fill: '#ffd1d6', anchor: 'middle' }));

  // ---- title
  let y = 230;
  out.push(text(lead, y, t.title[st.kind] || t.title['24h'], { size: 54, weight: 800, fill: '#ffffff', anchor: A }));
  const pt = damascusParts(st.to);
  if (rtl) {
    out.push(text(P, y, pt.hm, { size: 22, weight: 600, fill: '#9ca3af', anchor: 'start', family: 'Noto Sans' }));
    out.push(text(P + 72, y, t.updated, { size: 22, weight: 500, fill: '#6b7280', anchor: 'start' }));
  } else {
    out.push(text(R, y, pt.hm, { size: 22, weight: 600, fill: '#9ca3af', anchor: 'end', family: 'Noto Sans' }));
    out.push(text(R - 72, y, t.updated, { size: 22, weight: 500, fill: '#6b7280', anchor: 'end' }));
  }

  // ---- KPI cards
  y = 268;
  const gap = 20; const cw = (W - 2 * P - 3 * gap) / 4; const ch = 170;
  const diff = st.total - st.prev;
  const pct = st.prev ? Math.round((diff / st.prev) * 100) : null;
  const hasPct = st.prev > 0 && diff !== 0;
  const trend = hasPct ? `${Math.abs(pct)}%` : st.prev === 0 && st.total > 0 ? t.noPrev : t.same;
  const kpis = [
    { label: t.total, value: nf(st.total), color: '#ffffff', accent: '#ef233c' },
    { label: t.activeNow, value: nf(st.activeNow), color: '#ff6b7a', accent: '#ff6b7a', dot: true },
    { label: t.ended, value: nf(st.ended), color: '#9ca3af', accent: '#4b5563' },
    { label: t.vsPrev[st.kind] || t.vsPrev['24h'], value: trend, color: !hasPct ? '#9ca3af' : diff > 0 ? '#fb7185' : '#34d399', accent: '#374151', small: !hasPct, arrow: hasPct ? (diff > 0 ? 1 : -1) : 0 },
  ];
  kpis.forEach((k, i) => {
    const x = rtl ? R - (i + 1) * cw - i * gap : P + i * (cw + gap);
    out.push(card(x, y, cw, ch));
    out.push(`<rect x="${rtl ? x + cw - 6 : x}" y="${y + 26}" width="6" height="${ch - 52}" rx="3" fill="${k.accent}"/>`);
    const tx = rtl ? x + cw - 30 : x + 30;
    out.push(text(tx, y + 50, k.label, { size: 21, weight: 500, fill: '#9ca3af', anchor: A }));
    const vx = k.arrow ? (rtl ? tx - 46 : tx + 46) : tx;
    out.push(text(vx, y + (k.small ? 122 : 132), k.value, { size: k.small ? 28 : 66, weight: k.small ? 600 : 800, fill: k.color, anchor: A, family: k.small ? 'Noto Kufi Arabic' : 'Noto Sans' }));
    if (k.arrow) {
      const ax = rtl ? tx - 16 : tx + 16; const ay = y + 108;
      out.push(k.arrow > 0
        ? `<path d="M${ax - 15} ${ay + 12} L${ax + 15} ${ay + 12} L${ax} ${ay - 14} Z" fill="${k.color}"/>`
        : `<path d="M${ax - 15} ${ay - 12} L${ax + 15} ${ay - 12} L${ax} ${ay + 14} Z" fill="${k.color}"/>`);
    }
    if (k.dot) out.push(`<circle cx="${rtl ? x + 34 : x + cw - 34}" cy="${y + 42}" r="9" fill="#ff3b4e"/><circle cx="${rtl ? x + 34 : x + cw - 34}" cy="${y + 42}" r="17" fill="#ff3b4e" fill-opacity="0.2"/>`);
  });

  // ---- weekly highlights
  if (off) {
    y = 462;
    const hw = (W - 2 * P - 3 * gap) / 4; const hh = 146;
    const hd = st.busiestDay; const hr = st.busiestHour; const tt = st.topType; const tg = st.byGov[0];
    const ty = tt ? ALERT_TYPES[tt.key] : null;
    const items = [
      { label: t.hl.day, value: hd ? (typeof hd.label === 'string' ? hd.label : `${lang === 'en' ? hd.label.en : hd.label.ar} ${hd.label.d}`) : '—', sub: hd ? `${nf(hd.n)} ${t.alerts}` : '' },
      { label: t.hl.hour, value: hr ? `${String(hr.h).padStart(2, '0')}:00` : '—', sub: hr ? `${nf(hr.n)} ${t.alerts}` : '', latin: true },
      { label: t.hl.type, value: ty ? (lang === 'en' ? (ty.button_en || ty.en) : ty.button_ar) : '—', sub: tt ? `${nf(tt.n)} ${t.alerts}` : '', glyph: ty ? [ty.glyph, BAR[tt.key] || ty.icon || ty.color] : null },
      { label: t.hl.gov, value: tg ? (lang === 'en' ? tg.en : tg.ar) : '—', sub: tg ? `${nf(tg.n)} ${t.alerts}` : '' },
    ];
    items.forEach((k, i) => {
      const x = rtl ? R - (i + 1) * hw - i * gap : P + i * (hw + gap);
      out.push(card(x, y, hw, hh, 22, '#140d14', '#3b1220'));
      const tx = rtl ? x + hw - 28 : x + 28;
      out.push(text(tx, y + 42, k.label, { size: 20, weight: 500, fill: '#fda4af', anchor: A }));
      let vx = tx;
      if (k.glyph) { out.push(glyph(k.glyph[0], rtl ? tx - 18 : tx + 18, y + 86, 18, k.glyph[1])); vx = rtl ? tx - 46 : tx + 46; }
      const fs = String(k.value).length > 11 ? 24 : 30;
      out.push(text(vx, y + 96, k.value, { size: fs, weight: 800, fill: '#ffffff', anchor: A, family: k.latin ? 'Noto Sans' : 'Noto Kufi Arabic' }));
      if (k.sub) out.push(text(tx, y + 128, k.sub, { size: 18, weight: 500, fill: '#9ca3af', anchor: A }));
    });
  }

  // ---- by type (leading column) & by governorate (trailing column)
  y = 468 + off;
  const colW = (W - 2 * P - gap) / 2; const colH = 742;
  const typeX = rtl ? R - colW : P; const govX = rtl ? P : R - colW;
  out.push(card(typeX, y, colW, colH)); out.push(card(govX, y, colW, colH));
  const head = (x, s) => text(rtl ? x + colW - 30 : x + 30, y + 54, s, { size: 28, weight: 700, fill: '#ffffff', anchor: A });
  out.push(head(typeX, t.byType)); out.push(head(govX, t.byGov));
  // types
  const maxT = Math.max(1, ...Object.values(st.byType));
  const rowH = 58; let ry = y + 104;
  for (const k of TYPE_KEYS) {
    const ty = ALERT_TYPES[k]; const n = st.byType[k] || 0; const col = BAR[k] || ty.icon || ty.color;
    const sub = ty.parent === 'civil';
    const ind = sub ? 26 : 0;
    const ix = rtl ? typeX + colW - 46 - ind : typeX + 46 + ind;
    if (sub) {
      const lx = rtl ? typeX + colW - 46 : typeX + 46;
      out.push(`<path d="M${lx} ${ry - rowH + 20} V${ry} H${rtl ? ix + 19 : ix - 19}" fill="none" stroke="#374151" stroke-width="2"/>`);
    }
    out.push(`<g opacity="${n ? 1 : 0.42}">`);
    out.push(glyph(ty.glyph, ix, ry, 19, col));
    const name = lang === 'en' ? (ty.button_en || ty.en) : ty.button_ar;
    const nx = rtl ? ix - 34 : ix + 34;
    out.push(text(nx, ry + 8, name, { size: 22, weight: 600, fill: '#e5e7eb', anchor: A }));
    // bar track
    const bw = 170; const bx0 = rtl ? typeX + 92 : typeX + colW - 92 - bw;
    out.push(`<rect x="${bx0}" y="${ry - 6}" width="${bw}" height="12" rx="6" fill="#1f2937"/>`);
    const fw = n ? Math.max(12, (bw * n) / maxT) : 0;
    if (fw) out.push(`<rect x="${rtl ? bx0 + bw - fw : bx0}" y="${ry - 6}" width="${fw}" height="12" rx="6" fill="${col}"/>`);
    out.push(text(rtl ? typeX + 30 : typeX + colW - 30, ry + 9, nf(n), { size: 26, weight: 700, fill: n ? '#ffffff' : '#6b7280', anchor: rtl ? 'start' : 'end', family: 'Noto Sans' }));
    out.push('</g>');
    ry += rowH;
  }
  // governorates
  const govs = st.byGov.slice(0, 10);
  if (!govs.length) {
    out.push(text(govX + colW / 2, y + colH / 2, t.none, { size: 24, weight: 500, fill: '#6b7280', anchor: 'middle' }));
  } else {
    const maxG = Math.max(1, ...govs.map((g) => g.n)); let gy = y + 112; const gH = 62;
    govs.forEach((g, i) => {
      const name = lang === 'en' ? g.en : g.ar;
      const tx = rtl ? govX + colW - 30 : govX + 30;
      out.push(text(tx, gy, `${i + 1}`, { size: 20, weight: 700, fill: i < 3 ? '#ff6b7a' : '#6b7280', anchor: A, family: 'Noto Sans' }));
      out.push(text(rtl ? tx - 34 : tx + 34, gy, name, { size: 22, weight: 600, fill: '#e5e7eb', anchor: A }));
      out.push(text(rtl ? govX + 30 : govX + colW - 30, gy, nf(g.n), { size: 24, weight: 700, fill: '#ffffff', anchor: rtl ? 'start' : 'end', family: 'Noto Sans' }));
      const bw = colW - 60; const fw = Math.max(10, (bw * g.n) / maxG); const by = gy + 14;
      out.push(`<rect x="${govX + 30}" y="${by}" width="${bw}" height="9" rx="4.5" fill="#1f2937"/>`);
      out.push(`<rect x="${rtl ? govX + 30 + bw - fw : govX + 30}" y="${by}" width="${fw}" height="9" rx="4.5" fill="url(#gov)"/>`);
      gy += gH;
    });
  }

  // ---- activity chart
  y = 1230 + off;
  const chH = 250;
  out.push(card(P, y, W - 2 * P, chH));
  out.push(text(rtl ? R - 30 : P + 30, y + 50, t.chart[st.kind] || t.chart['24h'], { size: 26, weight: 700, fill: '#ffffff', anchor: A }));
  out.push(text(rtl ? P + 30 : R - 30, y + 50, t.tz, { size: 20, weight: 500, fill: '#6b7280', anchor: rtl ? 'start' : 'end' }));
  const n = st.buckets.length; const cx0 = P + 30; const cwid = W - 2 * P - 60; const base = y + chH - 46; const top = y + 80;
  const maxB = Math.max(1, ...st.buckets); const slot = cwid / n; const bwid = Math.max(6, slot * 0.62);
  for (let i = 0; i < n; i++) {
    const v = st.buckets[i]; const idx = rtl ? n - 1 - i : i; // RTL: time runs right -> left
    const x = cx0 + idx * slot + (slot - bwid) / 2;
    const h = v ? Math.max(6, ((base - top) * v) / maxB) : 3;
    out.push(`<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${bwid.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, bwid / 2)}" fill="${v ? 'url(#col)' : '#1f2937'}"/>`);
    if (v && v === maxB) out.push(text(x + bwid / 2, base - h - 8, nf(v), { size: 16, weight: 700, fill: '#ffd1d6', anchor: 'middle', family: 'Noto Sans' }));
    const every = n > 24 ? 5 : n === 24 ? 3 : 1;
    const lb = st.labels[i]; const lbs = typeof lb === 'string' ? lb : (lang === 'en' ? lb.en : lb.ar);
    if (i % every === 0 || i === n - 1) out.push(text(x + bwid / 2, base + 28, lbs, { size: n === 7 ? 19 : 16, weight: 500, fill: '#6b7280', anchor: 'middle', family: /[\u0600-\u06FF]/.test(lbs) ? 'Noto Kufi Arabic' : 'Noto Sans' }));
  }

  // ---- footer
  const fy = H - 34;
  out.push(`<rect x="${P}" y="${fy - 40}" width="${W - 2 * P}" height="1" fill="#1f2937"/>`);
  out.push(text(rtl ? R : P, fy, 'red-alert-syria.onrender.com', { size: 22, weight: 700, fill: '#cbd5e1', anchor: A, family: 'Noto Sans' }));
  const bh = 42; const bw = badgeWidth(bh);
  out.push(channelBadge(rtl ? P : R - bw, fy - bh + 12, { h: bh, dark: true }));
  out.push('</svg>');
  return out.join('\n');
}

export function renderStatsPng(st, lang = 'ar') {
  const r = new Resvg(statsSvg(st, lang), {
    fitTo: { mode: 'width', value: W },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Noto Kufi Arabic' },
  });
  return Buffer.from(r.render().asPng());
}
