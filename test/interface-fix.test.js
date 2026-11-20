import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Interface errors fix round (2026-11-17): legend truncation + bottom crowding,
// ticker edge fragment, governorate label collisions, and the Live window
// upgrades (vertical auto-scroll, robust marquee). The «مباشر» controls were
// later unified into the single topbar chip (see the Live section below).
// Frontend behaviour is pinned at source level, the house pattern for UI work
// (see map-ui-polish.test.js); the data-side person-name guard has behavioural
// tests in news-place-scan.test.js.

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const css = read('public/css/app.css');
const appJs = read('public/js/app.js');
const indexHtml = read('public/index.html');
const mapSrc = read('public/js/map.js');

// ---------------------------------------------------------- legend (defect 2)
test('legend label can never truncate, on any viewport', () => {
  assert.match(css, /\.legend-btn, \.legend-btn > span \{ white-space: nowrap; \}/);
});

test('on mobile the legend floats above the bottom row instead of crowding it', () => {
  // the bottom row (brand pill + globe) is 36px tall starting at 23px; the
  // legend sits one row higher with an 8px gap: 23 + 36 + 8 = 67
  assert.match(css, /\.map-legend \{ bottom: calc\(67px \+ env\(safe-area-inset-bottom, 0px\)\); inset-inline-start: 10px; \}/);
  // desktop placement is unchanged
  assert.match(css, /\.map-legend \{ position: absolute; bottom: 40px; inset-inline-start: 12px; z-index: 11;/);
});

// ---------------------------------------------------------- ticker (defect 3)
test('ticker time can never be half-clipped at the strip edge', () => {
  // the tick clips content to its own box instead of painting past its edge…
  assert.match(css, /\.tick \{ box-sizing: border-box; overflow: hidden; \}/);
  // …and the type chip is width-capped, so chip + non-shrinking time always
  // fit beside the ellipsised title (the 745945f pins stay untouched)
  assert.match(css, /\.tick \.badge \{ max-width: 44%; min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/);
  assert.match(css, /\.tick \.badge \{ flex: none; \}/);
  assert.match(css, /\.tick \.t-time \{ flex: none; white-space: nowrap; \}/);
});

// ------------------------------------------------- governorate labels (defect 4)
test('governorate labels are added on top of the symbol stack so they win collisions', () => {
  // beforeId null = appended last = first pick in MapLibre collision placement
  assert.match(mapSrc, /id: 'ras-gov-labels'[\s\S]*?\}, null\);/);
  assert.match(mapSrc, /'symbol-avoid-edges': true/);
  // halo keeps a label readable when a DOM marker (always above the canvas)
  // sits on it; the latest size pass trims 1.5 to 1.3 (see size test)
  const govLayer = mapSrc.match(/id: 'ras-gov-labels'[\s\S]*?\}, null\);/)[0];
  assert.match(govLayer, /'text-halo-width': 1\.3/);
});

test('governorate label size is one uniform zoom expression, shrunk again at the owner\u2019s latest request', () => {
  // owner (2026-11-17): the names read "too big and inconsistent" — first round
  // 11->9 / 12.5->10 / 14->11; then 9->8 / 10->8.5 / 11->9.5. On 2026-11-18,
  // the owner asked for another reduction to 7.5 / 8 / 9. The expression must
  // stay a pure zoom function: no data-driven term may size one governorate
  // over another
  const govLayer = mapSrc.match(/id: 'ras-gov-labels'[\s\S]*?\}, null\);/)[0];
  assert.match(govLayer, /'text-size': \['interpolate', \['linear'\], \['zoom'\], 5, 7\.5, 8, 8, 11, 9\]/);
  const sizeExpr = govLayer.match(/'text-size': (\[[\s\S]*?\]), 'text-transform'/)[1];
  assert.doesNotMatch(sizeExpr, /\['(get|match|case|step)'/, 'text-size must not depend on the feature');
  // max-width up 12 -> 14em: at the smaller size the one-line budget in px is
  // unchanged, so long names wrap no more often than before (uniform blocks)
  assert.match(govLayer, /'text-max-width': 14/);
});

test('localize() subordinates basemap place labels under our governorate labels', () => {
  const labelExprSrc = mapSrc.match(/function labelExpr\(lang\) \{[\s\S]*?\n\}/)[0];
  const localizeSrc = mapSrc.match(/function localize\(style, lang\) \{[\s\S]*?\n\}/)[0];
  const localize = vm.runInNewContext(`(${localizeSrc})`, vm.createContext({ labelExpr: vm.runInNewContext(`(${labelExprSrc})`) }));
  const style = {
    layers: [
      { id: 'place_state', type: 'symbol', 'source-layer': 'place', layout: { 'text-field': ['get', 'name'] } },
      { id: 'place_city', type: 'symbol', 'source-layer': 'place', layout: { 'text-field': ['get', 'name'] } },
      { id: 'water_name', type: 'symbol', 'source-layer': 'water', layout: { 'text-field': ['get', 'name'] } },
    ],
  };
  const out = localize(style, 'ar');
  assert.equal(out.layers[0].layout.visibility, 'none', 'basemap state labels stay hidden');
  assert.equal(out.layers[1].paint['text-opacity'], 0.78, 'basemap place labels recede');
  assert.equal(out.layers[2].paint, undefined, 'non-place layers are untouched');
});

// --------------------------------------- Live: ONE «مباشر» control (req. A)
// Owner (2026-11-17): three tappable-looking «مباشر» elements (topbar chip,
// red #mapCtrls button, button-styled marquee pill) are unified into exactly
// one — the topbar status chip is the real button.
test('3D terrain renders at full sharpness: no pixel-ratio downgrade, DEM at the provider cap', () => {
  // owner (2026-11-17): «الخريطة عند ضغط على ثلاثية الابعاد دقتها تنخفض» — the
  // old applyToggles capped the canvas pixel ratio in 3D (1.25 phone / 1.5
  // desktop vs up to 2 in 2D). That self-inflicted cap is gone: enabling
  // terrain must not call setPixelRatio at all, so 3D matches 2D sharpness.
  const toggles = mapSrc.match(/applyToggles\(\) \{[\s\S]*?\n  \}/)[0];
  const onBranch = toggles.match(/if \(this\.opts\.map3d\) \{([\s\S]*?)\} else \{/)[1];
  assert.doesNotMatch(onBranch, /setPixelRatio/);
  assert.match(onBranch, /map\.setTerrain\(\{ source: 'ras-dem-hs', exaggeration: phone \? 1\.0 : 1\.2 \}\);/);
  // the DEM source runs at the AWS Terrain Tiles service's real maximum zoom:
  // terrarium tiles exist up to z15 (z16 is 404, verified 2026-11-17); the old
  // maxzoom 11 upscaled the mesh from z12 up. Tiles are 256px — the service
  // offers no 512/@2x variant, so tileSize stays 256.
  assert.match(mapSrc, /style\.sources\['ras-dem-hs'\] = \{ type: 'raster-dem', tiles: \[DEM\], encoding: 'terrarium', tileSize: 256, maxzoom: 15,/);
  // the satellite imagery source (shared by 2D + 3D) is unchanged
  assert.match(mapSrc, /esri: \{ type: 'raster', tiles: \[ESRI\], tileSize: 256, maxzoom: 19,/);
});
