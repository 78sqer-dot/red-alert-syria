import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleClassify, scanTextPlaces, sharpToneReason, truncateAtWordBoundary } from '../server/news-ai.js';
import { getPlace } from '../server/places.js';

// Regression coverage for two live defects seen on 2026-11-17:
// 1. Public alert descriptions ending mid-word («…الهيئة العامة للإذاع», «…ريف القحطا»)
//    because ruleClassify cut its headline with a hard slice(0, 140).
// 2. A court report («حكم بالسجن المؤبد») pinned on the village whose canonical
//    name is «السجن» (Al Mazraah, Suwayda) because free-text place scanning
//    treated the common noun as a place name.

test('truncateAtWordBoundary never splits a word', () => {
  const text = 'أجرى وفد رسمي زيارة إلى مقر الهيئة العامة للإذاعة والتلفزيون اليوم';
  const cut = truncateAtWordBoundary(text, 40);
  assert.ok(cut.length <= 40);
  assert.ok(text.startsWith(cut));
  assert.equal(text[cut.length], ' ', 'the cut must land on a word boundary');
  assert.equal(truncateAtWordBoundary('قصير', 240), 'قصير', 'short text is untouched');
});

test('rules fallback keeps a full headline instead of cutting it at 140 chars mid-word', () => {
  const text = 'وفاة الزوجين "سليمان كرنوص" وزوجته "سلطانة حسن" اختناقاً جراء استنشاق غازات جمر الحطب أثناء نومهما داخل منزلهما في قرية تل خاتون بريف القحطانية في الحسكة';
  const result = ruleClassify(text);
  assert.ok(result, 'the death report should still classify');
  assert.ok(result.headline.length > 140, 'headline must not be capped at the old 140 chars');
  assert.ok(result.headline.endsWith('الحسكة'), 'headline must keep the complete final word');
  assert.ok(!result.headline.endsWith('القحطا'), 'headline must not end mid-word');
});

test('«بالسجن» (a prison sentence) is not scanned as the village of Al-Sijn/Al-Mazraah', () => {
  const text = 'صدر حكم قضائي بالسجن المؤبد بحق مرتكب جريمة قتل في قرية المتونة بريف السويداء.';
  const ids = scanTextPlaces(text, '05', 3);
  assert.ok(!ids.includes(172441), 'place 172441 (السجن / Al Mazraah) must not be matched from «بالسجن»');
  assert.ok(ids.includes(173483), 'the real village in the text (المتونة) should still be found');
  assert.equal(getPlace(173483)?.ar, 'المتونة');
});

test('ruleClassify does not propose «السجن» as a place for a court sentence', () => {
  const text = 'صدر حكم قضائي بالسجن المؤبد بحق مرتكب جريمة قتل في قرية المتونة بريف السويداء.';
  const result = ruleClassify(text);
  assert.ok(result, 'the report should still classify');
  assert.ok(!(result.places || []).some((p) => p.name === 'السجن'), '«السجن» must not be a proposed place');
});

// Batch 2: the rules fallback has no model to rewrite with, so a sharp, satirical
// or opinionated source lead must not become the public headline verbatim.
test('sharpToneReason flags only clear rhetoric, not factual copy', () => {
  assert.equal(sharpToneReason('انفجار عبوة ناسفة في مدينة إدلب أدى إلى إصابة شخصين'), null);
  assert.equal(sharpToneReason('قصف مدفعي استهدف أطراف بلدة كويا بريف درعا'), null);
  assert.equal(sharpToneReason('سخرية واسعة بعد الحادثة الأخيرة في إدلب'), 'satirical-tone');
  assert.equal(sharpToneReason('برأيي أن ما يجري في درعا لا يمكن السكوت عنه'), 'opinion-tone');
  assert.equal(sharpToneReason('يسقط حكم الطاغية الخائن'), 'slogan-tone');
});

test('rules fallback replaces a satirical lead with a factual type + place headline', () => {
  const text = 'سخرية واسعة بعد انفجار عبوة ناسفة في مدينة إدلب، فإلى متى يبقى هذا الاستهتار بحياة الناس';
  const result = ruleClassify(text);
  assert.ok(result, 'the incident should still classify');
  assert.equal(result.toneGuard, 'satirical-tone');
  assert.doesNotMatch(result.headline, /سخرية|إلى متى/);
  assert.match(result.headline, /^انفجار — /);
});

test('rules fallback replaces an opinion-framed lead and leaves factual leads untouched', () => {
  const opinion = ruleClassify('برأيي أن ما حدث من قصف مدفعي على بلدة كويا بريف درعا أمر لا يمكن السكوت عنه');
  assert.ok(opinion);
  assert.equal(opinion.toneGuard, 'opinion-tone');
  assert.doesNotMatch(opinion.headline, /برأيي/);
  const factual = ruleClassify('انفجار عبوة ناسفة في مدينة إدلب أدى إلى إصابة شخصين بجروح طفيفة');
  assert.ok(factual);
  assert.equal(factual.toneGuard, undefined);
  assert.equal(factual.headline, 'انفجار عبوة ناسفة في مدينة إدلب أدى إلى إصابة شخصين بجروح طفيفة');
});
