import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { countUniqueZoneCircles } from '../shared/zone-visuals.js';

const [map, css] = await Promise.all([
  readFile(new URL('../public/js/map.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/css/app.css', import.meta.url), 'utf8'),
]);

test('counts distinct valid affected circles using synthetic locations only', () => {
  const first = { lat: 33.51, lon: 36.29, km: 4 };
  const second = { lat: 32.62, lon: 36.12, km: 4 };
  assert.equal(countUniqueZoneCircles([]), 0);
  assert.equal(countUniqueZoneCircles(null), 0);
  assert.equal(countUniqueZoneCircles([
    first,
    { ...first },
    second,
    { lat: Number.NaN, lon: 36.4, km: 4 },
    { lat: 34, lon: Number.POSITIVE_INFINITY, km: 4 },
    { lat: 34, lon: 36, km: Number.NaN },
  ]), 2);
});

test('renders affected-circle count separately from nearby-alert cluster counts', () => {
  assert.match(map, /zoneCircleCount\(alert\)[\s\S]*?countUniqueZoneCircles\(zones\)/);
  assert.match(map, /syncZoneCountBadge\(el, alert\)[\s\S]*?badge\.className = 'mk-zone-count'/);
  assert.match(map, /badge\.textContent = lang === 'en' \? `\$\{formatted\} circles` : `\$\{formatted\} دوائر`/);
  assert.match(map, /nearby alerts — click to choose/);
  assert.match(map, /affected circles/);
  assert.match(map, /عدد الدوائر المتأثرة:/);
  assert.match(map, /badge\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(map, /el\.setAttribute\('aria-label', el\.title\)/);
  assert.match(css, /\.mk-zone-count \{[^}]*white-space: nowrap;[^}]*pointer-events: none;/);
  assert.match(css, /\.mk-count \{/);
  assert.doesNotMatch(css, /\.mk-zone-count\s*\{[^}]*pointer-events:\s*auto/);
});
