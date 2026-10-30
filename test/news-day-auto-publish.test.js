import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-day-auto-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
const { store } = await import('../server/store.js');
await store.init(null);
const { dayAutoDueAt, dayAutoReady, daytimeAutoEligible, daytimeWindow, nightEligible } = await import('../server/news-monitor.js');

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

const at = (iso) => Date.parse(iso);
const daytimeStart = at('2026-10-27T05:00:00Z'); // 08:00 in Damascus
const qualified = (overrides = {}) => ({
  id: 'news-draft',
  type: 'attack',
  status: 'pending',
  test: false,
  rule: false,
  loc: { scope: 'place', latitude: 33.5, longitude: 36.3 },
  srcs: [{ u: 'test-main-source', local: false }],
  ...overrides,
});

test('daytime fallback window follows Damascus time and excludes 22:00–08:00', () => {
  assert.equal(daytimeWindow(at('2026-10-27T04:59:00Z')), false); // 07:59
  assert.equal(daytimeWindow(daytimeStart), true); // 08:00
  assert.equal(daytimeWindow(at('2026-10-27T18:59:00Z')), true); // 21:59
  assert.equal(daytimeWindow(at('2026-10-27T19:00:00Z')), false); // 22:00
});

test('a qualifying pending AI news draft gets exactly one two-minute deadline during the day', () => {
  assert.equal(dayAutoDueAt(qualified(), daytimeStart), daytimeStart + 120_000);
  assert.equal(dayAutoDueAt(qualified({ dayAutoAt: daytimeStart + 30_000 }), daytimeStart), null);
  assert.equal(dayAutoDueAt(qualified(), at('2026-10-27T19:00:00Z')), null);
});

test('test, rules-only, low-confidence, and already handled drafts never qualify', () => {
  assert.equal(daytimeAutoEligible(qualified({ test: true })), false);
  assert.equal(daytimeAutoEligible(qualified({ rule: true })), false);
  assert.equal(daytimeAutoEligible(qualified({ srcs: [{ u: 'local-only', local: true }] })), false);
  assert.equal(daytimeAutoEligible(qualified({ status: 'ignored' })), false);
  assert.equal(daytimeAutoEligible(qualified({ status: 'published' })), false);
  assert.equal(daytimeAutoEligible(qualified({ status: 'duplicate' })), false);
  assert.equal(daytimeAutoEligible(qualified({ srcs: [{ u: 'local-one', local: true }, { u: 'local-two', local: true }] })), true);
});

test('high-risk categories and drafts without a verified map point are held for human review', () => {
  for (const type of ['breaking', 'weather', 'civil']) {
    assert.equal(nightEligible(qualified({ type })), false, `${type} must not auto-publish`);
  }
  assert.equal(nightEligible(qualified({ loc: { scope: 'country', latitude: null, longitude: null } })), false);
  assert.equal(nightEligible(qualified({ loc: { scope: 'place', latitude: null, longitude: null } })), false);
});

test('the scheduler considers only still-pending eligible drafts whose saved deadline has elapsed', () => {
  const due = daytimeStart + 120_000;
  const draft = qualified({ dayAutoAt: due });
  assert.equal(dayAutoReady(draft, due - 1), false);
  assert.equal(dayAutoReady(draft, due), true);
  assert.equal(dayAutoReady({ ...draft, status: 'ignored' }, due), false);
  assert.equal(dayAutoReady({ ...draft, rule: true }, due), false);
});
