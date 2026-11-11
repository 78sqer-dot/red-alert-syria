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
const photoBytes3 = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x45, 0x00, 0x0c, 0x0d, 0x0e, 0x0f, 0x10]);
const pdfBytes = Buffer.from('%PDF-1.7\nfixture only\n%%EOF\n');
const pdfBytes2 = Buffer.from('%PDF-1.7\nreplacement fixture only\n%%EOF\n');
const oggBytes = Buffer.from('OggSfixture-quran-audio');
const mp4Bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(8)]);
const fixtureFiles = new Map([
  ['photos/fixture-photo.jpg', photoBytes],
  ['photos/fixture-photo-2.jpg', photoBytes2],
  ['photos/fixture-photo-3.jpg', photoBytes3],
  ['documents/fixture-weekly.pdf', pdfBytes],
  ['documents/fixture-weekly-2.pdf', pdfBytes2],
  ['audio/quran.ogg', oggBytes],
  ['video/nasheed.mp4', mp4Bytes],
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
      fixture_photo_3_id: 'photos/fixture-photo-3.jpg',
      fixture_pdf_id: 'documents/fixture-weekly.pdf',
      fixture_pdf_2_id: 'documents/fixture-weekly-2.pdf',
      fixture_quran_audio_id: 'audio/quran.ogg',
      fixture_nasheed_video_id: 'video/nasheed.mp4',
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
  const third = n === 3;
  const bytes = second ? photoBytes2 : third ? photoBytes3 : photoBytes;
  const title = second ? 'خبر مصور ثانٍ للاختبار' : third ? 'صورة بديلة للاختبار' : 'صورة تجريبية للاختبار';
  const fileId = second ? 'fixture_photo_2_id' : third ? 'fixture_photo_3_id' : 'fixture_photo_id';
  const uniqueId = second ? 'fixture_photo_2_unique' : third ? 'fixture_photo_3_unique' : 'fixture_photo_unique';
  return bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId,
      date: 0,
      chat: { id, type: 'private' },
      from: user(id),
      caption: title,
      photo: [{
        file_id: fileId,
        file_unique_id: uniqueId,
        file_size: bytes.length,
      }],
    },
  });
};
const sendPdf = (id, n = 1) => {
  const replacement = n === 2;
  return bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId, date: 0,
      chat: { id, type: 'private' }, from: user(id),
      caption: replacement ? 'ملف بديل للاختبار' : '1\nالعدد الأسبوعي التجريبي',
      document: {
        file_id: replacement ? 'fixture_pdf_2_id' : 'fixture_pdf_id',
        file_unique_id: replacement ? 'fixture_pdf_2_unique' : 'fixture_pdf_unique',
        file_name: replacement ? 'fixture-weekly-2.pdf' : 'fixture-weekly.pdf',
        mime_type: 'application/pdf',
        file_size: replacement ? pdfBytes2.length : pdfBytes.length,
      },
    },
  });
};
const sendAudio = (id) => bot.handleUpdate({
  update_id: updateId++,
  message: {
    message_id: ++messageId, date: 0,
    chat: { id, type: 'private' }, from: user(id),
    caption: 'تلاوة تجريبية\nسورة البقرة',
    audio: { file_id: 'fixture_quran_audio_id', file_unique_id: 'fixture_quran_audio_unique', file_name: 'quran.ogg', mime_type: 'audio/ogg', file_size: oggBytes.length },
  },
});
  const sendVideo = (id) => bot.handleUpdate({
    update_id: updateId++,
    message: {
    message_id: ++messageId, date: 0,
    chat: { id, type: 'private' }, from: user(id),
    caption: 'نشيد تجريبي\nوصف النشيد',
    video: { file_id: 'fixture_nasheed_video_id', file_unique_id: 'fixture_nasheed_video_unique', file_name: 'nasheed.mp4', mime_type: 'video/mp4', file_size: mp4Bytes.length },
    },
  });
  const forwardedFrom = (title) => ({
    type: 'channel', date: 0, chat: { id: -1001234567890, title }, message_id: 77,
  });
  const sendForwardedPhoto = (id) => bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId, date: 0,
      chat: { id, type: 'private' }, from: user(id),
      forward_origin: forwardedFrom('أخبار سوريا'),
      caption: 'خبر مصوّر معاد توجيهه للاختبار',
      photo: [{ file_id: 'fixture_photo_3_id', file_unique_id: 'fixture_photo_3_unique', file_size: photoBytes3.length }],
    },
  });
  const sendForwardedPdf = (id) => bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId, date: 0,
      chat: { id, type: 'private' }, from: user(id),
      forward_origin: forwardedFrom('صحيفة أسبوعية'),
      caption: '2\nعدد معاد توجيهه للاختبار',
      document: { file_id: 'fixture_pdf_id', file_unique_id: 'fixture_pdf_unique', file_name: '2-forwarded.pdf', mime_type: 'application/pdf', file_size: pdfBytes.length },
    },
  });
  const sendForwardedPdfMissingNumber = (id) => bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId, date: 0,
      chat: { id, type: 'private' }, from: user(id),
      forward_origin: forwardedFrom('صحيفة أسبوعية'),
      document: { file_id: 'fixture_pdf_2_id', file_unique_id: 'fixture_pdf_2_unique', file_name: 'weekly.pdf', mime_type: 'application/pdf', file_size: pdfBytes2.length },
    },
  });
  const sendForwardedAudio = (id) => bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId, date: 0,
      chat: { id, type: 'private' }, from: user(id),
      forward_origin: forwardedFrom('قناة القرآن الكريم'),
      caption: 'تلاوة معاد توجيهها للاختبار\nسورة البقرة',
      audio: { file_id: 'fixture_quran_audio_id', file_unique_id: 'fixture_quran_audio_unique', file_name: 'quran.ogg', mime_type: 'audio/ogg', file_size: oggBytes.length },
    },
  });
  const sendForwardedVoiceMissingTitle = (id) => bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId, date: 0,
      chat: { id, type: 'private' }, from: user(id),
      forward_origin: forwardedFrom('قناة القرآن الكريم'),
      voice: { file_id: 'fixture_quran_audio_id', file_unique_id: 'fixture_quran_voice_unique', mime_type: 'audio/ogg', file_size: oggBytes.length },
    },
  });
  const sendForwardedVideo = (id) => bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId, date: 0,
      chat: { id, type: 'private' }, from: user(id),
      forward_origin: forwardedFrom('أناشيد'),
      caption: 'نشيد معاد توجيهه للاختبار\nوصف النشيد المعاد توجيهه',
      video: { file_id: 'fixture_nasheed_video_id', file_unique_id: 'fixture_nasheed_video_unique', file_name: 'nasheed.mp4', mime_type: 'video/mp4', file_size: mp4Bytes.length },
    },
  });
  const sendAmbiguousForwardAudio = (id) => bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId, date: 0,
      chat: { id, type: 'private' }, from: user(id),
      forward_origin: forwardedFrom('قناة عامة'),
      caption: 'عنوان صوتي للاختبار\nوصف صوتي للاختبار',
      audio: { file_id: 'fixture_quran_audio_id', file_unique_id: 'fixture_quran_audio_unique', file_name: 'recording.ogg', mime_type: 'audio/ogg', file_size: oggBytes.length },
    },
  });
  const lastUiFor = (id) => [...calls].reverse().find(({ method, payload }) => method === 'sendMessage' && payload.chat_id === id);
const lastEditFor = (id) => [...calls].reverse().find(({ method, payload }) => method === 'editMessageText' && payload.chat_id === id);
const buttonsOf = (entry) => entry?.payload?.reply_markup?.inline_keyboard?.flat() || [];
const callbackData = (entry, prefix) => buttonsOf(entry).find((button) => button.callback_data.startsWith(prefix))?.callback_data;

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
  assert.ok(buttonsOf(menu).some((button) => button.callback_data === 'nb:quran'));
  assert.ok(buttonsOf(menu).some((button) => button.callback_data === 'nb:nasheed'));
  assert.ok(buttonsOf(menu).some((button) => button.callback_data === 'nb:archive'));
  assert.ok(buttonsOf(menu).some((button) => button.callback_data === 'nb:home'));

  await tap(deniedId, 'nb:photos');
  assert.equal(buttonsOf(lastUiFor(deniedId)).some((button) => button.callback_data === 'nb:publish'), false);
  await tap(deniedId, 'nb:quran');
  assert.equal(calls.some(({ method, payload }) => method === 'editMessageText' && payload.chat_id === deniedId && payload.text.includes('القرآن الكريم')), false);
  await tap(deniedId, 'nb:nasheed');
  assert.equal(calls.some(({ method, payload }) => method === 'editMessageText' && payload.chat_id === deniedId && payload.text.includes('الأناشيد')), false);
  await tap(deniedId, 'nb:archive');
  assert.equal(calls.some(({ method, payload }) => method === 'editMessageText' && payload.chat_id === deniedId && payload.text.includes('🔗 <b>الأرشيف</b>')), false);
  await tap(deniedId, 'nb:manage:archive');
  assert.equal(calls.some(({ method, payload }) => method === 'editMessageText' && payload.chat_id === deniedId && payload.text.includes('إدارة الأرشيف')), false,
    'a non-owner cannot open the private archive management controls');

  await tap(authorizedId, 'nb:photos');
  assert.ok(calls.some(({ method, payload }) => method === 'editMessageText' && payload.text.includes('أخبار مصوّرة')));
  const photosPrompt = lastEditFor(authorizedId);
  assert.ok(buttonsOf(photosPrompt).some((button) => button.callback_data === 'nb:manage:photos'));
  assert.ok(buttonsOf(photosPrompt).some((button) => button.callback_data === 'nb:home'));
  await tap(authorizedId, 'nb:home');
  const returnedMainMenu = lastEditFor(authorizedId);
  assert.ok(returnedMainMenu);
  assert.doesNotMatch(returnedMainMenu.payload.text, /نشر محتوى النبأ/);
  assert.ok(buttonsOf(returnedMainMenu).some((button) => button.callback_data === 'nb:open'));
  assert.equal(buttonsOf(returnedMainMenu).some((button) => button.callback_data === 'nb:home' || button.callback_data === 'nb:photos'), false);
  await sendText(authorizedId, '/alnaba');
  await tap(authorizedId, 'nb:photos');
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
  assert.ok(buttonsOf(firstSuccess).some((button) => button.callback_data === 'nb:home'));
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
  assert.deepEqual(store.state.alnaba.photos.map((item) => item.title), ['صورة تجريبية للاختبار', 'خبر مصور ثانٍ للاختبار']);
  assert.equal(new Set(store.state.alnaba.photos.map((item) => item.file_unique_id)).size, 2, 'each distinct upload is published exactly once');
  assert.ok(JSON.parse(store.backup.json).alnaba.photos.some((item) => item.file_id === 'fixture_photo_2_id'));

  await sendText(authorizedId, '/alnaba');
  await tap(authorizedId, 'nb:weekly');
  const weeklyPrompt = lastEditFor(authorizedId);
  assert.ok(buttonsOf(weeklyPrompt).some((button) => button.callback_data === 'nb:manage:weekly'));
  assert.ok(buttonsOf(weeklyPrompt).some((button) => button.callback_data === 'nb:home'));
  await bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId, date: 0,
      chat: { id: authorizedId, type: 'private' }, from: user(authorizedId),
      caption: '1\nالعدد الأسبوعي التجريبي',
      document: { file_id: 'fixture_pdf_id', file_unique_id: 'fixture_pdf_unique', file_name: 'fixture-weekly.pdf', mime_type: 'application/pdf', file_size: pdfBytes.length },
    },
  });
  assert.equal(store.state.alnaba.weekly.length, 0, 'the PDF is private until confirmed');
  assert.ok(buttonsOf(lastUiFor(authorizedId)).some((button) => button.callback_data === 'nb:publish'));
  await tap(authorizedId, 'nb:publish');
  assert.equal(store.state.alnaba.weekly.length, 1);
  assert.equal(store.state.alnaba.weekly[0].title, 'العدد الأسبوعي التجريبي');
  assert.equal(store.state.alnaba.weekly[0].issue_number, 1);
  assert.ok(JSON.parse(store.backup.json).alnaba.weekly.some((item) => item.file_id === 'fixture_pdf_id'));
  assert.ok(JSON.parse(store.backup.json).alnaba.weekly.some((item) => item.issue_number === 1));
  const weeklySuccess = lastUiFor(authorizedId);
  assert.ok(buttonsOf(weeklySuccess).some((button) => button.callback_data === 'nb:home'));
  const addWeekly = buttonsOf(weeklySuccess).find((button) => button.callback_data === 'nb:weekly');
  assert.equal(addWeekly?.text, '➕ إضافة محتوى');
  await tap(authorizedId, addWeekly.callback_data);
  assert.match(lastEditFor(authorizedId)?.payload?.text || '', /الصحيفة الأسبوعية/);
  assert.equal(store.state.alnaba.weekly.length, 1, 'starting the next PDF upload does not republish the previous issue');

  await sendText(authorizedId, '/alnaba');
  await tap(authorizedId, 'nb:quran');
  assert.match(lastEditFor(authorizedId)?.payload?.text || '', /القرآن الكريم/);
  await sendAudio(authorizedId);
  const quranPreview = lastUiFor(authorizedId);
  assert.match(quranPreview.payload.text, /تلاوة تجريبية/);
  assert.match(quranPreview.payload.text, /سورة البقرة/);
  assert.equal(store.state.alnaba.quran.length, 0, 'audio stays private until owner confirmation');
  assert.ok(buttonsOf(quranPreview).some((button) => button.callback_data === 'nb:publish'));
  await tap(authorizedId, 'nb:cancel');
  assert.equal(store.state.alnaba.quran.length, 0, 'cancelled audio is never published');
  await sendText(authorizedId, '/alnaba');
  await tap(authorizedId, 'nb:quran');
  await sendAudio(authorizedId);
  await tap(authorizedId, 'nb:publish');
  assert.equal(store.state.alnaba.quran.length, 1);
  assert.equal(store.state.alnaba.quran[0].mime_type, 'audio/ogg');
  assert.equal(store.state.alnaba.quran[0].description, 'سورة البقرة');
  assert.ok(JSON.parse(store.backup.json).alnaba.quran.some((item) => item.title === 'تلاوة تجريبية' && item.description === 'سورة البقرة'));
  const addQuran = buttonsOf(lastUiFor(authorizedId)).find((button) => button.callback_data === 'nb:quran');
  assert.equal(addQuran?.text, '➕ إضافة محتوى');

  await sendText(authorizedId, '/alnaba');
  await tap(authorizedId, 'nb:nasheed');
  await sendVideo(authorizedId);
  assert.equal(store.state.alnaba.nasheed.length, 0, 'video remains private while its preview awaits confirmation');
  assert.match(lastUiFor(authorizedId).payload.text, /وصف النشيد/);
  await tap(authorizedId, 'nb:publish');
  assert.equal(store.state.alnaba.nasheed.length, 1);
  assert.equal(store.state.alnaba.nasheed[0].mime_type, 'video/mp4');
  assert.equal(store.state.alnaba.nasheed[0].description, 'وصف النشيد');
  assert.ok(JSON.parse(store.backup.json).alnaba.nasheed.some((item) => item.file_id === 'fixture_nasheed_video_id'));

  await sendText(authorizedId, '/alnaba');
  await tap(authorizedId, 'nb:archive');
  const archivePrompt = lastEditFor(authorizedId);
  assert.match(archivePrompt?.payload?.text || '', /الأرشيف/);
  assert.ok(buttonsOf(archivePrompt).some((button) => button.callback_data === 'nb:manage:archive'));
  assert.ok(buttonsOf(archivePrompt).some((button) => button.callback_data === 'nb:home'));
  await sendText(authorizedId, 'قناة اختبارية\nhttps://example.invalid/not-telegram');
  assert.match(lastUiFor(authorizedId)?.payload?.text || '', /رابط Telegram صالح/);
  assert.equal(store.state.alnaba.archive.length, 0, 'invalid links never enter the archive');

  await sendText(authorizedId, 'قناة اختبارية\nhttps://t.me/ras_mock_archive_channel_01');
  const archivePreview = lastUiFor(authorizedId);
  assert.match(archivePreview.payload.text, /راجع مدخل الأرشيف/);
  assert.match(archivePreview.payload.text, /https:\/\/t\.me\/ras_mock_archive_channel_01/);
  assert.ok(buttonsOf(archivePreview).some((button) => button.callback_data === 'nb:publish'));
  assert.ok(buttonsOf(archivePreview).some((button) => button.callback_data === 'nb:home'));
  assert.equal(store.state.alnaba.archive.length, 0, 'archive entries stay private until explicit confirmation');
  await tap(authorizedId, 'nb:publish');
  assert.equal(store.state.alnaba.archive.length, 1);
  assert.equal(store.state.alnaba.archive[0].title, 'قناة اختبارية');
  assert.ok(JSON.parse(store.backup.json).alnaba.archive.some((entry) => entry.url === 'https://t.me/ras_mock_archive_channel_01'));
  const archiveSuccess = lastUiFor(authorizedId);
  assert.ok(buttonsOf(archiveSuccess).some((button) => button.callback_data === 'nb:home'));
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

  const openManagement = async (section) => {
    await sendText(authorizedId, '/alnaba');
    await tap(authorizedId, `nb:${section}`);
    const sectionPrompt = lastEditFor(authorizedId);
    assert.ok(buttonsOf(sectionPrompt).some((button) => button.callback_data === `nb:manage:${section}`));
    assert.ok(buttonsOf(sectionPrompt).some((button) => button.callback_data === 'nb:home'));
    await tap(authorizedId, `nb:manage:${section}`);
    const list = lastEditFor(authorizedId);
    assert.match(list?.payload?.text || '', /إدارة/);
    assert.ok(buttonsOf(list).some((button) => button.callback_data === 'nb:home'));
    return list;
  };
  const itemButton = (section, id, list) => buttonsOf(list).find((button) => button.callback_data.startsWith(`nb:item:${section}:${id}:`));

  for (const section of ['quran', 'nasheed']) {
    const libraryList = await openManagement(section);
    const libraryItem = store.state.alnaba[section][0];
    assert.ok(itemButton(section, libraryItem.id, libraryList), `${section} appears in the owner's private management list`);
  }

  // Edit a photo-news title, then explicitly approve a replacement image.
  const managedPhoto = store.state.alnaba.photos.find((item) => item.title === 'صورة تجريبية للاختبار');
  let managementList = await openManagement('photos');
  const photoButton = itemButton('photos', managedPhoto.id, managementList);
  assert.ok(photoButton, 'the private photo-news list exposes the existing mock entry');
  await tap(authorizedId, photoButton.callback_data);
  const photoControls = lastEditFor(authorizedId);
  assert.ok(buttonsOf(photoControls).some((button) => button.callback_data === 'nb:home'));
  const editPhotoTitle = buttonsOf(photoControls).find((button) => button.callback_data.startsWith('nb:edit-title:photos:'));
  await tap(authorizedId, editPhotoTitle.callback_data);
  await sendText(authorizedId, 'عنوان صورة معدّل للاختبار');
  assert.equal(store.state.alnaba.photos.find((item) => item.id === managedPhoto.id).title, 'صورة تجريبية للاختبار', 'title edits stay private until save');
  const staleEditToken = callbackData(lastUiFor(authorizedId), 'nb:edit-save:');
  assert.ok(staleEditToken);
  await sendText(authorizedId, '/alnaba'); // invalidate the old preview without changing the entry
  assert.equal(store.state.alnaba.photos.find((item) => item.id === managedPhoto.id).title, 'صورة تجريبية للاختبار');
  managementList = await openManagement('photos');
  await tap(authorizedId, itemButton('photos', managedPhoto.id, managementList).callback_data);
  await tap(authorizedId, buttonsOf(lastEditFor(authorizedId)).find((button) => button.callback_data.startsWith('nb:edit-title:photos:')).callback_data);
  await sendText(authorizedId, 'عنوان صورة معدّل للاختبار');
  const currentEditToken = callbackData(lastUiFor(authorizedId), 'nb:edit-save:');
  assert.ok(currentEditToken && currentEditToken !== staleEditToken);
  await tap(authorizedId, staleEditToken);
  assert.equal(store.state.alnaba.photos.find((item) => item.id === managedPhoto.id).title, 'صورة تجريبية للاختبار', 'a stale button cannot save or clear a newer edit');
  await Promise.all([tap(authorizedId, currentEditToken), tap(authorizedId, currentEditToken)]);
  assert.equal(store.state.alnaba.photos.find((item) => item.id === managedPhoto.id).title, 'عنوان صورة معدّل للاختبار');
  assert.ok(JSON.parse(store.backup.json).alnaba.photos.some((item) => item.id === managedPhoto.id && item.title === 'عنوان صورة معدّل للاختبار'));

  managementList = await openManagement('photos');
  await tap(authorizedId, itemButton('photos', managedPhoto.id, managementList).callback_data);
  const replacePhoto = buttonsOf(lastEditFor(authorizedId)).find((button) => button.callback_data.startsWith('nb:replace:photos:'));
  await tap(authorizedId, replacePhoto.callback_data);
  await sendPhoto(authorizedId, 3);
  assert.equal(store.state.alnaba.photos.find((item) => item.id === managedPhoto.id).file_id, 'fixture_photo_id', 'replacement image stays private until save');
  await tap(authorizedId, callbackData(lastUiFor(authorizedId), 'nb:edit-save:'));
  assert.equal(store.state.alnaba.photos.find((item) => item.id === managedPhoto.id).file_id, 'fixture_photo_3_id');
  assert.equal(store.state.alnaba.photos.find((item) => item.id === managedPhoto.id).title, 'عنوان صورة معدّل للاختبار');

  // A delete button only opens a confirmation screen; cancellation keeps the entry.
  managementList = await openManagement('photos');
  await tap(authorizedId, itemButton('photos', managedPhoto.id, managementList).callback_data);
  let deleteButton = buttonsOf(lastEditFor(authorizedId)).find((button) => button.callback_data.startsWith('nb:delete:photos:'));
  await tap(authorizedId, deleteButton.callback_data);
  assert.equal(store.state.alnaba.photos.length, 2, 'opening a delete prompt does not delete anything');
  const staleDeleteToken = callbackData(lastEditFor(authorizedId), 'nb:delete-confirm:');
  await tap(authorizedId, callbackData(lastEditFor(authorizedId), 'nb:delete-cancel:'));
  assert.equal(store.state.alnaba.photos.length, 2, 'cancelling deletion preserves the item');
  await tap(authorizedId, buttonsOf(lastEditFor(authorizedId)).find((button) => button.callback_data.startsWith('nb:delete:photos:')).callback_data);
  const currentDeleteToken = callbackData(lastEditFor(authorizedId), 'nb:delete-confirm:');
  assert.notEqual(currentDeleteToken, staleDeleteToken);
  await tap(authorizedId, staleDeleteToken);
  assert.equal(store.state.alnaba.photos.length, 2, 'a stale delete button cannot act on the current prompt');
  await tap(authorizedId, currentDeleteToken);
  assert.equal(store.state.alnaba.photos.length, 1, 'the photo is removed only after the second confirmation');
  assert.equal(JSON.parse(store.backup.json).alnaba.photos.some((item) => item.id === managedPhoto.id), false);

  // Weekly issues support the same title/file management and durable deletion flow.
  const managedWeekly = store.state.alnaba.weekly[0];
  managementList = await openManagement('weekly');
  await tap(authorizedId, itemButton('weekly', managedWeekly.id, managementList).callback_data);
  await tap(authorizedId, buttonsOf(lastEditFor(authorizedId)).find((button) => button.callback_data.startsWith('nb:edit-title:weekly:')).callback_data);
  await sendText(authorizedId, 'عدد أسبوعي معدل للاختبار');
  await tap(authorizedId, callbackData(lastUiFor(authorizedId), 'nb:edit-save:'));
  assert.equal(store.state.alnaba.weekly[0].title, 'عدد أسبوعي معدل للاختبار');
  assert.equal(store.state.alnaba.weekly[0].issue_number, 1, 'editing a title preserves the separately stored issue number');

  managementList = await openManagement('weekly');
  await tap(authorizedId, itemButton('weekly', managedWeekly.id, managementList).callback_data);
  await tap(authorizedId, buttonsOf(lastEditFor(authorizedId)).find((button) => button.callback_data.startsWith('nb:replace:weekly:')).callback_data);
  await sendPdf(authorizedId, 2);
  assert.equal(store.state.alnaba.weekly[0].file_id, 'fixture_pdf_id', 'replacement PDF stays private until save');
  await tap(authorizedId, callbackData(lastUiFor(authorizedId), 'nb:edit-save:'));
  assert.equal(store.state.alnaba.weekly[0].file_id, 'fixture_pdf_2_id');
  assert.equal(store.state.alnaba.weekly[0].title, 'عدد أسبوعي معدل للاختبار');
  assert.equal(store.state.alnaba.weekly[0].issue_number, 1, 'replacing a PDF preserves its issue number');

  managementList = await openManagement('weekly');
  await tap(authorizedId, itemButton('weekly', managedWeekly.id, managementList).callback_data);
  deleteButton = buttonsOf(lastEditFor(authorizedId)).find((button) => button.callback_data.startsWith('nb:delete:weekly:'));
  await tap(authorizedId, deleteButton.callback_data);
  const weeklyBackupBeforeFailure = store.backup.json;
  const weeklyDeleteToken = callbackData(lastEditFor(authorizedId), 'nb:delete-confirm:');
  failBackup = true;
  await Promise.all([tap(authorizedId, weeklyDeleteToken), tap(authorizedId, weeklyDeleteToken)]);
  assert.equal(store.state.alnaba.weekly.length, 1, 'a failed durable backup rolls the deletion back');
  assert.equal(store.backup.json, weeklyBackupBeforeFailure);
  failBackup = false;
  await tap(authorizedId, weeklyDeleteToken);
  assert.equal(store.state.alnaba.weekly.length, 0, 'the deletion can be retried when backup recovers');

  // Archive titles and links are editable; invalid links stay in the prompt and never save.
  const managedArchive = store.state.alnaba.archive.find((item) => item.title === 'قناة اختبارية');
  managementList = await openManagement('archive');
  await tap(authorizedId, itemButton('archive', managedArchive.id, managementList).callback_data);
  await tap(authorizedId, buttonsOf(lastEditFor(authorizedId)).find((button) => button.callback_data.startsWith('nb:edit-link:archive:')).callback_data);
  await sendText(authorizedId, 'https://example.invalid/not-telegram');
  assert.match(lastUiFor(authorizedId)?.payload?.text || '', /رابط Telegram صالح/);
  assert.equal(store.state.alnaba.archive.find((item) => item.id === managedArchive.id).url, 'https://t.me/ras_mock_archive_channel_01');
  await sendText(authorizedId, 'https://t.me/ras_mock_edited_11');
  assert.equal(store.state.alnaba.archive.find((item) => item.id === managedArchive.id).url, 'https://t.me/ras_mock_archive_channel_01', 'a valid link remains private until save');
  await tap(authorizedId, callbackData(lastUiFor(authorizedId), 'nb:edit-save:'));
  assert.equal(store.state.alnaba.archive.find((item) => item.id === managedArchive.id).url, 'https://t.me/ras_mock_edited_11');

  managementList = await openManagement('archive');
  await tap(authorizedId, itemButton('archive', managedArchive.id, managementList).callback_data);
  await tap(authorizedId, buttonsOf(lastEditFor(authorizedId)).find((button) => button.callback_data.startsWith('nb:edit-title:archive:')).callback_data);
  await sendText(authorizedId, 'قناة معدلة للاختبار');
  await tap(authorizedId, callbackData(lastUiFor(authorizedId), 'nb:edit-save:'));
  assert.equal(store.state.alnaba.archive.find((item) => item.id === managedArchive.id).title, 'قناة معدلة للاختبار');

  managementList = await openManagement('archive');
  await tap(authorizedId, itemButton('archive', managedArchive.id, managementList).callback_data);
  await tap(authorizedId, buttonsOf(lastEditFor(authorizedId)).find((button) => button.callback_data.startsWith('nb:delete:archive:')).callback_data);
  assert.equal(store.state.alnaba.archive.length, 3, 'archive removal also requires explicit confirmation');
  await tap(authorizedId, callbackData(lastEditFor(authorizedId), 'nb:delete-confirm:'));
  assert.equal(store.state.alnaba.archive.length, 2);
  assert.equal(JSON.parse(store.backup.json).alnaba.archive.some((item) => item.id === managedArchive.id), false);

  assert.equal(calls.some(({ method, payload }) => ['sendPhoto', 'sendDocument'].includes(method) && payload.chat_id === '@mock_news_channel'), false,
    'Al-Nabaa uploads do not auto-post files to the Telegram channel');

  const photosBeforeForward = store.state.alnaba.photos.length;
  await sendForwardedPhoto(authorizedId);
  const forwardedPhotoPreview = lastUiFor(authorizedId);
  assert.match(forwardedPhotoPreview.payload.text, /الأخبار المصوّرة/);
  assert.ok(buttonsOf(forwardedPhotoPreview).some((button) => button.callback_data === 'nb:publish'));
  assert.equal(store.state.alnaba.photos.length, photosBeforeForward, 'a forwarded image is only a private preview before confirmation');
  await tap(authorizedId, 'nb:publish');
  assert.equal(store.state.alnaba.photos.length, photosBeforeForward + 1);
  assert.equal(store.state.alnaba.photos.at(-1).title, 'خبر مصوّر معاد توجيهه للاختبار');
  assert.equal(store.state.alnaba.photos.at(-1).expiry_policy, 'photo-news-24h-v1');

  await sendForwardedPdf(authorizedId);
  const forwardedPdfPreview = lastUiFor(authorizedId);
  assert.match(forwardedPdfPreview.payload.text, /رقم العدد: 2/);
  assert.equal(store.state.alnaba.weekly.length, 0, 'a forwarded PDF is not public before confirmation');
  await tap(authorizedId, 'nb:publish');
  assert.equal(store.state.alnaba.weekly.length, 1);
  assert.equal(store.state.alnaba.weekly[0].issue_number, 2, 'a forwarded PDF keeps its issue number from the caption');

  await sendForwardedPdfMissingNumber(authorizedId);
  assert.match(lastUiFor(authorizedId).payload.text, /رقم العدد الموجب/);
  assert.equal(store.state.alnaba.weekly.length, 1, 'missing issue metadata keeps a forwarded PDF private');
  await sendText(authorizedId, '3\nعدد ثالث معاد توجيهه للاختبار');
  assert.match(lastUiFor(authorizedId).payload.text, /رقم العدد: 3/);
  assert.equal(store.state.alnaba.weekly.length, 1, 'completing metadata still requires the publish button');
  await tap(authorizedId, 'nb:publish');
  assert.deepEqual(store.state.alnaba.weekly.map((item) => item.issue_number), [2, 3]);

  const quranCount = store.state.alnaba.quran.length;
  await sendForwardedAudio(authorizedId);
  assert.match(lastUiFor(authorizedId).payload.text, /القرآن الكريم/);
  assert.match(lastUiFor(authorizedId).payload.text, /سورة البقرة/);
  assert.equal(store.state.alnaba.quran.length, quranCount, 'forwarded Quran audio remains private until confirmation');
  await tap(authorizedId, 'nb:cancel');
  assert.equal(store.state.alnaba.quran.length, quranCount);

  await sendForwardedVoiceMissingTitle(authorizedId);
  assert.match(lastUiFor(authorizedId).payload.text, /أرسل العنوان في السطر الأول/);
  assert.equal(store.state.alnaba.quran.length, quranCount, 'missing voice metadata does not publish or skip owner review');
  await sendText(authorizedId, 'تلاوة بعنوان واضح للاختبار\nوصف التلاوة للاختبار');
  const forwardedVoicePreview = lastUiFor(authorizedId);
  assert.match(forwardedVoicePreview.payload.text, /تلاوة بعنوان واضح للاختبار/);
  assert.match(forwardedVoicePreview.payload.text, /وصف التلاوة للاختبار/);
  assert.ok(buttonsOf(forwardedVoicePreview).some((button) => button.callback_data === 'nb:publish'));
  assert.equal(store.state.alnaba.quran.length, quranCount, 'forwarded voice remains private until explicit confirmation');
  await tap(authorizedId, 'nb:cancel');

  const nasheedCount = store.state.alnaba.nasheed.length;
  await sendForwardedVideo(authorizedId);
  assert.match(lastUiFor(authorizedId).payload.text, /الأناشيد/);
  assert.match(lastUiFor(authorizedId).payload.text, /وصف النشيد المعاد توجيهه/);
  assert.equal(store.state.alnaba.nasheed.length, nasheedCount, 'forwarded nasheed video remains private until confirmation');
  await tap(authorizedId, 'nb:cancel');

  await sendAmbiguousForwardAudio(authorizedId);
  const ambiguousPrompt = lastUiFor(authorizedId);
  assert.match(ambiguousPrompt.payload.text, /لم أستطع تحديد/);
  assert.ok(buttonsOf(ambiguousPrompt).some((button) => button.callback_data === 'nb:forward:section:quran'));
  assert.ok(buttonsOf(ambiguousPrompt).some((button) => button.callback_data === 'nb:forward:section:nasheed'));
  assert.equal(store.state.alnaba.nasheed.length, nasheedCount, 'ambiguous media is not filed or published automatically');
  await tap(authorizedId, 'nb:forward:section:nasheed');
  const selectedNasheedPreview = lastUiFor(authorizedId);
  assert.match(selectedNasheedPreview.payload.text, /عنوان صوتي للاختبار/);
  assert.match(selectedNasheedPreview.payload.text, /وصف صوتي للاختبار/);
  assert.ok(buttonsOf(selectedNasheedPreview).some((button) => button.callback_data === 'nb:publish'));
  assert.equal(store.state.alnaba.nasheed.length, nasheedCount, 'choosing the section still only creates a private preview');
  await tap(authorizedId, 'nb:cancel');
  assert.equal(store.state.alnaba.nasheed.length, nasheedCount, 'cancelling the forwarded preview never publishes it');

  const beforeDeniedForward = store.state.alnaba.photos.length;
  await sendForwardedPhoto(deniedId);
  assert.equal(store.state.alnaba.photos.length, beforeDeniedForward, 'a non-owner cannot create a forwarded Al-Nabaa item');
  assert.equal(buttonsOf(lastUiFor(deniedId)).some((button) => button.callback_data === 'nb:publish'), false);
});
