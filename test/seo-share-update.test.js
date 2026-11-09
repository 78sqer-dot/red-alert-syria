import test from 'node:test';
import assert from 'node:assert/strict';
import { _test } from '../server/seo.js';

const reported = Date.parse('2026-11-09T10:00:00Z');
const corrected = Date.parse('2026-11-09T11:30:00Z');
const ended = Date.parse('2026-11-09T12:15:00Z');

test('share-card update time uses the latest non-publication history entry', () => {
  assert.equal(_test.alertLastUpdate({
    timestamp: new Date(reported).toISOString(),
    history: [
      { kind: 'published', at: '2026-11-09T10:01:00Z' },
      { kind: 'description', at: new Date(corrected).toISOString() },
      { kind: 'ended', at: new Date(ended).toISOString() },
    ],
  }), ended);
});

test('share-card update time stays empty until an alert actually changes', () => {
  assert.equal(_test.alertLastUpdate({ timestamp: new Date(reported).toISOString(), history: [{ kind: 'published', at: '2026-11-09T10:01:00Z' }] }), 0);
  assert.equal(_test.alertLastUpdate({ timestamp: new Date(reported).toISOString(), updated_at: new Date(corrected).toISOString() }), corrected);
});
