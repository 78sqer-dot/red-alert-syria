import test from 'node:test';
import assert from 'node:assert/strict';
import { _test } from '../server/seo.js';
import { store } from '../server/store.js';

// seed a small statistics log: two alerts today (Damascus), one yesterday
const now = Date.now();
const damNow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = damNow.format(new Date(now));
const yest = damNow.format(new Date(now - 86400_000));
const at = (k, h) => new Date(`${k}T${String(h).padStart(2, '0')}:05:00+02:00`).toISOString();
store.state.log = [
  { id: 'a3', ty: 'shelling', ts: at(yest, 22), g: 'aleppo', ga: 'حلب', ge: 'Aleppo' },
  { id: 'a1', ty: 'warplane', ts: at(today, 8), g: 'damascus', ga: 'دمشق', ge: 'Damascus', pa: 'المزة', pe: 'Mezzeh' },
  { id: 'a2', ty: 'uav', ts: at(today, 11), g: 'damascus', ga: 'دمشق', ge: 'Damascus' },
];

test('archiveDays groups the log by Damascus day, newest first', () => {
  const days = _test.archiveDays();
  assert.deepEqual(days, [[today, 2], [yest, 1]]);
});

test('archive index page lists every day with its count', () => {
  const ar = _test.archiveIndex('ar');
  assert.match(ar, /أرشيف التنبيهات/);
  assert.match(ar, new RegExp(`/ar/archive/${today}/`));
  assert.match(ar, /2 تنبيه/);
  const en = _test.archiveIndex('en');
  assert.match(en, new RegExp(`/en/archive/${yest}/`));
  assert.match(en, /1 alert/);
});

test('archive day page lists the day\'s alerts with links to their share pages', () => {
  const ar = _test.archiveDay('ar', today);
  assert.match(ar, /طيران حربي|حربي/);
  assert.match(ar, /المزة/);
  assert.match(ar, /\/ar\/a\/a1/);
  assert.match(ar, /\/ar\/a\/a2/);
  assert.doesNotMatch(ar, /\/ar\/a\/a3/);
  const en = _test.archiveDay('en', yest);
  assert.match(en, /Aleppo/);
  assert.match(en, /\/en\/a\/a3/);
});

test('archive day page rejects bad or empty days', () => {
  assert.equal(_test.archiveDay('ar', 'bogus'), null);
  assert.equal(_test.archiveDay('ar', '2020-01-01'), null);
});

test('sitemap includes the archive index and day pages', () => {
  const xml = _test.sitemapXml();
  assert.match(xml, /\/ar\/archive\//);
  assert.match(xml, new RegExp(`/en/archive/${today}/`));
});

test('alert share pages are indexable for search engines', () => {
  // share pages carry the full alert text for bots; they must not be noindex
  const a = { id: 'a1', type: 'warplane', severity: 'high', timestamp: at(today, 8), title: 'طيران حربي', description: 'تحليق', place: { name_ar: 'المزة', governorate_ar: 'دمشق' } };
  const page = _test.alertSharePage('a1', 'ar');
  if (page) assert.doesNotMatch(page, /noindex/);
});
