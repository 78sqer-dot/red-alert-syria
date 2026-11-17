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
const { ruleClassify, scanTextPlaces, truncatedPrefixCut } = await import('../server/news-ai.js');
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
