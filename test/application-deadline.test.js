import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApplicationDeadline, damascusDate, isApplicationDeadlineExpired } from '../server/application-deadline.js';

test('application deadline accepts ISO dates and Arabic and Persian numerals only', () => {
  assert.equal(normalizeApplicationDeadline('2026-11-06'), '2026-11-06');
  assert.equal(normalizeApplicationDeadline('٢٠٢٦-١١-٠٦'), '2026-11-06');
  assert.equal(normalizeApplicationDeadline('۲۰۲۶-۱۱-۰۶'), '2026-11-06');
  assert.equal(normalizeApplicationDeadline('2026-02-30'), undefined);
  assert.equal(normalizeApplicationDeadline('06/11/2026'), undefined);
  assert.equal(normalizeApplicationDeadline(''), null);
});

test('a deadline stays active to the end of the date in Asia/Damascus', () => {
  const justBeforeMidnight = Date.parse('2026-11-06T20:59:59Z');
  const midnight = Date.parse('2026-11-06T21:00:00Z');
  assert.equal(damascusDate(justBeforeMidnight), '2026-11-06');
  assert.equal(damascusDate(midnight), '2026-11-07');
  assert.equal(isApplicationDeadlineExpired('2026-11-06', justBeforeMidnight), false);
  assert.equal(isApplicationDeadlineExpired('2026-11-06', midnight), true);
  assert.equal(isApplicationDeadlineExpired(null, midnight), false);
});
