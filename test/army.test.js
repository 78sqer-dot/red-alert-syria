import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARMY_CATEGORIES, ARMY_SOURCES, ARMY_MONITOR_ONLY_SOURCES, initialArmyState, salaryNewsKind, inferArmyCategory,
  createPendingArmyItem, decideArmyItem, updateArmyItem, deleteArmyItem,
  publicArmy, pollArmyOnce, mergeArmyFromBackup, setArmyChannel, normalizeArmyChannelLink,
} from '../server/army.js';
import { _test as adminTest } from '../server/army-admin-tools.js';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const synthetic = (id, text, extra = {}) => ({
  id, ts: NOW, text, url: `https://t.me/test_official/${id}`, links: [], ...extra,
});

function makePending(j, suffix = '1') {
  return createPendingArmyItem({
    kind: 'official_source', sourceKey: `test:official:${suffix}`, sourceName: 'مصدر اختبار رسمي',
    sourceUrl: `https://t.me/test_official/${suffix}`, category: 'army', title: 'إعلان اختبار اصطناعي',
    text: 'إعلان اختبار اصطناعي عن رواتب أفراد الجيش، لا يمثل خبراً حقيقياً.',
  }, j, NOW);
}

test('only approved official-source items appear in the public Syrian Army section', () => {
  const j = initialArmyState();
  const made = makePending(j);
  assert.ok(made.item);
  assert.equal(publicArmy(j).items.length, 0, 'pending items must be invisible publicly');
  assert.equal(decideArmyItem(made.item.id, 'approve', j, 8270709633, NOW + 1000).ok, true);
  const result = publicArmy(j);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'إعلان اختبار اصطناعي');
  assert.equal(result.items[0].source_url, 'https://t.me/test_official/1');
  assert.deepEqual(result.sources.map((x) => x.username), ARMY_SOURCES.map((x) => x.u));
  assert.ok(ARMY_MONITOR_ONLY_SOURCES.every((source) => !result.sources.some((x) => x.username === source.u)));
  assert.equal(result.items[0].text.includes('اختبار اصطناعي'), true);
  assert.equal(result.items[0].status, undefined, 'public projection excludes workflow internals');
});

test('official monitor establishes a baseline without importing old posts, then queues only relevant new posts', async () => {
  const j = initialArmyState();
  const history = {
    Sy_Defense: [synthetic(100, 'وزارة الدفاع: بيان حول تمرين ميداني.')],
    syrianmoi: [synthetic(200, 'وزارة الداخلية تنظم لقاءً تدريبياً.')],
    SyrMOfF: [synthetic(300, 'وزارة المالية تعقد اجتماعاً دورياً.')],
  };
  const fetcher = async (username, options) => {
    assert.ok(!options.afterId, 'the first check starts from the latest post only');
    return { complete: true, posts: history[username] };
  };
  const first = await pollArmyOnce({ j, fetcher, now: NOW });
  assert.equal(first.baseline, true);
  assert.equal(first.newItems, 0);
  assert.equal(Object.keys(j.pending).length, 0);

  history.Sy_Defense = [
    ...history.Sy_Defense,
    synthetic(101, 'وزارة الدفاع تعلن صرف رواتب العسكريين لشهر تشرين الثاني.'),
    synthetic(102, 'وزارة الدفاع تجري تمريناً ميدانياً في إحدى المناطق.'),
  ];
  let after;
  const notices = [];
  const second = await pollArmyOnce({ j, fetcher: async (username, options) => {
    if (username === 'Sy_Defense') after = options.afterId;
    return { complete: true, posts: history[username] };
  }, notify: async (item) => notices.push(item.id), now: NOW + 60_000 });
  assert.equal(after, 100);
  assert.equal(second.newItems, 1, 'a relevant source post is queued, unrelated news is screened out');
  assert.equal(notices.length, 1, 'review notification is the only side effect');
  assert.equal(publicArmy(j).items.length, 0);
  assert.equal(Object.values(j.pending)[0].category, 'army');
});

test('monitor-only media reports stay off the public sources list and are labelled for verification', async () => {
  const j = initialArmyState();
  const first = await pollArmyOnce({ j, fetcher: async (username) => ({ complete: true, posts: username === 'televisionsyria' ? [synthetic(10, 'تقرير عن رواتب العسكريين المتقاعدين.')] : [] }), now: NOW });
  assert.equal(first.newItems, 0, 'old posts are baselined, not imported');
  const second = await pollArmyOnce({ j, fetcher: async (username) => ({ complete: true, posts: username === 'televisionsyria' ? [
    synthetic(10, 'تقرير عن رواتب العسكريين المتقاعدين.'),
    synthetic(11, 'تلفزيون سوريا: بدء صرف رواتب العسكريين المتقاعدين لشهر كانون الأول.', { ts: NOW + 30_000, url: 'https://t.me/televisionsyria/11' }),
  ] : [] }), now: NOW + 60_000 });
  assert.equal(second.newItems, 1);
  assert.equal(Object.values(j.pending)[0].kind, 'media_source');
  const result = publicArmy(j);
  assert.ok(ARMY_MONITOR_ONLY_SOURCES.every((source) => !result.sources.some((x) => x.username === source.u)));
  assert.deepEqual(result.channels, { tg: '', wa: '' });
});

test('salary and recruitment screening covers requested groups without matching unrelated official posts', () => {
  assert.equal(salaryNewsKind('إعلان رسمي عن موعد صرف الرواتب للعاملين'), true);
  assert.equal(salaryNewsKind('فتح باب الانتساب لدورة أفراد وفق الشروط الرسمية'), true);
  assert.equal(salaryNewsKind('وزارة الدفاع تجري اجتماعاً دورياً'), false);
  assert.equal(salaryNewsKind('Ministry announces payroll update for staff'), true);
  assert.equal(inferArmyCategory('إعلان عن دورة أفراد في الشرطة السورية'), 'police');
  assert.equal(inferArmyCategory('فتح باب الانتساب لقوات المهام الخاصة'), 'special');
  assert.equal(inferArmyCategory('صرف رواتب موظفي الوزارات والدوائر الحكومية', 'SyrMOfF'), 'government');
  assert.equal(inferArmyCategory('إعلان حكومي تجريبي عن صرف الرواتب', 'sana_gov'), 'government');
  assert.deepEqual(Object.keys(ARMY_CATEGORIES), ['army', 'police', 'security', 'units', 'special', 'government']);
  assert.ok(ARMY_SOURCES.some((source) => source.u === 'sana_gov' && source.url === 'https://t.me/sana_gov'));
});

test('duplicate source posts and normalized duplicates are not queued twice', () => {
  const j = initialArmyState();
  const first = createPendingArmyItem({ kind: 'official_source', sourceKey: 'test:source:a', sourceName: 'Test', sourceUrl: 'https://t.me/test/1', category: 'army', text: 'إعلان اختبار اصطناعي عن رواتب الجيش الرسمي.' }, j, NOW);
  const sameSource = createPendingArmyItem({ kind: 'official_source', sourceKey: 'test:source:a', sourceName: 'Test', sourceUrl: 'https://t.me/test/1', category: 'army', text: 'إعلان اختبار اصطناعي عن رواتب الجيش الرسمي.' }, j, NOW + 1);
  const duplicateText = createPendingArmyItem({ kind: 'official_source', sourceKey: 'test:source:b', sourceName: 'Test', sourceUrl: 'https://t.me/test/2', category: 'police', text: 'إعلان اختبار اصطناعي عن رواتب الجيش الرسمي. https://example.test/source' }, j, NOW + 2);
  assert.ok(first.item);
  assert.equal(sameSource.duplicate, true);
  assert.equal(duplicateText.duplicate, true);
  assert.equal(Object.keys(j.pending).length, 1);
});

test('pending items can be edited before approval and approved items can be updated', () => {
  const j = initialArmyState();
  const made = makePending(j, 'edit');
  assert.equal(updateArmyItem(made.item.id, { title: 'عنوان اختبار مُحدّث', category: 'police' }, j, 7, NOW + 1).ok, true);
  assert.equal(publicArmy(j).items.length, 0);
  assert.equal(decideArmyItem(made.item.id, 'approve', j, 7, NOW + 2).ok, true);
  const updated = updateArmyItem(made.item.id, { text: 'تفاصيل اختبار اصطناعي محدثة من لوحة الإدارة فقط.' }, j, 7, NOW + 3);
  assert.equal(updated.ok, true);
  assert.equal(publicArmy(j).items[0].title, 'عنوان اختبار مُحدّث');
  assert.equal(publicArmy(j).items[0].category, 'police');
  assert.match(publicArmy(j).items[0].text, /محدثة/);
});

test('an edit cannot turn a queued item into a duplicate of another pending post', () => {
  const j = initialArmyState();
  const first = makePending(j, 'edit-duplicate-a');
  const second = createPendingArmyItem({
    kind: 'official_source', sourceKey: 'test:edit-duplicate-b', sourceName: 'مصدر اختبار رسمي',
    sourceUrl: 'https://t.me/test_official/duplicate', category: 'police',
    text: 'إعلان مختلف للاختبار عن راتب الشرطة السورية، لا يمثل خبراً حقيقياً.',
  }, j, NOW + 1);
  assert.ok(second.item);
  const result = updateArmyItem(first.item.id, { text: second.item.text }, j, 7, NOW + 2);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'duplicate_content');
  assert.equal(j.pending[first.item.id].text, first.item.text);
});

test('ignoring a pending source post is final and prevents public exposure', () => {
  const j = initialArmyState();
  const made = makePending(j, 'ignore');
  const result = decideArmyItem(made.item.id, 'ignore', j, 7, NOW + 2);
  assert.equal(result.decision.action, 'ignored');
  assert.equal(publicArmy(j).items.length, 0);
  assert.equal(decideArmyItem(made.item.id, 'approve', j, 7, NOW + 3).ok, false);
});

test('confirmed deletion is recorded as a tombstone and stale backup cannot restore it', () => {
  const j = initialArmyState();
  const made = makePending(j, 'delete');
  decideArmyItem(made.item.id, 'approve', j, 7, NOW + 1);
  const staleBackup = { army: {
    published: { [made.item.id]: structuredClone(j.published[made.item.id]) },
    decisions: { [made.item.id]: structuredClone(j.decisions[made.item.id]) },
  } };
  assert.equal(deleteArmyItem(made.item.id, j, 7, NOW + 2).ok, true);
  mergeArmyFromBackup(staleBackup, j);
  assert.equal(j.published[made.item.id], undefined);
  assert.equal(j.deleted[made.item.id].action, 'deleted');
  assert.equal(publicArmy(j).items.length, 0);
});

test('newer edits win over an older backup and channels accept only safe HTTPS channel URLs', () => {
  const j = initialArmyState();
  const made = makePending(j, 'backup-edit');
  decideArmyItem(made.item.id, 'approve', j, 7, NOW + 1);
  const staleBackup = { army: { published: { [made.item.id]: structuredClone(j.published[made.item.id]) }, decisions: { [made.item.id]: structuredClone(j.decisions[made.item.id]) } } };
  updateArmyItem(made.item.id, { title: 'أحدث من النسخة الاحتياطية' }, j, 7, NOW + 10);
  mergeArmyFromBackup(staleBackup, j);
  assert.equal(j.published[made.item.id].title, 'أحدث من النسخة الاحتياطية');
  assert.equal(setArmyChannel('tg', 'https://t.me/MyPublicChannel', j, NOW + 20).ok, true);
  assert.equal(setArmyChannel('wa', 'https://whatsapp.com/channel/AbCdEf1234567890', j, NOW + 21).ok, true);
  assert.equal(setArmyChannel('tg', 'javascript:alert(1)', j, NOW + 22).ok, false);
  assert.equal(normalizeArmyChannelLink('tg', 'https://example.com/not-telegram'), '');
  assert.equal(publicArmy(j).channels.tg, 'https://t.me/MyPublicChannel');
  assert.equal(adminTest.secureUrl('http://example.test/unsafe'), '');
});
