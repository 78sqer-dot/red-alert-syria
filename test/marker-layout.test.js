import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chooseClusterOffset, pointInGeoJSON } from '../public/js/marker-layout.js';

const border = {
  type: 'Feature',
  properties: { name: 'test' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  },
};

test('pointInGeoJSON handles an outer border and holes', () => {
  assert.equal(pointInGeoJSON(border, 2, 2), true);
  assert.equal(pointInGeoJSON(border, 0, 5), true, 'a point on the border is inside');
  assert.equal(pointInGeoJSON(border, 5, 5), false, 'a point inside a polygon hole is outside');
  assert.equal(pointInGeoJSON(border, 12, 5), false);
});

test('cluster offsets avoid north-of-border positions and remain distinct', () => {
  const used = new Set();
  const inside = ([, screenY]) => screenY >= 0;
  const first = chooseClusterOffset(0, 2, inside, used);
  const second = chooseClusterOffset(1, 2, inside, used);

  assert.ok(inside(first));
  assert.ok(inside(second));
  assert.notDeepEqual(first, second);
  assert.notEqual(first.join(','), '0,-26', 'the first marker must not be shifted north');
  assert.notEqual(second.join(','), '0,-26', 'no marker should be shifted north across this border');
});

test('Tall Abyad grouped markers stay inside the bundled Syria border', () => {
  const syria = JSON.parse(fs.readFileSync(new URL('../public/data/syria-border.geojson', import.meta.url), 'utf8'));
  const lat = 36.69648;
  const lon = 38.95382;
  const degreesPerPixel = 0.001;
  const locationAtOffset = ([dx, dy]) => [lon + dx * degreesPerPixel, lat - dy * degreesPerPixel];
  assert.equal(pointInGeoJSON(syria, lon, lat), true);

  const used = new Set();
  const offsets = [0, 1].map((i) => chooseClusterOffset(i, 2, (offset) => {
    const [x, y] = locationAtOffset(offset);
    return pointInGeoJSON(syria, x, y);
  }, used));
  for (const offset of offsets) {
    const [x, y] = locationAtOffset(offset);
    assert.equal(pointInGeoJSON(syria, x, y), true, `offset ${offset} stays in Syria`);
  }
  assert.notDeepEqual(offsets[0], offsets[1]);
});

test('single markers stay exactly on their geographic coordinate', () => {
  assert.deepEqual(chooseClusterOffset(0, 1, () => false), [0, 0]);
});
