import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-news-acceptance-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
process.env.PUBLIC_URL = 'https://example.invalid';
process.env.ALERT_IMAGES = 'false';

const { store } = await import('../server/store.js');
await store.init(null);
const { buildAlertInput, createBot } = await import('../server/bot.js');
const { NEWS_TYPES } = await import('../server/news-ai.js');
const { dayAutoReady, newsState } = await import('../server/news-monitor.js');

const ownerId = 8270709633;
const owner = { id: ownerId, is_bot: false, first_name: 'Local owner', language_code: 'ar' };
const bot = createBot();
bot.botInfo = { id: 1, is_bot: true, first_name: 'Local news test', username: 'LocalNewsTestBot' };
const calls = [];
let messageId = 1000;
bot.api.config.use(async (_previous, method, payload) => {
  calls.push({ method, chatId: payload?.chat_id });
  if (method === 'sendMessage') {
    return { ok: true, result: { message_id: ++messageId, chat: { id: payload.chat_id, type: payload.chat_id === ownerId ? 'private' : 'channel' }, date: 0, text: payload.text || '' } };
  }
  if (method === 'editMessageText') {
    return { ok: true, result: { message_id: payload.message_id, chat: { id: payload.chat_id, type: 'private' }, date: 0, text: payload.text || '' } };
  }
  return { ok: true, result: true };
});

let updateId = 1;
const tap = async (data) => bot.handleUpdate({
  update_id: updateId++,
  callback_query: {
    id: `local-${updateId}`,
    from: owner,
    chat_instance: 'local',
    data,
    message: { message_id: 700, date: 0, chat: { id: ownerId, type: 'private' }, from: bot.botInfo, text: 'Local test draft' },
  },
});

test('every monitored alert type builds, and accepting the same mock draft twice posts once', async (t) => {
  assert.equal(dayAutoReady({ id: '4e55a74b59', status: 'pending', test: false, rule: false, srcs: [{ u: 'mock-source', local: false }], dayAutoAt: Date.now() - 1 }), false, 'the owner-designated live draft stays manual and pending');
  const addedAlertIds = [];
  const draftId = 'a1b2c3d4e5';
  t.after(async () => {
    delete newsState().drafts[draftId];
    for (const id of addedAlertIds) store.deleteAlert(id);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  for (const type of NEWS_TYPES) {
    const input = buildAlertInput({ type, location: { scope: 'country' }, extra: [], ttlMin: 60 }, { id: ownerId, name: 'test' });
    assert.ok(input.title, `${type} must have a publish title`);
    assert.ok(input.title_en, `${type} must have an English publish title`);
  }

  const before = new Set(store.state.alerts.map((alert) => alert.id));
  newsState().drafts[draftId] = {
    id: draftId,
    type: 'assassination',
    status: 'pending',
    headline: 'خبر محاكاة محلي',
    body: 'تفاصيل محاكاة محلية',
    loc: { scope: 'place', name_ar: 'حارم', name_en: 'Harem', governorate_ar: 'إدلب', governorate_en: 'Idlib' },
    extra: [],
    ttlMin: 360,
    srcs: [{ u: 'mock-source', local: false }],
    cards: [],
    created: Date.now(),
  };

  const callback = `nw:p:${draftId}`;
  await tap(callback);
  assert.equal(newsState().drafts[draftId].status, 'published');

  await tap(callback);
  assert.equal(newsState().drafts[draftId].status, 'published');

  const newAlerts = store.state.alerts.filter((alert) => !before.has(alert.id));
  addedAlertIds.push(...newAlerts.map((alert) => alert.id));
  assert.equal(newAlerts.length, 1, 'the repeated approval must not create another map alert');
  assert.equal(calls.filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length, 1, 'the repeated approval must not post to the channel twice');
  assert.ok(calls.every((call) => !call.chatId || call.chatId === ownerId || call.chatId === process.env.CHANNEL_ID), 'all Telegram API calls are intercepted locally');
});
