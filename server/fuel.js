// ⛽ Official fuel prices (new Syrian lira).
// Primary source: SANA's official news feed for decisions issued by the Permanent Committee / Ministry of Energy.
// sp-today and SyPNow remain secondary cross-checks only. `since` is the decision's effective/announcement date;
// `checked` is the last successful confirmation of the official feed. If the decision date itself is older than
// STALE_H, the morning bulletin omits fuel and the site marks it stale rather than calling old values today's.
// Diesel grades were announced by the Minister of Energy in a SANA interview on 17 Sep 2026; the link below is
// the official announcement, not a secondary repost.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const H_MS = 3600_000;
export const STALE_H = 72;
export const SYP_URL = 'https://sypnow.com/ar/fuel';
export const SANA_FUEL_FEED = 'https://sana.sy/tag/%d8%a3%d8%b3%d8%b9%d8%a7%d8%b1-%d8%a7%d9%84%d9%85%d8%b4%d8%aa%d9%82%d8%a7%d8%aa-%d8%a7%d9%84%d9%86%d9%81%d8%b7%d9%8a%d8%a9/feed/';
export const SANA_FUEL_DECISION = 'https://sana.sy/economy/syrian-economy/2579297/';
export const SANA_DIESEL_GRADES = 'https://sana.sy/economy/syrian-economy/2583165/';
const AR_M = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const AR_M2 = { يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, مايو: 5, يونيو: 6, يوليو: 7, أغسطس: 8, سبتمبر: 9, أكتوبر: 10, نوفمبر: 11, ديسمبر: 12 };
const MONTHS_NORM = { 'كانون الثاني': 1, 'شباط': 2, 'آذار': 3, 'نيسان': 4, 'أيار': 5, 'حزيران': 6, 'تموز': 7, 'آب': 8, 'أيلول': 9, 'تشرين الأول': 10, 'تشرين الثاني': 11, 'كانون الأول': 12 };

export const TIERS = {
  base: 175,
  src: SANA_DIESEL_GRADES,
  items: {
    'diesel-150': { price: 150, name: 'مازوت صنف ثاني', unit: 'لتر', since: '2026-09-17', tier: true },
    'diesel-115': { price: 115, name: 'مازوت مدعوم (تدفئة وزراعة)', unit: 'لتر', since: '2026-09-17', tier: true, note: 'حسب التوزيع' },
  },
};
const MAIN = ['benzin', 'gasoline-95', 'diesel', 'gas'];
const RANGE = { benzin: [20, 3000], 'gasoline-95': [20, 3000], diesel: [20, 3000], gas: [200, 30000] };
const NAMES = { benzin: 'بنزين أوكتان 90', 'gasoline-95': 'بنزين أوكتان 95', diesel: 'مازوت', gas: 'غاز منزلي' };
const UNITS = { benzin: 'لتر', 'gasoline-95': 'لتر', diesel: 'لتر', gas: 'أسطوانة' };

const normalizeDigits = (s) => String(s || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const num = (s) => {
  const t = normalizeDigits(s).replace(/[,،٬\s]/g, '').replace('٫', '.');
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};
function arDate(s) {
  const m = String(s || '').match(/(\d{1,2})\s+([^\s\d|]+(?:\s+(?:الأول|الثاني))?)\s+(\d{4})/);
  if (!m) return null;
  let mo = AR_M.indexOf(m[2].trim()) + 1;
  if (!mo) mo = AR_M2[m[2].trim()] || 0;
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}
const textOf = (html) => String(html)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' | ')
  .replace(/&#x([\da-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
  .replace(/&#(\d+);/g, (_, x) => String.fromCodePoint(Number(x)))
  .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/[\u200e\u200f]/g, '').replace(/(\s*\|\s*)+/g, ' | ').replace(/\s+/g, ' ').trim();
const tagIn = (block, name) => {
  const m = String(block || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? textOf(m[1]).replace(/^\|\s*|\s*\|$/g, '').trim() : '';
};
function damascusDate(ms) {
  if (!Number.isFinite(ms)) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Damascus', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function decisionDate(body, publishedAt) {
  const t = normalizeDigits(body).replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  const months = Object.fromEntries(Object.entries(MONTHS_NORM).map(([k, v]) => [k.replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه'), v]));
  const monthRx = Object.keys(months).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const m = t.match(new RegExp(`(?:اعتبارا|ابتداء|سريان|تطبيق).{0,100}?(\\d{1,2})\\s+(?:من\\s+)?(${monthRx})(?:\\s+(?:الجاري|عام)?\\s*(\\d{4}))?`, 'i'));
  if (m) {
    const mo = months[m[2]]; const y = Number(m[3]) || Number(damascusDate(publishedAt)?.slice(0, 4));
    if (mo && y && Number(m[1]) >= 1 && Number(m[1]) <= 31) return `${y}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  }
  return damascusDate(publishedAt);
}
function cleanSanaBody(html) { return textOf(html).replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim(); }
function sanaPrice(body, re) { const m = body.match(re); return m ? num(m[1]) : null; }
/** Parse SANA's tagged RSS feed and return its newest complete official fuel price decision, or null. */
export function parseSanaFuelFeed(xml, now = Date.now()) {
  const candidates = [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => {
    const b = m[1];
    const title = tagIn(b, 'title');
    const link = tagIn(b, 'link');
    const pub = Date.parse(tagIn(b, 'pubDate'));
    const body = b.match(/<content:encoded(?:\s[^>]*)?>([\s\S]*?)<\/content:encoded>/i)?.[1] || tagIn(b, 'description');
    return { title, link, pub, body: cleanSanaBody(body) };
  }).filter((x) => /^https:\/\/sana\.sy\//i.test(x.link) && Number.isFinite(x.pub)
    && /(سعر|اسعار|تسعيره|مشتقات|محروقات|بنزين|مازوت)/i.test(x.title));
  candidates.sort((a, b) => b.pub - a.pub);
  for (const x of candidates) {
    const t = x.body;
    const items = {
      'gasoline-95': sanaPrice(t, /بنزين\s*(?:اوكتان\s*)?95\s*[:：-]\s*([\d٠-٩,،٬.]+)/i),
      benzin: sanaPrice(t, /بنزين\s*(?:اوكتان\s*)?90\s*[:：-]\s*([\d٠-٩,،٬.]+)/i),
      diesel: sanaPrice(t, /مازوت\s*[:：-]\s*([\d٠-٩,،٬.]+)/i),
      gas: sanaPrice(t, /غاز\s*(?:منزلي|اسطوانه\s*منزليه)\s*[:：-]\s*([\d٠-٩,،٬.]+)/i),
    };
    const out = {};
    for (const k of MAIN) if (items[k] != null) out[k] = { price: items[k], name: NAMES[k], unit: UNITS[k] };
    if (checkFuel(out)) continue;
    const since = decisionDate(t, x.pub);
    if (!since || Date.parse(`${since}T00:00:00+03:00`) > now + 3 * 86_400_000) continue;
    return { src: 'SANA — اللجنة الدائمة / وزارة الطاقة', source: 'sana.sy', official: true, url: x.link, since, items: out, publishedAt: new Date(x.pub).toISOString(), title: x.title };
  }
  return null;
}
async function get(url, headers, ms = 20_000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { headers, signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}
export async function fetchSanaFuel() {
  const xml = await get(SANA_FUEL_FEED, { 'User-Agent': UA, 'Accept-Language': 'ar,en;q=0.8', Accept: 'application/rss+xml, application/xml, text/xml' }, 30_000);
  const result = parseSanaFuelFeed(xml);
  if (!result) throw new Error('SANA feed: no complete official fuel-price decision found');
  return result;
}

/** parse sypnow.com/ar/fuel -> { since, items } or throws; this is only a secondary cross-check. */
export function parseSypNow(html) {
  const t = textOf(html);
  const i = t.indexOf('آخر تعديل رسمي');
  if (i < 0) throw new Error('SyPNow: no "last official change" block');
  const block = t.slice(i, i + 900);
  const since = arDate(block.slice(0, 80));
  const grab = (re) => { const m = block.match(re); return m ? num(m[1]) : null; };
  const items = {
    'gasoline-95': grab(/بنزين\s*95\s*\|\s*لكل\s*ليتر\s*\|\s*([\d,٬.]+)/),
    benzin: grab(/بنزين\s*90\s*\|\s*لكل\s*ليتر\s*\|\s*([\d,٬.]+)/),
    diesel: grab(/\|\s*مازوت\s*\|\s*لكل\s*ليتر\s*\|\s*([\d,٬.]+)/),
    gas: grab(/غاز\s*منزلي\s*\|\s*لكل\s*[^|]*\|\s*([\d,٬.]+)/),
  };
  const out = {};
  for (const k of MAIN) if (items[k] != null) out[k] = { price: items[k], name: NAMES[k], unit: UNITS[k] };
  const bad = checkFuel(out);
  if (bad) throw new Error(`SyPNow: ${bad}`);
  if (!since) throw new Error('SyPNow: no effective date');
  return { src: 'sypnow.com (secondary)', source: 'sypnow', official: false, since, items: out };
}
/** sanity checks on a fuel item map -> reason string or null */
export function checkFuel(items) {
  const have = MAIN.filter((k) => items?.[k]?.price != null);
  if (have.length < 3) return 'fewer than 3 fuel prices';
  for (const k of have) { const [a, b] = RANGE[k]; const v = items[k].price; if (!(v >= a && v <= b)) return `${k} out of range (${v})`; }
  const b90 = items.benzin?.price; const b95 = items['gasoline-95']?.price;
  if (b90 && b95 && b95 < b90) return 'benzin 95 cheaper than 90';
  return null;
}
export async function fetchSypNow() {
  const errs = [];
  for (const [how, url, h] of [
    ['direct', SYP_URL, { 'User-Agent': UA, 'Accept-Language': 'ar,en;q=0.8' }],
    ['proxy', `https://r.jina.ai/${SYP_URL}`, { 'X-Return-Format': 'html', 'X-Engine': 'direct', 'X-No-Cache': 'true' }],
  ]) {
    try { return { ...parseSypNow(await get(url, h)), via: how }; } catch (e) { errs.push(`${how}: ${e.message}`); }
  }
  throw new Error(errs.join(' · '));
}
/** sp-today parsed object -> { since, items } or null; secondary cross-check only. */
export function fromSpToday(sp) {
  if (!sp?.fuel) return null;
  const out = {};
  for (const k of MAIN) if (sp.fuel[k]?.price != null) out[k] = { price: sp.fuel[k].price, name: NAMES[k], unit: UNITS[k], usd: sp.fuel[k].usd };
  if (checkFuel(out)) return null;
  const since = String(sp.fuelAt || '').slice(0, 10);
  return { src: 'sp-today.com (secondary)', source: 'sp-today', official: false, since: /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : null, items: out };
}
const same = (a, b) => MAIN.every((k) => a[k]?.price == null || b[k]?.price == null || a[k].price === b[k].price);
const diff = (a, b) => MAIN.filter((k) => a[k]?.price != null && b[k]?.price != null && a[k].price !== b[k].price)
  .map((k) => `${NAMES[k]}: ${a[k].price} ≠ ${b[k].price}`).join('، ');

/**
 * Merge fresh readings into stored state. Official SANA data always outranks secondary sources;
 * if SANA is unreachable after an official reading has been saved, secondary results cannot replace it.
 */
export function mergeFuel(f, readings, now = Date.now()) {
  const ok = readings.filter(Boolean);
  if (!ok.length) return { changed: false, conflict: null };
  const official = ok.find((r) => r.official);
  if (!official && f.official && f.items) {
    const mismatches = ok.filter((r) => !same(f.items, r.items));
    const conflict = mismatches.length ? `Saved SANA official prices (${f.since || '?'}) / secondary source (${mismatches[0].since || '?'}): ${diff(f.items, mismatches[0].items)}` : null;
    return { changed: false, conflict };
  }
  let pick = official || ok[0]; let conflict = null;
  if (official) {
    const mismatch = ok.find((r) => r !== official && !same(official.items, r.items));
    if (mismatch) conflict = `${official.src} (${official.since || '?'}) / ${mismatch.src} (${mismatch.since || '?'}): ${diff(official.items, mismatch.items)}`;
  } else if (ok.length > 1) {
    for (const r of ok.slice(1)) {
      if (!same(pick.items, r.items)) {
        if ((r.since || '') > (pick.since || '')) pick = r;
        conflict = `${ok[0].src} (${ok[0].since || '?'}) / ${r.src} (${r.since || '?'}): ${diff(ok[0].items, r.items)}`;
      }
    }
  }
  const prev = f.items || {}; const prevSince = f.since;
  const changed = !!f.items && !same(prev, pick.items);
  const agreed = ok.filter((r) => same(r.items, pick.items)).map((r) => r.src);
  Object.assign(f, { items: pick.items, since: pick.since || f.since || null, checked: now, srcs: agreed, conflict,
    official: !!pick.official, source: pick.source || null, url: pick.url || null, title: pick.title || null });
  if (changed) f.prev = { items: prev, since: prevSince };
  return { changed, conflict };
}
/** view for the site / bulletin: items (+ official diesel grades while valid), dates, source and staleness */
export function fuelView(f, now = Date.now()) {
  if (!f?.items) return null;
  const sinceMs = f.since ? Date.parse(`${f.since}T23:59:59+03:00`) : NaN;
  const stale = !Number.isFinite(sinceMs) || now - sinceMs > STALE_H * H_MS;
  const items = { ...f.items };
  if (f.items.diesel?.price === TIERS.base) Object.assign(items, TIERS.items);
  return { since: f.since || null, checked: f.checked || null, stale, srcs: f.srcs || [], items,
    official: !!f.official, url: f.url || null, source: f.source || null, tiersSrc: TIERS.src };
}
/** official pricing decision in a news post? (used to force an early re-check) */
export const FUEL_NEWS_RE = /((?:ال)?لجنة\s+(?:الدائمة\s+)?(?:ل)?(?:تسعير|تحديد\s+أسعار)\s+(?:المشتقات|المواد\s+البترولية|المحروقات))|((?:تعديل|رفع|تخفيض|خفض)\s+(?:سعر|أسعار)\s+(?:المحروقات|المشتقات\s+النفطية|البنزين|المازوت|الغاز\s+المنزلي))|(نشرة\s+أسعار\s+(?:جديدة\s+)?(?:مؤقتة\s+)?للمشتقات)|((?:أسعار|سعر)\s+جديد[ةه]?\s+(?:للمحروقات|للبنزين|للمازوت|للمشتقات))/;
