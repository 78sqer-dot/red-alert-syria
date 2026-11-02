import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ALERT_TYPES } from '../shared/types.js';

const map = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/css/app.css', import.meta.url), 'utf8');
const svgs = await readFile(new URL('../public/js/marker-svgs.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('security alert emojis are present and semantically distinct', () => {
  assert.equal(ALERT_TYPES.breaking.emoji, '🚨');
  assert.equal(ALERT_TYPES.uav.emoji, '🛩️');
  assert.equal(ALERT_TYPES.warplane.emoji, '✈️');
  assert.equal(ALERT_TYPES.artillery.emoji, '💣');
  assert.notEqual(ALERT_TYPES.uav.emoji, ALERT_TYPES.warplane.emoji);
  assert.equal(ALERT_TYPES.death.emoji, '🪦');
});

test('warplane keeps the three-aircraft formation and drones retain their orbiting silhouette', () => {
  assert.match(map, /t\.marker === 'orbit'/);
  assert.match(map, /t\.marker === 'squad'/);
  assert.match(map, /svgTag\(t\.glyph, 24,[\s\S]{0,120}pl\(18, -12, 1\).*pl\(2, 8, 0\.85\).*pl\(34, 8, 0\.85\)/);
  assert.match(css, /\.maplibregl-map \.mk-orbit:not\(\.mk-sat\) \.uav\s*\{\s*animation: uavOrbit 9s linear infinite;/);
  assert.match(css, /\.mk-squad \.squad \.sq\s*\{[^}]*width: 24px; height: 24px;[^}]*animation: squadFlyZ 7s linear infinite;/);
  assert.match(svgs, /"uav":/);
  assert.match(svgs, /"plane":/);
});

test('schematic movement uses one compact blue three-aircraft group at the report location without extra rings', () => {
  assert.match(map, /const color = '#2476c9';/);
  assert.match(map, /\[\{ name: 'is-lead', size: 24 \}, \{ name: 'is-left', size: 24 \}, \{ name: 'is-right', size: 24 \}\]/);
  assert.match(map, /const position = \[alert\.location\.longitude, alert\.location\.latitude\]/);
  assert.match(map, /const heading = alert\.flight_direction === 'leaving_syria' \? 180 : 0/);
  assert.match(map, /is-\$\{alert\.flight_direction\.replace\(\/_\/g, '-'\)\}/);
  assert.match(map, /const movementTrackIds = new Set\(this\.movementTrackAlerts\(\)\.map\(\(a\) => a\.id\)\)/);
  assert.match(map, /movementTrackIds\.has\(a\.id\)/);
  assert.match(map, /visual\.append\(squad\)/);
  assert.match(css, /\.map-flight-track-marker\.is-toward-syria \.map-flight-track-squad/);
  assert.match(css, /@keyframes flightTrackTravel/);
  assert.match(css, /@keyframes flightTrackApproach/);
  assert.match(css, /\.map-flight-track-visual\s*\{[^}]*transform: scale\(calc\(var\(--mks, \.5\) \* 1\.3\)\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^\n]*map-flight-track-squad/);
  assert.doesNotMatch(css, /map-flight-track-halo|translate\(-106px|translate\(106px/);
  assert.doesNotMatch(map, /flightPosition\(path|features\.push\(\{ type: 'Feature', properties: \{ id: alert\.id, color, arrow/);
});

test('drone orbit stays visible at country zoom while extra copies are hidden to prevent clutter', () => {
  assert.match(css, /\.maplibregl-map \.mk-orbit:not\(\.mk-sat\) \.uav\s*\{\s*animation: uavOrbit 9s linear infinite;/);
  assert.match(css, /\.maplibregl-map:not\(\.zoom-detail\) \.mk-orbit\.mk-sat\s*\{\s*visibility: hidden;/);
  assert.doesNotMatch(css, /\.maplibregl-map:not\(\.zoom-detail\) \.mk-orbit \.uav\s*\{\s*visibility: hidden/);
  assert.match(map, /Math\.max\(z < 10\.5 \? 12 : 10, Math\.round\(\(o\.km \* 1000\) \/ mpp\)\)/);
});

test('tapping a grouped alert zooms to the cluster before opening an accessible chooser', () => {
  assert.match(map, /if \(group\?\.alerts\.length > 1\) return this\.zoomToGroupChooser\(group\)/);
  assert.match(map, /anchor: 'bottom', offset: \[0, 0\]/);
  assert.match(map, /alert-group-list/);
  assert.match(map, /item\.addEventListener\('click'/);
  assert.match(map, /this\.onSelect\(alert\.id, \{ fromMap: true, fly: true \}\)/);
});

test('large map module is imported after the first interface paint rather than blocking initial module loading', () => {
  assert.match(app, /requestAnimationFrame\(\(\) => requestAnimationFrame\(resolve\)\)/);
  assert.match(app, /const maplibregl = await import\('\/vendor\/maplibre-gl\.mjs\?v=6\.16\.0'\)/);
  assert.match(html, /rel="modulepreload"[^>]*maplibre-gl\.mjs[^>]*fetchpriority="low"/);
});

test('live alert circles use compositor-safe pulse layers and remain clickable through zone hit testing', () => {
  assert.match(map, /this\._syncPulses\(pulses\)/);
  assert.match(map, /const hit = this\.zoneAt\(e\.lngLat, e\.point\)/);
  assert.match(css, /\.zp-fill[\s\S]*animation: zfillPulse/);
});

test('map event glyphs are 24px and urgent news uses a white outline, black triangle, and red dot', () => {
  assert.match(map, /glyphDisc\(a\.type, 34, 24, 'sai map-event-disc'/);
  assert.match(map, /svgTag\(glyph, 24, 'class="news-marker-svg" fill="#111827"'\)/);
  assert.match(css, /\.sai\.map-event-disc\s*\{[^}]*background:\s*#fff !important/);
  assert.match(css, /\.ic\s*\{[^}]*border-radius:\s*50%;[^}]*background:\s*#fff/);
  assert.match(css, /\.news-marker-core\s*\{[^}]*width:\s*32px; height:\s*32px;[^}]*border:\s*2px solid #fff;[^}]*background:\s*transparent/);
  assert.match(css, /\.news-marker-core::after\s*\{[^}]*background:\s*#ef233c/);
  assert.match(css, /\.news-marker-svg\s*\{[^}]*width:\s*24px; height:\s*24px/);
  assert.match(css, /\.ic-svg\s*\{[^}]*width:\s*24px; height:\s*24px/);
  assert.match(css, /\.mk-event-emoji\s*\{[^}]*background:\s*#fff/);
});
