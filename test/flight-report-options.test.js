import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FLIGHT_DIRECTIONS } from '../shared/types.js';

const bot = await readFile(new URL('../server/bot.js', import.meta.url), 'utf8');

test('warplane menu omits aircraft movement while the UAV menu retains it', () => {
  assert.match(bot, /Hovering over the area[^\n]*airmode:over/);
  assert.match(bot, /if \(d\.type === 'uav'\) kb\.text\(en \? `\$\{aircraft\} Aircraft movement` : `\$\{aircraft\} حركة طيران`, 'airmode:move'\)/);
  assert.match(bot, /if \(ctx\.match\[1\] === 'move' && d\.type !== 'uav'\) return;/, 'stale warplane movement callbacks are rejected');
  assert.match(bot, /d\.aerialMode = 'over';[\s\S]{0,100}askLocation\(ctx, d\)/);
  assert.match(bot, /d\.type = 'air_movement';[\s\S]{0,100}askFlightDirection\(ctx, d\)/);
});

test('the movement buttons persist only the three supported directions', () => {
  const directions = ['toward_syria', 'entering_syria', 'leaving_syria'];
  assert.deepEqual(Object.keys(FLIGHT_DIRECTIONS), directions);
  assert.match(bot, /flight:\(toward_syria\|entering_syria\|leaving_syria\)/);
  assert.match(bot, /d\.flightDirection = ctx\.match\[1\]/);
});
