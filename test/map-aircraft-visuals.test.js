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
  assert.match(mapJs, /const svgClass = signalDrone \? 'signal-sweep-uav-svg' : 'uav-svg'/);
  assert.match(mapJs, /svgTag\(glyph,\s*24,\s*`class="\$\{svgClass\}"`\)/);
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

test('helicopter starts at 18px, scales with zoom and follows its alert perimeter', () => {
  assert.match(css, /\.mk-helicopter \.mk-s\s*\{\s*transform:\s*none;\s*\}/);
  assert.match(css, /\.heli-craft\s*\{[^}]*scale\(var\(--heli-scale, 1\)\)[^}]*transition: transform \.18s ease-out/);
  assert.match(css, /\.helicopter-svg\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*fill:\s*var\(--c, #3b8eff\);/);
  assert.match(mapJs, /const helicopterScale = Math\.max\(1, Math\.min\(1\.34, 1 \+ \(z - 9\) \* 0\.08\)\)/);
  assert.match(mapJs, /svgTag\(t\.glyph,\s*18,\s*`fill=/);
  assert.match(css, /\.heli-orbit\s*\{[^}]*animation:\s*heliOrbit 12s linear infinite/);
  assert.match(mapJs, /actual visible perimeter of its alert circle[\s\S]{0,180}setProperty\('--orb', px \+ 'px'\)/);
  assert.match(mapJs, /el\.insertAdjacentHTML\('afterbegin', '<span class="news-pulse-ring"/);
  assert.doesNotMatch(css, /\.heli-orbit::(?:before|after)/, 'the helicopter must not gain decorative orbit rings');
  assert.match(targetSvgs, /helicopter_simple:[\s\S]{0,220}heli-main-rotor[\s\S]{0,140}M40 246a10 10 0 0 1 0-20/);
});

test('helicopter uses the simplified silhouette while legacy glyphs remain available', () => {
  assert.match(types, /helicopter:\s*\{[\s\S]*?glyph: 'helicopter_simple'/);
  assert.match(targetSvgs, /helicopter_simple:\s*'<g[\s\S]*?heli-main-rotor[\s\S]*?heli-tail-rotor/);
  assert.match(targetSvgs, /helicopter_topdown:\s*'<g[\s\S]*?heli-main-rotor[\s\S]*?heli-tail-rotor/);
  assert.match(targetSvgs, /helicopter_sleek:\s*'<g[\s\S]*?heli-main-rotor[\s\S]*?heli-tail-rotor/);
  assert.match(targetSvgs, /helicopter:\s*'<g[\s\S]*?heli-main-rotor[\s\S]*?heli-tail-rotor/);
});

test('signal-sweep UAV uses the Lebanese four-arc emitter, separate from the generic UAV glyph', () => {
  assert.match(mapJs, /const glyph = signalDrone \? 'signal_sweep_uav'/);
  assert.match(mapJs, /const svgClass = signalDrone \? 'signal-sweep-uav-svg' : 'uav-svg'/);
  assert.ok(targetSvgs.includes('signal_sweep_uav: \'<g><circle cx="256" cy="200" r="34"></circle><rect x="240" y="226" width="32" height="250" rx="10"></rect>'));
  for (const path of ['M160 104a136 136 0 0 0 0 192', 'M352 104a136 136 0 0 1 0 192', 'M96 48a216 216 0 0 0 0 304', 'M416 48a216 216 0 0 1 0 304']) assert.ok(targetSvgs.includes(path));
  assert.match(css, /\.signal-sweep-uav-svg \{ display: block; fill: #6b7280; color: #1a1a2e;/);
});

test('warplane is one tight formation that enters from east, turns at the pinned report and withdraws east', () => {
  assert.match(mapJs, /\$\{pl\(18, -12, 1\)\}\$\{pl\(2, 8, 0\.85\)\}\$\{pl\(34, 8, 0\.85\)\}/);
  assert.match(mapJs, /warplaneEastOffset/);
  assert.match(mapJs, /this\.map\.on\('move'[\s\S]{0,250}this\.updateWarplaneVectors\(\)/);
  assert.match(css, /\.mk-squad \.squad \{[\s\S]*?animation: warplaneEastTurnBack 7s linear infinite;/);
  assert.match(css, /@keyframes warplaneEastTurnBack[\s\S]*?40% \{[^}]*rotate\(270deg\)[\s\S]*?46% \{[^}]*rotate\(450deg\)[\s\S]*?84% \{[^}]*var\(--flight-east-x/);
  assert.match(css, /\.mk-squad \.squad \.sq \{[^}]*animation: none;/);
  assert.doesNotMatch(css, /squadFlyZ/);
  assert.match(mapJs, /if \(!\['squad', 'movement', 'fly'\]\.includes\(marker\)\)/);
});

test('entry flight approaches its Syrian report area from the east as a schematic animation', () => {
  assert.match(css, /\.map-flight-track-marker\.is-entering-syria \.map-flight-track-squad \{ animation: flightTrackEnterFromEast/);
  assert.match(css, /@keyframes flightTrackEnterFromEast \{ 0% \{ transform: translateX\(44px\); opacity: 0; \}/);
  assert.match(css, /Schematic east-to-west arrival at the selected Syrian report area; not a geographic\/live aircraft track/);
  assert.match(mapJs, /const position = \[alert\.location\.longitude, alert\.location\.latitude\]/);
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
