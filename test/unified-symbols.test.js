import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ALERT_TYPES, TYPE_KEYS, TYPE_MENU, TYPE_MENU_GROUPS, TYPE_MENU_DIRECT, typeMenuGroupOf } from '../shared/types.js';
import { BOT_ALERT_MENU_GROUPS, BOT_ALERT_MENU_DIRECT_TYPES } from '../server/bot.js';
import { _test as monitorTest } from '../server/news-monitor.js';
import { NEWS_TYPES } from '../server/news-ai.js';

// Unified symbols (owner-approved, 2026-11-17): ONE canonical type menu in
// shared/types.js generates the reporting bot's keyboards, the news monitor's
// edit menu and its filter panel; one pin construction renders every static
// map type; the gun emoji is gone from every shipped surface.

test('TYPE_MENU covers every alert type exactly once, in the approved groups', () => {
  assert.deepEqual(TYPE_MENU.map((g) => g.key), ['direct', 'air', 'strikes', 'security', 'civil', 'smuggling', 'nature']);
  assert.deepEqual(TYPE_MENU.map((g) => g.types.length), [2, 6, 8, 6, 10, 3, 2]);
  const all = TYPE_MENU.flatMap((g) => g.types);
  assert.equal(new Set(all).size, all.length, 'no type appears twice');
  assert.deepEqual([...all].sort(), [...TYPE_KEYS].sort(), 'the menu covers the whole registry');
  assert.deepEqual([...TYPE_MENU_DIRECT], ['breaking', 'political']);
  assert.equal(TYPE_MENU_GROUPS.length, 6);
  const strikes = TYPE_MENU.find((g) => g.key === 'strikes');
  assert.equal(strikes.types.at(-1), 'assassination', 'assassination sits last in its group');
  assert.equal(ALERT_TYPES.shooting.emoji, '', 'shooting stays emoji-less on text surfaces');
  assert.equal(ALERT_TYPES.assassination.emoji, '', 'assassination stays emoji-less on text surfaces');
  for (const key of TYPE_KEYS) assert.equal(typeMenuGroupOf(key), TYPE_MENU.find((g) => g.types.includes(key)).key, `${key} resolves to its canonical group`);
  assert.equal(typeMenuGroupOf('not-a-type'), null);
});

test('both bots and the monitor filter panel are generated from the one menu', () => {
  // reporting bot
  assert.deepEqual(BOT_ALERT_MENU_DIRECT_TYPES, TYPE_MENU_DIRECT);
  assert.deepEqual(BOT_ALERT_MENU_GROUPS, Object.fromEntries(TYPE_MENU_GROUPS.map((g) => [g.key, g.types])));
  // monitor edit menu (the incursion entry is the kind-picker pseudo-group)
  const { editableTypeGroups, editableTypeDirectTypes, editTypeMenu, newsTypeGroups } = monitorTest;
  assert.deepEqual(editableTypeDirectTypes, TYPE_MENU_DIRECT);
  for (const g of TYPE_MENU_GROUPS) assert.deepEqual(editableTypeGroups[g.key], g.types, `edit menu group ${g.key} matches the canonical menu`);
  assert.deepEqual(editableTypeGroups.incursion, ['military_incursion']);
  assert.deepEqual(editTypeMenu, [
    ...TYPE_MENU_DIRECT.map((type) => ({ type })),
    ...TYPE_MENU_GROUPS.map((g) => ({ group: g.key })),
  ]);
  // monitor filter panel: canonical groups intersected with the monitored types
  for (const g of TYPE_MENU) {
    assert.deepEqual(newsTypeGroups[g.key], g.types.filter((type) => NEWS_TYPES.includes(type)), `filter group ${g.key} is the canonical group ∩ NEWS_TYPES`);
  }
});

test('the gun emoji appears nowhere in shipped code', () => {
  const dirs = ['shared', 'server', 'public/js', 'public/css'];
  const files = [];
  for (const dir of dirs) {
    for (const name of readdirSync(new URL(`../${dir}/`, import.meta.url))) {
      if (/\.(js|css|html)$/.test(name)) files.push(`${dir}/${name}`);
    }
  }
  files.push('public/index.html');
  assert.ok(files.length > 30, 'the scan actually covers the shipped tree');
  for (const file of files) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(!src.includes('🔫'), `${file} must not contain the banned gun emoji`);
  }
  // the smuggling type no longer references any gun drawing
  const targetSvgs = readFileSync(new URL('../public/js/target-svgs.js', import.meta.url), 'utf8');
  assert.ok(!/smuggling_weapons:/.test(targetSvgs), 'no glyph remains under the smuggling_weapons key');
  const typeIcons = readFileSync(new URL('../public/js/type-icons.js', import.meta.url), 'utf8');
  assert.ok(!typeIcons.includes("'rifle'"), 'no UI icon named rifle is referenced');
});

test('map pins: one dark roundel at every zoom, mini pin with glyph at country view', () => {
  const map = readFileSync(new URL('../public/js/map.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
  // one builder, one construction for static types and breaking alike
  assert.match(map, /export function glyphDisc\(type, size = 32, iconSize = 20, cls = 'pin', glyphOverride = null\)/);
  assert.match(map, /--ring:\$\{t\.color\}/);
  assert.doesNotMatch(map, /civ-dot|map-event-emoji|news-marker-core/);
  assert.doesNotMatch(css, /civ-dot|map-event-emoji|news-marker-core/);
  // the pin itself: dark disc, type ring, white glyph, outline + shadow
  assert.match(css, /\.pin \{[^}]*background: rgba\(255, 255, 255, \.62\); border: 3px solid var\(--ring[^}]*box-shadow: 0 1px 4px rgba\(10, 15, 25, \.35\)/);
  // sizes: 20px mini WITH glyph at far zoom (replacing the plain civil dot),
  // 32px standard, 38px near
  assert.match(css, /\.maplibregl-map\.zoom-far \.pin \{ width: 20px; height: 20px; border-width: 2px; \}/);
  assert.match(css, /\.maplibregl-map\.zoom-far \.pin svg \{ width: 13px; height: 13px; \}/);
  assert.match(css, /\.pin \{[^}]*width: 32px; height: 32px;/);
  assert.match(css, /\.maplibregl-map\.zoom-detail \.pin \{ width: 38px; height: 38px; \}/);
  // far zoom no longer hides civil markers
  assert.doesNotMatch(css, /zoom-far \.mk-civ/);
  // cluster badge speaks the same language: dark disc, ring in the first type colour
  assert.match(css, /\.mk-count \{[^}]*border: 2px solid var\(--ring[^}]*background: rgba\(255, 255, 255, \.62\)[^}]*backdrop-filter: blur\(3px\)[^}]*color: #101623;/); // owner 2026-11-19: glass badges, not black
  assert.match(map, /badge\.style\.setProperty\('--ring', typeOf\(a\.type\)\.color\)/);
});

test('the three redrawn glyphs match the approved proposal', async () => {
  const { SVG } = await import('../public/js/marker-svgs.js');
  const { EXTRA_SVG } = await import('../public/js/target-svgs.js');
  // artillery: dotted projectile arc + impact star (distinct from the reticle)
  assert.match(SVG.artillery, /stroke-dasharray="4 34"/);
  assert.match(SVG.artillery, /M392 300l14 62/);
  assert.notEqual(SVG.artillery, EXTRA_SVG.target_reticle);
  // quake: sharp seismic wave over a ground crack
  assert.match(SVG.quake, /M36 200h92l34-88 52 176 44-88h218/);
  assert.match(SVG.quake, /M36 362h150l38-46 34 46h218/);
  // contraband crate: crate + prohibition mark
  assert.match(EXTRA_SVG.contraband_crate, /M76 116h360v280H76z/);
  assert.match(EXTRA_SVG.contraband_crate, /<circle cx="256" cy="256" r="88"/);
});
