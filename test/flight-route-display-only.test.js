import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const map = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
const store = await readFile(new URL('../server/store.js', import.meta.url), 'utf8');
const bot = await readFile(new URL('../server/bot.js', import.meta.url), 'utf8');

test('the active Quneitra route override is client-only and leaves the original report marker at its saved coordinates', () => {
  assert.match(map, /LEGACY_ISRAEL_REFERENCE_ALERTS = new Set\(\['be418c7b-510c-458e-b8d9-0c504730c50b'\]\)/);
  assert.match(map, /const position = \[alert\.location\.longitude, alert\.location\.latitude\]/);
  assert.match(map, /referenceFlightPath\(alert\.flight_direction, alert\.flight_target\)/);
  assert.match(map, /reported location remains \$\{reportedPlace\}/);
  assert.match(map, /label: lang === 'en' \? 'Approx\. reference · Israel' : 'مرجع تقريبي · إسرائيل'/);
  assert.doesNotMatch(map, /alert\.location\.(?:longitude|latitude)\s*=/);
});

test('only new flagged governorate reports expose the display-route origin to the map', () => {
  assert.match(bot, /d\.flightRouteOrigin === 'israel_approx_reference'[\s\S]{0,180}\? 'israel_approx_reference' : null/);
  assert.match(bot, /flightRouteOrigin = d\.type === 'air_movement'[\s\S]{0,220}flightTarget\?\.scope === 'governorate'/);
  assert.match(store, /a\.meta\?\.flightRouteOrigin === 'israel_approx_reference'[\s\S]{0,180}flight_route_origin: 'israel_approx_reference'/);
});
