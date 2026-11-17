import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Alt-name scanning rule: a free-text match that succeeds ONLY through an
// alternative spelling needs a place introducer right before it. The village
// «سلمان» (Hasakah, id 420874) carries the alt «سليمان» — a common man's name —
// and a report about a man named سليمان was once pinned to that village.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-place-scan-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:mock-token';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
const { store } = await import('../server/store.js');
await store.init(null);
const { ruleClassify, scanTextPlaces, truncatedPrefixCut, isPersonNameOnly, altPinFromPersonName } = await import('../server/news-ai.js');
const { getPlace } = await import('../server/places.js');
const mon = await import('../server/news-monitor.js');

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

test('a man named سليمان is not pinned to the village of سلمان', () => {
  const r = ruleClassify('انفجار عبوة ناسفة استهدفت سيارة الشاب سليمان العلي في مدينة درعا البلد');
  assert.ok(r, 'the explosion still classifies');
  assert.ok(!r.places.some((p) => p.name === 'سليمان'), 'the victim name is not a place');
  assert.ok(r.places.some((p) => p.gov === 'درعا'), 'the real place is still found');
  assert.deepEqual(scanTextPlaces('مقتل الشاب سليمان الحسن جراء قصف', '01'), []);
});

test('genuine alt-name mentions with an introducer still resolve (recall)', () => {
  assert.deepEqual(scanTextPlaces('انفجار في قرية سليمان بريف الحسكة', '01'), [420874], 'alt name after «في قرية» resolves to سلمان');
  assert.ok(scanTextPlaces('قصف مدفعي على بلدة المزرعة', '05').includes(172441), 'alt «المزرعة» after «بلدة» resolves to السجن/المزرعة');
  const r = ruleClassify('انفجار عبوة ناسفة في قرية سليمان بريف الحسكة الشرقي');
  assert.ok(r?.places.some((p) => p.name === 'سليمان' && p.gov === 'الحسكة'), 'rules path keeps the genuine village mention');
});

test('canonical names need no introducer (no recall loss)', () => {
  assert.deepEqual(scanTextPlaces('انفجار في سلمان اليوم', '01'), [420874]);
  assert.deepEqual(scanTextPlaces('انفجار سلمان اليوم', '01'), [420874]);
});

test('truncatedPrefixCut flags only truncated copies of the source', () => {
  assert.equal(truncatedPrefixCut('قصف مدفعي على بلدة القحط', 'قصف مدفعي على بلدة القحطانية بريف درعا'), 'mid-word');
  assert.equal(truncatedPrefixCut('مقتل شاب جراء انفجار في', 'مقتل شاب جراء انفجار في مدينة درعا البلد'), 'dangling-function-word');
  assert.equal(truncatedPrefixCut('انفجار في درعا', 'انفجار في درعا أسفر عن إصابات عدة'), null, 'a complete lead clause is legitimate');
  assert.equal(truncatedPrefixCut('انفجار عبوة في درعا', 'قصف مدفعي على بلدة القحطانية'), null, 'a rewritten headline is not a copy');
  assert.equal(truncatedPrefixCut('انفجار في درعا', 'انفجار في درعا'), null, 'identical text is not a truncation');
});

test('handleResult rebuilds a truncated AI headline from the source line', async () => {
  const src = { u: 'guardchan', name: 'قناة', local: false };
  const item = { i: 0, src, url: 'https://t.me/guardchan/1', ts: Date.now(), text: 'مقتل شاب جراء انفجار عبوة ناسفة في مدينة درعا البلد أثناء مروره على الطريق الرئيسي' };
  const result = { event: true, type: 'explosion', new_incident: true, headline: 'مقتل شاب جراء انفجار عبوة ناسفة في', places: [{ name: 'درعا', gov: 'درعا' }] };
  await mon._test.handleResult(item, result, [], new Map());
  const draft = Object.values(store.state.news.drafts).find((d) => d.headlineRebuilt);
  assert.ok(draft, 'the draft records the rebuild');
  assert.equal(draft.headlineRebuilt, 'dangling-function-word');
  assert.ok(!draft.headline.endsWith('في'), 'the dangling headline was replaced');
  assert.ok(draft.headline.startsWith('مقتل شاب جراء انفجار عبوة ناسفة في مدينة درعا'), 'rebuilt from the source first line');
});

test('handleResult leaves a complete AI headline untouched', async () => {
  const src = { u: 'guardchan2', name: 'قناة', local: false };
  const item = { i: 0, src, url: 'https://t.me/guardchan2/1', ts: Date.now(), text: 'انفجار عبوة ناسفة في مدينة درعا البلد أدى إلى إصابة مدنيين اثنين بجروح متفاوتة' };
  const result = { event: true, type: 'explosion', new_incident: true, headline: 'انفجار عبوة ناسفة في درعا وإصابة مدنيين', places: [{ name: 'درعا', gov: 'درعا' }] };
  await mon._test.handleResult(item, result, [], new Map());
  const draft = Object.values(store.state.news.drafts).find((d) => (d.srcs || []).some((s) => s.u === 'guardchan2'));
  assert.ok(draft);
  assert.equal(draft.headline, 'انفجار عبوة ناسفة في درعا وإصابة مدنيين');
  assert.equal(draft.headlineRebuilt, undefined);
});

// Person-name guard (2026-11-17 live bug): a death notice whose text names the
// deceased couple — «وفاة الزوجين "سليمان كرنوص" وزوجته "سلطانة حسن" اختناقاً
// جراء استنشاق غازات جمر…» — was published pinned to the village «سلمان»
// (Hasakah, id 420874). The free-text scanners were already safe (0ce79cb);
// the hole was the AI path: Gemini proposed the man's name «سليمان» as the
// place, nameInText passed because the word occurs in the post (as a name),
// and resolvePlace alt-matched it to the village. buildLocations now rejects
// an alt-only pin whose proposed name occurs in the post only as a person.
const LIVE_DEATH_TEXT = 'وفاة الزوجين "سليمان كرنوص" وزوجته "سلطانة حسن" اختناقاً جراء استنشاق غازات جمر الفحم داخل منزلهما';

test('person-name guard: the deceased couple text never pins سلمان on any path', () => {
  assert.equal(isPersonNameOnly(LIVE_DEATH_TEXT, 'سليمان'), true, 'the name occurs only as a person (quoted, after «الزوجين»)');
  assert.equal(altPinFromPersonName('سليمان', LIVE_DEATH_TEXT, getPlace(420874)), true);
  assert.deepEqual(scanTextPlaces(LIVE_DEATH_TEXT, '01'), [], 'gov-scoped scanner stays clean');
  assert.deepEqual(mon._test.buildLocations({ places: [{ name: 'سليمان' }] }, { text: LIVE_DEATH_TEXT }), [], 'AI proposal of the name alone is rejected');
  assert.deepEqual(mon._test.buildLocations({ places: [{ name: 'سليمان', gov: 'الحسكة' }] }, { text: LIVE_DEATH_TEXT }), [], 'AI proposal with a hallucinated governorate is rejected too');
});

test('person-name guard: unquoted person introducers also bind the name', () => {
  const t = 'وفاة السيد سليمان الحسن إثر حادث سير على طريق حمص';
  assert.equal(isPersonNameOnly(t, 'سليمان'), true, '«السيد سليمان» is a person');
  assert.deepEqual(mon._test.buildLocations({ places: [{ name: 'سليمان' }] }, { text: t }), []);
  const t2 = 'استشهاد الشاب سليمان العلي جراء قصف على درعا البلد';
  assert.equal(isPersonNameOnly(t2, 'سليمان'), true, '«الشاب سليمان» is a person');
});

test('person-name guard: genuine village mentions still pin (recall)', () => {
  const genuine = 'انفجار عبوة ناسفة في قرية سليمان بريف الحسكة الشرقي أدى إلى إصابة مدنيين';
  assert.equal(isPersonNameOnly(genuine, 'سليمان'), false, '«في قرية سليمان» is a place mention');
  const locs = mon._test.buildLocations({ places: [{ name: 'سليمان' }] }, { text: genuine });
  assert.equal(locs[0]?.place_id, 420874, 'the genuine alt-name village still resolves');
  const mixed = 'وفاة الشاب سليمان الحسن جراء قصف مدفعي على قرية سليمان بريف الحسكة';
  assert.equal(isPersonNameOnly(mixed, 'سليمان'), false, 'one genuine place occurrence unblocks the pin');
  assert.equal(mon._test.buildLocations({ places: [{ name: 'سليمان' }] }, { text: mixed })[0]?.place_id, 420874);
});

test('handleResult: the couple text alone creates no pinned draft at all', async () => {
  const src = { u: 'personchan', name: 'قناة', local: false };
  const item = { i: 0, src, url: 'https://t.me/personchan/1', ts: Date.now(), text: LIVE_DEATH_TEXT };
  const result = { event: true, type: 'death', new_incident: true, headline: 'وفاة زوجين اختناقاً بغازات الفحم', places: [{ name: 'سليمان' }] };
  await mon._test.handleResult(item, result, [], new Map());
  const draft = Object.values(store.state.news.drafts).find((d) => (d.srcs || []).some((s) => s.u === 'personchan'));
  assert.equal(draft, undefined, 'no verified place survives, so the pipeline drops the item instead of pinning the village');
});

test('handleResult: with a genuine second place, the draft pins there — never to سلمان', async () => {
  const src = { u: 'personchan2', name: 'قناة', local: false };
  const text = LIVE_DEATH_TEXT + ' داخل منزلهما في مدينة حمص';
  const item = { i: 0, src, url: 'https://t.me/personchan2/1', ts: Date.now(), text };
  const result = { event: true, type: 'death', new_incident: true, headline: 'وفاة زوجين اختناقاً بغازات الفحم في حمص', places: [{ name: 'سليمان' }, { name: 'حمص', gov: 'حمص' }] };
  await mon._test.handleResult(item, result, [], new Map());
  const draft = Object.values(store.state.news.drafts).find((d) => (d.srcs || []).some((s) => s.u === 'personchan2'));
  assert.ok(draft, 'the draft is created from the genuine place');
  assert.notEqual(draft.loc?.place_id, 420874, 'the main location is not the village of سلمان');
  assert.ok(!(draft.extra || []).some((l) => l.place_id === 420874), 'nor is سلمان kept as an extra area');
});
