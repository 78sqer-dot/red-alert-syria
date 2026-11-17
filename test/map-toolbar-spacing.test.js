import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../public/js/i18n.js', import.meta.url), 'utf8');
const icons = readFileSync(new URL('../public/js/icons.js', import.meta.url), 'utf8');
const panelStart = html.indexOf('<div class="map-ctrl-panel" id="mapCtrlPanel"');
const panelEnd = html.indexOf('\n          </div>\n        </div>', panelStart);
const panel = panelStart >= 0 && panelEnd > panelStart ? html.slice(panelStart, panelEnd) : '';

test('top map-tools button opens one accessible panel with all requested tools', () => {
  assert.match(html, /id="mapControlsToggle"[^>]*aria-expanded="false"[^>]*aria-controls="mapCtrlPanel"/);
  assert.match(css, /\.map-ctrls \{ position: absolute; top: 12px; bottom: auto; inset-inline-start: 12px;/);
  assert.match(css, /\.map-ctrl-panel \{ position: absolute; top: calc\(100% \+ 9px\); bottom: auto;/);
  assert.ok(panel, 'the full map-tools panel should be present');
  for (const id of ['btnFilter', 'btnLayers', 'btnSvc', 'btnNabaa', 'btnNotifications', 'zoomIn', 'zoomOut', 'locateMe', 'shareSite']) {
    assert.match(panel, new RegExp(`id="${id}"`), `${id} belongs in the tools panel`);
  }
  assert.doesNotMatch(panel, /id="resetView"/);
  assert.match(html, /id="resetView"[^>]*type="button"/);
  assert.match(css, /\.map-tool-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.map-tool-grid > #btnNotifications \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /\.map-tool-grid > \.dd > \.map-btn, \.map-tool-grid > \.map-btn \{[^}]*min-height: 44px/);
  assert.match(html, /class="map-tools-icon" data-icon="panelStack"/);
  assert.match(icons, /panelStack: \{ filled: false, body: "<path[^\n]*<rect x=\\"4\\" y=\\"9\\" width=\\"15\\" height=\\"12\\" rx=\\"3\\"/);
  assert.match(css, /\.map-ctrls > \.ctrl-btn, \.map-ctrl-panel \.ctrl-btn \{ width: 42px; height: 42px;/);
  assert.match(css, /\.map-ctrls > \.ctrl-btn:hover, \.map-ctrl-panel \.ctrl-btn:hover \{ transform: translateY\(-2px\)/);
  assert.doesNotMatch(css, /\.map-tools\s*\{/);
});

test('Syria overview is a bottom-row action beside the Red Alert Syria map label, not part of tools', () => {
  const bottom = html.match(/<div class="map-bottom-controls">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.ok(bottom);
  assert.match(bottom, /id="resetView"[\s\S]*?id="aboutPill"/);
  assert.match(css, /\.map-bottom-controls \{ position: absolute;[^}]*display: flex; align-items: center; gap: 8px/);
  assert.match(css, /\.reset-view-btn \{ width: 40px; height: 40px; flex: none;/);
});

test('filter and layer panels, services, and Al-Nabaa return to the map tools reliably', () => {
  assert.match(app, /data-dd-close/);
  assert.match(app, /T\.backToTools/);
  assert.ok(i18n.includes("backToTools: 'العودة إلى أدوات الخريطة'"));
  assert.ok(i18n.includes("backToTools: 'Back to map tools'"));
  assert.match(app, /returnToToolsAfterService = true/);
  assert.match(app, /if \(!svc\?\.mode\?\.\(\)\) \{ setMapControlsOpen\(true\)/);
  assert.match(app, /sessionStorage\.setItem\('ras:return-map-tools', '1'\)/);
  assert.match(app, /window\.addEventListener\('pageshow', restoreMapTools\)/);
  assert.match(css, /\.dd-panel\.dd-sheet \{ position: fixed;/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*?\.map-ctrl-panel \{ width: min\(370px, calc\(100vw - 20px\)\); max-height: min\(70dvh, calc\(100dvh - 105px\)\)/);
});
