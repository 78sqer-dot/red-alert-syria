import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ALERT_GROUPS, ALERT_TYPES, FLIGHT_DIRECTIONS, TYPE_MENU } from '../shared/types.js';
const bot = await readFile(new URL('../server/bot.js', import.meta.url), 'utf8');

test('aircraft movement stays on the canonical menu but its report flow is disabled (owner decision)', () => {
  // The unified TYPE_MENU (approved 2026-11-17) lists air_movement in the air
  // group and the bot menu is generated from it, but the owner reaffirmed the
  // older decision the same day: the public report flow stays disabled — the
  // t: handler rejects the tap with «لم يعد متاحاً» before any draft opens.
  assert.match(bot, /BOT_ALERT_MENU_GROUPS = Object\.freeze\(Object\.fromEntries\(TYPE_MENU_GROUPS\.map/);
  assert.match(bot, /type === 'air_movement'[\s\S]{0,300}لم يعد متاحاً/, 'the t: handler rejects air_movement taps as no longer available');
  const air = TYPE_MENU.find((g) => g.key === 'air');
  assert.ok(air.types.includes('air_movement'), 'air_movement remains listed in the air group');
  assert.ok(ALERT_GROUPS.aerial.types.includes('air_movement'), 'the map category still recognizes movement alerts');
  assert.ok(ALERT_TYPES.air_movement, 'the alert type remains supported');
});

test('existing movement direction labels remain available for archived records', () => {
  assert.deepEqual(Object.keys(FLIGHT_DIRECTIONS), ['toward_syria', 'entering_syria', 'leaving_syria']);
  assert.equal(FLIGHT_DIRECTIONS.toward_syria.ar, 'باتجاه سوريا');
  assert.match(FLIGHT_DIRECTIONS.entering_syria.ar, /دخول الأجواء السورية/);
  assert.equal(FLIGHT_DIRECTIONS.leaving_syria.ar, 'انسحاب إلى الداخل الإسرائيلي');
  assert.equal(FLIGHT_DIRECTIONS.leaving_syria.en, 'Withdrawal into Israel');
});
