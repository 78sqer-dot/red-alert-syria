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
  assert.equal(appBuild, '38', 'HTML must request the fresh app build to update installed PWA users');
  assert.match(index, /css\/app\.css\?v=29/);
  assert.match(app, /settings\.js\?v=4/);
  assert.match(app, /map\.js\?v=44/);
  assert.match(app, /shared\/types\.js\?v=24/);
  assert.match(settings, /shared\/types\.js\?v=24/);
  assert.match(map, /shared\/types\.js\?v=24/);
  assert.match(map, /target-svgs\.js\?v=8/);
  assert.match(map, /icons\.js\?v=3/);
  assert.match(map, /type-icons\.js\?v=1/);
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
