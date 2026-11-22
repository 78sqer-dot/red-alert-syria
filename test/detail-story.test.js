import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { alertPreviewText } from '../shared/alert-preview.js';
import { DICT } from '../public/js/i18n.js';
import * as types from '../shared/types.js';
const source = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function detailHtml(a)'), source.indexOf('function renderDetail()')).trim();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx = { ...types, alertPreviewText, LANG: 'ar', T: DICT.ar, esc, titleOf: (a) => a.title, descOf: (a) => a.description,
  safeExternalUrl: (s) => /^https?:\/\//.test(s || '') ? s : null,
  isLegacyQuneitraArchiveAlert: () => false, alertDist: () => null, distChip: () => '',
  placeName: (a) => a.place?.name_ar || '', badge: (a) => `<span class="badge">${esc(types.typeOf(a.type).ar)}</span>`,
  fmtFull: new Intl.DateTimeFormat('ar-SY', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Damascus' }),
  fmtTime: new Intl.DateTimeFormat('ar-SY', { timeStyle: 'short', timeZone: 'Asia/Damascus' }),
  fmtNum: (n) => String(n), icon: () => '',
};
export const detailPreviewContext = ctx;
export const renderDetailFixture = vm.runInNewContext('(' + code + ')', ctx);
const fixture = { id: 'example-alert', type: 'explosion', title: 'انفجار — الصنوبر', body: 'سماع دوي انفجار في منطقة صنوبر جبلة', description: 'سماع دوي انفجار في منطقة صنوبر جبلة بريف اللاذقية.', timestamp: '2026-11-22T10:17:00Z', is_active: true, place: { name_ar: 'الصنوبر' }, telegram_url: 'https://t.me/example/1' };
test('channel-link report renders source once without the repeated enriched summary', () => {
  const html = renderDetailFixture(fixture);
  assert.equal(html.split(fixture.body).length - 1, 1);
  assert.ok(!html.includes(fixture.description));
  assert.ok(html.includes('<article class="d-card d-story"'));
  assert.ok(html.includes('<details class="d-card d-meta">'));
  assert.ok(html.includes('data-act="share"'));
  assert.ok(html.includes(fixture.telegram_url));
  assert.ok(html.includes('datetime="2026-11-22T10:17:00Z"'));
});
test('channel-link report retains the complete source and escapes markup', () => {
  const body = 'المصدر: نص كامل <script>test</script>\nمع السطر التالي والأرقام 400 و12.2';
  const html = renderDetailFixture({ ...fixture, body });
  assert.ok(html.includes(esc(body)));
  assert.ok(!html.includes('<script>'));
});
test('a country-scoped report does not invent a location control or coordinates', () => {
  const html = renderDetailFixture({ ...fixture, type: 'political', location: null, scope: 'country', political_category: 'general' });
  assert.ok(html.includes('بلا دبوس'));
  assert.ok(!html.includes('data-act="fly"'));
});
