import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSanaBulletinPosts, pricesCaption, pricesSvg } from '../server/prices.js';

test('SANA fallback accepts only its explicit Central Bank bulletin post with an attached image', () => {
  const html = `
    <div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="sana_gov/189946">
      <div class="tgme_widget_message_text">النشرة الرسمية الصادرة عن مصرف سوريا المركزي اليوم الثلاثاء 3-11-2026 لأسعار الصرف بالليرة السورية.</div>
      <a class="tgme_widget_message_photo_wrap" style="width:640px;background-image:url('https://cdn4.telesco.pe/file/bulletin.jpg')"></a>
      <time datetime="2026-11-03T10:15:12+00:00"></time>
    </div></div>
    <div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="sana_gov/189945">
      <div class="tgme_widget_message_text">خبر آخر عن الطقس.</div>
    </div></div>
    <div class="tgme_widget_message_wrap js-widget_message_wrap"><div class="tgme_widget_message" data-post="impostor/189944">
      <div class="tgme_widget_message_text">النشرة الرسمية الصادرة عن مصرف سوريا المركزي لأسعار الصرف</div>
      <a class="tgme_widget_message_photo_wrap" style="background-image:url('https://cdn4.telesco.pe/file/fake.jpg')"></a>
    </div></div>`;
  const posts = parseSanaBulletinPosts(html);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, '189946');
  assert.equal(posts[0].source, 'sana-telegram');
  assert.equal(posts[0].url, 'https://t.me/sana_gov/189946');
  assert.equal(posts[0].img, 'https://cdn4.telesco.pe/file/bulletin.jpg');
  assert.equal(posts[0].ts, Date.parse('2026-11-03T10:15:12+00:00'));
});

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
