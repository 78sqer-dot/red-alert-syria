import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { markerTapMatchesMapClick } from '../public/js/map-click-guard.js';

const map = readFileSync(new URL('../public/js/map.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');

test('marker tap suppresses the MapLibre click echo at the same point', () => {
  const tap = { x: 296, y: 258, at: 1000 };
  assert.equal(markerTapMatchesMapClick(tap, { x: 296, y: 258 }, 1100), true);
  assert.equal(markerTapMatchesMapClick(tap, { x: 306, y: 258 }, 1100), true);
  assert.equal(markerTapMatchesMapClick(tap, { x: 320, y: 258 }, 1100), false);
});

test('a separate, stale, or malformed map click is not suppressed', () => {
  const tap = { x: 296, y: 258, at: 1000 };
  assert.equal(markerTapMatchesMapClick(tap, { x: 333, y: 258 }, 1100), false);
  assert.equal(markerTapMatchesMapClick(tap, { x: 296, y: 258 }, 1281), false);
  assert.equal(markerTapMatchesMapClick(tap, { x: 296, y: 258 }, 999), false);
  assert.equal(markerTapMatchesMapClick(tap, { x: NaN, y: 258 }, 1100), false);
  assert.equal(markerTapMatchesMapClick(null, { x: 296, y: 258 }, 1100), false);
});

test('map markers and pulse rings explicitly focus the selected alert', () => {
  assert.match(map, /this\.onSelect\(group \? nextAlertId\(group, this\.selectedId\) : id, \{ fromMap: true, fly: true \}\)/);
  assert.match(map, /return this\.onSelect\(hit\.id, \{ fromMap: true, fly: true \}\)/);
  assert.match(css, /\.mk::before\s*\{[^}]*width: 56px; height: 56px;[^}]*pointer-events: auto;/);
  assert.match(map, /t\.ring \|\| t\.color/);
});

test('moving aircraft paths are clickable and keyboard accessible, with a visible selected ring', () => {
  assert.match(map, /el\.setAttribute\('role', 'button'\)[\s\S]*?this\.bindMarkerTap\(el, \(\) => this\.onSelect\(alert\.id/);
  assert.match(map, /e\.key !== 'Enter' && e\.key !== ' '/);
  assert.match(map, /el\.classList\.toggle\('zp-selected', !!p\.selected\)/);
  assert.match(css, /\.map-flight-track-marker\s*\{[^}]*pointer-events: auto;/);
  assert.match(css, /\.zp\.zp-selected::before/);
});
