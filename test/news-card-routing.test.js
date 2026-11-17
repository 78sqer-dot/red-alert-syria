import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

// Regression pin: automatic news-monitor drafts must reach the owner on their
// correct buttons — the review card is built by cardKb (all callbacks under the
// `nw:` prefix handled only by the admin/publishing bot), sent through the
// admin bot API to the shared owner accounts, and never enters the report-bot
// relay flow used for human reports.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-card-routing-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:mock-token';
process.env.OWNER_IDS = '8270709633,8808894711';
process.env.CHANNEL_ID = '@mock_news_channel';
const { store } = await import('../server/store.js');
await store.init(null);
const mon = await import('../server/news-monitor.js');

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

const draft = {
  id: 'abc123', type: 'explosion', headline: 'انفجار في إدلب',
  loc: { scope: 'place', name_ar: 'إدلب', governorate_ar: 'إدلب', latitude: 35.93, longitude: 36.63 },
  extra: [], srcs: [{ u: 's1', name: 'مصدر', url: 'https://t.me/s1/1', local: false }],
  ts: Date.now(), created: Date.now(), status: 'pending',
};
const callbacks = (kb) => kb.inline_keyboard.flat().map((b) => b.callback_data).filter(Boolean);

test('monitor draft card carries the full review keyboard under the nw: prefix', () => {
  const data = callbacks(mon._test.cardKb(draft, 'ar', 8270709633));
  for (const expected of ['nw:p:abc123', 'nw:x:abc123', 'nw:t:abc123', 'nw:e:abc123', 'nw:rw:abc123', 'nw:c:abc123']) {
    assert.ok(data.includes(expected), `missing review button ${expected}`);
  }
  assert.ok(data.every((x) => x.startsWith('nw:')), 'every card callback belongs to the news-monitor handler namespace');
});

test('owner-only editorial buttons appear only for an owner chat', () => {
  const owner = callbacks(mon._test.cardKb(draft, 'ar', 8270709633));
  assert.ok(owner.includes('nw:op:abc123') && owner.includes('nw:sa:abc123'));
  const other = callbacks(mon._test.cardKb(draft, 'ar', 111222333));
  assert.ok(!other.some((x) => x.startsWith('nw:op:') || x.startsWith('nw:sa:')), 'private editorial buttons are owner-only');
  assert.ok(other.includes('nw:p:abc123'), 'core review buttons remain for editors');
});

test('news tools and cards are wired to the admin (publishing) bot only', async () => {
  const botSource = await readFile(new URL('../server/bot.js', import.meta.url), 'utf8');
  assert.match(botSource, /if \(role === 'admin'\) \{[^}]*registerNewsTools\(bot, OH\)/,
    'registerNewsTools (the nw: callback handlers) is installed only on the admin bot');
  const reportBranch = botSource.match(/else \{ registerJobsTools\(bot, OH, role\); registerReportOwnerCommands\(bot, OH\); \}/);
  assert.ok(reportBranch, 'the report bot branch installs report commands only — no news tools');
  const monitorSource = await readFile(new URL('../server/news-monitor.js', import.meta.url), 'utf8');
  assert.match(monitorSource, /const api = \(\) => R\.H\?\.\apis\(\)\.admin \|\| null;/,
    'monitor cards are sent through the admin bot API');
  assert.match(monitorSource, /const reviewerIds = \(\) => automaticMonitorRecipientIds\(\);/,
    'monitor cards go to the shared owner accounts');
  assert.doesNotMatch(monitorSource, /apis\(\)\.report|APIS\.report|relayCopy/,
    'the news monitor never touches the report-bot relay flow');
});
