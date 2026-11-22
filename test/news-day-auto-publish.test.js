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
const { NEWS_TYPES } = await import('../server/news-ai.js');
const { cleanPublicNewsAttribution } = await import('../server/clean-text.js');

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

const at = (iso) => Date.parse(iso);
const daytimeStart = at('2026-11-18T05:00:00Z'); // 08:00 in Damascus, after the current expansion checkpoint
const qualified = (overrides = {}) => ({
  id: 'news-draft',
  type: 'attack',
  status: 'pending',
  created: Date.parse(newsState().mig.dayAutoAllTypes1) + 1,
  test: false,
  rule: false,
  loc: { scope: 'place', latitude: 33.5, longitude: 36.3 },
  srcs: [{ u: 'test-main-source', local: false }],
  ...overrides,
});

test('public news copy drops outlet/reporting credits but keeps speaker attribution and private source records', () => {
  const examples = [
    {
      raw: 'أفاد مراسل الجزيرة بأن القوات الإسرائيلية استهدفت بقذائف أراضٍ زراعية في حوض اليرموك بريف درعا الجنوبي.',
      clean: 'القوات الإسرائيلية استهدفت بقذائف أراضٍ زراعية في حوض اليرموك بريف درعا الجنوبي.',
    },
    {
      raw: 'مصادر العربية: طائرات مسيرة إسرائيلية تستهدف الأراضي الزراعية بين كويا وعابدين ومعرية بريف درعا',
      clean: 'طائرات مسيرة إسرائيلية تستهدف الأراضي الزراعية بين كويا وعابدين ومعرية بريف درعا',
    },
    {
      raw: 'توغل وإطلاق نار يطال منازل وأراضي قرية كويا بريف درعا.. رئيس البلدية يروي لـ سوريا الآن ما جرى',
      clean: 'توغل وإطلاق نار يطال منازل وأراضي قرية كويا بريف درعا.. رئيس البلدية يروي ما جرى',
    },
  ];
  for (const example of examples) assert.equal(cleanPublicNewsAttribution(example.raw), example.clean);
  assert.equal(cleanPublicNewsAttribution('قال رئيس البلدية إن التوغل طال منازل قرية كويا'), 'قال رئيس البلدية إن التوغل طال منازل قرية كويا');
  const institutionAttribution = 'مصادر الدفاع المدني السوري: وقع انفجار وأصيب 3 أشخاص.';
  assert.equal(cleanPublicNewsAttribution(institutionAttribution, ['الدفاع المدني السوري']), institutionAttribution,
    'a monitored institution is a speaker, not a media-outlet identity to strip');
  assert.equal(cleanPublicNewsAttribution(institutionAttribution, ['مصادر الدفاع المدني السوري']), institutionAttribution,
    'a complete monitored institution source name remains attributed');
  assert.equal(cleanPublicNewsAttribution('مصادر قناة الرصد: وقع انفجار وأصيب 3 أشخاص.', ['مصادر قناة الرصد']),
    'وقع انفجار وأصيب 3 أشخاص.', 'a monitoring channel does not leak as a speaker attribution');
  assert.equal(cleanPublicNewsAttribution('مصادر قناة الدفاع المدني: وقع انفجار.', ['مصادر قناة الدفاع المدني']),
    'وقع انفجار.', 'a monitoring channel named after an institution is still a channel');

  const sourceText = examples[0].raw;
  const draft = qualified({
    id: 'private-source-attribution-cleanup', type: 'explosion',
    headline: examples[0].raw,
    sourceText,
    body: examples[1].raw,
    loc: { scope: 'place', name_ar: 'درعا', governorate_ar: 'درعا', latitude: 32.6, longitude: 36.1 },
    srcs: [{ u: 'private-monitor-feed', name: 'قناة الرصد الداخلية', url: 'https://t.me/private-monitor-feed/55', ts: Date.now(), local: false }],
  });
  const originalHeadline = draft.headline;
  const publicDraft = toBotDraft(draft);
  assert.equal(publicDraft.headline, examples[0].clean);
  assert.equal(publicDraft.details, examples[1].clean);
  assert.doesNotMatch(`${publicDraft.headline} ${publicDraft.details}`, /الجزيرة|العربية|سوريا الآن|قناة الرصد الداخلية/);
  assert.deepEqual(publicDraft.srcs, [{ u: 'private-monitor-feed', name: 'قناة الرصد الداخلية', url: 'https://t.me/private-monitor-feed/55', ts: draft.srcs[0].ts, local: false }]);
  assert.equal(draft.sourceText, sourceText, 'raw source text remains on the internal draft');
  assert.equal(draft.headline, originalHeadline, 'pre-existing draft text is not rewritten in place');
  const publishedCopy = toBotDraft({ ...draft, status: 'published' }, { preservePublishedCopy: true });
  assert.equal(publishedCopy.headline, examples[0].raw, 'published editor retains the exact published headline');
  assert.equal(publishedCopy.details, examples[1].raw, 'published editor retains the exact published details');
  assert.equal(nightEligible(draft), true);
  assert.equal(daytimeAutoEligible(draft), true, 'cleaning outlet credits does not change automatic-publish eligibility');
});

test('daytime fallback window follows Damascus time and excludes 22:00–08:00', () => {
  assert.equal(daytimeWindow(at('2026-10-27T04:59:00Z')), false); // 07:59
  assert.equal(daytimeWindow(daytimeStart), true); // 08:00
  assert.equal(daytimeWindow(at('2026-10-27T18:59:00Z')), true); // 21:59
  assert.equal(daytimeWindow(at('2026-10-27T19:00:00Z')), false); // 22:00
});

test('every monitored type can enter the two-minute daytime queue when its new draft meets the shared gates', () => {
  for (const type of NEWS_TYPES) {
    const draft = qualified({ type, ...(type === 'political' ? { politicalCategory: 'statement' } : {}) });
    assert.equal(daytimeAutoEligible(draft), true, `${type} should qualify after the expansion checkpoint`);
    assert.equal(dayAutoDueAt(draft, daytimeStart), daytimeStart + 120_000, `${type} should get the same two-minute delay`);
    assert.equal(dayAutoReady({ ...draft, dayAutoAt: daytimeStart }, daytimeStart + 120_000), true, `${type} should become ready only at its deadline`);
  }
});

test('pending drafts created before the daytime expansion checkpoint remain review-only', () => {
  const cutoff = Date.parse(newsState().mig.dayAutoAllTypes1);
  const old = qualified({ created: cutoff - 1, dayAutoAt: daytimeStart });
  assert.equal(daytimeAutoEligible(old), false);
  assert.equal(dayAutoDueAt(old, daytimeStart), null);
  assert.equal(dayAutoReady(old, daytimeStart + 120_000), false);
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
  assert.equal(daytimeAutoEligible(qualified({ type: 'not-monitored' })), false);
  assert.equal(daytimeAutoEligible(qualified({ status: 'ignored' })), false);
  assert.equal(daytimeAutoEligible(qualified({ status: 'published' })), false);
  assert.equal(daytimeAutoEligible(qualified({ status: 'duplicate' })), false);
  assert.equal(daytimeAutoEligible(qualified({ srcs: [{ u: 'local-one', local: true }, { u: 'local-two', local: true }] })), true);
  const n = newsState();
  const previous = n.types.attack;
  n.types.attack = false;
  try { assert.equal(daytimeAutoEligible(qualified()), false, 'disabled news types do not enter automatic publishing'); }
  finally { n.types.attack = previous; }
});

test('a qualifying ground-incursion draft remains day-eligible when a drone is mentioned', () => {
  const withDrone = qualified({ type: 'military_incursion', dronePresence: true });
  assert.equal(withDrone.type, 'military_incursion', 'drone presence does not replace the ground-incursion classification');
  assert.equal(daytimeAutoEligible(withDrone), true, 'drone mention alone is not an extra daytime hold');
  assert.equal(nightEligible(withDrone), false, 'the daytime expansion does not change existing night eligibility');
});

test('nighttime category restrictions remain unchanged while daytime needs a verified map point', () => {
  for (const type of ['breaking', 'weather', 'civil']) {
    assert.equal(nightEligible(qualified({ type })), false, `${type} must not auto-publish`);
    assert.equal(daytimeAutoEligible(qualified({ type })), true, `${type} can use the daytime route when otherwise qualified`);
  }
  assert.equal(nightEligible(qualified({ loc: { scope: 'country', latitude: null, longitude: null } })), false);
  assert.equal(nightEligible(qualified({ loc: { scope: 'place', latitude: null, longitude: null } })), false);
  assert.equal(daytimeAutoEligible(qualified({ loc: { scope: 'country', latitude: null, longitude: null } })), false);
  assert.equal(daytimeAutoEligible(qualified({ loc: { scope: 'place', latitude: null, longitude: null } })), false);
});

test('explosion retains its existing night and daytime auto-publish eligibility when otherwise qualified', () => {
  const explosion = qualified({ type: 'explosion' });
  assert.equal(nightEligible(explosion), true);
  assert.equal(daytimeAutoEligible(explosion), true);
});

test('source photo or video keeps a draft in human review instead of automatic publishing', () => {
  for (const media of [
    { type: 'photo', status: 'captured' },
    { type: 'video', status: 'captured' },
    { type: 'photo', status: 'unavailable' },
  ]) {
    const draft = qualified({ sourceMedia: [media] });
    assert.equal(nightEligible(draft), false);
    assert.equal(daytimeAutoEligible(draft), false);
    assert.equal(dayAutoDueAt(draft, daytimeStart), null);
    assert.equal(dayAutoReady({ ...draft, dayAutoAt: daytimeStart }, daytimeStart + 120_000), false);
  }
});

test('detonation remains outside the auto queue because it is not a monitored news type', () => {
  const detonation = qualified({ type: 'detonation' });
  assert.equal(NEWS_TYPES.includes('detonation'), false);
  assert.equal(nightEligible(detonation), false);
  assert.equal(daytimeAutoEligible(detonation), false);
});

test('qualified political news can auto-publish in either window after its activation checkpoints', () => {
  const cutoff = Date.parse(newsState().mig.dayAutoAllTypes1);
  const political = qualified({
    type: 'political',
    politicalCategory: 'statement',
    created: cutoff + 1,
    srcs: [{ u: 'main-a', local: false }],
  });
  assert.equal(nightEligible(political), true, 'real AI political classification with a category, precise Syrian place and trusted source qualifies at night');
  assert.equal(daytimeAutoEligible(political), true);
  assert.equal(dayAutoDueAt(political, daytimeStart), daytimeStart + 120_000);
  assert.equal(dayAutoReady({ ...political, dayAutoAt: daytimeStart }, daytimeStart + 120_000), true);
});

test('political news without a category or created before an activation checkpoint remains held', () => {
  const nightCutoff = Date.parse(newsState().mig.politicalNightAuto1);
  const dayCutoff = Date.parse(newsState().mig.dayAutoAllTypes1);
  const valid = qualified({ type: 'political', politicalCategory: 'statement', created: dayCutoff + 1 });
  assert.equal(nightEligible({ ...valid, created: nightCutoff - 1 }), false, 'pre-existing political drafts remain held overnight');
  assert.equal(daytimeAutoEligible({ ...valid, created: dayCutoff - 1 }), false, 'pre-existing political drafts remain held in the expanded daytime route');
  assert.equal(nightEligible({ ...valid, politicalCategory: null }), false, 'missing political category remains with a reviewer');
  assert.equal(daytimeAutoEligible({ ...valid, politicalCategory: null }), false, 'daytime political news needs an explicit category');
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
  const ts = Date.now() - 5 * 60_000; // inside the monitor freshness window: the desk drops older source posts (see news-monitor-freshness.test.js)
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
  assert.equal(draft.politicalCategory, 'negotiation', 'source wording fills the category when the model leaves it unclear');
  assert.equal(draft.politicalNeedsCategory, false);
  assert.equal(nightEligible(draft), false);
  assert.equal(daytimeAutoEligible(draft), false);
  const botDraft = toBotDraft(draft);
  assert.equal(botDraft.politicalCategory, 'negotiation');
  assert.deepEqual(botDraft.politicalSources, [{ name: 'وكالة اختبار', url: item.url, timestamp: new Date(ts).toISOString() }]);
  assert.deepEqual(botDraft.srcs, [{ u: item.src.u, name: item.src.name, url: item.url, ts, local: false }]);
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

test('the local editorial gate accepts faithful copy and rejects omitted numbers', () => {
  const faithful = qualified({
    type: 'explosion',
    headline: 'قال الدفاع المدني السوري: وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص.',
    sourceText: 'قال الدفاع المدني السوري: وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص.',
    loc: { scope: 'place', name_ar: 'حلب', governorate_ar: 'حلب', latitude: 36.2, longitude: 37.1 },
    srcs: [{ u: 'trusted-feed', name: 'قناة الرصد الخاصة', local: false }],
  });
  assert.deepEqual(_test.editorialGate(faithful), { ok: true, reason: null });
  const changedNumber = { ...faithful, headline: 'قال الدفاع المدني السوري: وقع انفجار في مدينة حلب مساء اليوم وأصاب 4 أشخاص.' };
  assert.deepEqual(_test.editorialGate(changedNumber), { ok: false, reason: 'number-or-time-omitted' });
  const rejected = [
    [{ type: 'attack' }, 'type-conflict'],
    [{ loc: { scope: 'place', name_ar: 'حمص', governorate_ar: 'حمص', latitude: 34.7, longitude: 36.7 } }, 'place-missing-from-source'],
    [{ headline: 'قال الدفاع المدني السوري: وقع انفجار مساء اليوم وأصاب 3 أشخاص.' }, 'place-missing-from-headline'],
    [{ headline: 'قال الدفاع المدني السوري: وقع انفجار في مدينة حلب وأصاب 3 أشخاص.' }, 'date-or-time-omitted'],
    [{ headline: 'وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص.' }, 'attribution-changed'],
    [{ headline: 'قالت وزارة الطوارئ: وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص.' }, 'attributed-actor-omitted'],
    [{ headline: 'قال الدفاع المدني السوري: وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص، وقالت وزارة الطوارئ إن الحصيلة 3 أشخاص.' }, 'attributed-actor-invented'],
    [{ sourceText: 'قال الدفاع المدني السوري: ربما وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص.' }, 'uncertainty-changed'],
    [{ headline: 'قال الدفاع المدني السوري: ربما وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص.' }, 'uncertainty-changed'],
    [{ sourceText: 'قال الدفاع المدني السوري: وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص، ونفت الشرطة المحلية وقوع إصابات.' }, 'response-or-context-changed'],
    [{ headline: 'قال الدفاع المدني السوري: وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص، وردت وزارة الطوارئ على الخبر.' }, 'response-or-context-changed'],
    [{ headline: 'قال الدفاع المدني السوري: وقع انفجار كارثي في مدينة حلب مساء اليوم وأصاب 3 أشخاص.' }, 'unsupported-evaluation'],
    [{ headline: 'قال الدفاع المدني السوري: وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص — قناة الرصد الخاصة.' }, 'private-feed-identity'],
    [{ headline: 'قال الدفاع المدني السوري: وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص https://t.me/private_feed/55' }, 'public-link-or-handle'],
  ];
  for (const [overrides, reason] of rejected) {
    assert.deepEqual(_test.editorialGate({ ...faithful, ...overrides }), { ok: false, reason }, `expected rejection: ${reason}`);
  }
});

test('sharp political criticism and explicitly requested opinion copy are never auto-published as straight news', () => {
  const sharp = qualified({
    type: 'political', politicalCategory: 'decision',
    headline: 'صدر اليوم قرار الدعم عن الحكومة الانتقالية السورية في حمص، ويكشف عن حكومة انتقالية فاشلة.',
    sourceText: 'صدر اليوم قرار جديد بشأن الدعم عن الحكومة الانتقالية السورية في حمص.',
    loc: { scope: 'place', name_ar: 'حمص', governorate_ar: 'حمص', latitude: 34.7, longitude: 36.7 },
  });
  assert.deepEqual(_test.editorialGate(sharp), { ok: false, reason: 'sharp-political-tone-not-news' });
  const opinion = qualified({
    type: 'explosion', headline: 'قال الدفاع المدني السوري: وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص.',
    sourceText: 'قال الدفاع المدني السوري: وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص.',
    loc: { scope: 'place', name_ar: 'حلب', governorate_ar: 'حلب', latitude: 36.2, longitude: 37.1 },
    srcs: [{ u: 'trusted-feed', name: 'قناة رصد خاصة', local: false }],
    aiRewritePreview: { mode: 'opinion', applied: true },
  });
  assert.equal(nightEligible(opinion), false, 'an applied opinion/analysis preview cannot enter the auto-publish queue');
  assert.deepEqual(_test.editorialGate(opinion), { ok: false, reason: 'opinion-analysis-not-auto-publish' });
  const satire = { ...opinion, aiRewritePreview: { mode: 'satire', applied: true } };
  assert.equal(nightEligible(satire), false, 'an applied fictional satire preview cannot enter the auto-publish queue');
  const privateNote = { ...opinion, aiRewritePreview: undefined, privateEditorial: { opinion: 'رأي/تحليل: نقد خاص للمالك' } };
  assert.equal(nightEligible(privateNote), false, 'a saved owner-only opinion blocks all automatic publishing');
  assert.equal(daytimeAutoEligible(privateNote), false);
  assert.equal(dayAutoDueAt(privateNote, daytimeStart), null);
  assert.equal(dayAutoReady({ ...privateNote, dayAutoAt: daytimeStart }, daytimeStart + 1), false);
  const privateBotDraft = toBotDraft(privateNote);
  assert.doesNotMatch(JSON.stringify(privateBotDraft), /رأي\/تحليل|نقد خاص للمالك/);
});

test('opinion and satire remain private, while review diagnostics are held before automatic publishing', async () => {
  const previousHandler = _test.R.H;
  let publishAttempts = 0;
  const telegramCalls = [];
  _test.R.H = {
    apis: () => ({ admin: { sendMessage: async (...args) => telegramCalls.push(args) } }),
    publishDraft: async () => { publishAttempts++; return { id: 'must-not-publish' }; },
  };
  const shared = {
    type: 'political', status: 'pending', politicalCategory: 'decision',
    headline: 'أعلنت الحكومة الانتقالية قراراً رسمياً بخفض الدعم في حمص اليوم.',
    sourceText: 'أعلنت الحكومة الانتقالية قراراً رسمياً بخفض الدعم في حمص اليوم.',
    loc: { scope: 'place', name_ar: 'حمص', governorate_ar: 'حمص', latitude: 34.7, longitude: 36.7 },
    srcs: [{ u: 'trusted-feed', local: false }], created: Date.now(), cards: [],
  };
  const privateDrafts = [
    qualified({ ...shared, id: 'auto-private-opinion', privateEditorial: { opinion: 'رأي/تحليل: نقد خاص' } }),
    qualified({ ...shared, id: 'auto-private-satire', privateEditorial: { satire: 'محاكاة ساخرة خيالية (ليست خبراً): نص خيالي' } }),
  ];
  const diagnostic = qualified({
    ...shared, id: 'auto-review-diagnostic', headline: 'لا تقدم المادة وقائع موثقة كافية',
    dayAutoAt: daytimeStart, autoMode: 'day',
  });
  for (const draft of [...privateDrafts, diagnostic]) newsState().drafts[draft.id] = draft;
  try {
    for (const draft of privateDrafts) {
      assert.equal(nightEligible(draft), false);
      assert.equal(await _test.nightPublish(draft), false);
      assert.equal(draft.status, 'pending', 'private commentary remains as an unpublished pending factual draft');
    }
    assert.deepEqual(_test.editorialGate(diagnostic), { ok: false, reason: 'private-editorial-copy-not-public' });
    assert.equal(await _test.nightPublish(diagnostic), false);
    assert.equal(diagnostic.status, 'pending', 'a diagnostic failure remains pending for internal review');
    assert.equal(diagnostic.editorialHold, true);
    assert.equal(diagnostic.dayAutoAt, null, 'the diagnostic draft loses its automatic publication timer');
    assert.throws(() => toBotDraft(diagnostic), /cannot be converted to a public alert/);
    assert.equal(publishAttempts, 0, 'no automatic publisher is called for private notes or review diagnostics');
    assert.equal(telegramCalls.length, 0, 'no public Telegram notice is sent for held drafts');
  } finally {
    _test.R.H = previousHandler;
    for (const draft of [...privateDrafts, diagnostic]) delete newsState().drafts[draft.id];
  }
});

test('daytime publication dispatch accepts a newly qualified type that remains excluded overnight', async () => {
  const previousHandler = _test.R.H;
  const previousRewrite = _test.R.rewriteImpl;
  const state = newsState();
  const previousPublished = state.stats.published;
  const previousAuto = state.stats.auto;
  let publishAttempts = 0;
  const story = 'رصدت مصادر محلية دورية عسكرية قرب بلدة كودنة في القنيطرة اليوم.';
  const draft = qualified({
    id: 'day-auto-patrol-fixture', type: 'patrol', headline: story, sourceText: story,
    created: Date.parse(state.mig.dayAutoAllTypes1) + 1, ts: Date.now(), autoMode: 'day', dayAutoAt: Date.now() - 1,
    loc: { scope: 'place', name_ar: 'كودنة', governorate_ar: 'القنيطرة', latitude: 33.0, longitude: 35.9 },
    srcs: [{ u: 'day-auto-local-test', name: 'قناة اختبار', local: false }], cards: [],
  });
  _test.R.H = {
    apis: () => ({ admin: { sendMessage: async () => ({ message_id: 77 }) } }),
    publishDraft: async (_api, payload) => { publishAttempts++; return { id: 'synthetic-day-alert', payload }; },
  };
  _test.R.rewriteImpl = async (_source, options) => { assert.equal(options.mode, 'news'); return story; };
  state.drafts[draft.id] = draft;
  try {
    assert.equal(nightEligible(draft), false, 'patrol stays excluded from the overnight route');
    assert.equal(daytimeAutoEligible(draft), true);
    assert.equal(dayAutoReady(draft, Date.now()), true);
    assert.equal(await _test.nightPublish(draft), true, 'the day mode must use its expanded daytime eligibility rather than night eligibility');
    assert.equal(publishAttempts, 1);
    assert.equal(draft.status, 'published');
    assert.equal(draft.autoMode, 'day');
  } finally {
    _test.R.H = previousHandler;
    _test.R.rewriteImpl = previousRewrite;
    state.stats.published = previousPublished;
    state.stats.auto = previousAuto;
    delete state.drafts[draft.id];
  }
});

test('automatic publication never invokes rewrites and publishes only source text', async () => {
  const previousHandler = _test.R.H;
  const previousRewrite = _test.R.rewriteImpl;
  const state = newsState();
  const previousPublished = state.stats.published;
  const previousAuto = state.stats.auto;
  const calls = [];
  const modes = [];
  _test.R.H = {
    apis: () => ({ admin: { sendMessage: async () => ({ message_id: 77 }) } }),
    publishDraft: async (_api, draft) => { calls.push(draft); return { id: `synthetic-auto-${calls.length}` }; },
  };
  const base = {
    type: 'explosion', status: 'pending', test: false, rule: false, created: Date.now(), cards: [],
    headline: 'قالت مصادر محلية: وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص.',
    sourceText: 'قالت مصادر محلية: وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص.',
    loc: { scope: 'place', name_ar: 'حلب', governorate_ar: 'حلب', latitude: 36.2, longitude: 37.1 },
    srcs: [{ u: 'trusted-auto-feed', name: 'مصدر اختبار خاص', local: false }],
  };
  const rewritten = qualified({ ...base, id: 'auto-neutral-rewrite' });
  const fallback = qualified({
    ...base, id: 'auto-neutral-fallback',
    headline: 'قالت وزارة الطوارئ السورية: وقع انفجار في حمص مساء اليوم وأصاب شخصين.',
    sourceText: 'قالت وزارة الطوارئ السورية: وقع انفجار في حمص مساء اليوم وأصاب شخصين.',
    loc: { scope: 'place', name_ar: 'حمص', governorate_ar: 'حمص', latitude: 34.7, longitude: 36.7 },
  });
  rewritten.srcs = base.srcs;
  rewritten.headline = base.headline;
  rewritten.sourceText = base.sourceText;
  rewritten.loc = base.loc;
  fallback.srcs = base.srcs;
  newsState().drafts[rewritten.id] = rewritten;
  newsState().drafts[fallback.id] = fallback;
  try {
    _test.R.rewriteImpl = async (_source, options) => {
      modes.push(options.mode);
      return 'قالت مصادر محلية: وقع انفجار في مدينة حلب مساء اليوم وأُصيب 3 أشخاص.';
    };
    assert.equal(nightEligible(rewritten), true);
    assert.equal(await _test.nightPublish(rewritten), true);
    assert.deepEqual(modes, [], 'the automatic publisher never calls an abstractive rewriter');
    assert.equal(calls[0].headline, 'انفجار — حلب');
    assert.equal(calls[0].body, base.sourceText);
    assert.doesNotMatch(JSON.stringify(calls[0]), /رأي\/تحليل|محاكاة ساخرة|EDITORIAL_REVIEW_REQUIRED/);
    assert.equal(rewritten.publishedHeadline, calls[0].headline);

    _test.R.rewriteImpl = async (_source, options) => {
      modes.push(options.mode);
      return 'محاكاة ساخرة خيالية (ليست خبراً): في مسرح الخيال تتغير الوقائع.';
    };
    assert.equal(nightEligible(fallback), true);
    assert.equal(await _test.nightPublish(fallback), true, 'a rejected private-tone rewrite does not change eligibility');
    assert.deepEqual(modes, []);
    assert.equal(calls[1].headline, 'انفجار — حمص');
    assert.equal(calls[1].body, fallback.sourceText);
    assert.doesNotMatch(JSON.stringify(calls[1]), /محاكاة ساخرة|ليست خبراً/);
  } finally {
    _test.R.H = previousHandler;
    _test.R.rewriteImpl = previousRewrite;
    state.stats.published = previousPublished;
    state.stats.auto = previousAuto;
    delete state.drafts[rewritten.id];
    delete state.drafts[fallback.id];
  }
});

test('automatic draft-preparation failures never strand a draft in publishing', async () => {
  const previousHandler = _test.R.H;
  const previousRewrite = _test.R.rewriteImpl;
  const id = 'auto-draft-preparation-failure';
  const headline = 'قالت مصادر محلية: وقع انفجار في مدينة حلب مساء اليوم وأصاب 3 أشخاص.';
  const sources = [{ u: 'trusted-auto-feed', name: 'مصدر اختبار خاص', local: false }];
  sources.map = null;
  const draft = qualified({
    id, type: 'explosion', headline, sourceText: headline, srcs: sources,
    loc: { scope: 'place', name_ar: 'حلب', governorate_ar: 'حلب', latitude: 36.2, longitude: 37.1 },
    created: Date.now(), cards: [], autoMode: 'day', dayAutoAt: Date.now() - 1,
  });
  let publishAttempts = 0;
  _test.R.H = {
    apis: () => ({ admin: { sendMessage: async () => ({ message_id: 78 }) } }),
    publishDraft: async () => { publishAttempts++; return { id: 'must-not-publish' }; },
  };
  _test.R.rewriteImpl = async () => { throw new Error('synthetic rewrite failure'); };
  newsState().drafts[id] = draft;
  try {
    assert.equal(nightEligible(draft), true);
    const attemptedAt = Date.now();
    assert.equal(await _test.nightPublish(draft), false);
    assert.equal(draft.status, 'pending');
    assert.equal(draft.editorialHold, true, 'unusable source metadata requires review instead of a retry loop');
    assert.equal(publishAttempts, 0);
  } finally {
    delete sources.map;
    _test.R.H = previousHandler;
    _test.R.rewriteImpl = previousRewrite;
    delete newsState().drafts[id];
  }
});

test('failed editorial gate keeps an eligible draft pending, clears its timer, and never calls publication', async () => {
  const id = 'editorial-hold-synthetic';
  const draft = qualified({
    id,
    type: 'explosion',
    headline: 'قال الدفاع المدني السوري: وقع انفجار في قرية كودنة مساء اليوم وأصيب 4 أشخاص.',
    sourceText: 'قال الدفاع المدني السوري: وقع انفجار مساء اليوم وأصيب 3 أشخاص ونقلوا إلى مشفى كودنة.',
    loc: { scope: 'place', name_ar: 'كودنة', governorate_ar: 'القنيطرة', latitude: 33.2, longitude: 35.9 },
    srcs: [{ u: 'trusted-feed', name: 'قناة الرصد الخاصة', local: false }],
    dayAutoAt: daytimeStart,
    autoMode: 'day',
    created: Date.now(),
    cards: [],
  });
  const previousHandler = _test.R.H;
  let publishAttempts = 0;
  const telegramCalls = [];
  _test.R.H = {
    apis: () => ({ admin: { sendMessage: async (...args) => telegramCalls.push(args) } }),
    publishDraft: async () => { publishAttempts++; return { id: 'should-not-exist' }; },
  };
  newsState().drafts[id] = draft;
  try {
    assert.equal(nightEligible(draft), true, 'the synthetic draft reaches the editorial gate');
    assert.equal(await _test.nightPublish(draft), false);
    assert.equal(draft.status, 'pending');
    assert.equal(draft.editorialHold, true);
    assert.equal(draft.dayAutoAt, null);
    assert.equal('autoMode' in draft, false);
    assert.equal(nightEligible(draft), false, 'the persistent hold blocks later night and daytime retries');
    assert.equal(dayAutoReady({ ...draft, dayAutoAt: daytimeStart }, daytimeStart + 1), false);
    assert.match(_test.cardText(draft, 'ar'), /موقوفة للمراجعة التحريرية/);
    assert.equal(await _test.nightPublish(draft), false, 'a repeated trigger is stopped before publication');
    assert.equal(publishAttempts, 0, 'the combined Telegram/map publisher is never called');
    assert.equal(telegramCalls.length, 0, 'no Telegram notice or public post is sent by the failed gate');
  } finally {
    _test.R.H = previousHandler;
    delete newsState().drafts[id];
  }
});
