import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../server/config.js';
import { store } from '../server/store.js';
import { initialJobsState, createPendingJob, decideJob, publicJobs, mergeJobsFromBackup } from '../server/jobs.js';
import { operatorJobsStatus, operatorJobReview, operateJobDraft } from '../server/jobs-operator.js';

const NOW = Date.parse('2026-11-22T13:00:00Z');
async function fixture(run, extra = {}) {
  const old = { jobs: store.state.jobs, backup: store.backup, paused: store._backupWritesPaused, persist: store.persist, flush: store.flushBackup, merge: store.mergeFromBackup, emit: store.emit, enabled: config.telegramBackup };
  const jobs = initialJobsState();
  const { job } = createPendingJob({ kind: 'source', sourceKey: 'test:operator:1', title: 'محاسب', text: 'فرصة عمل محاسب في دمشق\nآخر موعد للتقديم: 2026/12/20', links: ['https://example.org/apply'], sourceUrl: 'https://t.me/test_jobs/1', ...extra }, jobs, NOW - 1000);
  const events = [];
  store.state.jobs = jobs; store.backup = null; store._backupWritesPaused = false; config.telegramBackup = true;
  store.persist = () => {};
  store.flushBackup = async () => true;
  store.mergeFromBackup = async () => ({ backupLoaded: true });
  store.emit = (event, value) => { events.push({ event, value }); return true; };
  try { await run({ jobs, job, events }); }
  finally {
    store.state.jobs = old.jobs; store.backup = old.backup; store._backupWritesPaused = old.paused;
    store.persist = old.persist; store.flushBackup = old.flush; store.mergeFromBackup = old.merge; store.emit = old.emit; config.telegramBackup = old.enabled;
  }
}

test('private jobs review exposes source, stable revision and explicit site-only choices', async () => fixture(async ({ job }) => {
  const review = operatorJobReview(job.id, NOW);
  assert.equal(review.source.url, 'https://t.me/test_jobs/1');
  assert.equal(review.application_deadline, '2026-12-20');
  assert.deepEqual(review.actions, ['ignore', 'approve_without_location']);
  assert.deepEqual(review.issues, []);
  job.cards.push([1, 2]); job.notifiedAt = NOW;
  assert.equal(operatorJobReview(job.id, NOW).revision, review.revision, 'private card delivery does not stale an editorial review');
  assert.equal(operatorJobsStatus(NOW).pending_count, 1);
}));

test('site approval is idempotent and does not create news or Telegram publication', async () => fixture(async ({ jobs, job, events }) => {
  const newsBefore = JSON.stringify(store.state.news);
  const request = { action: 'approve_without_location', revision: operatorJobReview(job.id, NOW).revision };
  const result = await operateJobDraft(job.id, request, NOW);
  assert.equal(result.ok, true); assert.equal(result.visible, true); assert.equal(result.telegram_publication, false);
  assert.equal(publicJobs(jobs, NOW).length, 1);
  assert.equal(jobs.published[job.id].reviewedBy.kind, 'delegated-listings-operator');
  const again = await operateJobDraft(job.id, request, NOW + 1000);
  assert.equal(again.reused, true); assert.equal(again.ok, true);
  assert.equal(events.length, 1); assert.equal(events[0].event, 'jobs');
  assert.equal(JSON.stringify(store.state.news), newsBefore);
  assert.equal(jobs.published[job.id].publishedAt, new Date(NOW).toISOString());
}));

test('stale source text, links or a changed calendar date cannot be approved', async () => fixture(async ({ job }) => {
  const request = { action: 'approve_without_location', revision: operatorJobReview(job.id, NOW).revision };
  job.text += '\nتعديل جديد على الشروط';
  await assert.rejects(operateJobDraft(job.id, request, NOW), /stale-review/);
  const next = { ...request, revision: operatorJobReview(job.id, NOW).revision };
  job.links = ['https://example.org/changed'];
  await assert.rejects(operateJobDraft(job.id, next, NOW), /stale-review/);
  const midnight = { ...request, revision: operatorJobReview(job.id, NOW).revision };
  await assert.rejects(operateJobDraft(job.id, midnight, NOW + 86400000), /stale-review/);
}));

test('source deadline expiry blocks approval but can be explicitly ignored with audit retained', async () => fixture(async ({ jobs, job }) => {
  job.text = 'فرصة عمل محاسب\nآخر موعد للتقديم: 2026/11/21';
  const review = operatorJobReview(job.id, NOW);
  assert.deepEqual(review.issues, ['application-deadline-expired']);
  await assert.rejects(operateJobDraft(job.id, { action: 'approve_without_location', revision: review.revision }, NOW), /application-deadline-expired/);
  const result = await operateJobDraft(job.id, { action: 'ignore', revision: review.revision }, NOW);
  assert.equal(result.ok, true); assert.equal(result.status, 'ignored');
  assert.equal(jobs.decisions[job.id].reviewedSource.text, job.text);
  assert.equal(operatorJobReview(job.id, NOW).operation.result, 'ignored');
}));

test('non-monitored intake is outside this delegated interface', async () => fixture(async ({ job }) => {
  assert.deepEqual(operatorJobReview(job.id, NOW).actions, []);
  await assert.rejects(operateJobDraft(job.id, { action: 'ignore', revision: operatorJobReview(job.id, NOW).revision }, NOW), /outside-monitored-job-scope/);
}, { kind: 'employer' }));

test('normal approval still needs location and never silently chooses one', async () => fixture(async ({ jobs, job }) => {
  await assert.rejects(operateJobDraft(job.id, { action: 'approve', revision: operatorJobReview(job.id, NOW).revision }, NOW), /location_required/);
  assert.ok(jobs.pending[job.id]); assert.equal(Object.keys(jobs.published).length, 0);
}));

test('existing bot decisions win over a stale operator request', async () => fixture(async ({ jobs, job }) => {
  const revision = operatorJobReview(job.id, NOW).revision;
  decideJob(job.id, 'ignore', jobs, 7, NOW);
  await assert.rejects(operateJobDraft(job.id, { action: 'approve_without_location', revision }, NOW), /listing-already-handled/);
}));

test('a matching approved fingerprint is surfaced and cannot be republished', async () => fixture(async ({ jobs, job }) => {
  jobs.published.existing = { ...job, id: 'existing', status: 'approved', publishedWithoutLocation: true };
  const review = operatorJobReview(job.id, NOW);
  assert.equal(review.duplicateOf, 'existing');
  await assert.rejects(operateJobDraft(job.id, { action: 'approve_without_location', revision: review.revision }, NOW), /duplicate-listing/);
}));

test('startup backup recovery and unverifiable current backup stop writes', async () => fixture(async ({ job }) => {
  const request = { action: 'approve_without_location', revision: operatorJobReview(job.id, NOW).revision };
  store.backup = {}; store._backupWritesPaused = true;
  assert.equal(operatorJobsStatus(NOW).decision_writes_ready, false);
  await assert.rejects(operateJobDraft(job.id, request, NOW), /backup-recovery-in-progress/);
  store._backupWritesPaused = false; store.mergeFromBackup = async () => ({ backupLoaded: false });
  await assert.rejects(operateJobDraft(job.id, request, NOW), /latest-backup-unverified/);
}));

test('backup merge happens before revision and terminal-state checks', async () => fixture(async ({ jobs, job }) => {
  const request = { action: 'approve_without_location', revision: operatorJobReview(job.id, NOW).revision };
  store.backup = {};
  store.mergeFromBackup = async () => { decideJob(job.id, 'ignore', jobs, 7, NOW); return { backupLoaded: true }; };
  await assert.rejects(operateJobDraft(job.id, request, NOW), /listing-already-handled/);
}));

test('failed durability is explicit and exact retries cannot repeat the decision', async () => fixture(async ({ jobs, job, events }) => {
  const request = { action: 'approve_without_location', revision: operatorJobReview(job.id, NOW).revision };
  store.backup = {}; store.flushBackup = async () => false;
  const first = await operateJobDraft(job.id, request, NOW);
  assert.equal(first.ok, false); assert.equal(first.status, 'approved-backup-unverified');
  assert.equal(events.length, 0);
  const retry = await operateJobDraft(job.id, request, NOW + 1000);
  assert.equal(retry.reused, true); assert.equal(retry.ok, false);
  assert.equal(Object.keys(jobs.published).length, 1);
}));

test('operator decision and source audit survive backup merging', async () => fixture(async ({ jobs, job }) => {
  const request = { action: 'ignore', revision: operatorJobReview(job.id, NOW).revision };
  await operateJobDraft(job.id, request, NOW);
  const restored = initialJobsState();
  mergeJobsFromBackup({ jobs: JSON.parse(JSON.stringify(jobs)) }, restored);
  assert.equal(restored.decisions[job.id].operatorReview.revision, request.revision);
  assert.equal(restored.decisions[job.id].reviewedSource.text, job.text);
  assert.equal(restored.pending[job.id], undefined);
}));

test('closed Google application links cannot be approved through the operator route', async () => fixture(async ({ job }) => {
  const review = operatorJobReview(job.id, NOW);
  assert.ok(review.issues.includes('application-link-closed'));
  await assert.rejects(operateJobDraft(job.id, { action: 'approve_without_location', revision: review.revision }, NOW), /application-link-closed/);
}, { links: ['https://docs.google.com/forms/d/e/test-form/closedform', 'https://t.me/Syrian_jobbb'] }));

test('invalid operations and unknown ids do not mutate listing state', async () => fixture(async ({ jobs }) => {
  await assert.rejects(operateJobDraft('missing', { action: 'publish-news' }, NOW), /invalid-operation/);
  await assert.rejects(operateJobDraft('missing', { action: 'ignore', revision: 'x' }, NOW), /unknown-listing/);
  assert.equal(operatorJobReview('__proto__', NOW), null);
  assert.equal(Object.keys(jobs.pending).length, 1);
}));
