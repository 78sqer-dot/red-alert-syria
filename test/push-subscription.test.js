import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { disablePushSubscription } from '../public/js/push-subscription.js';

const endpoint = 'https://push.example.test/send/subscription-token';
const appSource = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
function fakeServiceWorker({ subscription = null, readyFails = false } = {}) {
  return {
    ready: readyFails ? Promise.reject(new Error('service worker unavailable')) : Promise.resolve({
      pushManager: { getSubscription: async () => subscription },
    }),
  };
}

test('disabling push deletes the server record and unsubscribes the browser endpoint', async () => {
  let unsubscribeCalls = 0;
  const requests = [];
  const subscription = { endpoint, unsubscribe: async () => { unsubscribeCalls++; return true; } };
  const result = await disablePushSubscription({
    serviceWorker: fakeServiceWorker({ subscription }),
    fetchImpl: async (url, options) => { requests.push({ url, options }); return { ok: true }; },
  });

  assert.deepEqual(result, { found: true, serverRemoved: true, browserUnsubscribed: true });
  assert.equal(unsubscribeCalls, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/push/subscribe');
  assert.equal(requests[0].options.method, 'DELETE');
  assert.deepEqual(JSON.parse(requests[0].options.body), { endpoint });
});

test('the notification-off control invokes push unsubscription after saving the disabled preference', () => {
  assert.match(appSource, /import \{ disablePushSubscription \} from '\.\/push-subscription\.js\?v=1';/);
  assert.match(appSource, /settings\.set\(\{ notifications: \{ enabled: false \} \}\);\s*syncNotificationButton\(\);\s*await disablePushSubscription\(\{ serviceWorker: navigator\.serviceWorker \}\);/);
});

test('browser unsubscribe still happens if deleting the server record fails', async () => {
  let unsubscribeCalls = 0;
  const subscription = { endpoint, unsubscribe: async () => { unsubscribeCalls++; return true; } };
  const result = await disablePushSubscription({
    serviceWorker: fakeServiceWorker({ subscription }),
    fetchImpl: async () => { throw new Error('offline'); },
  });

  assert.deepEqual(result, { found: true, serverRemoved: false, browserUnsubscribed: true });
  assert.equal(unsubscribeCalls, 1);
});

test('unavailable service worker or missing subscription is handled without a request', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests++; return { ok: true }; };
  assert.deepEqual(await disablePushSubscription({ fetchImpl }), {
    found: false, serverRemoved: false, browserUnsubscribed: false,
  });
  assert.deepEqual(await disablePushSubscription({
    serviceWorker: fakeServiceWorker(), fetchImpl,
  }), { found: false, serverRemoved: false, browserUnsubscribed: false });
  assert.deepEqual(await disablePushSubscription({
    serviceWorker: fakeServiceWorker({ readyFails: true }), fetchImpl,
  }), { found: false, serverRemoved: false, browserUnsubscribed: false });
  assert.equal(requests, 0);
});
