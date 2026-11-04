import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FLIGHT_DIRECTIONS } from '../shared/types.js';

const bot = await readFile(new URL('../server/bot.js', import.meta.url), 'utf8');

test('warplanes and UAVs both offer movement while hovering stays separate', () => {
  assert.match(bot, /kb\.text\(en \? `\$\{aircraft\} Aircraft movement` : `\$\{aircraft\} حركة طيران`, 'airmode:move'\)/);
  assert.match(bot, /if \(d\.type !== 'uav' && d\.type !== 'warplane'\) return;/);
  assert.match(bot, /d\.aircraft = d\.type;[\s\S]{0,80}d\.type = 'air_movement'/);
  assert.match(bot, /d\.aerialMode = 'over';[\s\S]{0,100}askLocation\(ctx, d\)/);
});

test('new movement flow asks for the observed origin before offering a destination', () => {
  const start = bot.indexOf('bot.callbackQuery(/^flight:');
  const end = bot.indexOf('bot.callbackQuery(/^flightto:', start);
  const directionHandler = bot.slice(start, end);
  assert.match(directionHandler, /d\.selectingFlightOrigin = true/);
  assert.match(directionHandler, /d\.selectingFlightTarget = false/);
  assert.match(directionHandler, /await askLocation\(ctx, d\)/);
  assert.match(bot, /if \(d\.selectingFlightOrigin\)[\s\S]{0,200}d\.selectingFlightTarget = true;[\s\S]{0,100}d\.location = loc;[\s\S]{0,100}askFlightDestination\(ctx, d\)/);
  assert.match(bot, /flightto:\(syria\|back\|\\d\{1,2\}\)/);
  assert.match(bot, /locationFrom\(\{ govCode: choice \}\)/);
  assert.match(bot, /d\.flightTarget = target/);
  assert.match(bot, /flightOrigin = d\.type === 'air_movement' && d\.selectingFlightOrigin === true/);
  assert.match(bot, /name_ar: 'نقطة رصد تقريبية'[\s\S]{0,160}latitude: lat, longitude: lon/);
  assert.doesNotMatch(bot, /flightRouteOrigin\s*=/, 'the bot must never invent a flight origin');
  assert.match(bot, /Illustrative direction only — not live tracking\./);
});

test('movement directions remain separate and require a selected observation point', () => {
  const directions = ['toward_syria', 'entering_syria', 'leaving_syria'];
  assert.deepEqual(Object.keys(FLIGHT_DIRECTIONS), directions);
  assert.equal(FLIGHT_DIRECTIONS.toward_syria.ar, 'باتجاه سوريا');
  assert.match(FLIGHT_DIRECTIONS.entering_syria.ar, /دخول الأجواء السورية/);
  assert.equal(FLIGHT_DIRECTIONS.leaving_syria.ar, 'انسحاب إلى الداخل الإسرائيلي');
  assert.equal(FLIGHT_DIRECTIONS.leaving_syria.en, 'Withdrawal into Israel');
  assert.match(bot, /flight:\(toward_syria\|entering_syria\|leaving_syria\)/);
  assert.match(bot, /d\.flightDirection = ctx\.match\[1\]/);
  assert.match(bot, /Choose the approximate observation point for this route/);
  assert.match(bot, /اختر <b>نقطة رصد تقريبية<\/b> لهذا المسار/);
  assert.match(bot, /ليست موقعاً مباشراً للطائرة/);
});
