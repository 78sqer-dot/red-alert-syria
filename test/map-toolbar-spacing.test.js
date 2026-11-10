import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('map toolbar keeps readable separate controls and 44px targets', () => {
  assert.match(css, /\.map-tools\s*\{[^}]*gap: 8px;[^}]*flex-wrap: wrap;/s);
  assert.match(css, /\.map-btn\s*\{[^}]*min-height: 44px;[^}]*min-width: 44px;/s);
  assert.match(css, /\.map-btn svg\s*\{[^}]*width: 18px;[^}]*height: 18px;/s);
  const mobile = css.slice(css.indexOf('@media (max-width: 767px)', css.indexOf('.mobile-ticker { background: var(--bg-card); }')));
  assert.match(mobile, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(mobile, /#btnNotifications\s*\{ grid-column: span 2; \}/);
  assert.match(mobile, /@media \(max-width: 380px\)[\s\S]*gap: 5px;/);
});

test('toolbar identifiers and Al-Nabaa navigation remain unchanged', () => {
  for (const id of ['btnFilter', 'btnLayers', 'btnSvc', 'btnNotifications']) {
    assert.match(html, new RegExp(`<button[^>]*id="${id}"[^>]*type="button"`));
  }
  assert.match(html, /<a[^>]*id="btnNabaa"[^>]*href="\/alnaba\/"/);
});
