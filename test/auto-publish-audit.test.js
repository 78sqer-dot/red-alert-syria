import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Gap-closure item 6 (owner policy 2026-11-17, «سوي الكل» 2026-11-25): the
// pre-publish audit gate is back on main as its own push. Every automatic
// publication (day 2-minute route AND night immediate route, both funnelled
// through nightPublish) first passes auditDraftForAutoPublish: freshness,
// corroboration, place sanity, and in-place correction of the outgoing copy.
// A failed audit NEVER publishes: the draft is held with the reason recorded,
// and only new corroborating input (mergeInto) earns it a re-audit.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-audit-gate-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = 'test-only-not-a-real-token';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';

const { store } = await import('../server/store.js');
await store.init(null);
const { newsState, _test } = await import('../server/news-monitor.js');

const fresh = () => Date.now() - 60_000;
const base = (overrides = {}) => ({
  id: 'audit-draft', type: 'explosion', status: 'pending', created: Date.now(), test: false, rule: false,
  headline: 'انفجار عبوة ناسفة قرب صور بريف درعا',
  sourceText: 'انفجار عبوة ناسفة قرب بلدة صور في ريف درعا الشمالي، وقال مصدر عسكري إن الانفجار وقع بعبوة مزروعة على جانب الطريق.',
  loc: { scope: 'place', place_id: 163916, name_ar: 'صور (صور اللجا)', governorate_ar: 'درعا', latitude: 32.958, longitude: 36.302 },
  srcs: [{ u: 'feed-a', name: 'وكالة', local: false, ts: fresh() }, { u: 'feed-b', name: 'مراسل', local: false, ts: fresh() }],
  ts: fresh(), cards: [],
  ...overrides,
});

test('audit passes a fresh, corroborated, well-formed draft untouched', () => {
  const d = base();
  const r = _test.auditDraftForAutoPublish(d, 'night');
  assert.equal(r.ok, true);
  assert.deepEqual(r.corrected, []);
});

test('audit holds stale sources and uncorroborated drafts with recorded reasons', () => {
  const staleTs = Date.now() - 46 * 60_000;
  assert.deepEqual(_test.auditDraftForAutoPublish(base({ ts: staleTs, srcs: [{ u: 'a', local: false, ts: staleTs }] }), 'day'), { ok: false, reason: 'stale-source' });
  assert.deepEqual(_test.auditDraftForAutoPublish(base({ srcs: [{ u: 'a', local: true, ts: fresh() }] }), 'night'), { ok: false, reason: 'uncorroborated' });
});

test('audit corrects the outgoing copy: label prefix stripped, sharp tone neutralized, truncated headline rebuilt', () => {
  const d1 = base({ headline: 'انفجار — انفجار عبوة ناسفة قرب صور' });
  const r1 = _test.auditDraftForAutoPublish(d1, 'night');
  assert.equal(r1.ok, true);
  assert.ok(r1.corrected.includes('type-label-prefix'));
  assert.equal(d1.headline, 'انفجار عبوة ناسفة قرب صور');

  const d2 = base({ headline: 'مسخرة ما يحدث في صور، يا للعار' });
  const r2 = _test.auditDraftForAutoPublish(d2, 'night');
  assert.equal(r2.ok, true);
  assert.ok(r2.corrected.includes('tone-neutralized'));
  assert.ok(!d2.headline.includes('مسخرة'), 'the sharp-tone headline is replaced by a factual type + place line');

  const d3 = base({ headline: 'انفجار عبوة ناسفة قرب بلدة صور في ريف درعا الشمالي، وقال مصدر عسكري إن الانفجار وقع بعبوة مزرو' });
  const r3 = _test.auditDraftForAutoPublish(d3, 'night');
  assert.equal(r3.ok, true);
  assert.ok(r3.corrected.includes('headline-rebuilt'), 'a mid-word truncated headline is rebuilt from the source lead');
  assert.ok(!d3.headline.endsWith('مزرو'));
});

test('audit place sanity: a pin not named in the source text fails the audit', () => {
  const d = base({ sourceText: 'انفجار في مدينة حلب قرب دوار الباسل مساء اليوم.' });
  assert.deepEqual(_test.auditDraftForAutoPublish(d, 'night'), { ok: false, reason: 'place-not-in-source' });
});

test('nightPublish is audit-gated: a stale draft is held with the reason recorded and never published', async () => {
  const state = newsState();
  const prevH = _test.R.H;
  let publishAttempts = 0;
  _test.R.H = {
    apis: () => ({ admin: { sendMessage: async () => ({ message_id: 91 }) } }),
    publishDraft: async () => { publishAttempts++; return { id: 'must-not-publish', channel_message_id: 5 }; },
  };
  const staleTs = Date.now() - 46 * 60_000;
  const draft = base({ id: 'audit-held', ts: staleTs, srcs: [{ u: 'feed-a', name: 'وكالة', local: false, ts: staleTs }], autoMode: 'day', dayAutoAt: Date.now() - 1 });
  state.drafts[draft.id] = draft;
  try {
    assert.equal(await _test.nightPublish(draft), false);
    assert.equal(publishAttempts, 0, 'a failed audit never reaches publishDraft');
    assert.equal(draft.status, 'pending');
    assert.equal(draft.editorialHold, true);
    assert.equal(draft.editorialHoldReason, _test.AUTO_AUDIT_HOLD_REASON);
    assert.equal(draft.autoAudit.reason, 'stale-source');
    assert.equal(draft.autoMode, undefined, 'no timer loop re-audits a held draft');
  } finally {
    _test.R.H = prevH;
    delete state.drafts[draft.id];
  }
});
