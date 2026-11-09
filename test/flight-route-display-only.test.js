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

test('new aircraft reports use the selected direction and governorate for a clearly illustrative Israel-reference route', () => {
  assert.match(bot, /d\.flightDirection = ctx\.match\[1\];[\s\S]{0,140}d\.flightRouteOrigin = 'israel_approx_reference'/);
  assert.match(bot, /A governorate draws an illustrative line from an approximate reference point inside Israel/);
  assert.match(bot, /This is not a live track\./);
  assert.match(map, /const position = \[alert\.location\.longitude, alert\.location\.latitude\]/);
  assert.match(map, /const route = isReferenceRoute\s*\?\s*referenceFlightPath\(alert\.flight_direction, alert\.flight_target\)\s*:\s*directFlightPath\(alert\.location, alert\.flight_target\)/);
  assert.match(map, /const point = flightPosition\(track\.path, progress\)/);
  assert.match(map, /illustrative direction, not a live track/);
});
