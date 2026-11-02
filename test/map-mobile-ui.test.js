import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const html = read('public/index.html');
const app = read('public/js/app.js');
const map = read('public/js/map.js');
const css = read('public/css/app.css');

test('map tools are grouped accessibly and the Syria overview remains a separate button', () => {
  assert.match(html, /id="mapControlsToggle"[^>]*aria-expanded="false"[^>]*aria-controls="mapCtrlPanel"/);
  const panel = html.match(/<div class="map-ctrl-panel" id="mapCtrlPanel"[\s\S]*?<\/div>/)?.[0];
  assert.ok(panel, 'a collapsed map-tools panel must exist');
  for (const id of ['zoomIn', 'zoomOut', 'locateMe', 'shareSite']) assert.match(panel, new RegExp(`id="${id}"`));
  assert.doesNotMatch(panel, /id="resetView"/);
  assert.match(html, /id="resetView"[^>]*type="button"/);
  assert.match(app, /setAttribute\('aria-expanded', String\(open\)\)/);
  assert.match(app, /e\.key !== 'Escape'[^\n]*[\s\S]{0,100}setMapControlsOpen\(false\)/);
});

test('alert details stay centered on the map and their popup tip points to the event on every screen', () => {
  assert.doesNotMatch(map, /cls: 'alert-dock'/);
  assert.match(map, /new M\.Popup\(\{ className: 'pp-alert-popup', anchor: 'bottom'/);
  assert.match(map, /offset: \{ bottom: \[off\.x, off\.y\]/);
  assert.doesNotMatch(map, /offset: \{ bottom: \[off\.x, off\.y\s*-\s*26/);
  assert.match(map, /if \(p\._alertId\)\s*\{[\s\S]{0,250}r\.left \+ r\.width \/ 2 - \(vis\.l \+ vis\.r\) \/ 2[\s\S]{0,180}r\.top \+ r\.height \/ 2 - \(top \+ bottom\) \/ 2/);
  assert.match(map, /openPopup\(alert\)\s*\{\s*const controlPanel = document\.querySelector\('#mapCtrlPanel'\);[\s\S]{0,180}controlPanel\.hidden = true/);
  assert.match(css, /\.maplibregl-popup\.pp-alert-popup \{ z-index: 60; \}/);
  assert.match(css, /\.pp-alert-popup \.maplibregl-popup-content \{ max-height: min\(62dvh, 600px\); \}/);
  assert.match(css, /\.maplibregl-popup-anchor-bottom \.maplibregl-popup-tip \{ border-top-color: var\(--bg-elevated\); \}/);
  assert.match(css, /\.maplibregl-popup\.pp-alert-popup \.maplibregl-popup-tip \{ opacity: 1/);
  assert.match(css, /\.maplibregl-popup\.pp-alert-popup \{ max-width: calc\(100vw - 20px\) !important; \}/);
  assert.match(css, /\.pp-alert-popup \.pp-more, \.pp-alert-popup \.pp-share \{ min-height: 44px/);
  assert.match(css, /\.brand img \{ height: 28px; width: auto; \}/);
});

test('general alert pulses are gentler while the legacy blue aircraft pulse remains specialized', () => {
  assert.match(css, /\.zp-fill \{ animation: none; opacity: \.035/);
  assert.match(css, /@keyframes zpulse \{ 0% \{ transform: scale\(1\); opacity: \.27; \} 100% \{ transform: scale\(1\.65\); opacity: 0; \} \}/);
  assert.match(css, /\.zp\.zp-aircraft::before, \.zp\.zp-aircraft::after[\s\S]{0,230}animation: zpulseAircraft 2\.6s/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
