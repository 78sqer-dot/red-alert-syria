import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLiveScenePayload, safeLiveSceneUrl, formatLiveSceneTime } from '../public/js/live-scene.js';

test('normalizes feed and market records while dropping malformed entries', () => {
  const result = normalizeLiveScenePayload({
    updated_at: '2026-11-16T18:00:00Z',
    news: [
      { headline: '  News headline  ', source_name: 'Source A', link: 'https://example.com/news', published_at: '2026-11-16T17:55:00Z', region: 'syria' },
      { title: 'World headline', region: 'world' },
      { title: '   ' },
      null,
    ],
    osint: [{ text: 'Signal', source: 'Open source', url: 'javascript:alert(1)' }],
    markets: [{ label: 'Brent', value: 82.5, unit: 'USD', change_percent: '-0.2%', updated_at: '2026-11-16T17:00:00Z' }],
  });
  assert.equal(result.updatedAt, '2026-11-16T18:00:00Z');
  assert.deepEqual(result.news[0], {
    title: 'News headline', source: 'Source A', url: 'https://example.com/news', publishedAt: '2026-11-16T17:55:00Z', current: false, region: 'syria',
  });
  assert.equal(result.news.length, 2);
  assert.equal(result.syriaNews.length, 1);
  assert.equal(result.worldNews.length, 1);
  assert.equal(result.osint[0].url, null);
  assert.equal(result.markets[0].name, 'Brent');
  assert.equal(result.markets[0].value, '82.5');
  assert.equal(result.markets[0].change, '-0.2%');
});

test('rejects unsafe external URLs and accepts only credential-free HTTP(S) URLs', () => {
  assert.equal(safeLiveSceneUrl('javascript:alert(1)'), null);
  assert.equal(safeLiveSceneUrl('data:text/html,x'), null);
  assert.equal(safeLiveSceneUrl('https://user:pass@example.com/'), null);
  assert.equal(safeLiveSceneUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeLiveSceneUrl('http://example.com/'), 'http://example.com/');
  assert.equal(safeLiveSceneUrl(`https://example.com/${'x'.repeat(2050)}`), null);
});

test('limits feed sizes and text lengths and ignores invalid payload types', () => {
  const result = normalizeLiveScenePayload({
    news: Array.from({ length: 40 }, (_, index) => ({ title: `headline-${index}-${'x'.repeat(400)}` })),
  });
  assert.equal(result.news.length, 24);
  assert.ok(result.news[0].title.length <= 320);
  assert.deepEqual(normalizeLiveScenePayload(null), { news: [], syriaNews: [], worldNews: [], osint: [], markets: [], updatedAt: '', degraded: false });
});

test('formats valid timestamps and leaves invalid timestamps blank', () => {
  assert.match(formatLiveSceneTime('2026-11-16T18:00:00Z', 'en', 'Asia/Damascus'), /2026|Nov/);
  assert.equal(formatLiveSceneTime('not-a-date', 'en'), '');
  assert.equal(formatLiveSceneTime('', 'ar'), '');
});
