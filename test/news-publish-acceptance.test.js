import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-news-acceptance-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = '123456:LOCAL_TEST';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';
process.env.PUBLIC_URL = 'https://example.invalid';
process.env.ALERT_IMAGES = 'false';

const { store, publicAlert } = await import('../server/store.js');
await store.init(null);
const { buildAlertInput, createBot, channelKeyboard, channelPost, publishInput, BOT_ALERT_MENU_GROUPS, BOT_ALERT_MENU_DIRECT_TYPES, BOT_ALERT_MENU_PATROL_CHILD_TYPES } = await import('../server/bot.js');
const { BORDER_MARKERS, ALERT_TYPES, ALERT_GROUPS, POLITICAL_CATEGORIES } = await import('../shared/types.js');
const { NEWS_TYPES } = await import('../server/news-ai.js');
const { governorates } = await import('../server/places.js');
const { newsState, sendTestDraft, toBotDraft, _test: newsMonitorTest } = await import('../server/news-monitor.js');
const syriaBorder = JSON.parse(fs.readFileSync(new URL('../public/data/syria-border.geojson', import.meta.url), 'utf8'));

test('Syrian–Palestinian border alert pin lies on the actual Syria border geometry', () => {
  const ring = syriaBorder.features[0].geometry.coordinates[0];
  const pin = BORDER_MARKERS.palestine;
  const nearest = Math.min(...ring.map(([lon, lat]) => Math.hypot(lon - pin.lon, lat - pin.lat)));
  assert.ok(nearest < 0.001, `border pin should be on the mapped boundary; nearest vertex distance was ${nearest}`);
});

const ownerId = 8270709633;
const owner = { id: ownerId, is_bot: false, first_name: 'Local owner', language_code: 'ar' };
const reporter = { id: 8270709634, is_bot: false, first_name: 'Local reporter', language_code: 'ar' };
const bot = createBot();
bot.botInfo = { id: 1, is_bot: true, first_name: 'Local news test', username: 'LocalNewsTestBot' };
const reportBot = createBot({ role: 'report', token: '654321:LOCAL_REPORT_TEST' });
reportBot.botInfo = { id: 2, is_bot: true, first_name: 'Local report test', username: 'LocalReportTestBot' };
const calls = [];
let messageId = 1000;
bot.api.config.use(async (_previous, method, payload) => {
  calls.push({ method, chatId: payload?.chat_id, payload: structuredClone(payload || {}) });
  if (method === 'sendMessage') {
    return { ok: true, result: { message_id: ++messageId, chat: { id: payload.chat_id, type: [ownerId, reporter.id].includes(payload.chat_id) ? 'private' : 'channel' }, date: 0, text: payload.text || '' } };
  }
  if (method === 'editMessageText') {
    return { ok: true, result: { message_id: payload.message_id, chat: { id: payload.chat_id, type: 'private' }, date: 0, text: payload.text || '' } };
  }
  return { ok: true, result: true };
});
reportBot.api.config.use(async (_previous, method, payload) => {
  calls.push({ method, chatId: payload?.chat_id, payload: structuredClone(payload || {}) });
  if (method === 'sendMessage') return { ok: true, result: { message_id: ++messageId, chat: { id: payload.chat_id, type: 'private' }, date: 0, text: payload.text || '' } };
  if (method === 'editMessageText') return { ok: true, result: { message_id: payload.message_id, chat: { id: payload.chat_id, type: 'private' }, date: 0, text: payload.text || '' } };
  return { ok: true, result: true };
});

let updateId = 1;
const tap = async (data, user = owner, targetBot = bot) => targetBot.handleUpdate({
  update_id: updateId++,
  callback_query: {
    id: `local-${updateId}`,
    from: user,
    chat_instance: 'local',
    data,
    message: { message_id: 700, date: 0, chat: { id: user.id, type: 'private' }, from: targetBot.botInfo, text: 'Local test draft' },
  },
});
const sendText = async (text, user = owner, targetBot = bot) => targetBot.handleUpdate({
  update_id: updateId++,
  message: { message_id: ++messageId, date: 0, chat: { id: user.id, type: 'private' }, from: user, text },
});
const plainChannelText = (html) => String(html || '').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, String.fromCharCode(34));
const keyboardAfter = (start) => [...calls.slice(start)].reverse()
  .find(({ payload }) => Array.isArray(payload?.reply_markup?.inline_keyboard))?.payload.reply_markup.inline_keyboard || [];
const callbacksOf = (keyboard) => keyboard.flat().map((button) => button.callback_data).filter(Boolean);

test('home menu clears tracked private relay messages for this bot and chat only', async () => {
  store.convoAdd('admin', ownerId, 9101, 9102);
  store.convoAdd('report', reporter.id, 9103);
  const adminStart = calls.length;
  await tap('home', owner, bot);
  const adminDeletes = calls.slice(adminStart).filter(({ method }) => method === 'deleteMessage');
  assert.deepEqual(adminDeletes.map(({ chatId, payload }) => [chatId, payload.message_id]).sort((a, b) => a[1] - b[1]), [
    [ownerId, 9101], [ownerId, 9102],
  ]);
  const reportStart = calls.length;
  await tap('home', reporter, reportBot);
  const reportDeletes = calls.slice(reportStart).filter(({ method }) => method === 'deleteMessage');
  assert.deepEqual(reportDeletes.map(({ chatId, payload }) => [chatId, payload.message_id]), [[reporter.id, 9103]]);
});

test('report menus expose flight direction inside aerial activity, not as a standalone option', async () => {
  const routedTypes = [...BOT_ALERT_MENU_DIRECT_TYPES, ...BOT_ALERT_MENU_PATROL_CHILD_TYPES, ...Object.values(BOT_ALERT_MENU_GROUPS).flat()];
  assert.equal(new Set(routedTypes).size, routedTypes.length, 'each alert type has exactly one report-menu route');
  const reportableTypes = Object.keys(ALERT_TYPES);
  assert.deepEqual([...routedTypes].sort(), reportableTypes.sort(), 'all alert types, including movement, have a nested menu route');

  let start = calls.length;
  await tap('home');
  const topKeyboard = keyboardAfter(start);
  const top = callbacksOf(topKeyboard);
  for (const callback of ['t:breaking', 't:political', 't:signal_sweep', 'ag:aerial', 'target', 'ag:strikes', 'mi', 't:patrol', 'ag:protests', 'cv', 'sm', 'ag:nature', 't:border']) {
    assert.ok(top.includes(callback), `main menu includes ${callback}`);
  }
  assert.ok(topKeyboard.flat().some((button) => button.callback_data === 'ag:protests' && button.text?.includes('مظاهرة')), 'protest parent is labeled «مظاهرة»');
  assert.equal(top.includes('t:air_movement'), false, 'air movement is not a standalone top-level type');
  assert.equal(top.includes('t:kidnapping'), false, 'kidnapping stays nested under patrol rather than becoming a top-level option');
  start = calls.length;
  await tap('t:patrol');
  const patrolButtons = keyboardAfter(start).flat();
  assert.ok(patrolButtons.some((button) => button.callback_data === 'pt:singular' && button.text?.includes('دورية واحدة')), 'the existing single-patrol choice remains');
  assert.ok(patrolButtons.some((button) => button.callback_data === 'pt:plural' && button.text?.includes('عدة دوريات')), 'the existing multiple-patrol choice remains');
  assert.ok(patrolButtons.some((button) => button.callback_data === 't:kidnapping' && button.text?.includes('اختطاف')), 'the admin patrol submenu adds the kidnapping child');
  start = calls.length;
  await tap('t:kidnapping');
  const gov = governorates.find((item) => item.ar === 'حلب') || governorates[0];
  await tap(`g:${gov.code}`);
  await tap(`wg:${gov.code}`);
  await tap('skip');
  assert.match(keyboardAfter(start).flat().map((button) => button.callback_data).join(' '), /publish/, 'the admin flow reaches its normal publish review screen without publishing');
  assert.match([...calls.slice(start)].reverse().find(({ payload }) => payload?.text)?.payload.text || '', /اختطاف/, 'the admin draft retains the kidnapping label');
  await tap('cancel');
  start = calls.length;
  await tap('mi');
  assert.deepEqual(callbacksOf(keyboardAfter(start)).filter((value) => value.startsWith('mi:')).sort(), ['mi:barrier', 'mi:soldiers', 'mi:vehicles'], 'incursion menu offers soldiers, vehicle counts, and a barrier subtype');

  const menus = [
    ['ag:aerial', 'aerial'], ['target', 'targeting'], ['ag:strikes', 'strikes'],
    ['ag:protests', 'protests'], ['cv', 'civil'], ['sm', 'smuggling'], ['ag:nature', 'nature'],
  ];
  for (const [callback, group] of menus) {
    start = calls.length;
    await tap(callback);
    const childButtons = keyboardAfter(start).flat();
    const children = callbacksOf([childButtons]).filter((value) => value.startsWith('t:')).sort();
    assert.deepEqual(children, BOT_ALERT_MENU_GROUPS[group].map((type) => `t:${type}`).sort(), `${group} buttons route to their own alert types`);
    if (group === 'aerial') assert.ok(childButtons.some((button) => button.callback_data === 't:air_movement' && button.text?.includes('باتجاه')), 'aerial submenu labels the movement option as a direction toward Syria or a governorate');
    if (group === 'strikes') {
      assert.ok(childButtons.some((button) => button.callback_data === 't:explosion' && button.text === '💥 انفجار'), 'admin bot keeps the existing «انفجار» option');
      assert.ok(childButtons.some((button) => button.callback_data === 't:detonation' && button.text === '💥 تفجير'), 'admin bot exposes the distinct «تفجير» option');
    }
    if (group === 'protests') assert.deepEqual(childButtons.filter((button) => ['t:protest_action', 't:protest'].includes(button.callback_data)).map((button) => [button.callback_data, button.text]), [['t:protest_action', '📢 احتجاج'], ['t:protest', '👥 مظاهرة']]);
  }
});

test('public report bot exposes both strike types and sends detonation reports only to review', async (t) => {
  const publicReporter = { id: 8270709635, is_bot: false, first_name: 'Synthetic detonation reporter', language_code: 'ar' };
  const currentUi = () => [...calls].reverse().find(({ method }) => method === 'sendMessage' || method === 'editMessageText');
  const currentButtons = () => currentUi()?.payload?.reply_markup?.inline_keyboard?.flat() || [];
  const routedTypes = [...BOT_ALERT_MENU_DIRECT_TYPES, ...BOT_ALERT_MENU_PATROL_CHILD_TYPES, ...Object.values(BOT_ALERT_MENU_GROUPS).flat()];
  const reportableTypes = Object.keys(ALERT_TYPES);
  assert.deepEqual([...routedTypes].sort(), reportableTypes.sort(), 'the public menu routes movement inside aerial activity');

  let start = calls.length;
  await tap('home', publicReporter, reportBot);
  const topKeyboard = keyboardAfter(start);
  const top = callbacksOf(topKeyboard);
  for (const callback of ['t:breaking', 't:political', 't:signal_sweep', 'ag:aerial', 'target', 'ag:strikes', 'mi', 't:patrol', 'ag:protests', 'cv', 'sm', 'ag:nature', 't:border']) {
    assert.ok(top.includes(callback), `public main menu includes ${callback}`);
  }
  assert.ok(topKeyboard.flat().some((button) => button.callback_data === 'ag:protests' && button.text?.includes('مظاهرة')), 'public protest parent is labeled «مظاهرة»');
  assert.equal(top.includes('t:kidnapping'), false, 'public kidnapping choice stays under the patrol button');
  start = calls.length;
  await tap('t:patrol', publicReporter, reportBot);
  const patrolButtons = keyboardAfter(start).flat();
  assert.ok(patrolButtons.some((button) => button.callback_data === 'pt:singular' && button.text?.includes('دورية واحدة')), 'public patrol menu preserves single patrol');
  assert.ok(patrolButtons.some((button) => button.callback_data === 'pt:plural' && button.text?.includes('عدة دوريات')), 'public patrol menu preserves multiple patrols');
  assert.ok(patrolButtons.some((button) => button.callback_data === 't:kidnapping' && button.text?.includes('اختطاف')), 'public patrol menu exposes kidnapping');
  start = calls.length;
  await tap('mi', publicReporter, reportBot);
  assert.deepEqual(callbacksOf(keyboardAfter(start)).filter((value) => value.startsWith('mi:')).sort(), ['mi:barrier', 'mi:soldiers', 'mi:vehicles'], 'public incursion menu offers the barrier subtype');
  for (const adminOnly of ['active', 'clr', 'bd', 'editors', 'stats', 'nws', 'px', 'pwr', 'qk', 'wx', 'wxb']) {
    assert.equal(top.includes(adminOnly), false, `public bot does not expose admin action ${adminOnly}`);
  }

  const menus = [
    ['ag:aerial', 'aerial'], ['target', 'targeting'], ['ag:strikes', 'strikes'],
    ['ag:protests', 'protests'], ['cv', 'civil'], ['sm', 'smuggling'], ['ag:nature', 'nature'],
  ];
  for (const [callback, group] of menus) {
    start = calls.length;
    await tap(callback, publicReporter, reportBot);
    const childButtons = keyboardAfter(start).flat();
    const children = callbacksOf([childButtons]).filter((value) => value.startsWith('t:')).sort();
    assert.deepEqual(children, BOT_ALERT_MENU_GROUPS[group].map((type) => `t:${type}`).sort(), `public ${group} submenu routes every type`);
    if (group === 'strikes') {
      assert.ok(childButtons.some((button) => button.callback_data === 't:explosion' && button.text === '💥 انفجار'), 'public bot keeps the «انفجار» option');
      assert.ok(childButtons.some((button) => button.callback_data === 't:detonation' && button.text === '💥 تفجير'), 'public bot exposes the distinct «تفجير» option');
    }
    if (group === 'protests') assert.deepEqual(childButtons.filter((button) => ['t:protest_action', 't:protest'].includes(button.callback_data)).map((button) => [button.callback_data, button.text]), [['t:protest_action', '📢 احتجاج'], ['t:protest', '👥 مظاهرة']]);
  }

  const reportIdsBefore = new Set(Object.keys(store.state.reports || {}));
  const activeBefore = store.activeAlerts().length;
  start = calls.length;
  await tap('home', publicReporter, reportBot);
  await tap('ag:strikes', publicReporter, reportBot);
  assert.ok(currentButtons().some((button) => button.callback_data === 't:explosion' && button.text === '💥 انفجار'), 'explosion has its own public button');
  assert.ok(currentButtons().some((button) => button.callback_data === 't:detonation' && button.text === '💥 تفجير'), 'detonation has a separate public button');
  await tap('t:detonation', publicReporter, reportBot);
  const gov = governorates.find((item) => item.ar === 'حلب') || governorates[0];
  await tap(`g:${gov.code}`, publicReporter, reportBot);
  await tap(`wg:${gov.code}`, publicReporter, reportBot);
  await tap('skip', publicReporter, reportBot);
  assert.match(currentUi()?.payload?.text || '', /تفجير/, 'the public preview retains the dedicated detonation category label');
  assert.ok(currentButtons().some((button) => button.callback_data === 'submit'), 'the public flow offers submit-for-review, not publish');
  await tap('submit', publicReporter, reportBot);

  const rid = Object.keys(store.state.reports || {}).find((id) => !reportIdsBefore.has(id));
  assert.ok(rid, 'submission is saved as a pending report for editors');
  const pending = store.reportGet(rid);
  assert.equal(pending.draft.type, 'detonation');
  assert.equal(pending.draft.mode, 'report');
  assert.equal(store.activeAlerts().length, activeBefore, 'a public report is not auto-published to the map');
  assert.equal(calls.slice(start).some(({ method, chatId }) => method === 'sendMessage' && chatId === '@mock_news_channel'), false, 'a public report is not posted to the channel before review');
  t.after(async () => {
    store.reportTake(rid);
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
});

test('kidnapping child reports retain their type and wait for human review', async (t) => {
  const kidnappingReporter = { id: 8270709644, is_bot: false, first_name: 'Local kidnapping reporter', language_code: 'ar' };
  const reportIdsBefore = new Set(Object.keys(store.state.reports || {}));
  const activeBefore = store.activeAlerts().length;
  const start = calls.length;
  const currentUi = () => [...calls.slice(start)].reverse().find(({ method }) => method === 'sendMessage' || method === 'editMessageText');
  const currentButtons = () => currentUi()?.payload?.reply_markup?.inline_keyboard?.flat() || [];

  await tap('home', kidnappingReporter, reportBot);
  await tap('t:patrol', kidnappingReporter, reportBot);
  assert.ok(currentButtons().some((button) => button.callback_data === 't:kidnapping' && button.text?.includes('اختطاف')), 'kidnapping is nested inside the patrol menu');
  await tap('t:kidnapping', kidnappingReporter, reportBot);
  const gov = governorates.find((item) => item.ar === 'حلب') || governorates[0];
  await tap(`g:${gov.code}`, kidnappingReporter, reportBot);
  await tap(`wg:${gov.code}`, kidnappingReporter, reportBot);
  await tap('skip', kidnappingReporter, reportBot);
  assert.match(currentUi()?.payload?.text || '', /اختطاف/, 'the preview retains the dedicated kidnapping label');
  assert.ok(currentButtons().some((button) => button.callback_data === 'submit'), 'the public flow offers submission for review');
  assert.equal(currentButtons().some((button) => button.callback_data === 'publish'), false, 'the public flow has no direct publish action');
  await tap('submit', kidnappingReporter, reportBot);

  const rid = Object.keys(store.state.reports || {}).find((id) => !reportIdsBefore.has(id));
  assert.ok(rid, 'the synthetic kidnapping report is saved in the editor review queue');
  const pending = store.reportGet(rid);
  assert.equal(pending.draft.type, 'kidnapping');
  assert.equal(pending.draft.mode, 'report');
  const approvedBuild = buildAlertInput(pending.draft, pending.from);
  assert.equal(approvedBuild.type, 'kidnapping');
  assert.match(approvedBuild.title, /^اختطاف/);
  assert.match(approvedBuild.title_en, /^Kidnapping/);
  assert.equal(store.activeAlerts().length, activeBefore, 'submission does not publish to the map');
  assert.equal(calls.slice(start).some(({ method, chatId }) => method === 'sendMessage' && chatId === '@mock_news_channel'), false, 'submission does not post to the channel before review');
  t.after(async () => {
    store.reportTake(rid);
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
});

test('signal-sweep offers an optional drone marker and public submissions remain human-reviewed', async (t) => {
  const signalReporter = { id: 8270709645, is_bot: false, first_name: 'Local signal reporter', language_code: 'ar' };
  const adminStart = calls.length;
  const adminUi = () => [...calls.slice(adminStart)].reverse().find(({ method }) => method === 'sendMessage' || method === 'editMessageText');
  const adminButtons = () => adminUi()?.payload?.reply_markup?.inline_keyboard?.flat() || [];
  const activeBefore = store.activeAlerts().length;

  await tap('home', owner, bot);
  assert.ok(adminButtons().some((button) => button.callback_data === 't:signal_sweep'), 'signal sweep is directly available in the admin menu');
  await tap('t:signal_sweep', owner, bot);
  assert.ok(adminButtons().some((button) => button.callback_data === 'ss:uav' && button.text?.includes('مسيّرة')), 'admin can choose the drone marker');
  assert.ok(adminButtons().some((button) => button.callback_data === 'ss:none' && button.text?.includes('بدون تحديد')), 'admin can leave the platform unspecified');
  await tap('ss:none', owner, bot);
  const gov = governorates.find((item) => item.ar === 'حلب') || governorates[0];
  await tap(`g:${gov.code}`, owner, bot);
  await tap(`wg:${gov.code}`, owner, bot);
  await tap('skip', owner, bot);
  assert.match(adminUi()?.payload?.text || '', /رصد\/مسح الإشارة/, 'the admin preview keeps the distinct signal-sweep type');
  assert.doesNotMatch(adminUi()?.payload?.text || '', /مسيّرة/, 'no drone is inferred when the admin leaves the platform unspecified');
  assert.ok(adminButtons().some((button) => button.callback_data === 'publish'), 'the admin reaches the usual deliberate publish review step');
  assert.equal(store.activeAlerts().length, activeBefore, 'opening the admin preview does not publish');
  assert.equal(calls.slice(adminStart).some(({ method, chatId }) => method === 'sendMessage' && chatId === '@mock_news_channel'), false, 'the admin draft is not posted automatically');
  await tap('cancel', owner, bot);

  const reportIdsBefore = new Set(Object.keys(store.state.reports || {}));
  const publicStart = calls.length;
  const publicUi = () => [...calls.slice(publicStart)].reverse().find(({ method }) => method === 'sendMessage' || method === 'editMessageText');
  const publicButtons = () => publicUi()?.payload?.reply_markup?.inline_keyboard?.flat() || [];
  await tap('home', signalReporter, reportBot);
  assert.ok(publicButtons().some((button) => button.callback_data === 't:signal_sweep'), 'signal sweep is directly available in the public-report menu');
  await tap('t:signal_sweep', signalReporter, reportBot);
  assert.ok(publicButtons().some((button) => button.callback_data === 'ss:uav' && button.text?.includes('مسيّرة')), 'public reporter can explicitly select a drone');
  await tap('ss:uav', signalReporter, reportBot);
  await tap(`g:${gov.code}`, signalReporter, reportBot);
  await tap(`wg:${gov.code}`, signalReporter, reportBot);
  await tap('skip', signalReporter, reportBot);
  assert.match(publicUi()?.payload?.text || '', /رصد\/مسح الإشارة/, 'the public preview keeps the distinct event type');
  assert.match(publicUi()?.payload?.text || '', /مسيّرة/, 'the drone label appears only after explicit selection');
  assert.ok(publicButtons().some((button) => button.callback_data === 'submit'), 'the public flow submits for review');
  assert.equal(publicButtons().some((button) => button.callback_data === 'publish'), false, 'the public flow never offers direct publishing');
  await tap('submit', signalReporter, reportBot);

  const rid = Object.keys(store.state.reports || {}).find((id) => !reportIdsBefore.has(id));
  assert.ok(rid, 'the synthetic signal report is saved for review');
  const pending = store.reportGet(rid);
  assert.equal(pending.draft.type, 'signal_sweep');
  assert.equal(pending.draft.mode, 'report');
  assert.equal(pending.draft.signalPlatform, 'uav', 'the explicit platform choice reaches the pending report');
  const approvedBuild = buildAlertInput(pending.draft, pending.from);
  assert.equal(approvedBuild.type, 'signal_sweep');
  assert.equal(approvedBuild.meta?.signalPlatform, 'uav');
  assert.match(approvedBuild.title, /مسيّرة/);
  assert.equal(publicAlert(approvedBuild).signal_platform, 'uav', 'only the selected platform is exposed to map clients');
  const unspecifiedBuild = buildAlertInput({ type: 'signal_sweep', location: { scope: 'country' }, extra: [], ttlMin: 60 }, { id: ownerId, name: 'test' });
  assert.equal(unspecifiedBuild.meta, undefined, 'an unspecified signal report stores no inferred platform');
  assert.equal(store.activeAlerts().length, activeBefore, 'submission does not publish to the map');
  assert.equal(calls.slice(publicStart).some(({ method, chatId }) => method === 'sendMessage' && chatId === '@mock_news_channel'), false, 'submission does not post to the channel before review');
  t.after(async () => {
    store.reportTake(rid);
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
});

test('public protest-action reports are saved for human review, not auto-published', async (t) => {
  const protestReporter = { id: 8270709638, is_bot: false, first_name: 'Local protest reporter', language_code: 'ar' };
  assert.equal(NEWS_TYPES.includes('protest_action'), false, 'public protest reports do not enter the automatic news-publishing pipeline');
  const reportIdsBefore = new Set(Object.keys(store.state.reports || {}));
  const activeBefore = store.activeAlerts().length;
  const start = calls.length;
  const currentUi = () => [...calls.slice(start)].reverse().find(({ method }) => method === 'sendMessage' || method === 'editMessageText');
  const currentButtons = () => currentUi()?.payload?.reply_markup?.inline_keyboard?.flat() || [];

  await tap('home', protestReporter, reportBot);
  await tap('ag:protests', protestReporter, reportBot);
  assert.ok(currentButtons().some((button) => button.callback_data === 't:protest_action' && button.text?.includes('احتجاج')));
  await tap('t:protest_action', protestReporter, reportBot);
  const gov = governorates.find((item) => item.ar === 'حلب') || governorates[0];
  await tap(`g:${gov.code}`, protestReporter, reportBot);
  await tap(`wg:${gov.code}`, protestReporter, reportBot);
  await tap('skip', protestReporter, reportBot);
  assert.match(currentUi()?.payload?.text || '', /احتجاج/, 'the public preview retains the selected report label');
  assert.ok(currentButtons().some((button) => button.callback_data === 'submit'), 'the report offers submission for review');
  assert.equal(currentButtons().some((button) => button.callback_data === 'publish'), false, 'the public flow has no publish action');
  await tap('submit', protestReporter, reportBot);

  const rid = Object.keys(store.state.reports || {}).find((id) => !reportIdsBefore.has(id));
  assert.ok(rid, 'the report is saved to the pending review queue');
  assert.equal(store.reportGet(rid).draft.type, 'protest_action');
  assert.equal(store.reportGet(rid).draft.mode, 'report');
  assert.equal(store.activeAlerts().length, activeBefore, 'the public report is not auto-published to the map');
  assert.equal(calls.slice(start).some(({ method, chatId }) => method === 'sendMessage' && chatId === '@mock_news_channel'), false, 'the public report is not posted to the channel before review');
  t.after(async () => {
    store.reportTake(rid);
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
});

test('public barrier reports retain the incursion type and wait for human review', async (t) => {
  const barrierReporter = { id: 8270709639, is_bot: false, first_name: 'Local barrier reporter', language_code: 'ar' };
  const reportIdsBefore = new Set(Object.keys(store.state.reports || {}));
  const activeBefore = store.activeAlerts().length;
  const start = calls.length;
  const currentUi = () => [...calls.slice(start)].reverse().find(({ method }) => method === 'sendMessage' || method === 'editMessageText');
  const currentButtons = () => currentUi()?.payload?.reply_markup?.inline_keyboard?.flat() || [];

  await tap('home', barrierReporter, reportBot);
  await tap('mi', barrierReporter, reportBot);
  const barrierButton = currentButtons().find((button) => button.callback_data === 'mi:barrier');
  assert.ok(barrierButton?.text?.includes('حاجز'), 'the public incursion submenu exposes «حاجز»');
  await tap('mi:barrier', barrierReporter, reportBot);
  assert.match(currentUi()?.payload?.text || '', /حاجز عسكري/, 'barrier is retained as the chosen subtype while reporting');
  assert.equal(currentButtons().some((button) => button.callback_data === 'publish'), false, 'the public report flow has no direct publish action');
  const gov = governorates.find((item) => item.ar === 'حلب') || governorates[0];
  await tap(`g:${gov.code}`, barrierReporter, reportBot);
  await tap(`wg:${gov.code}`, barrierReporter, reportBot);
  await tap('skip', barrierReporter, reportBot);
  assert.match(currentUi()?.payload?.text || '', /حاجز عسكري/, 'the report preview keeps the barrier label');
  await tap('submit', barrierReporter, reportBot);

  const rid = Object.keys(store.state.reports || {}).find((id) => !reportIdsBefore.has(id));
  assert.ok(rid, 'the synthetic report is saved to the editor review queue');
  const pending = store.reportGet(rid);
  assert.equal(pending.draft.type, 'military_incursion');
  assert.equal(pending.draft.incursionKind, 'barrier');
  assert.equal(pending.draft.mode, 'report');
  const approvedBuild = buildAlertInput(pending.draft, pending.from);
  assert.equal(approvedBuild.type, 'military_incursion');
  assert.equal(approvedBuild.meta.incursionKind, 'barrier');
  assert.match(approvedBuild.title, /حاجز عسكري/);
  assert.match(approvedBuild.title_en, /Military checkpoint/);
  assert.match(plainChannelText(channelPost({ ...approvedBuild, place: approvedBuild.location, timestamp: new Date().toISOString() })), /حاجز عسكري/, 'the regular channel post is correctly titled without sending it');
  const projection = publicAlert({ id: 'synthetic-barrier', type: 'military_incursion', meta: { incursionKind: 'barrier' }, place: {}, extra: [] });
  assert.equal(projection.incursion_kind, 'barrier', 'the public map receives only the validated subtype needed for its icon');
  assert.equal(Object.hasOwn(projection, 'meta'), false, 'internal alert metadata is not exposed');
  assert.equal(store.activeAlerts().length, activeBefore, 'a public barrier report is not auto-published to the map');
  assert.equal(calls.slice(start).some(({ method, chatId }) => method === 'sendMessage' && chatId === '@mock_news_channel'), false, 'a public barrier report is not posted to the channel before review');
  t.after(async () => {
    store.reportTake(rid);
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
});

test('news-monitor type editor covers every bot alert type while settings stay monitor-only', async (t) => {
  const { id } = await sendTestDraft(ownerId);
  const untouched = await sendTestDraft(ownerId);
  const untouchedType = newsState().drafts[untouched.id].type;
  t.after(() => { delete newsState().drafts[id]; delete newsState().drafts[untouched.id]; });

  let start = calls.length;
  const storyButtons = newsMonitorTest.cardKb(newsState().drafts[id], 'ar').inline_keyboard.flat();
  assert.ok(storyButtons.some((button) => button.callback_data === `nw:t:${id}` && button.text === '🏷 تغيير نوع هذا الخبر'), 'type change starts from the selected monitored story card');
  assert.equal(storyButtons.some((button) => button.callback_data === `nw:t:${untouched.id}`), false, 'the selected story card cannot redirect the type edit to another draft');
  await tap(`nw:t:${id}`);
  const rootCallbacks = callbacksOf(keyboardAfter(start));
  const groups = Object.keys(newsMonitorTest.editableTypeGroups);
  const groupCallbacks = rootCallbacks.filter((value) => value.startsWith(`nw:tg:${id}:`));
  const directTypeCallbacks = rootCallbacks.filter((value) => value.startsWith(`nw:s:${id}:`));
  assert.deepEqual(groupCallbacks.sort(), groups.map((group) => `nw:tg:${id}:${group}`).sort(), 'the editor root exposes every bot type group');
  assert.deepEqual(directTypeCallbacks.sort(), newsMonitorTest.editableTypeDirectTypes.map((type) => `nw:s:${id}:${type}`).sort(), 'direct bot menu types remain one-tap choices');
  const routedTypes = [...newsMonitorTest.editableTypeDirectTypes, ...Object.values(newsMonitorTest.editableTypeGroups).flat()];
  assert.equal(new Set(routedTypes).size, routedTypes.length, 'the type editor has no duplicate category routes');
  assert.deepEqual([...routedTypes].sort(), Object.keys(ALERT_TYPES).sort(), 'the editor covers the complete shared alert registry, not just automatic news types');
  for (const group of groups) {
    start = calls.length;
    await tap(`nw:tg:${id}:${group}`);
    const childKeyboard = keyboardAfter(start);
    const childCallbacks = callbacksOf(childKeyboard);
    if (group === 'incursion') {
      assert.deepEqual(childCallbacks.filter((value) => value.startsWith(`nw:si:${id}:`)).sort(), newsMonitorTest.incursionTypeChoices.map(({ kind }) => `nw:si:${id}:${kind}`).sort(), 'incursion editing exposes the general, soldier, vehicle, and barrier choices');
      assert.ok(childKeyboard.flat().some((button) => button.callback_data === `nw:si:${id}:barrier` && button.text?.includes('حاجز')), 'the editor labels the barrier choice clearly');
    } else {
      assert.deepEqual(childCallbacks.filter((value) => value.startsWith(`nw:s:${id}:`)).sort(), newsMonitorTest.editableTypeGroups[group].map((type) => `nw:s:${id}:${type}`).sort(), `${group} exposes every bot alert type assigned to it`);
    }
    if (group === 'strikes') {
      assert.ok(childKeyboard.flat().some((button) => button.callback_data === `nw:s:${id}:explosion` && button.text === '💥 انفجار'), 'the monitored-news editor keeps «انفجار»');
      assert.ok(childKeyboard.flat().some((button) => button.callback_data === `nw:s:${id}:detonation` && button.text === '💥 تفجير'), 'the monitored-news editor exposes the separate «تفجير» type');
    }
  }

  start = calls.length;
  await tap('nws:ty');
  const settingGroups = callbacksOf(keyboardAfter(start)).filter((value) => value.startsWith('nws:tg:')).map((value) => value.split(':').at(-1));
  const watchedTypeCallbacks = [];
  for (const group of settingGroups) {
    start = calls.length;
    await tap(`nws:tg:${group}`);
    watchedTypeCallbacks.push(...callbacksOf(keyboardAfter(start)).filter((value) => value.startsWith('nws:tt:')));
  }
  assert.deepEqual(watchedTypeCallbacks.sort(), NEWS_TYPES.map((type) => `nws:tt:${type}`).sort(), 'monitor settings expose every watched type under its group');
  assert.equal(NEWS_TYPES.includes('detonation'), false, 'the new type is not added to automatic news classification');

  await tap(`nw:tg:${id}:aerial`);
  await tap(`nw:s:${id}:helicopter`);
  assert.equal(newsState().drafts[id].type, 'helicopter', 'the selected button stores the exact category key on the local test draft');
  await tap(`nw:s:${id}:patrol`);
  assert.equal(newsState().drafts[id].type, 'patrol', 'patrol is a direct bot category in the editor');
  start = calls.length;
  await tap(`nw:s:${id}:signal_sweep`);
  const signalDraft = newsState().drafts[id];
  assert.equal(signalDraft.type, 'signal_sweep', 'the editor can reclassify a draft as signal sweep');
  assert.equal(signalDraft.status, 'pending', 'signal-sweep reclassification remains in human review');
  assert.equal(NEWS_TYPES.includes('signal_sweep'), false, 'signal-sweep never enters automatic news classification');
  assert.equal(calls.slice(start).some(({ method, chatId }) => method === 'sendMessage' && chatId === '@mock_news_channel'), false, 'signal-sweep reclassification never posts automatically');
  start = calls.length;
  await tap(`nw:tg:${id}:strikes`);
  assert.ok(keyboardAfter(start).flat().some((button) => button.callback_data === `nw:s:${id}:explosion` && button.text === '💥 انفجار'), 'the selected story’s strike menu keeps explosion');
  assert.ok(keyboardAfter(start).flat().some((button) => button.callback_data === `nw:s:${id}:detonation` && button.text === '💥 تفجير'), 'the selected story’s strike menu offers detonation');
  await tap(`nw:s:${id}:detonation`);
  const detonationDraft = newsState().drafts[id];
  assert.equal(detonationDraft.type, 'detonation', 'the selected monitored story changes to the distinct detonation type');
  assert.equal(detonationDraft.status, 'pending', 'reclassifying detonation leaves the story for human review');
  assert.equal(NEWS_TYPES.includes('detonation'), false, 'detonation remains unavailable to automatic news classification');
  assert.equal(newsState().drafts[untouched.id].type, untouchedType, 'the other monitored draft is unchanged');
  assert.equal(calls.slice(start).some(({ method, chatId }) => method === 'sendMessage' && chatId === '@mock_news_channel'), false, 'changing a monitored story to detonation never auto-publishes it');
  start = calls.length;
  await tap(`nw:tg:${id}:incursion`);
  await tap(`nw:si:${id}:barrier`);
  const barrierDraft = newsState().drafts[id];
  assert.equal(barrierDraft.type, 'military_incursion');
  assert.equal(barrierDraft.incursionKind, 'barrier');
  assert.equal(barrierDraft.status, 'pending', 'changing the category leaves the draft in human review');
  assert.match(newsMonitorTest.cardText(barrierDraft, 'ar'), /حاجز/);
  const convertedBarrier = toBotDraft(barrierDraft);
  assert.equal(convertedBarrier.type, 'military_incursion');
  assert.equal(convertedBarrier.incursionKind, 'barrier', 'the selected subtype reaches the normal owner publish preview');
  assert.equal(calls.slice(start).some(({ method, chatId }) => method === 'sendMessage' && chatId === '@mock_news_channel'), false, 'reclassifying a draft never auto-publishes it');
  const pluralPatrol = toBotDraft({ type: 'patrol', headline: 'رصد دوريات عسكرية في محيط بلدة كودنة' });
  assert.equal(pluralPatrol.patrolForm, 'plural', 'the monitoring draft preserves plural patrol wording for the map title');
  assert.equal(toBotDraft({ type: 'patrol', headline: 'رصد دورية عسكرية قرب كودنة' }).patrolForm, 'singular');
});

test('only admins can reclassify an auto-published news alert in place', async (t) => {
  const alert = store.addAlert({
    type: 'uav', title: 'نشاط طائرات مسيّرة — دمشق', title_en: 'Drone activity — Damascus',
    description: 'خبر تجريبي منشور', location: { scope: 'place', name_ar: 'دمشق', name_en: 'Damascus', latitude: 33.5138, longitude: 36.2765 },
    ttlMin: 60, source: 'news',
  });
  store.updateAlert(alert.id, { channel_message_id: 9911, channel_media: 'text', channel_format: 2 });
  const id = 'publishedTypeAdminOnly';
  const draft = newsState().drafts[id] = {
    id, type: 'uav', status: 'published', auto: true, autoMode: 'day', autoAt: Date.now(),
    alertId: alert.id, postId: 9911, headline: 'خبر تجريبي منشور', loc: alert.place, extra: [], srcs: [],
    notices: [[ownerId, 7701]],
  };
  t.after(() => { delete newsState().drafts[id]; store.deleteAlert(alert.id); });

  assert.ok(newsMonitorTest.noticeKb(draft, 'ar').inline_keyboard.flat().some((button) => button.callback_data === `nw:pt:${id}`), 'auto-published notice offers a type editor');
  let start = calls.length;
  await tap(`nw:pt:${id}`, reporter);
  assert.equal(store.getAlert(alert.id).type, 'uav', 'non-admin tap cannot reclassify the published alert');
  assert.equal(calls.slice(start).some(({ method, chatId }) => method === 'editMessageText' && chatId === '@mock_news_channel'), false, 'non-admin cannot trigger a channel edit');

  start = calls.length;
  await tap(`nw:pt:${id}`, owner);
  assert.ok(callbacksOf(keyboardAfter(start)).includes(`nwp:s:${id}:breaking`), 'admin opens the published-story type menu');
  start = calls.length;
  await tap(`nwp:s:${id}:breaking`, owner);
  assert.equal(store.getAlert(alert.id).type, 'breaking', 'the live alert changes type');
  assert.equal(draft.type, 'breaking', 'the persistent news record follows the live alert');
  const channelEdit = calls.slice(start).find(({ method, chatId }) => method === 'editMessageText' && chatId === '@mock_news_channel');
  assert.ok(channelEdit, 'the existing channel message is edited, not reposted');
  assert.match(channelEdit.payload.text, /عاجل/, 'the existing channel post receives the corrected type label');
  assert.equal(calls.slice(start).some(({ method, chatId }) => method === 'sendMessage' && chatId === '@mock_news_channel'), false, 'reclassification never creates a duplicate post');
});

test('every monitored alert type builds, and accepting the same mock draft twice posts once', async (t) => {
  const addedAlertIds = [];
  const pendingReportIds = [];
  const draftId = 'a1b2c3d4e5';
  t.after(async () => {
    delete newsState().drafts[draftId];
    for (const id of addedAlertIds) store.deleteAlert(id);
    for (const rid of pendingReportIds) store.reportTake(rid);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  for (const type of NEWS_TYPES) {
    const input = buildAlertInput({ type, location: { scope: 'country' }, extra: [], ttlMin: 60 }, { id: ownerId, name: 'test' });
    assert.ok(input.title, `${type} must have a publish title`);
    assert.ok(input.title_en, `${type} must have an English publish title`);
  }
  assert.ok(ALERT_TYPES.military_incursion, 'military vehicle incursion is a registered manual alert type');
  assert.ok(ALERT_GROUPS.other.types.includes('military_incursion'), 'the new type is filterable on the map');
  assert.equal(NEWS_TYPES.includes('military_incursion'), false, 'manual vehicle-incursion reports stay out of automatic news classification');
  const shootingAlert = store.addAlert(buildAlertInput({ type: 'shooting', location: { scope: 'country' }, extra: [], ttlMin: 60 }, { id: ownerId, name: 'test' }));
  addedAlertIds.push(shootingAlert.id);
  const shootingPost = channelPost(shootingAlert);
  assert.match(shootingPost, /<b>إطلاق نار<\/b>/);
  assert.doesNotMatch(shootingPost, /🎯|🔊|🔫|إطلاق نار<\/b> -/);
  const assassinationAlert = store.addAlert(buildAlertInput({ type: 'assassination', location: { scope: 'country' }, extra: [], ttlMin: 60 }, { id: ownerId, name: 'test' }));
  addedAlertIds.push(assassinationAlert.id);
  const assassinationPost = channelPost(assassinationAlert);
  assert.match(assassinationPost, /اغتيال/);
  assert.doesNotMatch(assassinationPost, /🎯|🔊|🔫|اغتيال<\/b> -/);
  const socialRow = channelKeyboard({ id: 'test-social-buttons' }).inline_keyboard.find((row) => row.some((button) => button.url?.includes('/boost/')));
  assert.equal(socialRow?.length, 1, 'only the Telegram boost button remains in the footer');
  assert.equal(socialRow[0].url, 'https://t.me/boost/Red_Alert_Syria');
  const legacyHeader = channelPost({ type: 'breaking', timestamp: new Date().toISOString(), place: { scope: 'country' } });
  assert.match(legacyHeader, /^<b>خبر عاجل<\/b> - 🚨/, 'an already-published alert keeps the legacy header by default');
  assert.doesNotMatch(legacyHeader, /🔴/, 'existing channel posts are not reformatted retroactively');
  const futureBreaking = channelPost({ type: 'breaking', channel_format: 2, timestamp: new Date().toISOString(), place: { scope: 'country' } });
  assert.match(futureBreaking, /^🔴 <b>خبر عاجل<\/b> - 🚨/, 'new breaking posts lead with the red category dot and retain one event symbol');
  const futureWeather = channelPost({ type: 'weather', channel_format: 2, timestamp: new Date().toISOString(), meta: { hazard: 'snow' }, place: { scope: 'country' } });
  assert.match(futureWeather, /^🟣 <b>تحذير جوي<\/b> - ❄️/, 'weather uses the purple dot and the report-specific hazard symbol');
  const meetingInLebanon = channelPost({
    type: 'political', channel_format: 2, title: 'زيارة رسمية', description: 'زيارة رسمية إلى لبنان',
    timestamp: new Date().toISOString(), meta: { political: { category: 'meeting' } }, place: { scope: 'country' },
  });
  assert.match(meetingInLebanon, /^🟡 <b>تطور سياسي<\/b> - 🇱🇧/, 'a meeting gets a country flag only when the country is named in the report');
  const meetingOnlyInDamascus = channelPost({
    type: 'political', channel_format: 2, title: 'لقاء رسمي', description: 'لقاء مسؤولين سوريين في دمشق',
    timestamp: new Date().toISOString(), meta: { political: { category: 'meeting' } }, place: { scope: 'country' },
  });
  assert.match(meetingOnlyInDamascus, /^🟡 <b>تطور سياسي<\/b> - 👥/, 'a city name or Syrian demonym does not trigger an inferred flag');
  const meetingBetweenCountries = channelPost({
    type: 'political', channel_format: 2, title: 'لقاء أردني لبناني', description: 'Meeting between Jordanian and Lebanese officials',
    timestamp: new Date().toISOString(), meta: { political: { category: 'meeting' } }, place: { scope: 'country' },
  });
  assert.match(meetingBetweenCountries, /^🟡 <b>تطور سياسي<\/b> - 👥/, 'nationalities without a named country do not trigger a flag');
  const channelText = channelPost({
    id: 'test-channel-footer', type: 'warplane', timestamp: new Date().toISOString(),
    place: { scope: 'place', name_ar: 'صمدانية شرقية', name_en: 'Samdaniyah Sharqiyah', governorate_ar: 'القنيطرة', governorate_en: 'Quneitra' }, extra: [],
  });
  assert.match(channelText, /تحليق طيران حربي/);
  assert.match(channelText, /📍<b>صمدانية شرقية/);
  assert.match(channelText, /📍<b>صمدانية شرقية[\s\S]*?<\/b>\n\nتاريخ :/);
  assert.match(channelText, /تاريخ :  [^\n]+\n\nالساعة :/);
  assert.doesNotMatch(channelText, /الخريطة المباشرة|Red Alert Syria/);
  const monitoredInput = buildAlertInput({
    type: 'attack', source: 'news', srcs: [{ name: 'مصادر محلية', url: 'https://news.example/story' }],
    location: { scope: 'country' }, extra: [], ttlMin: 60, details: 'تفاصيل الخبر',
  }, { id: ownerId, name: 'test' });
  const monitoredPost = channelPost({ ...monitoredInput, id: 'test-monitored-source', timestamp: new Date().toISOString(), place: { scope: 'country' } });
  assert.match(monitoredPost, /🔎 <b>المصدر:<\/b> مصادر محلية/);
  assert.doesNotMatch(monitoredPost, /<a\b|href=/, 'source is plain text with no clickable channel URL');
  assert.doesNotMatch(monitoredPost, /<b>المصدر:<\/b>[^\n]*هجوم/);
  assert.deepEqual(monitoredInput.meta.newsSources.map(({ name, url }) => ({ name, url })), [{ name: 'مصادر محلية', url: 'https://news.example/story' }]);
  const endedText = channelPost({
    id: 'test-channel-ended', type: 'warplane', timestamp: '2026-10-30T20:40:00.000Z', ended_at: '2026-10-30T20:55:00.000Z',
    place: { scope: 'place', name_ar: 'صمدانية شرقية', name_en: 'Samdaniyah Sharqiyah', governorate_ar: 'القنيطرة', governorate_en: 'Quneitra' }, extra: [],
  }, { ended: true });
  assert.match(endedText, /✅ انتهى/);
  assert.match(endedText, /الساعة :  [^\n]+\n\nانتهى :/);
  assert.ok(channelKeyboard({ id: 'test-channel-footer' }).inline_keyboard.flat().some((button) => button.text?.includes('عرض على الخريطة')));

  const simulatedPosts = [];
  const publishedFuture = await publishInput({
    sendMessage: async (chatId, text, options) => {
      simulatedPosts.push({ chatId, text, options });
      return { message_id: ++messageId };
    },
  }, { type: 'breaking', title: 'خبر تجريبي', title_en: 'Synthetic breaking news', description: 'اختبار اصطناعي', location: { scope: 'country' }, extra: [], ttlMin: 60, source: 'telegram' });
  addedAlertIds.push(publishedFuture.id);
  assert.equal(publishedFuture.channel_format, 2, 'the new template version persists with the new alert');
  assert.equal(simulatedPosts.length, 1, 'the publishing path calls only the local fake Telegram API');
  assert.match(simulatedPosts[0].text, /^🔴 /, 'the normal publishing-bot path sends the new category header');

  const lastUi = () => [...calls].reverse().find(({ method }) => method === 'sendMessage' || method === 'editMessageText');
  const buttons = () => lastUi()?.payload?.reply_markup?.inline_keyboard?.flat() || [];
  const politicalIdlib = governorates.find((g) => g.ar === 'إدلب');
  assert.ok(politicalIdlib, 'Idlib governorate is available for the political location flow');
  await tap('home');
  assert.ok(buttons().some((button) => button.callback_data === 't:political'), 'political development is present in the publishing bot main menu');
  await tap('t:political');
  assert.deepEqual(buttons().filter((button) => button.callback_data?.startsWith('pcat:')).map((button) => button.callback_data.slice(5)), Object.keys(POLITICAL_CATEGORIES));
  await tap('pcat:invalid');
  assert.ok(buttons().some((button) => button.callback_data === 'pcat:statement'), 'an invalid category callback leaves the category picker active');
  await tap('pcat:government_announcement');
  assert.ok(buttons().some((button) => button.callback_data === 'pol:general'), 'general political news is offered as the default no-pin option');
  assert.ok(buttons().some((button) => button.callback_data === 'pol:location'), 'a confirmed location can be selected explicitly');
  await tap('pol:general');
  await sendText('بيان رسمي https://news.example/politics');
  assert.match(lastUi().payload.text, /موقع غير محدد — دون دبوس/);
  assert.match(lastUi().payload.text, /الرأي أو التحليل ليس خبراً/);
  assert.match(lastUi().payload.text, /الفئة:<\/b> إعلان حكومي/);
  const politicalNewsDate = '2026-10-30T19:20:00.000Z';
  const attributedInput = buildAlertInput({
    type: 'political', politicalCategory: 'negotiation', location: { scope: 'country', latitude: null, longitude: null },
    details: 'اتفاق معلن https://details.example/story', extra: [], ttlMin: 360,
    politicalSources: [
      { name: '<Official source>', url: 'https://official.example/news', timestamp: politicalNewsDate },
      { name: 'unsafe protocol', url: 'javascript:alert(1)', timestamp: politicalNewsDate },
      { name: 'bad date', url: 'https://bad-date.example/item', timestamp: 'not-a-date' },
    ], politicalSourceTimestamp: politicalNewsDate,
  }, { id: ownerId, name: 'test' });
  assert.deepEqual(attributedInput.meta.political, {
    category: 'negotiation',
    sources: [{ name: '<Official source>', url: 'https://official.example/news', timestamp: politicalNewsDate }],
    sourceTimestamp: politicalNewsDate,
  });
  assert.equal(attributedInput.location.scope, 'country');
  assert.equal(attributedInput.location.latitude, null, 'political general news has no fabricated latitude');
  assert.equal(attributedInput.location.longitude, null, 'political general news has no fabricated longitude');
  assert.equal(attributedInput.timestamp, undefined, 'a source publication date never becomes the alert timestamp');
  const politicalAlert = store.addAlert(attributedInput);
  addedAlertIds.push(politicalAlert.id);
  const politicalPost = channelPost(politicalAlert);
  assert.match(politicalPost, /📍 <b>الموقع:<\/b> غير محدد — دون دبوس/);
  assert.match(politicalPost, /الفئة:<\/b> 🤝 «مفاوضات»/);
  assert.match(politicalPost, /📅 <b>التاريخ:<\/b>/);
  assert.match(politicalPost, /🕒 <b>الوقت:<\/b>/);
  const decisionAlert = store.addAlert(buildAlertInput({
    type: 'political', politicalCategory: 'decision',
    location: { scope: 'country', latitude: null, longitude: null },
    details: 'وزارة المالية تصدر قراراً بالحجز الاحتياطي على الأموال.', extra: [], ttlMin: 360,
  }, { id: ownerId, name: 'test' }));
  addedAlertIds.push(decisionAlert.id);
  const decisionPost = channelPost(decisionAlert);
  assert.match(decisionPost, /الفئة:<\/b> 📜 «قرار»\n/);
  assert.doesNotMatch(decisionPost, /قرار أو تعيين/, 'the public category uses the event-specific label, not the broad bot button label');
  assert.doesNotMatch(politicalPost, /🔎 <b>المصدر:<\/b>|&lt;Official source&gt;|تاريخ المصدر/, 'political source names and citations stay out of public channel posts');
  assert.doesNotMatch(politicalPost, /<a\b|href=/, 'political source is plain text with no clickable link');
  assert.match(politicalPost, /منقول بحسب المصدر؛ لم يُسجّل تحقق مستقل/);
  assert.deepEqual(politicalAlert.meta.political.sources, [{ name: '<Official source>', url: 'https://official.example/news', timestamp: politicalNewsDate }], 'source metadata remains stored on the alert');
  const politicalReviewCard = newsMonitorTest.cardText({
    id: 'test-political-review-source', type: 'political', politicalCategory: 'negotiation',
    loc: { scope: 'place', name_ar: 'دوما', governorate_ar: 'ريف دمشق' }, extra: [], headline: 'اتفاق معلن',
    srcs: [{ u: 'official-news', name: '<Official source>', url: 'https://official.example/news' }],
    ts: Date.parse(politicalNewsDate), created: Date.parse(politicalNewsDate),
  }, 'ar');
  assert.match(politicalReviewCard, /&lt;Official source&gt;/, 'reviewers can still see the safely escaped source name');
  assert.match(politicalReviewCard, /href="https:\/\/official\.example\/news"/, 'reviewers retain the source link for credibility checks');
  const detailSourceInput = buildAlertInput({
    type: 'political', politicalCategory: 'statement', location: { scope: 'country', latitude: null, longitude: null },
    details: 'رابط يدوي https://manual.example/report', extra: [], ttlMin: 360,
  }, { id: ownerId, name: 'test' });
  assert.equal(detailSourceInput.meta.political.sources.length, 1, 'one HTTP(S) link in details can supply a manual source');
  assert.equal(detailSourceInput.meta.political.sources[0].url, 'https://manual.example/report');
  const javascriptInput = buildAlertInput({
    type: 'political', politicalCategory: 'invalid-category', location: { scope: 'country', latitude: null, longitude: null },
    details: 'javascript:alert(1)', politicalSources: [{ name: 'bad', url: 'javascript:alert(1)' }],
    politicalSourceTimestamp: 'javascript:date', extra: [], ttlMin: 360,
  }, { id: ownerId, name: 'test' });
  assert.equal(javascriptInput.meta.political.category, null, 'unknown category keys are rejected');
  assert.deepEqual(javascriptInput.meta.political.sources, [], 'javascript URLs are never accepted as sources');
  assert.equal(javascriptInput.meta.political.sourceTimestamp, null, 'invalid source dates are rejected');

  await tap('home', reporter, reportBot);
  assert.ok(buttons().some((button) => button.callback_data === 't:political'), 'political development is present in the public report bot main menu');
  await tap('t:political', reporter, reportBot);
  assert.ok(buttons().some((button) => button.callback_data === 'pcat:election'), 'the public report bot offers political categories');
  await tap('pcat:invalid', reporter, reportBot);
  assert.ok(buttons().some((button) => button.callback_data === 'pcat:meeting'), 'invalid public-bot category callbacks do not advance');
  await tap('pcat:official_announcement', reporter, reportBot);
  await tap('pol:location', reporter, reportBot);
  assert.ok(buttons().some((button) => button.callback_data === 'pol:nopin'), 'location picker still permits an explicit no-pin choice');
  await tap(`g:${politicalIdlib.code}`, reporter, reportBot);
  await tap(`wg:${politicalIdlib.code}`, reporter, reportBot);
  await tap('skip', reporter, reportBot);
  assert.match(lastUi().payload.text, /الفئة:<\/b> إعلان رسمي/);
  assert.match(lastUi().payload.text, /إدلب/);
  assert.doesNotMatch(lastUi().payload.text, /No verified location|موقع غير محدد — دون دبوس/);
  await tap('home', reporter, reportBot);
  const reportRoot = buttons();
  assert.ok(reportRoot.some((button) => button.callback_data === 'ag:aerial'));
  assert.ok(reportRoot.some((button) => button.callback_data === 'ag:strikes'));
  assert.ok(buttons().some((button) => button.callback_data === 'mi' && button.text?.endsWith('توغل عسكري')));
  assert.ok(buttons().some((button) => button.callback_data === 'cv' && button.text?.startsWith('🛡️ مدني')));
  assert.equal(buttons().some((button) => ['t:civil', 't:accident', 't:fire', 't:protest', 't:protest_action', 't:civil_plane', 't:arrest', 't:death', 't:martyrdom', 't:brawl', 't:shooting'].includes(button.callback_data)), false, 'category choices stay inside their submenus');
  assert.equal(buttons().some((button) => button.callback_data === 't:air_movement'), false, 'air movement is not a standalone main-menu button');
  await tap('ag:aerial', reporter, reportBot);
  for (const type of ['t:warplane', 't:uav', 't:helicopter']) assert.ok(buttons().some((button) => button.callback_data === type), `aerial submenu contains ${type}`);
  assert.ok(buttons().some((button) => button.callback_data === 't:air_movement' && button.text?.includes('باتجاه')), 'aerial submenu includes the direction-to-Syria/governorate button');
  await tap('t:helicopter', reporter, reportBot);
  assert.match(lastUi()?.payload?.text || '', /طيران مروحي/, 'helicopter starts a manual publishing draft');
  await tap('home');
  await tap('ag:strikes');
  await tap('t:airstrike');
  assert.ok(buttons().some((button) => button.callback_data === 'as:singular' && button.text?.includes('غارة جوية')));
  assert.ok(buttons().some((button) => button.callback_data === 'as:plural' && button.text?.includes('غارات جوية')));
  await tap('as:singular');
  assert.match(lastUi()?.payload?.text || '', /غارة جوية/, 'singular wording persists into location selection');
  await tap('home');
  await tap('ag:strikes');
  await tap('t:airstrike');
  await tap('as:plural');
  assert.match(lastUi()?.payload?.text || '', /غارات جوية/, 'plural wording persists into location selection');
  await tap('home');
  await tap('mi');
  assert.ok(buttons().some((button) => button.callback_data === 'mi:soldiers' && button.text?.includes('جنود')));
  assert.ok(buttons().some((button) => button.callback_data === 'mi:vehicles' && button.text?.includes('آليات عسكرية')));
  assert.ok(buttons().some((button) => button.callback_data === 'mi:barrier' && button.text?.includes('حاجز')));
  assert.equal(buttons().some((button) => button.callback_data === 'mi:general'), false, 'the obsolete general-incursion button is not displayed');
  await tap('mi:barrier');
  assert.match(lastUi()?.payload?.text || '', /حاجز عسكري/, 'the admin flow identifies the barrier subtype before location selection');
  await tap('home');
  await tap('mi');
  await tap('mi:soldiers');
  assert.match(lastUi()?.payload?.text || '', /اختر المحافظة/);
  assert.equal(buttons().some((button) => button.callback_data?.startsWith('vehc:')), false, 'soldier incursion goes directly to area selection');
  await tap(`g:${politicalIdlib.code}`);
  await tap(`wg:${politicalIdlib.code}`);
  await tap('skip');
  assert.match(lastUi()?.payload?.text || '', /توغل جنود/);
  assert.doesNotMatch(lastUi()?.payload?.text || '', /عدد الآليات|Vehicle count/);
  await tap('home');
  await tap('mi');
  await tap('mi:vehicles');
  assert.ok(buttons().some((button) => button.callback_data === 'vehc:1'));
  assert.ok(buttons().some((button) => button.callback_data === 'vehc:12'));
  assert.ok(buttons().some((button) => button.callback_data === 'vehc:custom'));
  await tap('vehc:3');
  assert.match(lastUi()?.payload?.text || '', /٣ آليات/, 'admin can choose a preset vehicle count before selecting a location');
  await tap('home');
  await tap('home', reporter, reportBot);
  const reportButtons = lastUi()?.payload?.reply_markup?.inline_keyboard?.flat() || [];
  assert.ok(reportButtons.some((button) => button.callback_data === 'mi' && button.text?.endsWith('توغل عسكري')), 'general military incursion is available in the public report bot');
  assert.ok(reportButtons.some((button) => button.callback_data === 't:political' && button.text?.includes('تطور سياسي')), 'political reporting is available in the public report bot');
  assert.ok(reportButtons.some((button) => button.callback_data === 'sm' && button.text?.includes('تهريب')), 'smuggling appears as one parent button in the public report bot');
  for (const [user, targetBot, name] of [[owner, bot, 'admin'], [reporter, reportBot, 'public report']]) {
    await tap('home', user, targetBot);
    const root = lastUi()?.payload?.reply_markup?.inline_keyboard?.flat() || [];
    assert.ok(root.some((button) => button.callback_data === 't:political'), `${name} menu exposes political reports`);
    assert.ok(root.some((button) => button.callback_data === 'mi'), `${name} menu exposes military-incursion reports`);
    assert.ok(root.some((button) => button.callback_data === 'sm'), `${name} menu exposes the smuggling parent button`);
    await tap('sm', user, targetBot);
    for (const [type, label] of [['smuggling_weapons', 'تهريب أسلحة'], ['smuggling_drugs', 'تهريب مخدرات'], ['smuggling_explosives', 'تهريب متفجرات']]) {
      assert.ok(buttons().some((button) => button.callback_data === `t:${type}` && button.text?.includes(label)), `${name} smuggling submenu contains ${label}`);
    }
    await tap('t:smuggling_drugs', user, targetBot);
    assert.match(lastUi()?.payload?.text || '', /تهريب مخدرات/);
    assert.match(lastUi()?.payload?.text || '', /اختر المحافظة/);
  }
  await tap('home', reporter, reportBot);
  await tap('ag:aerial', reporter, reportBot);
  const aerialReportButtons = lastUi()?.payload?.reply_markup?.inline_keyboard?.flat() || [];
  const helicopterButton = aerialReportButtons.find((item) => item.callback_data === 't:helicopter');
  assert.ok(helicopterButton, 'helicopter button is available in the public report bot');
  assert.ok(helicopterButton.text.includes('طيران مروحي'), 'helicopter button has a clear Arabic label');
  await tap('t:helicopter', reporter, reportBot);
  assert.match(lastUi()?.payload?.text || '', /طيران مروحي/);
  await tap('home', reporter, reportBot);
  await tap('ag:strikes', reporter, reportBot);
  assert.ok(buttons().some((item) => item.callback_data === 't:airstrike'), 'airstrike button is available in the public report bot');
  await tap('t:airstrike', reporter, reportBot);
  assert.ok(buttons().some((button) => button.callback_data === 'as:singular' && button.text?.includes('غارة جوية')));
  assert.ok(buttons().some((button) => button.callback_data === 'as:plural' && button.text?.includes('غارات جوية')));
  await tap('as:plural', reporter, reportBot);
  assert.match(lastUi()?.payload?.text || '', /غارات جوية/, 'public reporter can select plural airstrikes');
  await tap('home', reporter, reportBot);
  await tap('home');
  await tap('cv');
  for (const callback of ['t:accident', 't:fire', 't:civil_plane', 't:arrest', 't:death', 't:martyrdom', 't:brawl', 't:shooting', 't:civil']) {
    assert.ok(buttons().some((button) => button.callback_data === callback), `civil submenu includes ${callback}`);
  }
  assert.equal(buttons().some((button) => ['t:protest', 't:protest_action'].includes(button.callback_data)), false, 'protest choices have their own parent menu');
  assert.ok(buttons().some((button) => button.callback_data === 't:brawl' && button.text?.includes('مشاجرة')));
  assert.ok(buttons().some((button) => button.callback_data === 't:shooting' && button.text?.includes('إطلاق نار')));
  await tap('home');
  await tap('ag:protests');
  assert.ok(buttons().some((button) => button.callback_data === 't:protest_action' && button.text?.includes('احتجاج')));
  assert.ok(buttons().some((button) => button.callback_data === 't:protest' && button.text?.includes('مظاهرة')));
  await tap('home');
  await tap('t:border');
  assert.ok(buttons().some((button) => button.callback_data === 'bsel:iraq'));
  assert.ok(buttons().some((button) => button.callback_data === 'bsel:turkey'));
  assert.ok(buttons().some((button) => button.callback_data === 'bsel:palestine'));
  await tap('bsel:turkey');
  assert.doesNotMatch(lastUi().payload.text, /اختر المحافظة/);
  assert.match(lastUi().payload.text, /باب الهوى/);
  await tap('skip');
  assert.match(lastUi().payload.text, /باب الهوى/);
  await tap('home');
  await tap('t:border');
  await tap('bsel:palestine');
  assert.doesNotMatch(lastUi().payload.text, /اختر المحافظة/);
  assert.match(lastUi().payload.text, /القنيطرة/);
  await tap('skip');
  await tap('home');
  await tap('ag:aerial');
  await tap('t:warplane');
  assert.ok(buttons().some((button) => button.callback_data === 'airmode:over'));
  assert.equal(buttons().some((button) => button.callback_data === 'airmode:move'), false, 'warplane submenu must not duplicate the main movement flow');
  await tap('airmode:over');
  assert.match(lastUi().payload.text, /اختر المحافظة/);
  assert.equal(buttons().some((button) => button.callback_data?.startsWith('flight:')), false, 'warplane over-area alerts remain separate from movement reports');

  const idlib = governorates.find((g) => g.ar === 'إدلب');
  const daraa = governorates.find((g) => g.ar === 'درعا');
  assert.ok(idlib && daraa, 'synthetic governorate route endpoints are available');
  await tap('home');
  await tap('ag:aerial');
  assert.ok(buttons().some((button) => button.callback_data === 't:air_movement' && /باتجاه سوريا/.test(button.text)), 'existing main direction button is retained');
  await tap('t:air_movement');
  await tap('flightair:warplane');
  for (const mode of ['toward_syria', 'entering_syria', 'leaving_syria']) assert.ok(buttons().some((button) => button.callback_data === `flight:${mode}`), `main direction flow offers ${mode}`);
  await tap('flight:entering_syria');
  await tap(`g:${daraa.code}`);
  await tap(`wg:${daraa.code}`);
  await tap(`flightto:${idlib.code}`);
  await tap('skip');
  assert.match(lastUi().payload.text, /نقطة رصد تقريبية:<\/b> درعا/);
  assert.match(lastUi().payload.text, /الوجهة:<\/b> إدلب/);
  await tap('home');
  await tap('home', reporter, reportBot);
  await tap('ag:aerial', reporter, reportBot);
  await tap('t:uav', reporter, reportBot);
  assert.ok(buttons().some((button) => button.callback_data === 'airmode:over'));
  await tap('t:air_movement', reporter, reportBot);
  await tap('flightair:uav', reporter, reportBot);
  assert.ok(buttons().some((button) => button.callback_data === 'flight:toward_syria'));
  assert.ok(buttons().some((button) => button.callback_data === 'flight:entering_syria'));
  assert.ok(buttons().some((button) => button.callback_data === 'flight:leaving_syria'));
  assert.equal(buttons().some((button) => button.callback_data === 'flight:from_area'), false, 'hovering over an area remains its own alert type');
  await tap('flight:entering_syria', reporter, reportBot);
  assert.match(lastUi().payload.text, /نقطة رصد تقريبية/);
  assert.ok(buttons().some((button) => button.callback_data?.startsWith('g:')), 'movement reports first ask for an observed location');
  await tap(`g:${daraa.code}`, reporter, reportBot);
  await tap(`wg:${daraa.code}`, reporter, reportBot);
  assert.match(lastUi().payload.text, /اختر الوجهة/);
  assert.ok(buttons().some((button) => button.callback_data === 'flightto:syria'));
  assert.ok(buttons().some((button) => button.callback_data === `flightto:${idlib.code}`));
  await tap('flightto:syria', reporter, reportBot);
  await tap('skip', reporter, reportBot);
  assert.match(lastUi().payload.text, /لن يُرسم خط جغرافي/);

  await tap('home', reporter, reportBot);
  await tap('ag:aerial', reporter, reportBot);
  await tap('t:air_movement', reporter, reportBot);
  assert.ok(buttons().some((button) => button.callback_data === 'flightair:warplane'), 'direction flow lets the reporter choose the aircraft type');
  await tap('flightair:warplane', reporter, reportBot);
  await tap('flight:toward_syria', reporter, reportBot);
  await tap(`g:${daraa.code}`, reporter, reportBot);
  await tap(`wg:${daraa.code}`, reporter, reportBot);
  await tap(`flightto:${idlib.code}`, reporter, reportBot);
  assert.match(lastUi().payload.text, /درعا/);
  await tap('skip', reporter, reportBot);
  assert.match(lastUi().payload.text, /نقطة رصد تقريبية:<\/b> درعا/);
  assert.match(lastUi().payload.text, /الوجهة:<\/b> إدلب/);
  assert.match(lastUi().payload.text, /توضيحي فقط/);

  for (const [targetBot, user, aircraft] of [[bot, owner, 'warplane'], [reportBot, reporter, 'uav']]) {
    for (const direction of ['toward_syria', 'entering_syria', 'leaving_syria']) {
      await tap('home', user, targetBot);
      await tap('ag:aerial', user, targetBot);
      await tap('t:air_movement', user, targetBot);
      await tap(`flightair:${aircraft}`, user, targetBot);
      assert.ok(buttons().some((button) => button.callback_data === 'flight:toward_syria'));
      assert.ok(buttons().some((button) => button.callback_data === 'flight:entering_syria'));
      assert.ok(buttons().some((button) => button.callback_data === 'flight:leaving_syria'));
      await tap(`flight:${direction}`, user, targetBot);
      assert.match(lastUi().payload.text, /نقطة رصد تقريبية/, `${direction} is accepted by the selected bot flow`);
      await tap('cancel', user, targetBot);
    }
  }

  await tap('home', reporter, reportBot);
  await tap('mi', reporter, reportBot);
  assert.ok(buttons().some((button) => button.callback_data === 'mi:soldiers' && button.text?.includes('جنود')));
  assert.ok(buttons().some((button) => button.callback_data === 'mi:vehicles' && button.text?.includes('آليات عسكرية')));
  assert.equal(buttons().some((button) => button.callback_data === 'mi:general'), false, 'the public menu also hides the obsolete general-incursion button');
  await tap('mi:vehicles', reporter, reportBot);
  assert.ok(buttons().some((button) => button.callback_data === 'vehc:custom'));
  await tap('vehc:custom', reporter, reportBot);
  await sendText('٠', reporter, reportBot);
  assert.match(lastUi().payload.text, /1 إلى 999/);
  await sendText('١٥', reporter, reportBot);
  assert.match(lastUi().payload.text, /١٥ آلية/);
  await tap(`g:${idlib.code}`, reporter, reportBot);
  await tap(`wg:${idlib.code}`, reporter, reportBot);
  await tap('skip', reporter, reportBot);
  assert.match(lastUi().payload.text, /١٥ آلية/);
  const reviewStart = calls.length;
  await tap('submit', reporter, reportBot);
  const reviewCard = calls.slice(reviewStart).find((call) => call.method === 'sendMessage' && call.chatId === ownerId && /عدد الآليات/.test(call.payload.text || ''));
  assert.ok(reviewCard, 'the admin review card includes the chosen vehicle count');
  const reportCallback = reviewCard.payload.reply_markup.inline_keyboard.flat().find((button) => /^rap:/.test(button.callback_data || ''));
  assert.ok(reportCallback, 'the report review card retains its decision callbacks');
  pendingReportIds.push(reportCallback.callback_data.slice(4));

  const borderInput = buildAlertInput({
    type: 'border', border: 'turkey', location: { scope: 'point', name_ar: BORDER_MARKERS.turkey.ar, name_en: BORDER_MARKERS.turkey.en, latitude: BORDER_MARKERS.turkey.lat, longitude: BORDER_MARKERS.turkey.lon }, extra: [], ttlMin: 120,
  }, { id: ownerId, name: 'test' });
  assert.match(borderInput.title, /السورية–التركية/);
  assert.equal(borderInput.location.scope, 'point');
  assert.equal(borderInput.location.latitude, BORDER_MARKERS.turkey.lat);
  assert.equal(borderInput.location.longitude, BORDER_MARKERS.turkey.lon);
  const palestineInput = buildAlertInput({
    type: 'border', border: 'palestine', location: { scope: 'point', name_ar: BORDER_MARKERS.palestine.ar, name_en: BORDER_MARKERS.palestine.en, latitude: BORDER_MARKERS.palestine.lat, longitude: BORDER_MARKERS.palestine.lon }, extra: [], ttlMin: 120,
  }, { id: ownerId, name: 'test' });
  assert.match(palestineInput.title, /السورية–الفلسطينية/);
  assert.equal(palestineInput.location.latitude, BORDER_MARKERS.palestine.lat);
  assert.equal(palestineInput.location.longitude, BORDER_MARKERS.palestine.lon);
  const flightInput = buildAlertInput({
    type: 'warplane', location: { scope: 'place', name_ar: 'درعا', name_en: 'Daraa' }, extra: [], ttlMin: 60,
  }, { id: ownerId, name: 'test' });
  assert.match(flightInput.title_en, /Warplane/);
  assert.equal(flightInput.meta?.flightDirection, undefined, 'over-area warplane reports contain no movement metadata');
  const droneInput = buildAlertInput({
    type: 'uav', location: { scope: 'place', name_ar: 'حلب', name_en: 'Aleppo' }, extra: [], ttlMin: 90,
  }, { id: ownerId, name: 'test' });
  assert.match(droneInput.title, /تحليق مسيّرة/);
  assert.equal(droneInput.meta?.flightDirection, undefined, 'over-area drone reports contain no movement metadata');
  const movementInput = buildAlertInput({
    type: 'air_movement', aircraft: 'uav', flightDirection: 'entering_syria', location: { scope: 'country', name_ar: 'سوريا', name_en: 'Syria', latitude: null, longitude: null }, extra: [], ttlMin: 60,
  }, { id: ownerId, name: 'test' });
  assert.match(movementInput.title, /دخول الأجواء السورية/);
  assert.equal(movementInput.meta.aircraft, 'uav');
  assert.equal(movementInput.location.scope, 'country');
  assert.equal(movementInput.location.latitude, null);
  assert.equal(movementInput.location.longitude, null);
  const idlibTarget = { scope: 'governorate', name_ar: 'إدلب', name_en: 'Idlib', governorate_ar: 'إدلب', governorate_en: 'Idlib', latitude: 35.93, longitude: 36.63 };
  const daraaOrigin = { scope: 'governorate', name_ar: 'درعا', name_en: 'Daraa', governorate_ar: 'درعا', governorate_en: 'Daraa', latitude: 32.62, longitude: 36.1 };
  const singularStrikeInput = buildAlertInput({
    type: 'airstrike', airstrikeForm: 'singular', location: idlibTarget, extra: [], ttlMin: 180,
  }, { id: ownerId, name: 'test' });
  const pluralStrikeInput = buildAlertInput({
    type: 'airstrike', airstrikeForm: 'plural', location: idlibTarget, extra: [], ttlMin: 180,
  }, { id: ownerId, name: 'test' });
  assert.match(singularStrikeInput.title, /^غارة جوية/);
  assert.match(singularStrikeInput.title_en, /^Airstrike/);
  assert.match(pluralStrikeInput.title, /^غارات جوية/);
  assert.match(pluralStrikeInput.title_en, /^Airstrikes/);
  const targetedMovementInput = buildAlertInput({
    type: 'air_movement', aircraft: 'warplane', flightDirection: 'toward_syria', flightTarget: idlibTarget, location: daraaOrigin, extra: [], ttlMin: 60,
  }, { id: ownerId, name: 'test' });
  assert.match(targetedMovementInput.title, /نحو إدلب/);
  assert.match(targetedMovementInput.title_en, /toward Idlib/);
  assert.equal(targetedMovementInput.location.name_ar, 'درعا');
  assert.equal(targetedMovementInput.location.latitude, daraaOrigin.latitude);
  assert.equal(targetedMovementInput.meta.flightTarget.name_ar, 'إدلب');
  const militaryInput = buildAlertInput({
    type: 'military_incursion', vehicleCount: 15, location: idlibTarget, extra: [], ttlMin: 180,
  }, { id: ownerId, name: 'test' });
  assert.match(militaryInput.title, /١٥ آلية/);
  assert.match(militaryInput.title_en, /15 vehicles/);
  assert.equal(militaryInput.meta.vehicleCount, 15);
  const generalIncursionInput = buildAlertInput({
    type: 'military_incursion', location: idlibTarget, extra: [], ttlMin: 180,
  }, { id: ownerId, name: 'test' });
  assert.equal(generalIncursionInput.type, 'military_incursion', 'both submenu paths retain the historical alert type key');
  assert.match(generalIncursionInput.title, /^توغل عسكري/);
  assert.equal(generalIncursionInput.meta?.vehicleCount, undefined, 'the general route does not invent or require a vehicle count');
  const borderAlert = store.addAlert(borderInput);
  const palestineAlert = store.addAlert(palestineInput);
  assert.equal(publicAlert(borderAlert).border, 'turkey');
  assert.equal(publicAlert(borderAlert).location.latitude, BORDER_MARKERS.turkey.lat);
  assert.equal(publicAlert(borderAlert).location.longitude, BORDER_MARKERS.turkey.lon);
  assert.equal(publicAlert(palestineAlert).border, 'palestine');
  assert.equal(publicAlert(palestineAlert).location.latitude, BORDER_MARKERS.palestine.lat);
  assert.equal(publicAlert(palestineAlert).location.longitude, BORDER_MARKERS.palestine.lon);
  const flightAlert = store.addAlert(flightInput);
  assert.equal(publicAlert(flightAlert).flight_direction, undefined);
  const droneAlert = store.addAlert(droneInput);
  assert.equal(publicAlert(droneAlert).flight_direction, undefined);
  const movementAlert = store.addAlert(movementInput);
  assert.equal(publicAlert(movementAlert).flight_direction, 'entering_syria');
  assert.equal(publicAlert(movementAlert).aircraft, 'uav');
  assert.equal(publicAlert(movementAlert).scope, 'country');
  assert.equal(Number.isFinite(publicAlert(movementAlert).location?.latitude), false, 'direction-only alerts have no map pin coordinates');
  const targetedMovementAlert = store.addAlert(targetedMovementInput);
  assert.equal(publicAlert(targetedMovementAlert).flight_direction, 'toward_syria');
  assert.equal(publicAlert(targetedMovementAlert).place.name_ar, 'درعا');
  assert.equal(publicAlert(targetedMovementAlert).location.latitude, daraaOrigin.latitude);
  assert.deepEqual(publicAlert(targetedMovementAlert).flight_target, {
    scope: 'governorate', name_ar: 'إدلب', name_en: 'Idlib', latitude: idlibTarget.latitude, longitude: idlibTarget.longitude,
  });
  const militaryAlert = store.addAlert(militaryInput);
  assert.equal(publicAlert(militaryAlert).vehicle_count, 15);
  assert.match(channelPost(militaryAlert), /١٥ آلية/);
  const generalIncursionAlert = store.addAlert(generalIncursionInput);
  assert.equal(publicAlert(generalIncursionAlert).type, 'military_incursion');
  assert.equal(publicAlert(generalIncursionAlert).vehicle_count, undefined);
  assert.match(channelPost(generalIncursionAlert), /<b>توغل عسكري<\/b>/);
  addedAlertIds.push(borderAlert.id, palestineAlert.id, flightAlert.id, droneAlert.id, movementAlert.id, targetedMovementAlert.id, militaryAlert.id, generalIncursionAlert.id);

  const channelSyncAlert = store.addAlert(buildAlertInput({
    type: 'attack', location: idlibTarget, details: 'تفاصيل قديمة', extra: [], ttlMin: 180,
  }, { id: ownerId, name: 'test' }));
  store.updateAlert(channelSyncAlert.id, { channel_message_id: 8700, channel_media: 'photo' });
  addedAlertIds.push(channelSyncAlert.id);
  const oldCaption = plainChannelText(channelPost(channelSyncAlert));
  const firstLine = oldCaption.split('\n')[0];
  const editedCaption = oldCaption.replace(firstLine, firstLine.replace(' - ', ' محدث - ')).replace('تفاصيل قديمة', 'تفاصيل محدثة');
  assert.notEqual(editedCaption, oldCaption);
  let liveMapUpdate = null;
  const captureMapUpdate = (item) => { if (item.id === channelSyncAlert.id) liveMapUpdate = item; };
  store.on('update', captureMapUpdate);
  await bot.handleUpdate({ update_id: updateId++, edited_channel_post: {
    message_id: 8700, date: 0, edit_date: Math.floor(Date.now() / 1000),
    chat: { id: -1001234567890, type: 'channel', username: 'mock_news_channel' }, caption: editedCaption,
  } });
  store.off('update', captureMapUpdate);
  assert.equal(liveMapUpdate?.title, 'هجوم محدث');
  assert.equal(liveMapUpdate?.description, 'تفاصيل محدثة');
  assert.equal(liveMapUpdate?.type, 'attack', 'channel edits never reclassify the alert');
  assert.equal(liveMapUpdate?.location.latitude, idlibTarget.latitude, 'channel edits retain map coordinates');
  assert.equal(liveMapUpdate?.place.name_ar, 'إدلب', 'channel edits retain the stored place');
  assert.equal(store.getAlert(channelSyncAlert.id).is_active, true);
  assert.equal(store.getAlert(channelSyncAlert.id).meta.channelTitle, 'هجوم محدث');

  liveMapUpdate = null;
  store.on('update', captureMapUpdate);
  await bot.handleUpdate({ update_id: updateId++, edited_channel_post: {
    message_id: 8700, date: 0, edit_date: Math.floor(Date.now() / 1000),
    chat: { id: -1001234567890, type: 'channel', username: 'other_channel' }, caption: 'تعديل من قناة أخرى',
  } });
  store.off('update', captureMapUpdate);
  assert.equal(liveMapUpdate, null, 'edits from a different channel cannot change the map');

  liveMapUpdate = null;
  store.on('update', captureMapUpdate);
  const generatedCaption = plainChannelText(channelPost(channelSyncAlert));
  await bot.handleUpdate({ update_id: updateId++, edited_channel_post: {
    message_id: 8700, date: 0, edit_date: Math.floor(Date.now() / 1000),
    chat: { id: -1001234567890, type: 'channel', username: 'mock_news_channel' }, caption: generatedCaption,
  } });
  store.off('update', captureMapUpdate);
  assert.equal(liveMapUpdate, null, 'the bot ignores its own generated channel-post edit echo');

  store.updateAlert(channelSyncAlert.id, { channel_media: 'text' });
  const oldTextPost = plainChannelText(channelPost(channelSyncAlert));
  const editedTextPost = oldTextPost.replace('تفاصيل محدثة', 'تفاصيل نصية معدلة');
  liveMapUpdate = null;
  store.on('update', captureMapUpdate);
  await bot.handleUpdate({ update_id: updateId++, edited_channel_post: {
    message_id: 8700, date: 0, edit_date: Math.floor(Date.now() / 1000),
    chat: { id: -1001234567890, type: 'channel', username: 'mock_news_channel' }, text: editedTextPost,
  } });
  store.off('update', captureMapUpdate);
  assert.equal(liveMapUpdate?.description, 'تفاصيل نصية معدلة', 'plain-text channel edits are synchronized too');

  const versionedSyncAlert = store.addAlert(buildAlertInput({
    type: 'attack', location: idlibTarget, details: 'تفاصيل إصدار جديد', extra: [], ttlMin: 180,
  }, { id: ownerId, name: 'test' }));
  store.updateAlert(versionedSyncAlert.id, { channel_message_id: 8701, channel_media: 'photo', channel_format: 2 });
  addedAlertIds.push(versionedSyncAlert.id);
  const versionedCaption = plainChannelText(channelPost(versionedSyncAlert));
  const versionedHeader = versionedCaption.split('\n')[0];
  const editedVersionedCaption = versionedCaption.replace(versionedHeader, versionedHeader.replace('هجوم', 'هجوم محدث')).replace('تفاصيل إصدار جديد', 'تفاصيل الإصدار الجديد المعدلة');
  let versionedMapUpdate = null;
  const captureVersionedMapUpdate = (item) => { if (item.id === versionedSyncAlert.id) versionedMapUpdate = item; };
  store.on('update', captureVersionedMapUpdate);
  await bot.handleUpdate({ update_id: updateId++, edited_channel_post: {
    message_id: 8701, date: 0, edit_date: Math.floor(Date.now() / 1000),
    chat: { id: -1001234567890, type: 'channel', username: 'mock_news_channel' }, caption: editedVersionedCaption,
  } });
  store.off('update', captureVersionedMapUpdate);
  assert.equal(versionedMapUpdate?.title, 'هجوم محدث', 'channel edit parsing removes the category dot and event symbol');
  assert.equal(versionedMapUpdate?.description, 'تفاصيل الإصدار الجديد المعدلة');

  const before = new Set(store.state.alerts.map((alert) => alert.id));
  newsState().drafts[draftId] = {
    id: draftId,
    type: 'assassination',
    status: 'pending',
    headline: 'خبر محاكاة محلي',
    body: 'تفاصيل محاكاة محلية',
    loc: { scope: 'place', name_ar: 'حارم', name_en: 'Harem', governorate_ar: 'إدلب', governorate_en: 'Idlib' },
    extra: [],
    ttlMin: 360,
    srcs: [{ u: 'mock-source', local: false }],
    cards: [],
    created: Date.now(),
  };

  const callback = `nw:p:${draftId}`;
  await tap(callback);
  assert.equal(newsState().drafts[draftId].status, 'published');

  await tap(callback);
  assert.equal(newsState().drafts[draftId].status, 'published');

  const newAlerts = store.state.alerts.filter((alert) => !before.has(alert.id));
  addedAlertIds.push(...newAlerts.map((alert) => alert.id));
  assert.equal(newAlerts.length, 1, 'the repeated approval must not create another map alert');
  assert.equal(calls.filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length, 1, 'the repeated approval must not post to the channel twice');
  assert.ok(calls.every((call) => !call.chatId || [ownerId, reporter.id, 8270709635, 8270709638, 8270709639, 8270709644, 8270709645, process.env.CHANNEL_ID].includes(call.chatId)), 'all Telegram API calls are intercepted locally');
});

test('clashes channel posts keep the dedicated label instead of the generic attack label', () => {
  const input = buildAlertInput({ type: 'clashes', location: { scope: 'country' }, extra: [], ttlMin: 240 }, { id: ownerId, name: 'test' });
  const post = channelPost({ ...input, id: 'test-clashes-label', timestamp: new Date().toISOString(), place: { scope: 'country' } });
  assert.equal(input.type, 'clashes');
  assert.match(post, /<b>اشتباكات مسلحة<\/b>/);
  assert.doesNotMatch(post, /<b>هجوم<\/b>/);
});

test('aerial movement accepts only a reporter-selected approximate external origin while other categories remain bounded', async () => {
  const idlib = governorates.find((g) => g.ar === 'إدلب');
  const sendPoint = (user, targetBot) => targetBot.handleUpdate({
    update_id: updateId++,
    message: { message_id: ++messageId, date: 0, chat: { id: user.id, type: 'private' }, from: user,
      location: { latitude: 32.1234567, longitude: 34.8765432 } },
  });
  const lastText = () => [...calls].reverse().find(({ payload }) => typeof payload.text === 'string')?.payload.text || '';
  const start = calls.length;
  const freshReporter = { ...reporter, id: 999000000001 };
  for (const [user, targetBot] of [[owner, bot], [freshReporter, reportBot]]) {
    await tap('home', user, targetBot);
    await tap('ag:aerial', user, targetBot);
    let menuStart = calls.length;
    await tap('t:uav', user, targetBot);
    assert.ok(callbacksOf(keyboardAfter(menuStart)).includes('airmode:move'), `unrequested UAV submenu choice is preserved: ${JSON.stringify({ user: user.id, buttons: callbacksOf(keyboardAfter(menuStart)), text: lastText() })}`);
    for (const aircraft of ['warplane', 'uav']) {
      await tap('home', user, targetBot);
      await tap('ag:aerial', user, targetBot);
      await tap('t:air_movement', user, targetBot);
      await tap(`flightair:${aircraft}`, user, targetBot);
      await tap('flight:toward_syria', user, targetBot);
      assert.match(lastText(), /نقطة رصد تقريبية/);
      menuStart = calls.length;
      await sendPoint(user, targetBot);
      assert.ok(callbacksOf(keyboardAfter(menuStart)).includes(`flightto:${idlib.code}`), 'external observation pin is accepted and leads to Syrian destinations');
      await tap(`flightto:${idlib.code}`, user, targetBot);
      await tap('skip', user, targetBot);
      assert.match(lastText(), /نقطة رصد تقريبية:<\/b> نقطة رصد تقريبية/);
      assert.match(lastText(), /الوجهة:<\/b> إدلب/);
    }
    await tap('home', user, targetBot);
    await tap('ag:aerial', user, targetBot);
    await tap('t:warplane', user, targetBot);
    await tap('airmode:over', user, targetBot);
    await sendPoint(user, targetBot);
    assert.match(lastText(), /خارج|ضمن|سوريا/, 'ordinary over-area alerts still reject an external point');
    await tap('cancel', user, targetBot);
  }
  assert.equal(calls.slice(start).some(({ chatId }) => chatId === '@mock_news_channel'), false, 'menu and point checks never publish a channel post');
  const source = fs.readFileSync(new URL('../server/bot.js', import.meta.url), 'utf8');
  assert.match(source, /flightOrigin = d\.type === 'air_movement' && d\.selectingFlightOrigin === true/);
  assert.match(source, /name_en: 'Approximate observation point', latitude: lat, longitude: lon/, 'origin coordinates are not snapped, rounded, or fabricated');
});
