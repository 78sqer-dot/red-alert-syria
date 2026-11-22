import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-politics-drift-'));
process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '12345:mock';
const { store } = await import('../server/store.js');
await store.init(null);
const mon = await import('../server/news-monitor.js');
const f = JSON.parse(fs.readFileSync(new URL('./fixtures/news-1462-official-statement.json', import.meta.url)));
const country = { scope: 'country', name_ar: 'سوريا', latitude: null, longitude: null };
const damascus = { scope: 'governorate', name_ar: 'دمشق', governorate_ar: 'دمشق', latitude: 33.51, longitude: 36.29 };
const homs = { scope: 'governorate', name_ar: 'حمص', governorate_ar: 'حمص', latitude: 34.73, longitude: 36.71 };
let calls = 0;
function setup(body = f.pendingBody, category = f.pendingCategory, knownLoc = country) {
  calls = 0;
  mon._test.R.H = { apis: () => ({ admin: {} }), publishDraft: async () => { calls++; throw new Error('No send expected'); } };
  const n = mon.newsState();
  n.alerts = []; n.drafts = {};
  n.echoLog = [{ id: 'canonical-existing', type: 'political', politicalCategory: f.canonicalCategory,
    ts: Date.now(), text: `تطور سياسي تطور سياسي سوريا ${f.canonicalBody}`, geo: mon._test.geoOf(mon._test.locsOf(knownLoc, [])) }];
  n.drafts.pending = { id: 'pending', status: 'pending', type: 'political', politicalCategory: category,
    headline: f.workingHeadline, body, sourceText: body, sourceTextVersion: 2, loc: damascus,
    extra: [], srcs: [{ name: 'source fixture', url: f.pendingSource, local: false }],
    ts: Date.now(), created: Date.now(), cards: [], editorialHold: true };
  return n.drafts.pending;
}
test.after(async () => {
  mon._test.R.H = null;
  await new Promise((resolve) => setTimeout(resolve, 350));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('actual 1462 ministry copy matches across statement/official_entity, with no pin', () => {
  const d = setup();
  const review = mon.operatorNewsReview(d.id);
  assert.equal(review.issue, null);
  assert.equal(review.candidate.location.scope, 'country');
  assert.equal(review.duplicate?.id, 'canonical-existing');
  assert.equal(d.loc.scope, 'governorate', 'raw audit location must not be rewritten');
  assert.equal(d.status, 'pending');
  assert.equal(calls, 0);
  assert.equal(mon._test.selfEchoOf({ type: d.type, politicalCategory: d.politicalCategory, geo: mon._test.geoOf([]) }, d.sourceText)?.id, 'canonical-existing');
});

test('guarded duplicate action closes only the held draft without a public send', async () => {
  const d = setup();
  const before = structuredClone(mon.newsState().echoLog);
  mon.newsState().alerts = [{ id: 'canonical-existing', type: 'political', politicalCategory: f.canonicalCategory, ts: Date.now(), headline: f.canonicalBody, geo: mon._test.geoOf([]) }];
  const review = mon.operatorNewsReview(d.id);
  const result = await mon.operateNewsDraft(d.id, { action: 'duplicate', revision: review.revision });
  assert.equal(result.status, 'duplicate');
  assert.equal(result.duplicateOf, 'canonical-existing');
  assert.equal(d.sourceText, f.pendingBody);
  assert.equal(d.alertId, undefined);
  assert.equal(d.postId, undefined);
  assert.deepEqual(mon.newsState().echoLog, before, 'canonical echo must be untouched');
  const known = mon._test.knownEvents();
  assert.equal(known.some((event) => event.draftId === d.id), false, 'queued duplicate alias must not become another event with raw geography');
  assert.equal(known.filter((event) => event.alertId === 'canonical-existing').length, 1, 'the canonical event remains represented exactly once');
  assert.equal(calls, 0);
});

for (const [name, transform] of [
  ['a different ministry', (s) => s.replaceAll('الداخلية', 'الخارجية')],
  ['a different international body', (s) => s.replaceAll('الأمم المتحدة', 'الاتحاد الأوروبي')],
  ['an additional substantive clause', (s) => s + ' وأعلنت إطلاق برنامج وطني جديد.'],
  ['a negated follow-up clause', (s) => s.replace('تثمن', 'لا تثمن')],
  ['a changed speech action', (s) => s.replace('ترحب', 'ترفض')],
  ['a negation before the subject', (s) => 'لم تعد ' + s],
  ['a new prefix changing speaker attribution', (s) => 'نفت الوزارة أن ' + s],
]) {
  test(`cross-category matching does not swallow ${name}`, () => {
    const d = setup(transform(f.pendingBody));
    assert.equal(mon.operatorNewsReview(d.id).duplicate, null);
    assert.equal(d.status, 'pending');
    assert.equal(calls, 0);
  });
}

test('different short numbers remain substantive even below the token length floor', () => {
  const d = setup(f.pendingBody + ' خلال 5 أيام');
  mon.newsState().echoLog[0].text += ' خلال 6 أيام';
  assert.equal(mon.operatorNewsReview(d.id).duplicate, null);
});

test('binding decisions do not collapse into descriptive statement categories', () => {
  const d = setup(f.pendingBody, 'decision');
  assert.equal(mon.operatorNewsReview(d.id).duplicate, null);
});

test('review compares normalized publication geography, not the raw inferred city', () => {
  const d = setup(f.pendingBody, f.pendingCategory, homs);
  const review = mon.operatorNewsReview(d.id);
  assert.equal(review.candidate.location.scope, 'country');
  assert.equal(review.duplicate?.id, 'canonical-existing');
  assert.equal(mon._test.finalPublishDuplicate(d, { headline: 'تطور سياسي سوريا', body: d.sourceText }), null, 'raw incompatible geography still blocks when explicitly used');
  assert.equal(mon._test.finalPublishDuplicate(d, { headline: 'تطور سياسي سوريا', body: d.sourceText, location: country, extra: [] })?.id, 'canonical-existing');
  assert.equal(mon._test.finalPublishDuplicate(d, { headline: 'تطور سياسي سوريا', body: d.sourceText, location: damascus, extra: [] }), null, 'two known incompatible publication venues must still block');
});

test('the same generated working headline cannot hide meaningful new source copy', () => {
  const d = setup(f.pendingBody.replace('الجريمة المنظمة', 'جرائم غسل الأموال'));
  assert.equal(d.headline, f.workingHeadline);
  assert.equal(mon.operatorNewsReview(d.id).duplicate, null);
});
