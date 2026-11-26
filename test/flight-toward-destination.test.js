import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAlertInput } from '../server/bot.js';
import { publicAlert } from '../server/store.js';

const bot = await readFile(new URL('../server/bot.js', import.meta.url), 'utf8');

const origin = { scope: 'place', place_id: 'origin-1', name_ar: 'درعا البلد', name_en: 'Daraa al-Balad', district_ar: 'درعا', governorate_ar: 'درعا', latitude: 32.61, longitude: 36.10 };
const destination = { scope: 'place', place_id: 'dest-1', name_ar: 'حمص', name_en: 'Homs', district_ar: 'حمص', governorate_ar: 'حمص', latitude: 34.73, longitude: 36.72 };
const author = { id: 1, name: 'test' };

test('aerial mode keyboard offers hovering and heading as two independent buttons', () => {
  assert.match(bot, /تحليق فوق المنطقة`, 'airmode:over'\)\.row\(\)\s*\n\s*\.text\(en \? `\$\{aircraft\} Heading to a specific area` : `\$\{aircraft\} باتجاه منطقة معينة`, 'airmode:toward'\)\.row\(\)/);
  assert.match(bot, /bot\.callbackQuery\(\/\^airmode:toward\$\//);
  assert.match(bot, /d\.aerialMode = 'toward';\s*\n\s*d\.flightTarget = null;/);
});

test('hovering path is untouched: over sets aerialMode=over and goes to location pick', () => {
  assert.match(bot, /bot\.callbackQuery\(\/\^airmode:over\$\/[\s\S]{0,220}d\.aerialMode = 'over';\s*\n\s*await askLocation\(ctx, d\);/);
});

test('toward flow chains origin pick into a gazetteer destination pick and keeps origin as location', () => {
  assert.match(bot, /d\.aerialMode === 'toward' && !d\.flightTarget && !d\.selectingFlightTarget\) \{\s*\n\s*d\.selectingFlightTarget = true;\s*\n\s*return askLocation\(ctx, d\);/);
  assert.match(bot, /if \(d\.aerialMode === 'toward'\) return afterLocation\(ctx, d\);/);
  // the "direction only, no area" escape stays exclusive to air_movement
  assert.match(bot, /if \(d\.selectingFlightTarget && d\.type === 'air_movement'\) kb\.text/);
});

test('buildAlertInput saves the destination as meta.flightTarget with aerialMode=toward and a نحو title', () => {
  const input = buildAlertInput({ type: 'warplane', aerialMode: 'toward', location: origin, extra: [], flightTarget: destination, ttlMin: 60, details: 'رصد طيران حربي متجه شمالاً' }, author);
  assert.equal(input.location, origin, 'the observed area stays the alert location');
  assert.deepEqual(input.meta.flightTarget, destination);
  assert.equal(input.meta.aerialMode, 'toward');
  assert.ok(input.title.includes('نحو'), `title carries the heading phrase: ${input.title}`);
  assert.ok(input.title.includes('حمص'), `title names the destination: ${input.title}`);
  assert.ok(input.title_en.includes('toward'), `english title carries the heading phrase: ${input.title_en}`);
});

test('buildAlertInput for hovering reports stores aerialMode=over and no destination', () => {
  const input = buildAlertInput({ type: 'uav', aerialMode: 'over', location: origin, extra: [], ttlMin: 60, details: 'تحليق فوق المنطقة' }, author);
  assert.equal(input.meta?.flightTarget, undefined);
  assert.equal(input.meta?.aerialMode, 'over');
  assert.ok(!input.title.includes('نحو'), `hovering title has no heading phrase: ${input.title}`);
});

test('publicAlert exposes flight_target and aerial_mode only for toward reports', () => {
  const base = { id: 't1', title: 'طيران حربي', timestamp: '2026-11-25T00:00:00.000Z', is_active: true, location: origin, source: 'telegram' };
  const toward = publicAlert({ ...base, type: 'warplane', meta: { aerialMode: 'toward', flightTarget: destination } });
  assert.equal(toward.aerial_mode, 'toward');
  assert.equal(toward.flight_target.scope, 'place');
  assert.equal(toward.flight_target.name_ar, 'حمص');
  assert.equal(toward.flight_target.latitude, 34.73);
  assert.equal(toward.flight_target.longitude, 36.72);
  assert.equal(toward.flight_target.place_id, 'dest-1');

  const over = publicAlert({ ...base, type: 'uav', meta: { aerialMode: 'over' } });
  assert.equal(over.aerial_mode, 'over');
  assert.equal(over.flight_target, undefined);
});

test('publicAlert air_movement flight_target output is unchanged', () => {
  const base = { id: 't2', title: 'حركة طيران', timestamp: '2026-11-25T00:00:00.000Z', is_active: true, source: 'telegram' };
  const gov = { scope: 'governorate', name_ar: 'حلب', name_en: 'Aleppo', latitude: 36.20, longitude: 37.13 };
  const out = publicAlert({ ...base, type: 'air_movement', meta: { flightTarget: gov } });
  assert.deepEqual(out.flight_target, { scope: 'governorate', name_ar: 'حلب', name_en: 'Aleppo', latitude: 36.20, longitude: 37.13 });
});
