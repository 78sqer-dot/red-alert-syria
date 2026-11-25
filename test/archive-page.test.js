import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Gap-closure item 3 (owner order 2026-11-25): the public alert archive —
// browse/search the project's own log by type, governorate and day, ar/en,
// free. The log retains ~35 days and the page says so.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-archive-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = 'test-only-not-a-real-token';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';

const { _test } = await import('../server/seo.js');
const { store } = await import('../server/store.js');
await store.init(null);

const now = Date.now();
const dayMs = 86400_000;
const damascusDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
store.state.log = [
  { id: 'a-old', ty: 'explosion', ts: new Date(now - 40 * dayMs).toISOString(), g: '06', ga: 'درعا', ge: 'Daraa', pa: 'صور', pe: 'Sur' },
  { id: 'a-1', ty: 'explosion', ts: new Date(now - 3600_000).toISOString(), g: '06', ga: 'درعا', ge: 'Daraa', pa: 'صور', pe: 'Sur' },
  { id: 'a-2', ty: 'artillery', ts: new Date(now - 7200_000).toISOString(), g: '12', ga: 'إدلب', ge: 'Idlib', pa: 'كفر جالس', pe: 'Kafr Jales' },
  { id: 'a-3', ty: 'explosion', ts: new Date(now - 26 * 3600_000).toISOString(), g: '12', ga: 'إدلب', ge: 'Idlib', pa: 'معرة النعمان', pe: 'Maarat al-Numan' },
];
store.state.alerts = [{ id: 'a-1', title: 'انفجار عبوة قرب صور', title_en: 'IED explosion near Sur', type: 'explosion' }];

test('archive lists recent log entries, joins live titles, and hides entries beyond the 35-day window', () => {
  const html = _test.archivePage('ar', {});
  assert.ok(html.includes('أرشيف التنبيهات'));
  assert.ok(html.includes('صور - درعا'));
  assert.ok(html.includes('انفجار عبوة قرب صور'), 'title joined from the live alert record');
  assert.ok(html.includes('كفر جالس - إدلب'));
  assert.ok(!html.includes('/ar/a/a-old'), 'the 40-day-old entry is outside the archive window');
  assert.ok(html.includes('٣٥'), 'the page honestly states its 35-day coverage');
});

test('archive filters by type, governorate and day; junk params fall back safely', () => {
  const byType = _test.archivePage('ar', { type: 'artillery' });
  assert.ok(byType.includes('كفر جالس'));
  assert.ok(!byType.includes('صور - درعا'));
  const byGov = _test.archivePage('en', { gov: '06' });
  assert.ok(byGov.includes('Sur - Daraa'));
  assert.ok(!byGov.includes('Kafr Jales'));
  const byDay = _test.archivePage('ar', { day: damascusDay(now - 3600_000) });
  assert.ok(byDay.includes('صور - درعا'));
  assert.ok(!byDay.includes('معرة النعمان'), 'yesterday’s entry is excluded by the day filter');
  const junk = _test.archivePage('ar', { type: 'nope', gov: '99', day: 'not-a-day', page: '-4' });
  assert.ok(junk.includes('صور - درعا'), 'invalid filters degrade to the unfiltered archive');
});

test('sitemap carries the archive in both languages', () => {
  const xml = _test.sitemapXml();
  assert.ok(xml.includes('/ar/archive/'));
  assert.ok(xml.includes('/en/archive/'));
});
