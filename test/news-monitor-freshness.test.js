import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Regression suite for the "auto-monitor ingests OLD news" defect (owner report
// 2026-11-17): after redeploys/restarts the monitor must never treat old source
// posts as new. The freshness window is NEWS_CFG.maxAgeMin (45 min by default),
// enforced at the poll gate, the filter rescan, the desk (handleResult) and the
// auto-publish eligibility checks. Fixture-based: no live network.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-news-freshness-'));
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
const { newsState, nightEligible, daytimeAutoEligible, isFreshSourceTs, NEWS_CFG, FILTER_VER, _test } = await import('../server/news-monitor.js');

const CHAN = 'freshchan';
const TEXT = 'اشتباكات عنيفة واقتحام حاجز أمني في مدينة دمشق أسفرت عن إصابات';
const MIN = 60_000;
const WIN = NEWS_CFG.maxAgeMin * MIN;

const originalFetch = globalThis.fetch;
const originalH = _test.R.H;
let fixtureHtml = '';
let publishCalls = 0;

const postHtml = (id, ts) => `
<div class="tgme_widget_message_wrap js-widget_message_wrap">
  <div class="tgme_widget_message js-widget_message" data-post="${CHAN}/${id}">
    <div class="tgme_widget_message_text js-message_text" dir="auto">${TEXT}</div>
    <div class="tgme_widget_message_info"><a class="tgme_widget_message_date" href="https://t.me/${CHAN}/${id}"><time datetime="${new Date(ts).toISOString()}"></time></a></div>
  </div>
</div>`;
const pageHtml = (posts) => `<html><head><meta property="og:title" content="Fixture"></head><body><div class="tgme_channel_info"></div>${posts.map(([id, ts]) => postHtml(id, ts)).join('')}</body></html>`;

function installStubs() {
  globalThis.fetch = async (url, options) => {
    const u = String(url);
    if (u.startsWith('https://t.me/s/')) return { ok: true, status: 200, text: async () => fixtureHtml };
    if (u.includes('generativelanguage')) {
      assert.equal(options.method, 'POST');
      const answer = [{ i: 1, event: true, type: 'attack', political_category: null, new_incident: true, same_as: null, places: [{ name: 'دمشق', gov: 'دمشق' }], headline: 'اقتحام حاجز أمني في دمشق' }];
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }) };
    }
    throw new Error('unexpected fetch in freshness test: ' + u);
  };
  _test.R.H = {
    apis: () => ({ admin: { sendMessage: async () => ({ message_id: 1 }) } }),
    publishDraft: async () => { publishCalls++; return { id: 'must-not-auto-publish' }; },
  };
}

function resetMonitor() {
  const n = newsState();
  n.on = true;
  n.sources = [{ u: CHAN, name: 'قناة اختبار', on: true, general: false, local: true }];
  n.last = {}; n.seen = {}; n.handled = {}; n.drafts = {}; n.alerts = [];
  n.fver = FILTER_VER;
  _test.R.queue.length = 0; _test.R.busy = false; _test.R.lastAiAt = 0; _test.R.log.length = 0;
  store.state.alerts = [];
  publishCalls = 0;
  return n;
}

test.after(async () => {
  globalThis.fetch = originalFetch;
  _test.R.H = originalH;
  _test.R.queue.length = 0;
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

test('the freshness window itself: inside is fresh, outside/missing/invalid is not', () => {
  const now = Date.now();
  assert.equal(isFreshSourceTs(now - (WIN - MIN), now), true);
  assert.equal(isFreshSourceTs(now - (WIN + MIN), now), false);
  assert.equal(isFreshSourceTs(null, now), false);
  assert.equal(isFreshSourceTs(undefined, now), false);
  assert.equal(isFreshSourceTs(NaN, now), false);
  assert.equal(isFreshSourceTs(0, now), false);
});

test('simulated restart with a rolled-back checkpoint replays no old posts (2h / 6h / 1d)', async () => {
  installStubs();
  const n = resetMonitor();
  const now = Date.now();
  // the durable watermark was rolled back (stale backup / wiped memory): the whole
  // visible preview history looks "new" to the checkpoint logic again
  n.last[CHAN] = 100;
  fixtureHtml = pageHtml([[101, now - 2 * 60 * MIN], [102, now - 6 * 60 * MIN], [103, now - 25 * 60 * MIN]]);
  await _test.pollOnce();
  assert.equal(Object.keys(n.drafts).length, 0, 'no draft may be created from old posts after a restart');
  assert.equal(_test.R.queue.length, 0, 'nothing old is queued for the desk');
  assert.equal(publishCalls, 0, 'nothing old is auto-published');
  assert.equal(n.last[CHAN], 103, 'the watermark still advances past the old history');
  const tooOld = _test.R.log.filter((e) => e.decision === 'too old');
  assert.equal(tooOld.length, 3, 'each old post is dropped with a "too old" log line');
  for (const id of [101, 102, 103]) assert.ok(Number.isFinite(n.handled[`${CHAN}/${id}`]), `post ${id} is durably marked handled`);
});

test('a fresh post (5 min old) after the same restart is processed normally', async () => {
  installStubs();
  const n = resetMonitor();
  const now = Date.now();
  n.last[CHAN] = 103;
  const freshTs = now - 5 * MIN;
  fixtureHtml = pageHtml([[101, now - 2 * 60 * MIN], [102, now - 6 * 60 * MIN], [103, now - 25 * 60 * MIN], [104, freshTs]]);
  await _test.pollOnce();
  const drafts = Object.values(n.drafts);
  assert.equal(drafts.length, 1, 'exactly the fresh post becomes a draft');
  assert.ok(drafts[0].srcs[0].url.endsWith('/104'));
  assert.equal(drafts[0].ts, freshTs, 'the draft keeps the source timestamp');
  assert.equal(drafts[0].status, 'pending', 'a single local source stays in human review');
});

test('boundary: a post just inside the window is drafted, one just outside is dropped', async () => {
  installStubs();
  const n = resetMonitor();
  const now = Date.now();
  n.last[CHAN] = 200;
  fixtureHtml = pageHtml([[201, now - (WIN - 3 * MIN)]]);
  await _test.pollOnce();
  assert.equal(Object.keys(n.drafts).length, 1, 'post inside the window is drafted');

  fixtureHtml = pageHtml([[201, now - (WIN - 3 * MIN)], [202, now - (WIN + 3 * MIN)]]);
  await _test.pollOnce();
  assert.equal(Object.keys(n.drafts).length, 1, 'post outside the window adds no draft');
  assert.ok(Number.isFinite(n.handled[`${CHAN}/202`]), 'the outside post is durably marked handled');
  assert.ok(_test.R.log.some((e) => e.decision === 'too old' && e.url.endsWith('/202')));
});

test('the filter rescan obeys the same window: 30 min old is re-checked, 2h old stays history', async () => {
  installStubs();
  const n = resetMonitor();
  const now = Date.now();
  n.fver = FILTER_VER - 1; // a rule fix shipped: the rescan runs once on this boot
  n.last[CHAN] = 300; // both posts are already behind the checkpoint
  fixtureHtml = pageHtml([[298, now - 2 * 60 * MIN], [299, now - 30 * MIN]]);
  await _test.rescanIfFilterChanged();
  assert.equal(n.fver, FILTER_VER);
  const drafts = Object.values(n.drafts);
  assert.equal(drafts.length, 1, 'only the in-window skipped post is re-drafted');
  assert.ok(drafts[0].srcs[0].url.endsWith('/299'));
});

test('the desk itself drops an old item even if some path queued it', async () => {
  installStubs();
  const n = resetMonitor();
  const r = { i: 1, event: true, type: 'attack', political_category: null, new_incident: true, same_as: null, places: [{ name: 'دمشق', gov: 'دمشق' }], headline: 'اقتحام حاجز أمني في دمشق' };
  const base = { src: { u: CHAN, name: 'قناة اختبار', local: true }, text: TEXT };
  await _test.handleResult({ ...base, i: 1, url: `https://t.me/${CHAN}/401`, ts: Date.now() - 2 * 60 * MIN }, r, [], new Map());
  assert.equal(Object.keys(n.drafts).length, 0, 'an old item is never drafted as new');
  assert.ok(_test.R.log.some((e) => e.decision === 'too old'));
  await _test.handleResult({ ...base, i: 1, url: `https://t.me/${CHAN}/402`, ts: Date.now() - MIN }, r, [], new Map());
  assert.equal(Object.keys(n.drafts).length, 1, 'a fresh item is drafted');
});

test('auto-publish eligibility follows the newest source timestamp, not the draft age alone', () => {
  const now = Date.now();
  const base = {
    type: 'attack', status: 'pending', test: false, rule: false, created: now,
    loc: { scope: 'place', latitude: 33.5, longitude: 36.3 },
  };
  const fresh = { ...base, id: 'elig-fresh', ts: now - MIN, srcs: [{ u: 'wire', local: false, ts: now - MIN }] };
  assert.equal(daytimeAutoEligible(fresh), true, 'control: a fresh draft is eligible');
  assert.equal(nightEligible(fresh), true, 'control: a fresh draft is eligible at night');
  const stale = { ...base, id: 'elig-stale', ts: now - 2 * 60 * MIN, srcs: [{ u: 'wire', local: false, ts: now - 2 * 60 * MIN }] };
  assert.equal(daytimeAutoEligible(stale), false, 'a draft whose reporting is 2h old is never auto-published (e.g. restored from an old backup)');
  assert.equal(nightEligible(stale), false, 'same at night');
  const corroborated = { ...base, id: 'elig-corroborated', ts: now - 2 * 60 * MIN, srcs: [{ u: 'wire', local: false, ts: now - 2 * 60 * MIN }, { u: 'wire2', local: false, ts: now - MIN }] };
  assert.equal(nightEligible(corroborated), true, 'a fresh corroborating source makes the incident current again');
});
