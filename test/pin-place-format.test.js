import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');

test('live map pin naming (owner clarification 2026-11-25): onePlace is «place - governorate» only', () => {
  const fn = app.slice(app.indexOf('function onePlace'), app.indexOf('const isLive'));
  assert.match(fn, /for \(const x of \[n, g\]\)/, 'the label is built from name + governorate only');
  assert.match(fn, /out\.join\(' - '\)/, 'joined with the short-form separator');
  assert.doesNotMatch(fn, /out\.push\(d\)|of \[n, d|of \[n, g, d/, 'the district never enters the pin label');
});

test('tag areas follow the same short form in both languages', () => {
  const fn = app.slice(app.indexOf('function tagsOf'), app.indexOf('const hasLoc'));
  assert.doesNotMatch(fn, /district/, 'no district in tag areas');
});
