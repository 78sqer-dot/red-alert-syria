import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
