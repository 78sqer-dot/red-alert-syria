import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated: temp DATA_DIR (no state.json -> restore comes from the fake backup),
// fake in-memory Telegram backup adapter, synthetic alerts only.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-store-backup-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'true';

const { store } = await import('../server/store.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeAdapter() {
  return {
    pinned: null,
    saves: [], // completion order: {alertCount, ids}
    latency: () => 0,
    async save(json) {
      const parsed = JSON.parse(json);
      await sleep(this.latency());
      this.pinned = json; // a save takes effect when the call completes
      this.saves.push({ alertCount: parsed.alerts.length, ids: parsed.alerts.map((a) => a.id) });
    },
    async load() { return this.pinned; },
    pinnedCount() { return this.pinned ? JSON.parse(this.pinned).alerts.length : null; },
    pinnedIds() { return this.pinned ? JSON.parse(this.pinned).alerts.map((a) => a.id) : []; },
  };
}

function alert(id, ageMs) {
  return {
    id, type: 'breaking', title: `TEST ${id}`, description: 'synthetic',
    timestamp: new Date(Date.now() - ageMs).toISOString(), is_active: true, source: 'telegram',
  };
}
function stateWith({ fresh, old, oldAgeH = 26, autoDeleteHours = 24 }) {
  const alerts = [];
  for (let i = 1; i <= fresh; i++) alerts.push(alert(`T-NEW-${String(i).padStart(2, '0')}`, (i * 5 + 5) * 60_000));
  for (let i = 1; i <= old; i++) alerts.push(alert(`T-OLD-${String(i).padStart(2, '0')}`, oldAgeH * 3600_000));
  alerts.sort((x, y) => Date.parse(y.timestamp) - Date.parse(x.timestamp));
  return {
    version: 1, alerts, editors: [], banned: [], users: {}, stats: { published: alerts.length },
    settings: { autoDel1h: true, autoDeleteHours, daily: { on: true, time: '23:00', last: null }, weekly: { on: true, day: 5, time: '23:00', last: null } },
    push: { subscriptions: {} }, log: [], relay: {}, threads: {},
  };
}

const adapter = fakeAdapter();

test('restore is lossless: first durable save after hand-off merge still holds every restored alert', async () => {
  adapter.pinned = JSON.stringify(stateWith({ fresh: 49, old: 5, autoDeleteHours: 24 }));
  store._backupWritesPaused = true; // as index.js does during startup
  await store.init(adapter, { deferSweep: true });
  assert.equal(store.state.alerts.length, 54, 'deferred sweep must not shrink the restored state');

  const merge = await store.mergeFromBackup();
  assert.equal(merge.backupLoaded, true);
  store._backupWritesPaused = false;
  store.persist();
  assert.equal(await store.flushBackup(true), true);
  assert.equal(adapter.pinnedCount(), 54, 'first confirmed save after the merge keeps all 54 alerts');

  store.beginSweeps(); // only now may the expiry sweep apply
  assert.equal(store.state.alerts.length, 49, 'sweep removes the 5 alerts older than the 24h window');
  store.persist();
  assert.equal(await store.flushBackup(true), true);
  assert.equal(adapter.pinnedCount(), 49, 'backup then converges to the swept state by design');
});

test('concurrent backup saves are serialized: a slow stale save can never land last', async () => {
  store._apply(stateWith({ fresh: 54, old: 0, autoDeleteHours: 0 }));
  assert.equal(store.state.alerts.length, 54);
  let call = 0;
  adapter.latency = () => (++call === 1 ? 250 : 0); // first save is slow (Telegram lag)
  adapter.saves = [];

  store.persist();
  const p1 = store.flushBackup(); // snapshot: 54 alerts, in flight
  await sleep(40);
  const live = store.addAlert({ type: 'breaking', title: 'T-LIVE-01 concurrent update during save' });
  assert.equal(store.state.alerts.length, 55);
  const ok2 = await store.flushBackup(true); // must queue behind p1, then save the latest state
  const ok1 = await p1;
  assert.equal(ok1, true);
  assert.equal(ok2, true);
  assert.equal(adapter.pinnedCount(), 55, 'final backup matches the live state');
  assert.ok(adapter.pinnedIds().includes(live.id), 'the alert added during the save is in the backup');
  assert.deepEqual(adapter.saves.map((s) => s.alertCount), [54, 55], 'saves land in snapshot order');
});

after(() => {
  clearTimeout(store._backupTimer);
  clearTimeout(store._saveTimer);
});
