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
