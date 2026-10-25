// ⛽ Official fuel prices (new Syrian lira).
// Sources, cross-checked:
//  - sp-today.com: read with the rest of the prices (energy.fuel_types; fuel_updated_at = date the price took effect)
//  - SyPNow (https://sypnow.com/ar/fuel): "آخر تعديل رسمي: <date> · وزارة الطاقة السورية", updated on every decision
// Two different dates are kept: `since` = when the official price took effect (it can stay valid for weeks),
// `checked` = last time a live source confirmed it. If nothing confirmed the prices for STALE_H hours, the
// morning bulletin drops the fuel section and the site marks it as unconfirmed, instead of presenting old
// numbers as today's.
// Diesel grades announced by the Ministry of Energy (29 Sep 2026): the second grade at 150 and the
// subsidised one at 115 (heating / agriculture), while the top grade stays at 175. They are shown only while
// the standard diesel price is still the one they were announced against (any official change hides them).

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const H_MS = 3600_000;
export const STALE_H = 72;
export const SYP_URL = 'https://sypnow.com/ar/fuel';
const AR_M = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
const AR_M2 = { يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, مايو: 5, يونيو: 6, يوليو: 7, أغسطس: 8, سبتمبر: 9, أكتوبر: 10, نوفمبر: 11, ديسمبر: 12 };

export const TIERS = {
  base: 175, // standard diesel price the grades were announced against
  src: 'https://963media.com/archives/75816',
  items: {
    'diesel-150': { price: 150, name: 'مازوت صنف ثاني', unit: 'لتر', since: '2026-09-29', tier: true },
    'diesel-115': { price: 115, name: 'مازوت مدعوم (تدفئة وزراعة)', unit: 'لتر', since: '2026-09-30', tier: true, note: 'حسب التوزيع' },
  },
};
const MAIN = ['benzin', 'gasoline-95', 'diesel', 'gas'];
const RANGE = { benzin: [20, 3000], 'gasoline-95': [20, 3000], diesel: [20, 3000], gas: [200, 30000] };
const NAMES = { benzin: 'بنزين أوكتان 90', 'gasoline-95': 'بنزين أوكتان 95', diesel: 'مازوت', gas: 'غاز منزلي' };
const UNITS = { benzin: 'لتر', 'gasoline-95': 'لتر', diesel: 'لتر', gas: 'أسطوانة' };

const num = (s) => {
  const t = String(s || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[,،٬\s]/g, '').replace('٫', '.');
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
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' | ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/[\u200e\u200f]/g, '')
  .replace(/(\s*\|\s*)+/g, ' | ');

/** parse sypnow.com/ar/fuel -> { since, items } or throws */
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
  return { src: 'sypnow.com', since, items: out };
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
async function get(url, headers, ms = 20_000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { headers, signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
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
/** sp-today parsed object -> { since, items } or null */
export function fromSpToday(sp) {
  if (!sp?.fuel) return null;
  const out = {};
  for (const k of MAIN) if (sp.fuel[k]?.price != null) out[k] = { price: sp.fuel[k].price, name: NAMES[k], unit: UNITS[k], usd: sp.fuel[k].usd };
  if (checkFuel(out)) return null;
  const since = String(sp.fuelAt || '').slice(0, 10);
  return { src: 'sp-today.com', since: /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : null, items: out };
}
const same = (a, b) => MAIN.every((k) => a[k]?.price == null || b[k]?.price == null || a[k].price === b[k].price);
const diff = (a, b) => MAIN.filter((k) => a[k]?.price != null && b[k]?.price != null && a[k].price !== b[k].price)
  .map((k) => `${NAMES[k]}: ${a[k].price} ≠ ${b[k].price}`).join('، ');

/**
 * merge fresh readings into the stored fuel state.
 * readings: array of { src, since, items } from sources that answered now (may be empty).
 * returns { changed: bool, conflict: string|null } so the caller can tell the owner.
 */
export function mergeFuel(f, readings, now = Date.now()) {
  const ok = readings.filter(Boolean);
  if (!ok.length) return { changed: false, conflict: null };
  let pick = ok[0]; let conflict = null;
  if (ok.length > 1) {
    const [a, b] = ok;
    if (!same(a.items, b.items)) {
      // a newer official decision wins; same date but different numbers -> keep sp-today, tell the owner
      pick = (b.since || '') > (a.since || '') ? b : a;
      conflict = `${a.src} (${a.since || '?'}) / ${b.src} (${b.since || '?'}): ${diff(a.items, b.items)}`;
    }
  }
  const prev = f.items || {};
  const changed = !!f.items && !same(prev, pick.items);
  const agreed = ok.filter((r) => same(r.items, pick.items)).map((r) => r.src);
  Object.assign(f, { items: pick.items, since: pick.since || f.since || null, checked: now, srcs: agreed, conflict });
  if (changed) f.prev = { items: prev, since: f.since };
  return { changed, conflict };
}
/** view for the site / bulletin: items (+ diesel grades while valid), dates, staleness */
export function fuelView(f, now = Date.now()) {
  if (!f?.items) return null;
  const stale = !f.checked || now - f.checked > STALE_H * H_MS;
  const items = { ...f.items };
  if (f.items.diesel?.price === TIERS.base) Object.assign(items, TIERS.items);
  return { since: f.since || null, checked: f.checked || null, stale, srcs: f.srcs || [], items, tiersSrc: TIERS.src };
}
/** official pricing decision in a news post? (used to force an early re-check) */
export const FUEL_NEWS_RE = /((?:ال)?لجنة\s+(?:الدائمة\s+)?(?:ل)?(?:تسعير|تحديد\s+أسعار)\s+(?:المشتقات|المواد\s+البترولية|المحروقات))|((?:تعديل|رفع|تخفيض|خفض)\s+(?:سعر|أسعار)\s+(?:المحروقات|المشتقات\s+النفطية|البنزين|المازوت|الغاز\s+المنزلي))|(نشرة\s+أسعار\s+(?:جديدة\s+)?(?:مؤقتة\s+)?للمشتقات)|((?:أسعار|سعر)\s+جديد[ةه]?\s+(?:للمحروقات|للبنزين|للمازوت|للمشتقات))/;
