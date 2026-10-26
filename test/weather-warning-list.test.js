import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-weather-list-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_weather_channel';

const { store } = await import('../server/store.js');
await store.init(null);
const { createBot } = await import('../server/bot.js');

const ownerId = 8270709633;
const owner = { id: ownerId, is_bot: false, first_name: 'Local owner', language_code: 'ar' };
const bot = createBot();
bot.botInfo = { id: 1, is_bot: true, first_name: 'Local weather test', username: 'LocalWeatherTestBot' };
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
const sendText = async (text) => bot.handleUpdate({
  update_id: updateId++,
  message: {
    message_id: ++messageId, date: 0, chat: { id: ownerId, type: 'private' }, from: owner, text,
    ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.length }] } : {}),
  },
});
const tap = async (data) => bot.handleUpdate({
  update_id: updateId++,
  callback_query: {
    id: `local-${updateId}`, from: owner, chat_instance: 'local', data,
    message: { message_id: 700, date: 0, chat: { id: ownerId, type: 'private' }, from: bot.botInfo, text: 'Local test screen' },
  },
});
const lastUi = () => [...calls].reverse().find(({ method }) => method === 'sendMessage' || method === 'editMessageText');
const buttonsOf = (entry) => entry?.payload?.reply_markup?.inline_keyboard?.flat() || [];

test('private weather menu lists active warnings and keeps delete confirmations local/read-only', async (t) => {
  const created = [];
  t.after(async () => {
    for (const id of created) store.deleteAlert(id);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  store.setAutoDelete(24);
  const expiring = store.addAlert({
    type: 'weather', source: 'weather', title: 'اختبار أمطار حلب', title_en: 'Local Aleppo rain test', ttlMin: 60,
    location: { latitude: 36.2, longitude: 37.1, name_ar: 'اختبار محلي', name_en: 'Local test', governorate_ar: 'حلب', governorate_en: 'Aleppo' },
    meta: { hazard: 'rain' },
  });
  created.push(expiring.id);
  const noExpiry = store.addAlert({
    type: 'weather', source: 'weather', title: 'اختبار رياح إدلب', title_en: 'Local Idlib wind test', ttlMin: 60,
    location: { latitude: 35.9, longitude: 36.6, name_ar: 'اختبار محلي', name_en: 'Local test', governorate_ar: 'إدلب', governorate_en: 'Idlib' },
    meta: { hazard: 'wind' },
  });
  created.push(noExpiry.id);
  store.updateAlert(noExpiry.id, { expires_at: null });
  const before = new Map(created.map((id) => [id, { ...store.getAlert(id) }]));

  await sendText('/start');
  assert.ok(buttonsOf(lastUi()).some((button) => button.callback_data === 'wx'), 'home menu opens weather warnings');

  await tap('wx');
  const weatherMenu = lastUi();
  assert.ok(buttonsOf(weatherMenu).some((button) => button.callback_data === 'auto'), '1h/24h/48h/never duration control remains reachable');
  assert.ok(buttonsOf(weatherMenu).some((button) => button.callback_data === 'wxw:list:0'), 'weather menu links to the active published-warning list');

  await tap('wxw:list:0');
  const list = lastUi();
  assert.match(list.payload.text, /التحذيرات الجوية المنشورة والنشطة/);
  assert.match(list.payload.text, /اختبار أمطار حلب/);
  assert.match(list.payload.text, /ينتهي/);
  assert.match(list.payload.text, /اختبار رياح إدلب/);
  assert.match(list.payload.text, /بلا انتهاء/);
  const listButtons = buttonsOf(list);
  const deleteButtons = listButtons.filter((button) => button.callback_data?.startsWith('wxw:delete:'));
  assert.equal(deleteButtons.length, 2, 'each active weather warning has one explicit delete button');
  assert.ok(listButtons.some((button) => button.callback_data === 'auto'), 'duration remains accessible from the warning list');

  await tap(deleteButtons[0].callback_data);
  const confirmation = lastUi();
  assert.match(confirmation.payload.text, /تأكيد حذف تحذير الطقس/);
  assert.ok(buttonsOf(confirmation).some((button) => button.callback_data?.startsWith('wxw:confirm:')));
  assert.ok(buttonsOf(confirmation).some((button) => button.callback_data === 'wxw:list:0'), 'cancellation returns to the list');

  for (const id of created) {
    const after = store.getAlert(id);
    assert.equal(after.is_active, before.get(id).is_active, 'opening the list/confirmation does not change alert activity');
    assert.equal(after.expires_at, before.get(id).expires_at, 'opening the list/confirmation does not change the expiry');
    assert.equal(after.title, before.get(id).title, 'opening the list/confirmation does not change alert content');
  }
  assert.equal(calls.some(({ method, payload }) => payload.chat_id === process.env.CHANNEL_ID && /^(sendMessage|sendPhoto|editMessageText|editMessageCaption|deleteMessage)$/.test(method)), false, 'local UI verification makes no channel post/edit/delete calls');
});
