import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FLIGHT_DIRECTIONS } from '../shared/types.js';

const bot = await readFile(new URL('../server/bot.js', import.meta.url), 'utf8');

test('overflight and aircraft movement remain separate bot choices', () => {
  assert.match(bot, /Hovering over the area[^\n]*airmode:over/);
  assert.match(bot, /Aircraft movement[^\n]*airmode:move/);
  assert.match(bot, /d\.aerialMode = 'over';[\s\S]{0,100}askLocation\(ctx, d\)/);
  assert.match(bot, /d\.type = 'air_movement';[\s\S]{0,100}askFlightDirection\(ctx, d\)/);
});

test('the movement buttons persist only the three supported directions', () => {
  const directions = ['toward_syria', 'entering_syria', 'leaving_syria'];
  assert.deepEqual(Object.keys(FLIGHT_DIRECTIONS), directions);
  assert.match(bot, /flight:\(toward_syria\|entering_syria\|leaving_syria\)/);
  assert.match(bot, /d\.flightDirection = ctx\.match\[1\]/);
});
