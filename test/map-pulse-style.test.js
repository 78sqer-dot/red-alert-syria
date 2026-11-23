import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const map = readFileSync(new URL('../public/js/map.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('alert pulse ring stays small and red regardless of event category', () => {
  const pulse = css.match(/\.news-pulse-ring\s*\{[^}]*\}/)?.[0] || '';
  assert.match(pulse, /width: 25px; height: 25px/);
  assert.match(pulse, /border: 1\.4px solid #ef233c/);
  assert.match(pulse, /background: color-mix\(in srgb, #ef233c 5%, transparent\)/);
  assert.match(pulse, /box-shadow:[^;]*#ef233c/);
  assert.doesNotMatch(pulse, /var\(--c/);
  assert.match(css, /\.news-pulse-ring::after\s*\{[^}]*#ef233c 34%, transparent/);
  assert.match(css, /@keyframes newsPulseGlow\s*\{[^}]*#ef233c/);
  assert.match(css, /prefers-reduced-motion: reduce[^\n]*#ef233c/);
});

test('alert counter remains smoked-glass translucent and uses Western digits', () => {
  const count = css.match(/\.mk-count\s*\{[^}]*\}/)?.[0] || '';
  assert.match(count, /background: color-mix\(in srgb, #141A24 55%, transparent\)/);
  assert.match(map, /badge\.textContent = String\(count\);/);
});

test('pulse tap continues to select and focus the original alert without replacing its event symbol', () => {
  assert.match(map, /this\.bindMarkerTap\(el, \(\) => this\.onSelect\(alert\.id, \{ fromMap: true, fly: true \}\)\)/);
  assert.match(map, /eventVisual\(a\.type, a\)\.color/);
  assert.match(map, /this\.onSelect\(alert\.id, \{ fromMap: true, fly: true \}\)/);
});

test('choosing the alert still opens its existing details using the stored alert content', () => {
  assert.match(app, /function select\(id, \{ fromMap = false, fly = true, popupOnly = false \} = \{\}\) \{[\s\S]*?state\.selectedId = id;[\s\S]*?amap && amap\.select\(shown, \{ fly: fly, popup: true \}\);[\s\S]*?showDetail\(\);/);
  assert.match(app, /function renderDetail\(\) \{[\s\S]*?const a = state\.alerts\.get\(state\.selectedId\);[\s\S]*?\$\('#detailBody'\)\.innerHTML = detailHtml\(shown\);/);
});

test('updated stylesheet is requested with a new cache-busting version', () => {
  assert.match(html, /href="\/css\/app\.css\?v=102"/);
});


test('reference news uses ordinary icons and a bounded small pulse, never a coverage disc', () => {
  assert.match(map, /if \(a.location_display === 'approximate_point'\)/);
  assert.match(map, /mk-reference-news/);
  assert.doesNotMatch(map, /width:144px;height:144px/);
  assert.match(css, /\.mk-reference-news \.news-pulse-ring \{ width:24px; height:24px/);
  assert.match(css, /@keyframes referenceNewsPulse/);
  assert.match(css, /scale\(1\.35\); opacity:0/);
});
