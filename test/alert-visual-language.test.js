import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ALERT_TYPES } from '../shared/types.js';

const map = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/css/app.css', import.meta.url), 'utf8');
const svgs = await readFile(new URL('../public/js/marker-svgs.js', import.meta.url), 'utf8');

test('security alert emojis are present and semantically distinct', () => {
  assert.equal(ALERT_TYPES.breaking.emoji, '🚨');
  assert.equal(ALERT_TYPES.uav.emoji, '🛩️');
  assert.equal(ALERT_TYPES.warplane.emoji, '✈️');
  assert.equal(ALERT_TYPES.artillery.emoji, '💣');
  assert.notEqual(ALERT_TYPES.uav.emoji, ALERT_TYPES.warplane.emoji);
});

test('warplane keeps the three-aircraft formation while the drone keeps its current orbit', () => {
  assert.match(map, /t\.marker === 'orbit'/);
  assert.match(map, /t\.marker === 'squad'/);
  assert.match(map, /pl\(16, 22, -8, 1\).*pl\(14, 6, 12, 0\.85\).*pl\(14, 38, 12, 0\.85\)/);
  assert.match(css, /\.maplibregl-map\.zoom-detail \.uav\s*\{\s*animation:\s*uavOrbit 9s linear infinite;/);
  assert.match(css, /\.mk-squad \.squad \.sq\s*\{\s*scale: 1; animation: squadFlyZ 7s linear infinite;/);
  assert.match(svgs, /"uav":/);
  assert.match(svgs, /"plane":/);
});

test('live alert circles use compositor-safe pulse layers and remain clickable through zone hit testing', () => {
  assert.match(map, /this\._syncPulses\(pulses\)/);
  assert.match(map, /const hit = this\.zoneAt\(e\.lngLat\)/);
  assert.match(css, /\.zp-fill[\s\S]*animation: zfillPulse/);
});
