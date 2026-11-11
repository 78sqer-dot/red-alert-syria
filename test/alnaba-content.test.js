import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  ALNABA_MAX_PDF_BYTES,
  ALNABA_MAX_PHOTO_BYTES,
  ALNABA_MAX_AUDIO_VIDEO_BYTES,
  ALNABA_PHOTO_EXPIRY_MS,
  createAlnabaRouter,
  deleteAlnabaEntry,
  expireAlnabaPhotos,
  fetchAlnabaTelegramBytes,
  findAlnabaItem,
  findAlnabaEntry,
  isAlnabaOwner,
  listPublicAlnabaItems,
  normalizeTelegramLink,
  prepareAlnabaArchiveEntry,
  prepareAlnabaUpload,
  publishAlnabaArchiveEntry,
  publishAlnabaItem,
  parseWeeklyUploadCaption,
  sanitizeAlnabaBatchQueue,
  sanitizeAlnabaState,
  mergeAlnabaBatchQueues,
  updateAlnabaEntry,
  weeklyIssueNumber,
} from '../server/alnaba.js';

const OWNER = 8270709633;
const PREVIOUS_PROJECT_OWNER = 8808894711;
const TOKEN_FIXTURE = '123456:fixture_token_without_real_credentials';
const photoBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
const pdfBytes = Buffer.from('%PDF-1.7\nfixture only\n%%EOF\n');
const oggBytes = Buffer.from('OggSfixture-audio-data');
const mp4Bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(8)]);

function createStore() {
  return {
    state: { alnaba: { photos: [], weekly: [], archive: [] } },
    persistCalls: 0,
    persist() { this.persistCalls += 1; },
  };
}

test('Al-Nabaa batch snapshots sanitize references and preserve pending records during merge/retention', () => {
  const now = Date.now();
  const iso = (value) => new Date(value).toISOString();
  const item = (key, status, updatedAt, fileId = 'fixture_batch_pdf_id') => ({
    key, message_id: Number(key.replace(/\D/g, '')) || 1, section: 'weekly', status,
    candidate: { file_id: fileId, file_unique_id: `${fileId}_unique`, file_size: 42, mime_type: 'application/pdf', file_name: 'issue.pdf', title: 'العدد 1', issue_number: 1, bytes: 'must not survive' },
    attempts: 0, created_at: iso(now), updated_at: iso(updatedAt),
  });
  const record = (id, savedItem, updatedAt = now) => ({
    id, owner_id: OWNER, status: 'processing', created_at: iso(now), updated_at: iso(updatedAt), expires_at: iso(now + 86_400_000),
    items: [savedItem], context: { must_not_survive: true },
  });
  const pending = record('terminal-tie', item('msg-1', 'pending', now), now);
  const published = record('terminal-tie', { ...item('msg-1', 'published', now), published_item_id: '123e4567-e89b-42d3-a456-426614174000' }, now);
  const merged = mergeAlnabaBatchQueues([pending], [published]);
  assert.equal(merged[0].items[0].status, 'published', 'terminal state wins on equal timestamps during handoff');
  assert.equal(merged[0].items[0].candidate.bytes, undefined, 'snapshots never store file bytes or contexts');

  const active = Array.from({ length: 505 }, (_, index) => record(`active-${index}`, item(`msg-${index + 1}`, 'pending', now + index, `fixture_${index}`), now + index));
  const oldTerminal = record('old-terminal', item('old-msg-1', 'failed', now - 31 * 86_400_000), now - 31 * 86_400_000);
  const retained = sanitizeAlnabaBatchQueue([...active, oldTerminal], now);
  assert.equal(retained.length, 505, 'the record cap never silently evicts active batches');
  assert.equal(retained.some((batch) => batch.id === 'old-terminal'), false, 'old terminal records are pruned after retention');
});

function fakeTelegram() {
  const files = new Map([
    ['fixture_photo_id', { file_path: 'photos/fixture-photo.jpg', bytes: photoBytes }],
    ['fixture_pdf_id', { file_path: 'documents/fixture-weekly.pdf', bytes: pdfBytes }],
    ['fixture_quran_id', { file_path: 'audio/quran-recitation.ogg', bytes: oggBytes }],
    ['fixture_nasheed_id', { file_path: 'video/nasheed.mp4', bytes: mp4Bytes }],
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
  issue_number: 1,
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

test('Al-Nabaa entry edits and deletion helpers enforce owner access and preserve validated fields', () => {
  const store = createStore();
  const photo = publishAlnabaItem(store, OWNER, photoUpload(), new Date('2026-11-10T12:00:00.000Z'));
  const archive = publishAlnabaArchiveEntry(store, OWNER, archiveEntry(), new Date('2026-11-10T12:05:00.000Z'));
  const archivePeer = publishAlnabaArchiveEntry(store, OWNER, { title: 'قناة ثانية للاختبار', url: 'https://t.me/another_fixture_archive_01' }, new Date('2026-11-10T12:06:00.000Z'));
  const persistCount = store.persistCalls;
  assert.throws(() => updateAlnabaEntry(store, PREVIOUS_PROJECT_OWNER, 'photos', photo.id, { title: 'No' }), { message: 'FORBIDDEN' });
  assert.throws(() => deleteAlnabaEntry(store, PREVIOUS_PROJECT_OWNER, 'archive', archive.id), { message: 'FORBIDDEN' });
  assert.equal(store.persistCalls, persistCount, 'unauthorized management never mutates state');

  const photoEdit = updateAlnabaEntry(store, OWNER, 'photos', photo.id, { title: 'عنوان معدل للاختبار' }, new Date('2026-11-10T12:10:00.000Z'));
  assert.equal(photoEdit.title, 'عنوان معدل للاختبار');
  assert.equal(photoEdit.updated_at, '2026-11-10T12:10:00.000Z');
  const archiveEdit = updateAlnabaEntry(store, OWNER, 'archive', archive.id, {
    title: 'اسم قناة معدل', url: 'https://telegram.me/ras_fixture_archive_edited/'
  }, new Date('2026-11-10T12:15:00.000Z'));
  assert.equal(archiveEdit.url, 'https://t.me/ras_fixture_archive_edited');
  assert.equal(findAlnabaEntry(store, 'archive', archive.id).title, 'اسم قناة معدل');
  assert.throws(() => updateAlnabaEntry(store, OWNER, 'archive', archive.id, { url: 'https://example.invalid/not-telegram' }), { message: 'INVALID_TELEGRAM_LINK' });
  assert.throws(() => updateAlnabaEntry(store, OWNER, 'archive', archive.id, { url: archivePeer.url }), { message: 'DUPLICATE_ARCHIVE_LINK' });

  const replaced = updateAlnabaEntry(store, OWNER, 'photos', photo.id, {
    media: { ...photoUpload(), file_id: 'fixture_photo_replacement_id', file_unique_id: 'fixture_photo_replacement_unique' },
  }, new Date('2026-11-10T12:20:00.000Z'));
  assert.equal(replaced.file_id, 'fixture_photo_replacement_id');
  assert.equal(replaced.title, 'عنوان معدل للاختبار');
  const restored = sanitizeAlnabaState(JSON.parse(JSON.stringify(store.state.alnaba)));
  assert.equal(restored.photos[0].updated_at, '2026-11-10T12:20:00.000Z');
  assert.equal(restored.archive.find((item) => item.id === archive.id).url, 'https://t.me/ras_fixture_archive_edited');

  const deleted = deleteAlnabaEntry(store, OWNER, 'archive', archive.id);
  assert.equal(deleted.id, archive.id);
  assert.equal(findAlnabaEntry(store, 'archive', archive.id), null);
  deleteAlnabaEntry(store, OWNER, 'archive', archivePeer.id);
  assert.deepEqual(store.state.alnaba.photos.map((item) => item.id), [photo.id]);
  assert.equal(store.state.alnaba.archive.length, 0);
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
  assert.equal(listPublicAlnabaItems(store, 'photos', 80, 0, Date.parse('2026-11-10T13:00:00.000Z'))[0].id, photo.id);
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
    assert.equal(photoList.items[0].expires_at, new Date(Date.parse(photo.published_at) + ALNABA_PHOTO_EXPIRY_MS).toISOString());
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

    const pdfFetchCountBefore = telegram.calls.filter(([method]) => method === 'getFile').length;
    const pdfResponse = await fetch(`${base}${weeklyList.items[0].media_url}`, { credentials: 'omit' });
    assert.equal(pdfResponse.status, 200);
    assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf');
    assert.match(pdfResponse.headers.get('content-disposition'), /^inline;/);
    assert.equal(pdfResponse.headers.get('content-security-policy'), "frame-ancestors 'self'");
    assert.equal(pdfResponse.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(Buffer.from(await pdfResponse.arrayBuffer()), pdfBytes);

    const pdfRangeResponse = await fetch(`${base}${weeklyList.items[0].media_url}`, {
      credentials: 'omit', headers: { Range: 'bytes=0-7' },
    });
    assert.equal(pdfRangeResponse.status, 206);
    assert.equal(pdfRangeResponse.headers.get('accept-ranges'), 'bytes');
    assert.equal(pdfRangeResponse.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(pdfRangeResponse.headers.get('content-range'), `bytes 0-7/${pdfBytes.length}`);
    assert.deepEqual(Buffer.from(await pdfRangeResponse.arrayBuffer()), pdfBytes.subarray(0, 8));

    const pdfSuffixResponse = await fetch(`${base}${weeklyList.items[0].media_url}`, {
      credentials: 'omit', headers: { Range: 'bytes=-4' },
    });
    assert.equal(pdfSuffixResponse.status, 206);
    assert.equal(pdfSuffixResponse.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(pdfSuffixResponse.headers.get('content-range'), `bytes ${pdfBytes.length - 4}-${pdfBytes.length - 1}/${pdfBytes.length}`);
    assert.deepEqual(Buffer.from(await pdfSuffixResponse.arrayBuffer()), pdfBytes.subarray(-4));
    const invalidRange = await fetch(`${base}${weeklyList.items[0].media_url}`, {
      credentials: 'omit', headers: { Range: `bytes=${pdfBytes.length + 1}-` },
    });
    assert.equal(invalidRange.status, 416);
    assert.equal(invalidRange.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(invalidRange.headers.get('content-range'), `bytes */${pdfBytes.length}`);
    assert.equal(telegram.calls.filter(([method]) => method === 'getFile').length, pdfFetchCountBefore + 1,
      'the same PDF is downloaded from Telegram only once while its bounded range cache is warm');

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


const fixtureItem = (section, index) => {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const media = section === 'weekly' ? { mime_type: 'application/pdf', file_name: `issue-${index}.pdf` }
    : section === 'photos' ? { mime_type: 'image/jpeg', file_name: `photo-${index}.jpg` }
      : section === 'quran' ? { mime_type: 'audio/ogg', file_name: `quran-${index}.ogg` }
        : { mime_type: 'video/mp4', file_name: `nasheed-${index}.mp4` };
  return {
    id, section, title: section === 'weekly' ? `صحيفة العدد ${index}` : `${section} ${index}`,
    file_id: `fixture_${section}_${index}`, ...media,
    published_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    sequence: index,
    ...(section === 'weekly' ? { issue_number: index } : {}),
  };
};

test('legacy photo news never expires retroactively; new photo news expires exactly 24 hours after publish and survives restore', async () => {
  const store = createStore();
  const legacy = {
    id: '00000000-0000-4000-8000-999999999999', section: 'photos', title: 'خبر قديم قائم',
    file_id: 'fixture_photo_id', file_unique_id: 'legacy_photo_unique', mime_type: 'image/jpeg',
    file_size: photoBytes.length, file_name: 'legacy-photo.jpg', published_at: '2020-01-01T00:00:00.000Z',
  };
  store.state.alnaba.photos = [legacy];
  const publishedAt = new Date('2026-11-01T10:00:00.000Z');
  const newPhoto = publishAlnabaItem(store, OWNER, { ...photoUpload(), file_id: 'fixture_new_photo_id', file_unique_id: 'new_photo_unique' }, publishedAt);
  assert.equal(newPhoto.expires_at, new Date(publishedAt.getTime() + ALNABA_PHOTO_EXPIRY_MS).toISOString());
  const beforeExpiry = publishedAt.getTime() + ALNABA_PHOTO_EXPIRY_MS - 1;
  const expiryTime = publishedAt.getTime() + ALNABA_PHOTO_EXPIRY_MS;
  assert.deepEqual(listPublicAlnabaItems(store, 'photos', 20, 0, beforeExpiry).map((item) => item.id), [newPhoto.id, legacy.id]);
  assert.deepEqual(listPublicAlnabaItems(store, 'photos', 20, 0, expiryTime).map((item) => item.id), [legacy.id]);
  assert.equal(findAlnabaItem(store, newPhoto.id, expiryTime), null);
  assert.equal(findAlnabaItem(store, legacy.id, expiryTime).id, legacy.id);

  const durableSnapshot = JSON.parse(JSON.stringify(store.state.alnaba));
  const restored = createStore();
  restored.state.alnaba = sanitizeAlnabaState(durableSnapshot);
  assert.equal(findAlnabaItem(restored, newPhoto.id, expiryTime), null, 'expiry is calculated from persisted publish time and marker after restart');
  assert.equal(findAlnabaItem(restored, legacy.id, expiryTime).id, legacy.id, 'legacy stories without the opt-in marker remain available');
  assert.equal(expireAlnabaPhotos(restored, expiryTime), 1);
  assert.deepEqual(restored.state.alnaba.photos.map((item) => item.id), [legacy.id]);

  let mediaFetches = 0;
  const app = express();
  app.use('/api/alnaba', createAlnabaRouter({ store: restored, fetchMedia: async () => { mediaFetches += 1; return photoBytes; } }));
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/alnaba?section=photos`)).headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${base}/api/alnaba/media/${newPhoto.id}`)).status, 404);
    const legacyResponse = await fetch(`${base}/api/alnaba/media/${legacy.id}`);
    assert.equal(legacyResponse.status, 200);
    assert.equal(legacyResponse.headers.get('cache-control'), 'no-store');
  });
  assert.equal(mediaFetches, 1, 'expired media is rejected before any Telegram-media lookup');
});

test('weekly PDFs are numbered independently and sort 5, 2, 1 as 1, 2, 5 through edits and restore', () => {
  const store = createStore();
  const orderedUploads = [5, 2, 1].map((number) => ({
    ...weeklyUpload(), title: `عنوان العدد ${number}`, file_id: `fixture_pdf_${number}`,
    file_unique_id: `weekly_unique_${number}`, file_name: `issue-${number}.pdf`, issue_number: number,
  }));
  for (let index = 0; index < orderedUploads.length; index += 1) {
    publishAlnabaItem(store, OWNER, orderedUploads[index], new Date(Date.UTC(2026, 10, 1, 0, index)));
  }
  assert.deepEqual(listPublicAlnabaItems(store, 'weekly', 10).map((item) => item.issue_number), [1, 2, 5]);
  assert.throws(() => publishAlnabaItem(store, OWNER, { ...orderedUploads[0], file_id: 'another_pdf', file_unique_id: 'another_unique' }), { message: 'DUPLICATE_ISSUE_NUMBER' });
  const issueOne = store.state.alnaba.weekly.find((item) => weeklyIssueNumber(item) === 1);
  updateAlnabaEntry(store, OWNER, 'weekly', issueOne.id, { title: 'عنوان العدد الأول بعد التعديل' });
  const restored = sanitizeAlnabaState(JSON.parse(JSON.stringify(store.state.alnaba)));
  assert.equal(restored.weekly.find((item) => item.id === issueOne.id).issue_number, 1);
  assert.deepEqual(listPublicAlnabaItems({ state: { alnaba: restored } }, 'weekly', 10).map((item) => item.issue_number), [1, 2, 5]);
  assert.deepEqual(parseWeeklyUploadCaption('٥\nصحيفة النبأ', 'edition.pdf'), { issue_number: 5, title: 'صحيفة النبأ', description: '' });
  assert.deepEqual(parseWeeklyUploadCaption('صحيفة النبأ\nرقم العدد: ٢', 'edition.pdf'), { issue_number: 2, title: 'صحيفة النبأ', description: '' });
  assert.deepEqual(parseWeeklyUploadCaption('', '500.pdf'), { issue_number: 500, title: 'العدد 500', description: '' });
});

test('Quran remains stored but private while nasheed accepts media and stays publicly listed', async () => {
  const store = createStore();
  const telegram = fakeTelegram();
  const quranPreview = prepareAlnabaUpload({
    section: 'quran', title: 'تلاوة للاختبار', description: 'سورة البقرة', file_id: 'fixture_quran_id',
    file_unique_id: 'quran_unique', mime_type: 'audio/ogg', file_name: 'quran-recitation.ogg', file_size: oggBytes.length,
  });
  const nasheedPreview = prepareAlnabaUpload({
    section: 'nasheed', title: 'نشيد للاختبار', description: 'وصف النشيد', file_id: 'fixture_nasheed_id',
    file_unique_id: 'nasheed_unique', mime_type: 'video/mp4', file_name: 'nasheed.mp4', file_size: mp4Bytes.length,
  });
  assert.doesNotThrow(() => prepareAlnabaUpload({ ...quranPreview, file_size: ALNABA_MAX_AUDIO_VIDEO_BYTES }));
  assert.throws(() => prepareAlnabaUpload({ ...quranPreview, file_size: ALNABA_MAX_AUDIO_VIDEO_BYTES + 1 }), { message: 'FILE_TOO_LARGE' });
  assert.deepEqual(await fetchAlnabaTelegramBytes(quranPreview, { api: telegram.api, token: TOKEN_FIXTURE, fetchImpl: telegram.fetchImpl }), oggBytes);
  assert.deepEqual(await fetchAlnabaTelegramBytes(nasheedPreview, { api: telegram.api, token: TOKEN_FIXTURE, fetchImpl: telegram.fetchImpl }), mp4Bytes);
  const quran = publishAlnabaItem(store, OWNER, quranPreview, new Date('2026-11-10T10:00:00.000Z'));
  const nasheed = publishAlnabaItem(store, OWNER, nasheedPreview, new Date('2026-11-10T11:00:00.000Z'));
  assert.equal(quran.sequence, 1);
  assert.equal(nasheed.sequence, 1);
  assert.equal(sanitizeAlnabaState(JSON.parse(JSON.stringify(store.state.alnaba))).quran[0].description, 'سورة البقرة');
  assert.equal(store.state.alnaba.quran[0].id, quran.id, 'the Quran record remains stored for private bot management');

  const app = express();
  app.use('/api/alnaba', createAlnabaRouter({
    store,
    fetchMedia: (item) => fetchAlnabaTelegramBytes(item, { api: telegram.api, token: TOKEN_FIXTURE, fetchImpl: telegram.fetchImpl }),
  }));
  await withServer(app, async (base) => {
    const quranResponse = await fetch(`${base}/api/alnaba?section=quran&limit=1`);
    assert.equal(quranResponse.status, 404, 'Quran items are not exposed through the public listing API');
    const audioResponse = await fetch(`${base}/api/alnaba/media/${quran.id}`);
    assert.equal(audioResponse.status, 404, 'Quran media remains private');
    const nasheedItem = listPublicAlnabaItems(store, 'nasheed')[0];
    const videoResponse = await fetch(`${base}${nasheedItem.media_url}`);
    assert.equal(videoResponse.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await videoResponse.arrayBuffer()), mp4Bytes);
  });
});

test('sanitization and public pagination retain more than former section caps', async () => {
  const data = {
    photos: Array.from({ length: 205 }, (_, index) => fixtureItem('photos', index + 1)),
    weekly: Array.from({ length: 105 }, (_, index) => fixtureItem('weekly', index + 1)),
    quran: Array.from({ length: 125 }, (_, index) => fixtureItem('quran', index + 1)),
    nasheed: Array.from({ length: 135 }, (_, index) => fixtureItem('nasheed', index + 1)),
    archive: [],
  };
  const normalized = sanitizeAlnabaState(data);
  assert.equal(normalized.photos.length, 205);
  assert.equal(normalized.weekly.length, 105);
  assert.equal(normalized.quran.length, 125);
  assert.equal(normalized.nasheed.length, 135);
  const store = createStore();
  store.state.alnaba = normalized;
  assert.deepEqual(listPublicAlnabaItems(store, 'quran', 20, 100).map((item) => item.sequence), Array.from({ length: 20 }, (_, index) => index + 101));
  const app = express();
  app.use('/api/alnaba', createAlnabaRouter({ store }));
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/alnaba?section=nasheed&limit=20&offset=100`);
    const page = await response.json();
    assert.equal(page.items.length, 20);
    assert.equal(page.items[0].sequence, 101);
    assert.equal(page.has_more, true);
    const finalPage = await fetch(`${base}/api/alnaba?section=nasheed&limit=20&offset=120`).then((res) => res.json());
    assert.equal(finalPage.items.length, 15);
    assert.equal(finalPage.has_more, false);
  });
});
