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

test('new movement flow selects observation origin first and Syria/governorate destination second', () => {
  assert.match(bot, /d\.selectingFlightOrigin = true;[\s\S]{0,100}askLocation\(ctx, d\)/);
  assert.match(bot, /if \(d\.selectingFlightOrigin\)[\s\S]{0,220}askFlightDestination\(ctx, d\)/);
  assert.match(bot, /flightto:\(syria\|back\|\\d\{1,2\}\)/);
  assert.match(bot, /locationFrom\(\{ govCode: choice \}\)/);
  assert.match(bot, /Illustrative direction only — not live tracking\./);
});

test('movement directions remain separate and supported', () => {
  const directions = ['toward_syria', 'entering_syria', 'leaving_syria'];
  assert.deepEqual(Object.keys(FLIGHT_DIRECTIONS), directions);
  assert.match(bot, /flight:\(toward_syria\|entering_syria\|leaving_syria\)/);
  assert.match(bot, /d\.flightDirection = ctx\.match\[1\]/);
});
