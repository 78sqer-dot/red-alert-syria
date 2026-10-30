import test from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_GROUPS, ALERT_TYPES, TYPE_KEYS, assassinationWeaponGlyph } from '../shared/types.js';
import { NEWS_TYPES, keywordTypes, refineType, ruleClassify } from '../server/news-ai.js';
import { sameIncident } from '../server/news-monitor.js';
import { EXTRA_SVG } from '../public/js/target-svgs.js';

test('map types keep drone targeting distinct and visually on-brand', () => {
  const drone = ALERT_TYPES.uav_strike;
  assert.ok(TYPE_KEYS.includes('uav_strike'));
  assert.ok(ALERT_GROUPS.aerial.types.includes('uav_strike'));
  assert.equal(drone.marker, 'orbit');
  assert.equal(drone.glyph, ALERT_TYPES.uav.glyph);
  assert.equal(drone.color, ALERT_TYPES.uav.color);
  assert.equal(drone.tag_ar, 'استهداف_بمسيّرة');
});

test('aircraft movement is separate from unchanged hovering markers', () => {
  assert.ok(ALERT_GROUPS.aerial.types.includes('air_movement'));
  assert.equal(ALERT_TYPES.uav.marker, 'orbit');
  assert.equal(ALERT_TYPES.warplane.marker, 'squad');
  assert.equal(ALERT_TYPES.air_movement.marker, 'movement');
  assert.equal(ALERT_TYPES.air_movement.zone, false);
  assert.equal(Array.from(NEWS_TYPES).includes('air_movement'), false, 'manual movement reports are not auto-classified from news');
});

test('border alert type is available in the map type filter', () => {
  assert.ok(TYPE_KEYS.includes('border'));
  assert.ok(ALERT_GROUPS.other.types.includes('border'));
  assert.equal(ALERT_TYPES.border.button_ar, 'الحدود');
});

test('assassination has its own weapon marker and appears in the strikes filter', () => {
  const type = ALERT_TYPES.assassination;
  assert.ok(TYPE_KEYS.includes('assassination'));
  assert.ok(ALERT_GROUPS.strikes.types.includes('assassination'));
  assert.equal(type.marker, 'icon');
  assert.equal(type.glyph, 'weapon');
  assert.match(EXTRA_SVG.rifle, /<path/);
  assert.match(EXTRA_SVG.pistol, /<path/);
  assert.match(EXTRA_SVG.weapon, /<path/);
  assert.ok(NEWS_TYPES.includes('assassination'));
});

test('assassination marker specializes only for an explicitly named weapon', () => {
  const alert = (description) => ({ type: 'assassination', title: 'اغتيال في المنطقة', description });
  assert.equal(assassinationWeaponGlyph(alert('استخدم المهاجم بندقية كلاشنكوف AK-47.')), 'rifle');
  assert.equal(assassinationWeaponGlyph(alert('أُطلق النار بمسدس بحسب البلاغ.')), 'pistol');
  assert.equal(assassinationWeaponGlyph(alert('The report explicitly says handgun.')), 'pistol');
  assert.equal(assassinationWeaponGlyph(alert('أُطلق النار على الضحية من دون تحديد نوع السلاح.')), 'weapon');
  assert.equal(assassinationWeaponGlyph(alert('ذكر البلاغ بندقية ومسدساً معاً.')), 'weapon');
  assert.equal(assassinationWeaponGlyph({ type: 'attack', title: 'AK-47' }), null);
});

test('Arabic drone-strike reports classify separately from routine drone sightings', () => {
  const text = 'أفادت مصادر سورية باستهداف بطائرة مسيرة لسيارة في محافظة دير الزور بعد ظهر اليوم.';
  assert.ok(keywordTypes(text).includes('uav_strike'));
  assert.equal(ruleClassify(text)?.type, 'uav_strike');
  assert.equal(refineType('uav', text), 'uav_strike');
  assert.equal(ruleClassify('تحليق مسيرة فوق دير الزور السورية اليوم.')?.type, 'uav');
});

test('explicit assassination reports are not reduced to generic attack', () => {
  const text = 'أفادت مصادر محلية باغتيال مسؤول محلي بإطلاق النار في محافظة درعا السورية.';
  assert.ok(keywordTypes(text).includes('assassination'));
  assert.equal(ruleClassify(text)?.type, 'assassination');
  assert.equal(refineType('attack', text), 'assassination');
});

test('deduplication only joins identical precise types, not generic sightings or attacks', () => {
  const now = Date.now();
  const geo = { pts: [{ lat: 33.5, lon: 36.3 }], dists: [], govs: ['دمشق'], coarse: false, none: false };
  const candidate = (type, headline) => ({ type, headline, ts: now, geo });
  const strike = candidate('uav_strike', 'استهداف بمسيّرة لمركبة في محيط دمشق');
  assert.equal(sameIncident(strike, candidate('uav_strike', 'استهداف بمسيّرة لمركبة في محيط دمشق')), true);
  assert.equal(sameIncident(strike, candidate('uav', 'تحليق مسيّرة في محيط دمشق')), false);
  assert.equal(sameIncident(candidate('assassination', 'اغتيال مسؤول في دمشق'), candidate('attack', 'إطلاق نار قرب دمشق')), false);
});

test('similar headlines in distant governorates are not merged as the same incident', () => {
  const now = Date.now();
  const geo = (lat, lon, governorate) => ({ pts: [{ lat, lon }], dists: [], govs: [governorate], coarse: false, none: false });
  const incident = (location) => ({ type: 'attack', headline: 'اشتباك مسلح قرب حاجز في المنطقة', ts: now, geo: location });
  assert.equal(sameIncident(incident(geo(36.2, 37.1, 'حلب')), incident(geo(32.6, 36.1, 'درعا'))), false);
  const unknown = { pts: [], dists: [], govs: [], coarse: false, none: true };
  assert.equal(sameIncident(incident(unknown), incident(unknown)), true);
});
