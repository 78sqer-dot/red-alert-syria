import test from 'node:test';
import assert from 'node:assert/strict';
import { alertFocusZoom, alertTransitionDuration, distanceKm } from '../shared/map-motion.js';

test('alert focus uses scope-based zoom and does not creep closer with each selection', () => {
  assert.equal(alertFocusZoom('place', 6), 11);
  assert.equal(alertFocusZoom('point', 11.5), 11.5);
  assert.equal(alertFocusZoom('point', 13.5), 12.35);
  assert.equal(alertFocusZoom('governorate', Number.NaN), 8);
});

test('orbiting UAV alerts force detail zoom even when their location scope is a governorate', () => {
  assert.equal(alertFocusZoom('governorate', 8, 11.5), 11.5);
  assert.equal(alertFocusZoom('governorate', Number.NaN, 11.5), 11.5);
  assert.equal(alertFocusZoom('place', 6, 11.5), 11.5);
});

test('map transition duration is comfortable for local and long-distance alert changes', () => {
  assert.equal(alertTransitionDuration(0), 650);
  assert.ok(alertTransitionDuration(500) > alertTransitionDuration(100));
  assert.equal(alertTransitionDuration(10000), 1450);
  assert.equal(alertTransitionDuration(Number.NaN), 650);
});

test('haversine distance handles Syrian coordinates and invalid input safely', () => {
  const km = distanceKm([36.2765, 33.5138], [37.1343, 36.2021]);
  assert.ok(km > 300 && km < 330);
  assert.equal(distanceKm(null, [0, 0]), 0);
});
