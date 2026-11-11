import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_RESPONSE_SCHEMA, buildPrompt, hasExplicitDroneFlight, isGroundIncursionReport, keywordTypes, prefilter, refineType, rewriteArabicNews, ruleClassify, NEWS_REWRITE_MODEL } from '../server/news-ai.js';

test('Syria-only general feeds reject foreign weather warnings before the weather shortcut', () => {
  const foreign = prefilter('عاجل: تحذير جوي رسمي من عواصف رعدية وأمطار غزيرة في كييف يرجى الحذر', { general: true, breaking: true });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.why, 'not-syria');
});

test('official weather warnings with a named Syrian place remain eligible for review', () => {
  const local = prefilter('تحذير جوي رسمي من عواصف رعدية وأمطار غزيرة في حمص يرجى الحذر من السيول', { general: true });
  assert.equal(local.ok, true);
  assert.equal(local.weather?.hazard, 'storm');
});

test('routine forecast posts do not pass the filter merely because they start with breaking', () => {
  const forecast = prefilter('عاجل: توقعات الطقس لليوم في دمشق ودرجات الحرارة المتوقعة', { general: true, breaking: true });
  assert.equal(forecast.ok, false);
  assert.equal(forecast.why, 'routine-weather');
});

test('generic drone overflight wording stays a UAV sighting, not a warplane', () => {
  const text = 'رصد تحليق مسيرة استطلاع فوق ريف دمشق خلال ساعات الفجر';
  const types = keywordTypes(text);
  assert.ok(types.includes('uav'));
  assert.equal(types.includes('warplane'), false, 'generic تحليق must not imply a military jet');
  assert.equal(refineType('warplane', text), 'uav', 'an AI fallback to warplane is corrected to the explicit UAV type');
});

test('explicit military aircraft wording remains a warplane classification', () => {
  const text = 'رصد تحليق طائرات حربية في أجواء ريف دمشق خلال ساعات الفجر';
  assert.ok(keywordTypes(text).includes('warplane'));
  assert.equal(refineType('uav', text), 'warplane', 'specific aircraft wording overrides a generic UAV fallback');
});

test('a reported ground incursion stays primary when the same report explicitly mentions a flying drone', () => {
  const text = 'توغلت قوات الاحتلال الإسرائيلي إلى قرية حضر في ريف القنيطرة، بالتزامن مع تحليق مسيّرة استطلاع في المنطقة.';
  assert.equal(isGroundIncursionReport(text), true);
  assert.equal(hasExplicitDroneFlight(text), true);
  const result = ruleClassify(text, { breaking: true });
  assert.equal(result?.type, 'military_incursion');
  assert.equal(result?.dronePresence, true, 'the explicit flight mention is retained as a secondary visual hint');
  assert.equal(refineType('uav', text), 'military_incursion', 'an AI UAV fallback cannot override the reported ground event');

  const strike = 'توغلت قوات الاحتلال إلى قرية حضر في ريف القنيطرة ونفذت استهدافاً بمسيّرة.';
  assert.equal(refineType('uav_strike', strike), 'uav_strike', 'a separately reported drone strike remains a specific violent event');
});

test('specific Syrian political developments pass only when political keywords are present', () => {
  const post = 'أعلنت الرئاسة السورية بدء مفاوضات رسمية جديدة مع ممثلي القوى الوطنية حول المرحلة المقبلة';
  const result = prefilter(post, { general: true });
  assert.equal(result.ok, true);
  assert.ok(result.kt.includes('political'));
});

test('new political-button wording reaches classification only with Syrian context', () => {
  const samples = [
    'إعلان حكومي سوري جديد بشأن سياسة الدعم في محافظة حلب بعد اجتماع مجلس الوزراء اليوم',
    'إعلان رسمي صادر عن جهة رسمية سورية حول قرار إداري جديد في دمشق اليوم',
    'بيان صادر عن جهة رسمية سورية يوضح قراراً جديداً في محافظة حمص اليوم',
  ];
  for (const post of samples) {
    const result = prefilter(post, { general: true });
    assert.equal(result.ok, true, post);
    assert.ok(result.kt.includes('political'), post);
  }
  const foreign = prefilter('إعلان حكومي أردني جديد بشأن قرار إداري في عمان اليوم بعد اجتماع مجلس الوزراء', { breaking: true });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.why, 'not-syria');
});

test('foreign politics and generic political commentary do not pass the political prefilter', () => {
  const foreign = prefilter('أعلنت الحكومة الأردنية اليوم تعيين وزير جديد بعد صدور قرار رسمي في عمان', { breaking: true });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.why, 'not-syria');
  const opinion = prefilter('رأي وتحليل سياسي عام حول مستقبل المنطقة في مقال مطول عن الأوضاع والتطورات');
  assert.equal(opinion.ok, false);
  assert.equal(opinion.why, 'no-keywords');
});

test('political prompt requires attribution and conservative Syrian categories without invented locations', () => {
  const { sys } = buildPrompt([{ i: 1, source: 'test', ago: 'now', text: 'تطور سياسي سوري محدد' }], [], 'now');
  assert.match(sys, /political_category/);
  assert.match(sys, /agreement, signing, treaty, circular, support, military_cooperation, statement, position, decision, appointment, official_announcement, government_announcement, official_entity, negotiation, meeting, visit, or election/);
  assert.match(sys, /places may be empty or contain only a place explicitly stated/);
  assert.match(sys, /opinion, analysis, commentary/);
  assert.match(sys, /foreign politics/);
  assert.match(sys, /concise, calm, factual, neutral Arabic news sentence/);
  assert.match(sys, /calm, factual, neutral Arabic news sentence/);
  assert.match(sys, /do not add political criticism, praise, condemnation, sarcasm, slogans, rhetorical hooks, loaded labels, or a sharply critical angle in straight news/);
  assert.doesNotMatch(sys, /Criticism of a policy or party .* is allowed/);
  assert.match(sys, /Preserve material facts, dates\/times, locations, uncertainty, and relevant response\/context/);
  assert.match(sys, /PRIVATE routing metadata: never reveal it/);
  assert.match(sys, /never invent a denial or counterclaim for false balance/);
  assert.match(sys, /Do not turn public-safety information into political advocacy/);
});

test('Gemini response schema includes the political type and allowed category values', () => {
  const properties = AI_RESPONSE_SCHEMA.items.properties;
  assert.ok(properties.type.enum.includes('political'));
  assert.deepEqual(properties.political_category.enum, ['agreement', 'signing', 'treaty', 'circular', 'support', 'military_cooperation', 'statement', 'position', 'decision', 'appointment', 'official_announcement', 'government_announcement', 'official_entity', 'negotiation', 'meeting', 'visit', 'election', 'none']);
  assert.ok(AI_RESPONSE_SCHEMA.items.required.includes('political_category'));
});

test('explicit opinion rewrite is labeled, sharp toward transitional-government policy, and source-grounded', async () => {
  let request;
  const output = 'خفض الدعم يحمّل الأسر أعباء إضافية وفق الأرقام الواردة في المصدر.';
  const result = await rewriteArabicNews('أعلنت الحكومة الانتقالية خفض الدعم، وتضمن البيان تقديراً لزيادة كلفة المعيشة.', {
    key: 'dedicated-free-key', mode: 'opinion',
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: output }] } }] }) };
    },
  });
  assert.match(result, /^رأي\/تحليل:/, 'opinion text is labeled even if the provider omits the label');
  const system = JSON.parse(request.options.body).systemInstruction.parts[0].text;
  assert.match(system, /بنقد حاد وواضح لسياسات الحكومة الانتقالية السورية/);
  assert.match(system, /استند حصراً إلى وقائع قابلة للتحقق/);
  assert.match(system, /لا تخترع وقائع أو أسباباً أو دوافع أو ردوداً/);
  assert.match(system, /لا تستخدم تلاعباً نفسياً/);
});

test('professional rewrite is disabled without its dedicated key and does not fall back to GEMINI_API_KEY', async () => {
  const old = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'classification-key-must-not-be-used';
  let requests = 0;
  try {
    await assert.rejects(
      rewriteArabicNews('مصدر الخبر', { fetchImpl: async () => { requests++; throw new Error('unexpected request'); } }),
      /NEWS_REWRITE_GEMINI_API_KEY/,
    );
    assert.equal(requests, 0, 'missing dedicated key causes no provider call');
  } finally {
    if (old === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = old;
  }
});

test('professional rewrite uses only the fixed fast free-tier model and returns plain text', async () => {
  let request;
  const text = 'قالت مصادر محلية إن اشتباكات اندلعت قرب حارم في ريف إدلب مساء اليوم.';
  const output = 'أفادت مصادر محلية باندلاع اشتباكات قرب حارم بريف إدلب مساء اليوم.';
  const result = await rewriteArabicNews(text, {
    key: 'dedicated-free-key',
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: output }] } }] }) };
    },
  });
  assert.equal(result, output);
  assert.match(request.url, new RegExp(`/models/${NEWS_REWRITE_MODEL}:generateContent\\?key=`));
  assert.match(request.url, /dedicated-free-key/);
  assert.match(request.options.body, /SOURCE:/);
  assert.match(request.options.body, /حالة الحدث والشك/);
  assert.match(request.options.body, /اسم قناة الرصد المرسل/);
  assert.match(request.options.body, /لا تخترع رداً أو ادعاء مضاداً لصنع توازن زائف/);
  assert.match(request.options.body, /لا تضف نقداً سياسياً حاداً أو مديحاً أو إدانة/);
  assert.match(request.options.body, /لا تحول الادعاء إلى حقيقة/);
  assert.equal(JSON.parse(request.options.body).generationConfig.temperature, 0.1);
});
