import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { captureTelegramMedia, MEDIA_LIMITS, MEDIA_STORAGE_CAP } from '../server/news-media.js';

const fixtures = path.join(import.meta.dirname, 'fixtures', 'news-media');
const dir = () => fs.mkdtemp(path.join(os.tmpdir(), 'ras-media-test-'));
const lookup = async () => [{ address: '149.154.167.220', family: 4 }];
const response = (bytes, mime) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': mime, 'content-length': String(bytes.length) }), body: Readable.toWeb(Readable.from([bytes])) });
const photo = 'https://cdn1.telesco.pe/file/sample.jpg';
const video = 'https://telesco.pe/file/sample.mp4';
const fetchWith = (entries) => async (url) => response(await fs.readFile(entries[url]), url.pathname.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4');

test('isolated image-only fixture is captured and saved with private permissions', async () => {
  const out = await dir(); const bytes = await fs.readFile(path.join(fixtures, 'image-only.jpg'));
  const [m] = await captureTelegramMedia([{ type: 'photo', url: photo }], { directory: out, lookup, fetchImpl: async () => response(bytes, 'image/jpeg') });
  assert.equal(m.status, 'captured'); assert.equal(m.size, bytes.length); assert.deepEqual(await fs.readFile(m.path), bytes);
  assert.equal((await fs.stat(m.path)).mode & 0o777, 0o600); await fs.rm(out, { recursive: true });
});
test('isolated video-only fixture is captured', async () => {
  const out = await dir(); const bytes = await fs.readFile(path.join(fixtures, 'video-only.mp4'));
  const [m] = await captureTelegramMedia([{ type: 'video', url: video }], { directory: out, lookup, fetchImpl: async () => response(bytes, 'video/mp4') });
  assert.equal(m.status, 'captured'); assert.equal(m.mimeType, 'video/mp4'); await fs.rm(out, { recursive: true });
});
test('isolated both-media fixture retains separate items in input order', async () => {
  const out = await dir(); const p = await fs.readFile(path.join(fixtures, 'both-photo.jpg')); const v = await fs.readFile(path.join(fixtures, 'both-video.mp4'));
  const map = new Map([[photo,p],[video,v]]);
  const result = await captureTelegramMedia([{ type: 'photo', url: photo }, { type: 'video', url: video }], { directory: out, lookup, fetchImpl: async (url) => response(map.get(url.href), url.pathname.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4') });
  assert.deepEqual(result.map((m) => m.status), ['captured','captured']); await fs.rm(out, { recursive: true });
});
test('rejects non-HTTPS, non-allowlisted hosts, wrong extensions, and unsafe redirect targets', async () => {
  for (const url of ['http://cdn1.telesco.pe/x.jpg','https://example.com/x.jpg','https://127.0.0.1/x.jpg','https://cdn1.telesco.pe/x.svg']) {
    const [m] = await captureTelegramMedia([{ type: 'photo', url }], { lookup, fetchImpl: async () => assert.fail('must not fetch rejected URL') });
    assert.equal(m.status, 'unavailable');
  }
  const [redirect] = await captureTelegramMedia([{ type: 'photo', url: photo }], { lookup, fetchImpl: async () => ({ status: 302, ok: false, headers: new Headers({ location: 'http://169.254.169.254/latest/meta-data' }) }) });
  assert.equal(redirect.status, 'unavailable');
});
test('rejects wrong MIME, bad magic bytes, and redirects outside allowlist', async () => {
  const [mime] = await captureTelegramMedia([{ type: 'photo', url: photo }], { lookup, fetchImpl: async () => response(Buffer.from('not image'), 'image/png') });
  assert.equal(mime.status, 'unavailable');
  const [bad] = await captureTelegramMedia([{ type: 'photo', url: photo }], { lookup, fetchImpl: async () => response(Buffer.from('not image'), 'image/jpeg') });
  assert.equal(bad.status, 'unavailable');
  const [redirect] = await captureTelegramMedia([{ type: 'photo', url: photo }], { lookup, fetchImpl: async () => ({ status: 302, ok: false, headers: new Headers({ location: 'https://example.com/x.jpg' }) }) });
  assert.equal(redirect.status, 'unavailable');
});
test('enforces strict streaming byte caps even without Content-Length and rejects private DNS results', async () => {
  const huge = Buffer.alloc(MEDIA_LIMITS.photo + 1); huge.set([0xff,0xd8,0xff]);
  const [large] = await captureTelegramMedia([{ type: 'photo', url: photo }], { lookup, fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type':'image/jpeg' }), body: Readable.toWeb(Readable.from([huge])) }) });
  assert.equal(large.error, 'media_too_large');
  const [privateHost] = await captureTelegramMedia([{ type: 'photo', url: photo }], { lookup: async () => [{ address: '10.0.0.1', family: 4 }], fetchImpl: async () => assert.fail('private DNS must be rejected') });
  assert.equal(privateHost.status, 'unavailable');
});

test('terminal cleanup unlinks only captured files beneath the supplied media directory', async () => {
  const root = await dir(); const outside = await dir();
  const insideFile = path.join(root, 'captured.jpg'); const outsideFile = path.join(outside, 'keep.jpg');
  await fs.writeFile(insideFile, 'captured'); await fs.writeFile(outsideFile, 'keep');
  const { unlinkCapturedMedia } = await import('../server/news-media.js');
  await unlinkCapturedMedia([
    { status: 'captured', path: insideFile },
    { status: 'captured', path: outsideFile },
    { status: 'unavailable', path: path.join(root, 'missing') },
  ], { directory: root });
  await assert.rejects(fs.stat(insideFile), { code: 'ENOENT' });
  assert.equal(await fs.readFile(outsideFile, 'utf8'), 'keep');
  await fs.rm(root, { recursive: true }); await fs.rm(outside, { recursive: true });
});

test('storage capacity refusal preserves existing pending media and captures no extra file', async () => {
  const out = await dir(); await fs.writeFile(path.join(out, 'active-pending.jpg'), Buffer.alloc(MEDIA_STORAGE_CAP));
  const bytes = await fs.readFile(path.join(fixtures, 'image-only.jpg'));
  const [m] = await captureTelegramMedia([{ type: 'photo', url: photo }], { directory: out, lookup, fetchImpl: async () => response(bytes, 'image/jpeg') });
  assert.equal(m.status, 'unavailable'); assert.equal(m.error, 'media_storage_full');
  assert.deepEqual((await fs.readdir(out)).sort(), ['active-pending.jpg']);
  await fs.rm(out, { recursive: true });
});
