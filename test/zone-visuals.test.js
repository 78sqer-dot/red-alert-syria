import test from 'node:test';
import assert from 'node:assert/strict';
import { zoneVisualKey, pulseVisualKey } from '../shared/zone-visuals.js';

test('identical zone geometry and style share one visual circle', () => {
  const zone = { lon: 36.29, lat: 33.51, km: 1.5 };
  const style = { color: '#ef233c', active: true, dashed: false };
  assert.equal(zoneVisualKey(zone, style), zoneVisualKey({ ...zone }, { ...style }));
});

test('zone aggregation keeps separate category colors, activity state and geometry', () => {
  const zone = { lon: 36.29, lat: 33.51, km: 1.5 };
  const style = { color: '#ef233c', active: true, dashed: false };
  const key = zoneVisualKey(zone, style);
  assert.notEqual(key, zoneVisualKey(zone, { ...style, color: '#64748b' }));
  assert.notEqual(key, zoneVisualKey(zone, { ...style, active: false }));
  assert.notEqual(key, zoneVisualKey({ ...zone, km: 2 }, style));
});

test('pulse aggregation shares identical circles but preserves aircraft styling', () => {
  const zone = { lon: 36.29, lat: 33.51, km: 1.5 };
  assert.equal(pulseVisualKey(zone, '#ef233c', false), pulseVisualKey({ ...zone }, '#ef233c', false));
  assert.notEqual(pulseVisualKey(zone, '#ef233c', false), pulseVisualKey(zone, '#64748b', false));
  assert.notEqual(pulseVisualKey(zone, '#ef233c', false), pulseVisualKey(zone, '#ef233c', true));
});
