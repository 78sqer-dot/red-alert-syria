import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-acquisition-attr-'));
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
const { cleanPublicNewsAttribution, cleanAttributedNewsText, missingNamedReportingAttribution, setSourceNames } = await import('../server/clean-text.js');
const { toBotDraft, _test } = await import('../server/news-monitor.js');
const { buildAlertInput, channelPost } = await import('../server/bot.js');
const { store, publicAlert } = await import('../server/store.js');
const raw = 'أفادت معلومات خاصة حصلت عليها قناة حلب اليوم بإجراء تغييرات إدارية. المصدر أكد أن التحقيقات لا تزال مستمرة.';
const draft = () => ({ id: 'synthetic-acquisition', type: 'political', sourceText: raw, sourceTextVersion: 2, headline: 'تغييرات إدارية', body: raw, loc: { scope: 'country', name_ar: 'سوريا', latitude: null, longitude: null }, extra: [], srcs: [{ name: 'حلب اليوم', u: 'private_route', url: 'https://example.invalid/private' }, { name: 'SECRET METADATA NAME' }] });
test('acquisition attribution survives both cleaners and repeated cleanup', () => {
  setSourceNames(['حلب اليوم']);
  try {
    assert.equal(cleanPublicNewsAttribution(raw, ['حلب اليوم']), raw);
    assert.equal(cleanAttributedNewsText(raw, ['حلب اليوم']), raw);
    assert.equal(cleanPublicNewsAttribution(cleanPublicNewsAttribution(raw), ['حلب اليوم']), raw);
  } finally { setSourceNames([]); }
});
test('guard detects outlet or uncertainty loss without inventing evidence', () => {
  assert.equal(missingNamedReportingAttribution(raw, raw), false);
  assert.equal(missingNamedReportingAttribution(raw, raw.replace('قناة حلب اليوم ', '')), true);
  assert.equal(missingNamedReportingAttribution(raw, raw.replace('معلومات خاصة', 'معلومات مؤكدة')), true);
  assert.equal(missingNamedReportingAttribution('تغييرات إدارية.', raw), false);
  const d = draft(); d.sourceText = 'تغييرات إدارية.';
  assert.throws(() => toBotDraft(d, { preservePublishedCopy: true }), /named-reporting-attribution-not-in-original/);
});
test('source-present configured outlet works but metadata and promo are never appended', () => {
  const synthetic = 'معلومات خاصة حصلت عليها شبكة الاختبار حول إغلاق طريق.';
  assert.equal(cleanPublicNewsAttribution(synthetic, ['شبكة الاختبار']), synthetic);
  assert.equal(missingNamedReportingAttribution(synthetic, synthetic.replace('شبكة الاختبار', ''), ['شبكة الاختبار']), true);
  assert.equal(cleanPublicNewsAttribution(raw + '\n\nحلب اليوم\nhttps://example.invalid/subscribe', ['حلب اليوم', 'SECRET METADATA NAME']), raw);
});
test('source-first and reviewed acquisition survive input/store/public/caption, without source metadata', () => {
  for (const d of [draft(), _test.sourceFirstCandidate(draft())]) {
    const input = buildAlertInput(toBotDraft(d, { preservePublishedCopy: true }), null);
    assert.equal(input.body, raw);
    const a = store.addAlert(input); a.channel_format = 3;
    assert.equal(publicAlert(a).body, raw);
    assert.ok(channelPost(a).includes(raw));
    assert.ok(!JSON.stringify(publicAlert(a)).includes('SECRET METADATA NAME'));
    assert.ok(!channelPost(a).includes('private_route'));
  }
});
