// Self-echo guard: a story WE published must never come back as a "new"
// incident when another channel reposts it a day later. The incident matcher
// only remembers 12h (per-type windows ≤6h), so this regression pins the
// content-based echo log (96h): an echo of our own published text is dropped,
// while a genuinely new story — or the same text in a far-away place — still
// becomes a draft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-echo-'));
process.env.NODE_ENV = 'test';

const { store, publicAlert } = await import('../server/store.js');
const { searchPlaces } = await import('../server/places.js');
const mon = await import('../server/news-monitor.js');

const HEAD = 'انفجار عبوة ناسفة قرب دوار المحراب في مدينة إدلب';
const FULL = [
  HEAD,
  'أفادت مصادر محلية بسماع دوي انفجار قوي قرب دوار المحراب في مدينة إدلب تبين أنه ناجم عن عبوة ناسفة زرعت بجانب الطريق',
  'وأضافت المصادر أن الانفجار أدى إلى أضرار مادية في عدد من المحال التجارية المجاورة دون تسجيل إصابات بشرية حتى الآن',
  'وعملت فرق الدفاع المدني على تمشيط المنطقة وتأمين محيط الانفجار فيما فتحت الجهات المختصة تحقيقا لمعرفة ملابسات الحادثة',
].join('\n');

function seedPublishedAlert30hAgo() {
  // addAlert takes the canonical location object (scope/coords/names) — the
  // same shape the publishing paths build — under `location`.
  const g = searchPlaces('إدلب', 1)[0];
  const stored = store.addAlert({
    type: 'explosion', confirm: 'preliminary',
    location: { scope: 'governorate', name_ar: 'إدلب', district_ar: '', governorate_ar: 'إدلب', latitude: g.lat, longitude: g.lon },
    title: 'انفجار — إدلب', description: HEAD, body: FULL, source_name: 'مرصد',
  });
  const raw = store.state.alerts.find((a) => a.id === stored.id);
  raw.timestamp = new Date(Date.now() - 30 * 3600_000).toISOString(); // yesterday — outside every incident window
  mon._test.rememberAlert(publicAlert(raw));
  return stored.id;
}

const draftCount = () => mon._test.knownEvents(2).filter((e) => e.kind === 'draft').length;

test("our own yesterday post, reposted by another channel today, is dropped as a self-echo", async () => {
  seedPublishedAlert30hAgo();
  const before = draftCount();
  const it = {
    i: 1, src: { u: 'copycat-channel', name: 'قناة ناسخة' }, url: 'https://t.me/copycat-channel/9',
    ts: Date.now(), text: FULL,
  };
  const r = { event: true, type: 'explosion', new_incident: true, same_as: null, places: [{ name: 'إدلب', gov: 'إدلب' }], headline: HEAD };
  await mon._test.handleResult(it, r, [], new Map());
  assert.equal(draftCount(), before, 'the echo must not create a new draft');
});

test('a genuinely new story still becomes a draft', async () => {
  const before = draftCount();
  const text = 'اندلع حريق كبير في مستودع للأخشاب بمنطقة باب النيرب في مدينة حلب وتصاعدت أعمدة الدخان في سماء المنطقة\nوعملت فرق الإطفاء على محاصرة النيران ومنع امتدادها إلى المباني السكنية المجاورة للمستودع';
  const it = {
    i: 2, src: { u: 'some-channel', name: 'قناة' }, url: 'https://t.me/some-channel/3',
    ts: Date.now(), text,
  };
  const r = { event: true, type: 'fire', new_incident: true, same_as: null, places: [{ name: 'حلب', gov: 'حلب' }], headline: 'حريق كبير في مستودع أخشاب بمنطقة باب النيرب في حلب' };
  await mon._test.handleResult(it, r, [], new Map());
  assert.equal(draftCount(), before + 1, 'a new incident must still be drafted');
});

test('a near-identical text about a far-away place is a different event, not an echo', async () => {
  const before = draftCount();
  // Same wire boilerplate, different city: heavy token overlap with the seeded
  // إدلب text, but the geography gate must keep it a separate incident.
  const farText = FULL.replaceAll('إدلب', 'القامشلي').replaceAll('دوار المحراب', 'دوار العروبة');
  const it = {
    i: 3, src: { u: 'far-channel', name: 'قناة بعيدة' }, url: 'https://t.me/far-channel/4',
    ts: Date.now(), text: farText,
  };
  const r = { event: true, type: 'explosion', new_incident: true, same_as: null, places: [{ name: 'القامشلي', gov: 'الحسكة' }], headline: 'انفجار عبوة ناسفة قرب دوار العروبة في مدينة القامشلي' };
  await mon._test.handleResult(it, r, [], new Map());
  assert.equal(draftCount(), before + 1, 'similar words, distant place = separate incident');
});
