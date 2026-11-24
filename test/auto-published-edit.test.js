import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const monitor = await readFile(new URL('../server/news-monitor.js', import.meta.url), 'utf8');
const bot = await readFile(new URL('../server/bot.js', import.meta.url), 'utf8');

test('auto-published notices offer an in-place story-format edit', () => {
  assert.match(monitor, /تعديل صيغة الخبر/);
  assert.match(monitor, /d\.status !== 'published' \|\| !d\.auto \|\| !d\.alertId/);
  assert.match(monitor, /loadPublishedDraft\(ctx, toBotDraft\(latest\), d\.alertId\)/);
});

test('published story edits use a dedicated save mode instead of publish', () => {
  assert.match(bot, /mode === 'edit_published'/);
  assert.match(bot, /publishedAlertId/);
  assert.match(bot, /bot\.callbackQuery\('save_edit'/);
  assert.match(bot, /editPublishedAlert\(ctx\.api, d\.publishedAlertId/);
});
