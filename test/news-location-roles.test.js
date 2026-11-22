import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-roles-'));
process.env.DATA_DIR = dir; process.env.TELEGRAM_BACKUP = 'false'; process.env.BOT_TOKEN = '12345:mock';
const { store } = await import('../server/store.js'); await store.init(null);
const mon = await import('../server/news-monitor.js');
const { locationFrom } = await import('../server/places.js');
const { hospitalDestinationOnly } = await import('../server/news-ai.js');
const role = mon._test.nonIncidentPlaceOnly;
const source = 'العثور على جثمان الشاب محمد علي قداد المنحدر من بلدة #كفريا بريف #إدلب والمقيم في منطقة #السيدة_زينب بريف دمشق. عثر عليه قرب جسر محجة بعد اختطافه مع سيارته.';
test.after(async () => { await new Promise((r) => setTimeout(r, 350)); fs.rmSync(dir, { recursive: true, force: true }); });
test('origin, residence, their hierarchy and parenthetical gazetteer alias are not discovery sites', () => {
  for (const name of ['كفريا', 'إدلب', 'السيدة زينب', 'السيدة زينب (قبر الست)', 'دمشق']) assert.equal(role(name, source), true, name);
  assert.equal(role('محجة', source), false);
});
test('participle, finite verb and resident variants keep an independently stated incident site', () => {
  for (const wording of ['المنحدر من', 'ينحدر من', 'من أهالي', 'من أبناء', 'مواليد', 'المقيم في', 'يسكن في', 'يقطن في']) {
    assert.equal(role('إدلب', `شاب ${wording} إدلب. عثر عليه في محجة`), true, wording);
    assert.equal(role('إدلب', `شاب ${wording} إدلب وقتل في إدلب`), false, wording);
    assert.equal(role('حلب', `شاب ${wording} إدلب وقتل في حلب`), false, wording);
  }
});
test('hospital destination does not become another pin, but an actual hospital incident remains', () => {
  assert.equal(hospitalDestinationOnly('إزرع', 'عثر على الجثمان قرب محجة ونقل جثمانه إلى مشفى إزرع الوطني'), true);
  assert.equal(hospitalDestinationOnly('إزرع', 'حريق في مشفى إزرع الوطني'), false);
  assert.equal(hospitalDestinationOnly('إزرع', 'انفجار داخل مشفى إزرع الوطني'), false);
  assert.equal(hospitalDestinationOnly('إزرع', 'حادث في إزرع ونقل المصاب إلى مشفى إزرع'), false);
});
test('real Mahajja-style geography keeps one discovery area instead of origin/residence', () => {
  const result = mon._test.buildLocations({ places: [ { name: 'محجة', gov: 'درعا' }, { name: 'السيدة زينب', gov: 'ريف دمشق' }, { name: 'كفريا', gov: 'إدلب' } ] }, { text: source });
  assert.equal(result[0].name_ar, 'محجة'); assert.equal(result.length, 1);
});
test('pending geography repairs are held for review, published records untouched', async () => {
  const loc = locationFrom({ placeId: 167501 }), extra = [locationFrom({ placeId: 166277 }), locationFrom({ placeId: 168689 })];
  store.state.news ||= {}; store.state.news.drafts = { a: { id: 'a', status: 'pending', loc, extra, sourceText: source, cards: [] }, b: { id: 'b', status: 'published', loc, extra: [...extra], sourceText: source, cards: [] } };
  assert.deepEqual(await mon.refreshPendingLocationRoles(), ['a']);
  assert.equal(store.state.news.drafts.a.extra.length, 0); assert.equal(store.state.news.drafts.a.editorialHold, true);
  assert.equal(store.state.news.drafts.b.extra.length, 2);
});
