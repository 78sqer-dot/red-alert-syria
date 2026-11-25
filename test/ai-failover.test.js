import test from 'node:test';
import assert from 'node:assert/strict';
import { callBackupAI, classifyBatchAI, cutText } from '../server/news-ai.js';

const geminiOk = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ i: 1, event: false, type: 'none' }]) }] } }] }) });
const geminiDown = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'overloaded' } }) });
const backupOk = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ results: [{ i: 1, event: true, type: 'explosion' }] }) } }] }) });
const backupDown = async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'unavailable' } }) });
const router = (g, b) => async (url) => (String(url).includes('generativelanguage.googleapis.com') ? g() : b());
const prompt = { sys: 'sys', user: 'user' };

test('backup provider unwraps the {results:[...]} object into the shared array shape', async () => {
  const out = await callBackupAI(prompt, { key: 'k', fetchImpl: backupOk });
  assert.deepEqual(out, [{ i: 1, event: true, type: 'explosion' }]);
});

test('backup provider throws on HTTP failure', async () => {
  await assert.rejects(() => callBackupAI(prompt, { key: 'k', fetchImpl: backupDown }), /HTTP 503/);
});

test('failover: Gemini down -> backup serves, provider reported honestly', async () => {
  const out = await classifyBatchAI(prompt, { key: 'g', models: ['m1'], backupKey: 'b', fetchImpl: router(geminiDown, backupOk) });
  assert.equal(out.provider, 'backup');
  assert.equal(out.results[0].type, 'explosion');
});

test('failover: Gemini up -> backup untouched', async () => {
  let backupCalled = false;
  const fetchImpl = async (url) => { if (!String(url).includes('generativelanguage.googleapis.com')) { backupCalled = true; return backupOk(); } return geminiOk(); };
  const out = await classifyBatchAI(prompt, { key: 'g', models: ['m1'], backupKey: 'b', fetchImpl });
  assert.equal(out.provider, 'gemini');
  assert.equal(backupCalled, false);
});

test('failover: every provider down -> typed AI_PROVIDERS_DOWN (no silent degradation)', async () => {
  await assert.rejects(
    () => classifyBatchAI(prompt, { key: 'g', models: ['m1'], backupKey: 'b', fetchImpl: router(geminiDown, backupDown) }),
    (e) => e.code === 'AI_PROVIDERS_DOWN',
  );
  await assert.rejects(
    () => classifyBatchAI(prompt, { fetchImpl: router(geminiDown, backupDown) }),
    (e) => e.code === 'AI_PROVIDERS_DOWN',
  );
});

test('cutText never slices mid-word', () => {
  const out = cutText('انفجار كبير في مدينة حلب الشهباء اليوم', 20);
  assert.ok(out.endsWith('…'));
  assert.ok(!out.slice(0, -1).endsWith(' '));
  assert.equal(cutText('قصير', 20), 'قصير');
});
