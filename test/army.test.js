import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARMY_CATEGORIES, ARMY_SOURCES, ARMY_MONITOR_ONLY_SOURCES, initialArmyState, salaryNewsKind, inferArmyCategory,
  normalizeArmyTelegramUsername, normalizeManualArmySource, armyMonitorSources,
  addManualArmySource, updateManualArmySource, removeManualArmySource,
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
  assert.equal('source_name' in result.items[0], false);
  assert.equal('source_url' in result.items[0], false);
  assert.equal('sources' in result, false);
  assert.equal(result.items[0].text.includes('اختبار اصطناعي'), true);
  assert.equal(result.items[0].status, undefined, 'public projection excludes workflow internals');
});

test('public Army projection reclassifies military notices and keeps nonmilitary records stored but hidden', () => {
  const j = initialArmyState();
  const records = [
    { id: 'army-enlist', category: 'army', title: 'التطوع بالجيش العربي السوري', text: 'فتح باب التطوع والانتساب بالجيش العربي السوري.', sourceKey: 'telegram:SyrArArmy:1', sourceUrl: 'https://t.me/SyrArArmy/1', publishedAt: new Date(NOW + 100).toISOString() },
    { id: 'police-recruit', category: 'government', title: 'وزارة الداخلية تفتح باب الانتساب لدورة أفراد', text: 'وزارة الداخلية تفتح باب الانتساب لدورة أفراد للشرطة السورية عبر الرابط الرسمي https://ee.moi-sy.com/apply', sourceKey: 'telegram:syrianmoi:2', sourceUrl: 'https://t.me/syrianmoi/2', links: ['https://ee.moi-sy.com/apply'], publishedAt: new Date(NOW + 200).toISOString() },
    { id: 'military-pay', category: 'government', title: 'وزارة الدفاع تصرف رواتب العسكريين', text: 'وزارة الدفاع تعلن صرف رواتب العسكريين لشهر تشرين الثاني.\n#سانا\nـــــــــــــــــــ\nتابعونا على التلغرام | https://t.me/sana_gov', sourceKey: 'telegram:sana_gov:3', sourceUrl: 'https://t.me/sana_gov/3', links: ['https://t.me/sana_gov', 'https://example.org/apply'], publishedAt: new Date(NOW + 300).toISOString() },
    { id: 'civil-campaign', category: 'government', title: 'حملة تطوعية في درعا', text: 'حملة "بناة" التطوعية تعيد الألق لحديقة حي في درعا.', sourceKey: 'telegram:sana_gov:4', sourceUrl: 'https://t.me/sana_gov/4', publishedAt: new Date(NOW + 400).toISOString() },
    { id: 'ministry-vacancy', category: 'government', title: 'وزارة الإعلام تعلن عن شواغر وظيفية', text: 'إعلان عن شواغر وظيفية في وزارة الإعلام.', sourceKey: 'telegram:sana_gov:5', sourceUrl: 'https://t.me/sana_gov/5', publishedAt: new Date(NOW + 500).toISOString() },
    { id: 'post-office-pay', category: 'government', title: 'بريد حمص يخصص دواماً إضافياً', text: 'بريد حمص يخصص دواماً إضافياً يوم السبت لصرف رواتب المتقاعدين.', sourceKey: 'telegram:sana_gov:6', sourceUrl: 'https://t.me/sana_gov/6', publishedAt: new Date(NOW + 600).toISOString() },
  ];
  for (const record of records) {
    j.published[record.id] = { ...record, kind: 'official_source', status: 'approved', links: record.links || [], createdAt: NOW, fingerprint: `fingerprint-${record.id}` };
    j.decisions[record.id] = { id: record.id, action: 'approved', decidedAt: NOW, decidedBy: 7 };
  }
  const publishedBefore = structuredClone(j.published);
  const decisionsBefore = structuredClone(j.decisions);
  const publicData = publicArmy(j, NOW + 1000);
  assert.deepEqual(publicData.items.map((item) => item.id), ['military-pay', 'police-recruit', 'army-enlist']);
  assert.deepEqual(publicData.items.map((item) => item.category), ['army', 'official_links', 'recruitment']);
  assert.equal(publicData.items[0].text, 'وزارة الدفاع تعلن صرف رواتب العسكريين لشهر تشرين الثاني.');
  assert.deepEqual(publicData.items[0].links, ['https://example.org/apply'], 'the SANA follow-channel URL is not shown as an application link');
  assert.equal(publicData.categories.some((category) => category.id === 'government'), false);
  assert.equal('sources' in publicData, false);
  assert.deepEqual(j.published, publishedBefore, 'the public filter does not rewrite or delete stored records');
  assert.deepEqual(j.decisions, decisionsBefore, 'approval history remains unchanged');
  assert.deepEqual(j.deleted, {});
});

test('Syrian Army items with application deadlines disappear after the Damascus deadline day without deletion', () => {
  const j = initialArmyState();
  const made = makePending(j, 'army-deadline');
  assert.equal(updateArmyItem(made.item.id, { applicationDeadline: '2026-11-06' }, j, 7, NOW + 1).ok, true);
  assert.equal(decideArmyItem(made.item.id, 'approve', j, 7, NOW + 2).ok, true);
  assert.equal(publicArmy(j, Date.parse('2026-11-06T20:59:59Z')).items.length, 1);
  assert.equal(publicArmy(j, Date.parse('2026-11-06T21:00:00Z')).items.length, 0);
  assert.ok(j.published[made.item.id], 'expired army notice stays available in administration');
  assert.equal(publicArmy(j)[0], undefined, 'the current projection omits the expired notice');
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

test('official monitor rejects civil campaigns, general vacancies and civilian salary notices', async () => {
  const j = initialArmyState();
  const history = {
    Sy_Defense: [synthetic(10, 'وزارة الدفاع تعقد اجتماعاً دورياً.')],
    syrianmoi: [synthetic(20, 'وزارة الداخلية تنظم لقاءً تدريبياً.')],
    SyrMOfF: [synthetic(30, 'وزارة المالية تعقد اجتماعاً دورياً.')],
    sana_gov: [synthetic(40, 'سانا تنشر أخباراً عامة.')],
  };
  const fetcher = async (username) => ({ complete: true, posts: history[username] || [] });
  const baseline = await pollArmyOnce({ j, fetcher, now: NOW });
  assert.equal(baseline.baseline, true);
  history.Sy_Defense.push(synthetic(11, 'وزارة الدفاع تطلق حملة تنظيف للحديقة العامة.', { ts: NOW + 30_000 }));
  history.sana_gov.push(
    synthetic(41, 'حملة بناة التطوعية تعيد الألق لحديقة حي في درعا.', { ts: NOW + 31_000 }),
    synthetic(42, 'وزارة الإعلام تعلن عن شواغر وظيفية.', { ts: NOW + 32_000 }),
    synthetic(43, 'بريد حمص يخصص دواماً إضافياً لصرف رواتب المتقاعدين.', { ts: NOW + 33_000 }),
  );
  const result = await pollArmyOnce({ j, fetcher, now: NOW + 60_000 });
  assert.equal(result.newItems, 0);
  assert.equal(Object.keys(j.pending).length, 0);
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
  assert.equal('sources' in result, false, 'the public projection omits monitored source names and links');
  assert.ok(ARMY_MONITOR_ONLY_SOURCES.every((source) => armyMonitorSources(j).some((x) => x.u === source.u)), 'monitor-only sources remain in internal monitoring state');
  assert.deepEqual(result.channels, { tg: '', wa: '' });
});

test('manual Telegram monitor sources validate, add, edit and remove without entering public sources or follow links', () => {
  const j = initialArmyState();
  assert.equal(normalizeArmyTelegramUsername('@SalaryWatch'), 'SalaryWatch');
  assert.equal(normalizeArmyTelegramUsername('https://t.me/SalaryWatch'), 'SalaryWatch');
  assert.equal(normalizeArmyTelegramUsername('https://t.me/+privateInvite'), '');
  assert.equal(normalizeArmyTelegramUsername('https://example.com/SalaryWatch'), '');
  assert.equal(normalizeManualArmySource({ username: 'SalaryWatch', name: 'رواتب الجيش', type: 'media' }).ok, true);
  const added = addManualArmySource({ username: 'SalaryWatch', name: 'متابعة الرواتب', type: 'media' }, j, NOW);
  assert.equal(added.ok, true);
  assert.equal(armyMonitorSources(j).some((source) => source.u === 'SalaryWatch'), true);
  assert.equal(addManualArmySource({ username: 'salarywatch', name: 'مكرر', type: 'official' }, j, NOW + 1).error, 'duplicate');
  assert.equal('sources' in publicArmy(j), false);
  assert.deepEqual(publicArmy(j).channels, { tg: '', wa: '' });
  j.sources.SalaryWatch.initialized = true; j.sources.SalaryWatch.lastId = 555;
  const changed = updateManualArmySource('SalaryWatch', { username: 'ArmyPayNews', name: 'مصدر رواتب محدث', type: 'official' }, j, NOW + 2);
  assert.equal(changed.ok, true);
  assert.equal(j.sources.SalaryWatch, undefined);
  assert.equal(j.sources.ArmyPayNews.initialized, false, 'a changed channel starts with a fresh baseline');
  assert.equal(armyMonitorSources(j).some((source) => source.u === 'ArmyPayNews' && source.type === 'official'), true);
  assert.equal('sources' in publicArmy(j), false);
  assert.equal(removeManualArmySource('ArmyPayNews', j, NOW + 3).ok, true);
  assert.equal(armyMonitorSources(j).some((source) => source.u === 'ArmyPayNews'), false);
  assert.equal(j.sources.ArmyPayNews, undefined);
});

test('salary and recruitment screening covers requested groups without matching unrelated official posts', () => {
  assert.equal(salaryNewsKind('إعلان رسمي عن موعد صرف الرواتب للعاملين'), false);
  assert.equal(salaryNewsKind('إعلان رسمي عن صرف رواتب العسكريين'), true);
  assert.equal(salaryNewsKind('فتح باب الانتساب لدورة أفراد وفق الشروط الرسمية'), true);
  assert.equal(salaryNewsKind('وزارة الدفاع تجري اجتماعاً دورياً'), false);
  assert.equal(salaryNewsKind('Ministry announces payroll update for staff'), false);
  assert.equal(salaryNewsKind('حملة بناة التطوعية تعيد الألق لحديقة حي في درعا'), false);
  assert.equal(salaryNewsKind('إعلان عن شواغر وظيفية في وزارة الإعلام'), false);
  assert.equal(salaryNewsKind('The army announces soldier salary payments'), true);
  assert.equal(inferArmyCategory('إعلان عن دورة أفراد في الشرطة السورية'), 'recruitment');
  assert.equal(inferArmyCategory('فتح باب الانتساب لقوات المهام الخاصة'), 'special');
  assert.equal(inferArmyCategory('وزارة الداخلية تفتح باب الانتساب لدورة أفراد عبر الرابط الرسمي', 'syrianmoi', ['https://ee.moi-sy.com/apply']), 'official_links');
  assert.equal(inferArmyCategory('إعلان عن رواتب عناصر الأمن العام'), 'security');
  assert.equal(inferArmyCategory('صرف رواتب موظفي الوزارات والدوائر الحكومية', 'SyrMOfF'), null);
  assert.equal(inferArmyCategory('إعلان حكومي تجريبي عن صرف الرواتب', 'sana_gov'), null);
  const rejected = createPendingArmyItem({ kind: 'official_source', sourceKey: 'test:civil-vacancy', sourceUrl: 'https://t.me/sana_gov/999', title: 'شواغر وظيفية', text: 'إعلان عن شواغر وظيفية في وزارة الإعلام.' }, initialArmyState(), NOW);
  assert.equal(rejected.error, 'not_army_related');
  assert.deepEqual(Object.keys(ARMY_CATEGORIES), ['recruitment', 'army', 'police', 'security', 'units', 'special', 'official_links', 'government']);
  assert.equal(ARMY_CATEGORIES.government.public, false);
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
  const updated = updateArmyItem(made.item.id, { text: 'تفاصيل محدثة من لوحة الإدارة عن رواتب أفراد الجيش.' }, j, 7, NOW + 3);
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
