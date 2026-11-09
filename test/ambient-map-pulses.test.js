import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
const map = readFileSync(new URL('../public/js/map.js', import.meta.url), 'utf8');

test('map ambience has exactly two decorative, non-interactive pulse markers', () => {
  const layer = html.match(/<div class="ambient-pulse-layer"[^>]*>(.*?)<\/div>/s)?.[1] || '';
  assert.equal((layer.match(/class="ambient-pulse /g) || []).length, 2);
  assert.match(html, /class="ambient-pulse-layer" aria-hidden="true"/);
  assert.match(css, /\.ambient-pulse-layer \{[^}]*z-index: 0;[^}]*pointer-events: none;/);
  assert.match(css, /\.ambient-pulse::before, \.ambient-pulse::after[^}]*animation: ambientPulse/);
});

test('pulse layer is moved into MapLibre canvas before DOM markers are rendered', () => {
  const movePulseAt = map.indexOf('if (pulseLayer && canvasContainer) canvasContainer.appendChild(pulseLayer);');
  const renderMarkersAt = map.indexOf('this.ready = true;\n    this.render();', movePulseAt);
  assert.ok(movePulseAt >= 0, 'map initialization should reparent the pulse layer into the canvas container');
  assert.ok(renderMarkersAt > movePulseAt, 'the pulse layer must be in place before render creates marker elements');
});

test('ambient map pulses remain still and visible for users who request reduced motion', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.ambient-pulse::before, \.ambient-pulse::after \{ animation: none; opacity: \.12;/);
});
