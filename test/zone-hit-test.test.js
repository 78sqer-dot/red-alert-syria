import test from 'node:test';
import assert from 'node:assert/strict';
import { zoneHitAt } from '../shared/zone-hit-test.js';

const project = ([x, y]) => ({ x, y });

test('small pulse rings remain tappable at country zoom with a 20px minimum target radius', () => {
  const hit = { id: 'small-ring', lon: 100, lat: 100, km: 1, radiusPx: 5, live: true, ts: 1 };
  assert.equal(zoneHitAt([hit], { x: 118, y: 100 }, project), hit);
  assert.equal(zoneHitAt([hit], { x: 121, y: 100 }, project), null);
});

test('large visible rings include a small forgiving touch margin', () => {
  const hit = { id: 'large-ring', lon: 100, lat: 100, km: 8, radiusPx: 80, live: true, ts: 1 };
  assert.equal(zoneHitAt([hit], { x: 187, y: 100 }, project), hit);
  assert.equal(zoneHitAt([hit], { x: 189, y: 100 }, project), null);
});

test('overlapping hit targets select the nearest event instead of a farther newer circle', () => {
  const near = { id: 'near', lon: 100, lat: 100, km: 4, radiusPx: 24, live: false, ts: 1 };
  const farNewer = { id: 'far-newer', lon: 130, lat: 100, km: 2, radiusPx: 24, live: true, ts: 99 };
  assert.equal(zoneHitAt([farNewer, near], { x: 105, y: 100 }, project), near);
});

test('equal-distance overlapping circles still prefer the most precise and current event', () => {
  const general = { id: 'general', lon: 100, lat: 100, km: 8, radiusPx: 30, live: true, ts: 100 };
  const precise = { id: 'precise', lon: 100, lat: 100, km: 2, radiusPx: 30, live: false, ts: 1 };
  const latest = { id: 'latest', lon: 100, lat: 100, km: 2, radiusPx: 30, live: true, ts: 2 };
  assert.equal(zoneHitAt([general, precise, latest], { x: 100, y: 100 }, project), latest);
});

test('invalid tap coordinates and missing projection are ignored safely', () => {
  const hit = { id: 'ring', lon: 0, lat: 0, km: 1, radiusPx: 5 };
  assert.equal(zoneHitAt([hit], { x: NaN, y: 0 }, project), null);
  assert.equal(zoneHitAt([hit], { x: 0, y: 0 }), null);
});
