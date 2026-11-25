import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Owner order 2026-11-26: ONE EVENT = ONE CHANNEL POST. Regression sample:
// the Hasakah/Mushairifa cluster of 2026-11-25 (posts 1595-1610) — one ISIS
// attack on a security HQ in the Mushairifa neighbourhood shipped as ~11
// posts because the matcher demanded the same type family and compared
// headlines only. Same-event follow-ups must now match across types; a
// different incident (another city, or another event in the same city)
// must still publish.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-event-grouping-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = 'fake-token-for-tests';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';

const { sameIncident, casualtySig } = await import('../server/news-monitor.js');
test.after(async () => { await fs.promises.rm(dataDir, { recursive: true, force: true }); });

const T0 = Date.parse('2026-11-25T19:03:00Z');
const CITY = { pts: [{ lat: 36.50237, lon: 40.74772 }], dists: [], govs: ['الحسكه'], coarse: false, none: false };
const GOV = { pts: [], dists: [], govs: ['الحسكه'], coarse: true, none: false };
const ev = (type, text, where, geo, min = 0, headline = '') => ({ type, ts: T0 + min * 60_000, headline: headline || text, text, where, geo });

// The original published alert (post 1595, clashes).
const ORIG = ev('clashes', 'سماع أصوات اشتباكات في حي المشيرفة بمدينة الحسكة', 'المشيرفة، الحسكة', CITY, 0);

test('casualty signatures: the literal 1603/1607 repeat carries the same signature', () => {
  assert.equal(casualtySig('إعلان مقتل عنصرين من الأمن الداخلي وإصابة 5 آخرين في الهجوم'), 'k2w5');
  assert.equal(casualtySig('قتيلان و٥ جرحى في هجوم الحسكة'), 'k2w5');
  assert.equal(casualtySig('انفجار دون إصابات'), null);
});

test('cluster follow-ups match the original across types (breaking / clashes / explosion)', () => {
  assert.equal(sameIncident(ev('breaking', 'قوى الأمن الداخلي تدفع بتعزيزات أمنية إلى حي المشيرفة في الحسكة', 'المشيرفة، الحسكة', CITY, 16), ORIG), true, '1597 reinforcements');
  assert.equal(sameIncident(ev('clashes', 'سماع أصوات ثلاثة انفجارات واشتباكات في المشيرفة بالحسكة', 'المشيرفة، الحسكة', CITY, 16), ORIG), true, '1598 explosions heard');
  assert.equal(sameIncident(ev('explosion', 'صوت الانفجار الذي سُمِع في حي المشيرفة بالحسكة ناجم عن تفجير دراجة نارية مفخخة عند مدخل نقطة أمنية', 'المشيرفة، الحسكة', CITY, 89), ORIG), true, '1599 motorbike bomb');
});

test('cluster follow-ups match via distinctive objects and casualty facts', () => {
  const bomb = ev('explosion', 'صوت الانفجار الذي سُمِع في حي المشيرفة بالحسكة ناجم عن تفجير دراجة نارية مفخخة عند مدخل نقطة أمنية', 'المشيرفة، الحسكة', CITY, 89);
  assert.equal(sameIncident(ev('explosion', 'العثور على أشلاء تعود لمفجر الدراجة المفخخة في الحسكة', 'الحسكة', CITY, 98), bomb), true, '1601 remains of the same bomber');
  assert.equal(sameIncident(ev('martyrdom', 'إعلان مقتل عنصري أمن داخلي وإصابة 5 آخرين في الهجوم على مقر عسكري بحي مشيرفة في الحسكة', 'مشيرفة بمدينة الحسكة، الحسكة', GOV, 110), ORIG), true, '1603 casualty report');
});

test('a genuinely different event still publishes: another city, or another incident in the same city', () => {
  assert.equal(sameIncident(ev('warplane', 'تحليق طائرات حربية إسرائيلية في أجواء محافظة درعا', 'درعا', { pts: [{ lat: 32.61889, lon: 36.10213 }], dists: [], govs: ['درعا'], coarse: false, none: false }, 106), ORIG), false, '1606 Daraa warplane');
  assert.equal(sameIncident(ev('fire', 'حريق كبير في سوق الهال بمدينة الحسكة التهم عدة محلات تجارية وفرق الإطفاء تعمل على إخماده', 'الحسكة', CITY, 130), ORIG), false, 'a market fire in the same city is a different event');
  assert.equal(sameIncident(ev('clashes', 'اشتباكات عنيفة بين فصائل في مدينة القامشلي بريف الحسكة', 'القامشلي، الحسكة', { pts: [{ lat: 37.05, lon: 41.21 }], dists: [], govs: ['الحسكه'], coarse: false, none: false }, 60), ORIG), false, 'Qamishli clashes are a different event');
});

test('the type window still bounds grouping', () => {
  assert.equal(sameIncident(ev('explosion', 'تفجير دراجة نارية مفخخة عند مدخل نقطة أمنية في حي المشيرفة بالحسكة', 'المشيرفة، الحسكة', CITY, 600), ORIG), false, '10h later is outside the 360-min window');
});
