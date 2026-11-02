import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_RESPONSE_SCHEMA, buildPrompt, prefilter } from '../server/news-ai.js';

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
  assert.match(sys, /statement, decision, government_announcement, official_announcement, official_entity, negotiation, meeting, election/);
  assert.match(sys, /places may be empty or contain only a place explicitly stated/);
  assert.match(sys, /opinion, analysis, commentary/);
  assert.match(sys, /foreign politics/);
});

test('Gemini response schema includes the political type and allowed category values', () => {
  const properties = AI_RESPONSE_SCHEMA.items.properties;
  assert.ok(properties.type.enum.includes('political'));
  assert.deepEqual(properties.political_category.enum, ['statement', 'decision', 'government_announcement', 'official_announcement', 'official_entity', 'negotiation', 'meeting', 'election', 'none']);
  assert.ok(AI_RESPONSE_SCHEMA.items.required.includes('political_category'));
});
