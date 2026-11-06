import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-news-source-button-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
process.env.PRIMARY_OWNER_ID = '8808894711';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';

const { store } = await import('../server/store.js');
await store.init(null);
const { createBot } = await import('../server/bot.js');
const bot = createBot();
bot.botInfo = { id: 1, is_bot: true, first_name: 'Local test', username: 'LocalTestBot' };
const calls = [];
let messageId = 900;
bot.api.config.use(async (_previous, method, payload) => {
  calls.push({ method, payload: structuredClone(payload) });
  if (method === 'sendMessage') {
    return { ok: true, result: { message_id: ++messageId, chat: { id: payload.chat_id, type: 'private' }, date: 0, text: payload.text } };
  }
  if (method === 'editMessageText') {
    return { ok: true, result: { message_id: payload.message_id, chat: { id: payload.chat_id, type: 'private' }, date: 0, text: payload.text } };
  }
  return { ok: true, result: true };
});

let updateId = 1;
const user = (id) => ({ id, is_bot: false, first_name: 'Local test user', language_code: 'ar' });
const sendText = async (id, text) => bot.handleUpdate({
  update_id: updateId++,
  message: {
    message_id: ++messageId, date: 0, chat: { id, type: 'private' }, from: user(id), text,
    ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.length }] } : {}),
  },
});
const tap = async (id, data) => bot.handleUpdate({
  update_id: updateId++,
  callback_query: {
    id: `local-${updateId}`, from: user(id), chat_instance: 'local', data,
    message: { message_id: 700 + updateId, date: 0, chat: { id, type: 'private' }, from: bot.botInfo, text: 'Local test screen' },
  },
});
const lastUi = (id) => [...calls].reverse().find(({ method, payload }) =>
  ['sendMessage', 'editMessageText'].includes(method) && payload.chat_id === id
);
const buttonsOf = (entry) => entry?.payload?.reply_markup?.inline_keyboard?.flat() || [];

test('Add source is inside the owner-only News monitor screen and keeps its source-list route', async (t) => {
  let originalSources;

  for (const id of [8808894711, 8270709633]) {
    await sendText(id, '/start');
    const menu = lastUi(id);
    assert.ok(buttonsOf(menu).some((button) => button.callback_data === 'nws'), `owner ${id} sees News monitor`);
    assert.equal(buttonsOf(menu).some((button) => button.callback_data === 'nws:sa' || button.callback_data === 'nws:sa:main'), false,
      `owner ${id} no longer sees Add source in the top-level menu`);

    await tap(id, 'nws');
    originalSources ??= structuredClone(store.state.news?.sources);
    const monitor = lastUi(id);
    assert.ok(buttonsOf(monitor).some((button) => button.callback_data === 'nws:sa:main'),
      `owner ${id} sees Add source inside News monitor`);
    assert.equal(buttonsOf(monitor).some((button) => button.callback_data === 'nws:sa'), false,
      'the main monitor uses the route that returns to the monitor screen');

    await tap(id, 'nws:sa:main');
    const directPrompt = lastUi(id);
    assert.match(directPrompt.payload.text, /أرسل معرّف قناة تيليغرام/);
    assert.match(directPrompt.payload.text, /عامة/);
    assert.ok(buttonsOf(directPrompt).some((button) => button.callback_data === 'nws'),
      'the direct prompt returns to the News monitor screen');

    await tap(id, 'nws:src');
    const sourceList = lastUi(id);
    if (buttonsOf(sourceList).some((button) => button.callback_data === 'nws:sa')) {
      await tap(id, 'nws:sa');
      const sourceListPrompt = lastUi(id);
      assert.ok(buttonsOf(sourceListPrompt).some((button) => button.callback_data === 'nws:src'),
        'the Sources-screen prompt returns to the Sources screen');
    } else {
      assert.match(sourceList.payload.text, /مصادر الرصد|Monitored sources/,
        'the Sources screen opens even when its Add source button is hidden at capacity');
    }
  }

  const editorId = 7000000001;
  store.addEditor(editorId);
  await sendText(editorId, '/start');
  assert.equal(buttonsOf(lastUi(editorId)).some((button) => button.callback_data === 'nws' || button.callback_data === 'nws:sa' || button.callback_data === 'nws:sa:main'), false,
    'an editor does not see owner-only News monitor controls');
  const from = calls.length;
  await tap(editorId, 'nws:sa:main');
  assert.equal(calls.slice(from).some(({ method, payload }) => method === 'editMessageText' && payload.chat_id === editorId), false,
    'a forged Add source callback does not open the prompt for an editor');
  assert.equal(calls.slice(from).some(({ method, payload }) => method === 'answerCallbackQuery' && /للمالك فقط|Owner only/.test(payload.text || '')), true,
    'the Add source callback explicitly rejects non-owners');

  assert.deepEqual(store.state.news?.sources, originalSources, 'opening either route does not add or change sources');
  assert.equal(calls.some(({ payload }) => payload.chat_id === process.env.CHANNEL_ID), false, 'the test sends no channel messages');

  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });
});
