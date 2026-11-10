import test from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { newsIllustrationSvg, renderNewsIllustrationPng, illustrationTextLayout, illustrationTextWidth, extractIllustrationBrief } from '../server/alert-image.js';

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
const fonts = ['NotoKufiArabic-Regular.ttf', 'NotoKufiArabic-Bold.ttf', 'NotoKufiArabic-ExtraBold.ttf', 'NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'].map((name) => new URL(`../server/assets/fonts/${name}`, import.meta.url).pathname);

function assertTextInsideCard(svg) {
  for (const [text] of svg.matchAll(/<text\b[^>]*>.*?<\/text>/gu)) {
    // Shift into a larger measuring canvas so actual overflow cannot be hidden by the original viewport.
    const measure = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="1024"><g transform="translate(1024 0)">${text}</g></svg>`, { font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Noto Kufi Arabic' } });
    const box = measure.innerBBox();
    assert.ok(box, text);
    assert.ok(box.x - 1024 >= 48, `left clipping: ${text}`);
    assert.ok(box.x - 1024 + box.width <= 978, `right clipping: ${text}`);
    assert.ok(box.y >= 12 && box.y + box.height <= 596, `vertical clipping: ${text}`);
  }
}

test('Arabic and English editorial graphics use only alert facts and clearly label the image as illustrative', () => {
  const ar = newsIllustrationSvg(alert, 'ar');
  const en = newsIllustrationSvg(alert, 'en');
  assert.match(ar, /خبر تجريبي في درعا/);
  assert.match(ar, /نبذة الخبر/);
  assert.match(ar, /تصميم توضيحي · ليس صورة للمشهد/);
  assert.match(en, /Fixture report in Daraa/);
  assert.match(en, /NEWS BRIEF/);
  assert.match(en, /ILLUSTRATIVE GRAPHIC · NOT A SCENE PHOTOGRAPH/);
  assert.doesNotMatch(ar, /<script|onload=/i);
  assertTextInsideCard(ar);
  assertTextInsideCard(en);
});

test('brief is an extractive prefix of at most two real sentences, never an invented summary', () => {
  const source = 'ورد خبر تجريبي من درعا دون تأكيد تفاصيل إضافية. لا توجد حصيلة مؤكدة حتى الآن. هذه جملة ثالثة لا تدخل النبذة.';
  const brief = extractIllustrationBrief(source);
  assert.equal(brief, 'ورد خبر تجريبي من درعا دون تأكيد تفاصيل إضافية. لا توجد حصيلة مؤكدة حتى الآن.');
  const longSource = Array(30).fill('تفاصيل اختبارية غير مؤكدة').join(' ');
  const short = extractIllustrationBrief(longSource);
  assert.ok(longSource.startsWith(short.replace(/…$/, '')));
  assert.ok(short.length <= 181);
  const fallback = illustrationTextLayout({ ...alert, description: '' });
  assert.equal(fallback.briefLines.join(' '), alert.title);
});

test('long Arabic and mixed RTL text wrap by shaped pixel width, not character count', () => {
  for (const text of [
    Array(12).fill('معلومات ميدانية اختبارية غير مؤكدة في محافظة درعا').join(' '),
    'WWWWWWW 2026 دمشق — معلومات اختبارية باللغة العربية مع كلمات LatinMixedWideCharacters',
    'طويلة'.repeat(45),
    'تَفَاصِيلُ اخْتِبَارِيَّةٌ وَمَعْلُومَاتٌ غَيْرُ مُؤَكَّدَةٍ '.repeat(8),
  ]) {
    const fixture = { ...alert, title: text, description: text, place: { name_ar: text }, location: {} };
    const layout = illustrationTextLayout(fixture, 'ar');
    assert.ok(layout.titleLines.length <= 3);
    assert.ok(layout.briefLines.length <= 3);
    assert.ok(layout.titleLines.every((line) => illustrationTextWidth(line, 36, 800) <= 752));
    assert.ok(layout.briefLines.every((line) => illustrationTextWidth(line, 26) <= 888));
    assert.ok(layout.locationLines.every((line) => illustrationTextWidth(line, 22, 700) <= 832));
    assertTextInsideCard(newsIllustrationSvg(fixture, 'ar'));
  }
});

test('editorial card renders to a valid PNG without external photos or map tiles', () => {
  const png = renderNewsIllustrationPng(alert, 'ar');
  assert.ok(Buffer.isBuffer(png));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 10_000);
});
