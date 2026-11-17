import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Interface errors fix round (2026-11-17): legend truncation + bottom crowding,
// ticker edge fragment, governorate label collisions, and the Live window
// upgrades (map «مباشر» button, vertical auto-scroll, robust marquee).
// Frontend behaviour is pinned at source level, the house pattern for UI work
// (see map-ui-polish.test.js); the data-side person-name guard has behavioural
// tests in news-place-scan.test.js.

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const css = read('public/css/app.css');
const live = read('public/js/live.js');
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
  // sits on it; slimmed 2 -> 1.7 to match the smaller type (see size test)
  const govLayer = mapSrc.match(/id: 'ras-gov-labels'[\s\S]*?\}, null\);/)[0];
  assert.match(govLayer, /'text-halo-width': 1\.7/);
});

test('governorate label size is one uniform zoom expression, ~20% smaller than before', () => {
  // owner (2026-11-17): the names read "too big and inconsistent" — the size
  // stops drop 11->9 / 12.5->10 / 14->11, and the expression must stay a pure
  // zoom function: no data-driven term may size one governorate over another
  const govLayer = mapSrc.match(/id: 'ras-gov-labels'[\s\S]*?\}, null\);/)[0];
  assert.match(govLayer, /'text-size': \['interpolate', \['linear'\], \['zoom'\], 5, 9, 8, 10, 11, 11\]/);
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

// ------------------------------------------------- Live: «مباشر» button (req. A)
test('a «مباشر» button with a pulsing dot lives in the map-tools cluster', () => {
  assert.match(live, /function buildMapBtn\(\)/);
  assert.match(live, /getElementById\('mapCtrls'\)/);
  assert.match(live, /b\.id = 'liveMapBtn';/);
  assert.match(live, /b\.className = 'live-map-btn';/);
  assert.match(live, /live-dot-pulse/);
  assert.match(css, /\.live-map-btn \{[^}]*height: 36px;/);
  assert.match(css, /\.live-map-btn \{[^}]*font-size: 11\.5px;/);
  assert.match(css, /\.live-dot-pulse::after \{[^}]*animation: ping 1\.8s/);
  // built in init() — always present, even when the strip was dismissed
  assert.match(live, /function init\(\) \{\s*buildStrip\(\);\s*buildMapBtn\(\);/);
});

test('the map button opens the Live sheet directly on the World news view', () => {
  assert.match(live, /open\('world'\)/);
  assert.match(live, /if \(view === 'world'\) \{ newsFocus = 'world'; \}/);
  // world section renders first under world focus, Syria first otherwise
  assert.match(live, /newsFocus === 'world' \? worldSec \+ syriaSec : syriaSec \+ worldSec/);
});

// ------------------------------------------------- Live: vertical scroll (req. B)
test('the sheet is a single news view inside the vertical scroller (OSINT + markets removed)', () => {
  // owner simplification (2026-11-17): news only — no tabs, no OSINT pane,
  // no markets grid, in either the markup or the render code
  assert.doesNotMatch(live, /osintHtml|marketsHtml|data-tab|live-tabs/);
  assert.doesNotMatch(live, /data\?\.osint|data\?\.markets/);
  assert.match(live, /<div class="live-scroll"><div class="live-vtrack"><div class="live-set">\$\{newsHtml\(\)\}/);
  assert.match(live, /function setupScroller\(\)/);
  // duplicated exactly once, only when one set overflows the viewport
  assert.match(live, /setH <= sc\.clientHeight \+ 4/);
  assert.match(live, /const copy = set\.cloneNode\(true\);/);
  assert.match(live, /copy\.setAttribute\('aria-hidden', 'true'\);/);
  // ~30px/s ≈ one news row every ~2s, clamped
  assert.match(live, /Math\.min\(240, Math\.max\(12, setH \/ 30\)\)/);
});

test('vertical scroll CSS: seamless loop, pauses, stops closed, honours reduced motion', () => {
  assert.match(css, /@keyframes live-vscroll \{ from \{ transform: translateY\(0\); \} to \{ transform: translateY\(-50%\); \} \}/);
  assert.match(css, /\.live-vtrack\.anim \{ animation: live-vscroll linear infinite; \}/);
  assert.match(css, /\.live-scroll:hover \.live-vtrack\.anim, \.live-scroll\.paused \.live-vtrack\.anim \{ animation-play-state: paused; \}/);
  assert.match(css, /\.live-sheet:not\(\.open\) \.live-vtrack\.anim \{ animation: none; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.live-vtrack\.anim \{ animation: none; \} \.live-scroll \{ overflow-y: auto; \} \}/);
  // touch/drag pauses from JS and resumes after release
  assert.match(live, /sc\.addEventListener\('pointerdown', \(\) => \{ sc\.classList\.add\('paused'\);/);
});

// ------------------------------------------------- Live: marquee robustness (req. C)
test('strip storage access is webview-safe (a throwing localStorage cannot kill init)', () => {
  assert.match(live, /const storeGet = \(k\) => \{ try \{ return localStorage\.getItem\(k\); \} catch \{ return null; \} \};/);
  assert.match(live, /if \(storeGet\('ras-live-off'\) === '1'\) return;/);
  assert.doesNotMatch(live, /localStorage\.setItem\('ras-live-off'/);
});

test('marquee rebuilds its track per render, loops two measured halves, pauses on touch', () => {
  // fresh track node each render -> the CSS animation restarts with new content
  assert.match(live, /old\.replaceWith\(track\); else marquee\.appendChild\(track\);/);
  // halves: the run repeats until one half is at least as wide as the marquee
  assert.match(live, /while \(half\.scrollWidth < marquee\.clientWidth && guard\+\+ < 5\)/);
  assert.match(live, /half2\.setAttribute\('aria-hidden', 'true'\);/);
  // duration from measured width (constant px/s), not a per-item guess
  assert.match(live, /Math\.max\(12, half\.scrollWidth \/ 55\)/);
  // empty feed renders a still, non-animated track
  assert.match(live, /track\.classList\.add\('still'\);/);
  assert.match(css, /\.live-track\.still \{ animation: none; \}/);
  assert.match(css, /\.live-marquee\.paused \.live-track \{ animation-play-state: paused; \}/);
  assert.match(live, /marquee\.addEventListener\('pointerdown', \(\) => \{ marquee\.classList\.add\('paused'\);/);
  // Syria headlines still lead the run, world follows
  assert.match(live, /\[\.\.\.\(data\?\.news\?\.syria \|\| \[\]\), \.\.\.\(data\?\.news\?\.world \|\| \[\]\)\]/);
});

test('marquee flows in the reversed direction (owner request, 2026-11-17)', () => {
  // -50% -> 0 over the two identical halves: headlines move rightward and the
  // loop point is invisible because half two replaces half one exactly
  assert.match(css, /@keyframes live-scroll \{ from \{ transform: translateX\(-50%\); \} to \{ transform: translateX\(0\); \} \}/);
  assert.doesNotMatch(css, /@keyframes live-scroll \{ from \{ transform: translateX\(0\); \} to \{ transform: translateX\(-50%\); \} \}/);
  // speed is untouched: duration still comes from the measured half width
  assert.match(live, /Math\.max\(12, half\.scrollWidth \/ 55\)/);
});
