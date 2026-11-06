import test from 'node:test';
import assert from 'node:assert/strict';
import { registerJobsAdminTools } from '../server/jobs-admin-tools.js';
import { store } from '../server/store.js';
import { createPendingJob, decideJob, initialJobsState, locationForGovernorate } from '../server/jobs.js';
import { governorates } from '../server/places.js';

class FakeBot {
  callbacks = [];
  on() {}
  callbackQuery(filter, handler) { this.callbacks.push({ filter, handler }); }
  findCallback(data) { return this.callbacks.find(({ filter }) => typeof filter === 'string' ? filter === data : filter.test(data)); }
}
function helpers() {
  return {
    owner: (ctx) => ctx.isOwner === true,
    langOf: () => 'ar',
    show: async (ctx, text, keyboard) => { ctx.screen = { text, keyboard }; },
  };
}
function context({ isOwner = false, match = [] } = {}) {
  return {
    isOwner, from: { id: 9 }, chat: { id: 9, type: 'private' }, match,
    answers: 0,
    answerCallbackQuery: async () => {},
  };
}

test('job administration panel callbacks are owner-only', async () => {
  const bot = new FakeBot(); registerJobsAdminTools(bot, helpers());
  const handler = bot.findCallback('j:admin').handler;
  const denied = context({ isOwner: false });
  // Avoid depending on a real Telegram API in the access check.
  denied.answerCallbackQuery = async () => { denied.answers++; };
  await handler(denied);
  assert.equal(denied.screen, undefined);
  assert.equal(denied.answers, 1);

  const allowed = context({ isOwner: true });
  allowed.answerCallbackQuery = async () => { allowed.answers++; };
  await handler(allowed);
  assert.equal(allowed.screen.text.includes('قسم الوظائف بالموقع فقط'), true);
  assert.equal(allowed.screen.keyboard.inline_keyboard.flat().some((button) => button.callback_data === 'j:admin:add'), true);
});

test('opening a listing deletion prompt does not delete it before the confirmation callback', async () => {
  const original = store.state.jobs;
  const jobs = initialJobsState(); store.state.jobs = jobs;
  try {
    const created = createPendingJob({
      kind: 'manual', sourceKey: 'synthetic:admin-delete-confirmation', title: 'اختبار إعلان غير حقيقي',
      text: 'هذا إعلان اختباري مصطنع للتحقق من خطوة تأكيد الحذف ولا يمثل إعلاناً حقيقياً.',
      location: locationForGovernorate(governorates[0].code, jobs),
    }, jobs, Date.now());
    assert.ok(created.job);
    assert.equal(decideJob(created.job.id, 'approve', jobs, 9, Date.now() + 1).ok, true);

    const bot = new FakeBot(); registerJobsAdminTools(bot, helpers());
    const id = created.job.id;
    const data = `j:admin:delete:${id}`;
    const handler = bot.findCallback(data).handler;
    const ctx = context({ isOwner: true, match: [data, id] });
    ctx.answerCallbackQuery = async () => {};
    await handler(ctx);

    assert.ok(jobs.published[id], 'the synthetic listing remains untouched while confirmation is shown');
    const callbackValues = ctx.screen.keyboard.inline_keyboard.flat().map((button) => button.callback_data);
    assert.ok(callbackValues.includes(`j:admin:delete-yes:${id}`), 'deletion requires a separate explicit confirmation tap');
  } finally {
    store.state.jobs = original;
  }
});
