import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/css/app.css', import.meta.url), 'utf8');
const mapJs = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
const appJs = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');

test('drone marker resumes its original circular flight at zoom 11', () => {
  assert.match(css, /\.maplibregl-map\.zoom-detail \.uav\s*\{\s*animation:\s*uavOrbit 9s linear infinite;\s*\}/);
  assert.doesNotMatch(css, /uavHover/);
  assert.match(mapJs, /classList\.toggle\('zoom-detail', z >= 11\)/);
  assert.match(mapJs, /if \(z < 11\) continue;/);
  assert.match(mapJs, /if \(z >= 11 && this\.sats\)/);
  assert.match(mapJs, /Math\.max\(8, Math\.min\(12, Math\.round\(\(o\.km \* 1000\) \/ mpp\)\)\)/);
});

test('selecting a drone focuses its primary circle at visible zoom, including map-circle taps', () => {
  assert.match(mapJs, /if \(fly && \['uav', 'uav_strike'\]\.includes\(alert\.type\)\)/);
  assert.match(mapJs, /zoom: Math\.max\(this\.map\.getZoom\(\), 11\.5\)/);
  assert.match(appJs, /fly \|\| \['uav', 'uav_strike'\]\.includes\(a\.type\)/);
});

test('helicopter airframe is compact while its orbit stays unscaled', () => {
  assert.match(css, /\.mk-helicopter \.mk-s\s*\{\s*transform:\s*none;\s*\}/);
  assert.match(css, /\.heli-craft\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/);
  assert.match(css, /\.helicopter-svg\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/);
  assert.match(mapJs, /svgTag\(t\.glyph,\s*24,\s*`fill=/);
});
