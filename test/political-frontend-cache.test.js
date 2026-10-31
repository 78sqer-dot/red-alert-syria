import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
const index = read('public/index.html');
const app = read('public/js/app.js');
const settings = read('public/js/settings.js');
const map = read('public/js/map.js');

test('political type ships with fresh PWA and module-graph cache versions', () => {
  const appBuild = index.match(/\/js\/app\.js\?v=(\d+)/)?.[1];
  assert.ok(appBuild && Number(appBuild) > 32, 'HTML must request a fresh app build to update installed PWA users');
  assert.match(app, /settings\.js\?v=4/);
  assert.match(app, /map\.js\?v=36/);
  assert.match(app, /shared\/types\.js\?v=21/);
  assert.match(settings, /shared\/types\.js\?v=21/);
  assert.match(map, /shared\/types\.js\?v=21/);
  assert.match(map, /target-svgs\.js\?v=6/);
});
