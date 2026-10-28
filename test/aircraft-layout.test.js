import test from 'node:test';
import assert from 'node:assert/strict';
import { squadLayout } from '../public/js/aircraft-layout.js';

test('country-view flight paths retain a readable three-plane formation', () => {
  const layout = squadLayout(5);
  assert.equal(layout.flightRadius, 10);
  assert.equal(layout.planeScale, 0.89);
  assert.equal(layout.formationScale, 0.9);
});

test('plane and formation scales grow smoothly as the flight ring becomes readable', () => {
  const small = squadLayout(18);
  const medium = squadLayout(36);
  const large = squadLayout(90);
  assert.ok(small.formationScale <= medium.formationScale);
  assert.ok(small.planeScale < medium.planeScale);
  assert.equal(medium.formationScale, 1);
  assert.ok(small.planeScale < large.planeScale);
  assert.equal(large.planeScale, 1);
  assert.equal(large.flightRadius, 90);
});

test('flight path and icon sizes stay within safe bounds at extreme zooms', () => {
  const minimum = squadLayout(0);
  const maximum = squadLayout(1000);
  assert.deepEqual(minimum, { flightRadius: 10, planeScale: 0.88, formationScale: 0.9 });
  assert.deepEqual(maximum, { flightRadius: 130, planeScale: 1, formationScale: 1 });
});

test('invalid radii safely use the compact country-view layout', () => {
  assert.deepEqual(squadLayout(Number.NaN), squadLayout(0));
});
