// Official Syrian weather products: CAP warnings and the National Meteorological Center's daily bulletin.
// Numeric temperatures still come from Open-Meteo; this module only adds official warnings and source links.
import { governorates } from './places.js';

export const CAP_FEED_URL = 'https://climweb.med.gov.sy/api/cap/rss.xml';
export const DAILY_BULLETIN_INDEX = 'https://climweb.med.gov.sy/منتجاتنا/النشرة-اليومية/';
const UA = 'RedAlertSyria/1.0 (+https://red-alert-syria.onrender.com)';
const TTL = 20 * 60_000;
const META_TTL = 60 * 60_000;
const ERROR_RETRY_TTL = 5 * 60_000;
const cache = { at: 0, warnings: [], busy: null, errAt: 0, metaAt: 0, meta: null, metaBusy: null, err: '' };
const CAP_CACHE = new Map();

function decodeXml(s) {
  return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([\da-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&#(\d+);/g, (_, x) => String.fromCodePoint(Number(x)))
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
}
function tag(block, name) {
  const q = `(?:[A-Za-z0-9_.-]+:)?${name}`;
  const m = String(block || '').match(new RegExp(`<${q}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${q}>`, 'i'));
  return m ? decodeXml(m[1]).trim() : '';
}
function text(s) { return decodeXml(s).replace(/<[^>]+>/g, ' ').replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim(); }
function norm(s) { return String(s || '').toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[ـًٌٍَُِّْ]/g, '').replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ').trim(); }
function findGovs(s) {
  let t = norm(s); const out = new Set();
  const rural = governorates.find((g) => norm(g.ar).includes('ريف دمشق'));
  if (rural && t.includes('ريف دمشق')) { out.add(rural.code); t = t.replace(/ريف دمشق/g, ' '); }
  for (const g of governorates) {
    if (g === rural) continue;
    const names = [g.ar, g.en, ...(Array.isArray(g.aliases) ? g.aliases : [])].filter(Boolean).map(norm).filter((x) => x.length > 2);
    if (names.some((name) => t.includes(name))) out.add(g.code);
  }
  if (/(جبال الساحل|الساحل|سواحل)/.test(t)) {
    for (const g of governorates.filter((x) => /(اللاذقيه|طرطوس)/.test(norm(x.ar)))) out.add(g.code);
  }
  if (/(الجزيره)/.test(t)) {
    for (const g of governorates.filter((x) => /(الحسكه|الرقه|ديرالزور)/.test(norm(x.ar).replace(/ /g, '')))) out.add(g.code);
  }
  if (/(سوريا|كافه المحافظات|جميع المحافظات|عموم البلاد|كافه انحاء البلاد|الجمهوريه العربيه السوريه)/.test(t)) {
    for (const g of governorates) out.add(g.code);
  }
  return [...out];
}
function hazardOf(s) {
  const t = norm(s);
  if (/(ثلج|ثلوج|تساقط ثلجي|جليد)/.test(t)) return { hazard: 'snow', emoji: '❄️' };
  if (/(ضباب|شبوره)/.test(t)) return { hazard: 'fog', emoji: '🌫' };
  if (/(غبار|اتربه|عاصفه ترابيه|عاصفه غباريه)/.test(t)) return { hazard: 'dust', emoji: '🌫' };
  if (/(عاصفه|عواصف|رعد|برق|برد|حبات البرد)/.test(t)) return { hazard: 'storm', emoji: '⛈' };
  if (/(مطر|امطار|هطول|سيول|فيضانات)/.test(t)) return { hazard: 'rain', emoji: '🌧' };
  if (/(حراره مرتفعه|موجه حر|ارتفاع درجات الحراره)/.test(t)) return { hazard: 'heat', emoji: '🌡' };
  if (/(صقيع|انجماد)/.test(t)) return { hazard: 'frost', emoji: '🥶' };
  if (/(البحر|امواج|بحري)/.test(t)) return { hazard: 'wind', emoji: '💨' };
  if (/(رياح|هبات|سرعه الرياح)/.test(t)) return { hazard: 'wind', emoji: '💨' };
  return null;
}
export function classifyWeatherHazard(s) { return hazardOf(s) || { hazard: 'storm', emoji: '⛈' }; }
function feedItems(xml) {
  return [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => {
    const b = m[1];
    return { title: text(tag(b, 'title')), link: text(tag(b, 'link')), description: text(tag(b, 'description')), pubDate: tag(b, 'pubDate') };
  });
}
function capInfo(xml, source) {
  const header = /<(?:[A-Za-z0-9_.-]+:)?alert\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?alert>/i.exec(xml)?.[1] || xml;
  const blocks = [...header.matchAll(/<(?:[A-Za-z0-9_.-]+:)?info\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?info>/gi)].map((m) => m[1]);
  const info = blocks.find((b) => /[\u0600-\u06ff]/.test(b)) || blocks[0] || header;
  const enInfo = blocks.find((b) => /^en(?:-|$)/i.test(tag(b, 'language'))) || blocks.find((b) => /[A-Za-z]/.test(b) && !/[\u0600-\u06ff]/.test(b)) || null;
  const status = tag(header, 'status'); const msgType = tag(header, 'msgType');
  const category = tag(info, 'category');
  const severity = tag(info, 'severity'); const certainty = tag(info, 'certainty');
  const event = text(tag(info, 'event')); const headline = text(tag(info, 'headline'));
  const description = text(tag(info, 'description'));
  const enEvent = enInfo ? text(tag(enInfo, 'event')) : '';
  const enHeadline = enInfo ? text(tag(enInfo, 'headline')) : '';
  const enDescription = enInfo ? text(tag(enInfo, 'description')) : '';
  const areaBlocks = [...info.matchAll(/<(?:[A-Za-z0-9_.-]+:)?area\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?area>/gi)].map((m) => m[1]);
  const areas = areaBlocks.map((b) => text(tag(b, 'areaDesc'))).filter(Boolean);
  const onset = tag(info, 'onset') || tag(info, 'effective'); const expires = tag(info, 'expires');
  const sent = tag(header, 'sent') || source.pubDate;
  const now = Date.now(); const expireAt = Date.parse(expires);
  if (status && !/actual|system/i.test(status)) return null;
  if (/cancel|ack/i.test(msgType)) return null;
  if (Number.isFinite(expireAt) && expireAt <= now) return null;
  if (!Number.isFinite(expireAt) && Number.isFinite(Date.parse(sent)) && now - Date.parse(sent) > 48 * 60 * 60_000) return null;
  if (category && !/\bmet\b|meteorolog|weather/i.test(category)) return null;
  const severityLevel = /extreme|severe/i.test(severity) ? 2 : 1;
  const primaryHazard = hazardOf([headline, event].filter(Boolean).join(' · '));
  const detailHazard = hazardOf([description, ...areas].filter(Boolean).join(' · '));
  const h = primaryHazard || detailHazard || { hazard: 'storm', emoji: '⛈' };
  const enHazard = { storm: 'thunderstorm', rain: 'heavy rain', snow: 'snow', wind: 'strong wind', dust: 'dust', fog: 'fog', heat: 'heat', frost: 'frost' }[h.hazard] || 'weather';
  const govs = findGovs(areas.length ? areas.join(' · ') : [headline, event, description].filter(Boolean).join(' · '));
  const officialUrl = tag(info, 'web');
  const url = /^https:\/\//i.test(officialUrl) && /climweb\.med\.gov\.sy$/i.test(new URL(officialUrl).hostname) ? officialUrl : source.link;
  const pub = Date.parse(source.pubDate || '');
  return {
    id: `cap:${tag(header, 'identifier') || source.link}`, official: true, source: 'المركز الوطني للأرصاد الجوية', source_en: 'National Meteorological Center',
    url, hazard: h.hazard, emoji: h.emoji, level: severityLevel, severity: severity || 'Unknown', certainty: certainty || '',
    govs, ar: headline || event || source.title || 'تحذير جوي رسمي',
    en: enHeadline || enEvent || `${severityLevel === 2 ? 'Severe' : 'Official'} ${enHazard} warning`,
    details: description.slice(0, 600), details_en: enDescription.slice(0, 600), areas, day: onset ? onset.slice(0, 10) : '',
    onset: onset || null, expires_at: expires || null, at: Number.isFinite(pub) ? new Date(pub).toISOString() : null,
  };
}
async function get(url, timeout = 12_000) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8' }, signal: ac.signal });
      if (!r.ok) {
        last = new Error(`HTTP ${r.status}`);
        if (r.status < 500 && r.status !== 429) { last.noRetry = true; throw last; }
      } else return await r.text();
    } catch (e) { last = e; if (e.noRetry) throw e; }
    finally { clearTimeout(timer); }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw last || new Error('official weather source unavailable');
}
async function loadCapItem(item) {
  if (CAP_CACHE.has(item.link)) return CAP_CACHE.get(item.link);
  const xml = await get(item.link, 18_000);
  const out = capInfo(xml, item);
  CAP_CACHE.set(item.link, out);
  if (CAP_CACHE.size > 48) CAP_CACHE.delete(CAP_CACHE.keys().next().value);
  return out;
}
export async function officialWeatherWarnings({ force = false } = {}) {
  if (!force && cache.warnings && Date.now() - cache.at < TTL) return cache.warnings;
  if (!force && cache.errAt && Date.now() - cache.errAt < ERROR_RETRY_TTL) return cache.warnings;
  if (!cache.busy) {
    cache.busy = (async () => {
      const xml = await get(CAP_FEED_URL);
      const cutoff = Date.now() - 14 * 86_400_000;
      const candidates = feedItems(xml).filter((x) => /\/api\/cap\/.*\.xml(?:\?|$)/i.test(x.link)
        && /(تحذير|تنبيه|طقس|جوي|امطار|ثلوج|رياح|عاصفه|غبار|البحر)/i.test(`${x.title} ${x.description}`)
        && (!Date.parse(x.pubDate) || Date.parse(x.pubDate) >= cutoff))
        .sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0)).slice(0, 8);
      const settled = [];
      for (let i = 0; i < candidates.length; i += 4) settled.push(...await Promise.allSettled(candidates.slice(i, i + 4).map(loadCapItem)));
      const warnings = settled.filter((x) => x.status === 'fulfilled' && x.value).map((x) => x.value)
        .filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i)
        .sort((a, b) => (b.level || 1) - (a.level || 1) || (Date.parse(a.onset || '') || Infinity) - (Date.parse(b.onset || '') || Infinity) || (b.at || '').localeCompare(a.at || ''));
      cache.warnings = warnings; cache.at = Date.now(); cache.errAt = 0; cache.err = '';
      return warnings;
    })().catch((e) => { cache.err = e.message; cache.errAt = Date.now(); if (cache.at || cache.warnings.length) return cache.warnings; throw e; }).finally(() => { cache.busy = null; });
  }
  return cache.busy;
}
async function loadDailyMeta() {
  const html = await get(DAILY_BULLETIN_INDEX, 15_000);
  const links = [...html.matchAll(/<a\b[^>]*href=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => {
    const href = decodeXml(m[2]); const title = text(m[3]);
    if (!title || !/(الحاله الجويه|النشره اليوميه|حاله الطقس المتوقعه|daily bulletin)/i.test(norm(title))) return null;
    try { const u = new URL(href, DAILY_BULLETIN_INDEX); if (u.hostname !== 'climweb.med.gov.sy' || u.pathname === new URL(DAILY_BULLETIN_INDEX).pathname) return null; return { url: u.href, title }; } catch { return null; }
  }).filter(Boolean);
  return links[0] || { url: DAILY_BULLETIN_INDEX, title: 'النشرة الجوية الرسمية' };
}
export async function officialWeatherMeta({ force = false } = {}) {
  if (!force && cache.meta && Date.now() - cache.metaAt < META_TTL) return { ...cache.meta, alertsUrl: CAP_FEED_URL, fetchedAt: cache.metaAt };
  if (!cache.metaBusy) {
    cache.metaBusy = loadDailyMeta().then((m) => { cache.meta = m; cache.metaAt = Date.now(); return m; })
      .catch(() => { cache.meta = cache.meta || { url: DAILY_BULLETIN_INDEX, title: 'النشرة الجوية الرسمية' }; cache.metaAt = Date.now(); return cache.meta; })
      .finally(() => { cache.metaBusy = null; });
  }
  const meta = await cache.metaBusy;
  return { ...meta, alertsUrl: CAP_FEED_URL, fetchedAt: cache.metaAt };
}
export const officialWeatherDebug = () => ({ warningsAt: cache.at || null, warnings: cache.warnings.length, metaAt: cache.metaAt || null, retryAfter: cache.errAt ? new Date(cache.errAt + ERROR_RETRY_TTL).toISOString() : null, err: cache.err || '' });
