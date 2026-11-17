import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/css/app.css', import.meta.url), 'utf8');
const map = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');

test('military incursion markers are the unified pin at the standard size, halo instead of hover scaling', () => {
  assert.match(map, /el\.className = `mk t-\$\{a\.type\}/, 'the marker receives a type-specific class');
  assert.match(map, /glyphDisc\(a\.type, 32, 20, 'pin', pinGlyph === t\.glyph/, 'incursion renders through the one pin builder');
  assert.match(css, /\.pin \{[^}]*width: 32px; height: 32px;/, 'the pin keeps the standard 32px size for every type, incursion included');
  assert.match(css, /\.pin svg \{ display: block; width: 20px; height: 20px; \}/, 'pin glyphs keep the standard 20px size');
  assert.doesNotMatch(css, /\.mk:hover \.pin[^}]*scale\(/, 'no pin grows on hover — emphasis is the ring halo');
  assert.doesNotMatch(css, /\.mk\.sel \.pin[^}]*scale\(/, 'no pin grows when selected either');
  assert.match(css, /\.mk:hover \.pin, \.mk\.sel \.pin \{ box-shadow: 0 0 0 1px rgba\(6,10,16,\.65\), 0 0 0 5px color-mix\(in srgb, var\(--ring/, 'selected/hover emphasis is the halo in the type colour');
  assert.match(map, /el\.style\.setProperty\('--c', visual\.color\)/, 'category color remains data-driven');
  assert.match(map, /if \(!\['squad', 'movement', 'fly'\]\.includes\(marker\)\) el\.insertAdjacentHTML\('afterbegin', '<span class="news-pulse-ring"/, 'the established pulse ring remains enabled');
});
