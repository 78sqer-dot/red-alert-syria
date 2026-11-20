import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');

test('air_movement and civil_plane are hidden from the map filter UI (owner 2026-11-20)', () => {
  assert.match(app, /const FILTER_UI_HIDDEN = new Set\(\['air_movement', 'civil_plane'\]\)/);
  assert.match(app, /def\.types\.filter\(\(t\) => !FILTER_UI_HIDDEN\.has\(t\)\)/, 'group render skips hidden types');
  assert.match(app, /ALERT_GROUPS\[i\.dataset\.g\]\.types\.filter\(\(t\) => !FILTER_UI_HIDDEN\.has\(t\)\)/, 'group toggle skips hidden types');
});
