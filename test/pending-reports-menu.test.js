import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-pending-menu-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '<redacted_bot_token_1>';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
process.env.PUBLIC_URL = 'https://example.invalid';
process.env.ALERT_IMAGES = 'false';

const { store } = await import('../server/store.js');
await store.init(null);
const { createBot } = await import('../server/bot.js');

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
    id: `pend-${updateId}`, from: user, chat_instance: 'local', data,
    message: { message_id: 700, date: 0, chat: { id: user.id, type: 'private' }, from: targetBot.botInfo, text: 'Local test draft' },
  },
});
const lastText = () => [...calls].reverse().find((c) => c.payload?.text)?.payload.text || '';
const buttons = () => [...calls].reverse().find((c) => Array.isArray(c.payload?.reply_markup?.inline_keyboard))?.payload.reply_markup.inline_keyboard.flat() || [];
const menuButton = () => buttons().find((b) => b.callback_data === 'rpend');

test('main menu shows the pending-reports button with a live counter; empty queue opens the empty state', async () => {
  await tap('home');
  assert.ok(menuButton(), 'pending-reports button present in the admin main menu');
  assert.match(menuButton().text, /البلاغات المعلّقة \(0\)/, `counter starts at 0: ${menuButton().text}`);
  await tap('rpend');
  assert.match(lastText(), /لا شيء ينتظر قراراً/, 'empty state text');
});

test('full flow: Rad submission appears in the inbox, opens its own review card, approves and publishes', async () => {
  const reporter = { id: 8270709681, is_bot: false, first_name: 'Inbox reporter', language_code: 'ar' };
  const reportIdsBefore = new Set(Object.keys(store.state.reports || {}));
  await tap('t:uav', reporter, reportBot);
  await tap('airmode:over', reporter, reportBot);
  await tap('g:13', reporter, reportBot);
  await tap('wg:13', reporter, reportBot);
  await tap('skip', reporter, reportBot);
  await tap('submit', reporter, reportBot);
  const rid = Object.keys(store.state.reports || {}).find((id) => !reportIdsBefore.has(id));
  assert.ok(rid, 'report pending in the store');

  await tap('home');
  assert.match(menuButton().text, /البلاغات المعلّقة \(1\)/, `counter shows the waiting report: ${menuButton().text}`);

  await tap('rpend');
  assert.match(lastText(), /البلاغات المعلّقة \(1\)/, 'list header carries the count');
  const entry = buttons().find((b) => b.callback_data === 'rpo:' + rid);
  assert.ok(entry, 'the waiting report is a button in the list');
  assert.match(entry.text, /دمشق/, `entry names the place: ${entry.text}`);
  assert.match(entry.text, /ناطر من/, `entry carries its waiting age: ${entry.text}`);
  assert.ok(buttons().some((b) => b.callback_data === 'rqa:' + rid), 'quick approve offered in the list');
  assert.ok(buttons().some((b) => b.callback_data === 'rqr:' + rid), 'quick reject offered in the list');

  await tap('rpo:' + rid);
  const cardButtons = buttons().map((b) => b.callback_data);
  for (const expected of ['rap:' + rid, 'rv:' + rid, 'red:' + rid, 'rrj:' + rid, 'rbn:' + rid]) {
    assert.ok(cardButtons.includes(expected), `review card keeps its existing button ${expected}`);
  }
  assert.match(lastText(), /دمشق/, 'review card shows the report content');

  await tap('rap:' + rid);
  const created = store.activeAlerts().filter((a) => a.type === 'uav').at(-1);
  assert.ok(created, 'approving from the inbox card publishes the alert');
  assert.equal(store.reportGet(rid), null, 'report leaves the pending store once decided');

  await tap('home');
  assert.match(menuButton().text, /البلاغات المعلّقة \(0\)/, 'counter returns to 0 after the decision');
});

test('the inbox is staff-only: a public user tapping it on the admin bot gets nothing', async () => {
  const stranger = { id: 8270709699, is_bot: false, first_name: 'Stranger', language_code: 'ar' };
  calls.length = 0;
  await tap('rpend', stranger, bot);
  assert.ok(!calls.some((c) => String(c.payload?.text || '').includes('البلاغات المعلّقة')), 'no inbox screen for non-staff');
});

test('quick approve and quick reject decide straight from the list', async () => {
  const mk = async (uid) => {
    const reporter = { id: uid, is_bot: false, first_name: 'Quick reporter', language_code: 'ar' };
    const before = new Set(Object.keys(store.state.reports || {}));
    await tap('t:uav', reporter, reportBot);
    await tap('airmode:over', reporter, reportBot);
    await tap('g:13', reporter, reportBot);
    await tap('wg:13', reporter, reportBot);
    await tap('skip', reporter, reportBot);
    await tap('submit', reporter, reportBot);
    return Object.keys(store.state.reports || {}).find((id) => !before.has(id));
  };
  const ridA = await mk(8270709682);
  const ridB = await mk(8270709683);
  assert.ok(ridA && ridB, 'two reports pending');
  const alertsBefore = store.activeAlerts().length;

  await tap('rpend');
  await tap('rqa:' + ridA);
  assert.equal(store.reportGet(ridA), null, 'quick-approved report leaves the queue');
  assert.ok(store.activeAlerts().length > alertsBefore, 'quick approve published the alert');
  assert.match(lastText(), /البلاغات المعلّقة \(1\)/, 'list redraws with the remaining item');

  await tap('rqr:' + ridB);
  assert.equal(store.reportGet(ridB), null, 'quick-rejected report leaves the queue');
  assert.match(lastText(), /لا شيء ينتظر قراراً/, 'queue empty after both decisions');
});

test('held monitor drafts merge into the same list chronologically, with reason and age, and open their own card', async () => {
  const now = Date.now();
  const { locationFrom } = await import('../server/places.js');
  store.reportPut('oldreport1', { draft: { type: 'uav', location: locationFrom({ govCode: '13' }) }, from: { id: 4242, first_name: 'Old reporter' }, messages: [], created: now - 30 * 60000, via: 'report' });
  store.state.news = { drafts: {
    heldold: { id: 'heldold', type: 'attack', headline: 'هجوم مسلح قرب بصرى الشام', body: 'هجوم مسلح قرب بصرى الشام', status: 'pending', editorialHold: true, editorialHoldReason: 'location-text-conflict', editorialHoldAt: now - 90 * 60000, created: now - 95 * 60000, ts: now - 95 * 60000, srcs: [{ name: 'Test feed', local: false }] },
    heldnew: { id: 'heldnew', type: 'shelling', headline: 'قصف مدفعي على أطراف مدينة إدلب', body: 'قصف مدفعي على أطراف مدينة إدلب', status: 'pending', editorialHold: true, editorialHoldReason: 'auto-audit-failed', editorialHoldAt: now - 10 * 60000, created: now - 12 * 60000, ts: now - 12 * 60000, srcs: [{ name: 'Test feed', local: false }] },
    notheld: { id: 'notheld', type: 'attack', headline: 'مسودة عادية بلا حبس', body: 'x', status: 'pending', created: now - 5000, ts: now - 5000, srcs: [] },
  } };
  await tap('home');
  assert.match(menuButton().text, /البلاغات المعلّقة \(3\)/, `counter merges both sources: ${menuButton().text}`);
  await tap('rpend');
  assert.match(lastText(), /مسودات رصد محبوسة: 2/, 'header breaks down the held count');
  const entries = buttons().filter((b) => b.callback_data.startsWith('nhd:') || b.callback_data.startsWith('rpo:'));
  assert.deepEqual(entries.map((b) => b.callback_data), ['nhd:heldold', 'rpo:oldreport1', 'nhd:heldnew'], 'one merged oldest-first timeline across both sources');
  assert.match(entries[0].text, /تعارض الموقع مع النص/, 'held entry carries its recorded hold reason');
  assert.match(entries[0].text, /ناطر من/, 'held entry carries its waiting age');
  await tap('nhd:heldold');
  assert.match(lastText(), /هجوم مسلح قرب بصرى الشام/, 'the draft opens its own monitor card');
  assert.ok(buttons().some((b) => b.callback_data === 'nw:p:heldold'), 'the opened card keeps the monitor publish button (the real monitor path)');
  store.state.news = { drafts: {} };
  store.reportTake('oldreport1');
});
