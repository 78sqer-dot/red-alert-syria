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
  assert.match(map, /offset: \[0, 0\]/);
  assert.doesNotMatch(map, /off\.y\s*-\s*26/);
  assert.match(map, /if \(p\._alertId \|\| p\._groupKey\)\s*\{[\s\S]{0,250}r\.left \+ r\.width \/ 2 - \(vis\.l \+ vis\.r\) \/ 2[\s\S]{0,180}r\.top \+ r\.height \/ 2 - \(top \+ bottom\) \/ 2/);
  assert.match(map, /this\.schedulePopupFit\(1\)/);
  assert.match(map, /schedulePopupFit\(count = 1\)[\s\S]{0,140}this\.fitPopup\(\)/);
  assert.match(map, /openPopup\(alert\)\s*\{\s*const controlPanel = document\.querySelector\('#mapCtrlPanel'\);[\s\S]{0,180}controlPanel\.hidden = true/);
  assert.match(css, /\.maplibregl-popup\.pp-alert-popup \{ z-index: 60; \}/);
  assert.match(css, /\.pp-alert-popup \.maplibregl-popup-content \{ max-height: min\(62dvh, 600px\); \}/);
  assert.match(css, /\.maplibregl-popup-anchor-bottom \.maplibregl-popup-tip \{ border-top-color: var\(--bg-elevated\); \}/);
  assert.match(css, /\.maplibregl-popup\.pp-alert-popup \.maplibregl-popup-tip \{ opacity: 1/);
  assert.match(css, /\.maplibregl-popup\.pp-alert-popup\.pp-clamped \.maplibregl-popup-tip \{ opacity: 0; visibility: hidden; animation: none !important; \}/);
  assert.match(map, /syncPopupConnector\(pe, ct, moved\)[\s\S]{0,650}this\.map\.project\(this\.popup\.getLngLat\(\)\)/);
  assert.match(map, /if \(x >= r\.left && x <= r\.right && y >= r\.top && y <= r\.bottom\)[\s\S]{0,100}remove\(\)/);
  assert.match(map, /pe\?\._popupConnector\?\.remove\(\)/);
  assert.match(css, /\.pp-popup-connector \{ position: fixed;[^}]*pointer-events: none/);
  assert.match(css, /\.maplibregl-popup\.pp-alert-popup \{ max-width: calc\(100vw - 20px\) !important; \}/);
  assert.match(css, /\.pp-alert-popup \.pp-more, \.pp-alert-popup \.pp-share \{ min-height: 44px/);
  assert.match(css, /\.brand img \{ height: 28px; width: auto; \}/);
  assert.match(css, /\.pp-alert-popup \.pp, \.pp-group-popup \.alert-group-chooser \{[^}]*animation: popupEmergesFromEvent/);
  assert.match(css, /\.maplibregl-popup\.pp-alert-popup \.maplibregl-popup-tip, \.maplibregl-popup\.pp-group-popup \.maplibregl-popup-tip \{[^}]*drop-shadow/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*animation: none !important/);
  assert.match(app, /from '\.\/map\.js\?v=56'/);
});

test('tapping an individual map symbol zooms to its alert and opens details on phones', () => {
  assert.match(map, /selectMarker\(id\)[\s\S]{0,500}if \(group\?\.alerts\.length > 1\) return this\.zoomToGroupChooser\(group\);[\s\S]{0,140}this\.onSelect\(id, \{ fromMap: true, fly: true \}\)/);
  assert.match(map, /if \(fly\) \{[\s\S]{0,600}this\.map\.flyTo\(\{ center: target, zoom: alertFocusZoom/);
  assert.match(map, /if \(popup\) this\.openPopup\(alert\)/);
  assert.match(app, /amap && amap\.select\(shown, \{ fly: fly, popup: true \}\);[\s\S]{0,150}showDetail\(\);[\s\S]{0,120}if \(isMobile\(\)\) setSheetOpen\(false\)/);
});

test('count-marker taps zoom to the group before showing a bottom-anchored chooser on phones', () => {
  assert.match(map, /if \(group\?\.alerts\.length > 1\) return this\.zoomToGroupChooser\(group\)/);
  assert.match(map, /zoomToGroupChooser\(group\)[\s\S]{0,1000}this\.map\.once\('moveend', \(\) => this\.openGroupChooser\(group\)\)[\s\S]{0,180}this\.map\.flyTo/);
  assert.match(map, /className: 'pp-group-popup', anchor: 'bottom', offset: \[0, 0\]/);
  assert.equal((map.match(/if \(!ids\.length \|\| ids\.some\(\(id\) => !liveIds\.has\(String\(id\)\)\)\) this\.closePopup\(\);/g) || []).length, 2);
});

test('group alert popup has accessible previous and next buttons and opens on the selected event', () => {
  assert.match(map, /groupPopupNavigationNode\(nav\)[\s\S]{0,1200}aria-live', 'polite'[\s\S]{0,700}pp-group-next/);
  assert.match(map, /root\?\.querySelector\('\.pp-title'\)[\s\S]{0,100}title\.before\(navNode\)/);
  assert.match(map, /this\.onSelect\(id, \{ fromMap: true, fly: false \}\)/);
  assert.match(css, /\.pp-group-nav button \{[^}]*min-width: 44px; min-height: 40px/);
});

test('general alert pulses are gentler while the legacy blue aircraft pulse remains specialized', () => {
  assert.match(css, /\.zp-fill \{ animation: none; opacity: \.035/);
  assert.match(css, /@keyframes zpulse \{ 0% \{ transform: scale\(1\); opacity: \.27; \} 100% \{ transform: scale\(1\.65\); opacity: 0; \} \}/);
  assert.match(css, /\.zp\.zp-aircraft::before, \.zp\.zp-aircraft::after[\s\S]{0,230}animation: zpulseAircraft 2\.6s/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
