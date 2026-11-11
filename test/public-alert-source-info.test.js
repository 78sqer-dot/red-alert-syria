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

test('monitored news hides its feed identity from the public map payload', () => {
  const input = {
    ...base, type: 'attack', source: 'news',
    title: 'قناة الرصد الخاصة: بيان وزارة الصحة في حلب',
    title_en: 'Private Watch Feed: Health Ministry statement in Aleppo',
    description: 'قالت وزارة الصحة السورية إن 3 أشخاص أُصيبوا في حلب مساء اليوم. قناة الرصد الخاصة https://t.me/private_watch/123',
    description_en: 'The Syrian Ministry of Health said 3 people were injured in Aleppo tonight. Private Watch Feed https://t.me/private_watch/123',
    meta: { newsSources: [
      { name: 'قناة الرصد الخاصة', u: 'private_watch', url: 'https://news.example/story', timestamp: '2026-11-02T09:00:00.000Z' },
      { name: 'Private Watch Feed', url: 'https://news.example/english' },
      { name: 'Unsafe', url: 'javascript:alert(1)' },
    ] },
    history: [{ at: '2026-11-02T10:00:00.000Z', kind: 'update', title: 'قناة الرصد الخاصة: تحديث من وزارة الصحة', description: 'قالت وزارة الصحة: لا وفيات جديدة. https://t.me/private_watch/123', is_active: true }],
  };
  const alert = publicAlert(input);
  assert.deepEqual(alert.source_info, { kind: 'publisher', name: 'Red Alert Syria' });
  assert.equal('news_sources' in alert, false);
  assert.equal('meta' in alert, false);
  for (const value of [alert.title, alert.title_en, alert.description, alert.description_en, alert.updates[0].title, alert.updates[0].description]) {
    assert.doesNotMatch(value, /قناة الرصد الخاصة|Private Watch Feed|private_watch|https?:\/\//i);
  }
  assert.match(alert.description, /وزارة الصحة السورية/);
  assert.match(alert.description_en, /Ministry of Health/);
  assert.match(alert.updates[0].description, /وزارة الصحة/);
  assert.equal(input.meta.newsSources.length, 3, 'internal source records remain unchanged');
});

test('political alerts keep source records internally but omit them from the public map payload', () => {
  const sources = Array.from({ length: 7 }, (_, i) => ({
    name: `Source ${i + 1}`,
    url: `https://news.example/${i + 1}`,
    timestamp: '2026-05-06T07:08:09Z',
    internal: 'must not leak',
  }));
  const input = {
    ...base, type: 'political', meta: { secret: 'do not expose', political: {
      category: 'meeting', sources, sourceTimestamp: '2026-05-06T07:08:09Z', private: true,
    } },
  };
  const alert = publicAlert(input);
  assert.equal(alert.political_category, 'meeting');
  assert.equal('political_sources' in alert, false);
  assert.equal('political_source_timestamp' in alert, false);
  assert.deepEqual(alert.source_info, { kind: 'publisher', name: 'Red Alert Syria' });
  assert.equal('meta' in alert, false);
  assert.equal(input.meta.political.sources.length, 7, 'the original internal source records remain intact');
});

test('political map rings use explicitly selected areas only and never infer them from article text', () => {
  const alert = publicAlert({
    ...base,
    type: 'political',
    scope: 'place',
    location: { latitude: 33.5138, longitude: 36.2765, rank: 1, name_ar: 'دمشق', name_en: 'Damascus' },
    place: { name_ar: 'دمشق', name_en: 'Damascus', rank: 1 },
    extra: [{ latitude: 35.531, longitude: 35.79, rank: 1, scope: 'place', name_ar: 'اللاذقية', name_en: 'Latakia' }],
    description: 'مقال سياسي يذكر دمشق ودرعا وحلب وحمص، لكن الموقع المختار دمشق واللاذقية فقط.',
  });
  assert.equal(alert.zones.length, 2);
  assert.deepEqual(alert.zones.map(({ lat, lon }) => [lat, lon]), [[33.5138, 36.2765], [35.531, 35.79]]);

  const generalArticle = publicAlert({
    ...base, type: 'political', title: 'تحليل سياسي عن دمشق وحلب ودرعا', description: 'رأي عام بلا موقع محدد.',
  });
  assert.equal(generalArticle.zones, undefined, 'a locationless article must not get an inferred marker or ring');
});

test('political public payload omits source details and rejects invalid categories', () => {
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
  assert.equal('political_source_timestamp' in alert, false);
  assert.equal('political_sources' in alert, false);
  assert.deepEqual(alert.source_info, { kind: 'publisher', name: 'Red Alert Syria' });
});

test('invalid political categories are omitted and non-political alerts keep publisher attribution', () => {
  const political = publicAlert({ ...base, type: 'political', meta: { political: { category: 'constructor' } } });
  assert.equal(political.political_category, undefined);
  assert.equal('political_sources' in political, false);
  const other = publicAlert({ ...base, meta: { political: { category: 'meeting', sources: [{ name: 'Secret', url: 'https://example.com' }] } } });
  assert.deepEqual(other.source_info, { kind: 'publisher', name: 'Red Alert Syria' });
  assert.equal('political_sources' in other, false);
});
