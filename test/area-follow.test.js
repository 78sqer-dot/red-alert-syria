import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, matchesFollowArea } from '../shared/area-follow.js';

const latakiaAlert = {
  type: 'political',
  place: { name_ar: 'اللاذقية', name_en: 'Latakia', governorate: '02', governorate_ar: 'اللاذقية' },
  location: { latitude: 35.53125, longitude: 35.79088 },
};

test('governorate follow matches codes and normalized names, but not another governorate', () => {
  assert.equal(matchesFollowArea(latakiaAlert, { type: 'governorate', code: '02' }), true);
  assert.equal(matchesFollowArea(latakiaAlert, { type: 'governorate', name_ar: 'اَللَّاذِقِيَّة' }), true);
  assert.equal(matchesFollowArea(latakiaAlert, { type: 'governorate', code: '13', name_ar: 'دمشق' }), false);
});

test('place follow matches normalized place names and coordinates within the selected radius', () => {
  const nameMatch = { type: 'political', place: { name_ar: 'حَلَب', governorate: '09' }, location: { latitude: 36.20124, longitude: 37.16117 } };
  assert.equal(matchesFollowArea(nameMatch, { type: 'place', code: '09', name_ar: 'حلب', lat: 36.20124, lon: 37.16117, radiusKm: 2 }), true);

  const nearby = { type: 'political', place: { name_ar: 'مكان مجاور', governorate: '02' }, location: { latitude: 35.54, longitude: 35.79 } };
  assert.equal(matchesFollowArea(nearby, { type: 'place', code: '02', name_ar: 'قرية غير مسماة', lat: 35.53125, lon: 35.79088, radiusKm: 2 }), true);
  const far = { ...nearby, location: { latitude: 36.20124, longitude: 37.16117 } };
  assert.equal(matchesFollowArea(far, { type: 'place', code: '02', name_ar: 'قرية غير مسماة', lat: 35.53125, lon: 35.79088, radiusKm: 2 }), false);
});

test('additional place names and countrywide alerts are handled without a user GPS lookup', () => {
  const multiple = { type: 'political', place: {}, more: [{ name_ar: 'درعا', governorate: '06' }] };
  assert.equal(matchesFollowArea(multiple, { type: 'governorate', code: '06' }), true);
  assert.equal(matchesFollowArea({ scope: 'country' }, { type: 'place', placeId: 170654 }), true);
  assert.equal(matchesFollowArea({ place: {}, location: null }, { type: 'place', placeId: 170654, lat: 33.51, lon: 36.29 }), false);
});

test('distance calculation rejects malformed coordinates', () => {
  assert.ok(distanceKm({ lat: 33.5, lon: 36.2 }, { latitude: 33.5, longitude: 36.2 }) < 0.01);
  assert.equal(distanceKm({ lat: 'invalid', lon: 36 }, { lat: 33, lon: 36 }), null);
});
