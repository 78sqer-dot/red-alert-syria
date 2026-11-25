import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-ai-hold-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = 'test-only-not-a-real-token';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';

const { store } = await import('../server/store.js');
await store.init(null);
const { newsState, _test } = await import('../server/news-monitor.js');
globalThis.fetch = async () => { throw new Error('offline in tests'); };

const item = (url, text) => ({ src: { u: 'https://t.me/src', name: 'مصدر', local: false }, url, ts: Date.now(), qAt: Date.now() - 10 * 60_000, text, breaking: false, media: null });

test('AI outage holds items with a clear flag instead of classifying them', () => {
  const n = newsState();
  n.aiHeld = {};
  _test.holdAiDownItems([item('https://t.me/src/1', 'خبر أول محتجَز'), item('https://t.me/src/2', 'خبر ثانٍ محتجَز')]);
  assert.deepEqual(Object.keys(n.aiHeld).sort(), ['https://t.me/src/1', 'https://t.me/src/2']);
  assert.equal(n.aiHeld['https://t.me/src/1'].src.name, 'مصدر');
  _test.holdAiDownItems([item('https://t.me/src/1', 'مكرر')]);
  assert.equal(Object.keys(n.aiHeld).length, 2, 'the same url is never held twice');
});

test('recovery re-queues held items for classification and clears the hold', () => {
  const n = newsState();
  const before = _test.R.queue.length;
  const back = _test.recoverAiHeldItems('backup');
  assert.equal(back, 2);
  assert.equal(Object.keys(n.aiHeld).length, 0);
  assert.equal(_test.R.queue.length, before + 2);
  const urls = _test.R.queue.map((q) => q.url);
  assert.ok(urls.includes('https://t.me/src/1') && urls.includes('https://t.me/src/2'));
});
