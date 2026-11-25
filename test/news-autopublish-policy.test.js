import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Owner policy (2026-11-17): the monitor polls every minute for the latest news;
// an eligible draft the owner has not acted on auto-publishes after 2 minutes;
// during 22:00–08:00 Asia/Damascus eligible drafts publish immediately. Every
// automatic publication first passes auditDraftForAutoPublish (verify + correct);
// a failed audit holds the draft for manual review and is never retried in a loop.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-autopublish-policy-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
const { store } = await import('../server/store.js');
await store.init(null);
const { newsState, daytimeAutoEligible, nightEligible, dayAutoDueAt, dayAutoReady, nightActive, _test } = await import('../server/news-monitor.js');
const { locationFrom } = await import('../server/places.js');

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

const at = (iso) => Date.parse(iso);
const qualified = (overrides = {}) => ({
  id: 'policy-draft',
  type: 'attack',
  status: 'pending',
  created: Date.now(),
  test: false,
  rule: false,
  loc: { scope: 'place', latitude: 33.5, longitude: 36.3 },
  srcs: [{ u: 'test-main-source', local: false }],
  ...overrides,
});

test('the night window is exactly 22:00–08:00 Asia/Damascus, boundaries included', () => {
  const g = newsState().night;
  assert.equal(g.from, '22:00');
  assert.equal(g.to, '08:00');
  assert.equal(nightActive(at('2026-11-18T18:59:00Z')), false, '21:59 Damascus is still day');
  assert.equal(nightActive(at('2026-11-18T19:00:00Z')), true, '22:00 Damascus opens the night window');
  assert.equal(nightActive(at('2026-11-19T04:59:00Z')), true, '07:59 Damascus is still night');
  assert.equal(nightActive(at('2026-11-19T05:00:00Z')), false, '08:00 Damascus closes the night window');
});

test('window boundaries drive the routes: 21:59 arms the 2-minute day timer, 22:00–07:59 only the immediate night route, 08:00 arms again', () => {
  const d = qualified();
  assert.equal(dayAutoDueAt(d, at('2026-11-18T18:59:00Z')), at('2026-11-18T18:59:00Z') + 120_000, '21:59: day route arms +2 min');
  assert.equal(dayAutoDueAt(d, at('2026-11-18T19:00:00Z')), null, '22:00: no day timer — night route only');
  assert.equal(dayAutoDueAt(d, at('2026-11-19T04:59:00Z')), null, '07:59: still night route only');
  assert.equal(dayAutoDueAt(d, at('2026-11-19T05:00:00Z')), at('2026-11-19T05:00:00Z') + 120_000, '08:00: day route arms +2 min again');
});

test('day route is audit-gated: a stale draft in day mode is held by the audit and never published', async () => {
  const state = newsState();
  const prevH = _test.R.H;
  let publishAttempts = 0;
  _test.R.H = {
    apis: () => ({ admin: { sendMessage: async () => ({ message_id: 91 }) } }),
    publishDraft: async () => { publishAttempts++; return { id: 'must-not-publish', channel_message_id: 5 }; },
  };
  const staleTs = Date.now() - 46 * 60_000;
  const draft = qualified({
    id: 'policy-day-stale', type: 'explosion', headline: 'انفجار في مدينة حلب', sourceText: 'انفجار في مدينة حلب',
    loc: { scope: 'place', name_ar: 'حلب', governorate_ar: 'حلب', latitude: 36.2, longitude: 37.1 },
    srcs: [{ u: 'policy-feed', name: 'قناة اختبار', local: false, ts: staleTs }], ts: staleTs, cards: [],
    autoMode: 'day', dayAutoAt: Date.now() - 1,
  });
  state.drafts[draft.id] = draft;
  try {
    assert.equal(await _test.nightPublish(draft), false, 'the day route funnels through nightPublish and the audit stops it');
    assert.equal(publishAttempts, 0);
    assert.equal(draft.status, 'pending');
    assert.equal(draft.editorialHoldReason, 'auto-audit-failed');
    assert.equal(draft.autoAudit.reason, 'stale-source');
  } finally {
    _test.R.H = prevH;
    delete state.drafts[draft.id];
  }
});

test('owner action before the deadline cancels the fallback (ignore, edit, publish, expiry)', async () => {
  const due = at('2026-11-19T07:00:00Z');
  const draft = qualified({ dayAutoAt: due });
  assert.equal(dayAutoReady(draft, due - 1), false);
  assert.equal(dayAutoReady(draft, due), true);
  for (const status of ['ignored', 'editing', 'published', 'expired', 'duplicate']) {
    assert.equal(dayAutoReady({ ...draft, status }, due), false, `status ${status} must cancel auto-publish`);
  }
  // integration: the tick itself skips a draft the owner has taken into the editor
  const state = newsState();
  const prevH = _test.R.H;
  let attempts = 0;
  _test.R.H = {
    apis: () => ({ admin: { sendMessage: async () => ({ message_id: 1 }) } }),
    publishDraft: async () => { attempts++; return { id: 'must-not-publish' }; },
  };
  const editing = qualified({ id: 'policy-editing', status: 'editing', dayAutoAt: Date.now() - 1000 });
  state.drafts[editing.id] = editing;
  try {
    await _test.dayAutoTick(Date.now());
    assert.equal(attempts, 0, 'a draft being edited is never auto-published');
  } finally {
    _test.R.H = prevH;
    delete state.drafts[editing.id];
  }
});

test('a stale draft never auto-publishes on either route and fails the audit as stale', () => {
  const staleTs = Date.now() - 46 * 60_000;
  const d = qualified({ ts: staleTs, srcs: [{ u: 'old-feed', local: false, ts: staleTs }], dayAutoAt: Date.now() - 1 });
  // on this tree the publish-time audit is the freshness gate for automation:
  assert.deepEqual(_test.auditDraftForAutoPublish(d, 'day'), { ok: false, reason: 'stale-source' });
  assert.deepEqual(_test.auditDraftForAutoPublish(d, 'night'), { ok: false, reason: 'stale-source' });
});

test('audit verify: an uncorroborated draft fails with its reason', () => {
  const single = qualified({ srcs: [{ u: 'local-one', local: true, ts: Date.now() }] });
  assert.deepEqual(_test.auditDraftForAutoPublish(single, 'night'), { ok: false, reason: 'uncorroborated' });
  const twoLocal = qualified({ srcs: [{ u: 'local-one', local: true, ts: Date.now() }, { u: 'local-two', local: true, ts: Date.now() }] });
  assert.equal(_test.auditDraftForAutoPublish(twoLocal, 'night').ok, true, 'two independent sources corroborate');
});

test('audit correct: duplicated type-label prefix is stripped and a mid-word truncated headline is rebuilt from the source lead', () => {
  const clean = 'وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص.';
  const d = qualified({
    type: 'explosion', headline: `انفجار — ${clean}`, sourceText: clean,
    loc: { scope: 'place', name_ar: 'حلب', governorate_ar: 'حلب', latitude: 36.2, longitude: 37.1 },
    srcs: [{ u: 'audit-feed', local: false, ts: Date.now() }],
  });
  const r = _test.auditDraftForAutoPublish(d, 'day');
  assert.equal(r.ok, true);
  assert.ok(r.corrected.includes('type-label-prefix'));
  assert.equal(d.headline, clean);

  const line = 'انفجار عبوة ناسفة في قرية المتونة بريف السويداء أدى إلى إصابة شخصين بجروح';
  const d2 = qualified({
    type: 'explosion', headline: 'انفجار عبوة ناسفة في قرية المتو', sourceText: `${line}\nتفاصيل إضافية لاحقة من المصدر`,
    loc: { scope: 'place', name_ar: 'المتونة', governorate_ar: 'السويداء', latitude: 32.7, longitude: 36.6 },
    srcs: [{ u: 'audit-feed', local: false, ts: Date.now() }],
  });
  const r2 = _test.auditDraftForAutoPublish(d2, 'night');
  assert.equal(r2.ok, true);
  assert.ok(r2.corrected.includes('headline-rebuilt'));
  assert.equal(d2.headline, line, 'the rebuilt headline is the complete source lead');
});

test('audit place sanity: canonical and introduced-alt mentions pass; a place missing from the source fails', () => {
  const loc = locationFrom({ placeId: 420874 });
  assert.equal(loc.name_ar, 'سلمان');
  const base = { type: 'death', status: 'pending', loc, created: Date.now(), srcs: [{ u: 'audit-feed', local: false, ts: Date.now() }] };
  const canon = { ...base, headline: 'وفاة شخصين في قرية سلمان', sourceText: 'توفي شخصان اختناقاً داخل منزلهما في قرية سلمان بريف الحسكة' };
  assert.equal(_test.auditDraftForAutoPublish(canon, 'day').ok, true, 'the canonical name in the text stands');
  const altIntroduced = { ...base, headline: 'وفاة شخصين في قرية سليمان', sourceText: 'توفي شخصان اختناقاً داخل منزلهما في قرية سليمان بريف الحسكة' };
  assert.equal(_test.auditDraftForAutoPublish(altIntroduced, 'day').ok, true, 'an alt mention framed by a place introducer stands');
  const missing = { ...base, headline: 'وفاة شخصين في مكان آخر', sourceText: 'توفي شخصان اختناقاً داخل منزلهما في قرية بعيدة' };
  assert.equal(_test.auditDraftForAutoPublish(missing, 'day').reason, 'place-not-in-source');
  const person = { ...base, headline: 'وفاة — سلمان ومنطقة أخرى', sourceText: 'وفاة الزوجين "سليمان كرنوص" وزوجته "سلطانة حسن" اختناقاً جراء استنشاق غازات جمر الفحم داخل منزلهما' };
  assert.equal(_test.auditDraftForAutoPublish(person, 'day').reason, 'place-person-name-suspect');
});

test('audit failure at publish time: the person-name draft is held with its reason, shown on the card, and never retried in a loop', async () => {
  const state = newsState();
  const prevH = _test.R.H;
  let attempts = 0;
  _test.R.H = {
    apis: () => ({ admin: { sendMessage: async () => ({ message_id: 3 }) } }),
    publishDraft: async () => { attempts++; return { id: 'must-not-publish' }; },
  };
  const d = qualified({
    id: 'policy-person-name', type: 'explosion',
    headline: 'انفجار — سلمان ومنطقة أخرى',
    sourceText: 'وفاة الزوجين "سليمان كرنوص" وزوجته "سلطانة حسن" اختناقاً جراء استنشاق غازات جمر الفحم داخل منزلهما',
    loc: locationFrom({ placeId: 420874 }),
    srcs: [{ u: 'audit-main-feed', name: 'وكالة اختبار', local: false, ts: Date.now() }], cards: [],
  });
  state.drafts[d.id] = d;
  try {
    assert.equal(nightEligible(d), true, 'the draft passes the ordinary eligibility gates — only the audit can stop it');
    assert.equal(await _test.nightPublish(d), false);
    assert.equal(attempts, 0, 'nothing was published');
    assert.equal(d.status, 'pending', 'the draft stays for manual review');
    assert.equal(d.editorialHold, true);
    assert.equal(d.editorialHoldReason, 'auto-audit-failed');
    assert.equal(d.autoAudit.reason, 'place-person-name-suspect', 'the failure reason is recorded on the draft');
    assert.equal(d.dayAutoAt, null, 'the 2-minute timer is cleared');
    assert.match(_test.cardText(d, 'ar'), /موقوفة للمراجعة التحريرية/, 'the existing card status line shows the hold');
    const auditAt = d.autoAudit.at;
    assert.equal(await _test.nightPublish(d), false, 'a repeated trigger is stopped at the eligibility gate');
    assert.equal(d.autoAudit.at, auditAt, 'the audit did not run again — no retry loop');
    assert.equal(attempts, 0);
    // new corroborating input earns exactly one re-audit: mergeInto lifts only the audit hold
    await _test.mergeInto(d, { src: { u: 'audit-second-feed', name: 'مصدر ثانٍ', local: false }, url: 'https://t.me/audit-second-feed/9', ts: Date.now(), text: 'وفاة شخصين اختناقاً في ريف الحسكة' }, []);
    assert.equal(d.srcs.length, 2, 'the merge added the corroborating source (and lifted the audit hold; at night the merge itself triggers the one re-audit immediately)');
    assert.equal(await _test.nightPublish(d), false, 'the single re-audit still refuses the person-name pin');
    assert.equal(d.autoAudit.reason, 'place-person-name-suspect');
    assert.ok(d.autoAudit.at > auditAt, 'the re-audit actually ran once more');
    assert.equal(d.editorialHold, true, 'and the draft is held again');
    assert.equal(attempts, 0);
  } finally {
    _test.R.H = prevH;
    delete state.drafts[d.id];
  }
});

test('a correctable draft is auto-published in its corrected form', async () => {
  const state = newsState();
  const prevH = _test.R.H;
  const payloads = [];
  _test.R.H = {
    apis: () => ({ admin: { sendMessage: async () => ({ message_id: 7 }) } }),
    publishDraft: async (_a, payload) => { payloads.push(payload); return { id: 'corrected-alert', channel_message_id: 11 }; },
  };
  const clean = 'وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص.';
  const d = qualified({
    id: 'policy-corrected', type: 'explosion',
    headline: `انفجار — ${clean}`, sourceText: clean,
    loc: { scope: 'place', name_ar: 'حلب', governorate_ar: 'حلب', latitude: 36.2, longitude: 37.1 },
    srcs: [{ u: 'audit-main-feed', name: 'وكالة اختبار', local: false, ts: Date.now() }], cards: [],
    autoMode: 'day', dayAutoAt: Date.now() - 1,
  });
  state.drafts[d.id] = d;
  try {
    assert.equal(await _test.nightPublish(d), true);
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].details, clean, 'what publishes is the corrected headline, not the raw draft text');
    assert.equal(d.headline, clean);
    assert.ok(d.autoAudit?.corrected?.includes('type-label-prefix'));
    assert.equal(d.status, 'published');
  } finally {
    _test.R.H = prevH;
    delete state.drafts[d.id];
  }
});

test('note 4: a map-only auto-publish result is NOT marked published — the reconciliation hold applies', async () => {
  const state = newsState();
  const prevH = _test.R.H;
  _test.R.H = {
    apis: () => ({ admin: { sendMessage: async () => ({ message_id: 7 }) } }),
    // the send lands on the map only: no channel_message_id, definitive channel failure
    publishDraft: async () => ({ id: 'map-only-alert', channel_message_id: null, channel_delivery: { status: 'failed' } }),
  };
  const clean = 'وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص.';
  const d = qualified({
    id: 'policy-map-only', type: 'explosion',
    headline: clean, sourceText: clean,
    loc: { scope: 'place', name_ar: 'حلب', governorate_ar: 'حلب', latitude: 36.2, longitude: 37.1 },
    srcs: [{ u: 'audit-main-feed', name: 'وكالة اختبار', local: false, ts: Date.now() }], cards: [],
    autoMode: 'night',
  });
  state.drafts[d.id] = d;
  try {
    assert.equal(await _test.nightPublish(d), false);
    assert.notEqual(d.status, 'published');
    assert.equal(d.editorialHoldReason, 'channel-delivery-needs-reconciliation');
    assert.equal(d.postId, null);
    assert.equal(d.alertId, 'map-only-alert');
  } finally {
    _test.R.H = prevH;
    delete state.drafts[d.id];
  }
});
