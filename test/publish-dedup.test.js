// publishInput idempotency: a stable per-source dedup key (news draft id, quake
// event id, weather hazard+day) must never create two map alerts, no matter how
// many times the caller retries, double-fires, or republishes after a restart
// that lost its in-memory "seen" state. Deleting the alert frees the key, so an
// intentional re-publish still works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-dedup-'));
process.env.NODE_ENV = 'test';

const { store } = await import('../server/store.js');
const { publishInput, buildAlertInput } = await import('../server/bot.js');

const input = (key) => ({
  type: 'explosion', confirm: 'preliminary',
  title: 'انفجار — حماة',
  description: 'انفجار في مدينة حماة',
  location: { scope: 'governorate', name_ar: 'حماة', district_ar: '', governorate_ar: 'حماة', latitude: 35.13, longitude: 36.75 },
  meta: key ? { dedupKey: key } : null,
});

test('the same dedup key never creates two alerts', async () => {
  const before = store.state.alerts.length;
  const a = await publishInput(null, input('news:draft-1'), { toChannel: false });
  const b = await publishInput(null, input('news:draft-1'), { toChannel: false });
  assert.equal(b.id, a.id, 'second publish returns the existing alert');
  assert.equal(store.state.alerts.length, before + 1, 'exactly one alert was created');
});

test('different keys publish independently', async () => {
  const before = store.state.alerts.length;
  const a = await publishInput(null, input('quake:usgs:x1'), { toChannel: false });
  const b = await publishInput(null, input('quake:usgs:x2'), { toChannel: false });
  assert.notEqual(a.id, b.id);
  assert.equal(store.state.alerts.length, before + 2);
});

test('inputs without a key are untouched (no accidental merging)', async () => {
  const before = store.state.alerts.length;
  const a = await publishInput(null, input(null), { toChannel: false });
  const b = await publishInput(null, input(null), { toChannel: false });
  assert.notEqual(a.id, b.id);
  assert.equal(store.state.alerts.length, before + 2);
});

test('deleting the alert frees its dedup key for an intentional re-publish', async () => {
  const a = await publishInput(null, input('weather:storm:2026-11-21'), { toChannel: false });
  store.deleteAlert(a.id);
  const b = await publishInput(null, input('weather:storm:2026-11-21'), { toChannel: false });
  assert.notEqual(b.id, a.id, 're-publish after delete creates a fresh alert');
});

test('buildAlertInput carries the draft id as its dedup key', () => {
  const d = { id: 'd123', source: 'news', type: 'explosion', headline: 'انفجار — حماة', text: 'انفجار في حماة', location: { scope: 'governorate', name_ar: 'حماة', governorate_ar: 'حماة', latitude: 35.13, longitude: 36.75 }, monitoredSources: [] };
  const out = buildAlertInput(d, null);
  assert.equal(out.meta?.dedupKey, 'news:d123');
});
