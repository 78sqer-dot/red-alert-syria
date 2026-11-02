import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { dispatchPush } from '../server/push.js';

const makeStore = (subscriptions) => {
  const removed = [];
  return {
    removed,
    pushSubscriptions: () => Object.entries(subscriptions),
    removePushSubscription: (id) => { removed.push(id); return true; },
  };
};

const makeAlert = () => ({
  id: 'push-monitor-synthetic-alert',
  type: 'political',
  title: 'Synthetic Web Push performance check',
  description: 'This test must never reach a real browser or push service.',
  place: { governorate: '13' },
});

test('synthetic fan-out processes 2,000 subscriptions within the performance budget', async () => {
  const subscriptions = Object.fromEntries(Array.from({ length: 2_000 }, (_, i) => [`sub-${i}`, {
    endpoint: `https://push.example.test/${i}`,
    keys: { p256dh: 'synthetic', auth: 'synthetic' },
    types: i % 10 === 0 ? ['political'] : ['explosion'],
    governorate: i % 3 === 0 ? '13' : 'all',
  }]));
  const store = makeStore(subscriptions);
  let deliveries = 0;
  const started = performance.now();

  const result = await dispatchPush(store, makeAlert(), 'new', async (_sub, payload, options) => {
    deliveries++;
    const data = JSON.parse(payload);
    assert.equal(data.alertId, 'push-monitor-synthetic-alert');
    assert.equal(data.event, 'new');
    assert.equal(options.TTL, 300);
  });

  const elapsedMs = performance.now() - started;
  assert.equal(result.sent, 200);
  assert.equal(result.skipped, 1_800);
  assert.equal(deliveries, 200);
  assert.deepEqual(store.removed, []);
  assert.ok(elapsedMs < 5_000, `2,000-subscription synthetic fan-out took ${elapsedMs.toFixed(1)}ms (budget 5000ms)`);
  console.log(`Web Push synthetic fan-out: ${elapsedMs.toFixed(1)}ms; ${deliveries}/2000 matching subscriptions`);
});

test('expired subscriptions are removed and transient delivery failures do not stop fan-out', async () => {
  const store = makeStore({
    expired: { endpoint: 'https://push.example.test/expired', types: ['political'], governorate: 'all' },
    transient: { endpoint: 'https://push.example.test/transient', types: ['political'], governorate: 'all' },
    healthy: { endpoint: 'https://push.example.test/healthy', types: ['political'], governorate: 'all' },
  });
  let deliveries = 0;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  let result;
  try {
    result = await dispatchPush(store, makeAlert(), 'update', async (sub) => {
      deliveries++;
      if (sub.endpoint.endsWith('/expired')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (sub.endpoint.endsWith('/transient')) throw Object.assign(new Error('temporary'), { statusCode: 503 });
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(result.sent, 1);
  assert.equal(result.skipped, 0);
  assert.equal(deliveries, 3);
  assert.deepEqual(store.removed, ['expired']);
  assert.equal(warnings.length, 1);
});

test('push dispatch does not invoke a real transport unless a sender is supplied', async () => {
  const store = makeStore({ sub: { types: ['political'], governorate: 'all' } });
  assert.deepEqual(await dispatchPush(store, makeAlert(), 'new'), { sent: 0, skipped: 0 });
  assert.deepEqual(await dispatchPush(store, { title: 'No id' }, 'new', async () => assert.fail('must not send')),
    { sent: 0, skipped: 0 });
});
