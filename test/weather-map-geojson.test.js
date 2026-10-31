import test from 'node:test';
import assert from 'node:assert/strict';
import { weatherWarningFeatures } from '../shared/weather-map.js';

test('official weather warnings become one indicative map marker per affected Syrian governorate', () => {
  const centers = {
    '01': [36.52, 40.75, 'الحسكة', 'Al-Hasakah'],
    '13': [33.51, 36.29, 'دمشق', 'Damascus'],
  };
  const features = weatherWarningFeatures([
    { id: 'w1', govs: ['01', '13', 'unknown'], hazard: 'heavy rain', level: 1 },
    { id: 'w2', govs: ['13'], hazard: 'snow', level: 2 },
  ], centers, 'ar');

  assert.equal(features.length, 2, 'duplicate warnings in one governorate share a marker');
  const hasakah = features.find((feature) => feature.properties.gov === '01');
  const damascus = features.find((feature) => feature.properties.gov === '13');
  assert.deepEqual(hasakah.geometry.coordinates, [40.75, 36.52]);
  assert.equal(hasakah.properties.name, 'الحسكة');
  assert.equal(hasakah.properties.icon, 'svc-wx-storm');
  assert.equal(damascus.properties.warn, 2, 'the highest active severity controls the governorate marker');
  assert.equal(damascus.properties.icon, 'svc-wx-snow');
  assert.equal(damascus.properties.main, 1);
});

test('weather warning map features are localized and ignore unknown or unlocated governorates', () => {
  const features = weatherWarningFeatures([
    { govs: ['02', '99'], hazard: 'wind', level: 1 },
  ], { '02': [35.53, 35.79, 'اللاذقية', 'Latakia'] }, 'en');
  assert.equal(features.length, 1);
  assert.equal(features[0].properties.name, 'Latakia');
  assert.equal(features[0].properties.tt, 'Warning');
  assert.equal(features[0].properties.icon, 'svc-wx-wind');
  assert.deepEqual(features[0].geometry.coordinates, [35.79, 35.53]);
});
