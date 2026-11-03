import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [map, css] = await Promise.all([
  readFile(new URL('../public/js/map.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/css/app.css', import.meta.url), 'utf8'),
]);

test('keeps geographic alert areas on the map without a zone-count badge or tooltip', () => {
  assert.match(map, /const zs = Array\.isArray\(a\.zones\) && a\.zones\.length \? a\.zones/);
  assert.match(map, /zs\.forEach\(\(z, i\) => \{[\s\S]{0,2000}circlePolygon\(z\.lon, z\.lat, km\)/);
  assert.doesNotMatch(map, /mk-zone-count|zoneCircleCount|syncZoneCountBadge|affected circles|affected areas|عدد الدوائر المتأثرة|عدد المناطق المتأثرة/);
  assert.match(map, /nearby alerts — click to choose/);
  assert.match(map, /el\.setAttribute\('aria-label', el\.title\)/);
  assert.match(css, /\.mk-count \{/);
  assert.doesNotMatch(css, /\.mk-zone-count/);
});
