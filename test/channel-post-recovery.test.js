import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.DATA_DIR = fs.mkdtempSync(os.tmpdir() + '/ras-recovery-');
process.env.BOT_TOKEN = '<redacted>';
process.env.CHANNEL_ID = '@synthetic';
process.env.TELEGRAM_BACKUP = 'false';
const { store } = await import('../server/store.js');
const { config } = await import('../server/config.js');
const { publishInput, retryChannelPost } = await import('../server/bot.js');
const input = { type: 'uav', title: 'اختبار', description: 'خبر اختبار', location: { scope: 'country', name_ar: 'سوريا' } };
function reset() { store.state = { alerts: [], stats: { published: 0 }, log: [] }; store.backup = null; config.channel = '@synthetic'; config.alertImages = false; }
const reject = (code) => { throw Object.assign(new Error('synthetic rejection'), { error_code: code, description: 'synthetic rejection' }); };

test('definitive channel failure records the failure detail (why + tries)', async () => {
  reset();
  const a = await publishInput({ sendMessage: async () => reject(403) }, input);
  assert.equal(a.channel_delivery.status, 'failed');
  assert.equal(a.channel_post_failed, true);
  assert.equal(a.channel_message_id, null);
  assert.equal(a.channel_failure.tries, 1);
  assert.match(a.channel_failure.why, /synthetic rejection/);
});

test('manual retry recovers a definitively failed post and clears the failure state', async () => {
  reset();
  const a = await publishInput({ sendMessage: async () => reject(403) }, input);
  const ok = await retryChannelPost({ sendMessage: async () => ({ message_id: 42 }) }, a.id);
  assert.equal(ok, true);
  const after1 = store.getAlert(a.id);
  assert.equal(after1.channel_message_id, 42);
  assert.equal(after1.channel_delivery.status, 'confirmed');
  assert.equal(after1.channel_post_failed, false);
  assert.equal(after1.channel_failure, null);
  assert.equal(after1.channel_retry_claim, null);
});

test('ambiguous (timeout) delivery is a separate state and is NEVER offered a retry', async () => {
  reset();
  let texts = 0;
  const api = { sendPhoto: async () => { throw new Error('request timed out'); }, sendMessage: async () => { texts++; return { message_id: 8 }; } };
  const a = await publishInput(api, input, { renderSnapshot: async () => Buffer.from('synthetic') });
  assert.equal(a.channel_delivery.status, 'uncertain');
  assert.equal(a.channel_post_failed, false);
  assert.equal(a.channel_failure, undefined);
  assert.equal(texts, 0); // no blind text fallback on an ambiguous photo send
  const r = await retryChannelPost(api, a.id);
  assert.equal(r, 'uncertain');
  assert.equal(texts, 0); // and the retry path sent nothing either
});

test('two simultaneous manual retries: the durable claim lets exactly one send', async () => {
  reset();
  const a = await publishInput({ sendMessage: async () => reject(400) }, input);
  let sends = 0; let release;
  const gate = new Promise((res) => { release = res; });
  const slowApi = { sendMessage: async () => { sends++; await gate; return { message_id: 77 }; } };
  const first = retryChannelPost(slowApi, a.id); // claims synchronously, then sends
  const second = await retryChannelPost(slowApi, a.id);
  assert.equal(second, 'claimed');
  release();
  assert.equal(await first, true);
  assert.equal(sends, 1);
  assert.equal(store.getAlert(a.id).channel_message_id, 77);
});

test('a failed retry releases the claim and counts the attempt', async () => {
  reset();
  const a = await publishInput({ sendMessage: async () => reject(403) }, input);
  const api = { sendMessage: async () => reject(400) };
  assert.equal(await retryChannelPost(api, a.id), false);
  const mid = store.getAlert(a.id);
  assert.equal(mid.channel_failure.tries, 2);
  assert.equal(mid.channel_retry_claim, null); // released — a later manual retry is allowed
  assert.equal(await retryChannelPost({ sendMessage: async () => ({ message_id: 9 }) }, a.id), true);
});

test('retry refuses alerts that are not in a definitive-failure state', async () => {
  reset();
  const okAlert = await publishInput({ sendMessage: async () => ({ message_id: 5 }) }, input);
  assert.equal(await retryChannelPost({ sendMessage: async () => ({ message_id: 6 }) }, okAlert.id), false);
  const plain = store.addAlert({ ...input });
  assert.equal(await retryChannelPost({ sendMessage: async () => ({ message_id: 6 }) }, plain.id), false);
});

after(() => { clearTimeout(store._backupTimer); clearTimeout(store._saveTimer); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });
