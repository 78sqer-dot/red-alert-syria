import test from 'node:test';
import assert from 'node:assert/strict';
import { alertZones, capitalOf, mentionedGovernorates } from '../server/places.js';

const near = (a, b) => Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01;

const exampleAlert = {
  id: 'multi-governorate-example',
  type: 'breaking',
  title: 'خبر عاجل — القنيطرة',
  description: 'التحركات لا تزال مجهولة.. مصادر محلية: الجيش الإسرائيلي يدفع بتعزيزات عسكرية إلى الحدود السورية من جهة درعا و القنيطرة',
  scope: 'place',
  location: { latitude: 32.61995, longitude: 36.11808 },
  place: { name_ar: 'القنيطرة', governorate: '06', governorate_ar: 'درعا' },
  areas: ['القنيطرة', 'درعا'],
  extra: [],
};

test('detects the two governorates explicitly named in the current incident text', () => {
  assert.deepEqual(mentionedGovernorates(exampleAlert.description).map((g) => g.code).sort(), ['03', '06']);
});

test('adds a separate circle at Quneitra while retaining the original Daraa location', () => {
  const zones = alertZones(exampleAlert);
  const qn = capitalOf('03');
  assert.equal(zones.length, 2);
  assert.ok(zones.some((z) => near(z, { lat: exampleAlert.location.latitude, lon: exampleAlert.location.longitude })));
  assert.ok(zones.some((z) => near(z, { lat: qn.lat, lon: qn.lon })));
});

test('does not duplicate an affected governorate already added manually', () => {
  const qn = capitalOf('03');
  const zones = alertZones({
    ...exampleAlert,
    extra: [{ name_ar: qn.ar, governorate: '03', latitude: qn.lat, longitude: qn.lon, rank: qn.rank, scope: 'place' }],
  });
  assert.equal(zones.length, 2);
  assert.ok(zones.some((z) => near(z, { lat: qn.lat, lon: qn.lon })));
});

test('prefers Rif Dimashq over the nested token Damascus, without losing a separate Damascus mention', () => {
  assert.deepEqual(mentionedGovernorates('خبر في ريف دمشق').map((g) => g.code), ['08']);
  assert.deepEqual(mentionedGovernorates('خبر في ريف دمشق ومدينة دمشق').map((g) => g.code), ['08', '13']);
});
