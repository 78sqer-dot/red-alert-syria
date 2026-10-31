import test from 'node:test';
import assert from 'node:assert/strict';
import { markerTapMatchesMapClick } from '../public/js/map-click-guard.js';

test('marker tap suppresses the MapLibre click echo at the same point', () => {
  const tap = { x: 296, y: 258, at: 1000 };
  assert.equal(markerTapMatchesMapClick(tap, { x: 296, y: 258 }, 1100), true);
  assert.equal(markerTapMatchesMapClick(tap, { x: 320, y: 258 }, 1100), true);
});

test('a separate, stale, or malformed map click is not suppressed', () => {
  const tap = { x: 296, y: 258, at: 1000 };
  assert.equal(markerTapMatchesMapClick(tap, { x: 333, y: 258 }, 1100), false);
  assert.equal(markerTapMatchesMapClick(tap, { x: 296, y: 258 }, 1751), false);
  assert.equal(markerTapMatchesMapClick(tap, { x: 296, y: 258 }, 999), false);
  assert.equal(markerTapMatchesMapClick(tap, { x: NaN, y: 258 }, 1100), false);
  assert.equal(markerTapMatchesMapClick(null, { x: 296, y: 258 }, 1100), false);
});
