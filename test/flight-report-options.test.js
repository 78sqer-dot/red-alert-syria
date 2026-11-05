import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ALERT_GROUPS, ALERT_TYPES, FLIGHT_DIRECTIONS } from '../shared/types.js';
const bot = await readFile(new URL('../server/bot.js', import.meta.url), 'utf8');

test('new bot menus and stale callbacks exclude the Syria-direction movement option', () => {
  assert.match(bot, /aerial: Object\.freeze\(ALERT_GROUPS\.aerial\.types\.filter\(\(type\) => type !== 'uav_strike' && type !== 'air_movement'\)\)/);
  assert.match(bot, /if \(type === 'air_movement'\) \{[\s\S]{0,180}لم يعد متاحاً/);
  assert.doesNotMatch(bot, /airmode:move|حركة طيران`/);
  assert.ok(ALERT_GROUPS.aerial.types.includes('air_movement'), 'the map category still recognizes archived movement alerts');
  assert.ok(ALERT_TYPES.air_movement, 'the archived alert type remains supported');
});

test('existing movement direction labels remain available for archived records', () => {
  assert.deepEqual(Object.keys(FLIGHT_DIRECTIONS), ['toward_syria', 'entering_syria', 'leaving_syria']);
  assert.equal(FLIGHT_DIRECTIONS.toward_syria.ar, 'باتجاه سوريا');
  assert.match(FLIGHT_DIRECTIONS.entering_syria.ar, /دخول الأجواء السورية/);
  assert.equal(FLIGHT_DIRECTIONS.leaving_syria.ar, 'انسحاب إلى الداخل الإسرائيلي');
  assert.equal(FLIGHT_DIRECTIONS.leaving_syria.en, 'Withdrawal into Israel');
});
