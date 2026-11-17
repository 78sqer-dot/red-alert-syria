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
//  - Markets: a fallback chain, because Yahoo's chart API rate-limits some
//    datacenter egress (on Render only ~4/12 symbols came through). Primary:
//    Yahoo query1 per-symbol; then Yahoo query2 per-symbol (different host);
//    then one batched TradingView scanner POST (independent provider, all 12
//    tickers verified live 2026-11-17); finally CoinGecko (BTC/ETH only) as a
//    last resort. Strict numeric sanity checks apply per source — a quote
//    that fails them is omitted, never shown. Binance is geo-blocked from
//    this network and Stooq answers 404 pages, so neither is used.
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

// symbol = Yahoo chart symbol; tv = TradingView scanner ticker; cg = CoinGecko
// id (crypto only); maxMove = largest plausible |day change %| — beyond it the
// quote is treated as bad data and omitted. All tv/cg mappings were verified
// live on 2026-11-17 (TV spot/continuous-future tickers track the same
// instruments the Yahoo futures/index symbols name).
export const MARKET_SYMBOLS = [
  { symbol: '^GSPC', tv: 'SP:SPX', ar: 'إس آند بي 500', en: 'S&P 500', maxMove: 15 },
  { symbol: '^IXIC', tv: 'NASDAQ:IXIC', ar: 'ناسداك', en: 'Nasdaq', maxMove: 15 },
  { symbol: '^DJI', tv: 'DJ:DJI', ar: 'داو جونز', en: 'Dow Jones', maxMove: 15 },
  { symbol: '^RUT', tv: 'TVC:RUT', ar: 'راسل 2000', en: 'Russell 2000', maxMove: 15 },
  { symbol: '^VIX', tv: 'CBOE:VIX', ar: 'مؤشر التقلب VIX', en: 'VIX', maxMove: 120 },
  { symbol: 'BTC-USD', tv: 'BINANCE:BTCUSDT', cg: 'bitcoin', ar: 'بيتكوين', en: 'Bitcoin', maxMove: 40 },
  { symbol: 'ETH-USD', tv: 'BINANCE:ETHUSDT', cg: 'ethereum', ar: 'إيثريوم', en: 'Ethereum', maxMove: 40 },
  { symbol: 'GC=F', tv: 'TVC:GOLD', ar: 'الذهب', en: 'Gold', maxMove: 12 },
  { symbol: 'SI=F', tv: 'TVC:SILVER', ar: 'الفضة', en: 'Silver', maxMove: 15 },
  { symbol: 'CL=F', tv: 'NYMEX:CL1!', ar: 'النفط الخام', en: 'WTI crude', maxMove: 25 },
  { symbol: 'BZ=F', tv: 'NYMEX:BZ1!', ar: 'خام برنت', en: 'Brent crude', maxMove: 25 },
  { symbol: 'NG=F', tv: 'NYMEX:NG1!', ar: 'الغاز الطبيعي', en: 'Natural gas', maxMove: 35 },
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

// ------------------------------------------------------------ fallback quote sources
/** One TradingView /global/scan response -> Map(tv ticker -> { price, changePct }).
 * Columns are [close, change] with change already in percent; the same
 * per-symbol sanity caps as Yahoo apply. */
export function parseTradingViewScan(json, defs = MARKET_SYMBOLS) {
  const out = new Map();
  try {
    const byTv = new Map(defs.filter((d) => d.tv).map((d) => [d.tv, d]));
    for (const row of json?.data || []) {
      const def = byTv.get(row?.s);
      if (!def || out.has(def.tv)) continue;
      const [close, change] = Array.isArray(row?.d) ? row.d : [];
      const price = Number(close);
      const changePct = Number(change);
      if (!Number.isFinite(price) || price <= 0) continue;
      if (!Number.isFinite(changePct) || Math.abs(changePct) > (def.maxMove ?? 25)) continue;
      out.set(def.tv, { price, changePct: Math.round(changePct * 100) / 100 });
    }
  } catch { /* unusable payload -> empty map */ }
  return out;
}

/** One CoinGecko simple/price entry -> { price, changePct } or null. Its
 * change is a 24h change, which for 24/7 crypto is the panel's day change. */
export function parseCoinGeckoQuote(json, def) {
  try {
    const entry = json?.[def?.cg];
    if (!entry) return null;
    const price = Number(entry.usd);
    const changePct = Number(entry.usd_24h_change);
    if (!Number.isFinite(price) || price <= 0) return null;
    if (!Number.isFinite(changePct) || Math.abs(changePct) > (def?.maxMove ?? 25)) return null;
    return { price, changePct: Math.round(changePct * 100) / 100 };
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

// Per-source negative cache: when a source fails at the network level (every
// request threw), it is skipped for a while instead of being hammered on
// every refresh — that is exactly the situation on egress Yahoo rate-limits.
const SOURCE_DOWN_MS = 10 * 60_000;
const sourceDownUntil = { yahoo1: 0, yahoo2: 0, tradingview: 0, coingecko: 0 };
const sourceDown = (name) => Date.now() < sourceDownUntil[name];
function noteSourceResult(name, attempted, answered) {
  if (attempted > 0 && answered === 0) sourceDownUntil[name] = Date.now() + SOURCE_DOWN_MS;
  else if (answered > 0) sourceDownUntil[name] = 0;
}

const fetchJson = async (url, timeoutMs = 10_000, init = {}) => {
  const r = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

/** One Yahoo host, per-symbol. Returns how many requests the host answered at
 * all (for the negative cache) and fills `found` with sane quotes. */
async function fetchYahooHost(host, sourceName, defs, found) {
  if (!defs.length || sourceDown(sourceName)) return 0;
  let answered = 0;
  await Promise.allSettled(defs.map(async (def) => {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(def.symbol)}?range=5d&interval=1d`;
    const json = await fetchJson(url, 10_000);
    answered += 1;
    const quote = parseYahooChart(json, def);
    if (quote) found.set(def.symbol, quote);
  }));
  noteSourceResult(sourceName, defs.length, answered);
  return answered;
}

async function fetchMarkets() {
  const found = new Map();
  const servedBy = { yahoo1: 0, yahoo2: 0, tradingview: 0, coingecko: 0 };
  const missing = () => MARKET_SYMBOLS.filter((d) => !found.has(d.symbol));

  // 1) Yahoo query1 (primary), then 2) Yahoo query2 for whatever is missing.
  await fetchYahooHost('query1.finance.yahoo.com', 'yahoo1', missing(), found);
  servedBy.yahoo1 = found.size;
  await fetchYahooHost('query2.finance.yahoo.com', 'yahoo2', missing(), found);
  servedBy.yahoo2 = found.size - servedBy.yahoo1;

  // 3) TradingView scanner: ONE batched POST for everything still missing.
  const rest = missing();
  if (rest.length && !sourceDown('tradingview')) {
    try {
      const json = await fetchJson('https://scanner.tradingview.com/global/scan', 12_000, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: { tickers: rest.map((d) => d.tv), query: { types: [] } }, columns: ['close', 'change'], range: [0, rest.length] }),
      });
      noteSourceResult('tradingview', 1, 1);
      const byTv = parseTradingViewScan(json, rest);
      for (const def of rest) {
        const quote = byTv.get(def.tv);
        if (quote) { found.set(def.symbol, quote); servedBy.tradingview += 1; }
      }
    } catch { noteSourceResult('tradingview', 1, 0); }
  }

  // 4) CoinGecko: last resort for the two crypto symbols only (one call).
  const crypto = missing().filter((d) => d.cg);
  if (crypto.length && !sourceDown('coingecko')) {
    try {
      const ids = [...new Set(crypto.map((d) => d.cg))].join(',');
      const json = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`, 10_000);
      noteSourceResult('coingecko', 1, 1);
      for (const def of crypto) {
        const quote = parseCoinGeckoQuote(json, def);
        if (quote) { found.set(def.symbol, quote); servedBy.coingecko += 1; }
      }
    } catch { noteSourceResult('coingecko', 1, 0); }
  }

  // One diagnostic line per refresh: on the live server this is the only
  // window into which source its network lets through.
  const miss = missing().map((d) => d.symbol);
  console.log(`[live] markets refresh: yahoo1=${servedBy.yahoo1} yahoo2=${servedBy.yahoo2} tradingview=${servedBy.tradingview} coingecko=${servedBy.coingecko} total=${found.size}/${MARKET_SYMBOLS.length}${miss.length ? ` missing=${miss.join(',')}` : ''}`);

  return MARKET_SYMBOLS.filter((d) => found.has(d.symbol)).map((d) => {
    const quote = found.get(d.symbol);
    return { symbol: d.symbol, ar: d.ar, en: d.en, price: quote.price, changePct: quote.changePct };
  });
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
export const _test = {
  parseRssItems, parseYahooChart, parseTradingViewScan, parseCoinGeckoQuote, isSyriaItem,
  NEWS_FEEDS, OSINT_CHANNELS, MARKET_SYMBOLS, cache, sourceDownUntil, fetchMarkets,
  resetMarketState() { for (const k of Object.keys(sourceDownUntil)) sourceDownUntil[k] = 0; cache.markets = null; cache.marketsAt = 0; },
};
