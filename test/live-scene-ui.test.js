import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeLiveScenePayload, selectCurrentLiveHeadlines } from '../public/js/live-scene.js';

const [html, app, styles, i18n, server] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/css/app.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/js/i18n.js', import.meta.url), 'utf8'),
  readFile(new URL('../server/index.js', import.meta.url), 'utf8'),
]);

test('live-scene entry is in map tools and reads only through the same-origin API', () => {
  assert.match(html, /id="btnLiveScene"/);
  assert.match(html, /data-t="liveScene"/);
  assert.match(app, /fetch\('\/api\/live-scene'/);
  assert.match(app, /setMapControlsOpen\(true\)/);
  assert.match(app, /data-m="close"/);
  assert.match(server, /app\.get\('\/api\/live-scene', apiLimiter/);
  assert.match(server, /liveSceneService\.getLiveScene\(\)/);
});

test('live-scene has both language labels and accessible refresh/status affordances', () => {
  for (const key of ['liveScene', 'liveNews', 'liveOsint', 'liveMarkets', 'liveUnavailable', 'livePartial', 'liveNotRealtime']) {
    assert.ok((i18n.match(new RegExp(`\\b${key}:`, 'g')) || []).length >= 2, `missing Arabic/English translation for ${key}`);
  }
  assert.match(app, /aria-live="polite"/);
  assert.match(app, /aria-label="\$\{esc\(T\.liveRefresh\)\}"/);
});

test('the standalone homepage ticker is separate from map alerts and opens detailed news', () => {
  const strip = html.match(/<section class="home-headlines"[\s\S]*?<\/section>/)?.[0] || '';
  assert.ok(strip, 'headline ticker is a distinct homepage section');
  assert.match(html, /<section class="home-headlines"[\s\S]*?<main class="layout"/);
  assert.match(strip, /id="homeHeadlineTicker"/);
  assert.match(strip, /id="homeHeadlinesToggle"/);
  assert.match(strip, /id="homeHeadlinesOpen"/);
  assert.match(app, /\$\('#homeHeadlinesOpen'\)\.addEventListener\('click',[\s\S]{0,160}showLiveScene\(\)/);
  assert.match(app, /id="liveSceneSyriaNews"/);
  assert.match(app, /id="liveSceneOsint"/);
  assert.match(app, /id="liveSceneMarkets"/);
  assert.match(app, /entry\.append\(region, source, title, published\)/);
  assert.match(app, /entry\.href = href; entry\.target = '_blank'; entry\.rel = 'noopener noreferrer'/);
  assert.match(styles, /\.home-headlines\s*\{[^}]*display: grid/);
  assert.match(styles, /\.live-scene-ticker-item \.live-scene-ticker-time\s*\{[^}]*font-size: 9px/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.home-headlines\s*\{[^}]*grid-template-rows: 20px 30px/);
  assert.match(app, /setInterval\(\(\) => \{ if \(!document\.hidden\) void loadHomeHeadlines\(\); \}, 5 \* 60_000\)/);
});

test('homepage ticker only selects fresh, source-confirmed items with links and publication times', () => {
  const now = Date.parse('2026-11-17T03:00:00Z');
  const recent = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
  const baseItem = {
    title: 'تطور ميداني في سوريا', source: 'BBC News عربي',
    url: 'https://www.bbc.co.uk/arabic/news-123', publishedAt: recent(4),
    region: 'syria', current: true,
  };
  const fresh = normalizeLiveScenePayload({
    updatedAt: recent(2), degraded: false, sourceStatus: { bbc: 'ok', gdelt: 'unavailable' },
    news: [baseItem],
  }, 'ar');
  assert.deepEqual(selectCurrentLiveHeadlines(fresh, now).map((item) => item.title), [baseItem.title]);

  const cachedSource = normalizeLiveScenePayload({
    updatedAt: recent(2), degraded: true, sourceStatus: { bbc: 'cached', gdelt: 'unavailable' },
    news: [{ ...baseItem, current: false }],
  }, 'ar');
  assert.deepEqual(selectCurrentLiveHeadlines(cachedSource, now), [], 'cached upstream headlines are never called current');

  const noSuccessfulSource = normalizeLiveScenePayload({
    updatedAt: recent(2), sourceStatus: { bbc: 'unavailable', gdelt: 'cached' }, news: [baseItem],
  }, 'ar');
  assert.deepEqual(selectCurrentLiveHeadlines(noSuccessfulSource, now), [], 'a current flag alone cannot override failed source status');

  const noSourceMetadata = normalizeLiveScenePayload({ updatedAt: recent(2), news: [baseItem] }, 'ar');
  assert.deepEqual(selectCurrentLiveHeadlines(noSourceMetadata, now), []);

  const stale = normalizeLiveScenePayload({
    updatedAt: recent(21), sourceStatus: { bbc: 'ok' }, news: [baseItem],
  }, 'ar');
  assert.deepEqual(selectCurrentLiveHeadlines(stale, now), [], 'source checks older than the 20-minute limit are suppressed');

  const invalidItems = normalizeLiveScenePayload({
    updatedAt: recent(2), sourceStatus: { bbc: 'ok' }, news: [
      { ...baseItem, publishedAt: recent(25 * 60), url: 'javascript:alert(1)' },
      { ...baseItem, publishedAt: 'not-a-date', url: 'https://bbc.co.uk/article/2' },
      { ...baseItem, source: '' },
    ],
  }, 'ar');
  assert.deepEqual(selectCurrentLiveHeadlines(invalidItems, now), [], 'old, undated, or unattributed items are excluded');
});

test('live-scene ticker runs by default, provides pause/play, and honors reduced motion', () => {
  assert.match(styles, /\.live-scene-ticker-track\s*\{[^}]*animation:\s*live-scene-marquee[^}]*infinite/s);
  assert.doesNotMatch(styles, /\.live-scene-ticker:hover[^}]*animation-play-state:\s*paused/s);
  assert.match(app, /id="liveSceneTickerToggle"[^>]*aria-pressed="false"/);
  assert.match(app, /let paused = Boolean\(reducedMotion\?\.matches\)/);
  assert.match(app, /toggle\.addEventListener\('click',\s*\(\)\s*=>\s*\{\s*paused = !paused; syncMotion\(\);/);
  assert.match(app, /reducedMotion\?\.addEventListener\?\.\('change',[^\n]*paused = event\.matches/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.live-scene-ticker-track\s*\{\s*animation:\s*none/s);
  assert.match(styles, /\.live-scene-ticker\.is-motion-enabled \.live-scene-ticker-track\s*\{\s*animation:\s*live-scene-marquee/s);
  assert.match(styles, /@media\s*\(max-width:\s*767px\)[\s\S]*?\.live-scene-ticker-wrap\s*\{[^}]*margin:\s*10px 10px 0/);
  assert.match(styles, /@media\s*\(max-width:\s*767px\)[\s\S]*?\.live-scene-ticker-item\s*\{[^}]*max-width:\s*74vw/);
  const tickerMarkup = app.match(/<section class="live-scene-ticker-wrap"[\s\S]*?<\/section>/)?.[0] || '';
  assert.ok(tickerMarkup, 'live-scene ticker markup should exist');
  assert.doesNotMatch(tickerMarkup, /aria-live\s*=/, 'ticker content must not be announced as a live region');
  assert.match(styles, /\.modal\.live-scene-shell\s*\{[^}]*width:\s*min\(1080px/);
});
