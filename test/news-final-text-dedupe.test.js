// Final-text duplicate guard: two drafts of the SAME story can carry working
// headlines different enough to pass the draft-level matcher, then both reach
// the channel seconds apart (owner report 2026-11-20: one arrest posted twice,
// reworded). This pins the publish-time guard that compares the FINAL cleaned
// publication text against the echo log: near-identical copy is caught by token
// similarity, a heavily reworded retelling by the shared-entity matcher, and a
// genuinely different story is never blocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-finaldup-'));
process.env.NODE_ENV = 'test';

const { store, publicAlert } = await import('../server/store.js');
const { searchPlaces } = await import('../server/places.js');
const mon = await import('../server/news-monitor.js');

const haleb = () => {
  const g = searchPlaces('حلب', 1)[0];
  return { scope: 'city', name_ar: 'حلب', district_ar: '', governorate_ar: 'حلب', latitude: g.lat, longitude: g.lon };
};

function seedPublished(title, description, type = 'civil') {
  const stored = store.addAlert({
    type, confirm: 'preliminary', location: haleb(),
    title, description, body: '', source_name: 'مرصد',
  });
  mon._test.rememberAlert(publicAlert(store.state.alerts.find((a) => a.id === stored.id)));
  return stored.id;
}

const draft = (headline, body) => ({
  id: 'draft-test', type: 'civil', ts: Date.now(), created: Date.now(),
  headline, body, loc: haleb(), extra: [],
});

const PUB_1_TITLE = 'اعتقال — حلب';
const PUB_1 = 'أوقفت قوى الأمن الداخلي أسامة محمد بدور بمذكرة من هيئة العدالة الانتقالية، لاتهامه بمساعدة الأجهزة الأمنية السابقة في اعتقال متظاهري جامعة حلب.';
const PUB_1_TITLE2 = 'تطور سياسي — العتيبة';
const PUB_2 = 'هنأ وزير الداخلية أنس خطاب أهالي بلدة العتيبة بريف دمشق بإلقاء القبض على رواد زيدان، المخطط لمجزرة كمين العتيبة عام 2014.';

test('near-identical final copy of an already-published story is caught by text similarity', () => {
  seedPublished(PUB_1_TITLE, PUB_1);
  const d = draft('عنوان مسودة مختلف تماماً عن المنشور',
    'أوقفت قوى الأمن الداخلي أسامة محمد بدور بمذكرة من هيئة العدالة الانتقالية، لاتهامه بمساعدة أجهزة أمن النظام السابق في اعتقال متظاهري جامعة حلب.');
  const hit = mon._test.finalPublishDuplicate(d, { headline: d.headline, body: d.body });
  assert.ok(hit, 'expected a duplicate match');
  assert.equal(hit.via, 'text');
});

test('the same story reworded by another agency is caught by the entity matcher', () => {
  const d = draft('إدارة مكافحة الإرهاب تلقي القبض على أسامة محمد بدور في حلب',
    'ألقت إدارة مكافحة الإرهاب القبض على أسامة محمد بدور في مدينة حلب، وفق مصدر أمني، بتهمة ارتكاب انتهاكات بحق المتظاهرين خلال عهد النظام البائد.');
  const hit = mon._test.finalPublishDuplicate(d, { headline: d.headline, body: d.body });
  assert.ok(hit, 'expected an entity match');
  assert.equal(hit.via, 'entity');
});

test('a different story in the same city is NOT blocked', () => {
  const d = draft('انفجار سيارة مفخخة قرب ساحة سعد الله الجابري في حلب',
    'انفجرت سيارة مفخخة قرب ساحة سعد الله الجابري وسط مدينة حلب ما أدى إلى أضرار مادية كبيرة وإصابات بين المدنيين.');
  const hit = mon._test.finalPublishDuplicate(d, { headline: d.headline, body: d.body });
  assert.equal(hit, null);
});

test('a different story sharing only common news words is NOT blocked', () => {
  const d = draft('قوى الأمن الداخلي تعتقل مطلوباً آخر في حلب',
    'أوقفت قوى الأمن الداخلي أحد المطلوبين في مدينة حلب بتهمة تجارة المخدرات وفق مصدر أمني.');
  const hit = mon._test.finalPublishDuplicate(d, { headline: d.headline, body: d.body });
  assert.equal(hit, null);
});

test('political stories only match within the same category', () => {
  seedPublished(PUB_1_TITLE2, PUB_2, 'political');
  // same wording, but the candidate is a civil draft -> different family, no match
  const d = draft(PUB_1_TITLE2, PUB_2);
  const hit = mon._test.finalPublishDuplicate(d, { headline: d.headline, body: d.body });
  assert.equal(hit, null);
});

test('a duplicate that still lands in a race is auto-deleted (map + draft marked)', async () => {
  const d = draft('إدارة مكافحة الإرهاب تلقي القبض على أسامة محمد بدور في حلب',
    'ألقت إدارة مكافحة الإرهاب القبض على أسامة محمد بدور في مدينة حلب، وفق مصدر أمني، بتهمة ارتكاب انتهاكات بحق المتظاهرين خلال عهد النظام البائد.');
  // Simulate the raced publish: the same story lands as a SECOND alert after the
  // pre-publish guard passed (its copy was not in the echo log yet).
  const landedAlert = store.addAlert({
    type: 'civil', confirm: 'preliminary', location: haleb(),
    title: 'اعتقال — حلب', description: d.body, body: '', source_name: 'مرصد',
  });
  mon._test.rememberAlert(publicAlert(store.state.alerts.find((a) => a.id === landedAlert.id)));
  const dup = await mon._test.autoDeleteLandedDuplicate(d, { headline: d.headline, body: d.body }, landedAlert.id);
  assert.ok(dup, 'expected the landed alert to be detected as a duplicate');
  assert.equal(store.getAlert(landedAlert.id), undefined, 'landed duplicate alert should be deleted from the store');
  assert.equal(d.status, 'duplicate');
});
