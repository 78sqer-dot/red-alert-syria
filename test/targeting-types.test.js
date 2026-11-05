import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALERT_GROUPS, ALERT_TYPES, POLITICAL_CATEGORIES, TYPE_KEYS, alertButtonLabel, alertEmoji, assassinationWeaponGlyph, shootingWeaponGlyph, eventVisual } from '../shared/types.js';
import { NEWS_TYPES, keywordTypes, nameInText, refineType, ruleClassify, inferPoliticalCategory } from '../server/news-ai.js';
import { TITLES } from '../server/bot-texts.js';
import { dayAutoReady, nightEligible, sameIncident, _test as newsTest } from '../server/news-monitor.js';
import { EXTRA_SVG } from '../public/js/target-svgs.js';
import { SVG } from '../public/js/marker-svgs.js';
import { ICONS } from '../public/js/icons.js';
import { TYPE_ICON, typeIcon } from '../public/js/type-icons.js';
import { markerSvg } from '../server/alert-image.js';

const mapSource = readFileSync(new URL('../public/js/map.js', import.meta.url), 'utf8');
const typeIconsSource = readFileSync(new URL('../public/js/type-icons.js', import.meta.url), 'utf8');
const mapCss = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
const alertImageSource = readFileSync(new URL('../server/alert-image.js', import.meta.url), 'utf8');

test('map types keep drone targeting distinct and visually on-brand', () => {
  const drone = ALERT_TYPES.uav_strike;
  assert.ok(TYPE_KEYS.includes('uav_strike'));
  assert.ok(ALERT_GROUPS.aerial.types.includes('uav_strike'));
  assert.equal(drone.marker, 'orbit');
  assert.equal(drone.glyph, 'uav_strike');
  assert.notEqual(drone.glyph, ALERT_TYPES.uav.glyph);
  assert.equal(drone.color, ALERT_TYPES.uav.color, 'drone-strike keeps the existing alert red while using a distinct symbol');
  assert.match(EXTRA_SVG.uav_strike, /stroke-dasharray/);
  assert.equal(drone.tag_ar, 'استهداف_بمسيّرة');
});

test('news and report emojis suit the event, and map urgency uses a siren icon', () => {
  assert.equal(ALERT_TYPES.breaking.emoji, '🚨');
  assert.equal(ALERT_TYPES.uav.emoji, '🛩️', 'use a small aircraft symbol instead of a UFO');
  assert.equal(ALERT_TYPES.artillery.emoji, '💣');
  assert.equal(ALERT_TYPES.weather.emoji, '⛈️');
  assert.equal(alertEmoji({ type: 'breaking' }), '🚨');
  assert.equal(alertEmoji({ type: 'uav' }), '🛩️');
  assert.equal(typeIcon('breaking'), 'urgent');
  assert.ok(ICONS[typeIcon('breaking')], 'the map filter icon exists in the icon catalogue');
  assert.equal(ALERT_TYPES.death.emoji, '🪦');
  assert.equal(ALERT_TYPES.death.glyph, 'grave');
  assert.equal(typeIcon('death'), 'grave');
  assert.ok(ICONS.grave);
  assert.match(EXTRA_SVG.grave, /M96 448V234/);
  assert.equal(ALERT_TYPES.brawl.emoji, '👊');
  assert.equal(ALERT_TYPES.brawl.glyph, 'fists');
});

test('aircraft movement is separate from unchanged hovering markers', () => {
  assert.ok(ALERT_GROUPS.aerial.types.includes('air_movement'));
  assert.equal(ALERT_TYPES.uav.marker, 'orbit');
  assert.equal(ALERT_TYPES.warplane.marker, 'squad');
  assert.equal(ALERT_TYPES.air_movement.marker, 'movement');
  assert.equal(ALERT_TYPES.air_movement.zone, false);
  assert.equal(Array.from(NEWS_TYPES).includes('air_movement'), false, 'manual movement reports are not auto-classified from news');
});

test('helicopter has its own monitored button and keeps the original warplane marker treatment', () => {
  const warplane = ALERT_TYPES.warplane;
  const helicopter = ALERT_TYPES.helicopter;
  assert.ok(TYPE_KEYS.includes('helicopter'));
  assert.ok(ALERT_GROUPS.aerial.types.includes('helicopter'));
  assert.ok(NEWS_TYPES.includes('helicopter'));
  assert.equal(helicopter.marker, 'helicopter', 'helicopters use a dedicated, single-airframe flight marker');
  assert.equal(helicopter.glyph, 'helicopter_simple');
  assert.equal(ALERT_TYPES.uav.marker, 'orbit', 'the helicopter change must not alter drone targeting');
  assert.match(mapSource, /marker === 'helicopter'[\s\S]{0,180}svgTag\(t\.glyph, 18,/);
  assert.match(mapSource, /a\.helicopters > 1/);
  assert.match(mapSource, /heli-craft-second/);
  assert.match(mapCss, /\.heli-craft-second \{ top: 100%; \}/);
  assert.match(mapSource, /const helicopterScale = Math\.max\(1, Math\.min\(1\.34, 1 \+ \(z - 9\) \* 0\.08\)\)/);
  assert.match(mapSource, /c\.style\.setProperty\('--heli-scale', helicopterScale\)/);
  assert.match(mapCss, /\.helicopter-svg \{[^}]*width: 18px; height: 18px/);
  assert.match(mapCss, /\.heli-craft \{[^}]*scale\(var\(--heli-scale, 1\)\)/);
  assert.match(mapCss, /\.heli-orbit \{[^}]*animation: heliOrbit 12s linear infinite/);
  assert.match(mapCss, /\.helicopter-svg \.heli-main-rotor[^\n]*animation: heliRotor/);
  assert.match(mapCss, /\.helicopter-svg \.heli-tail-rotor[^\n]*animation: heliRotor/);
  assert.doesNotMatch(mapCss, /\.heli-orbit::(?:before|after)/, 'do not add decorative orbit rings');
  assert.match(EXTRA_SVG.helicopter_simple, /class="heli-main-rotor"/);
  assert.match(EXTRA_SVG.helicopter_simple, /class="heli-tail-rotor"/);
  assert.match(EXTRA_SVG.helicopter_topdown, /class="heli-main-rotor"/);
  assert.match(EXTRA_SVG.helicopter_topdown, /class="heli-tail-rotor"/);
  assert.match(EXTRA_SVG.helicopter_sleek, /class="heli-main-rotor"/);
  assert.match(EXTRA_SVG.helicopter_sleek, /class="heli-tail-rotor"/);
  assert.match(EXTRA_SVG.helicopter, /class="heli-main-rotor"/);
  assert.match(EXTRA_SVG.helicopter, /class="heli-tail-rotor"/);
  assert.deepEqual({ marker: warplane.marker, glyph: warplane.glyph, color: warplane.color, ring: warplane.ring, zone: warplane.zone }, {
    marker: 'squad', glyph: 'plane', color: '#3b8eff', ring: '#1d4ed8', zone: 'dashed',
  });
  assert.equal(nightEligible({ type: 'helicopter', status: 'pending', loc: { scope: 'place', latitude: 32.6, longitude: 36.1 }, srcs: [{ u: 'ajasyr' }] }), false, 'helicopter news stays for human review');
});

test('warplane keeps its three-plane reference pass and independent alert-zone circles', () => {
  assert.doesNotMatch(mapSource, /t\.marker === 'movement' \|\| t\.marker === 'squad'/, 'warplane zone circles remain enabled');
  assert.match(mapSource, /marker === 'orbit' \|\| marker === 'helicopter'/, 'drone orbit is independent of geographical alert radii');
  assert.match(mapSource, /const classicAircraft = t\.marker === 'squad' \|\| t\.marker === 'helicopter'/, 'active warplane zones get aircraft pulse styling');
  assert.match(mapSource, /pl\(36, -12, 1\)\}\$\{pl\(20, 8, 0\.85\)\}\$\{pl\(52, 8, 0\.85\)/, 'one alert contains only a lead plane and two wing planes');
  assert.match(mapCss, /\.sq-svg \{[^}]*transform: rotate\(-45deg\)/);
  assert.match(mapCss, /\.mk-squad \.squad\s*\{[^}]*width: 84px; height: 200px; left: -42px; top: -100px;/);
  assert.match(mapCss, /\.mk-squad \.squad \.sq\s*\{[^}]*width: 24px; height: 24px; scale: 1; animation: squadFly 7s linear infinite;/);
  assert.match(mapCss, /\.mk-squad \.squad \.sq:nth-child\(3\)\s*\{ left: 54px !important; top: calc\(50% \+ 16px\) !important; width: 22px; height: 22px; \}/);
  assert.match(mapCss, /@keyframes squadFly \{ 0% \{ transform: translateY\(110px\); opacity: 0; \} 12% \{ opacity: 1; \} 88% \{ opacity: 1; \} 100% \{ transform: translateY\(-110px\); opacity: 0; \} \}/);
  assert.doesNotMatch(mapCss, /warplaneOrbit/);
  assert.doesNotMatch(mapSource, /warplaneEastOffset|updateWarplaneVectors/, 'the pass remains schematic rather than a fabricated geographic track');
  assert.match(mapCss, /\.maplibregl-map \.mk-squad\.t-warplane \.squad \{ visibility: visible; \}/);
  assert.match(mapCss, /\.mk-squad \.mk-s \{ transform: none; transition: none; \}/, 'the formation stays fixed in screen space');
  assert.doesNotMatch(mapCss, /squadFlyZ/);
});

test('airstrike is a separate red map alert and monitored button, distinct from warplane overflight', () => {
  const strike = ALERT_TYPES.airstrike;
  assert.ok(TYPE_KEYS.includes('airstrike'));
  assert.ok(ALERT_GROUPS.strikes.types.includes('airstrike'));
  assert.ok(NEWS_TYPES.includes('airstrike'));
  assert.equal(strike.marker, 'static');
  assert.equal(strike.zone, true);
  assert.equal(strike.color, '#ef233c');
  assert.equal(nightEligible({ type: 'airstrike', status: 'pending', loc: { scope: 'place', latitude: 32.6, longitude: 36.1 }, srcs: [{ u: 'ajasyr' }] }), false, 'airstrike reports stay for human review');
});

test('border alert type is available in the map type filter', () => {
  assert.ok(TYPE_KEYS.includes('border'));
  assert.ok(ALERT_GROUPS.other.types.includes('border'));
  assert.equal(ALERT_TYPES.border.button_ar, 'الحدود');
});

test('military incursion subtypes have distinct markers and remain manual-only', () => {
  const type = ALERT_TYPES.military_incursion;
  assert.ok(TYPE_KEYS.includes('military_incursion'));
  assert.equal(TYPE_KEYS.includes('military_incursion_general'), false, 'the general submenu reuses the historical type instead of adding a migrated type');
  assert.ok(ALERT_GROUPS.other.types.includes('military_incursion'));
  assert.equal(type.ar, 'توغل عسكري');
  assert.equal(type.button_ar, 'توغل عسكري');
  assert.equal(type.marker, 'icon');
  assert.equal(type.glyph, 'military_vehicle');
  assert.match(EXTRA_SVG.military_vehicle, /M56 300/);
  assert.match(EXTRA_SVG.military_barrier, /M64 178/);
  assert.equal(type.zone, 'dashed');
  assert.equal(type.color, '#71834a');
  assert.equal(typeIcon('military_incursion'), 'militaryVehicle');
  assert.ok(ICONS.militaryVehicle, 'the filter icon exists');
  assert.match(typeIconsSource, /military_incursion: 'militaryVehicle'/);
  assert.match(markerSvg('military_incursion', 100, 100, 1, null, { type: 'military_incursion', meta: { incursionKind: 'soldiers' } }), /M82 430/);
  assert.match(markerSvg('military_incursion', 100, 100, 1, null, { type: 'military_incursion', meta: { incursionKind: 'vehicles' } }), /M56 300/);
  assert.match(markerSvg('military_incursion', 100, 100, 1, null, { type: 'military_incursion', meta: { incursionKind: 'barrier' } }), /military_barrier|M64 178/);
  assert.match(mapSource, /incursion_kind/);
  assert.match(mapSource, /military_barrier/);
  assert.match(alertImageSource, /incursionKind === 'barrier'/);
  assert.equal(NEWS_TYPES.includes('military_incursion'), false, 'vehicle incursion is not automatically classified from news');
});

test('military patrol is a separate monitored category with a clean icon and human review', () => {
  const patrol = ALERT_TYPES.patrol;
  const text = 'أفادت مصادر محلية برصد دورية عسكرية قرب بلدة كودنة في محافظة القنيطرة السورية اليوم.';
  const plural = 'أفادت مصادر محلية برصد دوريات عسكرية قرب بلدة كودنة في محافظة القنيطرة السورية اليوم.';
  assert.ok(TYPE_KEYS.includes('patrol'));
  assert.ok(ALERT_GROUPS.other.types.includes('patrol'));
  assert.ok(NEWS_TYPES.includes('patrol'));
  assert.equal(patrol.glyph, 'patrol');
  assert.equal(typeIcon('patrol'), 'patrol');
  assert.ok(ICONS.patrol);
  assert.match(EXTRA_SVG.patrol, /M61 292/);
  assert.equal(ruleClassify(text)?.type, 'patrol');
  assert.equal(ruleClassify(plural)?.type, 'patrol');
  assert.equal(refineType('breaking', text), 'patrol');
  const patrolDraft = { type: 'patrol', status: 'pending', loc: { scope: 'place', latitude: 33.0, longitude: 35.9 }, srcs: [{ u: 'national-a' }, { u: 'national-b' }] };
  assert.equal(nightEligible(patrolDraft), false, 'patrol reports always require human review');
  assert.equal(dayAutoReady({ ...patrolDraft, dayAutoAt: Date.now() - 1 }), false);
});

test('kidnapping is a distinct security type with a restraint icon and human review', () => {
  const kidnapping = ALERT_TYPES.kidnapping;
  assert.ok(TYPE_KEYS.includes('kidnapping'));
  assert.ok(ALERT_GROUPS.other.types.includes('kidnapping'));
  assert.equal(kidnapping.button_ar, 'اختطاف');
  assert.equal(kidnapping.button_en, 'Kidnapping');
  assert.equal(alertButtonLabel('kidnapping'), '⛓️ اختطاف');
  assert.equal(kidnapping.glyph, 'handcuffs');
  assert.equal(typeIcon('kidnapping'), 'handcuffs');
  assert.ok(ICONS.handcuffs);
  assert.ok(EXTRA_SVG.handcuffs);
  assert.equal(eventVisual('kidnapping').category, 'security');
  const kidnappingDraft = { type: 'kidnapping', status: 'pending', loc: { scope: 'place', latitude: 33.0, longitude: 35.9 }, srcs: [{ u: 'national-a' }, { u: 'national-b' }] };
  assert.equal(nightEligible(kidnappingDraft), false, 'kidnapping reports always require human review overnight');
  assert.equal(dayAutoReady({ ...kidnappingDraft, dayAutoAt: Date.now() - 1 }), false, 'kidnapping reports are never daytime auto-published');
});

test('signal sweep is a distinct non-jamming type; a drone glyph appears only when explicitly selected', () => {
  const type = ALERT_TYPES.signal_sweep;
  assert.ok(TYPE_KEYS.includes('signal_sweep'));
  assert.ok(ALERT_GROUPS.other.types.includes('signal_sweep'));
  assert.equal(type.button_ar, 'رصد/مسح الإشارة');
  assert.equal(type.button_en, 'Signal sweep');
  assert.equal(alertButtonLabel('signal_sweep'), '📡 رصد/مسح الإشارة');
  assert.equal(type.glyph, 'signal_sweep');
  assert.equal(typeIcon('signal_sweep'), 'radar');
  assert.ok(ICONS.radar);
  assert.ok(EXTRA_SVG.signal_sweep);
  assert.equal(eventVisual('signal_sweep').category, 'security');
  assert.equal(NEWS_TYPES.includes('signal_sweep'), false, 'signal reports do not enter automatic news classification');
  const generic = markerSvg('signal_sweep', 100, 100, 1, null, { type: 'signal_sweep' });
  const drone = markerSvg('signal_sweep', 100, 100, 1, null, { type: 'signal_sweep', meta: { signalPlatform: 'uav' } });
  assert.ok(generic.includes(EXTRA_SVG.signal_sweep), 'an unspecified platform keeps the signal radar glyph');
  assert.ok(drone.includes(SVG.uav), 'the selected platform reuses the existing drone silhouette');
  assert.equal(nightEligible({ type: 'signal_sweep', status: 'pending', loc: { scope: 'place', latitude: 33, longitude: 35 }, srcs: [{ u: 'national-a' }, { u: 'national-b' }] }), false, 'signal-sweep reports always require human review');
  assert.equal(dayAutoReady({ type: 'signal_sweep', status: 'pending', dayAutoAt: 0, loc: { scope: 'place', latitude: 33, longitude: 35 }, srcs: [{ u: 'national-a' }, { u: 'national-b' }] }), false, 'signal-sweep reports never auto-publish during daytime');
});

test('assassination uses a black firearm drawing and appears in the strikes filter', () => {
  const type = ALERT_TYPES.assassination;
  assert.ok(TYPE_KEYS.includes('assassination'));
  assert.ok(ALERT_GROUPS.strikes.types.includes('assassination'));
  assert.equal(type.emoji, '', 'leave the Telegram button text-only instead of a colored emoji');
  assert.equal(type.marker, 'icon');
  assert.equal(type.glyph, 'pistol');
  assert.equal(type.icon, '#111827');
  assert.match(EXTRA_SVG.rifle, /<path/);
  assert.match(EXTRA_SVG.pistol, /<path/);
  assert.ok(NEWS_TYPES.includes('assassination'));
});

test('shooting and assassination expose no colored emoji; generic gunfire uses category-colored sound waves', () => {
  assert.equal(ALERT_TYPES.shooting.emoji, '');
  assert.equal(alertEmoji({ type: 'shooting' }), '');
  assert.equal(ALERT_TYPES.assassination.emoji, '');
  const pistol = markerSvg('shooting', 100, 100, 1, null, { type: 'shooting' });
  assert.match(pistol, /fill="#f8fafc"/);
  assert.match(pistol, new RegExp(`<g fill="${eventVisual('shooting').color}" color="${eventVisual('shooting').color}">[\\s\\S]*M70 200h96`));
  const rifle = markerSvg('assassination', 100, 100, 1, null, { type: 'assassination', description: 'استخدم بندقية كلاشنكوف' });
  assert.match(rifle, new RegExp(`<g fill="${eventVisual('assassination').color}" color="${eventVisual('assassination').color}">[\\s\\S]*M24 222`));
});

test('assassination drawing follows an explicitly named rifle; otherwise it uses the requested pistol silhouette', () => {
  const alert = (description) => ({ type: 'assassination', title: 'اغتيال في المنطقة', description });
  assert.equal(assassinationWeaponGlyph(alert('استخدم المهاجم بندقية كلاشنكوف AK-47.')), 'rifle');
  assert.equal(assassinationWeaponGlyph(alert('أُطلق النار بمسدس بحسب البلاغ.')), 'pistol');
  assert.equal(assassinationWeaponGlyph(alert('The report explicitly says handgun.')), 'pistol');
  assert.equal(assassinationWeaponGlyph(alert('أُطلق النار على الضحية من دون تحديد نوع السلاح.')), 'pistol');
  assert.equal(assassinationWeaponGlyph(alert('ذكر البلاغ بندقية ومسدساً معاً.')), 'pistol');
  assert.equal(assassinationWeaponGlyph({ type: 'attack', title: 'AK-47' }), null);
});

test('gunfire remains an event with a non-weapon symbol by default and named firearms only when reported', () => {
  assert.equal(ALERT_TYPES.shooting.button_ar, 'إطلاق نار');
  assert.equal(alertButtonLabel('shooting'), 'إطلاق نار', 'the Telegram button names the event, not an assumed weapon');
  assert.equal(shootingWeaponGlyph({ type: 'shooting', title: 'سماع إطلاق نار في الحي' }), 'gunfire');
  assert.equal(shootingWeaponGlyph({ type: 'shooting', description: 'أُطلقت طلقات من بندقية كلاشنكوف AK-47' }), 'rifle');
  assert.equal(shootingWeaponGlyph({ type: 'shooting', description: 'The report confirms an assault rifle was used' }), 'rifle');
  assert.equal(shootingWeaponGlyph({ type: 'shooting', description: 'إطلاق نار بمسدس' }), 'pistol');
  assert.equal(shootingWeaponGlyph({ type: 'shooting', title: 'Gunfire heard nearby without weapon details' }), 'gunfire');
  assert.equal(shootingWeaponGlyph({ type: 'attack', title: 'AK-47' }), null);
  const unspecified = markerSvg('shooting', 100, 100, 1, null, { type: 'shooting', title: 'إطلاق نار' });
  const identifiedRifle = markerSvg('shooting', 100, 100, 1, null, { type: 'shooting', description: 'بندقية كلاشنكوف' });
  assert.match(unspecified, new RegExp(`<g fill="${eventVisual('shooting').color}" color="${eventVisual('shooting').color}">[\\s\\S]*M70 200h96`));
  assert.doesNotMatch(unspecified, /M56 176/, 'generic gunfire does not depict a pistol');
  assert.match(identifiedRifle, new RegExp(`<g fill="${eventVisual('shooting').color}" color="${eventVisual('shooting').color}">[\\s\\S]*M24 222`));
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

test('armed clashes have a distinct monitored type and stay separate from attacks and standalone gunfire', () => {
  const clashes = 'أفادت مصادر محلية باندلاع اشتباكات مسلحة بين مجموعتين في ريف حلب السورية اليوم.';
  const attack = 'أفادت مصادر محلية بوقوع هجوم مسلح على حاجز أمني في محافظة درعا السورية اليوم.';
  const gunfire = 'أفادت مصادر محلية بسماع إطلاق نار في مدينة دمشق السورية اليوم.';
  assert.ok(TYPE_KEYS.includes('clashes'));
  assert.ok(ALERT_GROUPS.strikes.types.includes('clashes'));
  assert.ok(NEWS_TYPES.includes('clashes'));
  assert.equal(ALERT_TYPES.clashes.ar, 'اشتباكات مسلحة');
  assert.equal(typeIcon('clashes'), 'clash');
  assert.ok(ICONS.clash, 'the filter icon exists');
  assert.ok(EXTRA_SVG.clashes, 'the map marker has a dedicated compact glyph');
  assert.equal(ruleClassify(clashes)?.type, 'clashes');
  assert.equal(refineType('attack', clashes), 'clashes');
  assert.equal(ruleClassify(attack)?.type, 'attack');
  assert.equal(refineType('attack', attack), 'attack');
  assert.equal(ruleClassify(gunfire)?.type, 'shooting', 'gunfire without opposing sides remains a shooting report');
});

test('armed-clash news remains in human review when source or classifier evidence is insufficient', () => {
  const loc = { scope: 'place', latitude: 36.2, longitude: 37.1 };
  const oneLocalSource = { type: 'clashes', status: 'pending', loc, srcs: [{ u: 'local-example', local: true }] };
  assert.equal(nightEligible(oneLocalSource), false, 'one local source does not qualify for overnight auto-publish');
  assert.equal(dayAutoReady({ ...oneLocalSource, dayAutoAt: Date.now() - 1 }), false, 'the daytime gate keeps the same source check');
  assert.equal(nightEligible({ ...oneLocalSource, rule: true, srcs: [{ u: 'national-a' }, { u: 'national-b' }] }), false, 'rules-only classification stays for a reviewer');
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

test('political incidents deduplicate only when their category and headline both match', () => {
  const now = Date.now();
  const geo = { pts: [], dists: [], govs: [], coarse: false, none: true };
  const meeting = { type: 'political', politicalCategory: 'meeting', ts: now, headline: 'اجتماع رسمي بين مسؤولين سوريين ومبعوث أممي', geo };
  assert.equal(sameIncident(meeting, { ...meeting }), true);
  assert.equal(sameIncident(meeting, { ...meeting, politicalCategory: 'statement' }), false);
  assert.equal(sameIncident(meeting, { ...meeting, politicalCategory: null }), false);
  assert.equal(sameIncident(meeting, { ...meeting, headline: 'قرار حكومي جديد بشأن موعد الانتخابات' }), false);
});

test('civil incident types are nested under the civil group and enabled for news monitoring', () => {
  for (const key of ['arrest', 'death', 'martyrdom', 'brawl', 'shooting']) {
    assert.ok(TYPE_KEYS.includes(key));
    assert.ok(ALERT_GROUPS.civil.types.includes(key));
    assert.equal(ALERT_TYPES[key].parent, 'civil');
    assert.equal(NEWS_TYPES.includes(key), true, `${key} should be watched by the automatic news monitor`);
    assert.equal(nightEligible({ type: key, status: 'pending', loc: { scope: 'place', latitude: 32.6, longitude: 36.1 }, srcs: [{ u: 'ajasyr' }] }), false, `${key} remains human-reviewed`);
    assert.equal(dayAutoReady({ type: key, status: 'pending', dayAutoAt: 0, loc: { scope: 'place', latitude: 32.6, longitude: 36.1 }, srcs: [{ u: 'ajasyr' }] }), false, `${key} is not day-auto-published`);
  }
});

test('helicopter and airstrike are watched automatically but require human publication review', () => {
  for (const key of ['helicopter', 'airstrike']) {
    assert.ok(TYPE_KEYS.includes(key));
    assert.equal(NEWS_TYPES.includes(key), true, `${key} is enabled in automatic news classification`);
    const draft = { type: key, status: 'pending', dayAutoAt: 0, loc: { scope: 'place', latitude: 32.6, longitude: 36.1 }, srcs: [{ u: 'ajasyr' }] };
    assert.equal(nightEligible(draft), false, `${key} remains human-reviewed overnight`);
    assert.equal(dayAutoReady(draft), false, `${key} is not auto-published during daytime`);
  }
});

test('political developments use the category color and marker only for explicit localities', () => {
  const type = ALERT_TYPES.political;
  assert.ok(TYPE_KEYS.includes('political'));
  assert.ok(ALERT_GROUPS.political.types.includes('political'));
  assert.equal(type.group, 'political');
  assert.equal(type.marker, 'icon');
  assert.equal(type.glyph, 'political');
  assert.equal(type.zone, false);
  assert.equal(type.color, '#64748b');
  assert.match(EXTRA_SVG.political, /M34 190/);
  assert.equal(typeIcon('political'), 'news');
  assert.match(typeIconsSource, /political: 'news'/);
  assert.equal(eventVisual('political').dot, '🟡');
  assert.equal(eventVisual('political').color, '#a16207');
  assert.match(mapSource, /color: eventVisual\(a\.type\)\.color, active:/, 'political rings use the shared category color');
  assert.doesNotMatch(mapSource, /a\.type === 'political' \|\| t\.marker === 'movement'/);
  assert.match(mapSource, /a\.scope === 'country' \|\| !a\.location/);
  assert.match(mapSource, /const km = planeArea \? z\.km : this\._screenKm\(z\.km, z\.lat, marker === 'squad' \? 0\.28 : 0\.18\);/, 'political and other non-warplane circles retain the original display cap');
  assert.match(alertImageSource, /zones = type === 'political' \? selectedAlertZones/);
  assert.match(alertImageSource, /if \(type === 'political'\) \{ const \[x, y\] = px\(center\.lat, center\.lon\); o\.push\(politicalMarkerSvg\(x, y\)\); \}/);
  assert.deepEqual(Object.keys(POLITICAL_CATEGORIES), ['agreement', 'signing', 'treaty', 'circular', 'support', 'military_cooperation', 'statement', 'position', 'decision', 'appointment', 'official_announcement', 'government_announcement', 'official_entity', 'negotiation', 'meeting', 'visit', 'election']);
});
test('political source wording is mapped to the requested narrow category set', () => {
  const samples = [
    ['agreement', 'اتفاق بين الحكومة السورية والجهة المعنية'],
    ['signing', 'توقيع اتفاق بين الجانبين في سوريا'],
    ['treaty', 'اتفاقية جديدة تخص سوريا'],
    ['circular', 'تعميم صادر عن جهة رسمية في سوريا'],
    ['support', 'دعم حكومي مالي في سوريا'],
    ['military_cooperation', 'تعاون عسكري سوري مشترك'],
    ['statement', 'تصريح وزير سوري اليوم'],
    ['position', 'موقف الحكومة السورية من التطورات'],
    ['decision', 'قرار رسمي في سوريا'],
    ['appointment', 'تعيين وزير في الحكومة السورية'],
    ['official_announcement', 'إعلان رسمي صادر في سوريا'],
    ['government_announcement', 'إعلان حكومي سوري جديد'],
    ['official_entity', 'جهة رسمية سورية تعلن تحديثاً'],
    ['negotiation', 'مفاوضات سورية جديدة'],
    ['meeting', 'لقاء رسمي في دمشق'],
    ['visit', 'زيارة رسمية لوزير سوري'],
    ['election', 'انتخابات رئاسية سورية'],
  ];
  for (const [expected, sourceText] of samples) assert.equal(inferPoliticalCategory(sourceText), expected, sourceText);
  assert.equal(inferPoliticalCategory('خبر سياسي عام بلا وصف محدد'), null, 'unclear categories remain for human review');
});

test('new civil news types classify separately and a protest march is not a drone', () => {
  const samples = [
    ['arrest', 'اعتقلت قوى الأمن شخصاً في محافظة درعا السورية اليوم.'],
    ['death', 'وفاة رجل عُثر عليه في مدينة دمشق السورية اليوم.'],
    ['martyrdom', 'استشهد شاب في محافظة إدلب السورية اليوم.'],
    ['brawl', 'مشاجرة بالأيدي بين شبان في مدينة حلب السورية اليوم.'],
    ['shooting', 'سماع إطلاق نار في حي المزة بدمشق السورية اليوم.'],
    ['helicopter', 'تحليق طيران مروحي في أجواء مدينة حمص السورية اليوم.'],
    ['airstrike', 'غارة جوية استهدفت موقعاً في ريف دمشق السورية اليوم.'],
    ['protest', 'مسيرة شعبية احتجاجية في مدينة دمشق السورية اليوم.'],
  ];
  for (const [expected, text] of samples) {
    assert.equal(ruleClassify(text)?.type, expected, `${text} should map to ${expected}`);
  }
  const march = samples.at(-1)[1];
  assert.ok(keywordTypes(march).includes('protest'));
  assert.equal(keywordTypes(march).includes('uav'), false);
  assert.equal(refineType('uav', march), 'protest');
  assert.equal(ruleClassify('إطلاق نار على حاجز في درعا السورية اليوم.')?.type, 'attack', 'targeted gunfire is still an attack');
  const helicopter = 'تحليق طيران مروحي فوق مدينة حمص السورية اليوم.';
  assert.equal(refineType('warplane', helicopter), 'helicopter', 'Gemini warplane fallback is corrected to the helicopter button');
  assert.equal(ruleClassify('تحليق مروحية عسكرية فوق حمص السورية اليوم.')?.type, 'helicopter');
  assert.equal(refineType('warplane', 'غارة بمروحية عسكرية على موقع في حمص السورية اليوم.'), 'airstrike', 'helicopter strikes do not become routine overflight activity');
  assert.equal(refineType('warplane', 'غارة جوية على موقع في ريف دمشق السورية اليوم.'), 'airstrike', 'an actual airstrike gets its own button');
  assert.equal(ruleClassify('غارة جوية استهدفت موقعاً في ريف دمشق السورية اليوم.')?.type, 'airstrike');
  assert.equal(refineType('breaking', 'تحليق طيران حربي فوق ريف دمشق السورية اليوم.'), 'warplane', 'warplane overflight remains distinct from a strike');
});

test('each alert type has a dedicated map glyph and registered site/filter icon', () => {
  for (const type of TYPE_KEYS) {
    const glyph = ALERT_TYPES[type].glyph;
    assert.ok(EXTRA_SVG[glyph] || SVG[glyph], `${type} should have a map/card SVG glyph (${glyph})`);
    assert.ok(Object.hasOwn(TYPE_ICON, type), `${type} should be registered in the shared icon map`);
    assert.ok(ICONS[typeIcon(type)], `${type} should have a site/filter icon (${typeIcon(type)})`);
  }
  for (const type of ['smuggling_weapons', 'smuggling_drugs', 'smuggling_explosives']) {
    assert.ok(TYPE_KEYS.includes(type));
    assert.ok(ALERT_GROUPS.smuggling.types.includes(type));
    assert.equal(ALERT_TYPES[type].zone, false, `${type} is a point report, not an invented impact circle`);
    assert.ok(NEWS_TYPES.includes(type), `${type} can be detected by news monitoring`);
    const draft = { type, status: 'pending', dayAutoAt: 0, loc: { scope: 'place', latitude: 32.6, longitude: 36.1 }, srcs: [{ u: 'ajasyr' }, { u: 'alikhbaria' }] };
    assert.equal(nightEligible(draft), false, `${type} is never auto-published`);
    assert.equal(dayAutoReady(draft), false, `${type} requires human review`);
  }
  assert.equal(new Set(['smuggling_weapons', 'smuggling_drugs', 'smuggling_explosives'].map(typeIcon)).size, 3);
});

test('explosion and detonation remain distinct across bot, map, and alert-image types', () => {
  assert.ok(TYPE_KEYS.includes('detonation'));
  assert.ok(ALERT_GROUPS.strikes.types.includes('detonation'));
  assert.equal(ALERT_TYPES.explosion.button_ar, 'انفجار');
  assert.equal(ALERT_TYPES.detonation.button_ar, 'تفجير');
  assert.equal(ALERT_TYPES.detonation.button_en, 'Detonation');
  assert.equal(alertButtonLabel('explosion', 'ar'), '💥 انفجار');
  assert.equal(alertButtonLabel('detonation', 'ar'), '💥 تفجير');
  assert.equal(alertButtonLabel('detonation', 'en'), '💥 Detonation');
  assert.deepEqual(TITLES.explosion, { ar: 'انفجار', en: 'Explosion' });
  assert.deepEqual(TITLES.detonation, { ar: 'تفجير', en: 'Detonation' });
  assert.equal(ALERT_TYPES.detonation.glyph, 'detonation_burst');
  assert.match(markerSvg('detonation', 100, 100), /M256 40v144/);
  assert.match(alertImageSource, /explosion: 'انفجار', detonation: 'تفجير'/);
  assert.match(alertImageSource, /explosion: 'Explosion', detonation: 'Detonation'/);
  assert.match(alertImageSource, /explosion: 'danger', detonation: 'danger'/);
  assert.equal(NEWS_TYPES.includes('detonation'), false, 'the new type is not added to automatic classification');
  const draft = { type: 'detonation', status: 'pending', loc: { scope: 'place', latitude: 33, longitude: 35 }, srcs: [{ u: 'national-a' }, { u: 'national-b' }] };
  assert.equal(nightEligible(draft), false, 'detonation stays out of night auto-publishing');
  assert.equal(dayAutoReady({ ...draft, dayAutoAt: Date.now() - 1 }), false, 'detonation stays out of daytime auto-publishing');
});

test('Syrian smuggling stories classify by the explicitly named contraband, not as a generic alert', () => {
  const samples = [
    ['smuggling_weapons', 'أحبط حرس الحدود السوري محاولة تهريب أسلحة وذخائر قرب القامشلي في الحسكة السورية اليوم.'],
    ['smuggling_drugs', 'ضبطت الجهات المختصة شحنة مخدرات وكبتاغون معدة للتهريب في مدينة حمص السورية اليوم.'],
    ['smuggling_explosives', 'أحبطت دورية سورية محاولة تهريب عبوات ناسفة في ريف حمص السورية اليوم.'],
  ];
  for (const [expected, text] of samples) {
    assert.ok(keywordTypes(text).includes(expected), `${expected} should appear among keyword matches`);
    assert.equal(ruleClassify(text)?.type, expected, `${text} should route to ${expected}`);
    assert.equal(refineType('breaking', text), expected, `a broad breaking label should refine to ${expected}`);
  }
  const possession = 'عثرت الجهات المختصة على أسلحة في مستودع بمدينة حمص السورية اليوم.';
  assert.equal(keywordTypes(possession).some((type) => type.startsWith('smuggling_')), false, 'possession without explicit trafficking is not smuggling');
  const ambiguous = 'أحبط حرس الحدود محاولة تهريب أسلحة ومخدرات في ريف حمص السورية اليوم.';
  assert.equal(keywordTypes(ambiguous).some((type) => type.startsWith('smuggling_')), false, 'do not guess one category when several contraband types are named');
});

test('political announcements classify as political and never require an invented map location', () => {
  const text = 'أعلنت الرئاسة السورية قراراً حكومياً بشأن تشكيل لجنة وطنية جديدة اليوم.';
  assert.ok(keywordTypes(text).includes('political'));
  assert.equal(ruleClassify(text)?.type, 'political');
  assert.equal(refineType('breaking', text), 'political');
  assert.deepEqual(ruleClassify(text)?.places, []);
  assert.equal(ruleClassify('قرار سياسي في الأردن ولا صلة له بسوريا.')?.type, undefined, 'foreign political stories are rejected');
});

test('place-name validation requires an exact multiword locality rather than a shared generic word', () => {
  assert.equal(nameInText('ريف دمشق', 'قالت مصادر محلية إن الطريق في ريف دمشق السورية أغلق مؤقتاً.'), true);
  assert.equal(nameInText('ريف حلب', 'قالت مصادر محلية إن الطريق في ريف دمشق السورية أغلق مؤقتاً.'), false);
  assert.equal(nameInText('درعا', 'أفادت مصادر محلية بوقوع حادث بدرعا السورية اليوم.'), true);
  assert.equal(nameInText('محافظة الحسكة', 'أفادت مصادر محلية بوقوع حادث في الحسكة السورية اليوم.'), true);
});

test('specific ground incidents take precedence over a weather warning in the same post', () => {
  const text = 'تحذير جوي رسمي: تحذر الأرصاد من رياح قوية في محافظة حلب السورية. واندلع حريق في مستودع بالمدينة اليوم.';
  assert.equal(newsTest.explicitWeatherResult({ i: 1, text }), null);
  assert.equal(ruleClassify(text)?.type, 'fire');
  assert.equal(refineType('weather', text), 'fire');
});

test('an erroneous standalone brawl button label does not override an official weather-warning draft', () => {
  const weather = 'تحذير جوي رسمي من عواصف مطرية رعدية غزيرة ورياح نشطة تؤثر على الحسكة وشمال الرقة';
  for (const [type, label] of [['brawl', 'مشاجرة'], ['warplane', 'طيران حربي'], ['political', 'تطور سياسي']]) {
    assert.equal(refineType(type, `${label}\n${weather}`), 'weather', `${label} must not outweigh the source text`);
  }
  assert.equal(refineType('brawl', `مشاجرة\n${weather}\nاندلعت مشاجرة في الحسكة`), 'brawl', 'a real second incident remains distinct');
});

test('nonviolent Israeli ground activity routes to breaking, while armed clashes use their dedicated type', () => {
  const ground = 'توغلت دورية تابعة لجيش الاحتلال الإسرائيلي وأقامت ساتراً ترابياً في ريف القنيطرة جنوب سوريا اليوم.';
  assert.equal(ruleClassify(ground)?.type, 'breaking');
  assert.equal(refineType('attack', ground), 'breaking');
  const clash = 'توغلت قوات الاحتلال الإسرائيلي في ريف القنيطرة جنوب سوريا واندلع اشتباك مع الأهالي اليوم.';
  assert.equal(ruleClassify(clash)?.type, 'clashes');
});
