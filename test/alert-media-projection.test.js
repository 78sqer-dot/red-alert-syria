import test from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_MEDIA_MAX_BYTES, publicAlert, sanitizeAlertMedia } from '../server/store.js';

const base = { id: 'test-alert', type: 'breaking', title: 'Test alert', timestamp: '2026-11-08T00:00:00.000Z', is_active: true };

test('public alert media exposes only its type and opaque cache version', () => {
  const alert = publicAlert({
    ...base,
    media: { type: 'video', file_id: 'secret-telegram-file-id', file_unique_id: 'private-unique-id', bot_role: 'report', mime_type: 'video/mp4', file_size: 1024 },
  });
  assert.equal(alert.media.type, 'video');
  assert.match(alert.media.version, /^[a-f0-9]{12}$/);
  assert.deepEqual(Object.keys(alert.media).sort(), ['type', 'version']);
  assert.equal(JSON.stringify(alert).includes('secret-telegram-file-id'), false);
  assert.equal(JSON.stringify(alert).includes('private-unique-id'), false);
});

test('media validation rejects unsupported formats, roles, and oversized files', () => {
  const photo = { type: 'photo', file_id: 'id', bot_role: 'admin', mime_type: 'image/jpeg', file_size: 12 };
  assert.equal(sanitizeAlertMedia(photo).type, 'photo');
  assert.equal(sanitizeAlertMedia({ ...photo, file_size: ALERT_MEDIA_MAX_BYTES + 1 }), null);
  assert.equal(sanitizeAlertMedia({ ...photo, type: 'video', mime_type: 'video/quicktime' }), null);
  assert.equal(sanitizeAlertMedia({ ...photo, bot_role: 'other' }), null);
  assert.equal(sanitizeAlertMedia({ ...photo, file_id: '' }), null);
});
