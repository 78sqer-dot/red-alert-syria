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

test('requested event emojis map onto their own map alert types', () => {
  assert.equal(alertEmoji({ type: 'airstrike' }), '💥');
  assert.equal(alertEmoji({ type: 'explosion' }), '💥');
  assert.equal(alertEmoji({ type: 'detonation' }), '💥');
  assert.equal(alertEmoji({ type: 'weather' }), '⛈️');
  assert.equal(alertEmoji({ type: 'fire' }), '🔥');
  assert.equal(alertEmoji({ type: 'arrest' }), '🚔');
  assert.equal(alertEmoji({ type: 'civil', civil_emoji: 'medical' }), '🚑');
  assert.equal(alertEmoji({ type: 'artillery' }), '💣');
  assert.match(map, /const eventEmoji = \['airstrike', 'artillery', 'explosion', 'detonation', 'weather', 'fire', 'arrest'\]\.includes\(a\.type\)/);
  assert.match(map, /a\.type === 'civil' && alertEmoji\(a\) === '🚑'/);
  assert.match(map, /a\.type === 'weather' \? t\.emoji : alertEmoji\(a\)/);
  assert.match(map, /else if \(eventEmoji\) \{[\s\S]{0,400}else if \(marker === 'icon'\)/);
  assert.match(map, /class="sai map-event-disc map-event-emoji"/);
  assert.match(css, /\.sai\.map-event-emoji \{[^}]*font-size: 21px;/);
});

test('explosion and detonation have distinct Arabic labels and strike-colored SVGs at standard map size', () => {
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
  assert.equal(TYPE_ICON.detonation, 'bomb');
  assert.match(EXTRA_SVG.detonation_burst, /M256 40v144/);
  assert.equal(eventVisual('detonation').category, 'strikes');
  assert.equal(eventVisual('detonation').color, '#c2410c');
  assert.match(map, /glyphDisc\(a\.type, 34, 24, 'sai map-event-disc'/);
  assert.match(map, /const iconColor = visual\.color/);
});

test('warplane follows the three-aircraft reference pass while drones keep their orbiting silhouette', () => {
  assert.match(map, /marker === 'orbit'/);
  assert.match(map, /t\.marker === 'squad'/);
  assert.match(map, /svgTag\(t\.glyph, 24,[\s\S]{0,120}pl\(36, -12, 1\).*pl\(20, 8, 0\.85\).*pl\(52, 8, 0\.85\)/);
  assert.match(css, /\.maplibregl-map \.mk-orbit:not\(\.mk-sat\) \.uav\s*\{\s*animation: uavOrbit 9s linear infinite;/);
  assert.match(css, /\.mk-squad \.squad\s*\{[^}]*width: 84px; height: 200px; left: -42px; top: -100px;/);
  assert.match(css, /\.mk-squad \.squad \.sq\s*\{[^}]*width: 24px; height: 24px; scale: 1; animation: squadFly 7s linear infinite;/);
  assert.match(css, /\.mk-squad \.squad \.sq:nth-child\(2\)\s*\{ left: 8px !important; top: calc\(50% \+ 16px\) !important; width: 22px; height: 22px; \}/);
  assert.match(css, /@keyframes squadFly \{ 0% \{ transform: translateY\(110px\); opacity: 0; \} 12% \{ opacity: 1; \} 88% \{ opacity: 1; \} 100% \{ transform: translateY\(-110px\); opacity: 0; \} \}/);
  assert.match(css, /\.maplibregl-map:not\(\.zoom-detail\) \.mk-squad:not\(\.t-warplane\) \.squad \{ visibility: hidden; \}/);
  assert.match(css, /\.mk-squad \.squad \.sq\s*\{[^}]*animation: squadFly 7s linear infinite;/);
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

test('map event glyphs are 24px and urgent news shows its warning category symbol in a red pulsing marker', () => {
  assert.match(map, /glyphDisc\(a\.type, 34, 24, 'sai map-event-disc'/);
  assert.match(map, /class="news-marker-category" aria-hidden="true">\$\{visual\.dot\}/);
  assert.match(css, /\.sai\.map-event-disc\s*\{[^}]*background:\s*#fff !important/);
  assert.match(css, /\.ic\s*\{[^}]*border-radius:\s*50%;[^}]*background:\s*#fff/);
  assert.match(css, /\.news-marker-core\s*\{[^}]*width:\s*32px; height:\s*32px;[^}]*border:\s*2px solid #fff;[^}]*background:\s*transparent/);
  assert.match(css, /\.news-marker-core::after\s*\{[^}]*background:\s*#ef233c/);
  assert.match(css, /\.mk-breaking-news \.news-marker-core\s*\{[^}]*border-color: #ef233c;[^}]*box-shadow: 0 0 0 1px rgba\(239,35,60,\.34\)/);
  assert.match(css, /\.mk-breaking-news \.news-marker-core::after\s*\{ border-color: #ef233c; box-shadow: 0 0 0 1px rgba\(239,35,60,\.28\); \}/);
  assert.match(css, /\.news-marker-category\s*\{[^}]*width:\s*15px; height:\s*15px;[^}]*font:\s*14px\/15px/);
  assert.match(css, /\.mk-breaking-news \.news-marker-core\s*\{\s*width: 26px; height: 26px; border-width: 1\.7px;/);
  assert.match(css, /\.mk-breaking-news \.news-pulse-ring\s*\{ width: 34px; height: 34px; border-color: #ef233c/);
  assert.match(css, /@keyframes urgentPulseWave/);
  assert.match(css, /\.ic-svg\s*\{[^}]*width:\s*24px; height:\s*24px/);
  assert.match(css, /\.mk-event-emoji\s*\{[^}]*background:\s*#fff/);
});

test('urgent marker core, red pulse and glow follow the shared map zoom scale', () => {
  assert.match(css, /\.mk-breaking-news \.mk-s\s*\{\s*transform: scale\(var\(--mks, \.5\)\); transition: transform \.2s ease;/);
  assert.match(css, /\.news-pulse-ring\s*\{[^}]*transform: translate\(-50%, -50%\) scale\(var\(--mks, \.5\)\)/);
  assert.doesNotMatch(css, /\.mk-breaking-news \.news-pulse-ring\s*\{[^}]*transform:/);
  assert.match(css, /\.mk-breaking-news \.news-pulse-ring\s*\{ width: 34px; height: 34px; border-color: #ef233c; background: transparent; box-shadow: 0 0 5px rgba\(239,35,60,\.28\); \}/);
  assert.match(css, /\.mk-breaking-news \.news-pulse-ring::after\s*\{ border-color: #ef233c; animation: urgentPulseWave 2s ease-out infinite; \}/);
  assert.match(map, /const mks = Math\.max\(0\.42, Math\.min\(0\.56,/);
});

test('map SVGs use category colors while the helicopter keeps its dark body, red accents, and blue glow', () => {
  assert.match(map, /const fg = visual\.color;/, 'static discs use the category color');
  assert.match(map, /const iconColor = visual\.color/);
  assert.match(map, /style="--ic:\$\{iconColor\}/);
  assert.match(map, /fill="\$\{iconColor\}"/);
  assert.match(css, /\.sai\.map-event-disc \{[^}]*color: var\(--c\) !important/);
  assert.match(css, /\.sai\.map-event-disc svg \{ fill: var\(--c\) !important; color: var\(--c\) !important; \}/);
  assert.match(css, /\.ic-pistol \.ic-svg, \.ic-rifle \.ic-svg \{[^}]*fill: var\(--ic\)/);
  assert.match(css, /\.uav-svg \{[^}]*fill: var\(--c, #6b7280\)/);
  assert.match(css, /\.helicopter-svg \{[^}]*fill: #17212d[^}]*rgba\(59,142,255,\.78\)/);
  assert.match(css, /\.helicopter-svg \.heli-cockpit \{ fill: #e11d48; \}/);
  assert.match(css, /html\.dark \.mk\.sel \.uav-svg \{ fill: color-mix\(in srgb, var\(--c, #6b7280\) 72%, #fff\); \}/);
  assert.match(css, /\.mk-helicopter \.helicopter-svg, \.mk-helicopter\.sel \.helicopter-svg \{ fill: #17212d; \}/);
});
