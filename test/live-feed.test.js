import test from 'node:test';
import assert from 'node:assert/strict';

// «المباشر» (Live) module: RSS parsing and Syria bucketing for the news-only
// feed (owner simplification 2026-11-17: markets + OSINT sections removed).
// Network is stubbed out — these tests pin parsing/classification behaviour only.
const { parseRssItems, isSyriaItem, getLiveFeed, NEWS_FEEDS } = await import('../server/live-feed.js');

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

test('verified source list: 6 RSS feeds', () => {
  assert.equal(NEWS_FEEDS.length, 6);
  assert.ok(NEWS_FEEDS.every((f) => /^https:\/\//.test(f.url) && f.name));
});

test('getLiveFeed never throws and returns the news-only API shape, even with the network down', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const feed = await getLiveFeed();
    assert.ok(Array.isArray(feed.news.syria) && Array.isArray(feed.news.world));
    // owner simplification (2026-11-17): no markets / OSINT keys any more
    assert.equal('osint' in feed, false);
    assert.equal('markets' in feed, false);
    assert.ok(typeof feed.server_time === 'string');
  } finally { globalThis.fetch = originalFetch; }
});
