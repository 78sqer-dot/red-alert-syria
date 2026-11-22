import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBackup, decodeBackup, BACKUP_NAME, LEGACY_BACKUP_NAME } from '../server/backup-codec.js';
const state = { alerts: [{ id: 'synthetic', description: 'خبر تجريبي '.repeat(400) }], news: { drafts: {}, handled: { 'test/1': 123 } }, settings: { project: {} } };
test('compressed backup is lossless and substantially smaller, including Arabic and ledgers', () => {
  const json = JSON.stringify(state); const encoded = encodeBackup(json);
  assert.equal(decodeBackup(encoded), json);
  assert.deepEqual(JSON.parse(decodeBackup(encoded)), state);
  assert.ok(encoded.length < Buffer.byteLength(json) / 4);
  assert.notEqual(BACKUP_NAME, LEGACY_BACKUP_NAME);
});
test('legacy plain JSON backups remain readable', () => assert.deepEqual(JSON.parse(decodeBackup(Buffer.from(JSON.stringify(state)))), state));
test('empty, malformed, corrupt and non-state backups fail closed', () => {
  for (const input of ['', 'garbage', '{}', '{"alerts":null}']) {
    assert.throws(() => encodeBackup(input)); assert.throws(() => decodeBackup(Buffer.from(input)));
  }
  const encoded = encodeBackup(JSON.stringify(state));
  assert.throws(() => decodeBackup(encoded.subarray(0, encoded.length - 5)));
});
