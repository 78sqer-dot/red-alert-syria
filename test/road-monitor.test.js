import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../server/store.js';
import { addRoad } from '../server/services.js';
import { onRoadNewsPost, parseRoadText, roadEvidence, roadLocations, rememberIgnoredRoadReport } from '../server/road-monitor.js';
import { isRoadStatusOnlyPost } from '../server/news-monitor.js';

function freshStore() {
  const oldState = store.state;
  const oldPersist = store.persist;
  store.state = { svc: {}, reports: {} };
  store.persist = () => {};
  return () => { store.state = oldState; store.persist = oldPersist; };
}

const post = (u, text, id = 1) => ({
  src: { u, name: u }, text, ts: Date.now(), url: `https://t.me/${u}/${id}`,
});

test('road parsing accepts explicit closures and impassability but keeps negated, planned, or reopening reports for review', () => {
  assert.deepEqual(parseRoadText('إغلاق الطريق بين دمشق ودرعا بعد سيول'), { road: 'closed', reason: null });
  assert.deepEqual(parseRoadText('الطريق غير سالك في مدينة الصنمين بريف درعا'), { road: 'danger', reason: null });
  assert.deepEqual(parseRoadText('طريق مقطوع في حماة بسبب السيول'), { road: 'closed', reason: null });
  assert.deepEqual(parseRoadText('لا يمكن المرور على الطريق في حمص بسبب الانهيار'), { road: 'danger', reason: null });
  assert.equal(parseRoadText('الطريق ليس مغلقاً في درعا').road, null);
  assert.equal(parseRoadText('سيتم إغلاق الطريق في حمص غداً').road, null);
  assert.equal(parseRoadText('أعيد فتح الطريق بعد إغلاق مؤقت في دمشق').road, null);
  assert.equal(parseRoadText('ازدحام مروري في دمشق'), null);
});

test('road-only status updates do not also enter the general breaking-news pipeline', () => {
  assert.equal(isRoadStatusOnlyPost('إغلاق الطريق بين دمشق ودرعا بسبب أعمال صيانة'), true);
  assert.equal(isRoadStatusOnlyPost('إغلاق الطريق بعد انفجار قرب حاجز في درعا'), false, 'a concrete incident remains eligible for the alert pipeline');
  assert.equal(isRoadStatusOnlyPost('تحذير جوي رسمي من أمطار غزيرة في دمشق مع إغلاق الطريق'), false, 'an actionable weather warning remains eligible');
});

test('road locations require a named Syrian place and resolve route endpoints without a governorate-only pin', () => {
  const endpoints = roadLocations('إغلاق الطريق بين دمشق ودرعا بعد سيول');
  assert.deepEqual(endpoints.map((x) => x.name_ar), ['دمشق', 'درعا']);
  const town = roadLocations('الطريق غير سالك في مدينة الصنمين بريف درعا');
  assert.deepEqual(town.map((x) => x.name_ar), ['الصنمين']);
  assert.deepEqual(roadLocations('الطريق مغلق في ريف دمشق'), []);
});

test('automatic evidence accepts one official source or two independent non-identical outlet groups only', () => {
  assert.equal(roadEvidence([{ u: 'syrsmot', official: true, text: 'إغلاق الطريق' }]), 'official');
  assert.equal(roadEvidence([
    { u: 'ajasyr', group: 'aljazeera', text: 'قطع طريق دمشق حمص نتيجة السيول التي اجتاحت المنطقة' },
    { u: 'alarabiya_sy', group: 'alarabiya', text: 'تعذر مرور المركبات على أوتوستراد العاصمة بسبب الانجرافات المائية' },
  ]), 'two-independent');
  assert.equal(roadEvidence([
    { u: 'ajasyr', group: 'aljazeera', text: 'إغلاق الطريق بين دمشق ودرعا بعد سيول' },
    { u: 'ajanews', group: 'aljazeera', text: 'إغلاق الطريق بين دمشق ودرعا بعد سيول' },
  ]), null);
  assert.equal(roadEvidence([
    { u: 'ajasyr', group: 'aljazeera', text: 'إغلاق الطريق بين دمشق ودرعا بعد سيول' },
    { u: 'alarabiya_sy', group: 'alarabiya', text: 'إغلاق الطريق بين دمشق ودرعا بعد سيول' },
  ]), null);
});

test('a single media report stays in review until a second independent outlet confirms it', async () => {
  const restore = freshStore();
  try {
    await onRoadNewsPost(post('ajasyr', 'قطع الطريق بين دمشق ودرعا نتيجة السيول التي جرفت الطريق في المنطقة', 150));
    assert.equal(store.state.svc.roads?.length || 0, 0);
    assert.equal(store.state.svc.roadWatch.events[0].state, 'pending');
    await onRoadNewsPost(post('alarabiya_sy', 'إغلاق الطريق بين دمشق ودرعا جراء الانهيار الصخري الذي منع حركة السير بالكامل', 151));
    assert.equal(store.state.svc.roads.length, 1);
    assert.equal(store.state.svc.roads[0].status, 'closed');
    assert.equal(store.state.svc.roadWatch.events[0].evidence, 'two-independent');
  } finally { restore(); }
});

test('a local official road post is auto-added once and does not create a duplicate map record', async () => {
  const restore = freshStore();
  try {
    const text = 'إغلاق الطريق بين دمشق ودرعا بعد السيول';
    await onRoadNewsPost(post('SyrSMOT', text, 100));
    assert.equal(store.state.svc.roads.length, 1);
    assert.equal(store.state.svc.roads[0].status, 'closed');
    assert.equal(store.state.svc.roadWatch.events[0].state, 'published');
    await onRoadNewsPost(post('SyrSMOT', text, 101));
    assert.equal(store.state.svc.roads.length, 1);
  } finally { restore(); }
});

test('ignored and pending human reports suppress matching road-news publication', async () => {
  const restore = freshStore();
  try {
    const ignoredLocation = roadLocations('إغلاق الطريق في درعا')[0];
    rememberIgnoredRoadReport({ type: 'road', road: 'closed', location: ignoredLocation, extra: [] });
    await onRoadNewsPost(post('SyrSMOT', 'إغلاق الطريق في درعا', 200));
    assert.equal(store.state.svc.roads?.length || 0, 0);
    assert.equal(store.state.svc.roadWatch.events[0].state, 'ignored');

    const pendingLocation = roadLocations('إغلاق الطريق في حمص')[0];
    store.state.reports.r1 = { draft: { type: 'road', road: 'closed', location: pendingLocation, extra: [] } };
    await onRoadNewsPost(post('SyrSMOT', 'إغلاق الطريق في حمص', 201));
    const pending = store.state.svc.roadWatch.events.find((x) => x.route === 'حمص');
    assert.equal(pending.state, 'pending-report');
    assert.equal(store.state.svc.roads?.length || 0, 0);
  } finally { restore(); }
});

test('an already-published manual road status suppresses an automated duplicate', async () => {
  const restore = freshStore();
  try {
    const location = roadLocations('إغلاق الطريق في حماة')[0];
    addRoad({ road: 'closed', location, details: 'بلاغ يدوي', ttlMin: 360 }, { id: 0, name: 'test' });
    await onRoadNewsPost(post('SyrSMOT', 'إغلاق الطريق في حماة', 300));
    assert.equal(store.state.svc.roads.length, 1);
    assert.equal(store.state.svc.roadWatch.events[0].state, 'published-existing');
  } finally { restore(); }
});

test('a different report for an active road status stays in owner review without changing the map', async () => {
  const restore = freshStore();
  try {
    const location = roadLocations('إغلاق الطريق في درعا')[0];
    addRoad({ road: 'closed', location, details: 'بلاغ يدوي', ttlMin: 360 }, { id: 0, name: 'test' });
    await onRoadNewsPost(post('SyrSMOT', 'الطريق غير سالك في درعا بسبب الثلوج', 400));
    assert.equal(store.state.svc.roads.length, 1);
    assert.equal(store.state.svc.roads[0].status, 'closed');
    assert.equal(store.state.svc.roadWatch.events[0].state, 'pending');
    assert.equal(store.state.svc.roadWatch.events[0].conflict, true);
  } finally { restore(); }
});
