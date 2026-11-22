import { gunzipSync, brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib';
import { createHash, timingSafeEqual } from 'node:crypto';
export const GZIP_BACKUP_NAME = 'red-alert-syria-backup.json.gz';
export const LEGACY_BACKUP_NAME = 'red-alert-syria-backup.json';
export const BROTLI_BACKUP_NAME = 'red-alert-syria-backup.rasb';
export const BACKUP_NAME = BROTLI_BACKUP_NAME;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
// Version 2 framing: magic, uint32 big-endian raw length, SHA-256 of raw JSON,
// then one Brotli stream. Reader-only release 82f46d7dad remains the minimum
// rollback target: it understands this frame and can write the latest state as gzip.
const BROTLI_MAGIC = Buffer.from('RASB2\r\n\x1a\n', 'ascii');
const BROTLI_HEADER_BYTES = BROTLI_MAGIC.length + 4 + 32;
export function isBackupName(name) {
  return [GZIP_BACKUP_NAME, LEGACY_BACKUP_NAME, BROTLI_BACKUP_NAME].includes(name);
}
export function encodeBackup(json) {
  if (typeof json !== 'string' || !json.trim()) throw new Error('backup payload is empty');
  const state = JSON.parse(json);
  if (!state || !Array.isArray(state.alerts)) throw new Error('backup state is invalid');
  const raw = Buffer.from(json);
  if (raw.length > MAX_OUTPUT_BYTES) throw new Error('backup output length is invalid');
  const header = Buffer.alloc(BROTLI_HEADER_BYTES);
  BROTLI_MAGIC.copy(header);
  header.writeUInt32BE(raw.length, BROTLI_MAGIC.length);
  createHash('sha256').update(raw).digest().copy(header, BROTLI_MAGIC.length + 4);
  const payload = brotliCompressSync(raw, { params: {
    [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
    [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
    [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
  } });
  return Buffer.concat([header, payload]);
}
function decodeFramedBrotli(data) {
  if (data.length < BROTLI_HEADER_BYTES || !data.subarray(0, BROTLI_MAGIC.length).equals(BROTLI_MAGIC)) {
    throw new Error('backup version or header is invalid');
  }
  const length = data.readUInt32BE(BROTLI_MAGIC.length);
  if (!length || length > MAX_OUTPUT_BYTES) throw new Error('backup output length is invalid');
  const payload = data.subarray(BROTLI_HEADER_BYTES);
  const { buffer: raw, engine } = brotliDecompressSync(payload, { maxOutputLength: length, info: true });
  if (raw.length !== length || engine.bytesWritten !== payload.length) throw new Error('backup payload length is invalid');
  const checksum = data.subarray(BROTLI_MAGIC.length + 4, BROTLI_HEADER_BYTES);
  if (!timingSafeEqual(createHash('sha256').update(raw).digest(), checksum)) throw new Error('backup checksum is invalid');
  return raw;
}
export function decodeBackup(input) {
  const data = Buffer.from(input);
  const raw = data.subarray(0, 4).equals(Buffer.from('RASB', 'ascii'))
    ? decodeFramedBrotli(data)
    : data[0] === 0x1f && data[1] === 0x8b
      ? gunzipSync(data, { maxOutputLength: MAX_OUTPUT_BYTES })
      : data;
  const json = raw.toString('utf8');
  if (!json.trim()) throw new Error('backup payload is empty');
  const state = JSON.parse(json);
  if (!state || !Array.isArray(state.alerts)) throw new Error('backup state is invalid');
  return json;
}
export const backupTransfer = { since: new Date().toISOString(), saves: 0, rawBytes: 0, uploadedBytes: 0, lastRawBytes: 0, lastUploadedBytes: 0, skippedIdenticalSaves: 0, avoidedIdenticalPayloadBytes: 0 };
export function recordIdenticalBackupSkip(payloadBytes) {
  backupTransfer.skippedIdenticalSaves++;
  backupTransfer.avoidedIdenticalPayloadBytes += payloadBytes;
}
export function recordBackupTransfer(json, payload) {
  const rawBytes = Buffer.byteLength(json);
  const uploadedBytes = payload.length;
  backupTransfer.saves++; backupTransfer.rawBytes += rawBytes; backupTransfer.uploadedBytes += uploadedBytes;
  backupTransfer.lastRawBytes = rawBytes; backupTransfer.lastUploadedBytes = uploadedBytes;
}
