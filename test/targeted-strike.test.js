import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ALERT_TYPES, ALERT_GROUPS, TYPE_MENU, alertEmoji, eventVisual } from '../shared/types.js';
import { EXTRA_SVG } from '../public/js/target-svgs.js';
import { TYPE_ICON } from '../public/js/type-icons.js';

const bot = await readFile(new URL('../server/bot.js', import.meta.url), 'utf8');
const map = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
const image = await readFile(new URL('../server/alert-image.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
const settings = await readFile(new URL('../public/js/settings.js', import.meta.url), 'utf8');

test('targeted strike is a separate report type in the canonical strikes group', () => {
  assert.equal(ALERT_TYPES.targeted_strike.ar, 'استهداف');
  assert.equal(ALERT_TYPES.targeted_strike.button_ar, 'استهداف');
  assert.equal(ALERT_TYPES.targeted_strike.emoji, '🎯');
  assert.equal(ALERT_TYPES.targeted_strike.glyph, 'target_reticle');
  assert.equal(ALERT_TYPES.targeted_strike.group, 'strikes');
  assert.ok(ALERT_GROUPS.strikes.types.includes('targeted_strike'));
  // the bot menu is generated from the canonical TYPE_MENU, whose strikes
  // group carries targeted_strike with assassination last
  assert.match(bot, /BOT_ALERT_MENU_GROUPS = Object\.freeze\(Object\.fromEntries\(TYPE_MENU_GROUPS\.map/);
  const strikes = TYPE_MENU.find((g) => g.key === 'strikes');
  assert.ok(strikes.types.includes('targeted_strike'));
  assert.equal(strikes.types.at(-1), 'assassination');
});

test('targeted strike has its own reticle on the map and the channel image', () => {
  assert.equal(eventVisual('targeted_strike').category, 'strikes');
  assert.equal(eventVisual('targeted_strike').color, '#c2410c');
  assert.equal(alertEmoji({ type: 'targeted_strike' }), '🎯');
  assert.equal(TYPE_ICON.targeted_strike, 'locate', 'the crosshair UI icon is targeted strike alone; uav_strike keeps target');
  assert.match(EXTRA_SVG.target_reticle, /circle cx="256" cy="256" r="160"/);
  assert.match(map, /a\.type === 'assassination' \? assassinationWeaponGlyph\(a\)[\s\S]{0,260}: t\.glyph/);
  assert.match(image, /targeted_strike: 'استهداف'/);
  assert.match(image, /targeted_strike: 'Targeted strike'/);
  assert.match(image, /targeted_strike: 'danger'/);
  assert.match(image, /GLYPHS\[glyphKey\] \|\| GLYPHS\[t\.glyph\]/);
});

test('browser cache keys refresh every client module that consumes the alert type registry', () => {
  assert.match(app, /shared\/types\.js\?v=43/);
  assert.match(app, /settings\.js\?v=14/);
  assert.match(app, /map\.js\?v=104/);
  assert.match(map, /shared\/types\.js\?v=43/);
  assert.match(map, /target-svgs\.js\?v=27/);
  assert.match(map, /type-icons\.js\?v=9/);
  assert.match(settings, /shared\/types\.js\?v=42/);
});
