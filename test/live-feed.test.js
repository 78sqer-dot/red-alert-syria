import test from 'node:test';
import assert from 'node:assert/strict';

// «المباشر» (Live) module: RSS parsing, Syria bucketing, market-quote sanity.
// Network is stubbed out — these tests pin parsing/classification behaviour only.
const { parseRssItems, parseYahooChart, parseTradingViewScan, parseCoinGeckoQuote, isSyriaItem, getLiveFeed, NEWS_FEEDS, OSINT_CHANNELS, MARKET_SYMBOLS, _test } = await import('../server/live-feed.js');

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>قصف مدفعي على ريف حلب الشمالي</title><link>https://example.com/a1</link><pubDate>Tue, 17 Nov 2026 10:00:00 GMT</pubDate><description>قصف على بلدات ريف حلب</description></item>
<item><title><![CDATA[بريطانيا تعزز دفاعات أوكرانيا &amp; حلفائها]]></title><link>https://example.com/a2</link><pubDate>Tue, 17 Nov 2026 11:00:00 GMT</pubDate><description>حزمة مساعدات جديدة تشمل سوريا في ملحق التقرير</description></item>
<item><title>خبر بلا رابط صالح</title><pubDate>Tue, 17 Nov 2026 09:00:00 GMT</pubDate></item>
</channel></rss>`;

test('parseRssItems extracts title/url/ts/desc, decodes CDATA and entities, skips linkless items', () => {
  const items = parseRssItems(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'قصف مدفعي على ريف حلب الشمالي');
  assert.equal(items[0].url, 'https://example.com/a1');
  assert.ok(Number.isFinite(items[0].ts));
  assert.equal(items[1].title, 'بريطانيا تعزز دفاعات أوكرانيا & حلفائها');
});

test('the Syria bucket is decided by the headline only', () => {
  const items = parseRssItems(RSS);
  assert.equal(isSyriaItem(items[0]), true, 'a headline naming حلب is Syria news');
  assert.equal(isSyriaItem(items[1]), false, 'Syria mentioned only in the description stays world news');
  assert.equal(isSyriaItem({ title: 'اجتماع في دمشق حول إعادة الإعمار' }), true);
  assert.equal(isSyriaItem({ title: 'أسعار النفط ترتفع عالميا' }), false);
});

test('parseYahooChart computes the day change from the last two closes and rejects bad data', () => {
  const def = MARKET_SYMBOLS.find((m) => m.symbol === '^GSPC');
  const good = { chart: { result: [{ meta: { regularMarketPrice: 101, chartPreviousClose: 99 }, indicators: { quote: [{ close: [98, 100, 101] }] } }] } };
  assert.deepEqual(parseYahooChart(good, def), { price: 101, prevClose: 100, changePct: 1 });
  assert.equal(parseYahooChart({ chart: { result: [{ meta: { regularMarketPrice: -5 }, indicators: { quote: [{ close: [1, 2] }] } }] } }, def), null, 'non-positive price rejected');
  const wild = { chart: { result: [{ meta: { regularMarketPrice: 200 }, indicators: { quote: [{ close: [100, 100] }] } }] } };
  assert.equal(parseYahooChart(wild, def), null, 'an implausible index move is omitted, not shown');
  assert.equal(parseYahooChart(null, def), null);
  assert.equal(parseYahooChart({}, def), null);
  const fallback = { chart: { result: [{ meta: { regularMarketPrice: 55, chartPreviousClose: 50 }, indicators: { quote: [{ close: [] }] } }] } };
  assert.deepEqual(parseYahooChart(fallback, def), { price: 55, prevClose: 50, changePct: 10 }, 'chartPreviousClose is the fallback');
});

test('verified source lists: 6 RSS feeds, 4 OSINT channels, 12 market symbols', () => {
  assert.equal(NEWS_FEEDS.length, 6);
  assert.ok(NEWS_FEEDS.every((f) => /^https:\/\//.test(f.url) && f.name));
  assert.deepEqual(OSINT_CHANNELS.map((c) => c.u), ['osintdefender', 'intelslava', 'rybar', 'milinfolive']);
  assert.equal(MARKET_SYMBOLS.length, 12);
});

test('parseTradingViewScan maps tickers to quotes and applies the same sanity caps', () => {
  const scan = { data: [
    { s: 'SP:SPX', d: [7351.7, -0.87] },
    { s: 'TVC:GOLD', d: [3857.5, 0.03] },
    { s: 'CBOE:VIX', d: [25.33, 10.56] },
    { s: 'NYMEX:NG1!', d: [3.23, 55] },
    { s: 'TVC:SILVER', d: [-4, 0.5] },
    { s: 'NASDAQ:UNKNOWN', d: [10, 1] },
  ] };
  const byTv = parseTradingViewScan(scan);
  assert.deepEqual(byTv.get('SP:SPX'), { price: 7351.7, changePct: -0.87 });
  assert.deepEqual(byTv.get('TVC:GOLD'), { price: 3857.5, changePct: 0.03 });
  assert.deepEqual(byTv.get('CBOE:VIX'), { price: 25.33, changePct: 10.56 }, 'VIX may move more than an index');
  assert.equal(byTv.has('NYMEX:NG1!'), false, 'a 55% gas move exceeds its cap and is omitted');
  assert.equal(byTv.has('TVC:SILVER'), false, 'a non-positive price is omitted');
  assert.equal(byTv.size, 3, 'unknown tickers are ignored');
  assert.equal(parseTradingViewScan(null).size, 0);
  assert.equal(parseTradingViewScan({}).size, 0);
});

test('parseCoinGeckoQuote reads usd + 24h change and rejects bad data', () => {
  const def = MARKET_SYMBOLS.find((m) => m.symbol === 'BTC-USD');
  const json = { bitcoin: { usd: 63811, usd_24h_change: -1.478 } };
  assert.deepEqual(parseCoinGeckoQuote(json, def), { price: 63811, changePct: -1.48 });
  assert.equal(parseCoinGeckoQuote(json, MARKET_SYMBOLS.find((m) => m.symbol === 'ETH-USD')), null, 'missing id -> null');
  assert.equal(parseCoinGeckoQuote({ bitcoin: { usd: 100, usd_24h_change: 90 } }, def), null, 'a 90% move exceeds the BTC cap');
  assert.equal(parseCoinGeckoQuote(null, def), null);
});

// ------------------------------------------------ markets fallback chain (network stubbed by URL)
const yahooOk = (price, prev) => ({ ok: true, status: 200, json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: price, chartPreviousClose: prev }, indicators: { quote: [{ close: [prev, price] }] } }] } }) });
const httpFail = (status = 429) => ({ ok: false, status, json: async () => ({}) });
const TV_ALL = { data: MARKET_SYMBOLS.map((d) => ({ s: d.tv, d: [100, 1] })) };

function stubFetch({ q1 = {}, q2 = {}, tv = null, cg = null, calls = null } = {}) {
  return async (url) => {
    const u = String(url);
    if (calls) calls.push(u);
    if (u.includes('query1.finance.yahoo.com') || u.includes('query2.finance.yahoo.com')) {
      const table = u.includes('query1') ? q1 : q2;
      const sym = decodeURIComponent(u.split('/chart/')[1].split('?')[0]);
      const v = table[sym];
      if (v === 'fail') return httpFail();
      if (typeof v === 'number') return yahooOk(v, 100);
      return httpFail(404);
    }
    if (u.includes('scanner.tradingview.com')) return tv ? { ok: true, status: 200, json: async () => tv } : httpFail(503);
    if (u.includes('api.coingecko.com')) return cg ? { ok: true, status: 200, json: async () => cg } : httpFail(503);
    throw new Error('unexpected url ' + u);
  };
}

test('fallback chain: with both Yahoo hosts blocked, one TradingView batch fills all 12', async () => {
  _test.resetMarketState();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch({ tv: TV_ALL });
  try {
    const markets = await _test.fetchMarkets();
    assert.equal(markets.length, 12);
    assert.ok(markets.every((m) => m.price === 100 && m.changePct === 1));
    assert.deepEqual(markets.map((m) => m.symbol), MARKET_SYMBOLS.map((d) => d.symbol), 'panel order follows MARKET_SYMBOLS');
  } finally { globalThis.fetch = originalFetch; }
});

test('fallback chain: per-symbol fill — query1 partial, query2 fills some, TradingView the rest', async () => {
  _test.resetMarketState();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch({
    q1: { '^GSPC': 101, '^IXIC': 102, '^DJI': 103, '^RUT': 104 },
    q2: { '^VIX': 105, 'BTC-USD': 106, 'ETH-USD': 107 },
    tv: TV_ALL,
  });
  try {
    const markets = await _test.fetchMarkets();
    assert.equal(markets.length, 12);
    const bySymbol = new Map(markets.map((m) => [m.symbol, m.price]));
    assert.equal(bySymbol.get('^GSPC'), 101, 'query1 quote kept');
    assert.equal(bySymbol.get('^VIX'), 105, 'query2 filled what query1 missed');
    assert.equal(bySymbol.get('GC=F'), 100, 'TradingView filled the rest');
  } finally { globalThis.fetch = originalFetch; }
});

test('fallback chain: CoinGecko is the crypto last resort when TradingView lacks the coins', async () => {
  _test.resetMarketState();
  const originalFetch = globalThis.fetch;
  const tvNoCrypto = { data: TV_ALL.data.filter((r) => !r.s.startsWith('BINANCE:')) };
  globalThis.fetch = stubFetch({ tv: tvNoCrypto, cg: { bitcoin: { usd: 63000, usd_24h_change: -2 }, ethereum: { usd: 1800, usd_24h_change: 0.5 } } });
  try {
    const markets = await _test.fetchMarkets();
    assert.equal(markets.length, 12);
    const bySymbol = new Map(markets.map((m) => [m.symbol, m]));
    assert.equal(bySymbol.get('BTC-USD').price, 63000);
    assert.equal(bySymbol.get('ETH-USD').changePct, 0.5);
    assert.equal(bySymbol.get('^GSPC').price, 100, 'non-crypto still came from TradingView');
  } finally { globalThis.fetch = originalFetch; }
});

test('negative cache: a network-dead Yahoo host is not hammered again on the next refresh', async () => {
  _test.resetMarketState();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = stubFetch({ tv: TV_ALL, calls });
  try {
    await _test.fetchMarkets();
    const firstRound = calls.filter((u) => u.includes('query1.finance.yahoo.com')).length;
    assert.equal(firstRound, 12, 'first refresh tries every symbol on query1');
    calls.length = 0;
    const markets = await _test.fetchMarkets();
    assert.equal(markets.length, 12, 'TradingView still serves the panel');
    assert.equal(calls.filter((u) => u.includes('query1.finance.yahoo.com')).length, 0, 'query1 skipped while negatively cached');
    assert.equal(calls.filter((u) => u.includes('query2.finance.yahoo.com')).length, 0, 'query2 skipped while negatively cached');
  } finally { globalThis.fetch = originalFetch; }
});

test('getLiveFeed never throws and always returns the API shape, even with the network down', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const feed = await getLiveFeed();
    assert.ok(Array.isArray(feed.news.syria) && Array.isArray(feed.news.world));
    assert.ok(Array.isArray(feed.osint) && Array.isArray(feed.markets));
    assert.ok(typeof feed.server_time === 'string');
  } finally { globalThis.fetch = originalFetch; }
});
