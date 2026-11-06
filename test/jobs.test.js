import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialJobsState, createPendingJob, decideJob, publicJobs,
  pollJobsOnce, hasSyrianLocation, isJobPost, locationForGovernorate, locationForPlace, _test,
} from '../server/jobs.js';
import { governorates, districtsOf, placesOf } from '../server/places.js';

const NOW = Date.parse('2026-11-06T12:00:00Z');

test('only owner-approved job posts enter the public Jobs list', () => {
  const jobs = initialJobsState();
  const created = createPendingJob({
    kind: 'source', sourceKey: 'test:source:1', title: 'فرصة محاسب',
    text: 'فرصة عمل محاسب بدوام كامل في دمشق. أرسل السيرة الذاتية عبر الرابط.',
    links: ['https://example.org/apply'],
    location: locationForGovernorate(governorates[0].code),
  }, jobs, NOW);
  assert.ok(created.job);
  assert.equal(publicJobs(jobs).length, 0, 'pending jobs are private');
  assert.equal(decideJob(created.job.id, 'approve', jobs, 7, NOW + 1000).ok, true);
  assert.equal(publicJobs(jobs).length, 1);
  assert.equal(publicJobs(jobs)[0].links[0], 'https://example.org/apply');
  assert.equal(publicJobs(jobs)[0].source_url, '');
  assert.equal(publicJobs(jobs)[0].location.label_ar, governorates[0].ar);
});

test('ignored posts stay out of the public list and become final decisions', () => {
  const jobs = initialJobsState();
  const created = createPendingJob({ kind: 'employer', sourceKey: 'test:employer:1', text: 'مطلوب موظف مبيعات في حلب. تفاصيل التقديم على الرابط.' }, jobs, NOW);
  assert.ok(created.job);
  const result = decideJob(created.job.id, 'ignore', jobs, 7, NOW + 1000);
  assert.equal(result.decision.action, 'ignored');
  assert.equal(publicJobs(jobs).length, 0);
  assert.equal(decideJob(created.job.id, 'approve', jobs, 7, NOW + 2000).ok, false, 'a reviewed item cannot be approved twice');
});

test('the source monitor establishes a baseline and only queues later job posts', async () => {
  const jobs = initialJobsState();
  const notices = [];
  const oldPost = { id: 101, ts: NOW - 5000, text: 'وظيفة محاسب في دمشق — للتقديم أرسل السيرة الذاتية.', url: 'https://t.me/syrian_jobb/101' };
  const first = await pollJobsOnce({ j: jobs, now: NOW, fetcher: async () => ({ complete: true, posts: [oldPost] }), notify: async (job) => notices.push(job.id) });
  assert.equal(first.baseline, true);
  assert.equal(Object.keys(jobs.pending).length, 0, 'existing channel posts are not imported as new jobs');
  let receivedAfterId;
  const second = await pollJobsOnce({ j: jobs, now: NOW + 60_000, fetcher: async (_source, opts) => {
    receivedAfterId = opts.afterId;
    return { complete: true, posts: [oldPost, { id: 102, ts: NOW + 30_000, text: 'مطلوب موظف استقبال بدوام كامل في حلب. للتقديم أرسل التفاصيل.', url: 'https://t.me/syrian_jobb/102', links: [] }] };
  }, notify: async (job) => notices.push(job.id) });
  assert.equal(receivedAfterId, 101);
  assert.equal(second.newJobs, 1);
  assert.equal(notices.length, 1, 'the test notifier captures a pending review without sending a Telegram message');
  assert.equal(publicJobs(jobs).length, 0, 'a monitored job is not public before approval');
  const pending = Object.values(jobs.pending)[0];
  assert.equal(decideJob(pending.id, 'approve', jobs, 7, NOW + 61_000).error, 'location_required');
  pending.location = locationForGovernorate(governorates[0].code);
  assert.equal(decideJob(pending.id, 'approve', jobs, 7, NOW + 62_000).ok, true);
  assert.equal(publicJobs(jobs).length, 1, 'the monitored post is visible only after location selection and approval');
});

test('normalized duplicate job text is not queued twice across sources', () => {
  const jobs = initialJobsState();
  const text = 'فرصة عمل لمحاسب في دمشق، دوام كامل، والتقديم عبر الرابط.';
  const first = createPendingJob({ kind: 'source', sourceKey: 'test:source:a', text }, jobs, NOW);
  const duplicate = createPendingJob({ kind: 'source', sourceKey: 'test:source:b', text: `${text} https://example.org/apply` }, jobs, NOW + 1000);
  assert.ok(first.job);
  assert.equal(duplicate.duplicate, true);
  assert.equal(Object.keys(jobs.pending).length, 1);
});

test('the same source key receives a stable review ID on overlapping instances', () => {
  const input = { kind: 'source', sourceKey: 'telegram:syrian_jobb:105', text: 'وظيفة محاسب في حمص، للتقديم عبر الرابط.' };
  const left = createPendingJob(input, initialJobsState(), NOW);
  const right = createPendingJob(input, initialJobsState(), NOW + 10);
  assert.equal(left.job.id, right.job.id);
});

test('city selection returns canonical Syrian governorate, district and place names', () => {
  const gov = governorates.find((row) => districtsOf(row.code).length) || governorates[0];
  const district = districtsOf(gov.code)[0];
  const place = placesOf(district.code)[0];
  assert.ok(place, 'the project gazetteer contains at least one mapped place in the district');
  const selected = locationForPlace(place.id, gov.code);
  assert.equal(selected.place_id, place.id);
  assert.equal(selected.governorate_code, gov.code);
  assert.equal(selected.governorate_ar, gov.ar);
  assert.ok(selected.label_ar.includes(place.ar));
  assert.ok(selected.label_ar.includes(gov.ar));
  assert.equal(locationForPlace(place.id, 'not-this-governorate'), null, 'a city cannot be assigned to a different governorate');
  assert.equal(locationForGovernorate('not-a-governorate'), null);
});

test('the review keyboard hides approval until a verified location has been selected', () => {
  const id = '0123456789abcd';
  const withoutLocation = _test.reviewKeyboard({ id, location: null }).inline_keyboard.flat().map((x) => x.callback_data);
  const withLocation = _test.reviewKeyboard({ id, location: locationForGovernorate(governorates[0].code) }).inline_keyboard.flat().map((x) => x.callback_data);
  assert.ok(!withoutLocation.includes(`j:approve:${id}`));
  assert.ok(withoutLocation.includes(`j:locjob:${id}:gov`));
  assert.ok(withLocation.includes(`j:approve:${id}`));
});

test('identical vacancy details in different selected Syrian places are kept as distinct posts', () => {
  const jobs = initialJobsState(); const text = 'مطلوب موظف مبيعات بدوام كامل. المهام متابعة العملاء وإعداد التقارير، للتقديم أرسل السيرة الذاتية.';
  const firstLocation = locationForGovernorate(governorates[0].code);
  const otherGovernorate = governorates.find((g) => g.code !== firstLocation.governorate_code);
  const first = createPendingJob({ kind: 'employer', sourceKey: 'employer:1:first', text, location: firstLocation }, jobs, NOW);
  const second = createPendingJob({ kind: 'employer', sourceKey: 'employer:1:second', text, location: locationForGovernorate(otherGovernorate.code) }, jobs, NOW + 1);
  assert.ok(first.job);
  assert.ok(second.job, 'different governorate means a distinct vacancy');
  assert.notEqual(first.job.fingerprint, second.job.fingerprint);
});

test('screening recognizes job language and requires a Syrian place for employer submissions', () => {
  assert.equal(isJobPost('مطلوب موظف تسويق'), true);
  assert.equal(isJobPost('فرصة عمل بدوام جزئي'), true);
  assert.equal(hasSyrianLocation('مطلوب محاسب في دمشق سوريا'), true);
  assert.equal(hasSyrianLocation('مطلوب عامل بحلب'), true);
  assert.equal(hasSyrianLocation('A vacancy in Beirut'), false);
});
