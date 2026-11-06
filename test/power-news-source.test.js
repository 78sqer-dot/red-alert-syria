import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-power-source-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = process.env.BOT_TOKEN || '123456:LOCAL_TEST';
const { store } = await import('../server/store.js');
const { isPowerNews, onNewsPost } = await import('../server/services.js');

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 400));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

test('official SANA Telegram electricity post enters admin review without auto-publishing', () => {
  const previous = store.state.svc;
  store.state.svc = { powerNews: { on: true, day: '', count: 0 }, power: [] };
  try {
    const text = 'وزارة الكهرباء تعلن برنامج التقنين الجديد في مدينة دمشق';
    assert.equal(onNewsPost({
      src: { u: 'qasiounar1', name: 'قاسيون' },
      url: 'https://t.me/qasiounar1/189946', text, ts: Date.now(),
    }), false, 'an unrelated Telegram channel is not accepted as an official source');
    assert.equal(onNewsPost({
      src: { u: 'sana_gov', name: 'وكالة الأنباء السورية (سانا)' },
      url: 'https://t.me/sana_gov/189946', text, ts: Date.now(),
    }), true, 'the existing verified SANA feed is accepted');

    const [pending] = store.state.svc.power;
    assert.ok(pending);
    assert.equal(pending.pub, false, 'the new update remains unpublished until an administrator approves it');
    assert.equal(pending.src.url, 'https://t.me/sana_gov/189946');
    assert.equal(pending.gov, isPowerNews(text).gov, 'the detected Syrian governorate is retained');
  } finally {
    if (previous === undefined) delete store.state.svc;
    else store.state.svc = previous;
  }
});
