import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';

const map = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
const A = (on, off) => ['case', ['get', 'active'], on, off];

test('aircraft route and area definitions are valid MapLibre styles in both themes', () => {
  for (const dark of [false, true]) {
    const layers = [...map.matchAll(/add\((\{ id: 'ras-(?:zones|flight)[^\n]+)\);/g)]
      .map((match) => new Function('A', 'dark', `return (${match[1]});`)(A, dark));
    assert.equal(layers.length, 7);
    const sources = Object.fromEntries(layers.map((layer) => [layer.source, {
      type: 'geojson', data: { type: 'FeatureCollection', features: [] },
    }]));
    const style = { version: 8, glyphs: 'https://example.invalid/{fontstack}/{range}.pbf', sources, layers };
    assert.deepEqual(validateStyleMin(style).map((error) => error.message), []);
  }
});
