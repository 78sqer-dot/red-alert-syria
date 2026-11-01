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

test('phone alert details use a safe-area-aware bottom sheet with usable actions', () => {
  assert.match(map, /if \(this\.dockMode\(\)\)\s*\{\s*this\.popup = this\.openDockHtml\(this\.popupHtml\(alert\)[\s\S]{0,130}cls: 'alert-dock'/);
  assert.match(map, /env\(safe-area-inset-bottom, 0px\)/);
  assert.match(css, /\.pp-dock\.alert-dock[\s\S]{0,260}max-height: min\(58dvh, 520px\)/);
  assert.match(css, /\.pp-dock\.alert-dock \.pp-more, \.pp-dock\.alert-dock \.pp-share \{ min-height: 44px/);
  assert.match(css, /\.brand img \{ height: 28px; width: auto; \}/);
});

test('general alert pulses are gentler while the legacy blue aircraft pulse remains specialized', () => {
  assert.match(css, /\.zp-fill \{ animation: none; opacity: \.035/);
  assert.match(css, /@keyframes zpulse \{ 0% \{ transform: scale\(1\); opacity: \.27; \} 100% \{ transform: scale\(1\.65\); opacity: 0; \} \}/);
  assert.match(css, /\.zp\.zp-aircraft::before, \.zp\.zp-aircraft::after[\s\S]{0,230}animation: zpulseAircraft 2\.6s/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
