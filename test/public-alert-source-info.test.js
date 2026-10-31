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

test('political alerts expose only five validated source links and use the first as source_info', () => {
  const sources = Array.from({ length: 7 }, (_, i) => ({
    name: `Source ${i + 1}`,
    url: `https://news.example/${i + 1}`,
    timestamp: '2026-05-06T07:08:09Z',
    internal: 'must not leak',
  }));
  const alert = publicAlert({
    ...base, type: 'political', meta: { secret: 'do not expose', political: {
      category: 'meeting', sources, sourceTimestamp: '2026-05-06T07:08:09Z', private: true,
    } },
  });
  assert.equal(alert.political_category, 'meeting');
  assert.equal(alert.political_sources.length, 5);
  assert.deepEqual(alert.political_sources[0], {
    name: 'Source 1', url: 'https://news.example/1', timestamp: '2026-05-06T07:08:09.000Z',
  });
  assert.equal(alert.political_source_timestamp, '2026-05-06T07:08:09.000Z');
  assert.deepEqual(alert.source_info, { kind: 'publisher', name: 'Source 1', url: 'https://news.example/1' });
  assert.equal('meta' in alert, false);
});

test('political source sanitizer rejects javascript/data schemes and invalid categories', () => {
  const alert = publicAlert({
    ...base, type: 'political', meta: { political: {
      category: 'not-a-category', sourceTimestamp: 'not-a-date',
      sources: [
        { name: 'Script', url: 'javascript:alert(1)' },
        { name: 'Data', url: 'data:text/html,<script>alert(1)</script>' },
        { name: 'Credential URL', url: 'https://user:pass@news.example/story' },
        { name: 'Safe', url: 'http://news.example/story' },
      ],
    } },
  });
  assert.equal(alert.political_category, undefined);
  assert.equal(alert.political_source_timestamp, undefined);
  assert.deepEqual(alert.political_sources, [{ name: 'Safe', url: 'http://news.example/story' }]);
  assert.deepEqual(alert.source_info, { kind: 'publisher', name: 'Safe', url: 'http://news.example/story' });
});

test('invalid political categories are omitted and non-political alerts keep publisher attribution', () => {
  const political = publicAlert({ ...base, type: 'political', meta: { political: { category: 'constructor' } } });
  assert.equal(political.political_category, undefined);
  assert.deepEqual(political.political_sources, []);
  const other = publicAlert({ ...base, meta: { political: { category: 'meeting', sources: [{ name: 'Secret', url: 'https://example.com' }] } } });
  assert.deepEqual(other.source_info, { kind: 'publisher', name: 'Red Alert Syria' });
  assert.equal('political_sources' in other, false);
});
