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
  assert.match(mapJs, /svgTag\(t\.glyph,\s*24,\s*'class="uav-svg"'\)/);
  assert.match(css, /\.uav-svg\s*\{\s*stroke: rgba\(255,255,255,\.94\);\s*stroke-width: 18;/);
});

test('drone is hidden with impact circles alone at country zoom and orbits at detail zoom', () => {
  assert.match(css, /\.maplibregl-map \.mk-orbit:not\(\.mk-sat\) \.uav\s*\{\s*animation: uavOrbit 9s linear infinite;/);
  assert.match(css, /\.maplibregl-map:not\(\.zoom-detail\) \.mk-orbit:not\(\.mk-sat\) \.uav\s*\{\s*visibility: hidden;/);
  assert.match(css, /\.maplibregl-map\.zoom-detail \.mk-orbit:not\(\.mk-sat\) \.uav\s*\{\s*visibility: visible;/);
  assert.match(css, /\.maplibregl-map:not\(\.zoom-detail\) \.mk-orbit\.mk-sat\s*\{\s*visibility: hidden;/);
  assert.doesNotMatch(css, /uavHover/);
  assert.match(mapJs, /classList\.toggle\('zoom-detail', z >= 10\.5\)/);
  assert.match(mapJs, /const px = Math\.max\(z < 10\.5 \? 12 : 10, Math\.round\(\(o\.km \* 1000\) \/ mpp\)\)/);
  assert.doesNotMatch(mapJs, /Math\.min\(12, Math\.round\(\(o\.km \* 1000\) \/ mpp\)\)/);
  assert.match(mapJs, /if \(z >= 10\.5 && this\.sats\)/);
});

test('helicopter uses a 24px airframe in its existing 25px orbit container', () => {
  assert.match(css, /\.mk-helicopter \.mk-s\s*\{\s*transform:\s*none;\s*\}/);
  assert.match(css, /\.heli-craft\s*\{[^}]*width:\s*25px;[^}]*height:\s*25px;/);
  assert.match(css, /\.helicopter-svg\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*fill:\s*#6b7280;/);
  assert.match(targetSvgs, /helicopter_simple:[\s\S]{0,220}heli-main-rotor[\s\S]{0,140}M40 246a10 10 0 0 1 0-20/);
  assert.match(mapJs, /svgTag\(t\.glyph,\s*24,\s*`fill=/);
});

test('helicopter uses the simplified silhouette while legacy glyphs remain available', () => {
  assert.match(types, /helicopter:\s*\{[\s\S]*?glyph: 'helicopter_simple'/);
  assert.match(targetSvgs, /helicopter_simple:\s*'<g[\s\S]*?heli-main-rotor[\s\S]*?heli-tail-rotor/);
  assert.match(targetSvgs, /helicopter_topdown:\s*'<g[\s\S]*?heli-main-rotor[\s\S]*?heli-tail-rotor/);
  assert.match(targetSvgs, /helicopter_sleek:\s*'<g[\s\S]*?heli-main-rotor[\s\S]*?heli-tail-rotor/);
  assert.match(targetSvgs, /helicopter:\s*'<g[\s\S]*?heli-main-rotor[\s\S]*?heli-tail-rotor/);
});

test('schematic movement stays anchored to the report, reverses withdrawal and never fabricates a route', () => {
  assert.match(mapJs, /const position = \[alert\.location\.longitude, alert\.location\.latitude\]/);
  assert.match(mapJs, /track\.marker\.setLngLat\(position\)/);
  assert.match(mapJs, /const heading = alert\.flight_direction === 'leaving_syria' \? 180 : 0/);
  assert.match(mapJs, /track\.marker\.setRotation\(heading\)/);
  assert.match(mapJs, /source\.setData\(\{ type: 'FeatureCollection', features: \[\] \}\)/);
  assert.match(mapJs, /&& Number\.isFinite\(a\.location\?\.latitude\) && Number\.isFinite\(a\.location\?\.longitude\)/);
  assert.match(css, /\.map-flight-track-marker\.is-plane \.map-flight-track-svg \{ transform: rotate\(-45deg\); \}/);
});
