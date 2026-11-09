import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchPush, sanitizeFollowArea, saveSubscription } from '../server/push.js';
import { getGov, searchFollowPlaces } from '../server/places.js';

const endpoint = 'https://push.example.test/area-follow';
const subscription = { endpoint, keys: { p256dh: 'synthetic-public-key', auth: 'synthetic-auth-key' } };

test('area preferences are reduced to known governorate codes or place IDs', () => {
  const gov = getGov('13');
  assert.ok(gov);
  assert.deepEqual(sanitizeFollowArea({ type: 'governorate', code: '13', name_ar: 'ignored', lat: 0, secret: 'ignored' }), { type: 'governorate', code: '13' });
  const places = searchFollowPlaces('دمشق', '13');
  assert.ok(places.length > 0);
  const selected = places[0];
  assert.deepEqual(sanitizeFollowArea({ type: 'place', placeId: selected.id, name_ar: 'ignored', lat: 0 }), { type: 'place', placeId: selected.id });
  assert.equal(sanitizeFollowArea({ type: 'governorate', code: '99' }), null);
  assert.equal(sanitizeFollowArea({ type: 'place', placeId: 999999999 }), null);
});

test('saving a push subscription stores only the selected area identifier', () => {
  let saved;
  const store = { savePushSubscription: (id, value) => { saved = { id, value }; } };
  const place = searchFollowPlaces('دمشق', '13')[0];
  const id = saveSubscription(store, subscription, {
    types: ['political'], governorate: 'all', lang: 'en',
    followArea: { type: 'place', placeId: place.id, name_ar: place.name_ar, lat: place.latitude, lon: place.longitude },
  });
  assert.ok(id);
  assert.equal(saved.id, id);
  assert.deepEqual(saved.value.followArea, { type: 'place', placeId: place.id });
  assert.equal(Object.hasOwn(saved.value.followArea, 'lat'), false);
  assert.deepEqual(saved.value.types, ['political']);
  assert.equal(saved.value.lang, 'en');
});

test('push delivery respects selected places while preserving legacy governorate filters', async () => {
  const damascus = searchFollowPlaces('دمشق', '13')[0];
  const aleppo = searchFollowPlaces('حلب', '09')[0];
  const subscriptions = {
    selectedDamascus: { types: ['political'], governorate: 'all', followArea: { type: 'place', placeId: damascus.id } },
    selectedAleppo: { types: ['political'], governorate: 'all', followArea: { type: 'place', placeId: aleppo.id } },
    legacyDamascus: { types: ['political'], governorate: '13' },
    legacyAleppo: { types: ['political'], governorate: '09' },
    invalidArea: { types: ['political'], governorate: 'all', followArea: { type: 'place', placeId: 999999999 } },
  };
  const store = {
    pushSubscriptions: () => Object.entries(subscriptions),
    removePushSubscription: () => false,
  };
  const alert = {
    id: 'synthetic-area-follow-alert', type: 'political', title: 'Synthetic notice',
    place: { name_ar: damascus.name_ar, name_en: damascus.name_en, governorate: '13', governorate_ar: 'دمشق' },
    location: { latitude: damascus.latitude, longitude: damascus.longitude },
  };
  const delivered = [];
  const result = await dispatchPush(store, alert, 'new', async (sub) => delivered.push(Object.keys(subscriptions).find((key) => subscriptions[key] === sub)));
  assert.equal(result.sent, 2);
  assert.equal(result.skipped, 3);
  assert.deepEqual(delivered.sort(), ['legacyDamascus', 'selectedDamascus']);
});
