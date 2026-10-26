import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesGovernorate } from '../public/js/alert-region-filter.js';

const GOVS = {
  '08': [0, 0, 'ريف دمشق', 'Rif Dimashq'],
  '13': [0, 0, 'دمشق', 'Damascus'],
};

test('the all-regions option and unknown saved codes do not hide alerts', () => {
  const alert = { place: { governorate_ar: 'حلب' } };
  assert.equal(matchesGovernorate(alert, 'all', GOVS), true);
  assert.equal(matchesGovernorate(alert, '99', GOVS), true);
});

test('matches a primary place by Arabic name or governorate code', () => {
  assert.equal(matchesGovernorate({ place: { governorate_ar: 'دمشق' } }, '13', GOVS), true);
  assert.equal(matchesGovernorate({ place: { governorate_en: 'Damascus' } }, '13', GOVS), true);
  assert.equal(matchesGovernorate({ place: { governorate: '13' } }, '13', GOVS), true);
});

test('matches an additional affected location in a multi-area alert', () => {
  const alert = {
    place: { governorate_ar: 'دمشق' },
    more: [{ governorate_en: 'Rif Dimashq' }],
  };
  assert.equal(matchesGovernorate(alert, '08', GOVS), true);
});

test('keeps countrywide alerts visible but excludes unrelated or unknown local alerts', () => {
  assert.equal(matchesGovernorate({ scope: 'country' }, '13', GOVS), true);
  assert.equal(matchesGovernorate({ place: { governorate_ar: 'حلب' } }, '13', GOVS), false);
  assert.equal(matchesGovernorate({ location: { latitude: 34, longitude: 36 } }, '13', GOVS), false);
});
