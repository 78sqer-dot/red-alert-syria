import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _test, registerArmyAdminTools } from '../server/army-admin-tools.js';
import { store } from '../server/store.js';
import { initialArmyState, addManualArmySource } from '../server/army.js';

const src = readFileSync(new URL('../server/army-admin-tools.js', import.meta.url), 'utf8');
const armySrc = readFileSync(new URL('../server/army.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const h = { langOf: () => 'ar' };
const callbackData = (keyboard) => keyboard.inline_keyboard.flat().map((button) => button.callback_data);

 test('admin approval button is available only for pending items and deletes require a second confirmation', () => {
  const pending = _test.itemKeyboard({}, h, { id: 'abcdef01234567', category: 'army', status: 'pending' });
  const pendingActions = callbackData(pending);
  assert.ok(pendingActions.includes('army:approve:abcdef01234567'));
  assert.ok(pendingActions.includes('army:ignore:abcdef01234567'));
  assert.ok(pendingActions.includes('army:delete:abcdef01234567'));
  assert.equal(pendingActions.includes('army:delete-yes:abcdef01234567'), false);

  const published = _test.itemKeyboard({}, h, { id: 'abcdef01234567', category: 'army', status: 'approved' });
  const publishedActions = callbackData(published);
  assert.equal(publishedActions.some((value) => value.startsWith('army:approve:')), false);
  assert.ok(publishedActions.includes('army:delete:abcdef01234567'));
});

test('review and follow-channel controls explicitly avoid automatic cross-posting', () => {
  assert.match(armySrc, /It stays off the website\/map until you approve it/);
  assert.match(armySrc, /never posted to the news channel or Telegram\/WhatsApp/);
  assert.match(src, /النظام لا ينشر ولا يرسل محتوى إليها/);
  assert.match(armySrc, /await adminApi\.sendMessage\(owner,/);
  assert.doesNotMatch(armySrc, /publishToChannel|sendMessage\(.*channels\.tg|sendMessage\(.*channels\.wa/);
  assert.match(index, /army: publicArmy\(\)/);
  assert.match(index, /store\.on\('army'.*only/);
});

test('manual monitoring-source controls are visible only in the private owner panel, not the public projection', () => {
  const previous = store.state.army;
  try {
    store.state.army = initialArmyState();
    assert.equal(addManualArmySource({ username: 'ManualNews', name: 'مصدر يدوي', type: 'media' }, store.state.army).ok, true);
    const screen = _test.sourceScreen({}, h);
    const actions = callbackData(screen.keyboard);
    assert.ok(actions.includes('army:source:add'));
    assert.ok(actions.includes('army:source:manage:ManualNews'));
    assert.match(screen.text, /لا تظهر في قائمة الخريطة/);
    const manage = _test.sourceManageScreen({}, h, 'ManualNews');
    const manageActions = callbackData(manage.keyboard);
    assert.ok(manageActions.includes('army:source:edit-name:ManualNews'));
    assert.ok(manageActions.includes('army:source:edit-channel:ManualNews'));
    assert.ok(manageActions.includes('army:source:set-type:official:ManualNews'));
    assert.ok(manageActions.includes('army:source:delete:ManualNews'));
  } finally { store.state.army = previous; }
});

test('approval, edits, channel setup, monitoring and deletion callbacks reject non-owners', async () => {
  const handlers = [];
  const bot = {
    command() {},
    callbackQuery(filter, fn) { handlers.push([filter, fn]); },
    on() {},
  };
  let screenChanges = 0; let callbackAnswered = false;
  const helpers = {
    owner: (ctx) => ctx.allowed === true,
    langOf: () => 'ar',
    show: async () => { screenChanges++; },
  };
  registerArmyAdminTools(bot, helpers);
  for (const spec of [
    'army:approve:abcdef01234567', 'army:ignore:abcdef01234567',
    'army:edit:title:abcdef01234567', 'army:delete-yes:abcdef01234567',
    'army:monitor', 'army:channels', 'army:channel:clear-yes:tg',
    'army:source:add', 'army:source:add-type:official', 'army:source:manage:MyChannel',
    'army:source:set-type:media:MyChannel', 'army:source:delete-yes:MyChannel',
  ]) {
    const row = handlers.find(([filter]) => filter instanceof RegExp ? filter.test(spec) : filter === spec);
    assert.ok(row, `registered callback: ${spec}`);
    const match = row[0] instanceof RegExp ? row[0].exec(spec) : null;
    await row[1]({ allowed: false, from: { id: 999 }, match, answerCallbackQuery: async () => { callbackAnswered = true; } });
  }
  assert.equal(callbackAnswered, true);
  assert.equal(screenChanges, 0, 'a non-owner cannot change an admin screen or action state');
});
