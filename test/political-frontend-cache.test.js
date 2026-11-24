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

test('PWA and module graph request versioned assets for current map and firearm glyphs', () => {
  const appBuild = index.match(/\/js\/app\.js\?v=(\d+)/)?.[1];
  assert.ok(Number(appBuild) > 48, 'HTML must request a newer app build to update installed PWA users');
  assert.match(index, /\/css\/app\.css\?v=\d+/);
  assert.match(app, /settings\.js\?v=\d+/);
  assert.match(app, /i18n\.js\?v=\d+/);
  assert.match(app, /map\.js\?v=\d+/);
  assert.match(app, /shared\/types\.js\?v=\d+/);
  assert.match(app, /push-subscription\.js\?v=\d+/);
  assert.match(settings, /shared\/types\.js\?v=\d+/);
  assert.match(map, /shared\/types\.js\?v=\d+/);
  assert.match(map, /shared\/map-motion\.js\?v=\d+/);
  assert.match(map, /target-svgs\.js\?v=\d+/);
  assert.doesNotMatch(map, /flightPosition\(path/, 'CSS flight cues must not invent a geographic track');
  assert.match(app, /icons\.js\?v=\d+/);
  assert.match(map, /icons\.js\?v=\d+/);
  assert.match(map, /type-icons\.js\?v=\d+/);
});

test('political map icon uses the shared 24px map size without mutating its other display configuration', () => {
  const politicalType = types.match(/political:\s*\{([^}]+)\}/)?.[1];
  assert.ok(politicalType, 'political alert type must be defined');
  assert.match(politicalType, /\bsize:\s*25\b/);
  assert.match(map, /const sz = 24;[\s\S]{0,420}svgTag\(glyph, sz,/);
});

test('map flight selection plays a brief event-colored arrival ripple and respects reduced motion', () => {
  assert.match(map, /if \(fly\) this\._playArrival\(alert\.id\)/);
  assert.match(css, /\.mk\.focus-arrival::after/);
  assert.match(css, /@keyframes mapArrivalRipple/);
  assert.match(css, /prefers-reduced-motion:\s*reduce\)\s*\{\s*\.mk\.focus-arrival::after\s*\{\s*animation:\s*none/);
});
