import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { _test } from '../server/seo.js';

test('proper 404 page (Dalil gap list): branded, bilingual, noindex, wired at the catch-all', () => {
  const ar = _test.notFoundPage('ar');
  assert.match(ar, /الصفحة غير موجودة/);
  assert.match(ar, /noindex/);
  assert.match(ar, /href="\/ar\/"/);
  const en = _test.notFoundPage('en');
  assert.match(en, /Page not found/);
  assert.match(en, /href="\/en\/"/);
  const idx = fs.readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(idx, /notFoundPage\(req\.path\.startsWith\('\/en'\)/, 'unknown HTML routes serve the page');
  assert.match(idx, /req\.path\.startsWith\('\/api\/'\)\) return res\.status\(404\)\.type\('text'\)/, 'API misses keep the plain contract');
});
