import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALERT_TYPES, POLITICAL_CATEGORIES, alertButtonLabel, eventVisual } from '../shared/types.js';

const root = new URL('../', import.meta.url);
const bot = readFileSync(new URL('server/bot.js', root), 'utf8');
const map = readFileSync(new URL('public/js/map.js', root), 'utf8');

test('protest action and demonstration keep distinct bot labels and map glyphs', () => {
  assert.equal(ALERT_TYPES.protest.emoji, '👥');
  assert.equal(ALERT_TYPES.protest.mapEmoji, undefined);
  assert.equal(ALERT_TYPES.protest.glyph, 'protest');
  assert.equal(ALERT_TYPES.protest_action.emoji, '📢');
  assert.equal(ALERT_TYPES.protest_action.glyph, 'megaphone');
  assert.equal(alertButtonLabel('protest', 'ar'), '👥 مظاهرة');
  assert.equal(alertButtonLabel('protest_action', 'ar'), '📢 احتجاج');
  assert.match(map, /const iconColor = visual\.color/);
  assert.equal(eventVisual('protest').dot, '🟢');
  assert.doesNotMatch(map, /mapEmoji|mk-event-emoji/);
});

test('bot button omits the colored gun emoji while the underlying marker type keeps it', () => {
  assert.equal(ALERT_TYPES.smuggling_weapons.emoji, '🔫');
  assert.doesNotMatch(alertButtonLabel('smuggling_weapons', 'ar'), /🔫/);
  assert.doesNotMatch(alertButtonLabel('smuggling_weapons', 'en'), /🔫/);
  assert.match(bot, /alertButtonLabel\(item\.type, lang\)/);
});

test('bot labels omit blank emoji placeholders and political categories have distinct symbols', () => {
  assert.equal(ALERT_TYPES.shooting.emoji, '');
  assert.equal(alertButtonLabel('shooting', 'ar'), 'إطلاق نار');
  assert.equal(alertButtonLabel('shooting', 'en'), 'Gunfire');
  assert.deepEqual(Object.values(POLITICAL_CATEGORIES).map((category) => category.emoji), ['💬', '📜', '🏛️', '📢', '🏢', '🤝', '👥', '🗳️']);
  assert.deepEqual(['government_announcement', 'official_announcement', 'official_entity'].map((key) => POLITICAL_CATEGORIES[key].ar), ['إعلان حكومي', 'إعلان رسمي', 'جهة رسمية']);
  assert.match(bot, /alertButtonLabel\(item\.type, lang\)/);
  assert.match(bot, /\[label\.emoji, en \? label\.en : label\.ar\]\.filter\(Boolean\)\.join\(' '\)/);
  assert.match(bot, /🚙 Military vehicles/);
});
