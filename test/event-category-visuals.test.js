import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ALERT_TYPES, EVENT_VISUALS, eventVisual } from '../shared/types.js';
import { markerSvg } from '../server/alert-image.js';

const map = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/css/app.css', import.meta.url), 'utf8');
const alertImage = await readFile(new URL('../server/alert-image.js', import.meta.url), 'utf8');

test('every alert type receives one shared color-dot category visual', () => {
  assert.deepEqual(Object.keys(EVENT_VISUALS).sort(), Object.keys(ALERT_TYPES).sort());
  assert.deepEqual(
    [...new Set(Object.values(EVENT_VISUALS).map(({ category }) => category))].sort(),
    ['aerial', 'breaking', 'civil', 'political', 'quake', 'security', 'strikes', 'weather'],
  );
  assert.equal(eventVisual('breaking').dot, '🔴');
  assert.equal(eventVisual('weather').dot, '🟣');
  assert.equal(eventVisual('political').dot, '🟡');
  assert.equal(eventVisual('uav').dot, '🔵');
  assert.equal(eventVisual('airstrike').dot, '🟠');
  assert.equal(eventVisual('civil').dot, '🟢');
  assert.equal(eventVisual('quake').dot, '🟤');
  assert.equal(eventVisual('military_incursion').dot, '⚫');
  for (const [type, visual] of Object.entries(EVENT_VISUALS)) {
    assert.match(visual.color, /^#[0-9a-f]{6}$/i, `${type} has a CSS-safe color`);
    assert.ok(visual.dot, `${type} has a category dot`);
  }
});

test('live map icons, markers and impact-zone pulses use the same category color', () => {
  assert.match(map, /const visual = eventVisual\(type\);[\s\S]{0,100}const fg = visual\.color/);
  assert.match(map, /const visual = eventVisual\(a\.type\);/);
  assert.match(map, /el\.style\.setProperty\('--c', visual\.color\)/);
  assert.match(map, /color: eventVisual\(a\.type\)\.color, active:/);
  assert.match(map, /const color = eventVisual\('air_movement'\)\.color/);
  assert.match(alertImage, /const color = eventVisual\(type\)\.color/);
  assert.match(alertImage, /const col = eventVisual\(type\)\.color/);
});

test('server-rendered map markers use category colors and keep urgent black inside a red triangle', () => {
  const aerial = markerSvg('uav', 100, 100);
  assert.ok(aerial.includes(`fill="${eventVisual('uav').color}"`));
  const weather = markerSvg('weather', 100, 100);
  assert.ok(weather.includes(`fill="${eventVisual('weather').color}"`));
  const urgent = markerSvg('breaking', 100, 100);
  assert.ok(urgent.includes('d="M12 1.3 23.2 21H.8Z" fill="#ef233c"'));
  assert.ok(urgent.includes('d="m12 6.1-7.2 12.7h14.4Z" fill="#000000"'));
  assert.equal((urgent.match(/fill="#000000"/g) || []).length, 1, 'black is used only for the triangle interior');
});

test('category recoloring preserves readable light/dark markers and approved sizes', () => {
  assert.match(css, /\.sai\.map-event-disc \{[^}]*background: #fff !important/);
  assert.match(css, /\.ic \{[^}]*background: #fff/);
  assert.match(css, /html\.dark \.ic-svg \{[^}]*drop-shadow/);
  assert.match(css, /html\.dark \.helicopter-svg \{ fill: color-mix/);
  assert.match(css, /\.mk-breaking-news \.news-marker-svg \{ width: 15px; height: 15px/);
  assert.match(css, /\.mk-breaking-news \.news-pulse-ring \{ width: 34px; height: 34px; border-color: #ef233c/);
  assert.match(map, /glyphDisc\(a\.type, 34, 24, 'sai map-event-disc'/);
  assert.match(css, /\.ic-svg \{[^}]*width: 24px; height: 24px/);
  assert.match(map, /const helicopterScale = Math\.max\(1, Math\.min\(1\.34, 1 \+ \(z - 9\) \* 0\.08\)\)/);
});
