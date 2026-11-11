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
const photoBytes4 = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x46, 0x00, 0x11, 0x12, 0x13, 0x14, 0x15]);
const pdfBytes = Buffer.from('%PDF-1.7\nfixture only\n%%EOF\n');
const pdfBytes2 = Buffer.from('%PDF-1.7\nreplacement fixture only\n%%EOF\n');
const oggBytes = Buffer.from('OggSfixture-quran-audio');
const mp4Bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(8)]);
const fixtureFiles = new Map([
  ['photos/fixture-photo.jpg', photoBytes],
  ['photos/fixture-photo-2.jpg', photoBytes2],
  ['photos/fixture-photo-3.jpg', photoBytes3],
  ['photos/fixture-photo-4.jpg', photoBytes4],
  ['documents/fixture-weekly.pdf', pdfBytes],
  ['documents/fixture-weekly-2.pdf', pdfBytes2],
  ['audio/quran.ogg', oggBytes],
  ['video/nasheed.mp4', mp4Bytes],
]);
for (let index = 1; index <= 56; index += 1) fixtureFiles.set(`documents/batch-${index}.pdf`, pdfBytes);
globalThis.fetch = async (url) => {
  const match = String(url).match(/\/file\/bot123456:LOCAL_TEST\/(.+)$/);
  assert.ok(match, 'media download must use the isolated Telegram fixture');
  const bytes = fixtureFiles.get(match[1]);
  assert.ok(bytes, `unexpected isolated fixture path: ${match[1]}`);
  return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
};

const { store } = await import('../server/store.js');
await store.init(null);
const { publishAlnabaItem, nextWeeklyIssueNumber } = await import('../server/alnaba.js');
let failBackup = false;
let failBackupPredicate = null;
let failBackupPin = false;
store.backup = { async save(json) {
  const state = JSON.parse(json);
  if (failBackup || failBackupPredicate?.(state)) {
    failBackupPredicate = null;
    throw new Error('fixture backup failure');
  }
  this.json = json;
} };
store.state.alnaba = { photos: [], weekly: [], archive: [] };
const { createBot, runtimeHooks, telegramBackupAdapter } = await import('../server/bot.js');
const bot = createBot({ token: process.env.BOT_TOKEN });
bot.botInfo = { id: 1, is_bot: true, first_name: 'Fixture bot', username: 'FixtureBot' };
const calls = [];
let messageId = 100;
bot.api.config.use(async (_previous, method, payload) => {
  calls.push({ method, payload: method === 'sendDocument' ? { chat_id: payload.chat_id, caption: payload.caption } : structuredClone(payload) });
  if (method === 'getFile') {
    const filePaths = {
      fixture_photo_id: 'photos/fixture-photo.jpg',
      fixture_photo_2_id: 'photos/fixture-photo-2.jpg',
      fixture_photo_3_id: 'photos/fixture-photo-3.jpg',
      fixture_photo_4_id: 'photos/fixture-photo-4.jpg',
      fixture_pdf_id: 'documents/fixture-weekly.pdf',
      fixture_pdf_2_id: 'documents/fixture-weekly-2.pdf',
      fixture_quran_audio_id: 'audio/quran.ogg',
      fixture_forwarded_quran_audio_id: 'audio/quran.ogg',
      fixture_ambiguous_audio_id: 'audio/quran.ogg',
      fixture_nasheed_video_id: 'video/nasheed.mp4',
      fixture_forwarded_nasheed_video_id: 'video/nasheed.mp4',
      fixture_followup_nasheed_video_1_id: 'video/nasheed.mp4',
      fixture_followup_nasheed_video_2_id: 'video/nasheed.mp4',
      ...Object.fromEntries(Array.from({ length: 56 }, (_, index) => [`fixture_batch_pdf_${index + 1}_id`, `documents/batch-${index + 1}.pdf`])),
      ...Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`fixture_batch_nasheed_${index + 1}_id`, 'video/nasheed.mp4'])),
    };
    return { ok: true, result: { file_path: filePaths[payload.file_id] } };
  }
  if (method === 'sendMessage' || method === 'editMessageText' || method === 'editMessageCaption') {
    return { ok: true, result: { message_id: ++messageId, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text || payload.caption || '' } };
  }
  if (method === 'sendDocument') return { ok: true, result: { message_id: ++messageId, date: 0, chat: { id: payload.chat_id, type: 'private' } } };
  if (method === 'pinChatMessage' && failBackupPin) throw new Error('fixture pin failure');
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
  const fourth = n === 4;
  const bytes = second ? photoBytes2 : third ? photoBytes3 : fourth ? photoBytes4 : photoBytes;
  const title = second ? 'خبر مصور ثانٍ للاختبار' : third ? 'صورة بديلة للاختبار' : fourth ? 'خبر بعد استعادة النسخة للاختبار' : 'صورة تجريبية للاختبار';
  const fileId = second ? 'fixture_photo_2_id' : third ? 'fixture_photo_3_id' : fourth ? 'fixture_photo_4_id' : 'fixture_photo_id';
  const uniqueId = second ? 'fixture_photo_2_unique' : third ? 'fixture_photo_3_unique' : fourth ? 'fixture_photo_4_unique' : 'fixture_photo_unique';
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
const sendBatchPdf = (id, n, mediaGroupId = null) => bot.handleUpdate({
  update_id: updateId++,
  message: {
    message_id: ++messageId, date: 0,
    chat: { id, type: 'private' }, from: user(id),
    ...(mediaGroupId ? { media_group_id: mediaGroupId } : {}),
    document: {
      file_id: `fixture_batch_pdf_${n}_id`, file_unique_id: `fixture_batch_pdf_${n}_unique`,
      file_name: `batch-${n}.pdf`, mime_type: 'application/pdf',
      file_size: [17, 55].includes(n) ? 20 * 1024 * 1024 + 1 : pdfBytes.length,
    },
  },
});
const sendBatchNasheed = (id, n, mediaGroupId = null) => bot.handleUpdate({
  update_id: updateId++,
  message: {
    message_id: ++messageId, date: 0,
    chat: { id, type: 'private' }, from: user(id),
    forward_origin: forwardedFrom('أناشيد'),
    ...(mediaGroupId ? { media_group_id: mediaGroupId } : {}),
    caption: `نشيد دفعي ${n} للاختبار`,
    video: {
      file_id: `fixture_batch_nasheed_${n}_id`, file_unique_id: `fixture_batch_nasheed_${n}_unique`,
      file_name: `nasheed-${n}.mp4`, mime_type: 'video/mp4', file_size: mp4Bytes.length,
    },
  },
});
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
      audio: { file_id: 'fixture_forwarded_quran_audio_id', file_unique_id: 'fixture_forwarded_quran_audio_unique', file_name: 'quran.ogg', mime_type: 'audio/ogg', file_size: oggBytes.length },
    },
  });
  const sendForwardedVoiceMissingTitle = (id, n = 1) => bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId, date: 0,
      chat: { id, type: 'private' }, from: user(id),
      forward_origin: forwardedFrom('قناة القرآن الكريم'),
      voice: { file_id: 'fixture_quran_audio_id', file_unique_id: `fixture_quran_voice_unique_${n}`, mime_type: 'audio/ogg', file_size: oggBytes.length },
    },
  });
  const sendForwardedVideo = (id) => bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId, date: 0,
      chat: { id, type: 'private' }, from: user(id),
      forward_origin: forwardedFrom('أناشيد'),
      caption: 'نشيد معاد توجيهه للاختبار\nوصف النشيد المعاد توجيهه',
      video: { file_id: 'fixture_forwarded_nasheed_video_id', file_unique_id: 'fixture_forwarded_nasheed_video_unique', file_name: 'nasheed.mp4', mime_type: 'video/mp4', file_size: mp4Bytes.length },
    },
  });
  const sendFollowupForwardVideo = (id, n) => bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId, date: 0,
      chat: { id, type: 'private' }, from: user(id),
      forward_origin: forwardedFrom('أناشيد'),
      caption: `نشيد متابعة ${n} للاختبار\nوصف جديد للاختبار`,
      video: { file_id: `fixture_followup_nasheed_video_${n}_id`, file_unique_id: `fixture_followup_nasheed_video_${n}_unique`, file_name: 'nasheed.mp4', mime_type: 'video/mp4', file_size: mp4Bytes.length },
    },
  });
  const sendAmbiguousForwardAudio = (id, uniqueId = 'fixture_ambiguous_audio_unique') => bot.handleUpdate({
    update_id: updateId++,
    message: {
      message_id: ++messageId, date: 0,
      chat: { id, type: 'private' }, from: user(id),
      forward_origin: forwardedFrom('قناة عامة'),
      caption: 'عنوان صوتي للاختبار\nوصف صوتي للاختبار',
      audio: { file_id: 'fixture_ambiguous_audio_id', file_unique_id: uniqueId, file_name: 'recording.ogg', mime_type: 'audio/ogg', file_size: oggBytes.length },
    },
  });
  const lastUiFor = (id) => [...calls].reverse().find(({ method, payload }) => method === 'sendMessage' && payload.chat_id === id);
const lastEditFor = (id) => [...calls].reverse().find(({ method, payload }) => method === 'editMessageText' && payload.chat_id === id);
const buttonsOf = (entry) => entry?.payload?.reply_markup?.inline_keyboard?.flat() || [];
const callbackData = (entry, prefix) => buttonsOf(entry).find((button) => button.callback_data.startsWith(prefix))?.callback_data;
const waitForAlnabaBatch = (ms = 1200) => new Promise((resolve) => setTimeout(resolve, ms));

after(() => {
  globalThis.fetch = originalFetch;
  clearTimeout(store._saveTimer);
  clearTimeout(store._backupTimer);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the bot offers Al-Nabaa only to owner 8270709633 and publishes owner uploads directly to the website only', async () => {
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
  const firstSuccess = lastUiFor(authorizedId);
  assert.match(firstSuccess.payload.text, /نُشر مباشرةً على موقع النبأ فقط/);
  assert.equal(buttonsOf(firstSuccess).some((button) => button.callback_data === 'nb:publish'), false);
  assert.equal(store.state.alnaba.photos.length, 1, 'the owner upload is published as soon as verification succeeds');
  assert.equal(store.state.alnaba.photos[0].title, 'صورة تجريبية للاختبار');
  assert.ok(JSON.parse(store.backup.json).alnaba.photos.some((item) => item.file_id === 'fixture_photo_id'));
  assert.ok(calls.some(({ method, payload }) => method === 'sendMessage' && payload.text.includes('نُشر مباشرةً على موقع النبأ فقط')));
  assert.ok(buttonsOf(firstSuccess).some((button) => button.callback_data === 'nb:home'));
  const addPhoto = buttonsOf(firstSuccess).find((button) => button.callback_data === 'nb:photos');
  assert.equal(addPhoto?.text, '➕ إضافة خبر جديد');
  await tap(authorizedId, addPhoto.callback_data);
  assert.match(lastEditFor(authorizedId)?.payload?.text || '', /أخبار مصوّرة/);
  assert.equal(store.state.alnaba.photos.length, 1, 'starting another upload must not publish the previous item again');

  await sendPhoto(authorizedId, 2);
  const secondPreview = lastUiFor(authorizedId);
  assert.match(secondPreview.payload.text, /نُشر مباشرةً على موقع النبأ فقط/);
  assert.equal(buttonsOf(secondPreview).some((button) => button.callback_data === 'nb:publish'), false);
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
  await waitForAlnabaBatch();
  assert.equal(store.state.alnaba.weekly.length, 1);
  assert.match(lastUiFor(authorizedId).payload.text, /نُشر مباشرةً على موقع النبأ فقط/);
  assert.equal(buttonsOf(lastUiFor(authorizedId)).some((button) => button.callback_data === 'nb:publish'), false);
  assert.equal(store.state.alnaba.weekly[0].title, 'العدد الأسبوعي التجريبي');
  assert.equal(store.state.alnaba.weekly[0].issue_number, 1);
  assert.equal(store.state.alnaba.weekly[0].expiry_policy, undefined, 'weekly PDFs do not use the 24-hour photo-news expiry');
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
  await waitForAlnabaBatch();
  assert.equal(store.state.alnaba.quran.length, 1);
  assert.match(lastUiFor(authorizedId).payload.text, /نُشر مباشرةً على موقع النبأ فقط/);
  assert.equal(buttonsOf(lastUiFor(authorizedId)).some((button) => button.callback_data === 'nb:publish'), false);
  assert.equal(store.state.alnaba.quran[0].mime_type, 'audio/ogg');
  assert.equal(store.state.alnaba.quran[0].expiry_policy, undefined, 'Quran items do not use photo-news expiry');
  assert.equal(store.state.alnaba.quran[0].description, 'سورة البقرة');
  assert.ok(JSON.parse(store.backup.json).alnaba.quran.some((item) => item.title === 'تلاوة تجريبية' && item.description === 'سورة البقرة'));
  const addQuran = buttonsOf(lastUiFor(authorizedId)).find((button) => button.callback_data === 'nb:quran');
  assert.equal(addQuran?.text, '➕ إضافة محتوى');

  await sendText(authorizedId, '/alnaba');
  await tap(authorizedId, 'nb:nasheed');
  await sendVideo(authorizedId);
  await waitForAlnabaBatch();
  assert.equal(store.state.alnaba.nasheed.length, 1, 'the owner nasheed upload publishes directly after validation');
  assert.equal(store.state.alnaba.nasheed[0].description, 'وصف النشيد');
  assert.equal(buttonsOf(lastUiFor(authorizedId)).some((button) => button.callback_data === 'nb:publish'), false);
  assert.equal(store.state.alnaba.nasheed[0].mime_type, 'video/mp4');
  assert.equal(store.state.alnaba.nasheed[0].expiry_policy, undefined, 'nasheeds do not use photo-news expiry');
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

  const photoBackupBeforeFailure = store.backup.json;
  await sendText(authorizedId, '/alnaba');
  await tap(authorizedId, 'nb:photos');
  failBackup = true;
  await sendPhoto(authorizedId, 4);
  failBackup = false;
  assert.equal(store.state.alnaba.photos.length, 1, 'a failed durable backup rolls back the direct photo publication');
  assert.equal(store.backup.json, photoBackupBeforeFailure, 'a failed direct publication leaves the durable snapshot unchanged');
  assert.match(lastUiFor(authorizedId).payload.text, /النسخة الاحتياطية/);
  assert.equal(buttonsOf(lastUiFor(authorizedId)).some((button) => button.callback_data === 'nb:publish'), false);
  await sendPhoto(authorizedId, 4);
  assert.equal(store.state.alnaba.photos.length, 2, 'the owner can resend and publish once the backup is healthy');
  assert.ok(JSON.parse(store.backup.json).alnaba.photos.some((item) => item.file_id === 'fixture_photo_4_id'));

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

  assert.equal(calls.some(({ payload }) => payload.chat_id === '@mock_news_channel'), false,
    'Al-Nabaa uploads do not send messages or files to the Telegram news channel');

  const photosBeforeForward = store.state.alnaba.photos.length;
  await sendForwardedPhoto(authorizedId);
  const forwardedPhotoSuccess = lastUiFor(authorizedId);
  assert.match(forwardedPhotoSuccess.payload.text, /نُشر مباشرةً على موقع النبأ فقط/);
  assert.equal(buttonsOf(forwardedPhotoSuccess).some((button) => button.callback_data === 'nb:publish'), false);
  assert.equal(store.state.alnaba.photos.length, photosBeforeForward + 1, 'a titled image forwarded from another channel publishes directly');
  assert.equal(store.state.alnaba.photos.at(-1).title, 'خبر مصوّر معاد توجيهه للاختبار');
  assert.equal(store.state.alnaba.photos.at(-1).expiry_policy, 'photo-news-24h-v1');

  await sendForwardedPdf(authorizedId);
  await waitForAlnabaBatch();
  assert.match(lastUiFor(authorizedId).payload.text, /نُشر مباشرةً على موقع النبأ فقط/);
  assert.equal(buttonsOf(lastUiFor(authorizedId)).some((button) => button.callback_data === 'nb:publish'), false);
  assert.equal(store.state.alnaba.weekly.length, 1);
  assert.equal(store.state.alnaba.weekly[0].issue_number, 2, 'a forwarded PDF keeps its issue number from the caption');

  await sendForwardedPdfMissingNumber(authorizedId);
  await waitForAlnabaBatch();
  assert.match(lastUiFor(authorizedId).payload.text, /نُشر مباشرةً على موقع النبأ فقط/);
  assert.equal(store.state.alnaba.weekly.length, 2, 'a PDF without an issue number publishes directly with the next issue number');
  assert.deepEqual(store.state.alnaba.weekly.map((item) => item.issue_number), [2, 3]);
  assert.equal(store.state.alnaba.weekly.find((item) => item.issue_number === 3).title, 'العدد 3', 'a missing title defaults to the assigned issue number');

  const quranCount = store.state.alnaba.quran.length;
  await sendForwardedAudio(authorizedId);
  await waitForAlnabaBatch();
  assert.match(lastUiFor(authorizedId).payload.text, /نُشر مباشرةً على موقع النبأ فقط/);
  assert.equal(buttonsOf(lastUiFor(authorizedId)).some((button) => button.callback_data === 'nb:publish'), false);
  assert.equal(store.state.alnaba.quran.length, quranCount + 1, 'audio forwarded from a Quran channel is classified and published directly');
  assert.equal(store.state.alnaba.quran.at(-1).expiry_policy, undefined);

  await sendForwardedVoiceMissingTitle(authorizedId, 1);
  await waitForAlnabaBatch();
  assert.match(lastUiFor(authorizedId).payload.text, /نُشر مباشرةً على موقع النبأ فقط/);
  assert.equal(buttonsOf(lastUiFor(authorizedId)).some((button) => button.callback_data === 'nb:publish'), false);
  assert.equal(store.state.alnaba.quran.length, quranCount + 2, 'a voice with no title is directly published with a generated title');
  assert.match(store.state.alnaba.quran.at(-1).title, /تلاوة قرآنية/);

  const nasheedCount = store.state.alnaba.nasheed.length;
  await sendForwardedVideo(authorizedId);
  await waitForAlnabaBatch();
  assert.match(lastUiFor(authorizedId).payload.text, /نُشر مباشرةً على موقع النبأ فقط/);
  assert.equal(buttonsOf(lastUiFor(authorizedId)).some((button) => button.callback_data === 'nb:publish'), false);
  assert.equal(store.state.alnaba.nasheed.length, nasheedCount + 1, 'video from a nasheed channel publishes directly in nasheeds');
  assert.equal(store.state.alnaba.nasheed.at(-1).expiry_policy, undefined);

  await sendAmbiguousForwardAudio(authorizedId);
  const ambiguousPrompt = lastUiFor(authorizedId);
  assert.match(ambiguousPrompt.payload.text, /ملتبس/);
  const ambiguousNasheedChoice = buttonsOf(ambiguousPrompt).find((button) => button.callback_data.startsWith('nb:batch-section:') && button.callback_data.endsWith(':nasheed'));
  assert.ok(ambiguousNasheedChoice);
  assert.equal(store.state.alnaba.nasheed.length, nasheedCount + 1, 'ambiguous media is not filed or published automatically');
  await tap(authorizedId, ambiguousNasheedChoice.callback_data);
  await waitForAlnabaBatch();
  assert.match(lastUiFor(authorizedId).payload.text, /نُشر مباشرةً على موقع النبأ فقط/);
  assert.equal(buttonsOf(lastUiFor(authorizedId)).some((button) => button.callback_data === 'nb:publish'), false);
  assert.equal(store.state.alnaba.nasheed.length, nasheedCount + 2, 'choosing the ambiguous section causes direct website publication');
  assert.equal(store.state.alnaba.nasheed.at(-1).expiry_policy, undefined);

  const beforeDeniedForward = store.state.alnaba.photos.length;
  await sendForwardedPhoto(deniedId);
  assert.equal(store.state.alnaba.photos.length, beforeDeniedForward, 'a non-owner cannot create a forwarded Al-Nabaa item');
  assert.equal(buttonsOf(lastUiFor(deniedId)).some((button) => button.callback_data === 'nb:publish'), false);

  const beforeCancel = store.state.alnaba.nasheed.length;
  await sendAmbiguousForwardAudio(authorizedId);
  const privateChoice = lastUiFor(authorizedId);
  const cancelThisFile = buttonsOf(privateChoice).find((button) => button.callback_data.startsWith('nb:batch-cancel:'));
  assert.ok(cancelThisFile);
  await tap(authorizedId, cancelThisFile.callback_data);
  assert.equal(store.state.alnaba.nasheed.length, beforeCancel, 'cancelling an ambiguous forward leaves it private');
  await sendFollowupForwardVideo(authorizedId, 1);
  await waitForAlnabaBatch();
  assert.match(lastUiFor(authorizedId).payload.text, /نُشر مباشرةً على موقع النبأ فقط/);
  assert.equal(store.state.alnaba.nasheed.length, beforeCancel + 1, 'the next clearly classified forward publishes after Cancel clears the pending state');

  const quranBeforeSupersede = store.state.alnaba.quran.length;
  const nasheedBeforeSupersede = store.state.alnaba.nasheed.length;
  await sendForwardedVoiceMissingTitle(authorizedId, 2);
  await sendFollowupForwardVideo(authorizedId, 2);
  await waitForAlnabaBatch();
  assert.match(lastUiFor(authorizedId).payload.text, /نُشر مباشرةً على موقع النبأ فقط/);
  assert.equal(store.state.alnaba.quran.length, quranBeforeSupersede + 1, 'a title-less voice is independently queued and published with a generated title');
  assert.equal(store.state.alnaba.nasheed.length, nasheedBeforeSupersede + 1, 'a new classified forward publishes directly');
});

test('PDF albums and separate messages publish in message order with an individual result for all 52 files', async () => {
  const authorizedId = 8270709633;
  const existingIssues = store.state.alnaba.weekly.map((item) => item.issue_number).filter(Number.isFinite);
  const expectedFirstIssue = Math.max(0, ...existingIssues) + 1;
  for (let album = 1; album <= 5; album += 1) {
    for (let offset = 1; offset <= 10; offset += 1) {
      const number = (album - 1) * 10 + offset;
      await sendBatchPdf(authorizedId, number, `fixture-album-${album}`);
    }
  }
  await sendBatchPdf(authorizedId, 51);
  await sendBatchPdf(authorizedId, 52);
  await waitForAlnabaBatch(6500);

  const batchItems = store.state.alnaba.weekly.filter((item) => item.file_id.startsWith('fixture_batch_pdf_'));
  assert.equal(batchItems.length, 51, 'the oversized seventeenth file fails without dropping any other PDF');
  const orderedItems = [...batchItems].sort((a, b) => a.sequence - b.sequence);
  assert.deepEqual(orderedItems.map((item) => item.issue_number), Array.from({ length: 51 }, (_, index) => expectedFirstIssue + index));
  assert.equal(orderedItems[0].file_id, 'fixture_batch_pdf_1_id');
  assert.equal(orderedItems.at(-1).file_id, 'fixture_batch_pdf_52_id');

  const fileResults = calls.filter(({ method, payload }) => method === 'sendMessage'
    && payload.chat_id === authorizedId && /batch-\d+\.pdf/.test(payload.text || ''));
  assert.equal(fileResults.length, 52, 'every PDF, including the failure, receives its own result');
  assert.equal(fileResults.filter(({ payload }) => payload.text.includes('✅')).length, 51);
  assert.equal(fileResults.filter(({ payload }) => payload.text.includes('❌') && payload.text.includes('batch-17.pdf')).length, 1);
  assert.equal(fileResults.filter(({ payload }) => payload.text.includes('❌')).length, 1);
  assert.equal(JSON.parse(store.backup.json).alnaba.weekly.filter((item) => item.file_id.startsWith('fixture_batch_pdf_')).length, 51);

  await sendBatchPdf(authorizedId, 53, 'fixture-shutdown-flush');
  assert.equal(store.state.alnaba.weekly.some((item) => item.file_id === 'fixture_batch_pdf_53_id'), false,
    'the short media-group collection window leaves the last PDF pending before shutdown');
  assert.equal(typeof runtimeHooks.flushAlnabaBatches, 'function');
  await runtimeHooks.flushAlnabaBatches();
  assert.equal(store.state.alnaba.weekly.some((item) => item.file_id === 'fixture_batch_pdf_53_id'), true,
    'the graceful-shutdown hook flushes the queued PDF before the process exits');
});

test('pending PDF and nasheed batches recover after a synthetic restart without duplicate publishing', async () => {
  const authorizedId = 8270709633;
  const restartAlbum = 'fixture-restart-pdf-album';
  const beforeRestart = store.state.alnaba.weekly.length;
  await sendBatchPdf(authorizedId, 54, restartAlbum);
  await sendBatchPdf(authorizedId, 55, restartAlbum);
  await sendBatchPdf(authorizedId, 56, restartAlbum);
  const record = store.state.alnabaBatches.find((batch) => batch.media_group_id === restartAlbum);
  assert.ok(record && record.items.length === 3, 'the complete ordered album is in the durable queue before processing');
  assert.ok(JSON.parse(store.backup.json).alnabaBatches.some((batch) => batch.id === record.id), 'the remote snapshot contains the queued file references');

  // Simulate a process dying after the website write succeeded but before its queue item was marked complete.
  const first = record.items[0];
  const issueNumber = nextWeeklyIssueNumber(store.state.alnaba.weekly);
  const recoveredExisting = publishAlnabaItem(store, authorizedId, {
    ...first.candidate, section: 'weekly', issue_number: issueNumber, title: `العدد ${issueNumber}`,
  });
  first.status = 'processing';
  first.updated_at = new Date().toISOString();
  record.status = 'processing';
  record.updated_at = first.updated_at;
  store.persist();
  await store.flushBackup();
  runtimeHooks.resetAlnabaBatchRuntime();
  store._apply(JSON.parse(store.backup.json));
  await runtimeHooks.resumeAlnabaBatches();

  assert.equal(store.state.alnaba.weekly.filter((item) => item.file_unique_id === first.candidate.file_unique_id).length, 1,
    'recovery detects a file already published before the simulated crash and does not duplicate it');
  assert.equal(store.state.alnaba.weekly.some((item) => item.file_id === 'fixture_batch_pdf_55_id'), false,
    'the oversized PDF fails individually');
  assert.equal(store.state.alnaba.weekly.some((item) => item.file_id === 'fixture_batch_pdf_56_id'), true,
    'processing continues after the failed file');
  assert.equal(store.state.alnaba.weekly.length, beforeRestart + 2, 'only the one pre-crash and one post-failure PDF are added');
  const recoveredRecord = store.state.alnabaBatches.find((batch) => batch.id === record.id);
  assert.deepEqual(recoveredRecord.items.map((item) => item.status), ['published', 'failed', 'published']);
  assert.equal(recoveredRecord.items[0].published_item_id, recoveredExisting.id);
  assert.ok(JSON.parse(store.backup.json).alnabaBatches.find((batch) => batch.id === record.id).items.every((item) => ['published', 'failed'].includes(item.status)),
    'terminal per-file states are saved back to the remote backup');

  const nasheedAlbum = 'fixture-restart-nasheed-album';
  await sendBatchNasheed(authorizedId, 4, nasheedAlbum);
  const nasheedRecord = store.state.alnabaBatches.find((batch) => batch.media_group_id === nasheedAlbum);
  assert.ok(nasheedRecord && nasheedRecord.items[0].status === 'pending');
  runtimeHooks.resetAlnabaBatchRuntime();
  store._apply(JSON.parse(store.backup.json));
  await runtimeHooks.resumeAlnabaBatches();
  assert.equal(store.state.alnaba.nasheed.filter((item) => item.file_unique_id === 'fixture_batch_nasheed_4_unique').length, 1,
    'nasheed uploads also resume from persistent file references after restart');
  assert.equal(store.state.alnabaBatches.find((batch) => batch.id === nasheedRecord.id).items[0].status, 'published');
});

test('Telegram albums stop at 10 files and expired pending batches are not published', async () => {
  const authorizedId = 8270709633;
  const weeklyBefore = store.state.alnaba.weekly.length;
  const mediaGroupId = 'fixture-album-limit';
  for (let number = 1; number <= 10; number += 1) await sendBatchPdf(authorizedId, number, mediaGroupId);
  const album = store.state.alnabaBatches.find((batch) => batch.media_group_id === mediaGroupId);
  assert.equal(album.items.length, 10, 'the persistent album contains no more than 10 files');
  await sendBatchPdf(authorizedId, 11, mediaGroupId);
  assert.equal(album.items.length, 10, 'the eleventh Telegram album item is not persisted or queued');
  assert.match(lastUiFor(authorizedId).payload.text, /10-file limit|10 ملفات/);
  await runtimeHooks.flushAlnabaBatches();
  assert.equal(store.state.alnaba.weekly.length, weeklyBefore, 'idempotent recognition of these already-published fixtures creates no duplicates');

  const now = Date.now();
  const expiredId = 'fixture-expired-batch';
  const expiredMessageId = ++messageId;
  store.state.alnabaBatches.push({
    id: expiredId, owner_id: authorizedId, media_group_id: 'fixture-expired-group', status: 'queued',
    created_at: new Date(now - 25 * 60 * 60_000).toISOString(),
    updated_at: new Date(now - 25 * 60 * 60_000).toISOString(),
    expires_at: new Date(now - 60 * 60_000).toISOString(),
    items: [{
      key: `expired:${expiredMessageId}`, message_id: expiredMessageId, media_group_id: 'fixture-expired-group',
      section: 'weekly', status: 'pending', attempts: 0,
      candidate: { file_id: 'fixture_batch_pdf_56_id', file_unique_id: 'fixture_expired_pdf_unique', file_size: pdfBytes.length, mime_type: 'application/pdf', file_name: 'expired.pdf', title: 'العدد المنتهي', issue_number: 900 },
      created_at: new Date(now - 25 * 60 * 60_000).toISOString(), updated_at: new Date(now - 25 * 60 * 60_000).toISOString(),
    }],
  });
  store.persist();
  await store.flushBackup();
  const getFileCallsBeforeExpiryRecovery = calls.filter(({ method }) => method === 'getFile').length;
  runtimeHooks.resetAlnabaBatchRuntime();
  store._apply(JSON.parse(store.backup.json));
  await runtimeHooks.resumeAlnabaBatches();
  const expired = store.state.alnabaBatches.find((batch) => batch.id === expiredId);
  assert.equal(expired.items[0].status, 'expired');
  assert.equal(calls.filter(({ method }) => method === 'getFile').length, getFileCallsBeforeExpiryRecovery,
    'recovery reports the expired file without fetching or publishing it');
});

test('a transient ambiguous backup failure retries idempotently without creating a second item', async () => {
  const authorizedId = 8270709633;
  const uniqueId = 'fixture_batch_pdf_56_unique';
  const before = store.state.alnaba.weekly.filter((item) => item.file_unique_id === uniqueId).length;
  assert.equal(before, 1, 'the fixture media is already published once');
  const mediaGroupId = 'fixture-backup-ambiguous-retry';
  await sendBatchPdf(authorizedId, 56, mediaGroupId);
  failBackupPredicate = (state) => state.alnabaBatches.some((batch) => batch.media_group_id === mediaGroupId
    && batch.items.some((item) => item.status === 'published'));

  await runtimeHooks.flushAlnabaBatches();
  const afterAmbiguousFailure = store.state.alnabaBatches.find((batch) => batch.media_group_id === mediaGroupId);
  assert.equal(afterAmbiguousFailure.items[0].status, 'processing', 'uncertain backup commits stay retryable rather than falsely terminal');
  assert.equal(store.state.alnaba.weekly.filter((item) => item.file_unique_id === uniqueId).length, 1);

  await runtimeHooks.flushAlnabaBatches();
  const afterRetry = store.state.alnabaBatches.find((batch) => batch.media_group_id === mediaGroupId);
  assert.equal(afterRetry.items[0].status, 'published');
  assert.equal(store.state.alnaba.weekly.filter((item) => item.file_unique_id === uniqueId).length, 1,
    'the retry checkpoints the existing publication without a duplicate');
});

test('nasheed albums keep every clear item moving while an ambiguous forwarded item stays private until chosen', async () => {
  const authorizedId = 8270709633;
  const nasheedBefore = store.state.alnaba.nasheed.length;
  const quranBefore = store.state.alnaba.quran.length;
  await sendAmbiguousForwardAudio(authorizedId);
  const ambiguousPrompt = lastUiFor(authorizedId);
  const quranChoice = buttonsOf(ambiguousPrompt).find((button) => button.callback_data.startsWith('nb:batch-section:') && button.callback_data.endsWith(':quran'));
  assert.ok(quranChoice, 'an unclear file offers an independent Quran choice');
  for (let number = 1; number <= 3; number += 1) await sendBatchNasheed(authorizedId, number, 'fixture-nasheed-album-1');
  await waitForAlnabaBatch(1800);
  assert.equal(store.state.alnaba.nasheed.length, nasheedBefore + 3, 'the three clear nasheeds publish despite the earlier ambiguous file');
  assert.equal(store.state.alnaba.quran.length, quranBefore, 'the ambiguous file remains private without a section choice');
  assert.deepEqual(store.state.alnaba.nasheed.slice(-3).map((item) => item.file_id), [
    'fixture_batch_nasheed_1_id', 'fixture_batch_nasheed_2_id', 'fixture_batch_nasheed_3_id',
  ]);

  await tap(authorizedId, quranChoice.callback_data);
  await waitForAlnabaBatch();
  assert.equal(store.state.alnaba.quran.length, quranBefore + 1, 'choosing a section publishes only that previously private file');
  assert.equal(store.state.alnaba.quran.at(-1).file_id, 'fixture_ambiguous_audio_id');
  assert.equal(store.state.alnaba.nasheed.length, nasheedBefore + 3);
});

test('an ambiguous forwarded file safely re-prompts for its section after a synthetic restart', async () => {
  const authorizedId = 8270709633;
  const uniqueId = 'fixture_restart_ambiguous_audio_unique';
  const quranBefore = store.state.alnaba.quran.filter((item) => item.file_unique_id === uniqueId).length;
  await sendAmbiguousForwardAudio(authorizedId, uniqueId);
  const originalPrompt = lastUiFor(authorizedId);
  const originalToken = callbackData(originalPrompt, 'nb:batch-section:');
  const pendingRecord = store.state.alnabaBatches.find((batch) => batch.items.some((item) => item.choices?.quran?.file_unique_id === uniqueId));
  assert.ok(pendingRecord, 'the ambiguous file and its message reference are durable before restart');
  assert.equal(pendingRecord.items[0].status, 'awaiting_section');
  assert.ok(JSON.parse(store.backup.json).alnabaBatches.some((batch) => batch.id === pendingRecord.id));

  runtimeHooks.resetAlnabaBatchRuntime();
  store._apply(JSON.parse(store.backup.json));
  await runtimeHooks.resumeAlnabaBatches();
  const recoveredPrompt = lastUiFor(authorizedId);
  const recoveredChoice = buttonsOf(recoveredPrompt).find((button) => button.callback_data.startsWith('nb:batch-section:') && button.callback_data.endsWith(':quran'));
  assert.ok(recoveredChoice, 'restart recovery reissues the section choice instead of publishing an ambiguous file');
  assert.notEqual(recoveredChoice.callback_data, originalToken, 'the restarted prompt gets a fresh, valid callback token');
  assert.equal(store.state.alnaba.quran.filter((item) => item.file_unique_id === uniqueId).length, quranBefore,
    'the file remains private until the owner chooses a section');

  await tap(authorizedId, recoveredChoice.callback_data);
  await waitForAlnabaBatch();
  assert.equal(store.state.alnaba.quran.filter((item) => item.file_unique_id === uniqueId).length, quranBefore + 1,
    'the chosen section is published exactly once after restart');
  assert.equal(store.state.alnabaBatches.find((batch) => batch.id === pendingRecord.id).items[0].status, 'published');
});

test('a failed cancel checkpoint keeps an ambiguous file private and reissues the section choice', async () => {
  const authorizedId = 8270709633;
  const uniqueId = 'fixture_cancel_backup_failure_unique';
  const quranBefore = store.state.alnaba.quran.filter((item) => item.file_unique_id === uniqueId).length;
  await sendAmbiguousForwardAudio(authorizedId, uniqueId);
  const initialPrompt = lastUiFor(authorizedId);
  const cancel = buttonsOf(initialPrompt).find((button) => button.callback_data.startsWith('nb:batch-cancel:'));
  assert.ok(cancel);
  const record = store.state.alnabaBatches.find((batch) => batch.items.some((item) => item.choices?.quran?.file_unique_id === uniqueId));
  const backupBeforeFailure = store.backup.json;

  failBackup = true;
  await tap(authorizedId, cancel.callback_data);
  const restoredPrompt = lastUiFor(authorizedId);
  const quranChoice = buttonsOf(restoredPrompt).find((button) => button.callback_data.startsWith('nb:batch-section:') && button.callback_data.endsWith(':quran'));
  assert.ok(quranChoice, 'a new choice is issued because the cancellation was not durably saved');
  assert.equal(store.state.alnabaBatches.find((batch) => batch.id === record.id).items[0].status, 'awaiting_section');
  assert.equal(store.backup.json, backupBeforeFailure, 'the failed cancellation cannot replace the last durable pending state');
  assert.match([...calls].reverse().find(({ method }) => method === 'answerCallbackQuery')?.payload?.text || '', /تعذّر حفظ الإلغاء/);
  assert.equal(store.state.alnaba.quran.filter((item) => item.file_unique_id === uniqueId).length, quranBefore);

  failBackup = false;
  await tap(authorizedId, quranChoice.callback_data);
  await waitForAlnabaBatch();
  assert.equal(store.state.alnaba.quran.filter((item) => item.file_unique_id === uniqueId).length, quranBefore + 1);
});

test('backup flush reports success only after the pending snapshot is durably saved', async () => {
  const previousSnapshot = store.backup.json;
  const previousPaused = store._backupWritesPaused;
  store.state.handoff_fixture = 'merged snapshot';
  store._backupWritesPaused = true;
  store.persist();
  assert.equal(await store.flushBackup(true), false, 'the handoff barrier blocks ordinary backup writes');
  assert.equal(store.backup.json, previousSnapshot);

  store._backupWritesPaused = false;
  failBackup = true;
  assert.equal(await store.flushBackup(true), false, 'a failed remote save is not reported as durable');
  assert.equal(store.backup.json, previousSnapshot);
  assert.equal(store._backupPending, true, 'a failed save remains pending for retry');

  failBackup = false;
  store._backupWritesPaused = true;
  assert.equal(await store.flushBackup(true), false, 're-closing the handoff barrier leaves the pending write intact');
  assert.equal(store._backupPending, true);
  store._backupWritesPaused = false;
  assert.equal(await store.flushBackup(true), true, 'the retry confirms success only after the mock remote accepts it');
  assert.equal(JSON.parse(store.backup.json).handoff_fixture, 'merged snapshot');
  store._backupWritesPaused = previousPaused;

  const originalBackup = store.backup;
  store.backup = { async load() { return ''; } };
  const emptyBackup = await store.mergeFromBackup();
  assert.equal(emptyBackup.backupLoaded, false, 'an empty pinned snapshot is a read failure, not an empty backup');
  store.backup = originalBackup;
});

test('Telegram backup adapter rejects a replacement until the new snapshot is pinned', async () => {
  const adapter = telegramBackupAdapter(bot.api);
  failBackupPin = true;
  await assert.rejects(adapter.save('{"fixture":"not pinned"}'), /fixture pin failure/);
  failBackupPin = false;
  await adapter.save('{"fixture":"pinned"}');
  assert.ok(calls.some(({ method }) => method === 'pinChatMessage'), 'a confirmed pin is required before the adapter reports success');
});
