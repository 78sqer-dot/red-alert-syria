import test from 'node:test';
import assert from 'node:assert/strict';
import { alertZones } from '../server/places.js';
import { cleanPublicNewsAttribution } from '../server/clean-text.js';

test('translation does not add Damascus to a Rif Dimashq incident', () => {
  const zones = alertZones({
    type: 'smuggling_weapons', scope: 'governorate',
    description: 'تنبيه في ريف دمشق',
    description_en: 'Alert in the Damascus countryside',
    location: { latitude: 33.62, longitude: 36.45 },
    place: { name_ar: 'ريف دمشق', governorate: '08' }, extra: [],
  });
  assert.equal(zones.length, 1);
  assert.equal(zones[0].lat, 33.62);
});

test('ordinary Arab adjectives inside institution names are not outlet credits', () => {
  for (const text of [
    'تدريب لعناصر الجيش العربي السوري في الموقع.',
    'بيان صادر عن الجمهورية العربية السورية اليوم.',
    'اجتماع الجامعة العربية اليوم.',
  ]) assert.equal(cleanPublicNewsAttribution(text), text);
  assert.equal(cleanPublicNewsAttribution('العربية: بيان جديد اليوم.'), 'بيان جديد اليوم.');
  assert.equal(cleanPublicNewsAttribution('التلفزيون العربي: بيان جديد اليوم.'), 'بيان جديد اليوم.');
});
