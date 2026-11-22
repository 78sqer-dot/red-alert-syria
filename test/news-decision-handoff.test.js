import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-news-handoff-'));
process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BACKUP = 'true';
process.env.BOT_TOKEN = '12345:mock';
const { store } = await import('../server/store.js');
await store.init(null);
const mon = await import('../server/news-monitor.js');
const now = Date.now();
const older = now - 2000, newer = now - 1000;
function setup(extra = {}) {
  clearTimeout(store._backupTimer); clearTimeout(store._saveTimer);
  store.backup = null; store._backupWritesPaused = false;
  store.state.alerts = []; store.state.reports = {}; store.state.reportsDone = {}; store.state.gone = {};
  const n = mon.newsState(); n.drafts = {}; n.alerts = []; n.echoLog = [];
  n.drafts.a = { id: 'a', status: 'pending', type: 'political', politicalCategory: 'statement',
    headline: 'اختبار خاص غير مخصص للنشر', body: 'هذا نص تجريبي لا يمثل خبراً حقيقياً ولا يجوز نشره.',
    sourceText: 'هذا نص تجريبي لا يمثل خبراً حقيقياً ولا يجوز نشره.', sourceTextVersion: 2,
    loc: { scope: 'country', name_ar: 'سوريا', latitude: null, longitude: null }, extra: [],
    srcs: [{ name: 'synthetic', url: 'https://example.com/synthetic' }], ts: now, created: now, cards: [],
    dayAutoAt: now + 5000, autoMode: 'day', ...extra };
  return n.drafts.a;
}
function merge(remote) { mon.mergeNewsFromBackup({ news: { drafts: { a: remote } } }); }
function held(d, at = newer) {
  const remote = structuredClone(d);
  remote.editorialHold = true; remote.editorialHoldReason = 'operator-review-hold'; remote.dayAutoAt = null;
  delete remote.autoMode;
  remote.operatorReview = { at, revision: 'synthetic-held-revision', result: 'held' };
  return remote;
}

test('pending-to-pending remote HOLD survives handoff with operation proof and cleared auto deadline', () => {
  const d = setup(); const remote = held(d);
  merge(remote);
  assert.equal(d.status, 'pending'); assert.equal(d.editorialHold, true);
  assert.equal(d.editorialHoldReason, remote.editorialHoldReason);
  assert.deepEqual(d.operatorReview, remote.operatorReview);
  assert.equal(d.dayAutoAt, null); assert.equal(Object.hasOwn(d, 'autoMode'), false);
});

test('merge keeps local source audit and does not mutate or alias the incoming snapshot', () => {
  const d = setup(); const remote = held(d);
  remote.sourceText = 'older remote working text'; remote.headline = 'older headline';
  remote.loc = { scope: 'governorate', name_ar: 'مدينة تجريبية' }; remote.srcs = [];
  const before = structuredClone(remote); const source = d.sourceText; const loc = structuredClone(d.loc);
  merge(remote);
  assert.equal(d.sourceText, source); assert.deepEqual(d.loc, loc); assert.equal(d.srcs.length, 1);
  assert.deepEqual(remote, before); d.operatorReview.result = 'local-change';
  assert.equal(remote.operatorReview.result, 'held');
});

test('newer local HOLD is not overwritten by an older remote duplicate decision', () => {
  const d = setup({ editorialHold: true, operatorReview: { at: newer, result: 'held' } });
  merge({ ...structuredClone(d), status: 'duplicate', duplicateOf: 'older-canonical', operatorReview: { at: older, result: 'duplicate' } });
  assert.equal(d.status, 'pending'); assert.equal(d.editorialHold, true); assert.equal(d.duplicateOf, undefined);
});

test('duplicate transition preserves canonical pointer and audit proof, not only status', () => {
  const d = setup(); const remote = held(d);
  Object.assign(remote, { status: 'duplicate', duplicateOf: 'canonical-existing', duplicateMarkedAt: newer,
    operatorReview: { at: newer, revision: 'synthetic-duplicate', result: 'duplicate' } });
  merge(remote);
  assert.equal(d.status, 'duplicate'); assert.equal(d.duplicateOf, 'canonical-existing');
  assert.deepEqual(d.operatorReview, remote.operatorReview); assert.equal(d.duplicateMarkedAt, newer);
  assert.equal(d.postId, undefined);
});

test('confirmed publication transition carries both map and Telegram identifiers', () => {
  const d = setup(); const remote = { ...structuredClone(d), status: 'published', alertId: 'synthetic-alert', postId: 42,
    approvedAt: new Date(newer).toISOString(), publishedHeadline: 'synthetic approved copy',
    operatorReview: { at: older, revision: 'synthetic-publish', result: 'published' } };
  merge(remote);
  assert.equal(d.status, 'published'); assert.equal(d.alertId, 'synthetic-alert'); assert.equal(d.postId, 42);
  assert.equal(d.approvedAt, remote.approvedAt); assert.deepEqual(d.operatorReview, remote.operatorReview);
});

test('terminal publication cannot be reopened by a newer pending HOLD from another instance', () => {
  const d = setup({ status: 'published', alertId: 'synthetic-alert', postId: 42, approvedAt: new Date(older).toISOString() });
  merge({ ...held(d), status: 'pending' });
  assert.equal(d.status, 'published'); assert.equal(d.postId, 42); assert.equal(d.editorialHold, undefined);
});

test('terminal duplicate cannot be reopened by a newer pending HOLD', () => {
  const d = setup({ status: 'duplicate', duplicateOf: 'canonical-existing', duplicateMarkedAt: older });
  merge({ ...held(d), status: 'pending' });
  assert.equal(d.status, 'duplicate'); assert.equal(d.duplicateOf, 'canonical-existing');
});

test('an unresolved publishing claim cannot be cleared by an incoming HOLD', () => {
  const d = setup({ status: 'publishing', operatorReview: { at: older, revision: 'claimed', result: 'uncertain' } });
  merge({ ...held(d), status: 'pending' });
  assert.equal(d.status, 'publishing'); assert.equal(d.operatorReview.result, 'uncertain');
});

test('an incoming unresolved claim is retained rather than becoming publishable again', () => {
  const d = setup();
  merge({ ...held(d), status: 'publishing', editorialHoldReason: 'operator-send-needs-reconciliation',
    operatorReview: { at: newer, revision: 'remote-claim', result: 'uncertain' } });
  assert.equal(d.status, 'publishing'); assert.equal(d.operatorReview.result, 'uncertain');
  assert.equal(d.editorialHold, true); assert.equal(d.editorialHoldReason, 'operator-send-needs-reconciliation');
});

test('a publishing claim can advance to its confirmed publication with proof', () => {
  const d = setup({ status: 'publishing', operatorReview: { at: older, revision: 'claimed', result: 'claimed' } });
  merge({ ...structuredClone(d), status: 'published', alertId: 'confirmed-alert', postId: 77,
    approvedAt: new Date(newer).toISOString(), operatorReview: { at: older, revision: 'claimed', result: 'published' } });
  assert.equal(d.status, 'published'); assert.equal(d.alertId, 'confirmed-alert'); assert.equal(d.postId, 77);
});

test('legacy terminal transitions without timestamps still retain their publication proof', () => {
  const d = setup(); merge({ ...structuredClone(d), status: 'published', alertId: 'legacy-alert', postId: 11 });
  assert.equal(d.status, 'published'); assert.equal(d.alertId, 'legacy-alert'); assert.equal(d.postId, 11);
});

test('same operation replay is idempotent and cannot clear the hold', () => {
  const d = setup(); const remote = held(d); merge(remote); const before = structuredClone(d); merge(remote);
  assert.deepEqual(d, before);
});

test('real store handoff and confirmed save retain a late HOLD through another restore', async () => {
  const d = setup(); const remote = { ...structuredClone(store.state), news: { ...structuredClone(mon.newsState()), drafts: { a: held(d) } } };
  let pinned = JSON.stringify(remote);
  store.backup = { load: async () => pinned, save: async (json) => { pinned = json; } };
  store.mergeHooks = [mon.mergeNewsFromBackup]; store._backupWritesPaused = true; store._restoredAt = now;
  const result = await store.mergeFromBackup(); assert.equal(result.backupLoaded, true);
  assert.equal(mon.newsState().drafts.a.editorialHold, true);
  store._backupWritesPaused = false; store.persist(); assert.equal(await store.flushBackup(true), true);
  store._apply(JSON.parse(pinned));
  assert.equal(mon.newsState().drafts.a.editorialHold, true);
  assert.equal(mon.newsState().drafts.a.operatorReview.result, 'held');
  store.backup = null; store.mergeHooks = [];
});

test('startup recovery rejects decision APIs before any state change or false acknowledgement', async () => {
  const d = setup(); const review = mon.operatorNewsReview(d.id); const before = JSON.stringify(mon.newsState());
  store.backup = { save: async () => { throw new Error('must not save during recovery'); } }; store._backupWritesPaused = true;
  const paused = mon.operatorNewsStatus(); assert.equal(paused.decision_writes_ready, false);
  try {
    await assert.rejects(mon.operateNewsDraft(d.id, { action: 'hold', revision: review.revision }), /backup-recovery-in-progress/);
    await assert.rejects(mon.setOperatorNewsMode('automatic'), /backup-recovery-in-progress/);
    await assert.rejects(mon.reconcilePublishedNewsDuplicate('a', { duplicateId: 'b' }), /backup-recovery-in-progress/);
    assert.equal(JSON.stringify(mon.newsState()), before);
  } finally { store._backupWritesPaused = false; store.backup = null; }
  const ready = mon.operatorNewsStatus(); assert.equal(ready.decision_writes_ready, true);
  assert.notEqual(ready.revision, paused.revision, 'readiness changes must wake status-gated callers');
});

test.after(async () => {
  store.backup = null; store._backupWritesPaused = false; store.mergeHooks = [];
  clearTimeout(store._backupTimer); clearTimeout(store._saveTimer);
  await new Promise((resolve) => setTimeout(resolve, 350)); fs.rmSync(dir, { recursive: true, force: true });
});
