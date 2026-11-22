import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-source-first-'));
process.env.DATA_DIR = dir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
const { store } = await import('../server/store.js');
await store.init(null);
const { _test } = await import('../server/news-monitor.js');
const { refineType } = await import('../server/news-ai.js');
const { cleanPublicNewsAttribution } = await import('../server/clean-text.js');
const replays = JSON.parse(fs.readFileSync(new URL('./fixtures/source-first-replays.json', import.meta.url)));
test.after(async () => { await new Promise((r) => setTimeout(r, 350)); fs.rmSync(dir, { recursive: true, force: true }); });
for (const [id, d] of Object.entries(replays)) {
  test(`replay ${id}: source roles, complete body, deterministic heading`, async () => {
    const places = _test.buildLocations({ places: [d.loc, ...(d.extra || [])].filter(Boolean).map((l) => ({ name: l.name_ar, gov: l.governorate_ar })) }, { text: d.sourceText });
    const type = refineType(d.type, d.sourceText);
    const input = { ...d, type, loc: places[0] || d.loc, extra: places.slice(1) };
    if (id === '1445') {
      assert.ok(!places.some((l) => l.name_ar === d.loc.name_ar && Number.isFinite(l.latitude)), 'the security directorate cannot lend its city pin');
      assert.ok(places.some((l) => l.name_ar.includes('العتال') && l.latitude === null), 'unknown village stays as text');
    }
    const candidate = _test.sourceFirstCandidate(input);
    assert.equal(candidate.body, cleanPublicNewsAttribution(d.sourceText, d.srcs.map((s) => s.name)));
    assert.equal(candidate.headline, `${(await import('../shared/types.js')).typeOf(type).ar} — ${input.loc.name_ar}`);
    const payload = await _test.automaticPublicDraft(input);
    assert.equal(payload.body, candidate.body);
    if (id === '1439') assert.equal(type, 'uav');
    if (id === '1441') assert.equal(type, 'arrest');
    if (id === '1442') assert.ok(!places.some((l) => /ازرع|إزرع/.test(l.name_ar)));
    const swapped = { ...candidate, body: candidate.body.split('3').join('14').split('14').join('3') + ' تغيير' };
    assert.deepEqual(_test.sourceFirstGate(input, swapped), { ok: false, reason: 'source-copy-changed' });
  });
}
test('same-number actor swap is refused even though entities and numbers survive', () => {
  const d = { type: 'clashes', headline: 'generated', sourceText: 'قالت الشرطة: أصيب 3 أشخاص باشتباكات عائلية في حمص واعتقلت الشرطة 14 شخصاً.', srcs: [{ name: 'اختبار' }], loc: { name_ar: 'حمص', scope: 'place' } };
  const c = _test.sourceFirstCandidate(d);
  const bad = { ...c, body: 'قالت الشرطة: أصابت الشرطة 3 أشخاص في حمص واعتقلت العائلات 14 شخصاً.' };
  assert.equal(_test.sourceFirstGate(d, bad).reason, 'source-copy-changed');
  assert.equal(_test.sourceFirstGate(d, c).ok, true);
});
test('directorate, hometown and hospital alone do not supply incident pins', () => {
  for (const text of ['مديرية أمن حمص تدخلت لفض نزاع في قرية غيرمدرجة.', 'أصيب رجل في حلب وينحدر من حمص.', 'نقل المصاب إلى مشفى حمص.']) assert.equal(_test.nonIncidentPlaceOnly('حمص', text), true, text);
  assert.equal(_test.nonIncidentPlaceOnly('حمص', 'مديرية أمن حمص أعلنت وقوع انفجار في حمص.'), false);
});
test('missing, legacy-truncated and overlong original source cannot auto-publish', () => {
  const d = { type: 'explosion', headline: 'generated', srcs: [{ name: 'اختبار' }] };
  assert.throws(() => _test.sourceFirstCandidate(d), /missing-original-source/);
  assert.throws(() => _test.sourceFirstCandidate({ ...d, sourceText: 'س'.repeat(1200) }), /legacy-source/);
  assert.throws(() => _test.sourceFirstCandidate({ ...d, sourceText: 'س'.repeat(2900), sourceTextVersion: 2 }), /source-length/);
});
