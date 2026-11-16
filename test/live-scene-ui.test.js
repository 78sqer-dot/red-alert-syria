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

test('ticker animation pauses on interaction and respects reduced-motion settings', () => {
  assert.match(styles, /@keyframes live-scene-marquee/);
  assert.match(styles, /live-scene-ticker:hover[^\{]*live-scene-ticker-track[^\{]*\{[^}]*animation-play-state: paused/s);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.live-scene-ticker-track\s*\{\s*animation:\s*none/s);
  assert.match(styles, /\.modal\.live-scene-shell\s*\{[^}]*width:\s*min\(1080px/);
});
