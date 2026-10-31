import test from 'node:test';
import assert from 'node:assert/strict';
import { CAP_FEED_URL } from '../server/weather-official.js';
import { wxBulletinCaption } from '../server/wx-daily.js';

test('daily weather bulletin caption includes the official CAP feed without throwing', () => {
  const caption = wxBulletinCaption([], [], Date.UTC(2026, 9, 31), { url: 'https://climweb.med.gov.sy/daily' });
  assert.match(caption, /climweb\.med\.gov\.sy\/daily/);
  assert.ok(caption.includes(CAP_FEED_URL));
});
