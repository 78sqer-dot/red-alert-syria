import test from 'node:test';
import assert from 'node:assert/strict';
import { flightPath, flightPosition } from '../shared/flight-path.js';

test('entering-syria path crosses at Quneitra and continues south toward Daraa', () => {
  const path = flightPath('entering_syria');
  assert.deepEqual(path[0], [35.65, 33.10]);
  assert.deepEqual(path[1], [35.817, 33.113]);
  assert.deepEqual(path.at(-1), [36.105, 32.62]);
  assert.ok(path.length > 3);
});

test('toward-syria stops at the border while leaving-syria reverses the entry path', () => {
  assert.deepEqual(flightPath('toward_syria'), [[35.65, 33.10], [35.817, 33.113]]);
  assert.deepEqual(flightPath('leaving_syria'), [...flightPath('entering_syria')].reverse());
});

test('movement interpolation follows the path and supplies a heading', () => {
  const path = flightPath('entering_syria');
  const start = flightPosition(path, 0);
  const middle = flightPosition(path, 0.5);
  const end = flightPosition(path, 1);
  assert.equal(start.lon, path[0][0]);
  assert.equal(start.lat, path[0][1]);
  assert.ok(middle && middle.lon > 35.817 && middle.lat < 33.113);
  assert.ok([start.bearing, middle.bearing, end.bearing].every((x) => Number.isFinite(x) && x >= 0 && x < 360));
  assert.equal(end.lon, path.at(-1)[0]);
  assert.equal(end.lat, path.at(-1)[1]);
});

test('unknown directions do not create a fictitious route', () => {
  assert.deepEqual(flightPath('unknown'), []);
  assert.equal(flightPosition([], 0.5), null);
});
