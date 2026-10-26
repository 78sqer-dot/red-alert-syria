import test from 'node:test';
import assert from 'node:assert/strict';
import { squadLayout } from '../public/js/aircraft-layout.js';

test('country view keeps all three SVG aircraft legible on a moving path', () => {
  assert.deepEqual(squadLayout(5), { flightRadius: 10, planeScale: 0.72 });
});

test('small and large circles keep their own full flight radii', () => {
  const small = squadLayout(36);
  const large = squadLayout(177);
  assert.equal(small.flightRadius, 36);
  assert.equal(large.flightRadius, 177);
  assert.ok(small.planeScale < large.planeScale);
  assert.ok(large.planeScale <= 0.95);
});

test('large circle orbit is not clipped to 130px or scaled down with the SVG', () => {
  for (const radius of [90, 130, 180, 260, 1000]) {
    const layout = squadLayout(radius);
    assert.equal(layout.flightRadius, radius);
    assert.ok(layout.planeScale >= 0.7 && layout.planeScale <= 0.95);
  }
});

test('invalid radii safely use the compact country-view layout', () => {
  assert.deepEqual(squadLayout(Number.NaN), squadLayout(0));
  assert.deepEqual(squadLayout(-20), squadLayout(0));
  assert.deepEqual(squadLayout(Number.POSITIVE_INFINITY), squadLayout(0));
});
