import test from 'node:test';
import assert from 'node:assert/strict';
import { labelledApplicationDeadline } from '../server/application-deadline.js';
import { initialJobsState, createPendingJob, decideJob, publicJobs, effectiveJobDeadline, updateJobDeadline, updatePublishedJob, deleteJobListing, mergeJobsFromBackup } from '../server/jobs.js';

const NOW = Date.parse('2026-11-22T13:00:00Z');
const labelled = (date) => `فرصة عمل محاسب في سوريا\nآخر موعد للتقديم: ${date}\nرابط التقديم: https://example.org/apply`;
function approved(text, extra = {}) {
  const jobs = initialJobsState();
  const { job } = createPendingJob({ kind: 'source', sourceKey: 'test:source-deadline', text, ...extra }, jobs, NOW - 2000);
  assert.ok(job);
  assert.equal(decideJob(job.id, 'approve_without_location', jobs, 7, NOW - 1000).ok, true);
  return { jobs, job };
}

test('labelled source deadlines accept valid year-first separators and localized digits', () => {
  for (const value of ['2026/11/21', '2026.11.21', '2026-11-21', '٢٠٢٦/١١/٢١', '۲۰۲۶/۱۱/۲۱']) assert.equal(labelledApplicationDeadline(labelled(value)), '2026-11-21');
  assert.equal(labelledApplicationDeadline('أخر موعد لتقديم الطلبات هو يوم الأحد 22-11-2026'), '2026-11-22');
  assert.equal(labelledApplicationDeadline('تاريخ إغلاق التقديم: 21.11.2026'), '2026-11-21');
  assert.equal(labelledApplicationDeadline('Deadline to apply for a vacancy: 29.11.2026'), '2026-11-29');
});

test('labelled source deadlines accept named months and a separate following date line', () => {
  assert.equal(labelledApplicationDeadline(labelled('21 تشرين الثاني 2026')), '2026-11-21');
  assert.equal(labelledApplicationDeadline('الموعد النهائي 21- تشرين الثاني - 2026'), '2026-11-21');
  assert.equal(labelledApplicationDeadline('Application deadline: 21 November 2026'), '2026-11-21');
  assert.equal(labelledApplicationDeadline('آخر موعد للتقديم:\n25/11/2026'), '2026-11-25');
  assert.equal(labelledApplicationDeadline('موعد تقديم الطلبات:\nاعتباراً من 15-11-2026 ولغاية 22-11-2026.'), '2026-11-22');
  assert.equal(labelledApplicationDeadline('نهاية الإعلان: 23/11/2026'), '2026-11-23');
  assert.equal(labelledApplicationDeadline('ينتهي التقديم على الفرصة بتاريخ 2026/12/16'), '2026-12-16');
});

test('source deadline parsing rejects unlabelled, impossible, ambiguous and conflicting dates', () => {
  for (const value of ['تاريخ نشر الوظيفة: 2026/11/21', labelled('2026/02/30'), labelled('06/12/2026'), labelled('قريباً'), 'قد يتم إغلاق الإعلان قبل الموعد المحدد عند اكتمال العدد']) assert.equal(labelledApplicationDeadline(value), null);
  assert.equal(labelledApplicationDeadline(`${labelled('2026/11/21')}\nآخر موعد للتقديم: 2026/11/30`), null);
  assert.equal(labelledApplicationDeadline(`نشر بتاريخ 2026/11/10\n${labelled('2026/12/20')}`), '2026-12-20');
});

test('past source-labelled deadlines are excluded without altering approval or raw text', () => {
  const { jobs, job } = approved(labelled('2026/11/21'));
  const before = JSON.stringify(jobs);
  assert.equal(effectiveJobDeadline(job), '2026-11-21');
  assert.equal(publicJobs(jobs, NOW).length, 0);
  assert.equal(JSON.stringify(jobs), before);
  assert.equal(job.status, 'approved');
});

test('a source deadline remains active for its whole Damascus calendar date', () => {
  const { jobs } = approved(labelled('2026/11/22'));
  const visible = publicJobs(jobs, Date.parse('2026-11-22T20:59:59Z'));
  assert.equal(visible.length, 1);
  assert.equal(visible[0].application_deadline, '2026-11-22');
  assert.equal(publicJobs(jobs, Date.parse('2026-11-22T21:00:00Z')).length, 0);
});

test('explicit admin extensions and explicit removal override an older source date', () => {
  const { jobs, job } = approved(labelled('2026/11/21'));
  assert.equal(updateJobDeadline(job.id, '2026-12-01', jobs, 7, NOW).ok, true);
  assert.equal(publicJobs(jobs, NOW)[0].application_deadline, '2026-12-01');
  assert.equal(updateJobDeadline(job.id, null, jobs, 7, NOW + 1000).ok, true);
  assert.equal(publicJobs(jobs, NOW)[0].application_deadline, null);
  assert.equal(job.applicationDeadlineOverride, true);
  const restored = initialJobsState();
  mergeJobsFromBackup({ jobs }, restored);
  assert.equal(publicJobs(restored, NOW)[0].application_deadline, null);
});

test('non-deadline edits do not reopen an expired source listing', () => {
  const { jobs, job } = approved(labelled('2026/11/21'));
  assert.equal(updatePublishedJob(job.id, { title: 'محاسب دوام كامل' }, jobs, 7, NOW).ok, true);
  assert.equal(job.applicationDeadlineOverride, false);
  assert.equal(publicJobs(jobs, NOW).length, 0);
});

test('published-job deadline patch records an explicit no-deadline override', () => {
  const { jobs, job } = approved(labelled('2026/11/21'));
  assert.equal(updatePublishedJob(job.id, { applicationDeadline: null }, jobs, 7, NOW).ok, true);
  assert.equal(publicJobs(jobs, NOW).length, 1);
  assert.equal(job.applicationDeadlineOverride, true);
});

test('manual listings and legacy edited source overrides retain their previous deadline behavior', () => {
  const manual = approved(labelled('2026/11/21'), { kind: 'manual' });
  assert.equal(publicJobs(manual.jobs, NOW).length, 1);
  const legacy = approved(labelled('2026/11/21'));
  legacy.job.updatedAt = NOW - 500;
  assert.equal(publicJobs(legacy.jobs, NOW).length, 1, 'an old ambiguous edit is not reinterpreted as an inferred expiry');
});

test('known closed Google application routes stay hidden without deleting the approval', () => {
  const closed = 'https://docs.google.com/forms/d/e/test-form/closedform';
  const { jobs, job } = approved('فرصة عمل محاسب في سوريا، تفاصيل الشاغر في رابط التقديم.', { links: [closed, 'https://t.me/Syrian_jobbb'] });
  assert.equal(publicJobs(jobs, NOW).length, 0);
  assert.equal(job.status, 'approved');
  job.links = ['https://docs.google.com/forms/d/e/test-form/viewform'];
  assert.equal(publicJobs(jobs, NOW).length, 1);
});

test('expiry projection never exposes pending, ignored or deleted jobs', () => {
  const { jobs, job } = approved(labelled('2026/12/20'));
  job.status = 'ignored';
  assert.equal(publicJobs(jobs, NOW).length, 0);
  job.status = 'approved';
  assert.equal(deleteJobListing(job.id, jobs, 7, NOW).ok, true);
  jobs.published[job.id] = job;
  assert.equal(publicJobs(jobs, NOW).length, 0, 'a deletion tombstone still wins over a stored approval');
  const pending = initialJobsState();
  createPendingJob({ text: labelled('2026/12/20'), sourceKey: 'pending' }, pending, NOW);
  assert.equal(publicJobs(pending, NOW).length, 0);
});
