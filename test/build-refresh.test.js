import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { deploymentBuild, shouldReloadForBuild, reloadOnceForBuild } from '../public/js/build-guard.js';

const OLD = '627216103d';
const NEW = 'a27216103d';

test('build comparison uses initial app URL build and ignores dev and synthetic fixture labels', () => {
  assert.equal(deploymentBuild('100'), null);
  assert.equal(deploymentBuild('fixture-build'), null);
  assert.equal(shouldReloadForBuild('100', NEW), false);
  assert.equal(shouldReloadForBuild('fixture-build', NEW), false);
  assert.equal(shouldReloadForBuild(OLD, OLD), false);
  assert.equal(shouldReloadForBuild(OLD, NEW), true);
});

test('reload guard reloads once per target and preserves unrelated session data', () => {
  const data = new Map([['user-preference', 'kept']]);
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  let reloads = 0;
  assert.equal(reloadOnceForBuild(NEW, { storage, reload: () => reloads++ }), true);
  assert.equal(reloadOnceForBuild(NEW, { storage, reload: () => reloads++ }), false);
  assert.equal(reloads, 1);
  assert.equal(data.get('user-preference'), 'kept');
  assert.equal(data.get('ras-build-reloaded-to'), NEW);
});

test('reload guard fails closed if session storage is unavailable or throws', () => {
  let reloads = 0;
  assert.equal(reloadOnceForBuild(NEW, { storage: null, reload: () => reloads++ }), false);
  assert.equal(reloadOnceForBuild(NEW, { storage: { getItem() { throw new Error('blocked'); }, setItem() {} }, reload: () => reloads++ }), false);
  assert.equal(reloads, 0);
});

test('service worker revalidates js/css/shared first and falls back to cached assets offline', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const handlers = {};
  const entries = new Map();
  const cache = { match: async (req) => entries.get(req.url), put: async (req, response) => entries.set(req.url, response) };
  let fetchImpl = async () => new Response('fresh', { status: 200 });
  const context = {
    self: { location: { href: 'https://app.test/sw.js?v=627216103d' }, addEventListener: (n, fn) => { handlers[n] = fn; } },
    location: { origin: 'https://app.test' }, URL, Response,
    caches: { open: async () => cache, match: async (req) => entries.get(req.url), keys: async () => [], delete: async () => true },
    fetch: (...args) => fetchImpl(...args),
  };
  vm.runInNewContext(source, context);
  const request = new Request('https://app.test/js/app.js?v=627216103d');
  const respond = async (req) => {
    let promise;
    handlers.fetch({ request: req, respondWith: (p) => { promise = p; } });
    return promise;
  };
  assert.equal(await (await respond(request)).text(), 'fresh');
  fetchImpl = async () => { throw new Error('offline'); };
  assert.equal(await (await respond(request)).text(), 'fresh');
  const vendor = new Request('https://app.test/vendor/maplibre-gl.mjs');
  entries.set(vendor.url, new Response('cached vendor'));
  const vendorResult = await new Promise((resolve) => handlers.fetch({ request: vendor, respondWith: resolve }));
  assert.equal(await vendorResult.text(), 'cached vendor', 'vendor assets keep their prior cache-first path');
});
