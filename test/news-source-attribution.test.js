import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChannelPage } from '../server/news-sources.js';

const block = (channel, id, text = 'خبر عاجل من المصدر') =>
  `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="${channel}/${id}"><div class="tgme_widget_message_text js-message_text">${text}</div></div></div>`;

test('Telegram channel parsing ignores embedded posts from other channels', () => {
  const html = block('targetFeed', 31) + block('otherFeed', 99, 'محتوى من قناة أخرى');
  const result = parseChannelPage(html, 'TargetFeed');
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].id, 31);
  assert.equal(result.posts[0].url, 'https://t.me/TargetFeed/31');
  assert.match(result.posts[0].text, /خبر عاجل من المصدر/);
});

test('Telegram channel parsing never trusts a mismatched data-post slug for its URL', () => {
  const result = parseChannelPage(block('wrongFeed', 7), 'expectedFeed');
  assert.deepEqual(result.posts, []);
});

test('public post parsing captures image-only, video-only, and mixed media fixtures', () => {
  const fixture = (id, markup) => `<div class="tgme_widget_message_wrap"><div class="tgme_widget_message" data-post="TargetFeed/${id}">${markup}</div></div>`;
  const photo = `<a class="tgme_widget_message_photo_wrap" style="background-image:url('https://cdn4.telesco.pe/file/photo.jpg')"></a>`;
  const video = `<video src="https://cdn4.telesco.pe/file/clip.mp4"></video>`;
  const result = parseChannelPage(fixture(1, photo) + fixture(2, video) + fixture(3, `${photo}${video}`), 'TargetFeed').posts;
  assert.deepEqual(result.map((post) => post.media.map((item) => item.type)), [['photo'], ['video'], ['photo', 'video']]);
  assert.ok(result.every((post) => post.media.every((item) => item.url.startsWith('https://cdn4.telesco.pe/'))));
});

test('public post media parser rejects non-CDN, non-HTTPS, and unsupported file types', () => {
  const markup = `<a class="tgme_widget_message_photo_wrap" style="background-image:url('https://evil.example/file.jpg')"></a><video src="http://cdn4.telesco.pe/file/clip.mp4"></video><video src="https://cdn4.telesco.pe/file/clip.mov"></video>`;
  const result = parseChannelPage(block('TargetFeed', 44).replace('</div></div>', `${markup}</div></div>`), 'TargetFeed');
  assert.deepEqual(result.posts[0].media, []);
});
