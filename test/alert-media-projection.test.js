import test from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_MEDIA_MAX_BYTES, mergeAlertMediaItems, publicAlert, sanitizeAlertMedia, sanitizeAlertMediaItems } from '../server/store.js';

const base = { id: 'test-alert', type: 'breaking', title: 'Test alert', timestamp: '2026-11-08T00:00:00.000Z', is_active: true };
const photo = { type: 'photo', file_id: 'secret-photo-file-id', file_unique_id: 'private-photo-unique', bot_role: 'report', mime_type: 'image/jpeg', file_size: 1024 };
const video = { type: 'video', file_id: 'secret-video-file-id', file_unique_id: 'private-video-unique', bot_role: 'admin', mime_type: 'video/mp4', file_size: 2048 };

test('public alert media exposes only its type and opaque cache version', () => {
  const alert = publicAlert({ ...base, media: { ...video } });
  assert.equal(alert.media.type, 'video');
  assert.match(alert.media.version, /^[a-f0-9]{12}$/);
  assert.deepEqual(Object.keys(alert.media).sort(), ['mime_type', 'type', 'version']);
  assert.deepEqual(alert.media_items, [alert.media]);
  assert.equal(JSON.stringify(alert).includes('secret-video-file-id'), false);
  assert.equal(JSON.stringify(alert).includes('private-video-unique'), false);
});

test('public projection exposes both photo and video without Telegram identifiers', () => {
  const alert = publicAlert({ ...base, media: photo, media_items: [photo, video] });
  assert.deepEqual(alert.media_items.map((item) => item.type), ['photo', 'video']);
  assert.deepEqual(alert.media, alert.media_items[0]);
  for (const item of alert.media_items) {
    assert.match(item.version, /^[a-f0-9]{12}$/);
    assert.deepEqual(Object.keys(item).sort(), ['mime_type', 'type', 'version']);
  }
  for (const secret of ['secret-photo-file-id', 'private-photo-unique', 'secret-video-file-id', 'private-video-unique']) {
    assert.equal(JSON.stringify(alert).includes(secret), false, `public output must not contain ${secret}`);
  }
});

test('legacy single attachments remain available as a one-item media list', () => {
  const alert = publicAlert({ ...base, media: { ...photo } });
  assert.equal(alert.media.type, 'photo');
  assert.deepEqual(alert.media_items.map((item) => item.type), ['photo']);
});

test('media list sanitization keeps one item per supported type and replaces only when requested', () => {
  assert.equal(sanitizeAlertMediaItems([photo, { ...photo, file_id: 'duplicate-photo' }, video]).length, 2);
  assert.equal(sanitizeAlertMediaItems([photo, video, { ...photo, file_id: 'third' }]).length, 2);
  const combined = mergeAlertMediaItems([photo], video);
  assert.deepEqual(combined.map((item) => item.type), ['photo', 'video']);
  assert.equal(mergeAlertMediaItems(combined, { ...video, file_id: 'replacement-video' })[1].file_id, video.file_id);
  assert.equal(mergeAlertMediaItems(combined, { ...video, file_id: 'replacement-video' }, { replaceSameType: true })[1].file_id, 'replacement-video');
  assert.equal(sanitizeAlertMediaItems([{ ...video, file_size: ALERT_MEDIA_MAX_BYTES + 1 }]).length, 0);
});

test('media validation rejects unsupported formats, roles, and oversized files', () => {
  assert.equal(sanitizeAlertMedia(photo).type, 'photo');
  assert.equal(sanitizeAlertMedia({ ...photo, file_size: ALERT_MEDIA_MAX_BYTES + 1 }), null);
  assert.equal(sanitizeAlertMedia({ ...photo, type: 'video', mime_type: 'video/quicktime' }), null);
  assert.equal(sanitizeAlertMedia({ ...photo, bot_role: 'other' }), null);
  assert.equal(sanitizeAlertMedia({ ...photo, file_id: '' }), null);
});

test('source documents retain supported image and video formats for the map viewer', () => {
  assert.equal(sanitizeAlertMedia({ ...photo, mime_type: 'image/webp' }).mime_type, 'image/webp');
  assert.equal(sanitizeAlertMedia({ ...photo, mime_type: 'image/png' }).mime_type, 'image/png');
  assert.equal(sanitizeAlertMedia({ ...video, mime_type: 'video/webm' }).mime_type, 'video/webm');
  assert.equal(sanitizeAlertMedia({ ...photo, type: 'video', mime_type: 'video/quicktime' }), null);
});
