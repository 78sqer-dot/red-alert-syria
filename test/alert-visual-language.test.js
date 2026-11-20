import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ALERT_TYPES, alertEmoji, eventVisual } from '../shared/types.js';
import { EXTRA_SVG } from '../public/js/target-svgs.js';
import { TYPE_ICON } from '../public/js/type-icons.js';

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

test('event emojis map onto their own map alert types, one symbol per type', () => {
  assert.equal(alertEmoji({ type: 'airstrike' }), '☄️', 'an incoming aerial strike, distinct from a ground explosion');
  assert.equal(alertEmoji({ type: 'explosion' }), '💥');
  assert.equal(alertEmoji({ type: 'detonation' }), '🧨', 'a detonated device, distinct from a generic explosion');
  assert.equal(alertEmoji({ type: 'weather' }), '⛈️');
  assert.equal(alertEmoji({ type: 'fire' }), '🔥');
  assert.equal(alertEmoji({ type: 'arrest' }), '🚔');
  assert.equal(alertEmoji({ type: 'civil', civil_emoji: 'medical' }), '🚑');
  assert.equal(alertEmoji({ type: 'artillery' }), '💣');
  // Map pins never render an emoji (unified symbols, 2026-11-17): the former
  // emoji-disc types draw their glyph on the pin like every other type, and a
  // civil medical report keeps its ambulance glyph.
  assert.doesNotMatch(map, /eventEmoji|map-event-emoji/);
  assert.match(map, /const pinGlyph = a\.type === 'civil' && alertEmoji\(a\) === '🚑' \? 'ambulance' : glyph;/);
  assert.match(map, /glyphDisc\(a\.type, 32, 20, 'pin'/);
});

test('explosion and detonation have distinct Arabic labels and glyphs on the unified pin', () => {
  assert.equal(ALERT_TYPES.explosion.ar, 'انفجار');
  assert.equal(ALERT_TYPES.explosion.button_ar, 'انفجار');
  assert.equal(ALERT_TYPES.explosion.button_en, 'Explosion');
  assert.equal(ALERT_TYPES.explosion.tag_ar, 'انفجار');
  assert.equal(ALERT_TYPES.explosion.marker, 'icon');
  assert.equal(ALERT_TYPES.explosion.glyph, 'explosion_modern');
  assert.equal(TYPE_ICON.explosion, 'bomb');
  assert.match(EXTRA_SVG.explosion_modern, /<path d="M256 30/);
  assert.match(EXTRA_SVG.explosion_modern, /<circle cx="256" cy="256"/);
  assert.equal(eventVisual('explosion').category, 'strikes');
  assert.equal(eventVisual('explosion').color, '#c2410c');
  assert.equal(ALERT_TYPES.detonation.ar, 'تفجير');
  assert.equal(ALERT_TYPES.detonation.button_ar, 'تفجير');
  assert.equal(ALERT_TYPES.detonation.button_en, 'Detonation');
  assert.equal(ALERT_TYPES.detonation.tag_ar, 'تفجير');
  assert.equal(ALERT_TYPES.detonation.en, 'Detonation');
  assert.equal(ALERT_TYPES.detonation.marker, 'icon');
  assert.equal(ALERT_TYPES.detonation.glyph, 'detonation_burst');
  assert.equal(ALERT_TYPES.detonation.size, 24);
  assert.notEqual(ALERT_TYPES.detonation.glyph, ALERT_TYPES.explosion.glyph);
  assert.equal(TYPE_ICON.detonation, 'bolt', 'explosion alone keeps the bomb UI icon');
  assert.match(EXTRA_SVG.detonation_burst, /M256 40v144/);
  assert.equal(eventVisual('detonation').category, 'strikes');
  assert.equal(eventVisual('detonation').color, '#c2410c');
  assert.match(map, /glyphDisc\(a\.type, 32, 20, 'pin', pinGlyph === t\.glyph/);
  assert.match(map, /--ring:\$\{t\.color\}/, 'the pin ring carries the type colour');
});

test('warplane follows the climbing-jets flight-trail reference (redalert.com.lb design) while drones keep their orbiting silhouette', () => {
  assert.match(map, /marker === 'orbit'/);
  assert.match(map, /t\.marker === 'squad'/);
  assert.match(map, /a\.flight_direction \|\| a\.meta\?\.flightDirection/);
  assert.match(map, /<div class="squad squad-directed"><span class="squad-trail" aria-hidden="true"><\/span>\$\{pl\('sq-lead'\)\}\$\{pl\('sq-chase'\)\}<\/div>/);
  assert.match(map, /<div class="squad">\$\{pl\(22, -8, 1\)\}\$\{pl\(6, 12, 0\.85\)\}\$\{pl\(38, 12, 0\.85\)\}<\/div>/);
  assert.match(css, /\.maplibregl-map \.mk-orbit:not\(\.mk-sat\) \.uav\s*\{\s*animation: uavOrbit 9s linear infinite;/);
  assert.match(css, /\.mk-squad \.squad\s*\{[^}]*width: 60px; height: 200px; left: -30px; top: -100px;/);
  assert.match(css, /\.mk-squad \.squad-trail \{[^}]*border-left: 1\.5px dashed #8b5cf6; opacity: \.45;/);
  assert.match(css, /\.mk-squad \.squad-directed \.sq \{[^}]*width: 18px; height: 18px;[^}]*animation: squadTrailLead 5s linear infinite;/);
  assert.match(css, /\.mk-squad \.squad-directed \.sq-chase \{ animation: squadTrailChase 5s linear infinite; \}/);
  assert.match(css, /\.mk-squad \.squad:not\(\.squad-directed\) \.sq \{ width: 16px; height: 16px; scale: 1; animation: squadFly 7s linear infinite; \}/);
  assert.match(css, /\.mk-squad \.squad:not\(\.squad-directed\) \.sq:nth-child\(2\), [^}]*width: 14px; height: 14px; \}/);
  assert.match(css, /@keyframes squadTrailLead \{ 0% \{ transform: translate\(-50%, 150px\); opacity: 0; \}/);
  assert.match(css, /@keyframes squadTrailChase \{ 0% \{ transform: translate\(calc\(-50% \+ 10px\), 162px\); opacity: 0; \}/);
  assert.match(css, /\.maplibregl-map:not\(\.zoom-detail\) \.mk-squad:not\(\.t-warplane\) \.squad \{ visibility: hidden; \}/);
  assert.doesNotMatch(css, /warplaneOrbit|squadFlyZ/);
  assert.match(svgs, /"uav":/);
  assert.match(svgs, /"plane":/);
});

test('a signal-sweep drone uses the standard 24px, type-colored orbit marker only when selected', () => {
  assert.match(map, /const signalDrone = a\.type === 'signal_sweep' &&/);
  assert.match(map, /const marker = alertMarkerKind\(a\);/);
  assert.equal(ALERT_TYPES.uav.glyph, 'uav');
  assert.equal(ALERT_TYPES.signal_sweep.glyph, 'signal_sweep');
  assert.match(map, /const glyph = signalDrone \? 'signal_sweep_uav'/);
  assert.match(map, /const svgClass = signalDrone \? 'signal-sweep-uav-svg' : 'uav-svg'/);
  assert.match(map, /svgTag\(glyph, 36, `class="\$\{svgClass\}"`\)/);
  assert.match(map, /el\.style\.setProperty\('--c', visual\.color\)/);
});

test('schematic movement uses one compact blue three-aircraft group at the report location without extra rings', () => {
  assert.match(map, /const color = eventVisual\('air_movement'\)\.color;/);
  assert.match(map, /\[\{ name: 'is-lead', size: 24 \}, \{ name: 'is-left', size: 24 \}, \{ name: 'is-right', size: 24 \}\]/);
  assert.match(map, /const position = \[alert\.location\.longitude, alert\.location\.latitude\]/);
  assert.match(map, /const heading = isReferenceRoute && Number\.isFinite\(routeBearing\) \? routeBearing : aircraftHeading\(alert, savedBearing\)/);
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
  assert.match(map, /Math\.max\(5, Math\.round\(\(o\.km \* 1000\) \/ mpp\)\)/);
  assert.match(map, /const circleKm = this\._screenKm\(m\._zkm, m\._lat\);[\s\S]{0,100}Math\.round\(\(circleKm \* 1000\) \/ mpp\)/);
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

test('static types share one unified pin and breaking news keeps its red pulse', () => {
  assert.match(map, /glyphDisc\(a\.type, 32, 20, 'pin', pinGlyph === t\.glyph/);
  assert.match(map, /el\.innerHTML = glyphDisc\(a\.type, 32, 20, 'pin'\);/, 'breaking renders the same pin (alert_tri glyph, type-colour ring)');
  assert.match(css, /\.pin \{[^}]*width: 32px; height: 32px;[^}]*background: rgba\(255,255,255,\.96\); border: 2px solid var\(--ring/);
  assert.match(css, /\.pin svg \{ display: block; width: 20px; height: 20px; fill: var\(--ring, #64748b\); \}/);
  assert.match(css, /\.maplibregl-map\.zoom-far \.pin \{ width: 20px; height: 20px; border-width: 1.5px; \}/);
  assert.match(css, /\.maplibregl-map\.zoom-far \.pin svg \{ width: 13px; height: 13px; \}/);
  assert.match(css, /\.maplibregl-map\.zoom-detail \.pin \{ width: 38px; height: 38px; border-width: 2.5px; \}/);
  assert.match(css, /\.mk:hover \.pin, \.mk\.sel \.pin \{ box-shadow: 0 0 0 1px rgba\(6,10,16,\.45\), 0 0 0 5px color-mix\(in srgb, var\(--ring/);
  assert.match(css, /\.mk-breaking-news \.news-pulse-ring \{ width: 34px; height: 34px; border-color: #ef233c/);
  assert.match(css, /@keyframes urgentPulseWave/);
  assert.doesNotMatch(css, /\.news-marker-core|\.news-marker-category|\.sai\.map-event-disc|\.civ-dot/);
  assert.doesNotMatch(map, /civ-dot|news-marker-core/);
});

test('urgent marker core, red pulse and glow follow the shared map zoom scale', () => {
  assert.match(css, /\.mk-breaking-news \.mk-s\s*\{\s*transform: scale\(var\(--mks, \.5\)\); transition: transform \.2s ease;/);
  assert.match(css, /\.news-pulse-ring\s*\{[^}]*transform: translate\(-50%, -50%\) scale\(var\(--mks, \.5\)\)/);
  assert.doesNotMatch(css, /\.mk-breaking-news \.news-pulse-ring\s*\{[^}]*transform:/);
  assert.match(css, /\.mk-breaking-news \.news-pulse-ring\s*\{ width: 34px; height: 34px; border-color: #ef233c; background: transparent; box-shadow: 0 0 5px rgba\(239,35,60,\.28\); \}/);
  assert.match(css, /\.mk-breaking-news \.news-pulse-ring::after\s*\{ border-color: #ef233c; animation: urgentPulseWave 2s ease-out infinite; \}/);
  assert.match(map, /const mks = Math\.max\(0\.42, Math\.min\(0\.56,/);
});

test('map pins use type colours for the ring while the helicopter keeps its slim military-blue palette', () => {
  assert.match(map, /--ring:\$\{t\.color\}/, 'the pin ring uses the type colour');
  assert.match(map, /fill="#ffffff"/, 'pin glyphs render white on the dark roundel');
  assert.match(css, /\.pin \{[^}]*border: 2px solid var\(--ring/);
  assert.doesNotMatch(map, /const iconColor = visual\.color/);
  assert.match(css, /\.uav-svg \{[^}]*fill: var\(--c, #6b7280\)/);
  assert.match(css, /\.helicopter-svg \{[^}]*width: 24px; height: 24px;[^}]*fill: #13283d[^}]*drop-shadow\(0 0 1\.4px rgba\(190,207,223,\.55\)\)/);
  assert.match(css, /\.helicopter-svg \.heli-body \{ fill: #13283d; stroke: #091725;/);
  assert.match(css, /\.helicopter-svg \.heli-body-highlight \{ fill: #243d56; \}/);
  assert.match(css, /\.helicopter-svg \.heli-cockpit \{ fill: #0b2034; \}/);
  assert.match(css, /\.helicopter-svg \.heli-tail-rotor \{ fill: #203851; stroke: #091a29; stroke-width: 8; opacity: 1;/);
  assert.equal(typeof EXTRA_SVG.helicopter_side, 'string');
  assert.match(EXTRA_SVG.helicopter_side, /class="heli-body"/);
  assert.doesNotMatch(EXTRA_SVG.helicopter_side, /#(?:ef4444|e11d48)/i);
  assert.match(css, /html\.dark \.mk\.sel \.uav-svg \{ fill: color-mix\(in srgb, var\(--c, #6b7280\) 72%, #fff\); \}/);
  assert.match(css, /\.mk-helicopter \.helicopter-svg, \.mk-helicopter\.sel \.helicopter-svg \{ fill: #13283d; \}/);
});
