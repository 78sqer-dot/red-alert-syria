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
const pdfBytes = Buffer.from('%PDF-1.7\nfixture only\n%%EOF\n');
globalThis.fetch = async (url) => {
  assert.match(String(url), /\/file\/bot123456:LOCAL_TEST\/(photos\/fixture-photo\.jpg|documents\/fixture-weekly\.pdf)$/);
  const bytes = String(url).endsWith('.pdf') ? pdfBytes : photoBytes;
  return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
};

const { store } = await import('../server/store.js');
await store.init(null);
store.backup = { async save(json) { this.json = json; } };
store.state.alnaba = { photos: [], weekly: [] };
const { createBot } = await import('../server/bot.js');
const bot = createBot({ token: process.env.BOT_TOKEN });
bot.botInfo = { id: 1, is_bot: true, first_name: 'Fixture bot', username: 'FixtureBot' };
const calls = [];
let messageId = 100;
bot.api.config.use(async (_previous, method, payload) => {
  calls.push({ method, payload: structuredClone(payload) });
  if (method === 'getFile') return { ok: true, result: { file_path: payload.file_id === 'fixture_pdf_id' ? 'documents/fixture-weekly.pdf' : 'photos/fixture-photo.jpg' } };
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
const sendPhoto = (id) => bot.handleUpdate({
  update_id: updateId++,
  message: {
    message_id: ++messageId,
    date: 0,
    chat: { id, type: 'private' },
    from: user(id),
    caption: 'صورة تجريبية للاختبار',
    photo: [{ file_id: 'fixture_photo_id', file_unique_id: 'fixture_photo_unique', file_size: photoBytes.length }],
  },
});
const lastUiFor = (id) => [...calls].reverse().find(({ method, payload }) => method === 'sendMessage' && payload.chat_id === id);
const buttonsOf = (entry) => entry?.payload?.reply_markup?.inline_keyboard?.flat() || [];

after(() => {
  globalThis.fetch = originalFetch;
  clearTimeout(store._saveTimer);
  clearTimeout(store._backupTimer);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the bot offers Al-Nabaa only to 8270709633 and publishes an uploaded photo only after confirmation', async () => {
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

  await tap(deniedId, 'nb:photos');
  assert.equal(buttonsOf(lastUiFor(deniedId)).some((button) => button.callback_data === 'nb:publish'), false);

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
  assert.equal(calls.some(({ method, payload }) => ['sendPhoto', 'sendDocument'].includes(method) && payload.chat_id === '@mock_news_channel'), false,
    'Al-Nabaa uploads do not auto-post files to the Telegram channel');
});
