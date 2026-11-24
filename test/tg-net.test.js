import test from 'node:test';
import assert from 'node:assert/strict';
import { isDefinitiveTelegramRejection } from '../server/tg-net.js';

test('only an explicit Telegram 400 rejection permits a text fallback after sendPhoto', () => {
  assert.equal(isDefinitiveTelegramRejection({ error_code: 400 }), true);
  assert.equal(isDefinitiveTelegramRejection({ error_code: 401 }), false);
  assert.equal(isDefinitiveTelegramRejection({ error_code: 429 }), false);
  assert.equal(isDefinitiveTelegramRejection({ error_code: 500 }), false);
  assert.equal(isDefinitiveTelegramRejection(new Error('Network request failed')), false);
  assert.equal(isDefinitiveTelegramRejection(new Error('timed out')), false);
});
