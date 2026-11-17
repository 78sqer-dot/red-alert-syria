import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLiveSceneService, parseBbcRss, parseEcbCsv, parseGdeltResponse, parseWorldBankResponse,
} from '../server/live-scene.js';

const bbcFeed = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[سوريا &amp; العالم]]></title><link>https://www.bbc.co.uk/arabic/news-123</link><pubDate>Mon, 16 Nov 2026 17:00:00 GMT</pubDate><description>Full article text should not appear</description></item><item><title>أسواق العالم تتحرك</title><link>https://www.bbc.co.uk/arabic/news-124</link><pubDate>Mon, 16 Nov 2026 16:00:00 GMT</pubDate></item><item><title>Bad link</title><link>javascript:alert(1)</link></item></channel></rss>`;
const ecbCsv = [
  'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS',
  'D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-11-14,1.0891,A',
  'D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,2026-10-23,0.8721,A',
  'D.JPY.EUR.SP00.A,D,JPY,EUR,SP00,A,2026-10-23,174.23,A',
].join('\n');

const wbPayload = [
  { page: 1, pages: 1 },
  [
    { date: '2025', value: null },
    { date: '2024', value: null },
    { date: '2022', value: 23737634644.3994 },
  ],
];

test('BBC RSS parser keeps only attributed title/link/time metadata', () => {
  const items = parseBbcRss(bbcFeed);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'سوريا & العالم');
  assert.equal(items[0].source, 'BBC News عربي');
  assert.equal(items[0].url, 'https://www.bbc.co.uk/arabic/news-123');
  assert.equal(items[0].publishedAt, '2026-11-16T17:00:00.000Z');
  assert.equal(items[1].title, 'أسواق العالم تتحرك');
  assert.equal(Object.hasOwn(items[0], 'description'), false);
  assert.equal(parseBbcRss('<rss><item>no tags</item></rss>').length, 0);
});

test('GDELT parser accepts Arabic, relevant, safe source links only', () => {
  const items = parseGdeltResponse({ articles: [
    { language: 'Arabic', title: 'تطورات جديدة في سوريا', domain: 'alarabiya.net', url: 'https://www.alarabiya.net/news/1', seendate: '20261116T171500Z' },
    { language: 'English', title: 'Syria developments', domain: 'example.com', url: 'https://example.com/en', seendate: '20261116T171400Z' },
    { language: 'Arabic', title: 'خبر عام بلا صلة ظاهرة', domain: 'example.com', url: 'https://example.com/no', seendate: '20261116T171300Z' },
    { language: 'Arabic', title: 'دمشق', domain: 'evil.test', url: 'javascript:alert(1)', seendate: '20261116T171200Z' },
  ] });
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'العربية');
  assert.equal(items[0].publishedAt, '2026-11-16T17:15:00.000Z');
  assert.equal(parseGdeltResponse('{bad json').length, 0);
});

test('ECB parser preserves reference date and flags delayed quotes', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const rates = parseEcbCsv(ecbCsv, now);
  assert.equal(rates.length, 3);
  const usd = rates.find((item) => item.nameEn.startsWith('USD'));
  const gbp = rates.find((item) => item.nameEn.startsWith('GBP'));
  assert.equal(usd.value, '1.0891');
  assert.equal(usd.observedAt, '2026-11-14');
  assert.equal(usd.stale, false);
  assert.equal(gbp.stale, true);
  assert.equal(parseEcbCsv('not a csv').length, 0);
});

test('World Bank parser uses newest non-null annual GDP observation and labels its year', () => {
  const gdp = parseWorldBankResponse(wbPayload);
  assert.equal(gdp.length, 1);
  assert.equal(gdp[0].value, '23.7');
  assert.equal(gdp[0].unit, 'B USD');
  assert.equal(gdp[0].observedAt, '2022');
  assert.equal(gdp[0].stale, true);
  assert.equal(parseWorldBankResponse([{ }, [{ date: '2025', value: null }]]).length, 0);
});

test('service caches successful source data, then falls back to cached data on upstream failure', async () => {
  let current = Date.parse('2026-11-16T18:00:00Z');
  let shouldFail = false;
  let requests = 0;
  const fakeFetch = async (input) => {
    requests++;
    if (shouldFail) throw new Error('simulated upstream outage');
    const url = String(input);
    if (url.includes('feeds.bbci.co.uk')) return new Response(bbcFeed, { status: 200 });
    if (url.includes('api.gdeltproject.org')) {
      assert.match(new URL(url).searchParams.get('query'), /sourcelang:arabic/);
      return new Response(JSON.stringify({ articles: [{ language: 'Arabic', title: 'سوريا: تطور ميداني', domain: 'alarabiya.net', url: 'https://www.alarabiya.net/news/2', seendate: '20261116T175000Z' }] }), { status: 200 });
    }
    if (url.includes('data-api.ecb.europa.eu')) return new Response(ecbCsv, { status: 200 });
    if (url.includes('api.worldbank.org')) return new Response(JSON.stringify(wbPayload), { status: 200 });
    throw new Error(`unexpected source: ${url}`);
  };
  const service = createLiveSceneService({ fetchImpl: fakeFetch, now: () => current, cacheTtlMs: 1_000, maxStaleMs: 60_000 });
  const first = await service.getLiveScene();
  assert.equal(first.news.length, 3);
  assert.equal(first.news.filter((item) => item.region === 'syria').length, 2);
  assert.equal(first.news.filter((item) => item.region === 'world').length, 1);
  assert.equal(first.markets.length, 4);
  assert.equal(first.degraded, false);
  assert.equal(first.news.every((item) => item.current), true, 'fresh items from successful source checks are marked current');
  assert.equal(requests, 4);
  await service.getLiveScene();
  assert.equal(requests, 4);

  current += 2_000;
  shouldFail = true;
  const fallback = await service.getLiveScene();
  assert.equal(fallback.degraded, true);
  assert.equal(fallback.news.length, 3);
  assert.equal(fallback.updatedAt, first.updatedAt);
  assert.equal(Object.values(fallback.sourceStatus).every((status) => status === 'cached'), true);
  assert.equal(fallback.news.some((item) => item.current), false, 'cached items are explicitly not current');
  assert.equal(requests, 8);
});

test('a current duplicate replaces the same headline retained from a cached source', async () => {
  let current = Date.parse('2026-11-16T18:00:00Z');
  let bbcFails = false;
  const duplicateUrl = 'https://www.bbc.co.uk/arabic/news-123';
  const fakeFetch = async (input) => {
    const url = String(input);
    if (url.includes('feeds.bbci.co.uk')) {
      if (bbcFails) throw new Error('simulated BBC outage');
      return new Response(bbcFeed, { status: 200 });
    }
    if (url.includes('api.gdeltproject.org')) return new Response(JSON.stringify({ articles: [
      { language: 'Arabic', title: 'تطور ميداني في سوريا', domain: 'example.com', url: duplicateUrl, seendate: '20261116T175500Z' },
    ] }), { status: 200 });
    if (url.includes('data-api.ecb.europa.eu')) return new Response(ecbCsv, { status: 200 });
    if (url.includes('api.worldbank.org')) return new Response(JSON.stringify(wbPayload), { status: 200 });
    throw new Error(`unexpected source: ${url}`);
  };
  const service = createLiveSceneService({ fetchImpl: fakeFetch, now: () => current, cacheTtlMs: 1_000, maxStaleMs: 60_000 });
  await service.getLiveScene();

  current += 2_000;
  bbcFails = true;
  const mixed = await service.getLiveScene();
  const duplicate = mixed.news.find((item) => item.url === duplicateUrl);
  assert.equal(mixed.sourceStatus.bbc, 'cached');
  assert.equal(mixed.sourceStatus.gdelt, 'ok');
  assert.equal(duplicate?.current, true, 'the live GDELT version must beat the earlier cached BBC duplicate');
  assert.equal(duplicate?.title, 'تطور ميداني في سوريا');
});

test('cached source data expires independently while other sources keep succeeding', async () => {
  let current = Date.parse('2026-11-16T18:00:00Z');
  let gdeltFails = false;
  const fakeFetch = async (input) => {
    const url = String(input);
    if (url.includes('api.gdeltproject.org')) {
      if (gdeltFails) throw new Error('simulated GDELT outage');
      return new Response(JSON.stringify({ articles: [{ language: 'Arabic', title: 'سوريا: تطور ميداني', domain: 'alarabiya.net', url: 'https://www.alarabiya.net/news/2', seendate: '20261116T175000Z' }] }), { status: 200 });
    }
    if (url.includes('feeds.bbci.co.uk')) return new Response(bbcFeed, { status: 200 });
    if (url.includes('data-api.ecb.europa.eu')) return new Response(ecbCsv, { status: 200 });
    if (url.includes('api.worldbank.org')) return new Response(JSON.stringify(wbPayload), { status: 200 });
    throw new Error(`unexpected source: ${url}`);
  };
  const service = createLiveSceneService({ fetchImpl: fakeFetch, now: () => current, cacheTtlMs: 1_000, maxStaleMs: 5_000 });
  const first = await service.getLiveScene();
  assert.equal(first.news.length, 3);

  current += 2_000;
  gdeltFails = true;
  const fallback = await service.getLiveScene();
  assert.equal(fallback.sourceStatus.gdelt, 'cached');
  assert.equal(fallback.news.length, 3);
  assert.equal(fallback.news.filter((item) => item.current).length, 2, 'only the still-successful BBC items remain current');
  assert.equal(fallback.news.find((item) => item.url.endsWith('/news/2')).current, false, 'cached GDELT content is never current');

  current += 6_000;
  const expired = await service.getLiveScene();
  assert.equal(expired.sourceStatus.gdelt, 'unavailable');
  assert.equal(expired.news.length, 2, 'expired GDELT headlines are no longer retained');
  assert.equal(expired.degraded, true);
});

test('oversized upstream bodies are cancelled and only that source degrades', async () => {
  let bbcCancelled = false;
  const oversizedBody = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1_000_001)); },
    cancel() { bbcCancelled = true; },
  });
  const fakeFetch = async (input) => {
    const url = String(input);
    if (url.includes('feeds.bbci.co.uk')) return new Response(oversizedBody, { status: 200 });
    if (url.includes('api.gdeltproject.org')) {
      return new Response(JSON.stringify({ articles: [{ language: 'Arabic', title: 'سوريا: تطور ميداني', domain: 'alarabiya.net', url: 'https://www.alarabiya.net/news/2', seendate: '20261116T175000Z' }] }), { status: 200 });
    }
    if (url.includes('data-api.ecb.europa.eu')) return new Response(ecbCsv, { status: 200 });
    if (url.includes('api.worldbank.org')) return new Response(JSON.stringify(wbPayload), { status: 200 });
    throw new Error(`unexpected source: ${url}`);
  };
  const data = await createLiveSceneService({ fetchImpl: fakeFetch }).getLiveScene();
  assert.equal(bbcCancelled, true);
  assert.equal(data.sourceStatus.bbc, 'unavailable');
  assert.equal(data.news.length, 1, 'the valid GDELT headline remains available');
  assert.equal(data.news[0].region, 'syria');
});

test('service fails closed with no cached records when every source is unavailable', async () => {
  const service = createLiveSceneService({ fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(service.getLiveScene(), /sources unavailable/);
});

test('an invalid 200 response degrades only that source rather than masking its failure', async () => {
  const fakeFetch = async (input) => {
    const url = String(input);
    if (url.includes('feeds.bbci.co.uk')) return new Response(bbcFeed, { status: 200 });
    if (url.includes('api.gdeltproject.org')) return new Response('try again later', { status: 200 });
    if (url.includes('data-api.ecb.europa.eu')) return new Response(ecbCsv, { status: 200 });
    if (url.includes('api.worldbank.org')) return new Response(JSON.stringify(wbPayload), { status: 200 });
    throw new Error(`unexpected source: ${url}`);
  };
  const data = await createLiveSceneService({ fetchImpl: fakeFetch }).getLiveScene();
  assert.equal(data.degraded, true);
  assert.equal(data.sourceStatus.gdelt, 'unavailable');
  assert.equal(data.news.length, 2, 'the valid BBC feed remains available');
  assert.equal(data.markets.length, 4, 'valid market APIs remain available');
});
