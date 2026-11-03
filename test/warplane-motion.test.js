import test from 'node:test';
import assert from 'node:assert/strict';
import { warplaneEastOffset } from '../shared/warplane-motion.js';

const location = { longitude: 36, latitude: 34 };
const closeTo = (actual, expected, epsilon = 0.1) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not within ${epsilon} of ${expected}`);

test('warplane enters from projected east and preserves a screen-sized gap after marker scaling', () => {
  const map = { project: ([lon, lat]) => ({ x: lon * 1000, y: -lat * 1000 }) };
  const offset = warplaneEastOffset(map, location, 430, 0.5);
  assert.ok(offset.x > 0);
  closeTo(offset.y, 0);
  closeTo(Math.hypot(offset.x, offset.y) * 0.5 * 1.3, 107.5);
});

test('warplane east direction follows the map projection when the map is rotated', () => {
  const map = { project: ([lon, lat]) => ({ x: lat * 1000, y: lon * 1000 }) };
  const offset = warplaneEastOffset(map, location, 430, 0.5);
  closeTo(offset.x, 0);
  assert.ok(offset.y > 0);
  closeTo(Math.hypot(offset.x, offset.y) * 0.5 * 1.3, 107.5);
});

test('warplane approach distance is bounded on small and wide screens, with a safe fallback', () => {
  const map = { project: ([lon, lat]) => ({ x: lon * 1000, y: -lat * 1000 }) };
  const small = warplaneEastOffset(map, location, 300, 0.5);
  const wide = warplaneEastOffset(map, location, 900, 0.5);
  closeTo(Math.hypot(small.x, small.y) * 0.5 * 1.3, 96);
  closeTo(Math.hypot(wide.x, wide.y) * 0.5 * 1.3, 150);
  assert.deepEqual(warplaneEastOffset(null, location), { x: 110, y: 0 });
});
