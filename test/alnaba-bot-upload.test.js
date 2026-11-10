import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-alnaba-bot-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'true';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
process.env.PRIMARY_OWNER_ID = '8808894711';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
process.env.PUBLIC_URL = 'https://example.invalid';
process.env.ALERT_IMAGES = 'false';

const originalFetch = globalThis.fetch;
const photoBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
const photoBytes2 = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x44, 0x00, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
const pdfBytes = Buffer.from('%PDF-1.7\nfixture only\n%%EOF\n');
const fixtureFiles = new Map([
  ['photos/fixture-photo.jpg', photoBytes],
  ['photos/fixture-photo-2.jpg', photoBytes2],
  ['documents/fixture-weekly.pdf', pdfBytes],
]);
globalThis.fetch = async (url) => {
  const match = String(url).match(/\/file\/bot123456:LOCAL_TEST\/(.+)$/);
  assert.ok(match, 'media download must use the isolated Telegram fixture');
  const bytes = fixtureFiles.get(match[1]);
  assert.ok(bytes, `unexpected isolated fixture path: ${match[1]}`);
  return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
};

const { store } = await import('../server/store.js');
await store.init(null);
let failBackup = false;
store.backup = { async save(json) { if (failBackup) throw new Error('fixture backup failure'); this.json = json; } };
store.state.alnaba = { photos: [], weekly: [], archive: [] };
const { createBot } = await import('../server/bot.js');
const bot = createBot({ token: process.env.BOT_TOKEN });
bot.botInfo = { id: 1, is_bot: true, first_name: 'Fixture bot', username: 'FixtureBot' };
const calls = [];
let messageId = 100;
bot.api.config.use(async (_previous, method, payload) => {
  calls.push({ method, payload: structuredClone(payload) });
  if (method === 'getFile') {
    const filePaths = {
      fixture_photo_id: 'photos/fixture-photo.jpg',
      fixture_photo_2_id: 'photos/fixture-photo-2.jpg',
      fixture_pdf_id: 'documents/fixture-weekly.pdf',
    };
    return { ok: true, result: { file_path: filePaths[payload.file_id] } };
  }
  if (method === 'sendMessage' || method === 'editMessageText' || method === 'editMessageCaption') {
    return { ok: true, result: { message_id: ++messageId, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text || payload.caption || '' } };
  }
  return { ok: true, result: true };
});

let updateId = 1;
const user = (id) => ({ id, is_bot: false, first_name: 'Al-Nabaa fixture', language_code: 'ar' });
const sendText = (id, text) => bot.handleUpdate({
  update_id: updateId++,
  message: {
    message_id: ++messageId,
    date: 0,
    chat: { id, type: 'private' },
    from: user(id),
    text,
    ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.length }] } : {}),
  },
});
const tap = (id, data) => bot.handleUpdate({
  update_id: updateId++,
  callback_query: {
    id: `fixture-${updateId}`,
    from: user(id),
    chat_instance: 'fixture',
    data,
    message: { message_id: ++messageId, date: 0, chat: { id, type: 'private' }, from: bot.botInfo, text: 'Fixture screen' },
  },
});
const sendPhoto = (id, n = 1) => {
  const second = n === 2;
  const bytes = second ? photoBytes2 : photoBytes;
  return bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId,
      date: 0,
      chat: { id, type: 'private' },
      from: user(id),
      caption: second ? 'خبر مصور ثانٍ للاختبار' : 'صورة تجريبية للاختبار',
      photo: [{
        file_id: second ? 'fixture_photo_2_id' : 'fixture_photo_id',
        file_unique_id: second ? 'fixture_photo_2_unique' : 'fixture_photo_unique',
        file_size: bytes.length,
      }],
    },
  });
};
const lastUiFor = (id) => [...calls].reverse().find(({ method, payload }) => method === 'sendMessage' && payload.chat_id === id);
const lastEditFor = (id) => [...calls].reverse().find(({ method, payload }) => method === 'editMessageText' && payload.chat_id === id);
const buttonsOf = (entry) => entry?.payload?.reply_markup?.inline_keyboard?.flat() || [];

after(() => {
  globalThis.fetch = originalFetch;
  clearTimeout(store._saveTimer);
  clearTimeout(store._backupTimer);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the bot offers Al-Nabaa only to the confirmed owner 8270709633 and publishes only after confirmation', async () => {
  const authorizedId = 8270709633;
  const deniedId = 8808894711;

  await sendText(deniedId, '/alnaba');
  assert.match(lastUiFor(deniedId)?.payload?.text || '', /غير متاحة/);
  assert.equal(buttonsOf(lastUiFor(deniedId)).some((button) => button.callback_data === 'nb:photos'), false);

  await sendText(authorizedId, '/alnaba');
  const menu = lastUiFor(authorizedId);
  assert.match(menu.payload.text, /نشر محتوى النبأ/);
  assert.ok(buttonsOf(menu).some((button) => button.callback_data === 'nb:photos'));
  assert.ok(buttonsOf(menu).some((button) => button.callback_data === 'nb:weekly'));
  assert.ok(buttonsOf(menu).some((button) => button.callback_data === 'nb:archive'));

  await tap(deniedId, 'nb:photos');
  assert.equal(buttonsOf(lastUiFor(deniedId)).some((button) => button.callback_data === 'nb:publish'), false);
  await tap(deniedId, 'nb:archive');
  assert.equal(calls.some(({ method, payload }) => method === 'editMessageText' && payload.chat_id === deniedId && payload.text.includes('🔗 <b>الأرشيف</b>')), false);

  await tap(authorizedId, 'nb:photos');
  assert.ok(calls.some(({ method, payload }) => method === 'editMessageText' && payload.text.includes('أخبار مصوّرة')));
  await sendPhoto(authorizedId);
  const preview = lastUiFor(authorizedId);
  assert.match(preview.payload.text, /راجع الملف قبل نشره/);
  assert.ok(buttonsOf(preview).some((button) => button.callback_data === 'nb:publish'));
  assert.equal(store.state.alnaba.photos.length, 0, 'receiving the file alone must not publish it');

  await sendText(authorizedId, '/menu');
  await sendText(authorizedId, '/alnaba');
  await tap(authorizedId, 'nb:photos');
  await sendPhoto(authorizedId);
  assert.ok(buttonsOf(lastUiFor(authorizedId)).some((button) => button.callback_data === 'nb:publish'), 'a discarded preview must not block a fresh upload');
  assert.equal(store.state.alnaba.photos.length, 0);
  await tap(authorizedId, 'nb:publish');
  assert.equal(store.state.alnaba.photos.length, 1);
  assert.equal(store.state.alnaba.photos[0].title, 'صورة تجريبية للاختبار');
  assert.ok(JSON.parse(store.backup.json).alnaba.photos.some((item) => item.file_id === 'fixture_photo_id'));
  assert.ok(calls.some(({ method, payload }) => method === 'sendMessage' && payload.text.includes('تم النشر')));
  const firstSuccess = lastUiFor(authorizedId);
  const addPhoto = buttonsOf(firstSuccess).find((button) => button.callback_data === 'nb:photos');
  assert.equal(addPhoto?.text, '➕ إضافة خبر جديد');
  await tap(authorizedId, addPhoto.callback_data);
  assert.match(lastEditFor(authorizedId)?.payload?.text || '', /أخبار مصوّرة/);
  assert.equal(store.state.alnaba.photos.length, 1, 'starting another upload must not publish the previous item again');

  await sendPhoto(authorizedId, 2);
  const secondPreview = lastUiFor(authorizedId);
  assert.ok(buttonsOf(secondPreview).some((button) => button.callback_data === 'nb:publish'));
  assert.equal(store.state.alnaba.photos.length, 1, 'the next photo remains private until confirmed');
  await tap(authorizedId, 'nb:publish');
  assert.equal(store.state.alnaba.photos.length, 2);
  assert.deepEqual(store.state.alnaba.photos.map((item) => item.title), ['خبر مصور ثانٍ للاختبار', 'صورة تجريبية للاختبار']);
  assert.equal(new Set(store.state.alnaba.photos.map((item) => item.file_unique_id)).size, 2, 'each distinct upload is published exactly once');
  assert.ok(JSON.parse(store.backup.json).alnaba.photos.some((item) => item.file_id === 'fixture_photo_2_id'));

  await sendText(authorizedId, '/alnaba');
  await tap(authorizedId, 'nb:weekly');
  await bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId, date: 0,
      chat: { id: authorizedId, type: 'private' }, from: user(authorizedId),
      caption: 'العدد الأسبوعي التجريبي',
      document: { file_id: 'fixture_pdf_id', file_unique_id: 'fixture_pdf_unique', file_name: 'fixture-weekly.pdf', mime_type: 'application/pdf', file_size: pdfBytes.length },
    },
  });
  assert.equal(store.state.alnaba.weekly.length, 0, 'the PDF is private until confirmed');
  assert.ok(buttonsOf(lastUiFor(authorizedId)).some((button) => button.callback_data === 'nb:publish'));
  await tap(authorizedId, 'nb:publish');
  assert.equal(store.state.alnaba.weekly.length, 1);
  assert.equal(store.state.alnaba.weekly[0].title, 'العدد الأسبوعي التجريبي');
  assert.ok(JSON.parse(store.backup.json).alnaba.weekly.some((item) => item.file_id === 'fixture_pdf_id'));
  const weeklySuccess = lastUiFor(authorizedId);
  const addWeekly = buttonsOf(weeklySuccess).find((button) => button.callback_data === 'nb:weekly');
  assert.equal(addWeekly?.text, '➕ إضافة خبر جديد');
  await tap(authorizedId, addWeekly.callback_data);
  assert.match(lastEditFor(authorizedId)?.payload?.text || '', /الصحيفة الأسبوعية/);
  assert.equal(store.state.alnaba.weekly.length, 1, 'starting the next PDF upload does not republish the previous issue');

  await sendText(authorizedId, '/alnaba');
  await tap(authorizedId, 'nb:archive');
  assert.match(lastEditFor(authorizedId)?.payload?.text || '', /الأرشيف/);
  await sendText(authorizedId, 'قناة اختبارية\nhttps://example.invalid/not-telegram');
  assert.match(lastUiFor(authorizedId)?.payload?.text || '', /رابط Telegram صالح/);
  assert.equal(store.state.alnaba.archive.length, 0, 'invalid links never enter the archive');

  await sendText(authorizedId, 'قناة اختبارية\nhttps://t.me/ras_mock_archive_channel_01');
  const archivePreview = lastUiFor(authorizedId);
  assert.match(archivePreview.payload.text, /راجع مدخل الأرشيف/);
  assert.match(archivePreview.payload.text, /https:\/\/t\.me\/ras_mock_archive_channel_01/);
  assert.ok(buttonsOf(archivePreview).some((button) => button.callback_data === 'nb:publish'));
  assert.equal(store.state.alnaba.archive.length, 0, 'archive entries stay private until explicit confirmation');
  await tap(authorizedId, 'nb:publish');
  assert.equal(store.state.alnaba.archive.length, 1);
  assert.equal(store.state.alnaba.archive[0].title, 'قناة اختبارية');
  assert.ok(JSON.parse(store.backup.json).alnaba.archive.some((entry) => entry.url === 'https://t.me/ras_mock_archive_channel_01'));
  const archiveSuccess = lastUiFor(authorizedId);
  const addAnotherLink = buttonsOf(archiveSuccess).find((button) => button.callback_data === 'nb:archive');
  assert.equal(addAnotherLink?.text, '➕ إضافة رابط آخر');
  await tap(authorizedId, addAnotherLink.callback_data);
  assert.match(lastEditFor(authorizedId)?.payload?.text || '', /سطرين/);
  assert.equal(store.state.alnaba.archive.length, 1, 'opening the next archive form does not duplicate the previous entry');
  await sendText(authorizedId, 'مجموعة اختبارية\nhttps://telegram.me/ras_mock_archive_group_02/');
  assert.equal(store.state.alnaba.archive.length, 1, 'the second mock link remains private while awaiting confirmation');
  await tap(authorizedId, 'nb:publish');
  assert.equal(store.state.alnaba.archive.length, 2);
  assert.deepEqual(store.state.alnaba.archive.map((entry) => entry.url), [
    'https://t.me/ras_mock_archive_group_02',
    'https://t.me/ras_mock_archive_channel_01',
  ]);
  assert.ok(JSON.parse(store.backup.json).alnaba.archive.some((entry) => entry.title === 'مجموعة اختبارية'));
  await tap(authorizedId, 'nb:archive');
  await sendText(authorizedId, 'رابط ملغى\nhttps://t.me/ras_mock_archive_cancel_03');
  assert.equal(store.state.alnaba.archive.length, 2, 'a mock entry is not public before confirmation');
  await tap(authorizedId, 'nb:cancel');
  assert.equal(store.state.alnaba.archive.length, 2, 'cancelling the preview does not create an archive entry');

  await tap(authorizedId, 'nb:archive');
  await sendText(authorizedId, 'رابط إعادة المحاولة\nhttps://t.me/ras_mock_archive_retry_04');
  const backupBeforeFailure = store.backup.json;
  failBackup = true;
  await tap(authorizedId, 'nb:publish');
  assert.equal(store.state.alnaba.archive.length, 2, 'a failed durable backup rolls back the in-memory archive write');
  assert.equal(store.backup.json, backupBeforeFailure, 'a failed backup does not replace the last durable snapshot');
  assert.match([...calls].reverse().find(({ method }) => method === 'answerCallbackQuery')?.payload?.text || '', /نسخة احتياطية/);
  failBackup = false;
  await tap(authorizedId, 'nb:publish');
  assert.equal(store.state.alnaba.archive.length, 3, 'the owner can retry the still-pending preview after backup recovers');
  assert.ok(JSON.parse(store.backup.json).alnaba.archive.some((entry) => entry.title === 'رابط إعادة المحاولة'));
  assert.equal(calls.some(({ method, payload }) => ['sendPhoto', 'sendDocument'].includes(method) && payload.chat_id === '@mock_news_channel'), false,
    'Al-Nabaa uploads do not auto-post files to the Telegram channel');
});
