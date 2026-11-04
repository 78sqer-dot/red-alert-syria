import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/css/app.css', import.meta.url), 'utf8');
const map = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

function keyframes(name) {
  const match = css.match(new RegExp(`@keyframes ${name}\\s*\\{([^}]+(?:\\}[^}]*)?)\\}`, 's'));
  assert.ok(match, `missing ${name}`);
  return match[1];
}

test('plane approach matches the five-second live reference timing and pixel positions', () => {
  assert.match(css, /\.map-flight-track-marker\.is-plane\.is-toward-syria \.map-flight-track-squad \{ animation-name: flightTrackPlaneApproach; \}/);
  const frames = keyframes('flightTrackPlaneApproach');
  assert.match(css, /\.map-flight-track-marker\.is-toward-syria \.map-flight-track-squad \{ animation: flightTrackApproach 5s linear infinite; \}/);
  assert.match(css, /@keyframes flightTrackPlaneApproach \{ 0% \{ transform: translate\(-50%, 150px\); opacity: 0; \} 15% \{ opacity: 1; \} 85% \{ transform: translate\(-50%, 76px\); opacity: 1; \} 100% \{ transform: translate\(-50%, 76px\); opacity: 0; \} \}/);
  assert.match(frames, /0%/);
});

test('plane movement uses an unscaled 200px visual and scales only its formation', () => {
  assert.match(css, /\.map-flight-track-marker\.is-plane \.map-flight-track-visual \{ height: 200px; transform: none; \}/);
  assert.match(css, /\.map-flight-track-formation \{ position: absolute; inset: 0; \}/);
  assert.match(css, /\.map-flight-track-marker\.is-plane \.map-flight-track-formation \{ transform: scale\(calc\(var\(--mks, \.5\) \* 1\.3\)\); transform-origin: top center; \}/);
  assert.match(css, /\.map-flight-track-marker\.is-plane \.map-flight-track-visual \{ height: 200px; transform: none; \}/);
  assert.match(css, /@keyframes flightTrackPlaneTravel \{ 0% \{ transform: translateY\(110px\); opacity: 0; \} 12%, 88% \{ opacity: 1; \} 100% \{ transform: translateY\(-110px\); opacity: 0; \} \}/);
  assert.match(css, /@keyframes flightTrackPlaneEnterFromEast \{ 0% \{ transform: translateX\(150px\); opacity: 0; \} 15% \{ opacity: 1; \} 85% \{ transform: translateX\(76px\); opacity: 1; \} 100% \{ transform: translateX\(76px\); opacity: 0; \} \}/);
});

test('formation preserves exactly three 24px blue aircraft and does not alter route inputs', () => {
  assert.match(map, /const formation = document\.createElement\('span'\); formation\.className = 'map-flight-track-formation';/);
  assert.match(map, /for \(const slot of \[\{ name: 'is-lead', size: 24 \}, \{ name: 'is-left', size: 24 \}, \{ name: 'is-right', size: 24 \}\]\)/);
  assert.match(map, /formation\.append\(airframe\);[\s\S]{0,100}squad\.append\(formation\);/);
  assert.match(map, /const iconColor = aircraft === 'uav' \? color : '#3b8eff';/);
  assert.match(map, /const route = isReferenceRoute[\s\S]{0,160}referenceFlightPath\(alert\.flight_direction, alert\.flight_target\)[\s\S]{0,100}directFlightPath\(alert\.location, alert\.flight_target\)/);
  assert.match(map, /directFlightBearing\(alert\.location, alert\.flight_target\)/);
  assert.match(map, /const heading = isReferenceRoute && Number\.isFinite\(routeBearing\) \? routeBearing : aircraftHeading\(alert, savedBearing\)/);
  assert.match(map, /setRotation\(heading\)/);
});

test('UAV animation declarations and reduced-motion/gesture pause behavior remain intact', () => {
  assert.match(css, /\.map-flight-track-squad \{[^}]*animation: flightTrackTravel 7s linear infinite; \}/);
  assert.match(css, /\.map-flight-track-marker\.is-toward-syria \.map-flight-track-squad \{ animation: flightTrackApproach 5s linear infinite; \}/);
  assert.match(css, /\.map-flight-track-marker\.is-entering-syria \.map-flight-track-squad \{ animation: flightTrackEnterFromEast 5s linear infinite; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.map-flight-track-squad \{ animation: none !important; transform: none; opacity: 1; \} \}/);
  assert.match(css, /\.is-moving \.map-flight-track-squad, \.is-zooming \.map-flight-track-squad \{ animation-play-state: paused !important; \}/);
});

test('entering plane keeps right-to-left travel and faces left; cache versions refresh assets', () => {
  assert.match(css, /\.map-flight-track-marker\.is-plane\.is-entering-syria \.map-flight-track-squad \{ animation-name: flightTrackPlaneApproach; \}/);
  assert.doesNotMatch(css, /is-entering-syria \.map-flight-track-svg \{ transform: rotate\(-135deg\)/);
  assert.match(html, /app\.css\?v=52/);
  assert.match(html, /app\.js\?v=66/);
  assert.match(app, /map\.js\?v=70/);
});

test('plane area uses blue dashed geographic circles without DOM pulses and plane-only trail while UAV remains unscaled', () => {
  assert.match(map, /planeArea = a\.type === 'warplane' \\|\\| \(a\.type === 'air_movement' && a\.aircraft !== 'uav'\)/);
  assert.match(map, /planeArea \? z\.km : this\._screenKm/);
  assert.match(map, /if \(a\.is_active && !planeArea\)/);
  assert.match(map, /planeArea: true/);
  assert.match(css, /map-flight-track-marker\.is-plane\.is-toward-syria \.map-flight-track-visual::before/);
  assert.match(css, /height: 135px; border-left: 1\.5px dashed rgba\(59,142,255,\.45\)/);
});
