import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL(`../server/${name}.js`, import.meta.url), 'utf8');
const [news, army, roads, borders, jobs, services, prices, weather] = await Promise.all([
  'news-monitor', 'army', 'road-monitor', 'borders', 'jobs', 'services', 'prices', 'wx-daily',
].map(read));

const occurrences = (text, pattern) => (text.match(pattern) || []).length;

test('automatic-monitor notification dispatches use both shared-owner recipients', () => {
  assert.match(news, /const reviewerIds = \(\) => automaticMonitorRecipientIds\(\);/);
  assert.equal(occurrences(news, /for \(const uid of automaticMonitorRecipientIds\(\)\)/g), 2,
    'automatically reviewed news cards and night notices/summaries go to both shared accounts');
  assert.match(army, /const ids = automaticMonitorRecipientIds\(\);/);
  assert.equal(occurrences(roads, /for \(const uid of automaticMonitorRecipientIds\(\)\)/g), 2,
    'road-monitor review and automatic-publication notices use both shared accounts');
  assert.match(borders, /for \(const uid of automaticMonitorRecipientIds\(\)\)/);
  assert.match(jobs, /if \(current\.kind === 'source'\) \{\s*const owners = automaticMonitorRecipientIds\(\);[\s\S]{0,900}for \(const owner of owners\)/,
    'monitored job announcements are sent to both shared accounts');
  assert.match(jobs, /const owner = config\.ownerIds\?\.\[0\];/,
    'employer submissions retain the configured owner path');
  assert.match(services, /const reviewerIds = \(\) => automaticMonitorRecipientIds\(\);/);
  assert.match(prices, /for \(const id of automaticMonitorRecipientIds\(\)\)/);
  assert.match(weather, /for \(const id of automaticMonitorRecipientIds\(\)\)/);
});

test('manual news-owner approvals keep their existing shared-owner notification path', () => {
  assert.match(news, /for \(const ownerId of ownerIdsU\(\)\) \{\s*if \(Number\(ownerId\) === Number\(ctx\.from\.id\)\) continue;/);
});
