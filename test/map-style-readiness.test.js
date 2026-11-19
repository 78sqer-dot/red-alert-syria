import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');
const firstSymbolSource = source.match(/function firstSymbolId\(map\) \{[\s\S]*?\n\}/)[0];
const firstSymbolId = vm.runInNewContext(`(${firstSymbolSource})`);
const fallbackSource = source.match(/function fallbackStyle\(kind\) \{[\s\S]*?\n\}/)[0];
const glyphsUrl = source.match(/const GLYPHS = '([^']+)';/)[1];
const osmTilesUrl = source.match(/const OSM_TILES = '([^']+)';/)[1];
const fallbackStyle = vm.runInNewContext(`(${fallbackSource})`, { GLYPHS: glyphsUrl, OSM_TILES: osmTilesUrl });
const governorateLabelSource = source.match(/function governorateLabelExpr\(lang\) \{[\s\S]*?\n\}/)[0];
const governorateLabelExpr = vm.runInNewContext(`(${governorateLabelSource})`);
const overlaysBody = source.match(/  async addOverlays\(\) \{([\s\S]*?)\n  \}\n\n  \/\*\* services/)[1];
const overlaysWith = (loadData) => vm.runInNewContext(`(async function () {${overlaysBody}\n})`, { loadData });

test('symbol lookup safely handles a style that is not yet available', () => {
  assert.equal(firstSymbolId({ getStyle: () => undefined }), undefined);
  assert.equal(firstSymbolId({ getStyle: () => ({ layers: [] }) }), undefined);
  assert.equal(firstSymbolId({ getStyle: () => ({ layers: [{ id: 'bg', type: 'background' }, { id: 'labels', type: 'symbol' }] }) }), 'labels');
});

test('fallback style uses readable OSM raster tiles with visible attribution', () => {
  const style = fallbackStyle('light');
  assert.equal(style.sources.osmFallback.type, 'raster');
  assert.equal(style.sources.osmFallback.tiles[0], 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.match(style.sources.osmFallback.attribution, /OpenStreetMap<\/a> contributors/);
  assert.ok(style.layers.some((layer) => layer.id === 'osm-fallback' && layer.source === 'osmFallback'));
});

test('governorate display uses plain Arabic name and preserves the English label', () => {
  assert.equal(JSON.stringify(governorateLabelExpr('ar')), '["get","ar"]');
  assert.equal(JSON.stringify(governorateLabelExpr('en')), '["concat",["get","en"]," Governorate"]');
});

test('CSP allows the OSM fallback tile host for images and tile requests', () => {
  const imgSrc = serverSource.match(/'img-src': \[([^\]]+)\]/)?.[1] || '';
  const connectSrc = serverSource.match(/'connect-src': \[([^\]]+)\]/)?.[1] || '';
  assert.ok(imgSrc.includes("'https://tile.openstreetmap.org'"));
  assert.ok(connectSrc.includes("'https://tile.openstreetmap.org'"));
});

test('overlays do not touch a missing style after asynchronous data loading', async () => {
  const map = { getStyle: () => undefined, addSource: () => assert.fail('must wait for the next style.load') };
  await overlaysWith(async () => ({ border: {}, govs: {} })).call({ map, _styleEpoch: 1 });
});

test('an overlay load started for a replaced style is discarded safely', async () => {
  let release;
  const data = new Promise((resolve) => { release = resolve; });
  const map = { getStyle: () => assert.fail('stale work must stop before reading style') };
  const owner = { map, _styleEpoch: 1 };
  const pending = overlaysWith(() => data).call(owner);
  owner._styleEpoch = 2;
  release({ border: {}, govs: {} });
  await pending;
});

test('an overlay load cannot modify a replacement map instance', async () => {
  let release;
  const data = new Promise((resolve) => { release = resolve; });
  const owner = { map: { getStyle: () => assert.fail('removed map must not be read') }, _styleEpoch: 1 };
  const pending = overlaysWith(() => data).call(owner);
  owner.map = {};
  release({ border: {}, govs: {} });
  await pending;
});
