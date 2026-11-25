import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const img = await readFile(new URL('../server/alert-image.js', import.meta.url), 'utf8');

test('card heading (owner order 2026-11-25): drawn only from a named, coordinated flight_target', () => {
  assert.match(img, /const headingTo = headingName && Number\.isFinite\(ft\.latitude\) && Number\.isFinite\(ft\.longitude\)/);
  assert.match(img, /!\(alert\.flight_route_origin === 'israel_approx_reference' && alert\.flight_direction === 'leaving_syria'\)/);
  assert.match(img, /stroke-dasharray="16 12"/);
  assert.match(img, /placeDisplay = headingTo \? `\$\{place\}\$\{en \? ' · To ' : ' · نحو '\}\$\{headingTo\.name\}` : place/);
  assert.match(img, /الخط المتقطع يدلّ على اتجاه التحليق التقريبي نحو المنطقة المذكورة/);
});
