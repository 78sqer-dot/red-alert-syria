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
const fetchStyleSource = source.match(/async function fetchStyle\(kind\) \{[\s\S]*?\n\}/)[0];
const bundledStyleUrls = vm.runInNewContext(`${source.match(/const BUNDLED_STYLE_URL = \{[^;]+\};/)[0]}\nBUNDLED_STYLE_URL`);
const styleUrls = vm.runInNewContext(`${source.match(/const STYLE_URL = \{[^;]+\};/)[0]}\nSTYLE_URL`);
const makeFetchStyle = (fetchWithTimeout) => vm.runInNewContext(
  `(() => { const styleCache = {}; ${fetchStyleSource}; return fetchStyle; })()`,
  { fetchWithTimeout, fallbackStyle, BUNDLED_STYLE_URL: bundledStyleUrls, STYLE_URL: styleUrls },
);
const governorateLabelSource = source.match(/function governorateLabelExpr\(lang\) \{[\s\S]*?\n\}/)[0];
const governorateLabelExpr = vm.runInNewContext(`(${governorateLabelSource})`);
const overlaysBody = source.match(/  async addOverlays\(\) \{([\s\S]*?)\n  \}\n\n  \/\*\* services/)[1];
const overlaysWith = (loadData) => vm.runInNewContext(`(async function () {${overlaysBody}\n})`, { loadData });

test('symbol lookup safely handles a style that is not yet available', () => {
  assert.equal(firstSymbolId({ getStyle: () => undefined }), undefined);
  assert.equal(firstSymbolId({ getStyle: () => ({ layers: [] }) }), undefined);
  assert.equal(firstSymbolId({ getStyle: () => ({ layers: [{ id: 'bg', type: 'background' }, { id: 'labels', type: 'symbol' }] }) }), 'labels');
});

test('last-resort fallback retains OSM raster tiles with visible attribution', () => {
  const style = fallbackStyle('light');
  assert.equal(style.sources.osmFallback.type, 'raster');
  assert.equal(style.sources.osmFallback.tiles[0], 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.match(style.sources.osmFallback.attribution, /OpenStreetMap<\/a> contributors/);
  assert.ok(style.layers.some((layer) => layer.id === 'osm-fallback' && layer.source === 'osmFallback'));
});

test('bundled light and dark styles retain key-free OpenFreeMap vector sources', async () => {
  for (const name of ['liberty', 'dark']) {
    const style = JSON.parse(await readFile(new URL(`../public/map-styles/${name}.json`, import.meta.url), 'utf8'));
    assert.equal(style.version, 8);
    assert.equal(style.sources.openmaptiles.type, 'vector');
    assert.equal(style.sources.openmaptiles.url, 'https://tiles.openfreemap.org/planet');
    assert.equal(style.glyphs, glyphsUrl);
    assert.match(style.sprite, /^https:\/\/tiles\.openfreemap\.org\//);
    assert.doesNotMatch(JSON.stringify(style), /[?&]key=/i);
  }
});

test('bundled OpenFreeMap vector style is used when the remote style endpoint fails', async () => {
  const calls = [];
  const bundled = { version: 8, name: 'bundled vector' };
  const fetchWithTimeout = async (url) => {
    calls.push(url);
    if (url === styleUrls.light) throw new Error('remote style unavailable');
    if (url === bundledStyleUrls.light) return { ok: true, json: async () => bundled };
    throw new Error(`unexpected URL: ${url}`);
  };
  const style = await makeFetchStyle(fetchWithTimeout)('light');
  assert.deepEqual(JSON.parse(JSON.stringify(style)), bundled);
  assert.deepEqual(calls, [styleUrls.light, styleUrls.light, bundledStyleUrls.light]);
});

test('OSM raster is retained only when both remote and bundled vector styles fail', async () => {
  const calls = [];
  const fetchWithTimeout = async (url) => { calls.push(url); return { ok: false }; };
  const style = await makeFetchStyle(fetchWithTimeout)('dark');
  assert.equal(style.sources.osmFallback.type, 'raster');
  assert.deepEqual(calls, [styleUrls.dark, styleUrls.dark, bundledStyleUrls.dark]);
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

const watchSource = source.match(/function basemapWatchSourceId\(style, layer\) \{[\s\S]*?\n\}/)[0];
const basemapWatchSourceId = vm.runInNewContext(`(${watchSource})`);

test('basemap watchdog watches the vector tile source (and Esri for satellite)', () => {
  assert.equal(basemapWatchSourceId({ sources: { openmaptiles: { type: 'vector' } } }, 'standard'), 'openmaptiles');
  assert.equal(basemapWatchSourceId({ sources: { openmaptiles: {}, esri: { type: 'raster' } } }, 'satellite'), 'esri');
  assert.equal(basemapWatchSourceId({ sources: { esri: {} } }, 'standard'), null);
  assert.equal(basemapWatchSourceId(fallbackStyle('light'), 'standard'), null);
  assert.equal(basemapWatchSourceId(null, 'standard'), null);
  assert.equal(basemapWatchSourceId(undefined, 'satellite'), null);
});

test('map switches to the OSM raster fallback when basemap tiles never arrive', () => {
  assert.match(source, /_armBasemapWatchdog\(style\)/);
  assert.match(source, /_applyRasterFallback\('basemap tiles did not arrive'\)/);
  assert.match(source, /_armBasemapWatchdog\(style, true\)/); // one vector reload is tried before the raster fallback
  assert.match(source, /map\.setStyle\(fallbackStyle\(this\.opts\.dark \? 'dark' : 'light'\), \{ diff: false \}\)/);
});
