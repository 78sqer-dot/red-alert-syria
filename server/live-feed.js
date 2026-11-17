// «المباشر» (Live) — website-only aggregation for the map page: a moving news
// ticker + a popup window with three tabs (Arabic-channel news, OSINT, global
// markets). Everything is fetched by the server itself, cached, and served from
// GET /api/live. Nothing here publishes to Telegram/WhatsApp, and a failing
// source degrades to an empty section — it never breaks the request path.
//
// Sources were verified live from the server on 2026-11-17:
//  - RSS: Al Jazeera, BBC Arabic, Sky News Arabia, France 24 Arabic, Euronews
//    Arabic, RT Arabic. (Al Arabiya's feed answers 403 to this server and
//    Stooq is behind a JavaScript bot wall, so neither is used.)
//  - OSINT: Telegram public previews (t.me/s/) via news-sources.js machinery.
//  - Markets: Yahoo Finance chart API (keyless, per-symbol), with strict
//    numeric sanity checks — a quote that fails them is omitted, never shown.
import { fetchChannel } from './news-sources.js';
import { mentionsSyria } from './news-ai.js';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const NEWS_TTL_MS = 5 * 60_000;
const MARKET_TTL_MS = 5 * 60_000;
const MAX_NEWS = { syria: 30, world: 40 };
const MAX_OSINT = 30;

export const NEWS_FEEDS = [
  { name: 'الجزيرة', url: 'https://www.aljazeera.net/rss' },
  { name: 'BBC عربي', url: 'https://feeds.bbci.co.uk/arabic/rss.xml' },
  { name: 'سكاي نيوز عربية', url: 'https://www.skynewsarabia.com/rss.xml' },
  { name: 'فرانس 24', url: 'https://www.france24.com/ar/rss' },
  { name: 'يورونيوز عربي', url: 'https://arabic.euronews.com/rss' },
  { name: 'RT عربي', url: 'https://arabic.rt.com/rss' },
];

// OSINT channels whose public preview was verified readable on 2026-11-17.
// Items are shown in their original language with an OSINT tag — no machine
// translation is invented for them.
export const OSINT_CHANNELS = [
  { u: 'osintdefender', name: 'OSINTdefender' },
  { u: 'intelslava', name: 'Intel Slava' },
  { u: 'rybar', name: 'Rybar' },
  { u: 'milinfolive', name: 'Military Summary' },
];

// symbol = Yahoo chart symbol; maxMove = largest plausible |day change %| —
// beyond it the quote is treated as bad data and omitted.
export const MARKET_SYMBOLS = [
  { symbol: '^GSPC', ar: 'إس آند بي 500', en: 'S&P 500', maxMove: 15 },
  { symbol: '^IXIC', ar: 'ناسداك', en: 'Nasdaq', maxMove: 15 },
  { symbol: '^DJI', ar: 'داو جونز', en: 'Dow Jones', maxMove: 15 },
  { symbol: '^RUT', ar: 'راسل 2000', en: 'Russell 2000', maxMove: 15 },
  { symbol: '^VIX', ar: 'مؤشر التقلب VIX', en: 'VIX', maxMove: 120 },
  { symbol: 'BTC-USD', ar: 'بيتكوين', en: 'Bitcoin', maxMove: 40 },
  { symbol: 'ETH-USD', ar: 'إيثريوم', en: 'Ethereum', maxMove: 40 },
  { symbol: 'GC=F', ar: 'الذهب', en: 'Gold', maxMove: 12 },
  { symbol: 'SI=F', ar: 'الفضة', en: 'Silver', maxMove: 15 },
  { symbol: 'CL=F', ar: 'النفط الخام', en: 'WTI crude', maxMove: 25 },
  { symbol: 'BZ=F', ar: 'خام برنت', en: 'Brent crude', maxMove: 25 },
  { symbol: 'NG=F', ar: 'الغاز الطبيعي', en: 'Natural gas', maxMove: 35 },
];

// ------------------------------------------------------------ RSS parsing (dependency-free)
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»' };
export const decodeEntities = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&([a-z0-9#]+);/gi, (m, k) => ENT[k] ?? m);
const cdata = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
export const cleanFeedText = (s) => decodeEntities(cdata(s)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tagText = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? cleanFeedText(m[1]) : '';
};

/** Parse an RSS/Atom document into [{ title, url, ts, desc }] (newest first as published). */
export function parseRssItems(xml, limit = 30) {
  const items = [];
  const blocks = String(xml || '').split(/<item[\s>]/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/item>/i)[0];
    const title = tagText(block, 'title');
    let url = tagText(block, 'link');
    if (!url) { const g = block.match(/<guid[^>]*>(https?[^<]+)<\/guid>/i); if (g) url = cleanFeedText(g[1]); }
    if (!title || !/^https?:\/\//.test(url)) continue;
    const ts = Date.parse(tagText(block, 'pubDate') || tagText(block, 'dc:date') || '');
    items.push({ title: title.slice(0, 300), url, ts: Number.isFinite(ts) ? ts : null, desc: tagText(block, 'description').slice(0, 300) });
    if (items.length >= limit) break;
  }
  return items;
}

/** Syria bucket: the HEADLINE mentions Syria or a Syrian place. Title-only on
 * purpose: feed descriptions routinely mention Syria in passing (related
 * coverage, place-name collisions), which flooded the Syria section with
 * world stories; a Syria story's headline names Syria or a Syrian place. */
export const isSyriaItem = (item) => mentionsSyria(item?.title || '');

// ------------------------------------------------------------ Yahoo chart parsing
/** One Yahoo chart response -> { price, prevClose, changePct } or null when unusable. */
export function parseYahooChart(json, def) {
  try {
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) return null;
    const price = Number(meta.regularMarketPrice);
    if (!Number.isFinite(price) || price <= 0) return null;
    const closes = (result.indicators?.quote?.[0]?.close || []).filter((v) => Number.isFinite(v) && v > 0);
    let prev = closes.length >= 2 ? closes[closes.length - 2] : Number(meta.chartPreviousClose);
    if (!Number.isFinite(prev) || prev <= 0) return null;
    const changePct = ((price - prev) / prev) * 100;
    if (!Number.isFinite(changePct) || Math.abs(changePct) > (def?.maxMove ?? 25)) return null;
    return { price, prevClose: prev, changePct: Math.round(changePct * 100) / 100 };
  } catch { return null; }
}

// ------------------------------------------------------------ fetching + cache
const fetchText = async (url, timeoutMs = 12_000) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

async function fetchNews() {
  const syria = [], world = [];
  const seen = new Set();
  const pages = await Promise.allSettled(NEWS_FEEDS.map(async (feed) => ({ feed, items: parseRssItems(await fetchText(feed.url)) })));
  for (const page of pages) {
    if (page.status !== 'fulfilled') continue;
    for (const item of page.value.items) {
      const key = item.url || item.title;
      if (seen.has(key)) continue;
      seen.add(key);
      (isSyriaItem(item) ? syria : world).push({ title: item.title, source: page.value.feed.name, ts: item.ts, url: item.url });
    }
  }
  const byTime = (a, b) => (b.ts || 0) - (a.ts || 0);
  return { syria: syria.sort(byTime).slice(0, MAX_NEWS.syria), world: world.sort(byTime).slice(0, MAX_NEWS.world) };
}

async function fetchOsint() {
  const out = [];
  const seen = new Set();
  const pages = await Promise.allSettled(OSINT_CHANNELS.map(async (ch) => ({ ch, page: await fetchChannel(ch.u, { timeoutMs: 12_000 }) })));
  for (const page of pages) {
    if (page.status !== 'fulfilled') continue;
    for (const post of page.value.page.posts || []) {
      const text = String(post.text || '').replace(/\s+/g, ' ').trim();
      if (!text || seen.has(post.url)) continue;
      seen.add(post.url);
      out.push({ text: text.slice(0, 600), source: page.value.ch.name, ts: post.ts || null, url: post.url });
    }
  }
  return out.sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, MAX_OSINT);
}

async function fetchMarkets() {
  const out = [];
  const quotes = await Promise.allSettled(MARKET_SYMBOLS.map(async (def) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(def.symbol)}?range=5d&interval=1d`;
    const text = await fetchText(url, 10_000);
    return { def, quote: parseYahooChart(JSON.parse(text), def) };
  }));
  for (const q of quotes) {
    if (q.status !== 'fulfilled' || !q.value.quote) continue;
    const { def, quote } = q.value;
    out.push({ symbol: def.symbol, ar: def.ar, en: def.en, price: quote.price, changePct: quote.changePct });
  }
  return out;
}

const cache = { news: null, newsAt: 0, osint: null, osintAt: 0, markets: null, marketsAt: 0, busy: null };
async function refresh() {
  if (cache.busy) return cache.busy;
  cache.busy = (async () => {
    const [news, osint, markets] = await Promise.allSettled([fetchNews(), fetchOsint(), fetchMarkets()]);
    if (news.status === 'fulfilled' && (news.value.syria.length || news.value.world.length)) { cache.news = news.value; cache.newsAt = Date.now(); }
    if (osint.status === 'fulfilled' && osint.value.length) { cache.osint = osint.value; cache.osintAt = Date.now(); }
    if (markets.status === 'fulfilled' && markets.value.length) { cache.markets = markets.value; cache.marketsAt = Date.now(); }
  })().catch(() => {}).finally(() => { cache.busy = null; });
  return cache.busy;
}

/** The /api/live payload. Serves the cache immediately; refreshes in the background when stale. Never throws. */
export async function getLiveFeed() {
  const stale = !cache.news || Date.now() - cache.newsAt > NEWS_TTL_MS || !cache.markets || Date.now() - cache.marketsAt > MARKET_TTL_MS;
  if (stale) {
    if (!cache.news && !cache.markets) await refresh(); // first hit: wait once so the ticker isn't empty
    else refresh().catch(() => {});
  }
  return {
    news: cache.news || { syria: [], world: [] },
    osint: cache.osint || [],
    markets: cache.markets || [],
    server_time: new Date().toISOString(),
  };
}

let timer = null;
export function startLiveFeed() {
  if (timer) return;
  refresh().catch(() => {});
  timer = setInterval(() => { refresh().catch(() => {}); }, NEWS_TTL_MS);
  timer.unref?.();
}
export const _test = { parseRssItems, parseYahooChart, isSyriaItem, NEWS_FEEDS, OSINT_CHANNELS, MARKET_SYMBOLS, cache };
