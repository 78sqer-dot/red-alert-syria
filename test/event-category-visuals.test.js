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
  assert.equal(eventVisual('breaking').dot, '⚠️');
  assert.equal(eventVisual('breaking').color, '#ef233c', 'the map/category color is unchanged');
  assert.equal(ALERT_TYPES.breaking.emoji, '🚨', 'the event icon is unchanged');
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
  assert.match(map, /--ring:\$\{t\.color\}/, 'the unified pin ring carries the type colour');
  assert.match(map, /const visual = eventVisual\(a\.type\);/);
  assert.match(map, /el\.style\.setProperty\('--c', visual\.color\)/);
  assert.match(map, /color: eventVisual\(a\.type\)\.color, active:/);
  assert.match(map, /const color = eventVisual\('air_movement'\)\.color/);
  assert.match(alertImage, /const color = eventVisual\(type\)\.color/);
  assert.match(alertImage, /const col = eventVisual\(type\)\.color/);
});

test('map relies on built-in RTL shaping instead of the deprecated CSP-incompatible plugin', () => {
  assert.doesNotMatch(map, /getRTLTextPluginStatus|setRTLTextPlugin/);
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

test('governorate labels stay small, uniform, one-line, and localized', () => {
  assert.match(map, /id: 'ras-gov-labels', type: 'symbol', source: 'ras-govs'/);
  assert.ok(map.includes("'text-size': ['interpolate', ['linear'], ['zoom'], 5, 7.5, 8, 8, 11, 9]"));
  assert.ok(map.includes("'text-max-width': 14"), 'the label width preserves a consistent, tidy line');
  assert.ok(map.includes("'text-halo-width': 1.3"), 'the smaller text keeps a slim readable halo');
  assert.ok(map.includes("return lang === 'en' ? ['concat', ['get', 'en'], ' Governorate'] : ['get', 'ar'];"));
});

test('category recoloring preserves readable markers and approved sizes', () => {
  // static markers are the unified pin in both themes: dark roundel, type ring
  assert.match(css, /\.pin \{[^}]*background: rgba\(255,255,255,\.96\); border: 2px solid var\(--ring/);
  assert.match(css, /\.pin svg \{ display: block; width: 20px; height: 20px; \}/);
  assert.match(css, /\.maplibregl-map \.mk-helicopter \{ visibility: visible; \}/);
  assert.match(css, /\.news-off \.mk-helicopter \{ display: block !important; visibility: visible !important; \}/);
  assert.match(css, /\.mk-helicopter \.helicopter-svg, \.mk-helicopter\.sel \.helicopter-svg \{ fill: #13283d; \}/);
  assert.match(css, /\.helicopter-svg \.heli-main-rotor \{[^}]*fill: #203851; stroke: #091a29; stroke-width: 8; opacity: 1;/);
  assert.match(css, /\.helicopter-svg \.heli-tail-rotor \{[^}]*fill: #203851; stroke: #091a29; stroke-width: 8; opacity: 1;/);
  assert.doesNotMatch(css, /\.helicopter-svg \.heli-(?:main-rotor|tail-rotor) \{[^}]*animation:\s*heliRotor/);
  assert.match(css, /\.heli-orbit-guide \{[^}]*border: 1px dashed rgba\(59,142,255,\.4\);[^}]*border-radius: 50%/);
  assert.match(css, /\.mk-breaking-news \.news-pulse-ring \{ width: 34px; height: 34px; border-color: #ef233c/);
  assert.match(map, /glyphDisc\(a\.type, 32, 20, 'pin'/);
  assert.match(css, /\.helicopter-svg \{[^}]*width: 24px; height: 24px/);
});
