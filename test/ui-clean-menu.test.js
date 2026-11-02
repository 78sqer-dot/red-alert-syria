import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-ui-menu-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
process.env.OWNER_IDS = '8270709633';

const { store } = await import('../server/store.js');
await store.init(null);
const { cleanMenuMessages, _test } = await import('../server/ui-clean.js');

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

test('menu cleanup deletes tracked user and bot messages, including kept/current screens, but preserves pinned backup', async () => {
  const chat = 8270709633;
  _test.bucket('admin', chat).push(
    { id: 101, t: Date.now(), s: 1, c: 1 },                 // old bot menu screen
    { id: 102, t: Date.now(), s: 2, u: 1 },                 // user's own command/message
    { id: 103, t: Date.now(), s: 3, c: 1, k: 'c' },         // open report card
    { id: 104, t: Date.now(), s: 4, c: 1 },                 // current callback message
    { id: 105, t: Date.now(), s: 5, c: 1 },                 // pinned message
    { id: 106, t: Date.now(), s: 6 },                       // old plain bot notice
  );
  const deleted = [];
  const api = {
    getChat: async () => ({ pinned_message: { message_id: 105 } }),
    deleteMessages: async (_chat, ids) => { deleted.push(...ids); return true; },
    deleteMessage: async (_chat, id) => { deleted.push(id); return true; },
  };

  const count = await cleanMenuMessages(api, 'admin', chat);
  assert.equal(count, 5);
  assert.deepEqual(deleted, [101, 102, 103, 104, 106]);
  assert.deepEqual(_test.bucket('admin', chat).map((x) => x.id), [105]);
});

test('menu cleanup tracks and deletes the current user /menu command but never the pinned backup', async () => {
  const chat = 8270709636;
  const deleted = [];
  const api = {
    getChat: async () => ({ pinned_message: { message_id: 402 } }),
    deleteMessages: async (_chat, ids) => { deleted.push(...ids); return true; },
  };
  const count = await cleanMenuMessages(api, 'report', chat, { message_id: 401, date: Math.floor(Date.now() / 1000) });
  assert.equal(count, 1);
  assert.deepEqual(deleted, [401]);
  assert.equal((_test.bucket('report', chat) || []).length, 0);
});

test('menu cleanup fails closed if the pinned message cannot be checked', async () => {
  const chat = 8270709634;
  _test.bucket('report', chat).push({ id: 201, t: Date.now(), s: 1, c: 1 });
  let deleteCalls = 0;
  const api = {
    getChat: async () => { throw new Error('temporary API error'); },
    deleteMessages: async () => { deleteCalls++; },
    deleteMessage: async () => { deleteCalls++; },
  };

  assert.equal(await cleanMenuMessages(api, 'report', chat), 0);
  assert.equal(deleteCalls, 0);
  assert.deepEqual(_test.bucket('report', chat).map((x) => x.id), [201]);
});

test('failed Telegram deletion remains tracked for the next menu cleanup', async () => {
  const chat = 8270709635;
  _test.bucket('admin', chat).push({ id: 301, t: Date.now(), s: 1, c: 1 });
  const api = {
    getChat: async () => ({}),
    deleteMessages: async () => { throw new Error('temporary bulk deletion error'); },
    deleteMessage: async () => { throw new Error('temporary single deletion error'); },
  };
  assert.equal(await cleanMenuMessages(api, 'admin', chat), 0);
  assert.deepEqual(_test.bucket('admin', chat).map((x) => x.id), [301]);
});
