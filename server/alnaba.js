import crypto from 'node:crypto';
import express from 'express';

export const ALNABA_OWNER_ID = 8270709633;
export const ALNABA_MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const ALNABA_MAX_PDF_BYTES = 20 * 1024 * 1024;
export const ALNABA_MAX_AUDIO_VIDEO_BYTES = 20 * 1024 * 1024;
export const ALNABA_PHOTO_EXPIRY_MS = 24 * 60 * 60 * 1000;
export const ALNABA_MAX_ISSUE_NUMBER = 2_147_483_647;
export const ALNABA_CONTENT_SECTIONS = Object.freeze(['photos', 'weekly', 'quran', 'nasheed']);
export const ALNABA_UPLOAD_SECTIONS = Object.freeze([...ALNABA_CONTENT_SECTIONS]);
export const ALNABA_MAX_ARCHIVE_ENTRIES = 250;
const FILE_ID_RE = /^[A-Za-z0-9_-]{1,512}$/;
const UNIQUE_ID_RE = /^[A-Za-z0-9_-]{1,256}$/;
const UUID_RE = /^[\w-]{36}$/;
const PHOTO_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const LIBRARY_MIMES = new Set([
  ...PHOTO_MIMES,
  'application/pdf',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/flac',
  'video/mp4', 'video/webm',
]);
const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'],
  'application/pdf': ['pdf'], 'audio/mpeg': ['mp3'], 'audio/mp4': ['m4a', 'mp4'],
  'audio/ogg': ['ogg', 'oga'], 'audio/wav': ['wav'], 'audio/x-wav': ['wav'],
  'audio/aac': ['aac'], 'audio/flac': ['flac'], 'video/mp4': ['mp4'], 'video/webm': ['webm'],
});
const EXTENSION_MIME = new Map(Object.entries(MIME_EXTENSIONS).flatMap(([mime, extensions]) => extensions.map((extension) => [extension, mime])));
const next = (_req, _res, done) => done();
const PDF_MEDIA_CACHE_TTL_MS = 60_000;
const PDF_MEDIA_CACHE_MAX_ENTRIES = 2;

function cleanTitle(value, max = 180) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanDescription(value, max = 1800) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

function normalizeDigits(value) {
  return String(value ?? '').replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

function parseIssueNumber(value) {
  const normalized = normalizeDigits(value).trim();
  if (!/^\d{1,10}$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isSafeInteger(number) && number > 0 && number <= ALNABA_MAX_ISSUE_NUMBER ? number : null;
}

export function weeklyIssueNumber(item) {
  const stored = parseIssueNumber(item?.issue_number);
  if (stored) return stored;
  const title = normalizeDigits(item?.title || '');
  const match = title.match(/(?:العدد|issue)\s*[:#(\[\-]?\s*(\d{1,10})/iu);
  return match ? parseIssueNumber(match[1]) : null;
}

export function parseWeeklyUploadCaption(caption, fileName = '') {
  const lines = String(caption ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let issueNumber = null;
  const titleLines = [];
  const numberLine = /^(?:(?:رقم\s+العدد|العدد|issue)\s*[:#(]?\s*([0-9٠-٩۰-۹]{1,10})|#\s*([0-9٠-٩۰-۹]{1,10})|([0-9٠-٩۰-۹]{1,10}))\s*[)\]]?\s*(?:[-|–—:]\s*(.*))?$/iu;
  for (const line of lines) {
    const match = line.match(numberLine);
    if (!match || issueNumber !== null) {
      titleLines.push(line);
      continue;
    }
    issueNumber = parseIssueNumber(match[1] || match[2] || match[3]);
    if (!issueNumber) {
      titleLines.push(line);
      continue;
    }
    if (match[4]) titleLines.push(match[4].trim());
  }
  if (issueNumber === null) {
    const name = String(fileName ?? '').replace(/\\/g, '/').split('/').pop() || '';
    const filenameMatch = name.match(/^([0-9٠-٩۰-۹]{1,10})(?=\D|$)/u);
    if (filenameMatch) issueNumber = parseIssueNumber(filenameMatch[1]);
  }
  const title = cleanTitle(titleLines.shift() || (issueNumber ? `العدد ${issueNumber}` : ''));
  const description = cleanDescription(titleLines.join('\n'));
  return { issue_number: issueNumber, title, description };
}

export function mimeFromAlnabaFilename(fileName) {
  const extension = String(fileName ?? '').split(/[./\\]/).pop()?.toLowerCase() || '';
  return EXTENSION_MIME.get(extension) || null;
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

function normalizedMime(value) {
  return String(value ?? '').split(';')[0].trim().toLowerCase();
}

function mimeForSection(section, mime) {
  const normalized = normalizedMime(mime);
  if (section === 'photos') return PHOTO_MIMES.has(normalized) ? normalized : null;
  if (section === 'weekly') return normalized === 'application/pdf' ? normalized : null;
  if (section === 'quran' || section === 'nasheed') return LIBRARY_MIMES.has(normalized) ? normalized : null;
  return null;
}

function maxBytesFor(section, mime) {
  return section === 'photos' ? ALNABA_MAX_PHOTO_BYTES
    : (mime.startsWith('image/') ? ALNABA_MAX_PHOTO_BYTES : ALNABA_MAX_AUDIO_VIDEO_BYTES);
}

function filenameMatchesMime(fileName, mime) {
  const extension = String(fileName ?? '').split('.').pop()?.toLowerCase() || '';
  return (MIME_EXTENSIONS[mime] || []).includes(extension);
}

function validBytes(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) return false;
  if (mime === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (mime === 'application/pdf') return buffer.subarray(0, Math.min(buffer.length, 1024)).includes(Buffer.from('%PDF-'));
  if (mime === 'audio/mpeg') return buffer.subarray(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  if (mime === 'audio/ogg') return buffer.toString('ascii', 0, 4) === 'OggS';
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE';
  if (mime === 'audio/aac') return buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
  if (mime === 'audio/flac') return buffer.toString('ascii', 0, 4) === 'fLaC';
  if (mime === 'audio/mp4' || mime === 'video/mp4') return buffer.toString('ascii', 4, 8) === 'ftyp';
  if (mime === 'video/webm') return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

function safeFileId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return FILE_ID_RE.test(id) ? id : null;
}

function safeSequence(value, fallback = 1) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function sanitizeItem(raw, section, fallbackSequence = 1) {
  if (!raw || typeof raw !== 'object' || raw.section !== section) return null;
  const id = typeof raw.id === 'string' && UUID_RE.test(raw.id) ? raw.id : null;
  const title = cleanTitle(raw.title);
  const fileId = safeFileId(raw.file_id);
  const mimeType = mimeForSection(section, raw.mime_type);
  const fileSize = Number.isSafeInteger(raw.file_size) && raw.file_size > 0 ? raw.file_size : null;
  const maxBytes = mimeType ? maxBytesFor(section, mimeType) : 0;
  const publishedAt = typeof raw.published_at === 'string' && Number.isFinite(Date.parse(raw.published_at))
    ? new Date(raw.published_at).toISOString() : null;
  const updatedAt = typeof raw.updated_at === 'string' && Number.isFinite(Date.parse(raw.updated_at))
    ? new Date(raw.updated_at).toISOString() : null;
  const fileName = cleanFileName(raw.file_name, section === 'weekly' ? 'alnaba-weekly.pdf' : `alnaba.${MIME_EXTENSIONS[mimeType]?.[0] || 'jpg'}`);
  const issueNumber = section === 'weekly' ? parseIssueNumber(raw.issue_number) : null;
  const sequence = safeSequence(raw.sequence, fallbackSequence);
  if (!id || !title || !fileId || !mimeType || !publishedAt || (fileSize !== null && fileSize > maxBytes)) return null;
  if (!filenameMatchesMime(fileName, mimeType)) return null;
  const expires = section === 'photos' && raw.expiry_policy === 'photo-news-24h-v1';
  const description = cleanDescription(raw.description);
  return {
    id,
    section,
    title,
    ...(description ? { description } : {}),
    file_id: fileId,
    ...(typeof raw.file_unique_id === 'string' && UNIQUE_ID_RE.test(raw.file_unique_id) ? { file_unique_id: raw.file_unique_id } : {}),
    mime_type: mimeType,
    ...(fileSize !== null ? { file_size: fileSize } : {}),
    file_name: fileName,
    published_at: publishedAt,
    ...(updatedAt ? { updated_at: updatedAt } : {}),
    sequence,
    ...(section === 'weekly' && issueNumber ? { issue_number: issueNumber } : {}),
    ...(expires ? { expiry_policy: 'photo-news-24h-v1', expires_at: new Date(Date.parse(publishedAt) + ALNABA_PHOTO_EXPIRY_MS).toISOString() } : {}),
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

function maxSequence(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.sequence) || 0), 0);
}

export function sanitizeAlnabaState(value) {
  const src = value && typeof value === 'object' ? value : {};
  const content = Object.fromEntries(ALNABA_CONTENT_SECTIONS.map((section) => [
    section,
    Array.isArray(src[section]) ? src[section].map((item, index) => sanitizeItem(item, section, index + 1)).filter(Boolean) : [],
  ]));
  const archive = Array.isArray(src.archive) ? src.archive.map(sanitizeArchiveEntry).filter(Boolean) : [];
  const rawCounters = src.sequence_counters && typeof src.sequence_counters === 'object' ? src.sequence_counters : {};
  const sequenceCounters = Object.fromEntries(ALNABA_CONTENT_SECTIONS.map((section) => {
    const requested = Number.isSafeInteger(rawCounters[section]) && rawCounters[section] > 0 ? rawCounters[section] : 0;
    return [section, Math.max(requested, maxSequence(content[section]))];
  }));
  return { ...content, archive: archive.slice(0, ALNABA_MAX_ARCHIVE_ENTRIES), sequence_counters: sequenceCounters };
}

export function isAlnabaOwner(actorId) {
  return Number(actorId) === ALNABA_OWNER_ID;
}

export function prepareAlnabaUpload(input) {
  const section = input?.section;
  if (!ALNABA_UPLOAD_SECTIONS.includes(section)) throw new Error('INVALID_SECTION');
  const title = cleanTitle(input?.title);
  if (!title) throw new Error('MISSING_TITLE');
  const fileId = safeFileId(input?.file_id);
  if (!fileId) throw new Error('INVALID_FILE_ID');
  let mimeType = mimeForSection(section, input?.mime_type);
  if (!mimeType) mimeType = mimeForSection(section, mimeFromAlnabaFilename(input?.file_name));
  if (!mimeType) throw new Error('INVALID_MEDIA_TYPE');
  const maxBytes = maxBytesFor(section, mimeType);
  const fileSize = Number.isSafeInteger(input?.file_size) && input.file_size > 0 ? input.file_size : null;
  if (fileSize !== null && fileSize > maxBytes) throw new Error('FILE_TOO_LARGE');
  const fallback = `${section === 'weekly' ? 'alnaba-weekly' : 'alnaba-content'}.${MIME_EXTENSIONS[mimeType]?.[0] || 'bin'}`;
  const fileName = cleanFileName(input?.file_name, fallback);
  if (!filenameMatchesMime(fileName, mimeType)) throw new Error('INVALID_FILE_NAME');
  const fileUniqueId = typeof input?.file_unique_id === 'string' && UNIQUE_ID_RE.test(input.file_unique_id)
    ? input.file_unique_id : undefined;
  const description = cleanDescription(input?.description);
  const issueNumber = section === 'weekly' ? parseIssueNumber(input?.issue_number) : null;
  if (section === 'weekly' && input?.issue_number != null && input.issue_number !== '' && !issueNumber) throw new Error('INVALID_ISSUE_NUMBER');
  return {
    section,
    title,
    ...(description ? { description } : {}),
    file_id: fileId,
    ...(fileUniqueId ? { file_unique_id: fileUniqueId } : {}),
    mime_type: mimeType,
    ...(fileSize !== null ? { file_size: fileSize } : {}),
    file_name: fileName,
    ...(issueNumber ? { issue_number: issueNumber } : {}),
  };
}

export function publishAlnabaItem(store, actorId, input, now = new Date()) {
  if (!isAlnabaOwner(actorId)) throw new Error('FORBIDDEN');
  const clean = prepareAlnabaUpload(input);
  if (clean.section === 'weekly' && !clean.issue_number) throw new Error('MISSING_ISSUE_NUMBER');
  const state = sanitizeAlnabaState(store?.state?.alnaba);
  const current = state[clean.section];
  if (clean.file_unique_id && current.some((item) => item.file_unique_id === clean.file_unique_id)) throw new Error('DUPLICATE_MEDIA');
  if (clean.section === 'weekly' && current.some((item) => weeklyIssueNumber(item) === clean.issue_number)) throw new Error('DUPLICATE_ISSUE_NUMBER');
  const sequence = Math.max(state.sequence_counters[clean.section], maxSequence(current)) + 1;
  const publishedAt = new Date(now).toISOString();
  const item = {
    id: crypto.randomUUID(),
    ...clean,
    published_at: publishedAt,
    sequence,
    ...(clean.section === 'photos' ? {
      expiry_policy: 'photo-news-24h-v1',
      expires_at: new Date(Date.parse(publishedAt) + ALNABA_PHOTO_EXPIRY_MS).toISOString(),
    } : {}),
  };
  state[clean.section] = [...current, item];
  state.sequence_counters[clean.section] = sequence;
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
  if (![...ALNABA_CONTENT_SECTIONS, 'archive'].includes(section) || typeof id !== 'string' || !UUID_RE.test(id)) return null;
  return sanitizeAlnabaState(store?.state?.alnaba)[section].find((item) => item.id === id) || null;
}

export function updateAlnabaEntry(store, actorId, section, id, changes, now = new Date()) {
  if (!isAlnabaOwner(actorId)) throw new Error('FORBIDDEN');
  if (![...ALNABA_CONTENT_SECTIONS, 'archive'].includes(section)) throw new Error('INVALID_SECTION');
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
  if (Object.hasOwn(changes, 'description') && section !== 'archive') updated.description = cleanDescription(changes.description);
  if (section === 'weekly' && Object.hasOwn(changes, 'issue_number')) {
    const issueNumber = parseIssueNumber(changes.issue_number);
    if (!issueNumber) throw new Error('INVALID_ISSUE_NUMBER');
    if (items.some((item, itemIndex) => itemIndex !== index && weeklyIssueNumber(item) === issueNumber)) throw new Error('DUPLICATE_ISSUE_NUMBER');
    updated.issue_number = issueNumber;
  }
  if (section === 'archive' && Object.hasOwn(changes, 'url')) {
    const url = normalizeTelegramLink(changes.url);
    if (items.some((item, itemIndex) => itemIndex !== index && item.url === url)) throw new Error('DUPLICATE_ARCHIVE_LINK');
    updated.url = url;
  }

  if (section !== 'archive' && Object.hasOwn(changes, 'media')) {
    const preservedIssue = section === 'weekly' ? (updated.issue_number || weeklyIssueNumber(current)) : null;
    const media = prepareAlnabaUpload({ ...changes.media, section, title: updated.title, ...(preservedIssue ? { issue_number: preservedIssue } : {}) });
    if (media.file_unique_id && items.some((item, itemIndex) => itemIndex !== index && item.file_unique_id === media.file_unique_id)) throw new Error('DUPLICATE_MEDIA');
    updated = { ...updated, ...media, ...(preservedIssue ? { issue_number: preservedIssue } : {}) };
  }

  updated.updated_at = new Date(now).toISOString();
  state[section] = items.map((item, itemIndex) => itemIndex === index ? updated : item);
  store.state.alnaba = state;
  store.persist();
  return updated;
}

export function deleteAlnabaEntry(store, actorId, section, id) {
  if (!isAlnabaOwner(actorId)) throw new Error('FORBIDDEN');
  if (![...ALNABA_CONTENT_SECTIONS, 'archive'].includes(section)) throw new Error('INVALID_SECTION');
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

function photoIsExpired(item, now) {
  return item?.section === 'photos' && item.expiry_policy === 'photo-news-24h-v1'
    && Number.isFinite(Date.parse(item.expires_at)) && Date.parse(item.expires_at) <= Number(now);
}

export function expireAlnabaPhotos(store, now = Date.now()) {
  const state = sanitizeAlnabaState(store?.state?.alnaba);
  const active = state.photos.filter((item) => !photoIsExpired(item, now));
  const removed = state.photos.length - active.length;
  if (!removed) return 0;
  state.photos = active;
  store.state.alnaba = state;
  store.persist();
  return removed;
}

export function publicAlnabaItem(item) {
  return {
    id: item.id,
    section: item.section,
    title: item.title,
    ...(item.description ? { description: item.description } : {}),
    published_at: item.published_at,
    ...(item.sequence ? { sequence: item.sequence } : {}),
    ...(item.section === 'weekly' && weeklyIssueNumber(item) ? { issue_number: weeklyIssueNumber(item) } : {}),
    ...(item.expires_at ? { expires_at: item.expires_at } : {}),
    mime_type: item.mime_type,
    ...(item.file_size ? { file_size: item.file_size } : {}),
    media_url: `/api/alnaba/media/${item.id}`,
  };
}

function compareAlnabaItems(section, left, right) {
  if (section === 'weekly') {
    const leftIssue = weeklyIssueNumber(left) ?? Number.MAX_SAFE_INTEGER;
    const rightIssue = weeklyIssueNumber(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftIssue !== rightIssue) return leftIssue - rightIssue;
    return (left.sequence || 0) - (right.sequence || 0);
  }
  if (section === 'quran' || section === 'nasheed') {
    return (left.sequence || 0) - (right.sequence || 0)
      || Date.parse(left.published_at) - Date.parse(right.published_at);
  }
  return Date.parse(right.published_at) - Date.parse(left.published_at)
    || (right.sequence || 0) - (left.sequence || 0);
}

export function listPublicAlnabaItems(store, section, limit = 80, offset = 0, now = Date.now()) {
  if (![...ALNABA_CONTENT_SECTIONS, 'archive'].includes(section)) return null;
  const state = sanitizeAlnabaState(store?.state?.alnaba);
  const pageSize = Math.max(1, Math.min(Number(limit) || 80, 100));
  const pageOffset = Math.max(0, Number.isSafeInteger(Number(offset)) ? Number(offset) : 0);
  const items = section === 'photos' ? state.photos.filter((item) => !photoIsExpired(item, now)) : state[section];
  return items.sort((a, b) => section === 'archive'
    ? Date.parse(b.published_at) - Date.parse(a.published_at)
    : compareAlnabaItems(section, a, b))
    .slice(pageOffset, pageOffset + pageSize)
    .map((item) => section === 'archive'
      ? { id: item.id, section: 'archive', title: item.title, url: item.url, published_at: item.published_at }
      : publicAlnabaItem(item));
}

export function findAlnabaItem(store, id, now = Date.now()) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  const state = sanitizeAlnabaState(store?.state?.alnaba);
  for (const section of ALNABA_CONTENT_SECTIONS) {
    const item = state[section].find((entry) => entry.id === id);
    if (item) return section === 'photos' && photoIsExpired(item, now) ? null : item;
  }
  return null;
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
  const maxBytes = maxBytesFor(safeItem.section, safeItem.mime_type);
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

function parseSingleByteRange(header, size) {
  const match = String(header || '').match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

export function createAlnabaRouter({ store, fetchMedia, limiter = next } = {}) {
  const router = express.Router();
  const pdfMediaCache = new Map();
  const pdfMediaPending = new Map();
  const fetchPublicMedia = async (item) => {
    if (item.mime_type !== 'application/pdf') return fetchMedia(item);
    const cacheKey = `${item.id}:${item.file_unique_id || item.file_id}`;
    const now = Date.now();
    const cached = pdfMediaCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      pdfMediaCache.delete(cacheKey);
      pdfMediaCache.set(cacheKey, { ...cached, expiresAt: now + PDF_MEDIA_CACHE_TTL_MS });
      return cached.buffer;
    }
    if (cached) pdfMediaCache.delete(cacheKey);
    let pending = pdfMediaPending.get(cacheKey);
    if (!pending) {
      pending = Promise.resolve().then(() => fetchMedia(item));
      pdfMediaPending.set(cacheKey, pending);
    }
    try {
      const result = await pending;
      const buffer = Buffer.isBuffer(result) ? result : Buffer.from(result);
      if (buffer.length <= ALNABA_MAX_PDF_BYTES) {
        for (const [key, entry] of pdfMediaCache) if (entry.expiresAt <= Date.now()) pdfMediaCache.delete(key);
        pdfMediaCache.set(cacheKey, { buffer, expiresAt: Date.now() + PDF_MEDIA_CACHE_TTL_MS });
        while (pdfMediaCache.size > PDF_MEDIA_CACHE_MAX_ENTRIES) pdfMediaCache.delete(pdfMediaCache.keys().next().value);
      }
      return buffer;
    } finally {
      if (pdfMediaPending.get(cacheKey) === pending) pdfMediaPending.delete(cacheKey);
    }
  };
  router.get('/', limiter, (req, res) => {
    const section = String(req.query.section || '');
    const limit = Math.max(1, Math.min(Number.parseInt(String(req.query.limit || '30'), 10) || 30, 100));
    const rawOffset = Number.parseInt(String(req.query.offset || '0'), 10);
    const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const items = listPublicAlnabaItems(store, section, limit + 1, offset);
    if (!items) return res.status(400).json({ error: 'invalid section' });
    res.setHeader('Cache-Control', 'no-store');
    const hasMore = items.length > limit;
    return res.json({ section, items: hasMore ? items.slice(0, limit) : items, offset, limit, has_more: hasMore, server_time: new Date().toISOString() });
  });
  router.get('/media/:id', limiter, async (req, res) => {
    const item = findAlnabaItem(store, req.params.id);
    if (!item) return res.status(404).end();
    try {
      if (typeof fetchMedia !== 'function') throw new Error('BOT_UNAVAILABLE');
      const buffer = await fetchPublicMedia(item);
      const extension = MIME_EXTENSIONS[item.mime_type]?.[0] || 'bin';
      res.setHeader('Content-Type', item.mime_type);
      res.setHeader('Content-Disposition', `inline; filename="alnaba-${item.id}.${extension}"`);
      res.setHeader('Cache-Control', item.section === 'photos' ? 'no-store' : 'public, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (item.mime_type === 'application/pdf') {
        res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
        res.setHeader('Accept-Ranges', 'bytes');
        const rangeHeader = req.get('range');
        if (rangeHeader) {
          const range = parseSingleByteRange(rangeHeader, buffer.length);
          if (!range) {
            res.setHeader('Content-Range', `bytes */${buffer.length}`);
            res.setHeader('Content-Length', '0');
            return res.status(416).end();
          }
          const partial = buffer.subarray(range.start, range.end + 1);
          res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${buffer.length}`);
          res.setHeader('Content-Length', String(partial.length));
          return res.status(206).end(partial);
        }
      }
      res.setHeader('Content-Length', String(buffer.length));
      return res.status(200).end(buffer);
    } catch (error) {
      console.warn('[alnaba] media delivery failed:', error?.name || 'Error');
      return res.status(503).json({ error: 'media temporarily unavailable' });
    }
  });
  return router;
}
