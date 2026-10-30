import test from 'node:test';
import assert from 'node:assert/strict';
import { prefilter } from '../server/news-ai.js';

test('Syria-only general feeds reject foreign weather warnings before the weather shortcut', () => {
  const foreign = prefilter('عاجل: تحذير جوي رسمي من عواصف رعدية وأمطار غزيرة في كييف يرجى الحذر', { general: true, breaking: true });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.why, 'not-syria');
});

test('official weather warnings with a named Syrian place remain eligible for review', () => {
  const local = prefilter('تحذير جوي رسمي من عواصف رعدية وأمطار غزيرة في حمص يرجى الحذر من السيول', { general: true });
  assert.equal(local.ok, true);
  assert.equal(local.weather?.hazard, 'storm');
});

test('routine forecast posts do not pass the filter merely because they start with breaking', () => {
  const forecast = prefilter('عاجل: توقعات الطقس لليوم في دمشق ودرجات الحرارة المتوقعة', { general: true, breaking: true });
  assert.equal(forecast.ok, false);
  assert.equal(forecast.why, 'routine-weather');
});
