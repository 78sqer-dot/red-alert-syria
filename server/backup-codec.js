import { gzipSync, gunzipSync } from 'node:zlib';
export const BACKUP_NAME = 'red-alert-syria-backup.json.gz';
export const LEGACY_BACKUP_NAME = 'red-alert-syria-backup.json';
export function encodeBackup(json) {
  if (typeof json !== 'string' || !json.trim()) throw new Error('backup payload is empty');
  const state = JSON.parse(json);
  if (!state || !Array.isArray(state.alerts)) throw new Error('backup state is invalid');
  return gzipSync(Buffer.from(json), { level: 6 });
}
export function decodeBackup(input) {
  const data = Buffer.from(input);
  const raw = data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data, { maxOutputLength: 32 * 1024 * 1024 }) : data;
  const json = raw.toString('utf8');
  if (!json.trim()) throw new Error('backup payload is empty');
  const state = JSON.parse(json);
  if (!state || !Array.isArray(state.alerts)) throw new Error('backup state is invalid');
  return json;
}
export const backupTransfer = { since: new Date().toISOString(), saves: 0, rawBytes: 0, uploadedBytes: 0, lastRawBytes: 0, lastUploadedBytes: 0 };
export function recordBackupTransfer(json, payload) {
  const rawBytes = Buffer.byteLength(json);
  const uploadedBytes = payload.length;
  backupTransfer.saves++; backupTransfer.rawBytes += rawBytes; backupTransfer.uploadedBytes += uploadedBytes;
  backupTransfer.lastRawBytes = rawBytes; backupTransfer.lastUploadedBytes = uploadedBytes;
}
