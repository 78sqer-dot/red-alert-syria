import test from 'node:test';
import assert from 'node:assert/strict';
import { directFlightPath } from '../shared/flight-path.js';

test('route is a direct line from the saved observation location to the selected governorate', () => {
  const origin = { latitude: 33.5, longitude: 36.2 };
  const destination = { latitude: 35.9, longitude: 36.6 };
  assert.deepEqual(directFlightPath(origin, destination), [[36.2, 33.5], [36.6, 35.9]]);
});

test('general country targets do not invent an endpoint or a route', () => {
  const origin = { latitude: 33.5, longitude: 36.2 };
  const syria = { scope: 'country', name_ar: 'سوريا', latitude: null, longitude: null };
  assert.deepEqual(directFlightPath(origin, syria), []);
});

test('invalid, out-of-range, or identical endpoints do not create a route', () => {
  const origin = { latitude: 33.5, longitude: 36.2 };
  assert.deepEqual(directFlightPath(origin, { latitude: 95, longitude: 36.6 }), []);
  assert.deepEqual(directFlightPath(origin, { latitude: 33.5, longitude: 181 }), []);
  assert.deepEqual(directFlightPath(origin, { latitude: 33.5, longitude: 36.2 }), []);
});
