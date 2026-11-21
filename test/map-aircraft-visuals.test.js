import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/css/app.css', import.meta.url), 'utf8');
const mapJs = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
const appJs = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
const markerSvgs = await readFile(new URL('../public/js/marker-svgs.js', import.meta.url), 'utf8');
const types = await readFile(new URL('../shared/types.js', import.meta.url), 'utf8');
const targetSvgs = await readFile(new URL('../public/js/target-svgs.js', import.meta.url), 'utf8');

test('approved helicopter visual is served under fresh module cache keys', () => {
  assert.match(appJs, /from '\.\/map\.js\?v=99'/);
  assert.match(mapJs, /from '\.\/target-svgs\.js\?v=27'/);
});

test('drone keeps its top-down 24px silhouette and perimeter orbit', () => {
  assert.match(types, /uav:\s*\{[\s\S]*?glyph: 'uav'/);
  assert.ok(markerSvgs.includes('"uav": "<g> <ellipse cx=\\"256\\" cy=\\"256\\" rx=\\"18\\" ry=\\"140\\" />'));
  assert.match(mapJs, /const svgClass = signalDrone \? 'signal-sweep-uav-svg' : 'uav-svg'/);
  assert.match(mapJs, /signalDrone \? svgTag\(glyph,\s*36,[\s\S]{0,120}: svgTag\(glyph,\s*24,/);
  assert.match(css, /\.uav-svg\s*\{[^}]*width: 24px; height: 24px;/);
  assert.match(css, /\.uav\s*\{[^}]*width: 44px; height: 44px;[^}]*margin: -22px 0 0 -22px;/);
  assert.match(css, /\.uav-svg\s*\{\s*stroke: rgba\(255,255,255,\.94\);\s*stroke-width: 18;/);
});

test('drone is hidden with impact circles alone at country zoom and orbits at detail zoom', () => {
  assert.match(css, /\.maplibregl-map \.mk-orbit:not\(\.mk-sat\) \.uav\s*\{\s*animation: uavOrbit 9s linear infinite;/);
  assert.match(css, /\.maplibregl-map:not\(\.zoom-detail\) \.mk-orbit:not\(\.mk-sat\) \.uav, \.maplibregl-map:not\(\.zoom-detail\) \.mk-orbit:not\(\.mk-sat\) \.uav-box::before \{\s*visibility: hidden;/);
  assert.match(css, /\.maplibregl-map\.zoom-detail \.mk-orbit:not\(\.mk-sat\) \.uav\s*\{\s*visibility: visible;/);
  assert.match(css, /\.maplibregl-map:not\(\.zoom-detail\) \.mk-orbit\.mk-sat\s*\{\s*visibility: hidden;/);
  assert.doesNotMatch(css, /uavHover/);
  assert.match(mapJs, /classList\.toggle\('zoom-detail', z >= 10\.5\)/);
  assert.match(mapJs, /const px = Math\.max\(5, Math\.round\(\(o\.km \* 1000\) \/ mpp\)\)/);
  assert.match(mapJs, /const circleKm = this\._screenKm\(m\._zkm, m\._lat\);[\s\S]{0,100}const px = Math\.max\(5, Math\.round\(\(circleKm \* 1000\) \/ mpp\)\)/);
  assert.doesNotMatch(mapJs, /Math\.min\(12, Math\.round\(\(o\.km \* 1000\) \/ mpp\)\)/);
  assert.match(mapJs, /if \(z >= 10\.5 && this\.sats\)/);
});

test('helicopter uses the approved realistic top-view render and warplane-style track flight', () => {
  // Owner pick 2026-11-21: the olive realistic top-view render (#2) at 34px with a baked
  // light outline/glow replaces the flat SVG silhouette. Active sightings leave the static
  // pin layer and fly the warplane track language: spawn at one circle edge, cross the
  // reported area, disappear at the far edge, heading rotation included.
  assert.match(mapJs, /\|\| a\.type === 'helicopter'\)\n\s*&& a\.is_active/);
  assert.match(mapJs, /heliTrackPath\(alert\) \{/);
  assert.match(mapJs, /const isHelicopter = alert\.type === 'helicopter';/);
  assert.match(mapJs, /const aircraft = isHelicopter \? 'helicopter' : alert\.aircraft === 'uav' \? 'uav' : 'plane';/);
  assert.match(mapJs, /\(aircraft === 'plane' \|\| aircraft === 'helicopter'\) && route\.length === 2/);
  assert.match(mapJs, /map-flight-track-airframe is-lead is-heli/);
  assert.match(mapJs, /<img src="\/img\/helicopter-top\.png\?v=1" width="34" height="34" class="heli-img"/);
  assert.match(css, /\.heli-img \{ display: block; width: 34px; height: 34px; \}/);
  assert.match(css, /\.map-flight-track-airframe\.is-heli \{ width: 34px; height: 34px; \}/);
  // Ended sightings: static PNG pin at the reported point, visible at every zoom, no orbit.
  assert.match(mapJs, /<span class="heli-craft heli-static">/);
  assert.match(css, /\.heli-craft\.heli-static \{[^}]*animation: none/);
  assert.match(css, /\.mk-helicopter \.heli-route:has\(\.heli-static\) \{ visibility: visible !important;/);
  assert.match(mapJs, /const second = a\.helicopters > 1 \?/);
  assert.match(mapJs, /heli-craft-second heli-static/);
  assert.match(css, /\.heli-craft-second\.heli-static \{ position: absolute; left: 18px; top: 14px; opacity: \.9; \}/);
  assert.doesNotMatch(mapJs, /helicopterScale|--heli-scale/);
  assert.match(mapJs, /classList\.toggle\('zoom-detail', z >= 10\.5\)/);
  assert.match(css, /animation: zpulse 3\.2s cubic-bezier/);
  assert.match(mapJs, /el\.insertAdjacentHTML\('afterbegin', '<span class="news-pulse-ring"/);
});

test('movement stays anchored to the observed location and draws only the selected direct route', () => {
  assert.match(mapJs, /const position = \[alert\.location\.longitude, alert\.location\.latitude\]/);
  assert.match(mapJs, /track\.marker\.setLngLat\(position\)/);
  assert.match(mapJs, /const heading = isHelicopter \|\| \(isReferenceRoute && Number\.isFinite\(routeBearing\)\) \? routeBearing : aircraftHeading\(alert, savedBearing\)/);
  assert.match(mapJs, /track\.marker\.setRotation\(heading\)/);
  assert.match(mapJs, /maplibregl-marker map-flight-track-marker/);
  assert.match(css, /\.map-flight-track-marker \{ position: absolute;/);
  assert.match(mapJs, /directFlightPath\(alert\.location, alert\.flight_target\)/);
  assert.match(mapJs, /geometry: \{ type: 'LineString', coordinates: route \}/);
  assert.match(mapJs, /const routeColor = aircraft === 'uav' \? '#e5484d' : isHelicopter \? color : '#2476c9'/);
  assert.match(mapJs, /const iconColor = aircraft === 'uav' \? color : '#3b8eff'/);
  assert.match(mapJs, /properties: \{ color: routeColor, arrow: '➤'/);
  assert.match(mapJs, /'symbol-placement': 'line-center'/);
  assert.match(mapJs, /'text-rotation-alignment': 'map', 'text-keep-upright': false/);
  assert.match(mapJs, /'line-opacity': \['case', \['get', 'referenceRoute'\], 0\.92, \['get', 'planeRoute'\], 0\.45, 0\.9\]/);
  assert.match(mapJs, /fill="\$\{iconColor\}" class="map-flight-track-svg"/);
  assert.match(mapJs, /source\.setData\(\{ type: 'FeatureCollection', features: routeFeatures \}\)/);
  assert.match(mapJs, /&& Number\.isFinite\(a\.location\?\.latitude\) && Number\.isFinite\(a\.location\?\.longitude\)/);
  assert.match(css, /\.map-flight-track-marker\.is-plane \.map-flight-track-svg \{ transform: rotate\(-45deg\); \}/);
});
