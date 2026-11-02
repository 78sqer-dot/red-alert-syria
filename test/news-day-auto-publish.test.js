import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-day-auto-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
const { store } = await import('../server/store.js');
await store.init(null);
const { dayAutoDueAt, dayAutoReady, daytimeAutoEligible, daytimeWindow, nightEligible, newsState, toBotDraft, _test } = await import('../server/news-monitor.js');

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

const at = (iso) => Date.parse(iso);
const daytimeStart = at('2026-10-27T05:00:00Z'); // 08:00 in Damascus
const qualified = (overrides = {}) => ({
  id: 'news-draft',
  type: 'attack',
  status: 'pending',
  test: false,
  rule: false,
  loc: { scope: 'place', latitude: 33.5, longitude: 36.3 },
  srcs: [{ u: 'test-main-source', local: false }],
  ...overrides,
});

test('daytime fallback window follows Damascus time and excludes 22:00–08:00', () => {
  assert.equal(daytimeWindow(at('2026-10-27T04:59:00Z')), false); // 07:59
  assert.equal(daytimeWindow(daytimeStart), true); // 08:00
  assert.equal(daytimeWindow(at('2026-10-27T18:59:00Z')), true); // 21:59
  assert.equal(daytimeWindow(at('2026-10-27T19:00:00Z')), false); // 22:00
});

test('a qualifying pending AI news draft gets exactly one two-minute deadline during the day', () => {
  assert.equal(dayAutoDueAt(qualified(), daytimeStart), daytimeStart + 120_000);
  assert.equal(dayAutoDueAt(qualified({ dayAutoAt: daytimeStart + 30_000 }), daytimeStart), null);
  assert.equal(dayAutoDueAt(qualified(), at('2026-10-27T19:00:00Z')), null);
});

test('test, rules-only, low-confidence, and already handled drafts never qualify', () => {
  assert.equal(daytimeAutoEligible(qualified({ test: true })), false);
  assert.equal(daytimeAutoEligible(qualified({ rule: true })), false);
  assert.equal(daytimeAutoEligible(qualified({ srcs: [{ u: 'local-only', local: true }] })), false);
  assert.equal(daytimeAutoEligible(qualified({ status: 'ignored' })), false);
  assert.equal(daytimeAutoEligible(qualified({ status: 'published' })), false);
  assert.equal(daytimeAutoEligible(qualified({ status: 'duplicate' })), false);
  assert.equal(daytimeAutoEligible(qualified({ srcs: [{ u: 'local-one', local: true }, { u: 'local-two', local: true }] })), true);
});

test('high-risk categories and drafts without a verified map point are held for human review', () => {
  for (const type of ['breaking', 'weather', 'civil']) {
    assert.equal(nightEligible(qualified({ type })), false, `${type} must not auto-publish`);
  }
  assert.equal(nightEligible(qualified({ loc: { scope: 'country', latitude: null, longitude: null } })), false);
  assert.equal(nightEligible(qualified({ loc: { scope: 'place', latitude: null, longitude: null } })), false);
});

test('qualified political news can auto-publish at night but remains excluded from daytime auto-publishing', () => {
  const cutoff = Date.parse(newsState().mig.politicalNightAuto1);
  const political = qualified({
    type: 'political',
    politicalCategory: 'statement',
    created: cutoff + 1,
    srcs: [{ u: 'main-a', local: false }],
  });
  assert.equal(nightEligible(political), true, 'real AI political classification with a category, precise Syrian place and trusted source qualifies at night');
  assert.equal(daytimeAutoEligible(political), false);
  assert.equal(dayAutoDueAt(political, daytimeStart), null);
  assert.equal(dayAutoReady({ ...political, dayAutoAt: daytimeStart }, daytimeStart + 1), false);
});

test('political news missing review requirements or predating activation remains held', () => {
  const cutoff = Date.parse(newsState().mig.politicalNightAuto1);
  const valid = qualified({ type: 'political', politicalCategory: 'statement', created: cutoff + 1 });
  assert.equal(nightEligible({ ...valid, created: cutoff - 1 }), false, 'pre-existing pending political drafts do not become auto-publishable');
  assert.equal(nightEligible({ ...valid, politicalCategory: null }), false, 'missing political category remains with a reviewer');
  assert.equal(nightEligible({ ...valid, politicalNeedsCategory: true }), false);
  assert.equal(nightEligible({ ...valid, rule: true }), false, 'rules-only classification remains with a reviewer');
  assert.equal(nightEligible({ ...valid, test: true }), false, 'test drafts never qualify');
  assert.equal(nightEligible({ ...valid, loc: { scope: 'country', latitude: null, longitude: null } }), false);
  assert.equal(nightEligible({ ...valid, srcs: [{ u: 'local-only', local: true }] }), false, 'a single local source remains unqualified');
});

test('Syrian political news without a verified place remains a locationless review draft', async () => {
  const n = newsState();
  n.drafts = {};
  n.types.political = true;
  n.stats.drafts = 0;
  const ts = at('2026-10-27T05:00:00Z');
  const item = {
    i: 1,
    src: { u: 'test-syrian-source', name: 'وكالة اختبار', local: false },
    url: 'https://t.me/test-syrian-source/123',
    ts,
    text: 'أعلنت الرئاسة السورية اليوم بدء مفاوضات رسمية جديدة مع ممثلي القوى الوطنية بشأن المرحلة المقبلة',
  };
  await _test.handleResult(item, {
    i: 1, event: true, type: 'political', political_category: 'none', new_incident: false,
    same_as: null, places: [], headline: 'الرئاسة السورية تعلن بدء مفاوضات جديدة مع ممثلي القوى الوطنية',
  }, [], new Map());
  const draft = Object.values(n.drafts).find((d) => d.type === 'political');
  assert.ok(draft, 'political item should not be discarded for missing a place');
  assert.equal(draft.loc.scope, 'country');
  assert.equal(draft.loc.latitude, null);
  assert.equal(draft.loc.longitude, null);
  assert.equal(draft.politicalCategory, null);
  assert.equal(draft.politicalNeedsCategory, true);
  assert.equal(nightEligible(draft), false);
  assert.equal(daytimeAutoEligible(draft), false);
  const botDraft = toBotDraft(draft);
  assert.equal(botDraft.politicalCategory, null);
  assert.deepEqual(botDraft.politicalSources, [{ name: 'وكالة اختبار', url: item.url, timestamp: new Date(ts).toISOString() }]);
  assert.equal(botDraft.politicalSourceTimestamp, new Date(ts).toISOString());
});

test('published political alerts and pending reports retain their category for deduplication', () => {
  const n = newsState();
  const oldRemembered = n.alerts;
  const oldReports = store.state.reports;
  const oldAlerts = store.state.alerts;
  const now = Date.now();
  n.alerts = [{ id: 'legacy-political', type: 'political', ts: now, headline: 'بيان رسمي جديد', where: '', geo: { pts: [], dists: [], govs: [], coarse: false, none: true } }];
  store.state.alerts = [{ id: 'legacy-political', type: 'political', meta: { political: { category: 'statement' } } }];
  store.state.reports = {
    'pending-political': {
      created: now,
      draft: { type: 'political', title: 'مفاوضات سورية', details: 'تفاصيل عامة', meta: { political: { category: 'negotiation' } }, location: { scope: 'country' } },
    },
  };
  try {
    _test.rememberAlert({
      id: 'new-political', type: 'political', political_category: 'meeting',
      timestamp: new Date(now).toISOString(), title: 'لقاء رسمي', description: 'اجتماع في دمشق',
      scope: 'country', location: null, place: {},
    });
    const known = _test.knownEvents(24);
    assert.equal(known.find((event) => event.headline === 'بيان رسمي جديد')?.politicalCategory, 'statement');
    assert.equal(known.find((event) => event.headline === 'لقاء رسمي اجتماع في دمشق')?.politicalCategory, 'meeting');
    assert.equal(known.find((event) => event.kind === 'report')?.politicalCategory, 'negotiation');
  } finally {
    n.alerts = oldRemembered;
    store.state.reports = oldReports;
    store.state.alerts = oldAlerts;
  }
});

test('the scheduler considers only still-pending eligible drafts whose saved deadline has elapsed', () => {
  const due = daytimeStart + 120_000;
  const draft = qualified({ dayAutoAt: due });
  assert.equal(dayAutoReady(draft, due - 1), false);
  assert.equal(dayAutoReady(draft, due), true);
  assert.equal(dayAutoReady({ ...draft, status: 'ignored' }, due), false);
  assert.equal(dayAutoReady({ ...draft, rule: true }, due), false);
});
