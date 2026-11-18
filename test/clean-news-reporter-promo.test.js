import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPublicNewsAttribution } from '../server/clean-text.js';

test('public news cleanup removes a trailing correspondent-details promo without changing the story', () => {
  const fact = 'مرسوم رئاسي سوري يقضي بتعيين أحمد رواد محمد بشار رمضان وزيراً للاقتصاد والتجارة الخارجية.';
  assert.equal(cleanPublicNewsAttribution(`${fact}\n\nالتفاصيل مع مراسلنا عمر الشيخ إبراهيم`), fact);
  assert.equal(cleanPublicNewsAttribution(`${fact}\nالتفاصيل مع مراسلتنا`), fact);
});

test('public news cleanup removes an inline reporter promo but retains factual reporter attribution', () => {
  const fact = 'أعلنت الوزارة صدور المرسوم اليوم.';
  assert.equal(cleanPublicNewsAttribution(`${fact} التفاصيل مع مراسلنا عمر الشيخ إبراهيم`), fact);
  const attributed = 'قال مراسلنا عمر الشيخ إبراهيم إن الوزارة أصدرت المرسوم اليوم.';
  assert.equal(cleanPublicNewsAttribution(attributed), attributed);
});
