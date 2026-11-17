import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripTypeLabelPrefix, ALERT_TYPES, eventVisual } from '../shared/types.js';
import { DICT } from '../public/js/i18n.js';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const app = read('public/js/app.js');
const css = read('public/css/app.css');
const html = read('public/index.html');
const mapSrc = read('public/js/map.js');

// ---------------------------------------------------------- ticker prefix
test('ticker title strips the redundant Arabic breaking prefix the chip already shows', () => {
  assert.equal(stripTypeLabelPrefix('خبر عاجل — هجين: قصف مدفعي على أطراف المدينة', 'breaking'), 'هجين: قصف مدفعي على أطراف المدينة');
  assert.equal(stripTypeLabelPrefix('خبر عاجل - اشتباكات في ريف حلب', 'breaking'), 'اشتباكات في ريف حلب');
  assert.equal(stripTypeLabelPrefix('عاجل | انفجار في دير الزور', 'breaking'), 'انفجار في دير الزور');
});

test('ticker title strips the English breaking prefix (longest label wins)', () => {
  assert.equal(stripTypeLabelPrefix('Breaking news — Strike on Hajin', 'breaking'), 'Strike on Hajin');
  assert.equal(stripTypeLabelPrefix('Breaking: Strike on Hajin', 'breaking'), 'Strike on Hajin');
});

test('ticker title strips any type label that duplicates its own chip', () => {
  assert.equal(stripTypeLabelPrefix('غارة جوية — استهداف موقع في إدلب', 'airstrike'), 'استهداف موقع في إدلب');
  assert.equal(stripTypeLabelPrefix(ALERT_TYPES.quake.ar + ' — هزة أرضية في اللاذقية', 'quake'), 'هزة أرضية في اللاذقية');
});

test('ticker title is never stripped without a separator or a remainder', () => {
  // label word as part of the sentence (no separator) stays untouched
  assert.equal(stripTypeLabelPrefix('خبر عاجل يهز المدينة منذ الصباح', 'breaking'), 'خبر عاجل يهز المدينة منذ الصباح');
  // a headline that is only the label stays as-is
  assert.equal(stripTypeLabelPrefix('خبر عاجل', 'breaking'), 'خبر عاجل');
  assert.equal(stripTypeLabelPrefix('خبر عاجل —', 'breaking'), 'خبر عاجل —');
  // another type's label is not this alert's chip, so it is not stripped
  assert.equal(stripTypeLabelPrefix('خبر عاجل — غارة على مطار عسكري', 'airstrike'), 'خبر عاجل — غارة على مطار عسكري');
  // unknown type / empty input are safe
  assert.equal(stripTypeLabelPrefix('خبر عاجل — نص', 'nope'), 'خبر عاجل — نص');
  assert.equal(stripTypeLabelPrefix('', 'breaking'), '');
  assert.equal(stripTypeLabelPrefix(null, 'breaking'), '');
});

test('alert ticker and breaking banner render the stripped display title', () => {
  assert.match(app, /stripTypeLabelPrefix\(titleOf\(a\), a\.type\)/);
  assert.match(app, /stripTypeLabelPrefix\(descOf\(a\) \|\| titleOf\(a\), a\.type\)/);
});

test('ticker chip and time cannot shrink or wrap, so strip edges never clip mid-text', () => {
  assert.match(css, /\.tick \.badge \{ flex: none; \}/);
  assert.match(css, /\.tick \.t-time \{ flex: none; white-space: nowrap; \}/);
  // the title remains the flexible, ellipsised element
  assert.match(css, /\.tick \.t-title \{[^}]*text-overflow: ellipsis;[^}]*flex: 1; min-width: 0; \}/);
});

// ---------------------------------------------------------- map legend
const LEGEND_KEYS = ['legend', 'legendCatBreaking', 'legendCatAerial', 'legendCatStrikes', 'legendCatSecurity',
  'legendCatCivil', 'legendCatPolitical', 'legendCatWeather', 'legendCatQuake',
  'legendCluster', 'legendCivilDot', 'legendZone'];

test('legend strings exist in both languages', () => {
  for (const key of LEGEND_KEYS) {
    assert.ok(DICT.ar[key], `ar missing ${key}`);
    assert.ok(DICT.en[key], `en missing ${key}`);
  }
  assert.equal(DICT.ar.legend, 'مفتاح الخريطة');
  assert.equal(DICT.en.legend, 'Map legend');
});

test('legend markup is collapsed by default and clear of the other map controls', () => {
  assert.match(html, /<div class="map-legend" id="mapLegend">/);
  assert.match(html, /<div class="legend-card" id="legendCard" role="group" hidden>/);
  assert.match(html, /id="legendBtn"[^>]*aria-expanded="false"[^>]*aria-controls="legendCard"/);
  // bottom-inline-start corner, above the scale control; nothing else lives there.
  // Mobile: raised one row (67px) above the bottom bar since the interface-fix
  // round — at ~390px the legend pill shared the bottom row with the brand pill
  // + globe button and its label clipped to «مفتاح الخر…».
  assert.match(css, /\.map-legend \{ position: absolute; bottom: 40px; inset-inline-start: 12px; z-index: 11;/);
  assert.match(css, /\.map-legend \{ bottom: calc\(67px \+ env\(safe-area-inset-bottom, 0px\)\); inset-inline-start: 10px; \}/);
});

test('legend rows are built from the shared event visuals and explain cluster + civil dot', () => {
  for (const [type, key] of [['breaking', 'legendCatBreaking'], ['uav', 'legendCatAerial'], ['attack', 'legendCatStrikes'], ['border', 'legendCatSecurity'], ['civil', 'legendCatCivil'], ['political', 'legendCatPolitical'], ['weather', 'legendCatWeather'], ['quake', 'legendCatQuake']]) {
    assert.ok(app.includes(`catRow('${type}', '${key}')`), `legend row for ${type}`);
    assert.ok(eventVisual(type).color, `${type} has a category colour`);
  }
  assert.ok(app.includes('T.legendCluster'));
  assert.ok(app.includes('T.legendCivilDot'));
  assert.ok(app.includes('T.legendZone'));
  assert.match(app, /legendCard\.hidden = !open;\s*legendBtn\.setAttribute\('aria-expanded', String\(open\)\);/);
});

// ---------------------------------------------------------- governorate labels
test('basemap state labels are hidden so governorate names render once, from our layer', () => {
  const labelExprSrc = mapSrc.match(/function labelExpr\(lang\) \{[\s\S]*?\n\}/)[0];
  const localizeSrc = mapSrc.match(/function localize\(style, lang\) \{[\s\S]*?\n\}/)[0];
  const localize = vm.runInNewContext(`(${localizeSrc})`, vm.createContext({ labelExpr: vm.runInNewContext(`(${labelExprSrc})`) }));
  const style = {
    layers: [
      { id: 'place_state', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
      { id: 'label_state', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
      { id: 'place_city', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
    ],
  };
  const out = localize(style, 'ar');
  assert.equal(out.layers[0].layout.visibility, 'none');
  assert.equal(out.layers[1].layout.visibility, 'none');
  assert.equal(out.layers[2].layout.visibility, undefined);
});

test('own governorate label layer: brighter text, inland anchors for edge governorates', () => {
  assert.match(mapSrc, /id: 'ras-gov-labels', type: 'symbol', source: 'ras-govs'/);
  // west-coast governorates anchored left (names grow east/inland), eastern ones right
  assert.match(mapSrc, /'text-anchor': \['match', \['get', 'code'\], \['14', '02'\], 'left', \['01', '07'\], 'right', 'center'\]/);
  assert.match(mapSrc, /dark \? '#c6ccd6' : '#3f4753'/);
  assert.match(mapSrc, /vis\('ras-gov-labels', this\.opts\.showGov\);/);
  // names keep the familiar «محافظة …» / "… Governorate" form
  assert.match(mapSrc, /\['concat', 'محافظة ', \['get', 'ar'\]\]/);
  assert.match(mapSrc, /\['concat', \['get', 'en'\], ' Governorate'\]/);
});

test('governorate GeoJSON covers all 14 governorates the label anchors rely on', () => {
  const govs = JSON.parse(read('public/data/syria-governorates.geojson'));
  assert.equal(govs.features.length, 14);
  const codes = new Set(govs.features.map((f) => f.properties.code));
  for (const code of ['01', '02', '07', '14']) assert.ok(codes.has(code), `missing governorate ${code}`);
  for (const f of govs.features) {
    assert.ok(f.properties.ar && f.properties.en, `governorate ${f.properties.code} needs ar+en names`);
  }
});
