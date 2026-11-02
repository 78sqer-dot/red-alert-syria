import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALERT_TYPES, POLITICAL_CATEGORIES, alertButtonLabel } from '../shared/types.js';

const root = new URL('../', import.meta.url);
const bot = readFileSync(new URL('server/bot.js', root), 'utf8');
const map = readFileSync(new URL('public/js/map.js', root), 'utf8');

test('protest keeps its megaphone in bot labels and uses the shared black map glyph', () => {
  assert.equal(ALERT_TYPES.protest.emoji, '📢');
  assert.equal(ALERT_TYPES.protest.mapEmoji, undefined);
  assert.equal(ALERT_TYPES.protest.glyph, 'protest');
  assert.equal(alertButtonLabel('protest', 'ar'), '📢 مظاهرة');
  assert.match(map, /class="ic ic-\$\{glyph\}" style="--ic:#111827/);
  assert.doesNotMatch(map, /mapEmoji|mk-event-emoji/);
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
