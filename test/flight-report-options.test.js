import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FLIGHT_DIRECTIONS } from '../shared/types.js';

const bot = await readFile(new URL('../server/bot.js', import.meta.url), 'utf8');

test('the aerial submenu keeps hovering only and the route stays in the main direction flow', () => {
  assert.doesNotMatch(bot, /airmode:move|حركة طيران/);
  assert.match(bot, /Hovering over the area[\s\S]{0,80}airmode:over/);
  assert.match(bot, /if \(d\.type !== 'uav' && d\.type !== 'warplane'\) return;/);
  assert.match(bot, /else if \(type === 'air_movement'\) await askFlightAircraft\(ctx, d\)/);
  assert.match(bot, /d\.aerialMode = 'over';[\s\S]{0,100}askLocation\(ctx, d\)/);
  assert.ok(bot.includes('bot.callbackQuery(/^airmode:over$/'), 'legacy movement callback is no longer registered');
});

test('new movement flow skips manual origin and asks directly for a Syrian destination', () => {
  const start = bot.indexOf('bot.callbackQuery(/^flight:');
  const end = bot.indexOf('bot.callbackQuery(/^flightto:', start);
  const directionHandler = bot.slice(start, end);
  assert.match(directionHandler, /d\.flightRouteOrigin = 'israel_approx_reference'/);
  assert.match(directionHandler, /d\.selectingFlightTarget = true;[\s\S]{0,100}askFlightDestination\(ctx, d\)/);
  assert.doesNotMatch(directionHandler, /askLocation\(ctx, d\)/);
  assert.match(bot, /flightto:\(syria\|back\|\\d\{1,2\}\)/);
  assert.match(bot, /locationFrom\(\{ govCode: choice \}\)/);
  assert.match(bot, /d\.location = target/);
  assert.match(bot, /d\.flightRouteOrigin === 'israel_approx_reference'[\s\S]{0,180}askFlightDirection\(ctx, d\)/);
  assert.match(bot, /Change movement direction/);
  assert.match(bot, /Illustrative direction only — not live tracking\./);
});

test('movement directions remain separate and supported', () => {
  const directions = ['toward_syria', 'entering_syria', 'leaving_syria'];
  assert.deepEqual(Object.keys(FLIGHT_DIRECTIONS), directions);
  assert.equal(FLIGHT_DIRECTIONS.toward_syria.ar, 'باتجاه سوريا');
  assert.match(FLIGHT_DIRECTIONS.entering_syria.ar, /دخول الأجواء السورية/);
  assert.equal(FLIGHT_DIRECTIONS.leaving_syria.ar, 'انسحاب إلى الداخل الإسرائيلي');
  assert.equal(FLIGHT_DIRECTIONS.leaving_syria.en, 'Withdrawal into Israel');
  assert.match(bot, /flight:\(toward_syria\|entering_syria\|leaving_syria\)/);
  assert.match(bot, /d\.flightDirection = ctx\.match\[1\]/);
  assert.match(bot, /اختر الاتجاه[\s\S]{0,180}نقطة مرجعية تقريبية داخل إسرائيل/);
});
