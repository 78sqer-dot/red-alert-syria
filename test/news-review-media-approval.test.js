import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-review-media-approval-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
process.env.PUBLIC_URL = 'https://example.invalid';
process.env.ALERT_IMAGES = 'false';

const { store, publicAlert } = await import('../server/store.js');
await store.init(null);
const { toBotDraft, deliverCapturedMediaToReviewer } = await import('../server/news-monitor.js');
const { createBot, fetchAlertMediaFile, publishDraft } = await import('../server/bot.js');

const reviewer = { id: 8270709633, name: 'Test reviewer' };
const posted = [];
const reviewBot = createBot({ token: process.env.BOT_TOKEN });
reviewBot.api.config.use(async (prev, method, payload, signal) => method === 'getFile'
  ? { ok: true, result: { file_path: 'fixture/reviewed-media.bin', file_size: 1024 } }
  : prev(method, payload, signal));
const api = {
  async sendMessage(chatId, text, payload) {
    posted.push({ method: 'sendMessage', chatId, text, payload });
    return { message_id: 9001 };
  },
  async sendPhoto(chatId, photo) { posted.push({ method: 'sendPhoto', chatId, photo }); return { message_id: 9002 }; },
  async sendVideo(chatId, video) { posted.push({ method: 'sendVideo', chatId, video }); return { message_id: 9003 }; },
};

for (const fixture of [
  { type: 'photo', mimeType: 'image/jpeg', telegram: { photo: [{ file_id: 'review-photo-file-id', file_unique_id: 'review-photo-unique', file_size: 4096 }] } },
  { type: 'video', mimeType: 'video/mp4', telegram: { video: { file_id: 'review-video-file-id', file_unique_id: 'review-video-unique', mime_type: 'video/mp4', file_size: 8192 } } },
]) {
  test(`approved ${fixture.type} from the private review attachment reaches map media only`, async () => {
    const reviewerCalls = [];
    const fileId = fixture.type === 'photo' ? fixture.telegram.photo[0].file_id : fixture.telegram.video.file_id;
    const uniqueId = fixture.type === 'photo' ? fixture.telegram.photo[0].file_unique_id : fixture.telegram.video.file_unique_id;
    const rawBytes = Buffer.from(`fixture-original-${fixture.type}-media`);
    const mediaPath = path.join(dataDir, `source-${fixture.type}.${fixture.type === 'photo' ? 'jpg' : 'mp4'}`);
    fs.writeFileSync(mediaPath, rawBytes);
    const sourceMedia = { type: fixture.type, mimeType: fixture.mimeType, size: rawBytes.length, status: 'captured', path: mediaPath, channel: 'fixture-source', messageId: '11' };
    const draft = {
      id: `fixture-${fixture.type}`,
      type: 'breaking',
      headline: `خبر تجريبي مع ${fixture.type === 'photo' ? 'صورة' : 'فيديو'}`,
      loc: { scope: 'country', name_ar: 'سوريا', name_en: 'Syria' },
      extra: [],
      created: Date.now(),
      sourceMedia: [sourceMedia],
    };
    const reviewerApi = {
      async sendPhoto(chatId, input, options) {
        reviewerCalls.push({ type: 'photo', chatId, options });
        return { message_id: 9010, photo: [{ file_id: fileId, file_unique_id: uniqueId, file_size: rawBytes.length }] };
      },
      async sendVideo(chatId, input, options) {
        reviewerCalls.push({ type: 'video', chatId, options });
        return { message_id: 9020, video: { file_id: fileId, file_unique_id: uniqueId, mime_type: fixture.mimeType, file_size: rawBytes.length } };
      },
    };
    const reviewedMessage = await deliverCapturedMediaToReviewer(draft, sourceMedia, reviewer.id, reviewerApi);
    assert.ok(reviewedMessage, 'the source file is sent to the private reviewer first');
    assert.deepEqual(reviewerCalls.map((call) => call.type), [fixture.type]);
    assert.match(reviewerCalls[0].options.caption, /Review only|مرفق للمراجعة فقط/);
    assert.equal(sourceMedia.publishedMedia.bot_role, 'admin');
    const alert = await publishDraft(api, toBotDraft(draft), reviewer);
    assert.equal(alert.media_items[0].type, fixture.type);
    assert.equal(alert.media_items[0].file_id, fixture.telegram[fixture.type]?.at?.(-1)?.file_id || fixture.telegram[fixture.type]?.file_id);
    const projected = publicAlert(alert);
    assert.equal(projected.media_items[0].type, fixture.type);
    assert.equal(projected.media_items[0].mime_type, fixture.mimeType);
    assert.equal(JSON.stringify(projected).includes('file-id'), false, 'the public map response never exposes Telegram file IDs');
    assert.ok(posted.every((call) => call.method === 'sendMessage'), 'the approved alert posts the normal text only; captured source media is never sent to the public channel');
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(rawBytes, { status: 200, headers: { 'content-length': String(rawBytes.length) } });
    try {
      const mapAsset = await fetchAlertMediaFile(alert.id, fixture.type);
      assert.equal(mapAsset.contentType, fixture.mimeType);
      assert.deepEqual(mapAsset.buffer, rawBytes, 'the map proxy returns the reviewed source bytes without alteration');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
}
