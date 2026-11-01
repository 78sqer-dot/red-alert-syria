import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/css/app.css', import.meta.url), 'utf8');
const mapJs = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
const markerSvgs = await readFile(new URL('../public/js/marker-svgs.js', import.meta.url), 'utf8');
const types = await readFile(new URL('../shared/types.js', import.meta.url), 'utf8');
const targetSvgs = await readFile(new URL('../public/js/target-svgs.js', import.meta.url), 'utf8');

test('drone keeps the original top-down silhouette, fixed icon size and perimeter orbit', () => {
  assert.match(types, /uav:\s*\{[\s\S]*?glyph: 'uav'/);
  assert.ok(markerSvgs.includes('"uav": "<g> <ellipse cx=\\"256\\" cy=\\"256\\" rx=\\"18\\" ry=\\"140\\" />'));
  assert.match(mapJs, /svgTag\(t\.glyph,\s*20,\s*'class="uav-svg"'\)/);
  assert.match(css, /\.uav-svg\s*\{\s*stroke: rgba\(255,255,255,\.94\);\s*stroke-width: 18;/);
});

test('drone marker resumes its circular flight at detailed zoom', () => {
  assert.match(css, /\.maplibregl-map\.zoom-detail \.uav\s*\{\s*animation:\s*uavOrbit 9s linear infinite;\s*\}/);
  assert.doesNotMatch(css, /uavHover/);
  assert.match(mapJs, /classList\.toggle\('zoom-detail', z >= 10\.5\)/);
  assert.match(mapJs, /if \(z < 10\.5\) continue;\s*\/\/ Match the visible circle's radius exactly; do not keep the drone orbit near its center\.\s*const px = Math\.max\(10, Math\.round\(\(o\.km \* 1000\) \/ mpp\)\);/);
  assert.doesNotMatch(mapJs, /Math\.min\(12, Math\.round\(\(o\.km \* 1000\) \/ mpp\)\)/);
  assert.match(mapJs, /if \(z >= 10\.5 && this\.sats\)/);
});

test('helicopter airframe is 25px while its orbit stays unscaled', () => {
  assert.match(css, /\.mk-helicopter \.mk-s\s*\{\s*transform:\s*none;\s*\}/);
  assert.match(css, /\.heli-craft\s*\{[^}]*width:\s*25px;[^}]*height:\s*25px;/);
  assert.match(css, /\.helicopter-svg\s*\{[^}]*width:\s*25px;[^}]*height:\s*25px;/);
  assert.match(mapJs, /svgTag\(t\.glyph,\s*25,\s*`fill=/);
});

test('helicopter uses a smooth alternate silhouette while the original glyph remains available', () => {
  assert.match(types, /helicopter:\s*\{[\s\S]*?glyph: 'helicopter_sleek'/);
  assert.match(targetSvgs, /helicopter_sleek:\s*'<g[\s\S]*?heli-main-rotor[\s\S]*?heli-tail-rotor/);
  assert.match(targetSvgs, /helicopter:\s*'<g[\s\S]*?heli-main-rotor[\s\S]*?heli-tail-rotor/);
  assert.match(mapJs, /setRotation\(aircraftRotation\(aircraft, pos\.bearing\)\)/);
});
