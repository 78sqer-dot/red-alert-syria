import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALERT_GROUPS, ALERT_TYPES, POLITICAL_CATEGORIES, TYPE_KEYS, alertEmoji, assassinationWeaponGlyph } from '../shared/types.js';
import { NEWS_TYPES, keywordTypes, refineType, ruleClassify } from '../server/news-ai.js';
import { dayAutoReady, nightEligible, sameIncident, _test as newsTest } from '../server/news-monitor.js';
import { EXTRA_SVG } from '../public/js/target-svgs.js';
import { SVG } from '../public/js/marker-svgs.js';

const mapSource = readFileSync(new URL('../public/js/map.js', import.meta.url), 'utf8');
const mapCss = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');

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

test('helicopter has its own monitored button and keeps the original warplane marker treatment', () => {
  const warplane = ALERT_TYPES.warplane;
  const helicopter = ALERT_TYPES.helicopter;
  assert.ok(TYPE_KEYS.includes('helicopter'));
  assert.ok(ALERT_GROUPS.aerial.types.includes('helicopter'));
  assert.ok(NEWS_TYPES.includes('helicopter'));
  assert.equal(helicopter.marker, 'helicopter', 'helicopters use a dedicated, single-airframe flight marker');
  assert.equal(helicopter.glyph, 'helicopter');
  assert.match(EXTRA_SVG.helicopter, /class="heli-main-rotor"/);
  assert.match(EXTRA_SVG.helicopter, /class="heli-tail-rotor"/);
  assert.deepEqual({ marker: warplane.marker, glyph: warplane.glyph, color: warplane.color, ring: warplane.ring, zone: warplane.zone }, {
    marker: 'squad', glyph: 'plane', color: '#3b8eff', ring: '#1d4ed8', zone: 'dashed',
  });
  assert.equal(nightEligible({ type: 'helicopter', status: 'pending', loc: { scope: 'place', latitude: 32.6, longitude: 36.1 }, srcs: [{ u: 'ajasyr' }] }), false, 'helicopter news stays for human review');
});

test('warplane keeps the original blue dashed-ring weight and flying motion', () => {
  assert.match(mapSource, /'line-opacity': A\(0\.85, 0\.3\), 'line-width': 1\.8, 'line-dasharray': \[3, 4\]/);
  assert.match(mapCss, /\.zp\.zp-aircraft \.zp-fill \{ opacity: \.12; animation: zfillPulseAircraft 2\.6s ease-in-out infinite; \}/);
  assert.match(mapCss, /\.mk-squad:not\(\.inactive\) \.squad \.sq \{ animation: squadFlyZ 7s linear infinite !important; \}/);
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

test('military vehicle incursion has a vehicle marker and stays manual-only', () => {
  const type = ALERT_TYPES.military_incursion;
  assert.ok(TYPE_KEYS.includes('military_incursion'));
  assert.ok(ALERT_GROUPS.other.types.includes('military_incursion'));
  assert.equal(type.marker, 'icon');
  assert.equal(type.glyph, 'tank');
  assert.match(SVG.tank, /tk-body/);
  assert.equal(type.zone, 'dashed');
  assert.equal(type.color, '#71834a');
  assert.match(mapSource, /military_incursion: 'shield'/);
  assert.equal(NEWS_TYPES.includes('military_incursion'), false, 'vehicle incursion is not automatically classified from news');
});

test('assassination has its own weapon marker and appears in the strikes filter', () => {
  const type = ALERT_TYPES.assassination;
  assert.ok(TYPE_KEYS.includes('assassination'));
  assert.ok(ALERT_GROUPS.strikes.types.includes('assassination'));
  assert.equal(type.emoji, '\u{1F52B}\uFE0E', 'request monochrome text presentation for the assassination button');
  assert.equal(type.marker, 'icon');
  assert.equal(type.glyph, 'weapon');
  assert.match(EXTRA_SVG.rifle, /<path/);
  assert.match(EXTRA_SVG.pistol, /<path/);
  assert.match(EXTRA_SVG.weapon, /<path/);
  assert.ok(NEWS_TYPES.includes('assassination'));
});

test('shooting alerts omit the gun emoji while assassination retains its monochrome pistol', () => {
  assert.equal(ALERT_TYPES.shooting.emoji, '');
  assert.equal(alertEmoji({ type: 'shooting' }), '');
  assert.equal(ALERT_TYPES.assassination.emoji, '\u{1F52B}\uFE0E');
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

test('political developments use a neutral marker without a hazard ring and have controlled subcategories', () => {
  const type = ALERT_TYPES.political;
  assert.ok(TYPE_KEYS.includes('political'));
  assert.ok(ALERT_GROUPS.political.types.includes('political'));
  assert.equal(type.group, 'political');
  assert.equal(type.marker, 'icon');
  assert.equal(type.glyph, 'political');
  assert.equal(type.zone, false);
  assert.equal(type.color, '#64748b');
  assert.match(EXTRA_SVG.political, /M34 190/);
  assert.match(mapSource, /political: 'news'/);
  assert.match(mapSource, /a\.type === 'political'/, 'political marker must not create a glowing hazard zone');
  assert.deepEqual(Object.keys(POLITICAL_CATEGORIES), ['statement', 'decision', 'negotiation', 'meeting', 'election']);
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

test('specific ground incidents take precedence over a weather warning in the same post', () => {
  const text = 'تحذير جوي رسمي: تحذر الأرصاد من رياح قوية في محافظة حلب السورية. واندلع حريق في مستودع بالمدينة اليوم.';
  assert.equal(newsTest.explicitWeatherResult({ i: 1, text }), null);
  assert.equal(ruleClassify(text)?.type, 'fire');
  assert.equal(refineType('weather', text), 'fire');
});

test('nonviolent Israeli ground activity routes to breaking, while armed clashes remain attacks', () => {
  const ground = 'توغلت دورية تابعة لجيش الاحتلال الإسرائيلي وأقامت ساتراً ترابياً في ريف القنيطرة جنوب سوريا اليوم.';
  assert.equal(ruleClassify(ground)?.type, 'breaking');
  assert.equal(refineType('attack', ground), 'breaking');
  const clash = 'توغلت قوات الاحتلال الإسرائيلي في ريف القنيطرة جنوب سوريا واندلع اشتباك مع الأهالي اليوم.';
  assert.equal(ruleClassify(clash)?.type, 'attack');
});
