// Channel-post recovery: an alert that reaches the map but not the channel is
// a FAILURE, never a silent success. Regression for the 2026-11-18 outage in
// which the publishing bot lost its channel admin rights: Telegram answered
// sendPhoto with 403, the code treated 403 as "maybe delivered" and skipped
// the text fallback, so for hours every alert published to the map only and
// nobody was told. Now: explicit refusals (400/401/403) fall back to text,
// a failed post is flagged on the alert with its reason, and
// retryChannelPost re-posts it once posting works again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-chpost-'));
process.env.NODE_ENV = 'test';

const { store } = await import('../server/store.js');
const { publishInput, retryChannelPost } = await import('../server/bot.js');

const input = () => ({
  type: 'explosion', confirm: 'preliminary',
  title: 'انفجار — إدلب',
  description: 'انفجار عبوة ناسفة قرب دوار المحراب في مدينة إدلب',
  body: 'انفجار عبوة ناسفة قرب دوار المحراب في مدينة إدلب\nأفادت مصادر محلية بسماع دوي انفجار قوي في المدينة دون تسجيل إصابات',
  location: { scope: 'governorate', name_ar: 'إدلب', district_ar: '', governorate_ar: 'إدلب', latitude: 35.93062, longitude: 36.63393 },
  source_name: 'مرصد',
});
const png = async () => Buffer.from('fake-png');
const forbidden = () => Object.assign(new Error('Forbidden: bot is not a member of the channel'), { error_code: 403, description: 'Forbidden: bot is not a member of the channel' });

test('a 403 photo refusal falls back to text, and a total failure is flagged with its reason — never silent', async () => {
  let textCalls = 0;
  const deadApi = {
    sendPhoto: async () => { throw forbidden(); },
    sendMessage: async () => { textCalls++; throw forbidden(); },
  };
  const alert = await publishInput(deadApi, input(), { renderSnapshot: png });
  assert.ok(!alert.channel_message_id, 'no channel post could land');
  assert.equal(textCalls, 1, 'the 403 photo refusal must trigger the text fallback attempt');
  assert.ok(alert.channel_post_failed, 'the failure must be recorded on the alert');
  assert.match(alert.channel_post_failed.why, /Forbidden/);
  assert.equal(alert.channel_post_failed.tries, 1);
});

test('retryChannelPost re-posts a flagged alert once posting works, clears the flag, and never duplicates', async () => {
  const deadApi = { sendPhoto: async () => { throw forbidden(); }, sendMessage: async () => { throw forbidden(); } };
  const alert = await publishInput(deadApi, input(), { renderSnapshot: png });
  assert.ok(alert.channel_post_failed);
  const goodApi = { sendPhoto: async () => ({ message_id: 4242 }), sendMessage: async () => ({ message_id: 4243 }) };
  assert.equal(await retryChannelPost(goodApi, alert.id), true, 'the retry lands the post');
  const after = store.getAlert(alert.id);
  assert.equal(after.channel_message_id, 4242);
  assert.equal(after.channel_post_failed, null, 'the failure flag is cleared');
  assert.equal(await retryChannelPost(goodApi, alert.id), false, 'an already-posted alert is never posted twice');
});

test('the happy path is unchanged: photo post lands, no failure flag', async () => {
  const goodApi = { sendPhoto: async () => ({ message_id: 777 }), sendMessage: async () => ({ message_id: 778 }) };
  const alert = await publishInput(goodApi, input(), { renderSnapshot: png });
  assert.equal(alert.channel_message_id, 777);
  assert.ok(!alert.channel_post_failed);
});
