import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/css/app.css', import.meta.url), 'utf8');
const mapJs = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');

test('drone marker resumes its circular flight at detailed zoom', () => {
  assert.match(css, /\.maplibregl-map\.zoom-detail \.uav\s*\{\s*animation:\s*uavOrbit 9s linear infinite;\s*\}/);
  assert.doesNotMatch(css, /uavHover/);
  assert.match(mapJs, /classList\.toggle\('zoom-detail', z >= 10\.5\)/);
  assert.match(mapJs, /if \(z < 10\.5\) continue;/);
  assert.match(mapJs, /if \(z >= 10\.5 && this\.sats\)/);
});

test('helicopter airframe is compact while its orbit stays unscaled', () => {
  assert.match(css, /\.mk-helicopter \.mk-s\s*\{\s*transform:\s*none;\s*\}/);
  assert.match(css, /\.heli-craft\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/);
  assert.match(css, /\.helicopter-svg\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/);
  assert.match(mapJs, /svgTag\(t\.glyph,\s*24,\s*`fill=/);
});
