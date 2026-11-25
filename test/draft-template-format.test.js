import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-template-'));
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = 'test';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
process.env.PUBLIC_URL = 'https://example.invalid';
process.env.ALERT_IMAGES = 'false';

const { _test } = await import('../server/news-monitor.js');
const { buildAlertInput, channelPost } = await import('../server/bot.js');

const draft = {
  id: 'tpl-1', type: 'explosion', ts: Date.now(),
  headline: 'انفجار في صور بريف درعا',
  loc: { scope: 'place', name_ar: 'صور', district_ar: 'الصنمين', governorate_ar: 'درعا', latitude: 33.06, longitude: 36.19 },
  srcs: [{ name: 'وكالة الأنباء', u: 'news_agency' }],
  sourceText: 'أفاد مراسلنا في درعا بأن انفجاراً وقع في بلدة صور صباح اليوم، دون ورود معلومات عن إصابات حتى الآن.',
};

test('place line is short «place - governorate» with no administrative chain (owner order 2026-11-25)', () => {
  const card = _test.cardText(draft, 'ar');
  assert.match(card, /📍 <b>المكان:<\/b> صور - درعا/);
  assert.doesNotMatch(card, /الصنمين/);
});

test('draft card carries a verbatim attributed quote block (owner order 2026-11-25)', () => {
  const card = _test.cardText(draft, 'ar');
  assert.match(card, /💬 <b>اقتباس:<\/b> «أفاد مراسلنا في درعا بأن انفجاراً وقع في بلدة صور صباح اليوم/);
  assert.match(card, /» — وكالة الأنباء/);
  const bare = _test.cardText({ ...draft, sourceText: '' }, 'ar');
  assert.doesNotMatch(bare, /اقتباس/);
});

test('place format rule: card place line and record areas are short (place - governorate, no district)', async () => {
  const { alertImageSvg } = await import('../server/alert-image.js');
  const svg = await alertImageSvg({ type: 'explosion', title: 'انفجار', location: { latitude: 32.6, longitude: 36.1 }, place: { scope: 'place', name_ar: 'صور', name_en: 'Sour', district_ar: 'الصنمين', governorate_ar: 'درعا', governorate_en: 'Daraa', latitude: 32.6, longitude: 36.1 } }, { lang: 'ar' });
  assert.ok(svg.includes('صور - درعا'), 'card subtitle uses the short place form');
  assert.ok(!svg.includes('الصنمين'), 'the district never appears on the card');
  const built = buildAlertInput({ type: 'explosion', headline: draft.headline, location: { scope: 'place', name_ar: 'صور', district_ar: 'الصنمين', governorate_ar: 'درعا', latitude: 33.06, longitude: 36.19 }, extra: [] });
  assert.deepEqual(built.areas, ['صور', 'درعا'], 'record areas are the short form; district stays only on the place object');
  assert.equal(built.location.district_ar, 'الصنمين', 'full precision is preserved on the record');
});

test('publish retains the source text and the channel post quotes it verbatim without feed names', () => {
  const built = buildAlertInput({
    type: 'explosion', ttlMin: 120,
    location: { scope: 'place', name_ar: 'صور', name_en: 'Sur', governorate_ar: 'درعا', governorate_en: 'Daraa', latitude: 33.06, longitude: 36.19 },
    extra: [], details: 'انفجار في صور', source: 'news',
    sourceText: draft.sourceText,
    meta: {},
  }, { id: 1, name: 'owner' });
  assert.equal(built.meta.sourceText, draft.sourceText);
  const alert = {
    id: 'tpl-post', type: 'explosion', source: 'news', channel_format: 2,
    title: built.title, title_en: built.title_en || '', description: 'انفجار في صور بريف درعا',
    timestamp: new Date().toISOString(), location: built.location, place: { scope: 'place', name_ar: 'صور' },
    meta: { sourceText: draft.sourceText, newsSources: [{ name: 'قناة رصد خاصة', u: 'private_watch' }] },
  };
  const post = channelPost(alert);
  assert.match(post, /💬 <b>اقتباس من المصدر:<\/b> «أفاد مراسلنا في درعا/);
  assert.doesNotMatch(post, /قناة رصد خاصة|private_watch/);
});

test('post place lines: ONE primary place only — extra areas never print as place lines (owner order 2026-11-25, Dardara post)', () => {
  const post = channelPost({
    type: 'explosion', title: 'انفجار في الدردارة', description: 'انفجار في بلدة الدردارة بريف الحسكة',
    place: { scope: 'place', name_ar: 'الدردارة', name_en: 'Al-Dardara', governorate_ar: 'الحسكة', governorate_en: 'Al-Hasakah', latitude: 36.4, longitude: 40.9 },
    extra: [{ scope: 'place', name_ar: 'تل تمر', name_en: 'Tal Tamr', governorate_ar: 'الحسكة', latitude: 36.65, longitude: 40.37 }],
    location: { latitude: 36.4, longitude: 40.9 }, timestamp: new Date(Date.UTC(2026, 10, 25, 17, 18)).toISOString(),
  });
  assert.equal((post.match(/📍/g) || []).length, 1, 'exactly one place line in the post');
  assert.ok(post.includes('الدردارة - الحسكة'), 'the primary affected place, short form');
  assert.ok(!post.includes('تل تمر'), 'the reference town is not a place line (it stays on the record for card circles)');
});

test('one canonical time source: post clock and card footer agree for any alert object shape', async () => {
  const { alertImageSvg, alertTimeMs } = await import('../server/alert-image.js');
  const ms = Date.UTC(2026, 10, 25, 17, 18); // 20:18 Damascus
  const base = { type: 'explosion', title: 'انفجار', location: { latitude: 36.4, longitude: 40.9 }, place: { scope: 'place', name_ar: 'الدردارة', governorate_ar: 'الحسكة', latitude: 36.4, longitude: 40.9 } };
  assert.equal(alertTimeMs({ ts: ms }), ms);
  assert.equal(alertTimeMs({ timestamp: new Date(ms).toISOString() }), ms);
  const footer = (svg) => svg.match(/الساعة ([^<]+)/)?.[1];
  const svgTs = await alertImageSvg({ ...base, ts: ms }, { lang: 'ar' });
  const svgIso = await alertImageSvg({ ...base, timestamp: new Date(ms).toISOString() }, { lang: 'ar' });
  assert.equal(footer(svgTs), footer(svgIso), 'card footer is identical whether the object carries ts or timestamp');
  const post = channelPost({ ...base, place: { ...base.place, name_en: 'Al-Dardara' }, extra: [], ts: ms, description: 'x' });
  assert.ok(!post.includes('Invalid'), 'post renders a real time from ts');
  assert.ok(post.includes('٨:١٨') || post.includes('8:18'), 'post clock shows the same 20:18 Damascus instant');
});
