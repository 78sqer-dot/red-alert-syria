import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-toward-guard-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '<redacted_bot_token_1>';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
process.env.PUBLIC_URL = 'https://example.invalid';
process.env.ALERT_IMAGES = 'false';

const { store, publicAlert } = await import('../server/store.js');
await store.init(null);
const { createBot } = await import('../server/bot.js');

const ownerId = 8270709633;
const owner = { id: ownerId, is_bot: false, first_name: 'Local owner', language_code: 'ar' };
const bot = createBot();
bot.botInfo = { id: 1, is_bot: true, first_name: 'Local admin test', username: 'LocalAdminTestBot' };
const reportBot = createBot({ role: 'report', token: '654321:LOCAL_REPORT_TEST' });
reportBot.botInfo = { id: 2, is_bot: true, first_name: 'Local report test', username: 'LocalReportTestBot' };

const calls = [];
let messageId = 9000;
const mockApi = async (_previous, method, payload) => {
  calls.push({ method, chatId: payload?.chat_id, payload: structuredClone(payload || {}) });
  if (method === 'sendMessage') return { ok: true, result: { message_id: ++messageId, chat: { id: payload.chat_id, type: 'private' }, date: 0, text: payload.text || '' } };
  if (method === 'editMessageText') return { ok: true, result: { message_id: payload.message_id, chat: { id: payload.chat_id, type: 'private' }, date: 0, text: payload.text || '' } };
  return { ok: true, result: true };
};
bot.api.config.use(mockApi);
reportBot.api.config.use(mockApi);

let updateId = 1;
const tap = async (data, user = owner, targetBot = bot) => targetBot.handleUpdate({
  update_id: updateId++,
  callback_query: {
    id: `repro-${updateId}`, from: user, chat_instance: 'local', data,
    message: { message_id: 700, date: 0, chat: { id: user.id, type: 'private' }, from: targetBot.botInfo, text: 'Local test draft' },
  },
});
const say = async (text, user, targetBot) => targetBot.handleUpdate({
  update_id: updateId++,
  message: { message_id: 800 + updateId, date: 0, chat: { id: user.id, type: 'private' }, from: user, text },
});
const lastText = () => [...calls].reverse().find((c) => c.payload?.text)?.payload.text || '';
const buttons = () => [...calls].reverse().find((c) => Array.isArray(c.payload?.reply_markup?.inline_keyboard))?.payload.reply_markup.inline_keyboard.flat() || [];
const tapText = async (substr, user, targetBot) => {
  const b = buttons().find((x) => x.text.includes(substr));
  assert.ok(b, `button containing «${substr}» exists; saw: ${buttons().map((x) => x.text).join(' | ')}`);
  await tap(b.callback_data, user, targetBot);
  return b;
};
const alertAnswers = () => calls.filter((c) => c.method === 'answerCallbackQuery' && c.payload?.show_alert).map((c) => c.payload.text);

async function pickSafiraDestination(user, targetBot) {
  await tap('g:09', user, targetBot); // Aleppo governorate
  // district list: tap As-Safira
  await tapText('السفيرة', user, targetBot);
  // whatever follows (places in district / whole district): prefer a whole-area option, else first place
  const bs = buttons();
  const whole = bs.find((x) => /كلها|المنطقة كاملة|كاملة/.test(x.text));
  if (whole) await tap(whole.callback_data, user, targetBot);
}

test('rap approve: toward report, city origin -> district destination, details name the destination (live failure 2026-11-26)', async () => {
  const reporter = { id: 8270709677, is_bot: false, first_name: 'Owner test reporter', language_code: 'ar' };
  const before = new Set(Object.keys(store.state.reports || {}));
  await tap('t:uav', reporter, reportBot);
  await tap('airmode:toward', reporter, reportBot);
  await tap('g:09', reporter, reportBot);
  await tap('p:170063', reporter, reportBot); // Aleppo city centre place
  await tap('g:09', reporter, reportBot);
  await tap('d:8276861', reporter, reportBot); // As-Safira district
  const whole = buttons().find((x) => /كامل|كلها/.test(x.text));
  if (whole) await tap(whole.callback_data, reporter, reportBot);
  if (buttons().some((b) => b.callback_data === 'skip')) await say('مسيرة باتجاه السفيرة', reporter, reportBot);
  assert.ok(buttons().some((b) => b.callback_data === 'submit'), 'submit offered');
  await tap('submit', reporter, reportBot);
  const rid = Object.keys(store.state.reports || {}).find((id) => !before.has(id));
  assert.ok(rid, 'pending report saved');
  const pending = store.reportGet(rid);
  calls.length = 0;
  await tap('rap:' + rid, owner, bot);
  const created = store.activeAlerts().filter((a) => a.type === 'uav').at(-1);
  assert.ok(created, 'approved toward report becomes a live alert');
});

test('rap approve: toward report, city origin -> district destination, details skipped (built title alone must not trip the guard)', async () => {
  const reporter = { id: 8270709678, is_bot: false, first_name: 'Owner test reporter 2', language_code: 'ar' };
  const before = new Set(Object.keys(store.state.reports || {}));
  await tap('t:uav', reporter, reportBot);
  await tap('airmode:toward', reporter, reportBot);
  await tap('g:09', reporter, reportBot);
  await tap('p:170063', reporter, reportBot);
  await tap('g:09', reporter, reportBot);
  await tap('d:8276861', reporter, reportBot);
  const whole = buttons().find((x) => /كامل|كلها/.test(x.text));
  if (whole) await tap(whole.callback_data, reporter, reportBot);
  if (buttons().some((b) => b.callback_data === 'skip')) await tap('skip', reporter, reportBot);
  assert.ok(buttons().some((b) => b.callback_data === 'submit'), 'submit offered');
  await tap('submit', reporter, reportBot);
  const rid = Object.keys(store.state.reports || {}).find((id) => !before.has(id));
  assert.ok(rid, 'pending report saved');
  calls.length = 0;
  await tap('rap:' + rid, owner, bot);
  const created = store.activeAlerts().filter((a) => a.type === 'uav').at(-1);
  assert.ok(created, 'approved toward report (no details) becomes a live alert');
});

test('guard still holds a toward draft whose SOURCE text names a third place (exemption is destination-only)', async () => {
  const { ensureDraftCardLocation } = await import('../server/publish-location-guard.js');
  const { locationFrom } = await import('../server/places.js');
  const origin = locationFrom({ placeId: 170063 }); // Aleppo city
  const target = { scope: 'district', district: '8276861', name_ar: 'السفيرة', governorate: '09', latitude: 36.07696, longitude: 37.37251 };
  const base = { type: 'uav', location: origin, aerialMode: 'toward', flightTarget: target, headline: 'تحليق مسيّرة — حلب — نحو السفيرة', body: '', sourceText: '' };
  const ok = ensureDraftCardLocation({ ...base });
  assert.equal(ok.action, 'present', `destination-only text passes, got ${JSON.stringify(ok)}`);
  const held = ensureDraftCardLocation({ ...base, sourceText: 'انفجار في مدينة حمص' });
  assert.equal(held.action, 'held', `a third place in the source text still holds, got ${JSON.stringify(held)}`);
});

test('direct publish button: owner toward report (city origin -> district destination, details name it) publishes', async () => {
  await tap('t:uav', owner, bot);
  await tap('airmode:toward', owner, bot);
  await tap('g:09', owner, bot);
  await tap('p:170063', owner, bot);
  await tap('g:09', owner, bot);
  await tap('d:8276861', owner, bot);
  const whole = buttons().find((x) => /كامل|كلها/.test(x.text));
  if (whole) await tap(whole.callback_data, owner, bot);
  if (buttons().some((b) => b.callback_data === 'skip')) await say('مسيرة باتجاه السفيرة', owner, bot);
  assert.ok(buttons().some((b) => b.callback_data === 'publish'), 'publish offered at preview');
  await tap('publish', owner, bot);
  const created = store.activeAlerts().filter((a) => a.type === 'uav' && a.meta?.flightTarget?.name_ar === 'السفيرة').at(-1);
  assert.ok(created, 'direct toward publish creates the alert with its destination');
  assert.equal(created.place?.name_ar, 'حلب', 'origin stays the alert location');
});
