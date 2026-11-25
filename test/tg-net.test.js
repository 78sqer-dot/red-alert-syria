import test from 'node:test';
import assert from 'node:assert/strict';
import { isDefinitiveTelegramRejection } from '../server/tg-net.js';

test('explicit Telegram refusals (400/401/403) permit a text fallback after sendPhoto; ambiguous failures do not', () => {
  assert.equal(isDefinitiveTelegramRejection({ error_code: 400 }), true);
  assert.equal(isDefinitiveTelegramRejection({ error_code: 401 }), true);
  // 403 = Telegram answered and refused (e.g. the bot lost channel admin
  // rights): the photo was NOT delivered, so falling back is safe. Treating
  // it as ambiguous once silenced every channel post for hours.
  assert.equal(isDefinitiveTelegramRejection({ error_code: 403 }), true);
  assert.equal(isDefinitiveTelegramRejection({ error_code: 429 }), false);
  assert.equal(isDefinitiveTelegramRejection({ error_code: 500 }), false);
  assert.equal(isDefinitiveTelegramRejection(new Error('Network request failed')), false);
  assert.equal(isDefinitiveTelegramRejection(new Error('timed out')), false);
});
