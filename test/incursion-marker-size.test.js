import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/css/app.css', import.meta.url), 'utf8');
const map = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');

test('military incursion icons stay at the standard 24px size when selected or hovered', () => {
  assert.match(map, /el\.className = `mk t-\$\{a\.type\}/, 'the icon receives a type-specific marker class');
  assert.match(map, /const sz = 24;/, 'map SVG icons retain the standard 24px canvas');
  assert.match(map, /width:\$\{sz\}px;height:\$\{sz\}px/, 'the icon wrapper remains 24px');
  assert.match(css, /\.ic-svg \{ display: block; width: 24px; height: 24px;/);
  assert.match(css, /\.mk:hover \.ic, \.mk\.sel \.ic \{ transform: translate\(-50%, -50%\) scale\(1\.25\); \}/, 'other selected icons keep their existing emphasis');
  assert.match(css, /\.mk\.t-military_incursion:hover \.ic, \.mk\.t-military_incursion\.sel \.ic \{ transform: translate\(-50%, -50%\) scale\(1\); \}/, 'only incursion avoids the 30px hover/selection enlargement');
  assert.match(map, /el\.style\.setProperty\('--c', visual\.color\)/, 'category color remains data-driven');
  assert.match(map, /if \(!\['squad', 'movement', 'fly'\]\.includes\(marker\)\) el\.insertAdjacentHTML\('afterbegin', '<span class="news-pulse-ring"/, 'the established pulse ring remains enabled');
});
