import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-flight-toward-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST_TOKEN';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
process.env.PUBLIC_URL = 'https://example.invalid';
process.env.ALERT_IMAGES = 'false';

const { store, publicAlert } = await import('../server/store.js');
await store.init(null);
const { buildAlertInput, createBot } = await import('../server/bot.js');

const ownerId = 8270709633;
const owner = { id: ownerId, is_bot: false, first_name: 'Local owner', language_code: 'ar' };
const bot = createBot();
bot.botInfo = { id: 1, is_bot: true, first_name: 'Local admin test', username: 'LocalAdminTestBot' };
const reportBot = createBot({ role: 'report', token: '654321:LOCAL_REPORT_TEST' });
reportBot.botInfo = { id: 2, is_bot: true, first_name: 'Local report test', username: 'LocalReportTestBot' };

const calls = [];
let messageId = 5000;
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
    id: `toward-${updateId}`, from: user, chat_instance: 'local', data,
    message: { message_id: 700, date: 0, chat: { id: user.id, type: 'private' }, from: targetBot.botInfo, text: 'Local test draft' },
  },
});
const lastText = () => [...calls].reverse().find((c) => c.payload?.text)?.payload.text || '';
const buttons = () => [...calls].reverse().find((c) => Array.isArray(c.payload?.reply_markup?.inline_keyboard))?.payload.reply_markup.inline_keyboard.flat() || [];

test('admin bot: toward report picks origin then destination and publishes with the destination saved', async () => {
  const activeBefore = store.activeAlerts().length;
  await tap('t:warplane');
  const modeButtons = buttons();
  assert.ok(modeButtons.some((b) => b.callback_data === 'airmode:over' && b.text.includes('تحليق فوق المنطقة')), 'hovering button present and unchanged');
  assert.ok(modeButtons.some((b) => b.callback_data === 'airmode:toward' && b.text.includes('باتجاه منطقة معينة')), 'heading button present next to hovering');

  await tap('airmode:toward');
  await tap('g:13'); // Damascus — observed area
  await tap('wg:13');
  assert.match(lastText(), /اختر منطقة الوجهة/, 'after the origin pick the flow chains into the destination pick');
  await tap('g:09'); // Aleppo — destination
  await tap('wg:09');
  await tap('skip');
  assert.match(lastText(), /الوجهة/, 'preview names the destination');
  assert.match(lastText(), /حلب/, 'preview shows the destination name');
  assert.ok(buttons().some((b) => b.callback_data === 'publish'), 'staff preview offers publish');
  await tap('publish');

  const created = store.activeAlerts().filter((a) => a.type === 'warplane').at(-1);
  assert.ok(created, 'the toward report was published as an alert');
  assert.ok(store.activeAlerts().length > activeBefore);
  assert.equal(created.meta?.aerialMode, 'toward');
  assert.equal(created.meta?.flightTarget?.name_ar, 'حلب');
  assert.equal(created.place?.name_ar, 'دمشق', 'the observed area stays the alert location');
  assert.ok(created.title.includes('نحو') && created.title.includes('حلب'), `title carries «نحو حلب»: ${created.title}`);
  const pub = publicAlert(created);
  assert.equal(pub.aerial_mode, 'toward');
  assert.equal(pub.flight_target?.name_ar, 'حلب');
  assert.ok(Number.isFinite(pub.flight_target?.latitude) && Number.isFinite(pub.flight_target?.longitude), 'public flight_target carries coordinates for the route');
});

test('report bot (Rad): public toward report is submitted for review with the destination in the draft', async () => {
  const reporter = { id: 8270709651, is_bot: false, first_name: 'Local flight reporter', language_code: 'ar' };
  const reportIdsBefore = new Set(Object.keys(store.state.reports || {}));
  await tap('t:uav', reporter, reportBot);
  assert.ok(buttons().some((b) => b.callback_data === 'airmode:toward' && b.text.includes('باتجاه منطقة معينة')), 'public bot shows the heading button too');
  await tap('airmode:toward', reporter, reportBot);
  await tap('g:13', reporter, reportBot);
  await tap('wg:13', reporter, reportBot);
  assert.match(lastText(), /اختر منطقة الوجهة/, 'public flow also chains into the destination pick');
  await tap('g:09', reporter, reportBot);
  await tap('wg:09', reporter, reportBot);
  await tap('skip', reporter, reportBot);
  assert.ok(buttons().some((b) => b.callback_data === 'submit'), 'public preview offers submit-for-review');
  await tap('submit', reporter, reportBot);

  const rid = Object.keys(store.state.reports || {}).find((id) => !reportIdsBefore.has(id));
  assert.ok(rid, 'submission saved as a pending report');
  const pending = store.reportGet(rid);
  assert.equal(pending.draft.aerialMode, 'toward');
  assert.equal(pending.draft.flightTarget?.name_ar, 'حلب');
  assert.equal(pending.draft.location?.name_ar, 'دمشق');
  const built = buildAlertInput(pending.draft, pending.from);
  assert.equal(built.meta?.aerialMode, 'toward');
  assert.equal(built.meta?.flightTarget?.name_ar, 'حلب');
  store.reportTake(rid);
});

test('hovering flow regression: over never asks for a destination and publishes without one', async () => {
  await tap('t:uav');
  await tap('airmode:over');
  await tap('g:13');
  await tap('wg:13');
  assert.doesNotMatch(lastText(), /اختر منطقة الوجهة/, 'hovering goes straight past the origin pick');
  await tap('skip');
  await tap('publish');
  const created = store.activeAlerts().filter((a) => a.type === 'uav').at(-1);
  assert.ok(created, 'hovering report published');
  assert.equal(created.meta?.flightTarget, undefined);
  assert.equal(created.meta?.aerialMode, 'over');
  assert.equal(publicAlert(created).aerial_mode, 'over');
  assert.equal(publicAlert(created).flight_target, undefined);
});
