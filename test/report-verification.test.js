import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyReportSources } from '../server/news-monitor.js';

const now = Date.parse('2026-10-26T20:00:00Z');
const report = {
  type: 'uav',
  details: 'تحليق طائرة استطلاع',
  location: { scope: 'place', name_ar: 'تل أبيض', name_en: 'Tell Abyad', district_ar: 'تل أبيض', district_en: 'Tell Abyad', governorate_ar: 'الرقة' },
  extra: [],
};

test('manual source check returns a linked recent post matching place and event type', async () => {
  const result = await verifyReportSources(report, {
    now,
    sources: [{ u: 'localnews', name: 'أخبار محلية', on: true }, { u: 'offsource', name: 'مصدر متوقف', on: false }],
    fetchSource: async (source) => ({
      posts: source.u === 'localnews' ? [{
        id: 42,
        ts: now - 5 * 60_000,
        url: 'https://t.me/localnews/42',
        text: 'عاجل: تحليق طائرة مسيّرة فوق تل أبيض بريف الرقة',
      }] : [],
    }),
  });
  assert.equal(result.totalSources, 1);
  assert.equal(result.checkedSources, 1);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].name, 'أخبار محلية');
  assert.equal(result.matches[0].url, 'https://t.me/localnews/42');
  assert.match(result.matches[0].excerpt, /تل أبيض/);
});

test('a source mentioning only the town is not treated as corroborating the reported event', async () => {
  const result = await verifyReportSources(report, {
    now,
    sources: [{ u: 'localnews', name: 'أخبار محلية', on: true }],
    fetchSource: async () => ({ posts: [{
      id: 43,
      ts: now - 5 * 60_000,
      url: 'https://t.me/localnews/43',
      text: 'تعلن البلدية فتح الطريق في تل أبيض اليوم',
    }] }),
  });
  assert.equal(result.matches.length, 0);
  assert.equal(result.checkedSources, 1);
});

test('stale posts are ignored and unreadable sources are counted as failures', async () => {
  const result = await verifyReportSources(report, {
    now,
    sources: [{ u: 'oldnews', name: 'مصدر قديم', on: true }, { u: 'offline', name: 'مصدر متعذر', on: true }],
    fetchSource: async (source) => {
      if (source.u === 'offline') throw new Error('network unavailable');
      return { posts: [{
        id: 1,
        ts: now - 5 * 24 * 60 * 60_000,
        url: 'https://t.me/oldnews/1',
        text: 'تحليق مسيّرة فوق تل أبيض بريف الرقة',
      }] };
    },
  });
  assert.equal(result.totalSources, 2);
  assert.equal(result.checkedSources, 1);
  assert.deepEqual(result.errors, ['مصدر متعذر']);
  assert.equal(result.matches.length, 0);
});
