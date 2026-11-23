import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-reporting-metadata-'));
process.env.DATA_DIR = dir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
const { store } = await import('../server/store.js');
await store.init(null);
const { _test, daytimeAutoEligible, nightEligible } = await import('../server/news-monitor.js');
const { cleanPublicNewsAttribution } = await import('../server/clean-text.js');
const { locationFrom } = await import('../server/places.js');
test.after(async () => { await new Promise((r) => setTimeout(r, 350)); fs.rmSync(dir, { recursive: true, force: true }); });

// Synthetic feed name and number, not a configured monitoring source.
const feed = 'درعا 77';
const fact = 'تحليق طيران مروحي في أجواء العديد من بلدات ريف محافظة درعا الغربي.';
const sourceText = `مراسل ${feed} | ${fact}`;
const city = locationFrom({ placeId: 170905 });
const draft = (extra = {}) => ({
  id: 'synthetic-reporting-metadata', type: 'helicopter', status: 'pending',
  sourceText, sourceTextVersion: 2, headline: 'generated', loc: city, extra: [],
  srcs: [{ name: feed, u: 'synthetic-feed-77', local: true }],
  editorialHold: true, editorialHoldReason: 'operator-review-hold',
  postId: null, alertId: null, ...extra,
});

test('a pipe-separated third-party reporting role survives without a new speech verb', () => {
  assert.equal(cleanPublicNewsAttribution(sourceText, [feed]), `مراسل ${feed} | ${fact}`);
  assert.equal(cleanPublicNewsAttribution(`أفادت مراسلة ${feed} | ${fact}`, [feed]), `أفادت مراسلة ${feed} | ${fact}`);
});

test('feed identity is not an independent city mention in countryside-only reporting', () => {
  const places = _test.buildLocations({ places: [{ name: 'درعا', gov: 'درعا' }] }, { text: sourceText, src: { name: feed } });
  assert.equal(places.length, 1);
  assert.equal(places[0].scope, 'governorate');
  assert.equal(places[0].governorate_ar, 'درعا');
});

test('source-first candidate cannot retain a city pin borrowed only from reporting metadata', () => {
  const d = draft();
  const before = structuredClone(d);
  const c = _test.sourceFirstCandidate(d);
  assert.equal(c.loc.scope, 'governorate');
  assert.deepEqual(c.extra, []);
  assert.equal(c.editorialHold, true);
  assert.equal(c.postId, null);
  assert.equal(c.alertId, null);
  assert.equal(daytimeAutoEligible(c), false);
  assert.equal(nightEligible(c), false);
  assert.deepEqual(d, before, 'read-only candidate preparation preserves the stored hold, revision inputs and sources');
});

test('digits only in an explicit feed identity are not omitted event numbers', () => {
  const d = draft({ loc: locationFrom({ govCode: '06' }) });
  const c = _test.sourceFirstCandidate(d);
  assert.deepEqual(_test.sourceFirstGate(d, c), { ok: true, reason: null });
  assert.deepEqual(_test.sourceFirstGate(d, { ...c, body: c.body + ' تعديل' }), { ok: false, reason: 'source-copy-changed' });
});

test('real event counts, times and dates stay protected even when they equal feed digits', () => {
  for (const [tail, removed] of [
    ['رصدت 77 طائرة.', '77'],
    ['رصدت 3 طائرات عند الساعة 12:30 اليوم.', '3'],
    ['رصدت 3 طائرات عند الساعة 12:30 اليوم.', '12:30'],
    ['استمر الرصد بتاريخ 24/11.', '24'],
    ['استمر الرصد بتاريخ 24/11.', '11'],
  ]) {
    const d = draft({ sourceText: sourceText + ' ' + tail, loc: locationFrom({ govCode: '06' }) });
    const c = _test.sourceFirstCandidate(d);
    assert.deepEqual(_test.sourceFirstGate(d, c), { ok: true, reason: null });
    assert.equal(_test.editorialGate({ ...c, headline: c.body.replaceAll(removed, '') }).reason, 'number-or-time-omitted', tail + ' / ' + removed);
  }
});

test('a number in the factual city/count phrase is never mistaken for a feed identity', () => {
  const d = draft({ sourceText: 'تحليق 77 طائرة فوق مدينة درعا. ورصدت السلطات في درعا 77 طائرة.', loc: city });
  const c = _test.sourceFirstCandidate(d);
  assert.equal(c.loc.scope, 'place');
  assert.equal(_test.editorialGate({ ...c, headline: c.body.replaceAll('77', '') }).reason, 'number-or-time-omitted');
});

test('an independent explicit incident in the same-named city keeps its city scope', () => {
  for (const text of [
    sourceText + ' كما شوهدت المروحيات فوق مدينة درعا.',
    'تحليق مروحيات فوق مدينة درعا.',
  ]) {
    const d = draft({ sourceText: text });
    assert.equal(_test.sourceFirstCandidate(d).loc.scope, 'place');
    const places = _test.buildLocations({ places: [{ name: 'درعا', gov: 'درعا' }] }, { text, src: { name: feed } });
    assert.equal(places[0].scope, 'place');
  }
});

test('a geographic word occurring only in the reporting identity cannot lend a location', () => {
  const text = `مراسل ${feed} | تحليق مروحيات في ريف محافظة حلب.`;
  assert.deepEqual(_test.buildLocations({ places: [{ name: 'درعا', gov: 'درعا' }] }, { text, src: { name: feed } }), []);
});

test('Arabic digits and institutional unit numbers remain factual, not feed metadata', () => {
  for (const [source, name, number] of [
    [`مراسل ${feed} | ${fact} رصدت ٣ طائرات.`, feed, '٣'],
    [`قالت مصادر قيادة الجيش 77: ${fact} رصدت 3 طائرات.`, 'قيادة الجيش 77', '77'],
  ]) {
    const d = draft({ sourceText: source, loc: locationFrom({ govCode: '06' }), srcs: [{ name, u: 'synthetic-institution', local: true }] });
    const c = _test.sourceFirstCandidate(d);
    assert.deepEqual(_test.sourceFirstGate(d, c), { ok: true, reason: null });
    assert.equal(_test.editorialGate({ ...c, headline: c.body.replace(number, '') }).reason, 'number-or-time-omitted');
  }
});

test('metadata recognition never masks factual uncertainty or a new speech attribution', () => {
  const d = draft({ sourceText: `مراسل ${feed} | قد يكون هناك تحليق طيران مروحي في ريف محافظة درعا.`, loc: locationFrom({ govCode: '06' }) });
  const c = _test.sourceFirstCandidate(d);
  assert.deepEqual(_test.sourceFirstGate(d, c), { ok: true, reason: null });
  assert.equal(_test.editorialGate({ ...c, headline: c.body.replace('قد ', '') }).reason, 'uncertainty-changed');
  assert.equal(_test.editorialGate({ ...c, headline: 'أفاد ' + c.body }).reason, 'attribution-changed');
});

test('manual news conversion uses the same countryside scope without changing its input', async () => {
  const { toBotDraft } = await import('../server/news-monitor.js');
  const d = draft({ body: cleanPublicNewsAttribution(sourceText, [feed]) });
  const before = structuredClone(d);
  const payload = toBotDraft(d);
  assert.equal(payload.location.scope, 'governorate');
  assert.deepEqual(d, before);
});
