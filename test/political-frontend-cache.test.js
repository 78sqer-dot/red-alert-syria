import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const index = read('public/index.html');
const app = read('public/js/app.js');
const settings = read('public/js/settings.js');
const map = read('public/js/map.js');
const css = read('public/css/app.css');
const types = read('shared/types.js');

test('fresh PWA and module-graph versions load updated map and firearm glyphs', () => {
  const appBuild = index.match(/\/js\/app\.js\?v=(\d+)/)?.[1];
  assert.equal(appBuild, '42', 'HTML must request the fresh app build to update installed PWA users');
  assert.match(index, /css\/app\.css\?v=30/);
  assert.match(app, /settings\.js\?v=7/);
  assert.match(app, /i18n\.js\?v=2/);
  assert.match(app, /map\.js\?v=48/);
  assert.match(app, /shared\/types\.js\?v=28/);
  assert.match(settings, /shared\/types\.js\?v=28/);
  assert.match(map, /shared\/types\.js\?v=28/);
  assert.match(map, /target-svgs\.js\?v=11/);
  assert.match(map, /flight-path\.js\?v=2/);
  assert.match(app, /icons\.js\?v=4/);
  assert.match(map, /icons\.js\?v=4/);
  assert.match(map, /type-icons\.js\?v=3/);
});

test('political map icon uses its configured 25px size', () => {
  const politicalType = types.match(/political:\s*\{([^}]+)\}/)?.[1];
  assert.ok(politicalType, 'political alert type must be defined');
  assert.match(politicalType, /\bsize:\s*25\b/);
  assert.match(map, /const sz = t\.size \|\| 30;[\s\S]{0,140}svgTag\(glyph, sz,/);
});

test('map flight selection plays a brief event-colored arrival ripple and respects reduced motion', () => {
  assert.match(map, /if \(fly\) this\._playArrival\(alert\.id\)/);
  assert.match(css, /\.mk\.focus-arrival::after/);
  assert.match(css, /@keyframes mapArrivalRipple/);
  assert.match(css, /prefers-reduced-motion:\s*reduce\)\s*\{\s*\.mk\.focus-arrival::after\s*\{\s*animation:\s*none/);
});
