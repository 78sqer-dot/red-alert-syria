import crypto from 'node:crypto';
import express from 'express';

export const ALNABA_OWNER_ID = 8270709633;
export const ALNABA_MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const ALNABA_MAX_PDF_BYTES = 20 * 1024 * 1024;
export const ALNABA_MAX_ARCHIVE_ENTRIES = 250;
const FILE_ID_RE = /^[A-Za-z0-9_-]{1,512}$/;
const UNIQUE_ID_RE = /^[A-Za-z0-9_-]{1,256}$/;
const UUID_RE = /^[\w-]{36}$/;
const PHOTO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const next = (_req, _res, done) => done();

function cleanTitle(value, max = 180) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeTelegramLink(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 512 || /\s|[\u0000-\u001f\u007f]/u.test(raw)) throw new Error('INVALID_TELEGRAM_LINK');
  let url;
  try { url = new URL(raw); } catch { throw new Error('INVALID_TELEGRAM_LINK'); }
  if (url.protocol !== 'https:' || !['t.me', 'telegram.me'].includes(url.hostname.toLowerCase())
    || url.username || url.password || url.port || url.search || url.hash) throw new Error('INVALID_TELEGRAM_LINK');
  const pathname = url.pathname.replace(/\/+$/, '');
  let match = pathname.match(/^\/([A-Za-z][A-Za-z0-9_]{4,31})$/);
  if (match) return `https://t.me/${match[1]}`;
  match = pathname.match(/^\/\+([A-Za-z0-9_-]{8,128})$/);
  if (match) return `https://t.me/+${match[1]}`;
  match = pathname.match(/^\/joinchat\/([A-Za-z0-9_-]{8,128})$/);
  if (match) return `https://t.me/joinchat/${match[1]}`;
  throw new Error('INVALID_TELEGRAM_LINK');
}

function cleanFileName(value, fallback) {
  const raw = String(value ?? '').replace(/[\\/\u0000-\u001f\u007f]/g, '').trim();
  const name = raw.split(/[\\/]/).pop().replace(/[^\p{L}\p{N} ._()\-]/gu, '').trim().slice(0, 120);
  return name || fallback;
}

function mimeForSection(section, mime) {
  if (section === 'photos') return PHOTO_MIMES.has(mime) ? mime : null;
  if (section === 'weekly') return mime === 'application/pdf' ? mime : null;
  return null;
}

function validBytes(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) return false;
  if (mime === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (mime === 'application/pdf') return buffer.subarray(0, Math.min(buffer.length, 1024)).includes(Buffer.from('%PDF-'));
  return false;
}

function safeFileId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return FILE_ID_RE.test(id) ? id : null;
}

function sanitizeItem(raw, section) {
  if (!raw || typeof raw !== 'object' || raw.section !== section) return null;
  const id = typeof raw.id === 'string' && UUID_RE.test(raw.id) ? raw.id : null;
  const title = cleanTitle(raw.title);
  const fileId = safeFileId(raw.file_id);
  const mimeType = mimeForSection(section, raw.mime_type);
  const fileSize = Number.isSafeInteger(raw.file_size) && raw.file_size > 0 ? raw.file_size : null;
  const maxBytes = section === 'photos' ? ALNABA_MAX_PHOTO_BYTES : ALNABA_MAX_PDF_BYTES;
  const publishedAt = typeof raw.published_at === 'string' && Number.isFinite(Date.parse(raw.published_at))
    ? new Date(raw.published_at).toISOString() : null;
  const updatedAt = typeof raw.updated_at === 'string' && Number.isFinite(Date.parse(raw.updated_at))
    ? new Date(raw.updated_at).toISOString() : null;
  if (!id || !title || !fileId || !mimeType || !publishedAt || (fileSize !== null && fileSize > maxBytes)) return null;
  if (section === 'weekly' && !String(raw.file_name || '').toLowerCase().endsWith('.pdf')) return null;
  return {
    id,
    section,
    title,
    file_id: fileId,
    ...(typeof raw.file_unique_id === 'string' && UNIQUE_ID_RE.test(raw.file_unique_id) ? { file_unique_id: raw.file_unique_id } : {}),
    mime_type: mimeType,
    ...(fileSize !== null ? { file_size: fileSize } : {}),
    file_name: cleanFileName(raw.file_name, section === 'weekly' ? 'alnaba-weekly.pdf' : 'alnaba-photo.jpg'),
    published_at: publishedAt,
    ...(updatedAt ? { updated_at: updatedAt } : {}),
  };
}

function sanitizeArchiveEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && UUID_RE.test(raw.id) ? raw.id : null;
  const title = cleanTitle(raw.title);
  const publishedAt = typeof raw.published_at === 'string' && Number.isFinite(Date.parse(raw.published_at))
    ? new Date(raw.published_at).toISOString() : null;
  const updatedAt = typeof raw.updated_at === 'string' && Number.isFinite(Date.parse(raw.updated_at))
    ? new Date(raw.updated_at).toISOString() : null;
  let url = null;
  try { url = normalizeTelegramLink(raw.url); } catch { /* discard unsafe legacy entries */ }
  if (!id || !title || !url || !publishedAt) return null;
  return { id, section: 'archive', title, url, published_at: publishedAt, ...(updatedAt ? { updated_at: updatedAt } : {}) };
}

export function sanitizeAlnabaState(value) {
  const src = value && typeof value === 'object' ? value : {};
  const photos = Array.isArray(src.photos) ? src.photos.map((item) => sanitizeItem(item, 'photos')).filter(Boolean).slice(0, 200) : [];
  const weekly = Array.isArray(src.weekly) ? src.weekly.map((item) => sanitizeItem(item, 'weekly')).filter(Boolean).slice(0, 100) : [];
  const archive = Array.isArray(src.archive) ? src.archive.map(sanitizeArchiveEntry).filter(Boolean).slice(0, ALNABA_MAX_ARCHIVE_ENTRIES) : [];
  return { photos, weekly, archive };
}

export function isAlnabaOwner(actorId) {
  return Number(actorId) === ALNABA_OWNER_ID;
}

export function prepareAlnabaUpload(input) {
  const section = input?.section;
  if (!['photos', 'weekly'].includes(section)) throw new Error('INVALID_SECTION');
  const title = cleanTitle(input?.title);
  if (!title) throw new Error('MISSING_TITLE');
  const fileId = safeFileId(input?.file_id);
  if (!fileId) throw new Error('INVALID_FILE_ID');
  const mimeType = mimeForSection(section, input?.mime_type);
  if (!mimeType) throw new Error('INVALID_MEDIA_TYPE');
  const maxBytes = section === 'photos' ? ALNABA_MAX_PHOTO_BYTES : ALNABA_MAX_PDF_BYTES;
  const fileSize = Number.isSafeInteger(input?.file_size) && input.file_size > 0 ? input.file_size : null;
  if (fileSize !== null && fileSize > maxBytes) throw new Error('FILE_TOO_LARGE');
  const fileName = cleanFileName(input?.file_name, section === 'weekly' ? 'alnaba-weekly.pdf' : 'alnaba-photo.jpg');
  if (section === 'weekly' && !fileName.toLowerCase().endsWith('.pdf')) throw new Error('INVALID_FILE_NAME');
  const extensionMatches = section !== 'photos' || (
    (mimeType === 'image/jpeg' && /\.(jpe?g)$/i.test(fileName))
    || (mimeType === 'image/png' && /\.png$/i.test(fileName))
    || (mimeType === 'image/webp' && /\.webp$/i.test(fileName))
  );
  if (!extensionMatches) throw new Error('INVALID_FILE_NAME');
  const fileUniqueId = typeof input?.file_unique_id === 'string' && UNIQUE_ID_RE.test(input.file_unique_id)
    ? input.file_unique_id : undefined;
  return {
    section,
    title,
    file_id: fileId,
    ...(fileUniqueId ? { file_unique_id: fileUniqueId } : {}),
    mime_type: mimeType,
    ...(fileSize !== null ? { file_size: fileSize } : {}),
    file_name: fileName,
  };
}

export function publishAlnabaItem(store, actorId, input, now = new Date()) {
  if (!isAlnabaOwner(actorId)) throw new Error('FORBIDDEN');
  const clean = prepareAlnabaUpload(input);
  const state = sanitizeAlnabaState(store?.state?.alnaba);
  const current = state[clean.section];
  if (clean.file_unique_id && current.some((item) => item.file_unique_id === clean.file_unique_id)) throw new Error('DUPLICATE_MEDIA');
  const item = {
    id: crypto.randomUUID(),
    ...clean,
    published_at: new Date(now).toISOString(),
  };
  state[clean.section] = [item, ...current].slice(0, clean.section === 'photos' ? 200 : 100);
  store.state.alnaba = state;
  store.persist();
  return item;
}

export function prepareAlnabaArchiveEntry(input) {
  const rawTitle = String(input?.title ?? '').trim();
  const title = cleanTitle(rawTitle, 181);
  if (!title) throw new Error('MISSING_TITLE');
  if (title.length > 180) throw new Error('TITLE_TOO_LONG');
  return { section: 'archive', title, url: normalizeTelegramLink(input?.url) };
}

export function publishAlnabaArchiveEntry(store, actorId, input, now = new Date()) {
  if (!isAlnabaOwner(actorId)) throw new Error('FORBIDDEN');
  const clean = prepareAlnabaArchiveEntry(input);
  const state = sanitizeAlnabaState(store?.state?.alnaba);
  if (state.archive.some((entry) => entry.url === clean.url)) throw new Error('DUPLICATE_ARCHIVE_LINK');
  const item = { id: crypto.randomUUID(), ...clean, published_at: new Date(now).toISOString() };
  state.archive = [item, ...state.archive].slice(0, ALNABA_MAX_ARCHIVE_ENTRIES);
  store.state.alnaba = state;
  store.persist();
  return item;
}

export function findAlnabaEntry(store, section, id) {
  if (!['photos', 'weekly', 'archive'].includes(section) || typeof id !== 'string' || !UUID_RE.test(id)) return null;
  return sanitizeAlnabaState(store?.state?.alnaba)[section].find((item) => item.id === id) || null;
}

export function updateAlnabaEntry(store, actorId, section, id, changes, now = new Date()) {
  if (!isAlnabaOwner(actorId)) throw new Error('FORBIDDEN');
  if (!['photos', 'weekly', 'archive'].includes(section)) throw new Error('INVALID_SECTION');
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Error('NOT_FOUND');
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) throw new Error('EMPTY_UPDATE');
  if ((section === 'archive' && Object.hasOwn(changes, 'media')) || (section !== 'archive' && Object.hasOwn(changes, 'url'))) throw new Error('INVALID_UPDATE');

  const state = sanitizeAlnabaState(store?.state?.alnaba);
  const items = state[section];
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('NOT_FOUND');
  const current = items[index];
  let updated = { ...current };

  if (Object.hasOwn(changes, 'title')) {
    const rawTitle = String(changes.title ?? '').trim();
    const title = cleanTitle(rawTitle, 181);
    if (!title) throw new Error('MISSING_TITLE');
    if (title.length > 180) throw new Error('TITLE_TOO_LONG');
    updated.title = title;
  }

  if (section === 'archive' && Object.hasOwn(changes, 'url')) {
    const url = normalizeTelegramLink(changes.url);
    if (items.some((item, itemIndex) => itemIndex !== index && item.url === url)) throw new Error('DUPLICATE_ARCHIVE_LINK');
    updated.url = url;
  }

  if (section !== 'archive' && Object.hasOwn(changes, 'media')) {
    const media = prepareAlnabaUpload({ ...changes.media, section, title: updated.title });
    if (media.file_unique_id && items.some((item, itemIndex) => itemIndex !== index && item.file_unique_id === media.file_unique_id)) throw new Error('DUPLICATE_MEDIA');
    updated = { ...updated, ...media };
  }

  updated.updated_at = new Date(now).toISOString();
  state[section] = items.map((item, itemIndex) => itemIndex === index ? updated : item);
  store.state.alnaba = state;
  store.persist();
  return updated;
}

export function deleteAlnabaEntry(store, actorId, section, id) {
  if (!isAlnabaOwner(actorId)) throw new Error('FORBIDDEN');
  if (!['photos', 'weekly', 'archive'].includes(section)) throw new Error('INVALID_SECTION');
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Error('NOT_FOUND');
  const state = sanitizeAlnabaState(store?.state?.alnaba);
  const items = state[section];
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('NOT_FOUND');
  const [deleted] = items.splice(index, 1);
  store.state.alnaba = state;
  store.persist();
  return deleted;
}

export function publicAlnabaItem(item) {
  return {
    id: item.id,
    section: item.section,
    title: item.title,
    published_at: item.published_at,
    mime_type: item.mime_type,
    ...(item.file_size ? { file_size: item.file_size } : {}),
    media_url: `/api/alnaba/media/${item.id}`,
  };
}

export function listPublicAlnabaItems(store, section, limit = 80) {
  if (!['photos', 'weekly', 'archive'].includes(section)) return null;
  return sanitizeAlnabaState(store?.state?.alnaba)[section]
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .slice(0, Math.max(1, Math.min(Number(limit) || 80, 100)))
    .map((item) => section === 'archive'
      ? { id: item.id, section: 'archive', title: item.title, url: item.url, published_at: item.published_at }
      : publicAlnabaItem(item));
}

export function findAlnabaItem(store, id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  const state = sanitizeAlnabaState(store?.state?.alnaba);
  return state.photos.find((item) => item.id === id) || state.weekly.find((item) => item.id === id) || null;
}

async function readBounded(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('FILE_TOO_LARGE');
  if (!response.body) throw new Error('EMPTY_FILE');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('FILE_TOO_LARGE');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

export async function fetchAlnabaTelegramBytes(item, { api, token, fetchImpl = fetch } = {}) {
  if (!item || !api?.getFile || !/^[0-9]+:[A-Za-z0-9_-]+$/.test(String(token || ''))) throw new Error('BOT_UNAVAILABLE');
  let safeItem = null;
  try { safeItem = item.id ? sanitizeItem(item, item.section) : prepareAlnabaUpload(item); } catch { /* invalid upload */ }
  if (!safeItem) throw new Error('INVALID_ITEM');
  const maxBytes = safeItem.section === 'photos' ? ALNABA_MAX_PHOTO_BYTES : ALNABA_MAX_PDF_BYTES;
  const remote = await api.getFile(safeItem.file_id);
  const filePath = typeof remote?.file_path === 'string' ? remote.file_path : '';
  if (!filePath || filePath.length > 1024 || filePath.startsWith('/') || /[\u0000-\u0020\\?#]/.test(filePath) || filePath.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('INVALID_REMOTE_PATH');
  }
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.telegram.org/file/bot${token}/${encodedPath}`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('REMOTE_FILE_UNAVAILABLE');
  const buffer = await readBounded(response, maxBytes);
  if (safeItem.file_size && buffer.length > maxBytes) throw new Error('FILE_TOO_LARGE');
  if (!validBytes(buffer, safeItem.mime_type)) throw new Error('INVALID_FILE_CONTENT');
  return buffer;
}

export function createAlnabaRouter({ store, fetchMedia, limiter = next } = {}) {
  const router = express.Router();
  router.get('/', limiter, (req, res) => {
    const section = String(req.query.section || '');
    const items = listPublicAlnabaItems(store, section, req.query.limit);
    if (!items) return res.status(400).json({ error: 'invalid section' });
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    return res.json({ section, items, server_time: new Date().toISOString() });
  });
  router.get('/media/:id', limiter, async (req, res) => {
    const item = findAlnabaItem(store, req.params.id);
    if (!item) return res.status(404).end();
    try {
      if (typeof fetchMedia !== 'function') throw new Error('BOT_UNAVAILABLE');
      const buffer = await fetchMedia(item);
      const extension = item.section === 'weekly' ? 'pdf' : (item.mime_type.split('/')[1] || 'jpg');
      res.setHeader('Content-Type', item.mime_type);
      res.setHeader('Content-Disposition', `inline; filename="alnaba-${item.id}.${extension}"`);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Length', String(buffer.length));
      return res.status(200).end(buffer);
    } catch (error) {
      console.warn('[alnaba] media delivery failed:', error?.name || 'Error');
      return res.status(503).json({ error: 'media temporarily unavailable' });
    }
  });
  return router;
}
