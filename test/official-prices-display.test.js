import test from 'node:test';
import assert from 'node:assert/strict';
import { pricesCaption, pricesSvg } from '../server/prices.js';

test('stale official fuel prices remain identified but are not printed as current prices', () => {
  const now = Date.parse('2026-10-31T00:00:00+03:00');
  const st = {
    fuel: {
      official: true,
      since: '2026-09-13',
      checked: Date.parse('2026-10-30T00:00:00+03:00'),
      srcs: ['SANA'],
      url: 'https://sana.sy/economy/example',
      items: {
        benzin: { price: 175, name: 'بنزين أوكتان 90', unit: 'لتر' },
        diesel: { price: 175, name: 'مازوت', unit: 'لتر' },
        gas: { price: 14000, name: 'غاز منزلي', unit: 'أسطوانة' },
      },
    },
  };
  const image = pricesSvg(st, now);
  const caption = pricesCaption(st, now);
  assert.doesNotMatch(image, /بنزين أوكتان 90|14000/);
  assert.doesNotMatch(caption, /بنزين أوكتان 90|14000/);
  assert.match(caption, /آخر قرار رسمي للمحروقات/);
});
