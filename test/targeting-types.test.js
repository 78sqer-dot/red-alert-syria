import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALERT_GROUPS, ALERT_TYPES, POLITICAL_CATEGORIES, TYPE_KEYS, alertEmoji, assassinationWeaponGlyph } from '../shared/types.js';
import { NEWS_TYPES, keywordTypes, nameInText, refineType, ruleClassify } from '../server/news-ai.js';
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

test('warplane matches the Lebanon three-plane pass and keeps pulsing rings around the selected area', () => {
  assert.doesNotMatch(mapSource, /t\.marker === 'movement' \|\| t\.marker === 'squad'/, 'warplane zone circles remain enabled');
  assert.match(mapSource, /t\.marker === 'orbit' \|\| t\.marker === 'squad' \|\| t\.marker === 'helicopter'/);
  assert.match(mapSource, /const classicAircraft = t\.marker === 'squad' \|\| t\.marker === 'helicopter'/, 'active warplane zones get aircraft pulse styling');
  assert.match(mapSource, /pl\(16, 22, -8, 1\)\}\$\{pl\(14, 6, 12, 0\.85\)\}\$\{pl\(14, 38, 12, 0\.85\)/, 'lead and wing aircraft keep the reference triangle');
  assert.match(mapCss, /\.sq-svg \{[^}]*transform: rotate\(-45deg\)/);
  assert.match(mapCss, /@keyframes squadFlyZ \{\s*0% \{ transform: translateY\(110px\); opacity: 0; \}\s*12%, 88% \{ opacity: 1; \}\s*100% \{ transform: translateY\(-110px\); opacity: 0; \}\s*\}/);
  assert.match(mapCss, /\.maplibregl-map \.mk-squad \.squad \.sq \{ animation: squadFlyZ 7s linear infinite; \}/);
  assert.doesNotMatch(mapCss, /--fy|--sqi|--sqf/, 'squad path and size are not altered by map zoom');
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
  assert.equal(TYPE_KEYS.includes('military_incursion_general'), false, 'the general submenu reuses the historical type instead of adding a migrated type');
  assert.ok(ALERT_GROUPS.other.types.includes('military_incursion'));
  assert.equal(type.ar, 'توغل عسكري');
  assert.equal(type.button_ar, 'توغل عسكري');
  assert.equal(type.marker, 'icon');
  assert.equal(type.glyph, 'tank');
  assert.match(SVG.tank, /tk-body/);
  assert.equal(type.zone, 'dashed');
  assert.equal(type.color, '#71834a');
  assert.equal(typeIcon('military_incursion'), 'tank');
  assert.match(typeIconsSource, /military_incursion: 'tank'/);
  assert.equal(NEWS_TYPES.includes('military_incursion'), false, 'vehicle incursion is not automatically classified from news');
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

test('shooting and assassination expose no colored emoji and use firearm drawings in channel images', () => {
  assert.equal(ALERT_TYPES.shooting.emoji, '');
  assert.equal(alertEmoji({ type: 'shooting' }), '');
  assert.equal(ALERT_TYPES.assassination.emoji, '');
  const pistol = markerSvg('shooting', 100, 100, 1, null, { type: 'shooting' });
  assert.match(pistol, /fill="#f8fafc"/);
  assert.match(pistol, /<g fill="#111827">[\s\S]*M56 176/);
  const rifle = markerSvg('assassination', 100, 100, 1, null, { type: 'assassination', description: 'استخدم بندقية كلاشنكوف' });
  assert.match(rifle, /<g fill="#111827">[\s\S]*M24 222/);
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

test('political developments use a neutral ring and marker only for explicit localities', () => {
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
  assert.match(mapSource, /t\.ring \|\| t\.color/, 'political ring uses the configured muted slate color');
  assert.doesNotMatch(mapSource, /a\.type === 'political' \|\| t\.marker === 'movement'/);
  assert.match(mapSource, /a\.scope === 'country' \|\| !a\.location/);
  assert.match(mapSource, /const km = this\._screenKm\(z\.km, z\.lat\);/);
  assert.match(alertImageSource, /zones = type === 'political' \? selectedAlertZones/);
  assert.match(alertImageSource, /if \(type === 'political'\) \{ const \[x, y\] = px\(center\.lat, center\.lon\); o\.push\(politicalMarkerSvg\(x, y\)\); \}/);
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

test('nonviolent Israeli ground activity routes to breaking, while armed clashes remain attacks', () => {
  const ground = 'توغلت دورية تابعة لجيش الاحتلال الإسرائيلي وأقامت ساتراً ترابياً في ريف القنيطرة جنوب سوريا اليوم.';
  assert.equal(ruleClassify(ground)?.type, 'breaking');
  assert.equal(refineType('attack', ground), 'breaking');
  const clash = 'توغلت قوات الاحتلال الإسرائيلي في ريف القنيطرة جنوب سوريا واندلع اشتباك مع الأهالي اليوم.';
  assert.equal(ruleClassify(clash)?.type, 'attack');
});
