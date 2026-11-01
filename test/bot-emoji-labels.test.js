import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALERT_TYPES, POLITICAL_CATEGORIES, alertButtonLabel } from '../shared/types.js';

const root = new URL('../', import.meta.url);
const bot = readFileSync(new URL('server/bot.js', root), 'utf8');
const map = readFileSync(new URL('public/js/map.js', root), 'utf8');

test('the protest keeps its original megaphone emoji on the map and in bot labels', () => {
  assert.equal(ALERT_TYPES.protest.emoji, '📢');
  assert.equal(ALERT_TYPES.protest.mapEmoji, true);
  assert.equal(alertButtonLabel('protest', 'ar'), '📢 مظاهرة');
  assert.match(map, /t\.mapEmoji && t\.emoji[\s\S]{0,180}mk-event-emoji/);
});

test('bot labels omit blank emoji placeholders and political categories have distinct symbols', () => {
  assert.equal(ALERT_TYPES.shooting.emoji, '');
  assert.equal(alertButtonLabel('shooting', 'ar'), 'إطلاق نار');
  assert.equal(alertButtonLabel('shooting', 'en'), 'Gunfire');
  assert.deepEqual(Object.values(POLITICAL_CATEGORIES).map((category) => category.emoji), ['💬', '📜', '🤝', '👥', '🗳️']);
  assert.match(bot, /alertButtonLabel\(k, lang\)/);
  assert.match(bot, /\[label\.emoji, en \? label\.en : label\.ar\]\.filter\(Boolean\)\.join\(' '\)/);
  assert.match(bot, /🚙 Military vehicles only/);
});
