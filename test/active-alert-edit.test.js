import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bot = readFileSync(new URL('../server/bot.js', import.meta.url), 'utf8');

test('active alert management exposes edit only for active alerts with an existing channel post', () => {
  assert.match(bot, /if \(a\.is_active && a\.channel_message_id\)[\s\S]{0,160}'editpost:' \+ a\.id/);
  assert.match(bot, /bot\.callbackQuery\(\/\^editpost:/);
  assert.match(bot, /if \(!a\?\.is_active \|\| !a\.channel_message_id\)/);
});

test('editing an active alert previews headline, details, and location before saving the existing post', () => {
  assert.match(bot, /'editfield:title'/);
  assert.match(bot, /'editfield:details'/);
  assert.match(bot, /'editfield:location'/);
  assert.match(bot, /'editpreview'/);
  assert.match(bot, /'editsave'/);
  assert.match(bot, /d\.step = 'preview'/);
  assert.match(bot, /if \(!staff\(ctx\) \|\| d\?\.mode !== 'active_edit' \|\| d\.step !== 'preview'\) return/);
  assert.match(bot, /editMessageCaption\(config\.channel, a\.channel_message_id/);
  assert.match(bot, /editMessageText\(config\.channel, a\.channel_message_id/);
  assert.match(bot, /store\.updateAlert\(a\.id, \{ title: d\.editTitle, description: d\.details, place, extra:/);
});
