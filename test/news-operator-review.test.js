import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-operator-'));
process.env.DATA_DIR = dir; process.env.TELEGRAM_BACKUP = 'false'; process.env.BOT_TOKEN = '12345:mock';
const { store } = await import('../server/store.js'); await store.init(null);
const mon = await import('../server/news-monitor.js'); const { locationFrom } = await import('../server/places.js');
const loc = locationFrom({ placeId: 167501 }); let calls = 0, publisher;
function setup(extra = {}) {
  calls = 0; publisher = async () => ({ id: 'synthetic-alert', channel_message_id: 9 });
  mon._test.R.H = { apis: () => ({ admin: {} }), publishDraft: async (...args) => { calls++; return publisher(...args); } };
  const n = mon.newsState(); n.echoLog = []; n.alerts = []; n.drafts = {};
  n.drafts.a = { id: 'a', status: 'pending', type: 'explosion', headline: 'انفجار في محجة', body: 'انفجار عبوة ناسفة في بلدة محجة أدى إلى إصابة شاب.', sourceText: 'انفجار عبوة ناسفة في بلدة محجة أدى إلى إصابة شاب.', sourceTextVersion: 2,
    loc, extra: [], srcs: [{ u: 'synthetic', name: 'اختبار', url: 'https://t.me/synthetic/1', local: false }], created: Date.now(), ts: Date.now(), cards: [], ...extra };
  return mon.operatorNewsReview('a');
}
test.after(async () => { mon._test.R.H = null; await new Promise((r) => setTimeout(r, 350)); fs.rmSync(dir, { recursive: true, force: true }); });
test('review gives original source, locations, exact revision and safe candidate without publishing', () => {
  const review = setup(); assert.equal(review.issue, null); assert.equal(review.revision.length, 64); assert.ok(review.sourceText.includes('محجة')); assert.equal(calls, 0);
});
test('stale reviews and synthetic test drafts cannot publish', async () => {
  let r = setup(); store.state.news.drafts.a.body += ' تغيير';
  await assert.rejects(mon.operateNewsDraft('a', { action: 'publish', revision: r.revision }), /stale-review/);
  r = setup({ test: true }); await assert.rejects(mon.operateNewsDraft('a', { action: 'publish', revision: r.revision }), /test-draft/); assert.equal(calls, 0);
});
test('hold is durable-in-state, repeatable and leaves no auto-publish timer', async () => {
  const r = setup({ dayAutoAt: Date.now() + 1000 }); const a = await mon.operateNewsDraft('a', { action: 'hold', revision: r.revision });
  assert.equal(a.status, 'held'); assert.equal(store.state.news.drafts.a.editorialHold, true); assert.equal(store.state.news.drafts.a.dayAutoAt, null);
  assert.equal((await mon.operateNewsDraft('a', { action: 'hold', revision: r.revision })).reused, true); assert.equal(calls, 0);
});
test('concurrent and replayed operations publish once through the existing runtime', async () => {
  const r = setup(); let finish; publisher = () => new Promise((resolve) => { finish = resolve; });
  const p = mon.operateNewsDraft('a', { action: 'publish', revision: r.revision }); await new Promise(setImmediate);
  await assert.rejects(mon.operateNewsDraft('a', { action: 'publish', revision: r.revision }), /already-handled/);
  finish({ id: 'synthetic-alert', channel_message_id: 9 }); const result = await p;
  assert.equal(result.status, 'published'); assert.equal(calls, 1);
  assert.equal((await mon.operateNewsDraft('a', { action: 'publish', revision: r.revision })).reused, true); assert.equal(calls, 1);
});
test('ambiguous send is not reset to pending and cannot be blindly retried', async () => {
  const r = setup(); publisher = async () => { throw new Error('simulated timeout'); };
  await assert.rejects(mon.operateNewsDraft('a', { action: 'publish', revision: r.revision }), /outcome-unverified/);
  assert.equal(store.state.news.drafts.a.status, 'publishing'); assert.equal(store.state.news.drafts.a.operatorReview.result, 'uncertain');
  await assert.rejects(mon.operateNewsDraft('a', { action: 'publish', revision: r.revision }), /already-handled/); assert.equal(calls, 1);
});
test('map-only outcome exposes its existing alert, never success or a second publish', async () => {
  const r = setup(); publisher = async () => ({ id: 'synthetic-map-only' });
  const result = await mon.operateNewsDraft('a', { action: 'publish', revision: r.revision });
  assert.equal(result.ok, false); assert.equal(result.status, 'map-only'); assert.equal(result.alertId, 'synthetic-map-only');
  assert.equal((await mon.operateNewsDraft('a', { action: 'publish', revision: r.revision })).reused, true); assert.equal(calls, 1);
});
test('local reports without an independently reviewed source stay pending', async () => {
  const r = setup({ srcs: [{ u: 'local', name: 'محلي', local: true }] });
  await assert.rejects(mon.operateNewsDraft('a', { action: 'publish', revision: r.revision }), /independent-source-review/); assert.equal(calls, 0);
});
test('supported duplicate is suppressed before a send; unsupported duplicate action does nothing', async () => {
  let r = setup(); await assert.rejects(mon.operateNewsDraft('a', { action: 'duplicate', revision: r.revision }), /no-supported-duplicate/);
  const d = store.state.news.drafts.a; store.state.news.echoLog = [{ id: 'older-published', ts: Date.now(), type: d.type, text: d.sourceText, geo: mon._test.geoOf([loc]) }];
  r = mon.operatorNewsReview('a'); assert.equal(r.duplicate.id, 'older-published');
  const result = await mon.operateNewsDraft('a', { action: 'publish', revision: r.revision });
  assert.equal(result.status, 'duplicate'); assert.equal(result.duplicateOf, 'older-published'); assert.equal(calls, 0);
});
