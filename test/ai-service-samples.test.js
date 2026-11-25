import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Owner spec 2026-11-25 (item 5): the in-house classification service proven on
// samples modelled on today's real drafts — Sour (Daraa) and Kafr Jales (Idlib).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-ai-samples-'));
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = 'test-only-not-a-real-token';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
process.env.PUBLIC_URL = 'https://example.invalid';
process.env.ALERT_IMAGES = 'false';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.AI_BACKUP_API_KEY = 'test-backup-key';
process.env.NEWS_AI_MIN_GAP_MS = '0';

const { store } = await import('../server/store.js');
await store.init(null);
const { newsState, _test } = await import('../server/news-monitor.js');

let mode = 'backup-up';
let currentAnswer = null;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('generativelanguage.googleapis.com')) return { ok: false, status: 500, json: async () => ({ error: { message: 'gemini down in tests' } }) };
  if (u.includes('api.deepseek.com')) {
    if (mode === 'all-down') return { ok: false, status: 503, json: async () => ({ error: { message: 'backup down in tests' } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ results: [currentAnswer] }) } }] }) };
  }
  throw new Error('offline in tests');
};

const SOUR_TEXT = '#عاجل | انفجار عبوة ناسفة قرب بلدة صور في ريف درعا الشمالي، وقال مصدر عسكري: "الانفجار وقع بعبوة مزروعة على جانب الطريق ولم يسفر عن إصابات"، فيما تعمل الجهات المختصة على تمشيط محيط الموقع.';
const KAFR_TEXT = 'قصف مدفعي يستهدف أطراف قرية كفر جالس في ريف إدلب الجنوبي، وسقوط عدة قذائف قرب منازل المدنيين دون معلومات عن إصابات حتى الآن.';
const pushItem = (url, text, ageMs = 0) => _test.R.queue.push({ src: { u: 'sample-src', name: 'وكالة الأنباء', local: false }, url, ts: Date.now() - ageMs, qAt: Date.now() - ageMs, text, breaking: false });

test('sample Sour: Gemini down -> backup classifies instantly; draft is short-placed and quoted', async () => {
  const n = newsState();
  mode = 'backup-up';
  currentAnswer = { i: 1, event: true, type: 'explosion', political_category: 'none', new_incident: true, same_as: null, places: [{ name: 'صور', gov: 'درعا' }], headline: 'انفجار عبوة ناسفة قرب صور بريف درعا' };
  _test.R.lastAiAt = 0;
  const before = Object.keys(n.drafts).length;
  pushItem('https://t.me/sample-src/101', SOUR_TEXT);
  await _test.processQueue();
  assert.equal(_test.R.aiProvider, 'backup', 'the distributor failed over to the backup provider');
  assert.equal(Object.keys(n.drafts).length, before + 1, 'a draft was created by the backup classification');
  const d = Object.values(n.drafts).find((x) => x.headline?.includes('صور'));
  assert.ok(d, 'the Sour draft exists');
  assert.equal(d.type, 'explosion');
  assert.ok(!d.rule, 'no simple-rules flag on an AI-classified draft');
  const card = _test.cardText(d);
  const sourLine = card.split('\n').find((l) => l.includes('المكان'));
  assert.match(sourLine, /صور.* - درعا/, 'short place line on the draft card (place - governorate)');
  assert.ok(!sourLine.includes('ازرع') && !sourLine.includes('منطقة'), 'no district chain in the place line');
  assert.ok(!card.includes('اقتباس'), 'no quote block — cancelled by the owner 2026-11-25 (news text only)');
  assert.ok(!card.includes('غير متاح'), 'no AI-unavailable note');
});

test('sample Kafr Jales: all providers down -> held «بانتظار التصنيف», never classified, never published', async () => {
  const n = newsState();
  mode = 'all-down';
  _test.R.lastAiAt = 0;
  const draftsBefore = Object.keys(n.drafts).length;
  pushItem('https://t.me/sample-src/102', KAFR_TEXT, 7 * 60_000);
  await _test.processQueue();
  assert.equal(_test.R.aiOk, false);
  assert.equal(Object.keys(n.drafts).length, draftsBefore, 'no draft is fabricated while every provider is down');
  assert.ok(n.aiHeld?.['https://t.me/sample-src/102'], 'the item is held with the awaiting-classification flag');
});

test('health probe recovers: held Kafr Jales item is re-queued and classified by the backup', async () => {
  const n = newsState();
  mode = 'backup-up';
  currentAnswer = { i: 1, event: true, type: 'artillery', political_category: 'none', new_incident: true, same_as: null, places: [{ name: 'كفر جالس', gov: 'إدلب' }], headline: 'قصف مدفعي على أطراف كفر جالس بريف إدلب' };
  _test.R.aiHealthAt = 0;
  _test.R.lastAiAt = 0;
  await _test.aiHealthTick();
  assert.equal(_test.R.aiOk, true, 'the probe flipped the health state back');
  assert.equal(Object.keys(n.aiHeld || {}).length, 0, 'the hold is cleared on recovery');
  // the health tick itself kicks processQueue; wait for its draft to land
  let d = null;
  for (let i = 0; i < 50 && !d; i++) { d = Object.values(n.drafts).find((x) => x.headline?.includes('كفر جالس')); if (!d) await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(d, 'the recovered item became a draft after classification');
  assert.equal(d.type, 'artillery');
  const kafrLine = _test.cardText(d).split('\n').find((l) => l.includes('المكان'));
  assert.match(kafrLine, /كفر جالس.* - إدلب/, 'short place line after recovery (place - governorate)');
});
