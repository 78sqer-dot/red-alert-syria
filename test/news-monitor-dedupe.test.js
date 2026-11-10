import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-news-dedupe-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
process.env.GEMINI_API_KEY = 'synthetic-only';
process.env.NEWS_AI_MODELS = 'synthetic-model';
process.env.NEWS_AI_MIN_GAP_MS = '0';

const { store } = await import('../server/store.js');
await store.init(null);
const { newsState, nightEligible, daytimeAutoEligible, _test } = await import('../server/news-monitor.js');
const originalFetch = globalThis.fetch;
const originalGeminiKey = process.env.GEMINI_API_KEY;
const originalModels = process.env.NEWS_AI_MODELS;
const originalGap = process.env.NEWS_AI_MIN_GAP_MS;
const originalKnown = newsState().drafts;
const originalAlerts = newsState().alerts;
const originalQueue = [..._test.R.queue];
const originalStoreAlerts = store.state.alerts;
const originalReports = store.state.reports;

const geoDamascus = {
  pts: [{ lat: 33.5138, lon: 36.2765 }],
  dists: [],
  govs: ['دمشق'],
  coarse: false,
  none: false,
};

test.after(async () => {
  _test.R.queue.length = 0;
  _test.R.queue.push(...originalQueue);
  newsState().drafts = originalKnown;
  newsState().alerts = originalAlerts;
  store.state.alerts = originalStoreAlerts;
  store.state.reports = originalReports;
  globalThis.fetch = originalFetch;
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
  if (originalModels === undefined) delete process.env.NEWS_AI_MODELS;
  else process.env.NEWS_AI_MODELS = originalModels;
  if (originalGap === undefined) delete process.env.NEWS_AI_MIN_GAP_MS;
  else process.env.NEWS_AI_MIN_GAP_MS = originalGap;
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

test('a cross-source repeat of an already-published monitored event is suppressed even beyond 40 newer records', async () => {
  const n = newsState();
  n.drafts = {};
  n.alerts = [];
  store.state.alerts = [];
  store.state.reports = {};
  _test.R.queue.length = 0;
  _test.R.lastAiAt = 0;
  _test.R.busy = false;

  const now = Date.now();
  const publishedAt = now - 45 * 60_000;
  n.alerts.push({
  id: 'synthetic-published-channel-alert',
    type: 'attack',
    ts: publishedAt,
    headline: 'اقتحام حاجز أمني في دمشق',
    where: 'دمشق',
    geo: structuredClone(geoDamascus),
  });

  // These newer ignored records push the already-published event beyond the former 40-item match cap.
  for (let i = 1; i <= 40; i++) {
    const id = `synthetic-ignored-${i}`;
    n.drafts[id] = {
      id,
      type: 'fire',
      status: 'ignored',
      ts: publishedAt + i * 60_000,
      created: now,
      headline: `حريق تجريبي في مدينة أخرى رقم ${i}`,
      loc: { scope: 'place', name_ar: 'حلب', governorate_ar: 'حلب', latitude: 36.2021, longitude: 37.1343 },
      extra: [],
    };
  }

  globalThis.fetch = async (_url, options) => {
    assert.equal(options.method, 'POST');
    const answer = [{
      i: 1,
      event: true,
      type: 'attack',
      political_category: null,
      new_incident: true,
      same_as: null,
      places: [{ name: 'دمشق', gov: 'دمشق' }],
      headline: 'اقتحام حاجز أمني في دمشق',
    }];
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }),
    };
  };

  _test.R.queue.push({
    src: { u: 'synthetic-second-source', name: 'مصدر اصطناعي ثانٍ', local: false },
    url: 'https://t.me/synthetic-second-source/9001',
    ts: now - 60_000,
    qAt: now,
    text: 'اقتحام حاجز أمني في دمشق',
    breaking: false,
  });

  const draftCountBefore = Object.keys(n.drafts).length;
  await _test.processQueue();

  assert.equal(Object.keys(n.drafts).length, draftCountBefore, 'the second-source duplicate must not create another draft');
  assert.equal(n.stats.dupes, 1, `the previously published event is recorded as suppressed; stats=${JSON.stringify(n.stats)}, recent=${JSON.stringify(_test.R.log.slice(-3))}`);
  assert.equal(n.alerts.length, 1, 'the synthetic previously published record remains unchanged');
  assert.equal(_test.R.queue.length, 0, 'the synthetic post was fully processed');
});

test('last-mile duplicate guard marks a pending monitored draft as duplicate without deleting the existing post record', async () => {
  const n = newsState();
  n.drafts = {};
  n.alerts = [{
    id: 'already-published-alert', type: 'attack', ts: Date.now() - 5 * 60_000,
    headline: 'اقتحام حاجز أمني في دمشق', where: 'دمشق', geo: structuredClone(geoDamascus),
  }];
  store.state.alerts = [{ id: 'already-published-alert', type: 'attack', channel_message_id: 314, is_active: true, timestamp: new Date(Date.now() - 5 * 60_000).toISOString() }];
  const draft = {
    id: 'pending-duplicate-draft', type: 'attack', status: 'pending', ts: Date.now(),
    headline: 'اقتحام حاجز أمني في دمشق', loc: {
      scope: 'place', name_ar: 'دمشق', district_ar: '', governorate_ar: 'دمشق',
      latitude: 33.5138, longitude: 36.2765,
    }, extra: [], cards: [],
  };
  n.drafts[draft.id] = draft;
  const duplicate = _test.knownDuplicateDraft(draft);
  assert.ok(duplicate, 'the existing published incident is found before channel publication');
  const buttons = _test.cardKb(draft, 'ar').inline_keyboard.flat();
  assert.ok(buttons.some((button) => button.callback_data === `nw:c:${draft.id}` && button.text.includes('تحقق من سجل القناة')), 'the reviewer can request a check of the bot channel records');
  const channelMatch = _test.channelPublishedDuplicateDraft(draft);
  assert.equal(channelMatch?.alertId, 'already-published-alert', 'the check detects a matching alert with a channel message id');
  assert.match(_test.channelCheckText(channelMatch, 'ar'), /مطابقة في سجل منشورات البوت/);
  assert.match(_test.channelCheckText(channelMatch, 'ar'), /المنشور الموجود لن يُحذف/);
  assert.match(_test.channelCheckText(null, 'ar'), /لا يقرأ تاريخ القناة كاملاً/);
  const missing = { ...draft, id: 'not-channel-posted', headline: 'غارة جوية على إدلب', loc: { ...draft.loc, name_ar: 'إدلب', governorate_ar: 'إدلب', latitude: 35.93, longitude: 36.63 } };
  assert.equal(_test.channelPublishedDuplicateDraft(missing), null, 'the check reports no match when no tracked channel post exists');
  assert.equal(await _test.suppressDuplicateDraft(draft, duplicate), true);
  assert.equal(draft.status, 'duplicate');
  assert.equal(n.alerts.length, 1, 'the original published alert remains stored and untouched');
  assert.equal(n.alerts[0].id, 'already-published-alert');
});


test('helicopter monitoring distinguishes singular reports from an explicitly intensive pair', () => {
  assert.equal(_test.helicopterAuto('تحليق مروحية فوق حمص'), false);
  assert.equal(_test.helicopterAuto('تحليق مروحيتين فوق حمص'), true);
  assert.equal(_test.helicopterAuto('multiple helicopters over Homs'), true);
  const normal = { id: 'heli-one', type: 'helicopter', intense: false, ts: Date.now(), headline: 'تحليق مروحية', loc: { scope: 'governorate', name_ar: 'حمص', governorate_ar: 'حمص' } };
  const intensive = { ...normal, id: 'heli-two', intense: true };
  assert.match(_test.cardText(normal, 'ar'), /مروحية واحدة/);
  assert.match(_test.cardText(intensive, 'ar'), /مروحيتان/);
  assert.ok(_test.cardKb(intensive, 'ar').inline_keyboard.flat().some((button) => button.callback_data === `nw:hi:${intensive.id}`));
});

test('drone presence on a ground-incursion report remains review-only and is never auto-published', () => {
  const eligibleUav = {
    type: 'uav', status: 'pending',
    loc: { scope: 'place', latitude: 33.0, longitude: 36.0 },
    srcs: [{ u: 'synthetic-source', local: false }],
  };
  assert.equal(nightEligible(eligibleUav), true, 'the synthetic control is otherwise eligible for the auto-publication gate');
  assert.equal(daytimeAutoEligible(eligibleUav), true);
  const withDrone = { ...eligibleUav, type: 'military_incursion', dronePresence: true };
  assert.equal(nightEligible(withDrone), false, 'a drone-presence report stays out of the night queue');
  assert.equal(daytimeAutoEligible(withDrone), false, 'a drone-presence report stays out of the daytime queue');
});
