// Owner-flagged channel defects, 2026-11-21 (post 1423: «🟢 وفاة — 📍المدينة / مقتل شاب
// برصاص الجندرمة التركية … عرض المزيد وكالة أنباء هاوار ANHA موقعنا على بلوسكاي…»):
// (1) outlet footer junk leaking into the body, (2) place pinned to the literal placeholder
// «المدينة» instead of ديرك (المالكية), (3) a killing by firearm classified as a plain death.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPostText } from '../server/news-sources.js';
import { resolvePlace, scanTextPlaces, refineType, isGenericPlaceWord } from '../server/news-ai.js';

const STORY = 'مقتل شاب من ريف الحسكة برصاص الجندرمة التركية قُتل شاب من ريف مدينة الحسكة، برصاص الجندرمة التركية (حرس الحدود) على الحدود السورية التركية قرب مدينة ديرك.';
const JUNK = 'وكالة أنباء هاوار ANHA موقعنا على بلوسكاي موقعنا على X لحظة بلحظة عبر الواتس اب';

test('footer junk after a spaced «عرض المزيد» is stripped', () => {
  const out = cleanPostText(`${STORY} عرض المزيد ${JUNK}`).text;
  assert.equal(out, STORY);
});

test('footer junk after a GLUED «عرض المزيد» is stripped', () => {
  const out = cleanPostText(`${STORY}عرض المزيد ${JUNK}`).text;
  assert.equal(out, STORY);
});

test('ANHA signature tail without «عرض المزيد» is stripped', () => {
  const out = cleanPostText(`${STORY} ${JUNK}`).text;
  assert.equal(out, STORY);
});

test('multi-line ANHA footer lines are stripped', () => {
  const out = cleanPostText(`${STORY}\nوكالة أنباء هاوار ANHA\nموقعنا على بلوسكاي\nموقعنا على X\nلحظة بلحظة عبر الواتس اب`).text;
  assert.equal(out, STORY);
});

test('a plain attribution to ANHA inside the story is kept', () => {
  const t = 'نقلت وكالة أنباء هاوار عن مصدر محلي قوله إن الوضع هادئ في ديرك اليوم';
  assert.equal(cleanPostText(t).text, t);
});

test('«المدينة» placeholder never pins a place; governorate fallback instead', () => {
  const r = resolvePlace({ name: 'المدينة', gov: 'الحسكة' });
  assert.equal(r.kind, 'governorate');
  assert.equal(r.govCode, '01');
});

test('ديرك resolves to المالكية (173530), Hasakah', () => {
  const r = resolvePlace({ name: 'ديرك', gov: 'الحسكة' });
  assert.deepEqual(r, { kind: 'place', placeId: 173530 });
});

test('a killing by firearm classifies as a violent incident, not 🟢 وفاة', () => {
  const text = 'مقتل شاب برصاص الجندرمة التركية على الحدود السورية التركية قرب مدينة ديرك بريف الحسكة';
  assert.equal(refineType('death', text), 'attack');
  assert.equal(refineType('martyrdom', text), 'attack');
});

test('explicit assassination wording upgrades to assassination', () => {
  assert.equal(refineType('death', 'اغتيال قيادي برصاص مسلحين مجهولين في درعا'), 'assassination');
});

test('repair path: المدينة pin detected as generic, story re-resolves to المالكية', () => {
  assert.equal(isGenericPlaceWord('المدينة'), true);
  assert.equal(isGenericPlaceWord('المالكية'), false);
  const ids = scanTextPlaces(STORY, '01', 1);
  assert.deepEqual(ids, [173530]);
});

test('natural/unknown deaths stay death', () => {
  assert.equal(refineType('death', 'وفاة مسنّ في منزله بمدينة حماة إثر أزمة قلبية'), 'death');
});
