import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Batch 2: monitored news must show the FULL cleaned text, not only the
// 240-char headline. The draft carries it as `body`; the alert keeps the
// concise headline as `description` and the full text as `body`, which the
// map payload exposes and the channel post prints after the lead.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-full-text-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:mock-token';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
const { store, publicAlert } = await import('../server/store.js');
await store.init(null);
const mon = await import('../server/news-monitor.js');
const bot = await import('../server/bot.js');

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

const FULL = 'انفجار عبوة ناسفة في مدينة إدلب أدى إلى إصابة شخصين بجروح. وقال الدفاع المدني إن فرقه أسعفت المصابين إلى المشفى ونقلت جثة شخص ثالث.';
const HEADLINE = 'انفجار عبوة ناسفة في مدينة إدلب وإصابة شخصين';

test('handleResult stores the full cleaned text as the draft body', async () => {
  const it = { i: 1, src: { u: 'full-text-src', name: 'مصدر تجريبي', local: false }, url: 'https://t.me/full-text-src/1', ts: Date.now(), text: FULL.replace('. وقال', '.\nوقال'), breaking: false };
  const r = { i: 1, event: true, type: 'explosion', new_incident: true, same_as: null, places: [{ name: 'إدلب', gov: 'إدلب' }], headline: HEADLINE };
  await mon._test.handleResult(it, r, [], new Map());
  const draft = Object.values(mon.newsState().drafts).find((d) => (d.srcs || []).some((s) => s.u === 'full-text-src'));
  assert.ok(draft, 'a draft is created');
  assert.equal(draft.headline, HEADLINE);
  assert.ok(draft.body, 'the draft carries a body');
  assert.match(draft.body, /الدفاع المدني/);
  assert.match(draft.body, /جثة شخص ثالث/);
  assert.ok(draft.body.length > draft.headline.length, 'the body is the fuller text');
});

test('toBotDraft and buildAlertInput keep headline as lead and full text as body', async () => {
  const draft = Object.values(mon.newsState().drafts).find((d) => (d.srcs || []).some((s) => s.u === 'full-text-src'));
  const botDraft = mon.toBotDraft(draft);
  assert.ok(botDraft.body && botDraft.body.includes('الدفاع المدني'), 'bot draft carries the body');
  const input = bot.buildAlertInput(botDraft, { id: 1, name: 'test' });
  assert.equal(input.description, HEADLINE, 'description stays the concise headline');
  assert.ok(input.body && input.body.includes('جثة شخص ثالث'), 'alert input carries the full text separately');
});

test('channel post prints the lead first and the full text after it', async () => {
  const draft = Object.values(mon.newsState().drafts).find((d) => (d.srcs || []).some((s) => s.u === 'full-text-src'));
  const input = bot.buildAlertInput(mon.toBotDraft(draft), { id: 1, name: 'test' });
  const alert = { ...input, id: 'full-text-alert', place: input.location, timestamp: new Date().toISOString(), is_active: true };
  const post = bot.channelPost(alert);
  const leadAt = post.indexOf(HEADLINE);
  const bodyAt = post.indexOf('جثة شخص ثالث');
  assert.ok(leadAt >= 0 && bodyAt > leadAt, 'full text follows the lead in the channel post');
  const stored = store.addAlert({ ...input, source: 'news' });
  const pub = publicAlert(stored);
  assert.equal(pub.description, HEADLINE);
  assert.ok(pub.body && pub.body.includes('الدفاع المدني'), 'map payload exposes the full text as body');
});

test('channel post does not duplicate the text when body equals the lead', () => {
  const alert = { type: 'explosion', title: 'انفجار — إدلب', description: 'انفجار في إدلب', body: 'انفجار في إدلب', place: { scope: 'place', name_ar: 'إدلب' }, timestamp: new Date().toISOString(), is_active: true };
  const post = bot.channelPost(alert);
  assert.equal(post.split('انفجار في إدلب').length - 1, 1, 'identical body is not repeated');
});

test('public payload never exposes a private-editorial body', () => {
  const pub = publicAlert({
    id: 'editorial-body', type: 'attack', source: 'news', title: 'هجوم — حلب', description: 'هجوم في حلب',
    body: 'رأي/تحليل: نص خاص بالمالك لا يُنشر', timestamp: new Date().toISOString(), is_active: true, history: [],
  });
  assert.equal(pub.body, undefined, 'private editorial copy stays off the public payload');
});
