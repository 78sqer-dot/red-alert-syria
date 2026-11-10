import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  ALNABA_MAX_PDF_BYTES,
  ALNABA_MAX_PHOTO_BYTES,
  createAlnabaRouter,
  fetchAlnabaTelegramBytes,
  isAlnabaOwner,
  listPublicAlnabaItems,
  normalizeTelegramLink,
  prepareAlnabaArchiveEntry,
  prepareAlnabaUpload,
  publishAlnabaArchiveEntry,
  publishAlnabaItem,
  sanitizeAlnabaState,
} from '../server/alnaba.js';

const OWNER = 8270709633;
const PREVIOUS_PROJECT_OWNER = 8808894711;
const TOKEN_FIXTURE = '123456:fixture_token_without_real_credentials';
const photoBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
const pdfBytes = Buffer.from('%PDF-1.7\nfixture only\n%%EOF\n');

function createStore() {
  return {
    state: { alnaba: { photos: [], weekly: [], archive: [] } },
    persistCalls: 0,
    persist() { this.persistCalls += 1; },
  };
}

function fakeTelegram() {
  const files = new Map([
    ['fixture_photo_id', { file_path: 'photos/fixture-photo.jpg', bytes: photoBytes }],
    ['fixture_pdf_id', { file_path: 'documents/fixture-weekly.pdf', bytes: pdfBytes }],
  ]);
  const calls = [];
  const api = {
    async getFile(fileId) {
      calls.push(['getFile', fileId]);
      const file = files.get(fileId);
      if (!file) throw new Error('missing fixture');
      return { file_path: file.file_path };
    },
  };
  const fetchImpl = async (url) => {
    assert.equal(new URL(url).origin, 'https://api.telegram.org');
    const file = [...files.values()].find((entry) => String(url).endsWith(`/${entry.file_path}`));
    if (!file) return new Response('not found', { status: 404 });
    return new Response(file.bytes, {
      status: 200,
      headers: { 'content-length': String(file.bytes.length) },
    });
  };
  return { api, fetchImpl, calls };
}

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const photoUpload = () => ({
  section: 'photos',
  title: 'خبر مصوّر تجريبي',
  file_id: 'fixture_photo_id',
  file_unique_id: 'fixture_photo_unique',
  mime_type: 'image/jpeg',
  file_size: photoBytes.length,
  file_name: 'fixture-photo.jpg',
});

const weeklyUpload = () => ({
  section: 'weekly',
  title: 'العدد الأسبوعي التجريبي',
  file_id: 'fixture_pdf_id',
  file_unique_id: 'fixture_pdf_unique',
  mime_type: 'application/pdf',
  file_size: pdfBytes.length,
  file_name: 'fixture-weekly.pdf',
});

const archiveEntry = () => ({
  title: 'قناة أرشيف تجريبية',
  url: 'https://t.me/ras_fixture_archive_entry_123',
});

test('only 8270709633 can use Al-Nabaa publishing; 8808894711 and nearby IDs are denied', () => {
  const store = createStore();
  assert.equal(isAlnabaOwner(OWNER), true);
  assert.equal(isAlnabaOwner(PREVIOUS_PROJECT_OWNER), false);
  assert.equal(isAlnabaOwner(8808894712), false);
  assert.throws(() => publishAlnabaItem(store, PREVIOUS_PROJECT_OWNER, photoUpload()), { message: 'FORBIDDEN' });
  assert.throws(() => publishAlnabaItem(store, OWNER + 1, photoUpload()), { message: 'FORBIDDEN' });
  assert.throws(() => publishAlnabaArchiveEntry(store, PREVIOUS_PROJECT_OWNER, archiveEntry()), { message: 'FORBIDDEN' });
  assert.deepEqual(store.state.alnaba, { photos: [], weekly: [], archive: [] });
  assert.equal(store.persistCalls, 0);
});

test('archive accepts only direct HTTPS Telegram public or invite links and normalizes their host', () => {
  assert.equal(normalizeTelegramLink('https://telegram.me/RasArchiveFixture/'), 'https://t.me/RasArchiveFixture');
  assert.equal(normalizeTelegramLink('https://t.me/+AbCdEfgh_123-'), 'https://t.me/+AbCdEfgh_123-');
  assert.equal(normalizeTelegramLink('https://t.me/joinchat/AbCdEfgh123456'), 'https://t.me/joinchat/AbCdEfgh123456');
  for (const url of [
    'http://t.me/RasArchiveFixture',
    'https://t.me.evil.example/RasArchiveFixture',
    'https://t.me@evil.example/RasArchiveFixture',
    'https://www.t.me/RasArchiveFixture',
    'https://t.me/RasArchiveFixture?start=payload',
    'https://t.me/RasArchiveFixture#fragment',
    'https://t.me/',
    'javascript:alert(1)',
    'https://t.me/abc',
  ]) assert.throws(() => normalizeTelegramLink(url), { message: 'INVALID_TELEGRAM_LINK' }, url);
  assert.throws(() => prepareAlnabaArchiveEntry({ title: '', url: 'https://t.me/RasArchiveFixture' }), { message: 'MISSING_TITLE' });
  assert.throws(() => prepareAlnabaArchiveEntry({ title: 'x'.repeat(181), url: 'https://t.me/RasArchiveFixture' }), { message: 'TITLE_TOO_LONG' });
});

test('archive entries are deduplicated and survive Al-Nabaa state serialization/restoration', () => {
  const store = createStore();
  const item = publishAlnabaArchiveEntry(store, OWNER, archiveEntry(), new Date('2026-11-10T12:10:00.000Z'));
  assert.equal(item.section, 'archive');
  assert.equal(item.url, 'https://t.me/ras_fixture_archive_entry_123');
  assert.equal(store.persistCalls, 1);
  assert.throws(() => publishAlnabaArchiveEntry(store, OWNER, { ...archiveEntry(), url: 'https://telegram.me/ras_fixture_archive_entry_123/' }), { message: 'DUPLICATE_ARCHIVE_LINK' });
  const restored = sanitizeAlnabaState(JSON.parse(JSON.stringify(store.state.alnaba)));
  assert.deepEqual(restored.archive, [item]);
  assert.deepEqual(restored.photos, []);
  assert.deepEqual(restored.weekly, []);
  assert.deepEqual(sanitizeAlnabaState({ ...store.state.alnaba, archive: [{ ...item, url: 'https://t.me.evil.example/unsafe' }] }).archive, []);
});

test('upload validation enforces allowed section types and size limits', () => {
  assert.doesNotThrow(() => prepareAlnabaUpload(photoUpload()));
  assert.doesNotThrow(() => prepareAlnabaUpload(weeklyUpload()));
  assert.throws(() => prepareAlnabaUpload({ ...photoUpload(), file_size: ALNABA_MAX_PHOTO_BYTES + 1 }), { message: 'FILE_TOO_LARGE' });
  assert.throws(() => prepareAlnabaUpload({ ...weeklyUpload(), file_size: ALNABA_MAX_PDF_BYTES + 1 }), { message: 'FILE_TOO_LARGE' });
  assert.throws(() => prepareAlnabaUpload({ ...photoUpload(), mime_type: 'application/pdf', file_name: 'fixture.pdf' }), { message: 'INVALID_MEDIA_TYPE' });
  assert.throws(() => prepareAlnabaUpload({ ...weeklyUpload(), file_name: 'fixture.txt' }), { message: 'INVALID_FILE_NAME' });
  assert.throws(() => prepareAlnabaUpload({ ...photoUpload(), title: '' }), { message: 'MISSING_TITLE' });
});

test('synthetic owner approval publishes the original photo and PDF to public section URLs only', async () => {
  const store = createStore();
  const telegram = fakeTelegram();
  const photoPreview = prepareAlnabaUpload(photoUpload());
  const pdfPreview = prepareAlnabaUpload(weeklyUpload());

  // Upload verification reads the Telegram-hosted bytes, checks their signatures and preserves them.
  assert.deepEqual(await fetchAlnabaTelegramBytes(photoPreview, { api: telegram.api, token: TOKEN_FIXTURE, fetchImpl: telegram.fetchImpl }), photoBytes);
  assert.deepEqual(await fetchAlnabaTelegramBytes(pdfPreview, { api: telegram.api, token: TOKEN_FIXTURE, fetchImpl: telegram.fetchImpl }), pdfBytes);

  const photo = publishAlnabaItem(store, OWNER, photoPreview, new Date('2026-11-10T12:00:00.000Z'));
  const weekly = publishAlnabaItem(store, OWNER, pdfPreview, new Date('2026-11-10T12:05:00.000Z'));
  const archive = publishAlnabaArchiveEntry(store, OWNER, archiveEntry(), new Date('2026-11-10T12:10:00.000Z'));
  assert.equal(store.persistCalls, 3);
  assert.equal(listPublicAlnabaItems(store, 'photos')[0].id, photo.id);
  assert.equal(listPublicAlnabaItems(store, 'weekly')[0].id, weekly.id);
  assert.equal(listPublicAlnabaItems(store, 'archive')[0].id, archive.id);

  const app = express();
  app.use('/api/alnaba', createAlnabaRouter({
    store,
    fetchMedia: (item) => fetchAlnabaTelegramBytes(item, {
      api: telegram.api,
      token: TOKEN_FIXTURE,
      fetchImpl: telegram.fetchImpl,
    }),
  }));

  await withServer(app, async (base) => {
    const photoListResponse = await fetch(`${base}/api/alnaba?section=photos`, { credentials: 'omit' });
    assert.equal(photoListResponse.status, 200);
    const photoList = await photoListResponse.json();
    assert.equal(photoList.items.length, 1);
    assert.equal(photoList.items[0].media_url, `/api/alnaba/media/${photo.id}`);
    assert.equal(JSON.stringify(photoList).includes('fixture_photo_id'), false);
    assert.equal(JSON.stringify(photoList).includes('fixture_photo_unique'), false);
    assert.equal(JSON.stringify(photoList).includes('file_name'), false);

    const imageResponse = await fetch(`${base}${photoList.items[0].media_url}`, { credentials: 'omit' });
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), photoBytes);

    const weeklyListResponse = await fetch(`${base}/api/alnaba?section=weekly`, { credentials: 'omit' });
    assert.equal(weeklyListResponse.status, 200);
    const weeklyList = await weeklyListResponse.json();
    assert.equal(weeklyList.items[0].media_url, `/api/alnaba/media/${weekly.id}`);
    assert.equal(JSON.stringify(weeklyList).includes('fixture_pdf_id'), false);

    const archiveListResponse = await fetch(`${base}/api/alnaba?section=archive`, { credentials: 'omit' });
    assert.equal(archiveListResponse.status, 200);
    const archiveList = await archiveListResponse.json();
    assert.equal(archiveList.section, 'archive');
    assert.deepEqual(archiveList.items, [{
      id: archive.id,
      section: 'archive',
      title: 'قناة أرشيف تجريبية',
      url: 'https://t.me/ras_fixture_archive_entry_123',
      published_at: '2026-11-10T12:10:00.000Z',
    }]);
    assert.equal(JSON.stringify(archiveList).includes('file_id'), false);

    const pdfResponse = await fetch(`${base}${weeklyList.items[0].media_url}`, { credentials: 'omit' });
    assert.equal(pdfResponse.status, 200);
    assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf');
    assert.match(pdfResponse.headers.get('content-disposition'), /^inline;/);
    assert.deepEqual(Buffer.from(await pdfResponse.arrayBuffer()), pdfBytes);

    assert.equal((await fetch(`${base}/api/alnaba?section=unknown`)).status, 400);
    assert.equal((await fetch(`${base}/api/alnaba/media/not-an-id`)).status, 404);
  });

  // The only Telegram API operation used by the public route is fetching a file; no channel send is possible.
  assert.deepEqual(telegram.calls.filter(([method]) => method !== 'getFile'), []);
  assert.equal(telegram.calls.some(([method]) => method === 'sendPhoto' || method === 'sendDocument'), false);
});

test('invalid file signatures are rejected before an upload can be published', async () => {
  const fake = fakeTelegram();
  const badPdf = { ...weeklyUpload(), file_id: 'fixture_photo_id' };
  await assert.rejects(
    fetchAlnabaTelegramBytes(badPdf, { api: fake.api, token: TOKEN_FIXTURE, fetchImpl: fake.fetchImpl }),
    { message: 'INVALID_FILE_CONTENT' },
  );
});
