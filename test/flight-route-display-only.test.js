import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const map = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
const bot = await readFile(new URL('../server/bot.js', import.meta.url), 'utf8');

test('the legacy Quneitra route override is an archived display overlay and never rewrites report coordinates', () => {
  assert.match(map, /LEGACY_ISRAEL_REFERENCE_ALERTS = new Set\(\[LEGACY_QUNEITRA_ALERT_ID\]\)/);
  assert.match(map, /legacyQuneitraArchivePath\(archivedAlert\)/);
  assert.match(map, /reported location remains \$\{reportedPlace\}/);
  assert.doesNotMatch(map, /alert\.location\.(?:longitude|latitude)\s*=/);
});

test('new reports select an approximate origin and destination, then animate within their geographic route area', () => {
  assert.match(bot, /d\.selectingFlightOrigin = true/);
  assert.match(bot, /d\.selectingFlightTarget = true/);
  assert.match(bot, /flightOrigin\s*\?\s*\{ scope: 'point', name_ar: 'نقطة رصد تقريبية'[\s\S]{0,180}latitude: lat, longitude: lon/);
  assert.match(map, /const reportPosition = \[alert\.location\.longitude, alert\.location\.latitude\]/);
  assert.match(map, /const route = isReferenceRoute[\s\S]{0,180}: directFlightPath\(alert\.location, alert\.flight_target\)/);
  assert.match(map, /const position = route\.length === 2 \? route\[0\] : reportPosition/);
  assert.match(map, /const point = flightPosition\(route, progress\)/);
  assert.match(map, /const radiusKm = distanceKm\(route\[0\], route\[1\]\) \/ 2 \+ 2/);
  assert.match(map, /routeArea: true/);
  assert.doesNotMatch(bot, /flightRouteOrigin\s*=/, 'new bot reports must not substitute a guessed origin');
});
