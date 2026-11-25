import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
const firstSymbolSource = source.match(/function firstSymbolId\(map\) \{[\s\S]*?\n\}/)[0];
const firstSymbolId = vm.runInNewContext(`(${firstSymbolSource})`);
const overlaysBody = source.match(/  async addOverlays\(\) \{([\s\S]*?)\n  \}\n\n  \/\*\* services/)[1];
const overlaysWith = (loadData) => vm.runInNewContext(`(async function () {${overlaysBody}\n})`, { loadData });

test('symbol lookup safely handles a style that is not yet available', () => {
  assert.equal(firstSymbolId({ getStyle: () => undefined }), undefined);
  assert.equal(firstSymbolId({ getStyle: () => ({ layers: [] }) }), undefined);
  assert.equal(firstSymbolId({ getStyle: () => ({ layers: [{ id: 'bg', type: 'background' }, { id: 'labels', type: 'symbol' }] }) }), 'labels');
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

test('local fallback recovers to the detailed basemap in the background (Saqr spec, rebuilt for this tree)', () => {
  // both style-application paths report what they applied
  assert.match(source, /this\.map\.setStyle\(style, \{ diff: false \}\); this\._noteStyleApplied\(style\);/);
  assert.match(source, /this\.map\.setStyle\(style, \{ diff: false \}\);\n      this\._noteStyleApplied\(style\);/);
  assert.match(source, /this\._noteStyleApplied\(null\);/, 'a failed style load arms recovery');
  // fallback detection: no vector/openfreemap source means we are on the refuge style
  assert.match(source, /const isFallbackStyle = \(style\) =>/);
  assert.match(source, /src\.type === 'vector'/);
  // gradual backoff, capped — not an open-ended fixed timer
  assert.match(source, /RECOVERY_BACKOFF_MS = \[45000, 90000, 180000, 300000\]/);
  // recovery counts only a REAL tile with a real payload — never JSON alone
  assert.match(source, /_probeDetailedBasemap\(\)/);
  assert.match(source, /bytes\.byteLength >= 1024/);
  // probing defers while the page is hidden or the network is offline, and resumes on visibility
  assert.match(source, /document\.visibilityState && document\.visibilityState !== 'visible'/);
  assert.match(source, /navigator\.onLine === false/);
  assert.match(source, /visibilitychange/);
  // a mid-probe options change aborts the recovery (epoch guard)
  assert.match(source, /this\._styleEpoch !== epoch \|\| isFallbackStyle\(style\)\) return;/);
});
