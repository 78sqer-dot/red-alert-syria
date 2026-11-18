import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-news-channel-layout-'));
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
process.env.PUBLIC_URL = 'https://example.invalid';
process.env.ALERT_IMAGES = 'false';

const { store } = await import('../server/store.js');
await store.init(null);
const { channelPost, publishInput } = await import('../server/bot.js');

const politicalNews = {
  id: 'new-news-layout-test', type: 'political', source: 'news', channel_format: 3,
  timestamp: '2026-11-18T17:20:00.000Z',
  description: 'أعلنت الجهات الرسمية اجتماعاً جديداً في دمشق.',
  body: 'أعلنت الجهات الرسمية اجتماعاً جديداً في دمشق. وقالت الوزارة إن الاجتماع ينعقد غداً ويشمل عدة ملفات مشتركة.',
  place: { scope: 'place', name_ar: 'دوما', name_en: 'Douma', governorate_ar: 'ريف دمشق', governorate_en: 'Rif Dimashq' },
  extra: [{ scope: 'place', name_ar: 'حرستا', name_en: 'Harasta', governorate_ar: 'ريف دمشق', governorate_en: 'Rif Dimashq' }],
  meta: { political: { category: 'meeting' } },
};

test('new monitored-news posts put one location before a single quote containing the story', () => {
  const post = channelPost(politicalNews);
  const locationIndex = post.indexOf('📍');
  const quoteIndex = post.indexOf('<blockquote>');

  assert.ok(post.startsWith('🟡 <b>تطور سياسي</b>'), 'the existing category headline remains first');
  assert.equal((post.match(/📍/g) || []).length, 1, 'only the primary location is shown');
  assert.ok(locationIndex > 0 && quoteIndex > locationIndex, 'the location precedes the quoted news body');
  assert.equal((post.match(/<blockquote>/g) || []).length, 1, 'lead and useful extra details share one blue quote block');
  assert.match(post.slice(quoteIndex), /^<blockquote>أعلنت الجهات الرسمية اجتماعاً جديداً في دمشق\. وقالت الوزارة إن الاجتماع ينعقد غداً ويشمل عدة ملفات مشتركة\.<\/blockquote>/);
  assert.doesNotMatch(post, /حرستا/, 'additional map locations remain data but are not printed as another channel location');
});

test('format 2 remains unchanged for existing posts; future breaking news uses the same quote layout', () => {
  const legacy = channelPost({ ...politicalNews, channel_format: 2 });
  assert.equal((legacy.match(/📍/g) || []).length, 2, 'legacy posts keep their previous location list when resynced');
  assert.equal((legacy.match(/<blockquote>/g) || []).length, 2, 'legacy posts keep their previous text blocks');

  const breaking = channelPost({
    type: 'breaking', source: 'news', channel_format: 3,
    timestamp: '2026-11-18T17:20:00.000Z',
    description: 'إغلاق طريق حلب الدولي قرب حماة.',
    body: 'إغلاق طريق حلب الدولي قرب حماة.',
    place: { scope: 'place', name_ar: 'حماة', governorate_ar: 'حماة' }, extra: [],
  });
  assert.match(breaking, /<blockquote>إغلاق طريق حلب الدولي قرب حماة\.<\/blockquote>/);
  assert.doesNotMatch(breaking, /<b>إغلاق طريق حلب الدولي قرب حماة\.<\/b>/);
  assert.ok(breaking.indexOf('📍') < breaking.indexOf('<blockquote>'), 'breaking-news body follows its location too');
});

test('format 3 retains the rendered map photo and trims long news to Telegram caption limits', async () => {
  const calls = [];
  const api = {
    async sendPhoto(...args) { calls.push({ method: 'sendPhoto', args }); return { message_id: 811 }; },
    async sendMessage(...args) { calls.push({ method: 'sendMessage', args }); return { message_id: 812 }; },
  };
  const published = await publishInput(api, {
    type: 'attack', source: 'news', timestamp: '2026-11-18T17:20:00.000Z',
    title: 'هجوم مسلح في حماة', description: 'تفاصيل موثقة '.repeat(180), body: '',
    location: { scope: 'place', name_ar: 'حماة', governorate_ar: 'حماة', latitude: 35.13, longitude: 36.75 },
    extra: [], ttlMin: 60,
  }, { renderSnapshot: async () => Buffer.from('local map snapshot') });

  assert.equal(published.channel_format, 3);
  assert.equal(calls[0]?.method, 'sendPhoto', 'the map image is sent before its caption');
  assert.equal(calls.length, 1, 'the test uses a local API mock and sends no second text post');
  const caption = calls[0].args[2].caption;
  const captionLength = caption.replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp|quot|#39);/g, 'x').length;
  assert.ok(captionLength <= 1024, 'the visible caption stays within Telegram\'s 1024-character limit');
  assert.match(caption, /<blockquote>تفاصيل موثقة/);
  assert.equal((caption.match(/<blockquote>/g) || []).length, 1);
  assert.ok(calls[0].args[2].reply_markup.inline_keyboard.length > 0, 'existing footer buttons remain attached');
});
