import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
const map = readFileSync(new URL('../public/js/map.js', import.meta.url), 'utf8');

test('screen-level decorative map pulses are removed while alert marker pulses remain', () => {
  assert.doesNotMatch(html, /ambient-pulse/);
  assert.doesNotMatch(css, /ambient-pulse|ambientPulse/);
  assert.doesNotMatch(map, /ambient-pulse-layer|pulseLayer/);
  assert.match(css, /\.news-pulse-ring/);
  assert.match(css, /urgentPulseWave/);
});
