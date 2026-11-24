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
