import test from 'node:test';
import assert from 'node:assert/strict';
import { dayAutoDueAt, dayAutoReady, daytimeAutoEligible, daytimeWindow } from '../server/news-monitor.js';

const at = (iso) => Date.parse(iso);
const daytimeStart = at('2026-10-27T05:00:00Z'); // 08:00 in Damascus
const qualified = (overrides = {}) => ({
  id: 'news-draft',
  status: 'pending',
  test: false,
  rule: false,
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

test('the scheduler considers only still-pending eligible drafts whose saved deadline has elapsed', () => {
  const due = daytimeStart + 120_000;
  const draft = qualified({ dayAutoAt: due });
  assert.equal(dayAutoReady(draft, due - 1), false);
  assert.equal(dayAutoReady(draft, due), true);
  assert.equal(dayAutoReady({ ...draft, status: 'ignored' }, due), false);
  assert.equal(dayAutoReady({ ...draft, rule: true }, due), false);
});
