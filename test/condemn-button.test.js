import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ⚖️ «إدانة» button (owner request, 2026-11-17): both review flows — the
// admin bot's monitor draft cards (nw:cd:/nw:cdv:) and the reporting bot's
// report review cards (rcd:/rcdv:) — attach one condemnation formula, stored
// as a variant KEY on the draft and appended exactly once at publish time.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-condemn-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
process.env.PUBLIC_URL = 'https://example.invalid';
process.env.ALERT_IMAGES = 'false';

const { store } = await import('../server/store.js');
await store.init(null);
const bot = await import('../server/bot.js');
const mon = await import('../server/news-monitor.js');
const { CONDEMNATIONS, CONDEMNATION_KEYS, condemnationKey, condemnationText } = await import('../shared/condemnations.js');

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

const ownerId = 8270709633;
const owner = { id: ownerId, is_bot: false, first_name: 'Local owner', language_code: 'ar' };
const adminBot = bot.createBot();
adminBot.botInfo = { id: 1, is_bot: true, first_name: 'Local admin test', username: 'LocalAdminTestBot' };
const calls = [];
let messageId = 1000;
const snapshotPayload = (payload) => {
  const copy = { ...(payload || {}) };
  for (const key of ['photo', 'video']) if (copy[key] && typeof copy[key] !== 'string') copy[key] = '[media]';
  return structuredClone(copy);
};
adminBot.api.config.use(async (_previous, method, payload) => {
  calls.push({ method, chatId: payload?.chat_id, payload: snapshotPayload(payload) });
  if (method === 'sendMessage') return { ok: true, result: { message_id: ++messageId, chat: { id: payload.chat_id, type: 'private' }, date: 0, text: payload.text || '' } };
  if (method === 'editMessageText') return { ok: true, result: { message_id: payload.message_id, chat: { id: payload.chat_id, type: 'private' }, date: 0, text: payload.text || '' } };
  return { ok: true, result: true };
});
let updateId = 1;
const tap = async (data, targetMessageId = 700) => adminBot.handleUpdate({
  update_id: updateId++,
  callback_query: {
    id: `local-${updateId}`, from: owner, chat_instance: 'local', data,
    message: { message_id: targetMessageId, date: 0, chat: { id: ownerId, type: 'private' }, from: adminBot.botInfo, text: 'Local test card' },
  },
});
const flatButtons = (kb) => (kb?.inline_keyboard || []).flat();
const occurrences = (haystack, needle) => String(haystack || '').split(needle).length - 1;

test('config holds the four owner formulas in one place', () => {
  assert.deepEqual([...CONDEMNATION_KEYS].sort(), ['bombardment', 'civilians', 'general', 'incursion']);
  assert.match(CONDEMNATIONS.incursion.text, /التوغّل العسكري في الأراضي السورية/);
  assert.match(CONDEMNATIONS.bombardment.text, /هذا العدوان على الأراضي السورية/);
  assert.match(CONDEMNATIONS.civilians.text, /استهداف المدنيين الأبرياء/);
  assert.match(CONDEMNATIONS.general.text, /ندين ونستنكر بأشدّ العبارات هذا الاعتداء/);
  assert.equal(condemnationText('incursion'), CONDEMNATIONS.incursion.text);
  assert.equal(condemnationText('nope'), '');
  assert.equal(condemnationKey(undefined), null);
});

// ------------------------------------------------------------- monitor flow
const monDraft = {
  id: 'condemndraft1', type: 'military_incursion', status: 'pending',
  headline: 'توغل آليات عسكرية في ريف القنيطرة',
  body: 'توغلت آليات عسكرية في ريف القنيطرة الجنوبي وقامت بأعمال تجريف قرب خط وقف إطلاق النار.',
  loc: { scope: 'place', name_ar: 'صمدانية شرقية', name_en: 'Eastern Samadaniyeh', district_ar: 'القنيطرة', governorate_ar: 'القنيطرة', latitude: 33.1, longitude: 35.9 },
  extra: [], srcs: [{ u: 'condemn-src', name: 'مصدر تجريبي', url: 'https://t.me/condemn-src/1', ts: Date.now() }],
  ts: Date.now(), created: Date.now(), cards: [[ownerId, 700]],
};
mon.newsState().drafts[monDraft.id] = monDraft;

test('monitor card keyboard carries the إدانة button', () => {
  const kb = mon._test.cardKb(monDraft, 'ar', ownerId);
  const btn = flatButtons(kb).find((b) => b.callback_data === `nw:cd:${monDraft.id}`);
  assert.ok(btn, 'condemn button present on the monitor draft card');
  assert.match(btn.text, /إدانة/);
  assert.ok(!/✓/.test(btn.text), 'no active mark before a formula is chosen');
  assert.ok(!mon._test.cardText(monDraft, 'ar').includes(CONDEMNATIONS.incursion.text), 'card text has no formula before choosing');
});

test('monitor picker offers all four variants; choosing one marks the card', async () => {
  const before = calls.length;
  await tap(`nw:cd:${monDraft.id}`);
  const picker = calls.slice(before).find((c) => c.method === 'editMessageReplyMarkup');
  assert.ok(picker, 'picker keyboard replaces the card keyboard');
  const cbs = flatButtons(picker.payload.reply_markup).map((b) => b.callback_data);
  for (const key of CONDEMNATION_KEYS) assert.ok(cbs.includes(`nw:cdv:${monDraft.id}:${key}`), `variant ${key} offered`);
  assert.ok(cbs.includes(`nw:b:${monDraft.id}`), 'back returns to the draft card');

  const before2 = calls.length;
  await tap(`nw:cdv:${monDraft.id}:incursion`);
  assert.equal(monDraft.condemn, 'incursion');
  const refreshed = calls.slice(before2).filter((c) => c.method === 'editMessageText');
  assert.ok(refreshed.some((c) => (c.payload.text || '').includes(CONDEMNATIONS.incursion.text)), 'refreshed card shows the formula');
  const kb = mon._test.cardKb(monDraft, 'ar', ownerId);
  assert.match(flatButtons(kb).find((b) => b.callback_data === `nw:cd:${monDraft.id}`).text, /إدانة ✓/, 'button shows the active state');
});

test('monitor: switching variants replaces, off removes, never stacks', async () => {
  await tap(`nw:cdv:${monDraft.id}:civilians`);
  assert.equal(monDraft.condemn, 'civilians');
  const text = mon._test.cardText(monDraft, 'ar');
  assert.ok(text.includes(CONDEMNATIONS.civilians.text));
  assert.ok(!text.includes(CONDEMNATIONS.incursion.text), 'previous formula is gone');
  await tap(`nw:cdv:${monDraft.id}:off`);
  assert.equal(monDraft.condemn, undefined);
  assert.ok(!mon._test.cardText(monDraft, 'ar').includes(CONDEMNATIONS.civilians.text), 'formula removed from the card');
});

test('monitor publish chain: line appended once to the body, never the title', async () => {
  await tap(`nw:cdv:${monDraft.id}:incursion`);
  const botDraft = mon.toBotDraft(monDraft);
  assert.equal(botDraft.condemn, 'incursion', 'toBotDraft carries the variant key');
  assert.ok(!botDraft.headline.includes('ندين'), 'headline untouched');
  assert.ok(!botDraft.body.includes('ندين'), 'line is NOT pasted into the draft body — it is resolved at publish');
  const input = bot.buildAlertInput(botDraft, { id: ownerId, name: 'test' });
  assert.ok(!input.title.includes('ندين'), 'alert title carries no condemnation');
  assert.equal(input.description, botDraft.headline, 'description stays the concise lead');
  assert.ok(input.body.endsWith(CONDEMNATIONS.incursion.text), 'formula closes the published body');
  assert.equal(occurrences(input.body, CONDEMNATIONS.incursion.text), 1, 'exactly once in the body');
  const alert = { ...input, id: 'condemn-alert-1', place: input.location, timestamp: new Date().toISOString(), is_active: true };
  const post = bot.channelPost(alert);
  assert.equal(occurrences(post, CONDEMNATIONS.incursion.text), 1, 'exactly once in the channel post');
  const again = bot.buildAlertInput(botDraft, { id: ownerId, name: 'test' });
  assert.equal(occurrences(again.body, CONDEMNATIONS.incursion.text), 1, 'rebuilding the input cannot stack it');
});

// -------------------------------------------------------------- report flow
const rid = 'condemnrep1';
store.reportPut(rid, {
  draft: {
    type: 'airstrike', mode: 'report', step: 'preview', ttlMin: 120,
    details: 'قصف جوي استهدف أطراف بلدة في ريف إدلب وأسفر عن أضرار مادية',
    location: { scope: 'place', name_ar: 'معرة النعمان', name_en: 'Maarat al-Numan', district_ar: 'معرة النعمان', governorate_ar: 'إدلب', latitude: 35.6, longitude: 36.6 },
    extra: [], created: Date.now(),
  },
  from: { id: 8270709634, first_name: 'Local reporter' },
  messages: [[ownerId, 700]], created: Date.now(), via: 'report',
});

test('report review keyboard carries the إدانة button', () => {
  const kb = bot.reportReviewKeyboard('ar', rid, store.reportGet(rid).draft);
  const btn = flatButtons(kb).find((b) => b.callback_data === `rcd:${rid}`);
  assert.ok(btn, 'condemn button present on the report review card');
  assert.match(btn.text, /إدانة/);
});

test('report picker sets, replaces, and the card re-renders with the formula', async () => {
  const before = calls.length;
  await tap(`rcd:${rid}`);
  const picker = calls.slice(before).find((c) => c.method === 'editMessageReplyMarkup');
  assert.ok(picker, 'picker keyboard replaces the review keyboard');
  const cbs = flatButtons(picker.payload.reply_markup).map((b) => b.callback_data);
  for (const key of CONDEMNATION_KEYS) assert.ok(cbs.includes(`rcdv:${rid}:${key}`), `variant ${key} offered`);
  assert.ok(cbs.includes(`rcb:${rid}`), 'back returns to the review keyboard');

  const before2 = calls.length;
  await tap(`rcdv:${rid}:bombardment`);
  assert.equal(store.reportGet(rid).draft.condemn, 'bombardment', 'choice persisted on the report draft');
  const refreshed = calls.slice(before2).filter((c) => c.method === 'editMessageText');
  assert.ok(refreshed.some((c) => (c.payload.text || '').includes(CONDEMNATIONS.bombardment.text)), 'review card shows the formula');

  await tap(`rcdv:${rid}:general`);
  assert.equal(store.reportGet(rid).draft.condemn, 'general', 'switching replaces the variant');
  const kb = bot.reportReviewKeyboard('ar', rid, store.reportGet(rid).draft);
  assert.match(flatButtons(kb).find((b) => b.callback_data === `rcd:${rid}`).text, /إدانة ✓/, 'button shows the active state');
});

test('report approve publishes the formula exactly once, title untouched', async () => {
  const before = calls.length;
  await tap(`rap:${rid}`);
  const channelPost = calls.slice(before).find((c) => c.method === 'sendMessage' && c.chatId === '@mock_news_channel');
  assert.ok(channelPost, 'the alert was posted to the channel');
  assert.equal(occurrences(channelPost.payload.text, CONDEMNATIONS.general.text), 1, 'formula appears exactly once in the channel post');
  assert.equal(store.reportGet(rid), null, 'report claimed by the approval');
  const alert = store.state.alerts.find((a) => (a.description || '').includes('قصف جوي استهدف أطراف بلدة'));
  assert.ok(alert, 'alert stored');
  assert.ok(!alert.title.includes('ندين'), 'alert title carries no condemnation');
  assert.ok((alert.description || '').endsWith(CONDEMNATIONS.general.text), 'formula closes the published text');
  assert.equal(occurrences(alert.description, CONDEMNATIONS.general.text), 1, 'exactly once in the stored alert');
});

test('report-style draft without a body gets the line at the end of its text', () => {
  const input = bot.buildAlertInput({
    type: 'explosion', ttlMin: 60, condemn: 'civilians',
    details: 'انفجار في سوق شعبي أدى إلى إصابات بين المدنيين',
    location: { scope: 'place', name_ar: 'الباب', name_en: 'Al-Bab', governorate_ar: 'حلب', latitude: 36.37, longitude: 37.42 },
    extra: [],
  }, { id: ownerId, name: 'test' });
  assert.ok(!input.title.includes('ندين'));
  assert.ok(input.description.endsWith(CONDEMNATIONS.civilians.text));
  assert.equal(occurrences(input.description, CONDEMNATIONS.civilians.text), 1);
  const noCondemn = bot.buildAlertInput({
    type: 'explosion', ttlMin: 60, details: 'انفجار في سوق شعبي أدى إلى إصابات بين المدنيين',
    location: { scope: 'place', name_ar: 'الباب', name_en: 'Al-Bab', governorate_ar: 'حلب', latitude: 36.37, longitude: 37.42 },
    extra: [],
  }, { id: ownerId, name: 'test' });
  assert.ok(!noCondemn.description.includes('ندين'), 'no formula without a chosen variant');
});
