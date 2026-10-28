import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAlert } from '../server/store.js';

const base = { id: 'test-alert', type: 'breaking', title: 'Test', timestamp: '2026-01-01T00:00:00.000Z', is_active: true };

test('weather alerts identify Open-Meteo as the data provider', () => {
  assert.deepEqual(publicAlert({ ...base, source: 'weather' }).source_info, {
    kind: 'provider', name: 'Open-Meteo', url: 'https://open-meteo.com/',
  });
});

test('earthquake alerts expose only recognized EMSC and USGS providers', () => {
  assert.equal(publicAlert({ ...base, type: 'quake', source: 'quake', meta: { src: 'emsc' } }).source_info.name, 'EMSC');
  assert.equal(publicAlert({ ...base, type: 'quake', source: 'quake', meta: { src: 'usgs' } }).source_info.name, 'USGS');
  assert.equal(publicAlert({ ...base, type: 'quake', source: 'quake', meta: { src: 'unknown' } }).source_info.kind, 'publisher');
});

test('other alerts identify the publisher without claiming independent verification', () => {
  const alert = publicAlert({ ...base, source: 'telegram' });
  assert.deepEqual(alert.source_info, { kind: 'publisher', name: 'Red Alert Syria' });
  assert.equal('verification_status' in alert, false);
});
