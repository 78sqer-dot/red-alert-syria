import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const map = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/css/app.css', import.meta.url), 'utf8');
const server = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');
const aircraft = await readFile(new URL('../server/aircraft.js', import.meta.url), 'utf8');

test('live military-aircraft layer proxies adsb.lol through a cached server endpoint', () => {
  assert.match(server, /app\.get\('\/api\/aircraft', apiLimiter/);
  assert.match(server, /import \{ aircraftFeed \} from '\.\/aircraft\.js';/);
  assert.match(aircraft, /https:\/\/api\.adsb\.lol\/v2\/mil/);
  assert.match(aircraft, /https:\/\/api\.adsb\.lol\/v2\/lat\/35\.2\/lon\/38\.4\/dist\/250/, 'point-query fallback when the global feed fails');
  assert.match(aircraft, /const FETCH_MS = 10 \* 60_000;/, 'one shared upstream fetch per 10 minutes protects the anonymous daily quota');
  assert.match(aircraft, /a\.lat < BOX\.minLat \|\| a\.lat > BOX\.maxLat \|\| a\.lon < BOX\.minLon \|\| a\.lon > BOX\.maxLon/, 'server filters to the Syria region bbox');
  assert.match(aircraft, /ctrl\.abort\(\), 15000\)/, 'upstream fetch has a timeout');
  assert.match(aircraft, /lastError/, 'upstream failures are logged for diagnosis');
  assert.match(aircraft, /serve stale/);
});

test('map renders the aircraft layer with the production warplane glyph and the approved heli render', () => {
  assert.match(map, /startAircraftFeed\(\) \{/);
  assert.match(map, /fetch\('\/api\/aircraft'\)/);
  assert.match(map, /setInterval\(load, 60000\)/);
  assert.match(map, /a\.cat === 'A7' \|\| \/\^\(H\|UH\|AH\|CH\|MI\|KA\)-\?\/i\.test\(a\.t \|\| ''\)/, 'helicopter-category traffic uses the realistic render');
  assert.match(map, /<img src="\/img\/helicopter-top\.png\?v=1" width="20" height="20"/);
  assert.match(map, /svgTag\('plane', 20, 'fill="#9fb3c8" class="adsb-svg"'\)/);
  assert.match(map, /m\.setRotation\(a\.trk\)/, 'markers rotate to the reported track heading');
  assert.match(map, /rotationAlignment: 'map'/);
  assert.match(css, /\.adsb-craft \{ opacity: \.8;/);
  assert.match(css, /\.adsb-craft \.adsb-svg \{ display: block; transform: rotate\(-45deg\); \}/);
  assert.match(css, /\.adsb-craft\.is-heli img \{ display: block; width: 20px; height: 20px; \}/);
});

test('the aircraft layer is display-only and never creates alerts', () => {
  assert.doesNotMatch(aircraft, /store\.|postAlert|createAlert/, 'the feed never touches the alert store');
  assert.doesNotMatch(map.match(/_syncAircraft\(\) \{[\s\S]*?\n  \}/)?.[0] || '', /onSelect|bindMarkerTap/, 'aircraft markers stay non-interactive');
});
