import test from 'node:test';
import assert from 'node:assert/strict';

// «المباشر» (Live) module: RSS parsing, Syria bucketing, market-quote sanity.
// Network is stubbed out — these tests pin parsing/classification behaviour only.
const { parseRssItems, parseYahooChart, isSyriaItem, getLiveFeed, NEWS_FEEDS, OSINT_CHANNELS, MARKET_SYMBOLS } = await import('../server/live-feed.js');

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
