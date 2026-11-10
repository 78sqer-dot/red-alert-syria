import test from 'node:test';
import assert from 'node:assert/strict';
import { newsIllustrationSvg, renderNewsIllustrationPng } from '../server/alert-image.js';

const alert = {
  id: 'fixture-illustration-0000000000000000000000000000',
  type: 'breaking',
  title: 'خبر تجريبي في درعا',
  title_en: 'Fixture report in Daraa',
  description: 'تفاصيل اختبارية مقتضبة لا تصف مشهداً بصرياً.',
  description_en: 'Short fixture detail that does not depict a scene.',
  location: { scope: 'place', name_ar: 'درعا', name_en: 'Daraa', governorate_ar: 'درعا', governorate_en: 'Daraa' },
  place: { name_ar: 'درعا', name_en: 'Daraa', governorate_ar: 'درعا', governorate_en: 'Daraa' },
  timestamp: '2026-11-10T10:00:00.000Z',
};

test('Arabic and English editorial graphics use only alert facts and label the image as illustrative', () => {
  const ar = newsIllustrationSvg(alert, 'ar');
  const en = newsIllustrationSvg(alert, 'en');
  assert.match(ar, /خبر تجريبي في درعا/);
  assert.match(ar, /درعا/);
  assert.match(ar, /تصميم توضيحي · ليس صورة للمشهد/);
  assert.match(en, /Fixture report in Daraa/);
  assert.match(en, /ILLUSTRATIVE GRAPHIC · NOT A SCENE PHOTOGRAPH/);
  assert.doesNotMatch(ar, /<script|onload=/i);
});

test('editorial card renders to a valid PNG without external photos or map tiles', () => {
  const png = renderNewsIllustrationPng(alert, 'ar');
  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 10_000);
});
