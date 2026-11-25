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
