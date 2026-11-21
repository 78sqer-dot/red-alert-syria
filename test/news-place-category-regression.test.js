import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inferPoliticalCategory } from '../server/news-ai.js';

test('appointment context (مرسوم تعييني) is not appointment news; the agreement owns the category', () => {
  const source = 'محافظ الحسكة نور الدين أحمد للتلفزيون السوري: بدأنا تنفيذ بنود اتفاق 29 كانون الثاني عقب صدور مرسوم تعييني محافظاً للحسكة ووضعنا خطة من ثلاث مراحل';
  assert.equal(inferPoliticalCategory(source), 'agreement');
  assert.equal(inferPoliticalCategory('تعيين وزير في الحكومة السورية'), 'appointment', 'a real appointment still classifies');
  assert.equal(inferPoliticalCategory('صدور مرسوم تعيين محافظ جديد للحسكة'), 'appointment', 'a fresh appointment decree still classifies');
  assert.equal(inferPoliticalCategory('بدأ العمل بالخطة عقب صدور مرسوم تعيين المحافظ منذ شهر'), null, 'retrospective appointment wording is context, not the category');
});

test('word-bounded cues: تقرير is not قرار, اتفاقية wording does not leak between categories', () => {
  assert.equal(inferPoliticalCategory('تقرير رسمي عن الأوضاع الميدانية'), null, 'تقرير must not trigger decision via قرار');
  assert.equal(inferPoliticalCategory('اتفاقية جديدة تخص سوريا'), 'treaty');
  assert.equal(inferPoliticalCategory('اتفاق بين الحكومة السورية والجهة المعنية'), 'agreement');
});

test('place rendering never duplicates the same name (الحسكة، الحسكة / حلب، حلب)', () => {
  const mon = readFileSync(new URL('../server/news-monitor.js', import.meta.url), 'utf8');
  assert.match(mon, /l\.governorate_ar !== l\.name_ar \? l\.governorate_ar : ''/, 'fmtLoc skips a governorate identical to the place name');
  assert.match(mon, /l\.scope !== 'governorate' && l\.governorate_ar !== l\.name_ar \? l\.governorate_ar : ''/, 'whereOf skips a governorate identical to the place name');
  assert.match(mon, /l\.governorate_ar !== l\.district_ar/, 'fmtLoc skips a governorate identical to the district name');
});

test('an administration label is not automatically resolved to Al Idarah village', async () => {
  const { isGenericPlaceWord, resolvePlace } = await import('../server/news-ai.js');
  assert.equal(isGenericPlaceWord('الإدارة'), true);
  assert.equal(isGenericPlaceWord('ادارة'), true);
  assert.equal(resolvePlace({ name: 'الإدارة' }), null);
  const bot = readFileSync(new URL('../server/bot.js', import.meta.url), 'utf8');
  assert.match(bot, /institutionMisPin \? null : a\.place\.governorate/);
  assert.match(bot, /patch\.location = null/);
  assert.match(bot, /patch\.zones = \[\]/);
});


test('arrest of kidnapping-case suspects is not a fresh kidnapping', async () => {
  const { refineType } = await import('../server/news-ai.js');
  const text = 'عملية أمنية تسفر عن توقيف متورطين بقضايا الخطف والابتزاز والاتجار بالمخدرات بريف دير الزور';
  for (const type of ['kidnapping', 'arrest', 'breaking', 'civil']) assert.equal(refineType(type, text), 'arrest');
  assert.equal(refineType('arrest', 'تحرير مختطف وإلقاء القبض على متورطين بقضايا الخطف'), 'kidnapping');
  assert.equal(refineType('kidnapping', 'اختطاف شاب على يد مجهولين في ريف دير الزور'), 'kidnapping');
});
