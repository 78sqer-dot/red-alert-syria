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
const { newsState, sendTestDraft, toBotDraft, nightEligible, dayAutoReady, _test: newsMonitorTest } = await import('../server/news-monitor.js');
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
const snapshotPayload = (payload) => {
  const copy = { ...(payload || {}) };
  for (const key of ['photo', 'video']) if (copy[key] && typeof copy[key] !== 'string') copy[key] = '[media]';
  if (copy.media && typeof copy.media === 'object') copy.media = { type: copy.media.type, caption: copy.media.caption, parse_mode: copy.media.parse_mode, media: '[media]' };
  return structuredClone(copy);
};
const mockMediaMessage = (payload, type) => {
  const id = ++messageId;
  const file = { file_id: `admin-${type}-${id}`, file_unique_id: `admin-unique-${id}`, file_size: 128, width: 10, height: 10 };
  return { ok: true, result: { message_id: id, chat: { id: payload.chat_id, type: [ownerId, reporter.id].includes(payload.chat_id) ? 'private' : 'channel' }, date: 0, ...(type === 'photo' ? { photo: [file] } : { video: { ...file, mime_type: 'video/mp4' } }) } };
};
bot.api.config.use(async (_previous, method, payload) => {
  calls.push({ method, chatId: payload?.chat_id, payload: snapshotPayload(payload) });
  if (method === 'getFile') return { ok: true, result: { file_path: 'photos/local-test.jpg', file_size: 128 } };
  if (method === 'sendPhoto') return mockMediaMessage(payload, 'photo');
  if (method === 'sendVideo') return mockMediaMessage(payload, 'video');
  if (method === 'editMessageMedia') return { ok: true, result: { message_id: payload.message_id, chat: { id: payload.chat_id, type: 'channel' }, date: 0, ...(payload.media?.type === 'video' ? { video: { file_id: 'edited-video', file_unique_id: 'edited-video-unique', mime_type: 'video/mp4' } } : { photo: [{ file_id: 'edited-photo', file_unique_id: 'edited-photo-unique', width: 10, height: 10 }] }) } };
  if (method === 'sendMessage') {
    return { ok: true, result: { message_id: ++messageId, chat: { id: payload.chat_id, type: [ownerId, reporter.id].includes(payload.chat_id) ? 'private' : 'channel' }, date: 0, text: payload.text || '' } };
  }
  if (method === 'editMessageText') {
    return { ok: true, result: { message_id: payload.message_id, chat: { id: payload.chat_id, type: 'private' }, date: 0, text: payload.text || '' } };
  }
  return { ok: true, result: true };
});
reportBot.api.config.use(async (_previous, method, payload) => {
  calls.push({ method, chatId: payload?.chat_id, payload: snapshotPayload(payload) });
  if (method === 'getFile') return { ok: true, result: { file_path: String(payload.file_id).startsWith('report-video') ? 'videos/local-test.mp4' : 'photos/local-test.jpg', file_size: 128 } };
  if (method === 'sendMessage') return { ok: true, result: { message_id: ++messageId, chat: { id: payload.chat_id, type: 'private' }, date: 0, text: payload.text || '' } };
  if (method === 'editMessageText') return { ok: true, result: { message_id: payload.message_id, chat: { id: payload.chat_id, type: 'private' }, date: 0, text: payload.text || '' } };
  return { ok: true, result: true };
});

let updateId = 1;
const tap = async (data, user = owner, targetBot = bot, targetMessageId = 700) => targetBot.handleUpdate({
  update_id: updateId++,
  callback_query: {
    id: `local-${updateId}`,
    from: user,
    chat_instance: 'local',
    data,
    message: { message_id: targetMessageId, date: 0, chat: { id: user.id, type: 'private' }, from: targetBot.botInfo, text: 'Local test draft' },
  },
});
const tapInChat = async (data, user = owner, chat = { id: user.id, type: 'private' }, targetBot = bot, targetMessageId = 700) => targetBot.handleUpdate({
  update_id: updateId++,
  callback_query: {
    id: `local-${updateId}`,
    from: user,
    chat_instance: 'local',
    data,
    message: { message_id: targetMessageId, date: 0, chat, from: targetBot.botInfo, text: 'Local test draft' },
  },
});
const sendText = async (text, user = owner, targetBot = bot) => targetBot.handleUpdate({
  update_id: updateId++,
  message: { message_id: ++messageId, date: 0, chat: { id: user.id, type: 'private' }, from: user, text },
});
const sendTextInChat = async (text, user = owner, chat = { id: user.id, type: 'private' }, targetBot = bot) => targetBot.handleUpdate({
  update_id: updateId++,
  message: { message_id: ++messageId, date: 0, chat, from: user, text },
});
const sendPhoto = async (user, targetBot = reportBot, fileId = 'report-photo-1') => targetBot.handleUpdate({
  update_id: updateId++,
  message: { message_id: ++messageId, date: 0, chat: { id: user.id, type: 'private' }, from: user, photo: [{ file_id: fileId, file_unique_id: `${fileId}-unique`, width: 640, height: 480, file_size: 128 }] },
});
const sendVideo = async (user, targetBot = reportBot, fileId = 'report-video-1') => targetBot.handleUpdate({
  update_id: updateId++,
  message: { message_id: ++messageId, date: 0, chat: { id: user.id, type: 'private' }, from: user, video: { file_id: fileId, file_unique_id: `${fileId}-unique`, width: 640, height: 480, duration: 5, mime_type: 'video/mp4', file_size: 128 } },
});
const plainChannelText = (html) => String(html || '').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, String.fromCharCode(34));
const keyboardAfter = (start) => [...calls.slice(start)].reverse()
  .find(({ payload }) => Array.isArray(payload?.reply_markup?.inline_keyboard))?.payload.reply_markup.inline_keyboard || [];
const callbacksOf = (keyboard) => keyboard.flat().map((button) => button.callback_data).filter(Boolean);

test('monitored feed identities and links stay private while a public speaker remains attributed', () => {
  const synthetic = {
    id: 'synthetic-private-feed-test', type: 'attack', source: 'news', channel_format: 2,
    title: 'قناة الرصد الخاصة: بيان وزارة الصحة في حلب',
    title_en: 'Private Watch Feed: Health Ministry statement in Aleppo',
    description: 'قالت وزارة الصحة السورية إن 3 أشخاص أُصيبوا في حلب مساء اليوم. قناة الرصد الخاصة https://t.me/private_watch/123',
    description_en: 'The Ministry of Health said 3 people were injured in Aleppo tonight. Private Watch Feed https://t.me/private_watch/123',
    timestamp: new Date().toISOString(), place: { scope: 'country' },
    meta: {
      channelTitle: 'قناة الرصد الخاصة: بيان وزارة الصحة',
      newsSources: [
        { name: 'قناة الرصد الخاصة', u: 'private_watch', url: 'https://t.me/private_watch/123' },
        { name: 'Private Watch Feed', url: 'https://news.example/item' },
      ],
    },
    history: [{ at: new Date().toISOString(), kind: 'update', title: 'قناة الرصد الخاصة: تحديث', description: 'قالت وزارة الصحة: لا وفيات جديدة. https://t.me/private_watch/123', is_active: true }],
  };
  const post = channelPost(synthetic);
  const publicView = publicAlert(synthetic);
  for (const value of [post, publicView.title, publicView.title_en, publicView.description, publicView.description_en, publicView.updates[0].title, publicView.updates[0].description]) {
    assert.doesNotMatch(value, /قناة الرصد الخاصة|Private Watch Feed|private_watch|https?:\/\//i);
  }
  assert.match(post, /وزارة الصحة السورية/);
  assert.match(publicView.description, /وزارة الصحة السورية/);
  assert.match(publicView.description_en, /Ministry of Health/);
  assert.match(publicView.updates[0].description, /وزارة الصحة/);
  assert.equal(synthetic.meta.newsSources.length, 2, 'source records remain available internally');

  const nonNewsPrivateDescription = publicAlert({
    ...synthetic, type: 'accident', source: 'telegram', title: 'حادث سير في حمص', title_en: 'Traffic accident in Homs',
    description: 'وقع حادث سير في حمص مساء اليوم.', description_en: 'Traffic accident in Homs. Opinion/analysis: private owner note.',
  });
  assert.equal(nonNewsPrivateDescription.description_en, undefined,
    'the English description sanitizer also blocks owner-only text for non-news alerts');
  const safetyStory = {
    ...synthetic, type: 'accident', source: 'news', title: 'حادث سير في حمص أسفر عن إصابة 3 أشخاص', title_en: 'Traffic accident in Homs injures 3',
    description: 'أُصيب 3 أشخاص في حادث سير بحمص مساء اليوم.', description_en: 'Three people were injured in a traffic accident in Homs tonight.',
    editorialHold: true, editorialHoldReason: 'private-editorial-copy-not-public',
  };
  const safetyPost = channelPost(safetyStory);
  const safetyPublicView = publicAlert(safetyStory);
  assert.doesNotMatch(safetyPost, /EDITORIAL_REVIEW_REQUIRED|لا تقدم المادة وقائع موثقة كافية|موقوفة للمراجعة التحريرية|لم يُسجّل تحقق مستقل|خبر منقول|not independent verification|held for editorial review/i,
    'a public traffic-accident post contains no internal gate note or generic verification disclaimer');
  assert.equal(Object.hasOwn(safetyPublicView, 'editorialHold'), false);
  assert.equal(Object.hasOwn(safetyPublicView, 'editorialHoldReason'), false,
    'internal review state is not projected to the public map/site API');
  assert.throws(() => channelPost({
    ...synthetic, type: 'political', title: 'إعلان رسمي في حمص', meta: { channelTitle: 'رأي/تحليل: نص خاص' },
  }), /Private editorial or internal review text/, 'a private note cannot bypass the final channel check through its metadata title');
});

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

test('report menus omit route creation while historical movement remains recognized', async () => {
  const routedTypes = [...BOT_ALERT_MENU_DIRECT_TYPES, ...BOT_ALERT_MENU_PATROL_CHILD_TYPES, ...Object.values(BOT_ALERT_MENU_GROUPS).flat()];
  assert.equal(new Set(routedTypes).size, routedTypes.length, 'each alert type has exactly one report-menu route');
  const reportableTypes = Object.keys(ALERT_TYPES).filter((type) => type !== 'air_movement');
  assert.deepEqual([...routedTypes].sort(), reportableTypes.sort(), 'all currently reportable types have a nested menu route');
  assert.ok(ALERT_TYPES.air_movement, 'historical movement alerts remain a recognized data type');

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
    if (group === 'aerial') assert.equal(childButtons.some((button) => button.callback_data === 't:air_movement'), false, 'aerial submenu no longer offers the removed direction button');
    if (group === 'strikes') {
      assert.ok(childButtons.some((button) => button.callback_data === 't:explosion' && button.text === '«💥 انفجار»'), 'admin bot keeps the existing «انفجار» option');
      assert.ok(childButtons.some((button) => button.callback_data === 't:detonation' && button.text === '«💥 تفجير»'), 'admin bot exposes the distinct «تفجير» option');
    }
    if (group === 'protests') assert.deepEqual(childButtons.filter((button) => ['t:protest_action', 't:protest'].includes(button.callback_data)).map((button) => [button.callback_data, button.text]), [['t:protest_action', '«📢 احتجاج»'], ['t:protest', '«👥 مظاهرة»']]);
  }
});

test('public report bot exposes both strike types and sends detonation reports only to review', async (t) => {
  const publicReporter = { id: 8270709635, is_bot: false, first_name: 'Synthetic detonation reporter', language_code: 'ar' };
  const currentUi = () => [...calls].reverse().find(({ method }) => method === 'sendMessage' || method === 'editMessageText');
  const currentButtons = () => currentUi()?.payload?.reply_markup?.inline_keyboard?.flat() || [];
  const routedTypes = [...BOT_ALERT_MENU_DIRECT_TYPES, ...BOT_ALERT_MENU_PATROL_CHILD_TYPES, ...Object.values(BOT_ALERT_MENU_GROUPS).flat()];
  const reportableTypes = Object.keys(ALERT_TYPES).filter((type) => type !== 'air_movement');
  assert.deepEqual([...routedTypes].sort(), reportableTypes.sort(), 'the public menu omits new movement reports');
  assert.ok(ALERT_TYPES.air_movement, 'legacy movement alerts remain recognized');

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
      assert.ok(childButtons.some((button) => button.callback_data === 't:explosion' && button.text === '«💥 انفجار»'), 'public bot keeps the «انفجار» option');
      assert.ok(childButtons.some((button) => button.callback_data === 't:detonation' && button.text === '«💥 تفجير»'), 'public bot exposes the distinct «تفجير» option');
    }
    if (group === 'protests') assert.deepEqual(childButtons.filter((button) => ['t:protest_action', 't:protest'].includes(button.callback_data)).map((button) => [button.callback_data, button.text]), [['t:protest_action', '«📢 احتجاج»'], ['t:protest', '«👥 مظاهرة»']]);
  }

  const reportIdsBefore = new Set(Object.keys(store.state.reports || {}));
  const activeBefore = store.activeAlerts().length;
  start = calls.length;
  await tap('home', publicReporter, reportBot);
  await tap('ag:strikes', publicReporter, reportBot);
  assert.ok(currentButtons().some((button) => button.callback_data === 't:explosion' && button.text === '«💥 انفجار»'), 'explosion has its own public button');
  assert.ok(currentButtons().some((button) => button.callback_data === 't:detonation' && button.text === '«💥 تفجير»'), 'detonation has a separate public button');
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
      assert.ok(childKeyboard.flat().some((button) => button.callback_data === `nw:s:${id}:explosion` && button.text === '«💥 انفجار»'), 'the monitored-news editor keeps «انفجار»');
      assert.ok(childKeyboard.flat().some((button) => button.callback_data === `nw:s:${id}:detonation` && button.text === '«💥 تفجير»'), 'the monitored-news editor exposes the separate «تفجير» type');
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
  assert.ok(keyboardAfter(start).flat().some((button) => button.callback_data === `nw:s:${id}:explosion` && button.text === '«💥 انفجار»'), 'the selected story’s strike menu keeps explosion');
  assert.ok(keyboardAfter(start).flat().some((button) => button.callback_data === `nw:s:${id}:detonation` && button.text === '«💥 تفجير»'), 'the selected story’s strike menu offers detonation');
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
  assert.equal(NEWS_TYPES.includes('military_incursion'), true, 'ground-incursion reports are now automatically classified');
  const incursionDraft = { type: 'military_incursion', status: 'pending', loc: { scope: 'place', latitude: 33.0, longitude: 35.9 }, srcs: [{ u: 'national-a' }, { u: 'national-b' }] };
  assert.equal(nightEligible(incursionDraft), false, 'automatic classification still stops for human review');
  assert.equal(dayAutoReady({ ...incursionDraft, dayAutoAt: Date.now() - 1 }), false, 'a ground-incursion draft is not auto-published');
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
  assert.equal(socialRow?.length, 2, 'the Telegram boost and WhatsApp channel buttons share the footer');
  assert.equal(socialRow[0].url, 'https://t.me/boost/Red_Alert_Syria');
  assert.equal(socialRow[1].url, 'https://whatsapp.com/channel/0029VbEO1eGCBtxLP3jW8e1k');
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
  assert.match(monitoredPost, /تفاصيل الخبر/);
  assert.doesNotMatch(monitoredPost, /مصادر محلية|news\.example|المصدر:/, 'the monitored feed name and link stay private in the public post');
  assert.doesNotMatch(monitoredPost, /<a\b|href=/, 'the post contains no monitored-source URL');
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
  assert.doesNotMatch(politicalPost, /لم يُسجّل تحقق مستقل عن الخبر|خبر منقول/,
    'ordinary political posts do not add a generic verification disclaimer');
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
  assert.ok(buttons().some((button) => button.callback_data === 'mi' && button.text?.includes('توغل عسكري')));
  assert.ok(buttons().some((button) => button.callback_data === 'cv' && button.text?.includes('مدني')));
  assert.equal(buttons().some((button) => ['t:civil', 't:accident', 't:fire', 't:protest', 't:protest_action', 't:civil_plane', 't:arrest', 't:death', 't:martyrdom', 't:brawl', 't:shooting'].includes(button.callback_data)), false, 'category choices stay inside their submenus');
  assert.equal(buttons().some((button) => button.callback_data === 't:air_movement'), false, 'air movement is not a standalone main-menu button');
  await tap('ag:aerial', reporter, reportBot);
  for (const type of ['t:warplane', 't:uav', 't:helicopter']) assert.ok(buttons().some((button) => button.callback_data === type), `aerial submenu contains ${type}`);
  assert.equal(buttons().some((button) => button.callback_data === 't:air_movement'), false, 'public aerial submenu omits the direction button');
  await tap('t:helicopter', reporter, reportBot);
  assert.match(lastUi()?.payload?.text || '', /حدّد عدد المروحيات/, 'helicopter asks for the observed count');
  assert.ok(buttons().some((button) => button.callback_data === 'heli:intensity:high' && button.text.includes('مروحيتان')));
  await tap('heli:intensity:high', reporter, reportBot);
  assert.match(lastUi()?.payload?.text || '', /اختر المحافظة/);
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
  assert.ok(reportButtons.some((button) => button.callback_data === 'mi' && button.text?.includes('توغل عسكري')), 'general military incursion is available in the public report bot');
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
  assert.match(lastUi()?.payload?.text || '', /حدّد عدد المروحيات/);
  assert.ok(buttons().some((button) => button.callback_data === 'heli:intensity:normal'));
  assert.ok(buttons().some((button) => button.callback_data === 'heli:intensity:high'));
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

  await tap('home');
  await tap('ag:aerial');
  assert.equal(buttons().some((button) => button.callback_data === 't:air_movement'), false, 'the direction button is absent from the admin aerial menu');
  let staleCallbackStart = calls.length;
  await tap('t:air_movement');
  assert.equal(calls.slice(staleCallbackStart).filter(({ method }) => method === 'sendMessage' || method === 'editMessageText').length, 0, 'a stale movement button cannot start a new report');
  assert.ok(calls.slice(staleCallbackStart).some(({ method }) => method === 'answerCallbackQuery'), 'a stale movement button receives a callback response');

  const idlib = governorates.find((g) => g.ar === 'إدلب');
  assert.ok(idlib, 'the report review uses a known governorate');
  await tap('home', reporter, reportBot);
  await tap('ag:aerial', reporter, reportBot);
  assert.equal(buttons().some((button) => button.callback_data === 't:air_movement'), false, 'the reporter bot also hides the direction button');
  staleCallbackStart = calls.length;
  await tap('t:air_movement', reporter, reportBot);
  assert.equal(calls.slice(staleCallbackStart).filter(({ method }) => method === 'sendMessage' || method === 'editMessageText').length, 0, 'the reporter bot rejects the stale direction callback');
  await tap('home', reporter, reportBot);
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
    editorialHold: true,
    editorialHoldReason: 'synthetic-test',
    headline: 'خبر محاكاة محلي',
    body: 'تفاصيل محاكاة محلية',
    loc: { scope: 'place', name_ar: 'حارم', name_en: 'Harem', governorate_ar: 'إدلب', governorate_en: 'Idlib' },
    extra: [],
    ttlMin: 360,
    srcs: [{ u: 'mock-source', local: false }],
    cards: [],
    created: Date.now(),
  };

  const checkStart = calls.length;
  await tap(`nw:c:${draftId}`);
  const checkReply = calls.slice(checkStart).find((call) => call.method === 'sendMessage' && call.chatId === ownerId);
  assert.ok(checkReply, 'channel check returns a result card');
  const checkMessageId = messageId;
  assert.ok(newsState().drafts[draftId].cards.some(([chat, id]) => chat === ownerId && id === checkMessageId), 'the result card is registered for lifecycle cleanup');
  assert.match(checkReply.payload.text, /لا يقرأ تاريخ القناة كاملاً/, 'the result explains that this is not a full channel-history search');

  const callback = `nw:p:${draftId}`;
  const publishStart = calls.length;
  await tap(callback, owner, bot, checkMessageId);
  assert.equal(newsState().drafts[draftId].status, 'published');
  assert.ok(calls.slice(publishStart).some((call) => call.method === 'deleteMessage' && call.payload.message_id === checkMessageId), 'publishing from the check result removes its stale buttons');
  assert.equal(newsState().drafts[draftId].cards.some(([, id]) => id === checkMessageId), false, 'the deleted result is also removed from persisted card tracking');
  const shareMessage = calls.slice(publishStart).find((call) => call.method === 'sendMessage' && call.chatId === ownerId
    && call.payload.reply_markup?.inline_keyboard?.flat().some((button) => button.url?.startsWith('https://wa.me/?text=')));
  assert.ok(shareMessage, 'manual publication offers a WhatsApp share link to the owner');
  const shareButtons = shareMessage.payload.reply_markup.inline_keyboard.flat();
  const whatsAppButton = shareButtons.find((button) => button.url?.startsWith('https://wa.me/?text='));
  const mapButton = shareButtons.find((button) => button.text?.includes('على الخريطة') || button.text?.includes('On the map'));
  assert.ok(mapButton?.url, 'the published alert has a map link');
  const whatsAppText = new URL(whatsAppButton.url).searchParams.get('text');
  assert.ok(whatsAppText.includes(newsState().drafts[draftId].headline), 'share text contains the story headline');
  assert.ok(whatsAppText.includes(mapButton.url), 'share text contains the public map link');
  assert.equal(calls.slice(publishStart).some((call) => /whatsapp/i.test(call.method)), false, 'the bot only opens WhatsApp with a prepared link; it never sends a message');

  await tap(callback);
  assert.equal(newsState().drafts[draftId].status, 'published');

  const newAlerts = store.state.alerts.filter((alert) => !before.has(alert.id));
  addedAlertIds.push(...newAlerts.map((alert) => alert.id));
  assert.equal(newAlerts.length, 1, 'the repeated approval must not create another map alert');
  assert.equal(calls.filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length, 1, 'the repeated approval must not post to the channel twice');
  assert.ok(calls.every((call) => !call.chatId || [ownerId, reporter.id, 8270709635, 8270709638, 8270709639, 8270709644, 8270709645, process.env.CHANNEL_ID].includes(call.chatId)), 'all Telegram API calls are intercepted locally');

  const opinionId = 'owner_opinion_preview';
  const opinionDraft = newsState().drafts[opinionId] = {
    id: opinionId, type: 'political', status: 'pending', politicalCategory: 'government_announcement',
    headline: 'إعلان الحكومة الانتقالية خفض الدعم في حمص', sourceText: 'أعلنت الحكومة الانتقالية قراراً رسمياً بخفض الدعم في محافظة حمص وفق البيان المنشور اليوم.',
    loc: { scope: 'place', name_ar: 'حمص', name_en: 'Homs', governorate_ar: 'حمص', governorate_en: 'Homs', latitude: 34.7, longitude: 36.7 },
    extra: [], ttlMin: 360, srcs: [{ u: 'mock-source', name: 'private mock feed', local: false }], cards: [], created: Date.now(),
  };
  const ownerCard = newsMonitorTest.cardKb(opinionDraft, 'ar', ownerId).inline_keyboard.flat();
  const nonOwnerCard = newsMonitorTest.cardKb(opinionDraft, 'ar', reporter.id).inline_keyboard.flat();
  assert.ok(ownerCard.some((button) => button.callback_data === `nw:op:${opinionId}` && button.text === '🧭 نقد سياسي حاد موثّق'), 'the clearly labeled sharp political-critique preview is offered to the owner');
  assert.ok(ownerCard.some((button) => button.callback_data === `nw:sa:${opinionId}`), 'the fictional-satire preview is offered to the owner');
  assert.equal(nonOwnerCard.some((button) => button.callback_data === `nw:op:${opinionId}`), false, 'the opinion preview is not offered to non-owners');
  assert.equal(nonOwnerCard.some((button) => button.callback_data === `nw:sa:${opinionId}`), false, 'the satire preview is not offered to non-owners');
  const previousRewrite = newsMonitorTest.R.rewriteImpl;
  const rewriteModes = [];
  newsMonitorTest.R.rewriteImpl = async (_source, options) => {
    rewriteModes.push(options.mode);
    return options.mode === 'satire'
      ? 'محاكاة ساخرة خيالية (ليست خبراً): في مسرح الخيال تتحول وعود خفض الأعباء إلى مظلة مثقوبة.'
      : 'رأي/تحليل: قرار خفض الدعم يزيد الأعباء على الأسر وفق الوقائع المنشورة.';
  };
  const opinionCallsStart = calls.length;
  try {
    await tap(`nw:op:${opinionId}`, reporter);
    await tap(`nw:sa:${opinionId}`, reporter);
    assert.deepEqual(rewriteModes, [], 'a non-owner cannot start either private editorial mode');
    await tap(`nw:op:${opinionId}`, owner);
    assert.deepEqual(rewriteModes, ['opinion'], 'the owner button requests the separate opinion mode');
    assert.equal(opinionDraft.aiRewritePreview.mode, 'opinion');
    const previewMessage = calls.slice(opinionCallsStart).find((call) => call.method === 'editMessageText' && call.chatId === ownerId && /معاينة نقد معارض خاصة — لم تُعتمد ولم تُنشر/.test(call.payload.text));
    assert.ok(previewMessage, 'the preview is visibly labeled and remains unpublished');
    assert.equal(opinionDraft.headline, 'إعلان الحكومة الانتقالية خفض الدعم في حمص', 'generating a private critique never changes the factual headline');
    const originalPrivatePreview = opinionDraft.aiRewritePreview.text;
    let editStart = calls.length;
    await tapInChat(`nw:oe:${opinionId}`, owner, { id: -1001001001, type: 'group' });
    assert.equal(opinionDraft.privateEditorialEdit, undefined, 'an owner callback from a group cannot start private editing');
    assert.equal(calls.slice(editStart).some((call) => call.method === 'sendMessage' && /تعديل خاص للرأي/.test(call.payload?.text || '')), false,
      'group chats do not receive the private editing prompt');
    await tap(`nw:oe:${opinionId}`, reporter);
    assert.equal(calls.slice(editStart).some((call) => call.method === 'sendMessage' && call.chatId === reporter.id && /تعديل خاص للرأي/.test(call.payload?.text || '')), false,
      'a non-owner cannot start the manual private editing flow');
    assert.equal(opinionDraft.privateEditorialEdit, undefined, 'a forged non-owner edit callback creates no editing state');
    await tap(`nw:oe:${opinionId}`, owner);
    const editPrompt = [...calls.slice(editStart)].reverse().find((call) => call.method === 'sendMessage' && call.chatId === ownerId);
    assert.match(editPrompt?.payload?.text || '', /تعديل خاص للرأي/);
    assert.equal(editPrompt?.payload?.reply_markup?.force_reply, true, 'manual edits are requested as a private owner reply');
    assert.equal(opinionDraft.privateEditorialEdit?.mode, 'opinion');
    assert.ok(callbacksOf(keyboardAfter(editStart)).includes(`nw:oc:${opinionId}`), 'the preview offers a cancel button while editing');
    await sendTextInChat('يزيد => يضاعف', owner, { id: -1001001001, type: 'group' });
    assert.equal(opinionDraft.aiRewritePreview.text, originalPrivatePreview, 'owner text sent from a group cannot mutate the private preview');
    assert.equal(opinionDraft.privateEditorialEdit?.mode, 'opinion', 'group text cannot close or replace the active private edit session');
    await sendText('/cancel');
    assert.equal(opinionDraft.privateEditorialEdit, undefined, 'the typed cancel command clears the editing session');
    assert.equal(opinionDraft.aiRewritePreview.text, originalPrivatePreview, 'cancelling leaves the private preview unchanged');
    await tap(`nw:oe:${opinionId}`, owner);
    await tap(`nw:oc:${opinionId}`, owner);
    assert.equal(opinionDraft.privateEditorialEdit, undefined, 'the inline cancel button clears the editing session');
    assert.equal(opinionDraft.aiRewritePreview.text, originalPrivatePreview, 'inline cancellation also preserves the text');
    await tap(`nw:oe:${opinionId}`, owner);
    await sendText('يزيد => يضاعف');
    assert.equal(opinionDraft.aiRewritePreview.text, 'رأي/تحليل: قرار خفض الدعم يضاعف الأعباء على الأسر وفق الوقائع المنشورة.',
      'the owner can change an individual word without altering the private tone label or surrounding facts');
    assert.equal(opinionDraft.aiRewritePreview.manuallyEdited, true, 'the saved preview is marked as manually edited');
    assert.equal(opinionDraft.aiRewritePreview.applied, false, 'manual edits do not accept the private draft automatically');
    assert.equal(opinionDraft.privateEditorialEdit, undefined, 'successful edits close the pending editing session');
    assert.equal(opinionDraft.headline, 'إعلان الحكومة الانتقالية خفض الدعم في حمص', 'manual editing cannot change the factual headline');
    const numberGuard = newsMonitorTest.applyPrivateOpinionReplacements('رأي/تحليل: خُفّض الدعم بنسبة 20% في القرار.', '20 => 25');
    assert.equal(numberGuard.ok, false, 'manual edits cannot alter factual numbers');
    assert.equal(numberGuard.reason, 'numbers');
    for (const label of ['رأي:', 'تحليل:']) {
      const variant = newsMonitorTest.applyPrivateOpinionReplacements(`${label} القرار واضح.`, 'واضح => صريح');
      assert.equal(variant.ok, true, `${label} previews remain editable`);
      assert.equal(variant.text, `${label} القرار صريح.`, `${label} is preserved exactly`);
    }
    const editedPreviewMessage = [...calls.slice(editStart)].reverse().find((call) => call.method === 'editMessageText' && call.chatId === ownerId && /يضاعف الأعباء/.test(call.payload.text || ''));
    assert.ok(editedPreviewMessage, 'the updated copy is shown back in the private preview');
    assert.match(editedPreviewMessage.payload.text, /عُدلت الصياغة يدوياً/);
    assert.equal(calls.slice(editStart).some((call) => call.chatId === process.env.CHANNEL_ID), false, 'editing never calls the public channel');
    await tap(`nw:ra:${opinionId}`, owner);
    assert.equal(opinionDraft.aiRewritePreview.applied, true);
    assert.equal(opinionDraft.headline, 'إعلان الحكومة الانتقالية خفض الدعم في حمص', 'applying private critique never replaces the factual headline');
    assert.match(opinionDraft.privateEditorial.opinion, /^رأي\/تحليل:/, 'the owner-only opinion is saved in its private field');
    assert.equal(opinionDraft.editorialHold, true, 'applying opinion sets a review hold');
    assert.equal(nightEligible(opinionDraft), false, 'the applied opinion cannot enter automatic publication');
    const publicDraft = toBotDraft(opinionDraft);
    assert.equal(publicDraft.details, 'إعلان الحكومة الانتقالية خفض الدعم في حمص');
    assert.doesNotMatch(JSON.stringify(publicDraft), /رأي\/تحليل|قرار خفض الدعم يضاعف الأعباء/,
      'toBotDraft carries the factual headline only and excludes the private opinion field');
    const publicInput = buildAlertInput(publicDraft, { id: ownerId, name: 'Local owner' });
    const projection = publicAlert(publicInput);
    const simulatedChannelPost = channelPost({ ...publicInput, place: publicInput.location, timestamp: new Date().toISOString() });
    assert.doesNotMatch(JSON.stringify(projection), /رأي\/تحليل|قرار خفض الدعم يضاعف الأعباء/);
    assert.doesNotMatch(simulatedChannelPost, /رأي\/تحليل|قرار خفض الدعم يضاعف الأعباء/);
    const leakedPublicInput = { ...publicInput, title: 'رأي/تحليل: نص خاص لا يجوز نشره' };
    assert.equal(publicAlert(leakedPublicInput).title, '', 'the public map projection drops an unsafe title');
    assert.throws(() => channelPost(leakedPublicInput), /Private editorial or internal review text/,
      'the final channel-post builder fails closed on private editorial copy');
    assert.throws(() => buildAlertInput({ ...publicDraft, details: 'لا تقدم المادة وقائع موثقة كافية' }, { id: ownerId, name: 'Local owner' }),
      /Private editorial or internal review text/, 'alert construction rejects an internal review diagnostic');
    const alertCountBeforeBlockedInput = store.state.alerts.length;
    await assert.rejects(publishInput(bot.api, leakedPublicInput), /Private editorial or internal review text/,
      'the final manual publishing function rejects private copy before storing or posting it');
    await assert.rejects(publishInput(bot.api, { ...publicInput, meta: { channelTitle: 'رأي/تحليل: نص خاص' } }),
      /Private editorial or internal review text/, 'unsafe metadata is rejected before it can create a map alert');
    assert.equal(store.state.alerts.length, alertCountBeforeBlockedInput, 'a rejected public payload creates no map record');

    await tap(`nw:sa:${opinionId}`, owner);
    assert.deepEqual(rewriteModes, ['opinion', 'satire']);
    assert.equal(callbacksOf(keyboardAfter(opinionCallsStart)).includes(`nw:oe:${opinionId}`), false,
      'manual word editing is specific to opinion/analysis, not the satire preview');
    assert.equal(opinionDraft.headline, 'إعلان الحكومة الانتقالية خفض الدعم في حمص');
    await tap(`nw:ra:${opinionId}`, owner);
    assert.match(opinionDraft.privateEditorial.satire, /^محاكاة ساخرة خيالية \(ليست خبراً\):/);
    assert.equal(nightEligible(opinionDraft), false, 'owner-only satire is also excluded from automatic publishing');
    await tap(`nw:ro:${opinionId}`, owner);
    assert.equal(opinionDraft.privateEditorial.satire, undefined, 'the owner can delete the private satire text');
    assert.ok(opinionDraft.privateEditorial.opinion, 'deleting satire leaves the separate opinion note intact');
    await tap(`nw:op:${opinionId}`, owner);
    assert.deepEqual(rewriteModes, ['opinion', 'satire', 'opinion']);
    await tap(`nw:ra:${opinionId}`, owner);
    await tap(`nw:ro:${opinionId}`, owner);
    assert.equal(opinionDraft.privateEditorial, undefined, 'the owner can delete the private opinion text');
    assert.equal(opinionDraft.headline, 'إعلان الحكومة الانتقالية خفض الدعم في حمص', 'deleting private text preserves the factual headline');
    assert.equal(calls.slice(opinionCallsStart).filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length, 0, 'opinion preview and application never post a public channel message');
  } finally {
    newsMonitorTest.R.rewriteImpl = previousRewrite;
    delete newsState().drafts[opinionId];
  }

  const accidentDraft = newsState().drafts.owner_accident_opinion_forbidden = {
    id: 'owner_accident_opinion_forbidden', type: 'accident', status: 'pending',
    headline: 'حادث سير في حمص أسفر عن إصابة 3 أشخاص مساء اليوم',
    sourceText: 'وقع حادث سير في حمص وأصيب 3 أشخاص، وأعلنت الشرطة تفاصيل التحقيق مساء اليوم.',
    loc: { scope: 'place', name_ar: 'حمص', governorate_ar: 'حمص', latitude: 34.7, longitude: 36.7 },
    extra: [], ttlMin: 360, srcs: [{ u: 'mock-accident-source', local: false }], cards: [],
  };
  const accidentOwnerButtons = newsMonitorTest.cardKb(accidentDraft, 'ar', ownerId).inline_keyboard.flat();
  const accidentReporterButtons = newsMonitorTest.cardKb(accidentDraft, 'ar', reporter.id).inline_keyboard.flat();
  assert.ok(accidentOwnerButtons.some((button) => button.callback_data === `nw:op:${accidentDraft.id}`),
    'the owner sees the sharp-critique option beside the rewrite button even on an unrelated incident');
  assert.ok(accidentOwnerButtons.some((button) => button.callback_data === `nw:sa:${accidentDraft.id}`),
    'the owner sees the labeled fictional-satire option on every rewrite card');
  assert.equal(accidentReporterButtons.some((button) => ['nw:op:' + accidentDraft.id, 'nw:sa:' + accidentDraft.id].includes(button.callback_data)), false,
    'both private tones remain hidden from non-owners');
  for (const type of Object.keys(ALERT_TYPES)) {
    const draft = { id: `tone_controls_${type}`, type, status: 'pending', headline: 'حدث اختباري في حمص', sourceText: 'حدث اختباري في حمص دون صلة بسياسة حكومية.', srcs: [], loc: { scope: 'place', name_ar: 'حمص' } };
    const ownerButtons = newsMonitorTest.cardKb(draft, 'ar', ownerId).inline_keyboard.flat();
    assert.ok(ownerButtons.some((button) => button.callback_data === `nw:op:${draft.id}`), `owner critique option is present for ${type}`);
    assert.ok(ownerButtons.some((button) => button.callback_data === `nw:sa:${draft.id}`), `owner satire option is present for ${type}`);
  }
  const accidentCallsStart = calls.length;
  const publicPostsBeforeAccidentTone = calls.filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length;
  await tap(`nw:op:${accidentDraft.id}`, owner);
  await tap(`nw:sa:${accidentDraft.id}`, owner);
  assert.deepEqual(rewriteModes, ['opinion', 'satire', 'opinion'], 'even forged owner callbacks cannot send a traffic accident to opinion or satire');
  assert.equal(accidentDraft.aiRewritePreview, undefined);
  assert.equal(accidentDraft.headline, 'حادث سير في حمص أسفر عن إصابة 3 أشخاص مساء اليوم');
  const accidentFeedback = calls.slice(accidentCallsStart).filter((call) => call.method === 'answerCallbackQuery').map((call) => call.payload.text || '').join('\n');
  assert.match(accidentFeedback, /حادث|حدث|سياسة حكومية/,
    'the owner gets a private, plain-language explanation when the selected tone has no factual relationship');
  assert.doesNotMatch(accidentFeedback, /non-political-event-source|EDITORIAL_REVIEW_REQUIRED/,
    'internal review diagnostics are not shown in the user-facing explanation');
  assert.equal(calls.filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length, publicPostsBeforeAccidentTone,
    'selecting either political tone for an accident creates no channel post');
  assert.equal(calls.slice(accidentCallsStart).some((call) => call.method === 'sendMessage' && call.chatId === ownerId), false,
    'the failure explanation stays in the private callback response instead of becoming a public or regular post');
  assert.equal(accidentDraft.aiRewritePreview, undefined);
  delete newsState().drafts[accidentDraft.id];

  rewriteModes.length = 0;
  newsMonitorTest.R.rewriteImpl = async (_source, options) => {
    rewriteModes.push(options.mode);
    return options.mode === 'satire'
      ? 'محاكاة ساخرة خيالية (ليست خبراً): في مسرح الخيال تتحول الرسوم إلى مظلة مثقوبة.'
      : 'رأي/تحليل: قرار حكومي محدد يثقل كاهل الأسر وفق المصدر.';
  };
  const breakingSource = 'أعلنت الحكومة الانتقالية قراراً رسمياً بخفض الدعم في محافظة حمص، وفق البيان المنشور اليوم.';
  const breakingDraft = newsState().drafts.owner_breaking_opinion = {
    id: 'owner_breaking_opinion', type: 'breaking', status: 'pending',
    headline: 'قرار رسمي بخفض الدعم في حمص', sourceText: breakingSource,
    loc: { scope: 'place', name_ar: 'حمص', governorate_ar: 'حمص', latitude: 34.7, longitude: 36.7 },
    extra: [], ttlMin: 360, srcs: [{ u: 'mock-breaking-source', name: 'private mock feed', local: false }], cards: [],
  };
  assert.equal(newsMonitorTest.privateEditorialModeApplicable(breakingDraft), true,
    'a verified specific political action can use the private modes across the general breaking-news rewrite flow');
  const breakingOwnerButtons = newsMonitorTest.cardKb(breakingDraft, 'ar', ownerId).inline_keyboard.flat();
  assert.ok(breakingOwnerButtons.some((button) => button.callback_data === `nw:op:${breakingDraft.id}`));
  assert.ok(breakingOwnerButtons.some((button) => button.callback_data === `nw:sa:${breakingDraft.id}`));
  assert.equal(newsMonitorTest.cardKb(breakingDraft, 'ar', reporter.id).inline_keyboard.flat().some((button) => ['nw:op:' + breakingDraft.id, 'nw:sa:' + breakingDraft.id].includes(button.callback_data)), false,
    'the same modes remain owner-only on breaking-news cards');
  await tap(`nw:op:${breakingDraft.id}`, owner);
  assert.deepEqual(rewriteModes, ['opinion']);
  breakingDraft.type = 'accident';
  await tap(`nw:ra:${breakingDraft.id}`, owner);
  assert.equal(breakingDraft.privateEditorial, undefined,
    'a forged type change between preview and apply cannot attach an opinion to a safety report');
  assert.equal(breakingDraft.headline, 'قرار رسمي بخفض الدعم في حمص');
  delete newsState().drafts[breakingDraft.id];

  const protestSource = 'خرجت مظاهرة في حمص احتجاجاً على قرار الحكومة الانتقالية بفرض رسوم جديدة، بحسب بيان المنظمين الصادر اليوم.';
  const protestDraft = newsState().drafts.owner_protest_opinion = {
    id: 'owner_protest_opinion', type: 'protest', status: 'pending',
    headline: 'مظاهرة في حمص احتجاجاً على قرار فرض رسوم جديدة', sourceText: protestSource,
    loc: { scope: 'place', name_ar: 'حمص', governorate_ar: 'حمص', latitude: 34.7, longitude: 36.7 },
    extra: [], ttlMin: 360, srcs: [{ u: 'mock-protest-source', local: false }], cards: [], created: Date.now(),
  };
  assert.equal(newsMonitorTest.privateEditorialModeApplicable(protestDraft), true);
  const protestButtons = newsMonitorTest.cardKb(protestDraft, 'ar', ownerId).inline_keyboard.flat();
  assert.ok(protestButtons.some((button) => button.callback_data === `nw:op:${protestDraft.id}`));
  assert.ok(protestButtons.some((button) => button.callback_data === `nw:sa:${protestDraft.id}`));
  await tap(`nw:sa:${protestDraft.id}`, owner);
  assert.deepEqual(rewriteModes, ['opinion', 'satire']);
  await tap(`nw:ra:${protestDraft.id}`, owner);
  assert.match(protestDraft.privateEditorial.satire, /^محاكاة ساخرة خيالية \(ليست خبراً\):/);
  assert.equal(protestDraft.headline, 'مظاهرة في حمص احتجاجاً على قرار فرض رسوم جديدة',
    'applying satire in the protest workflow never changes the factual public headline');
  assert.doesNotMatch(newsMonitorTest.cardText(protestDraft, 'ar'), /مسرح الخيال|ملاحظة رأي\/سخرية خاصة بالمالك/,
    'shared review cards do not reveal the private owner-only text or its existence');
  delete newsState().drafts[protestDraft.id];
  newsMonitorTest.R.rewriteImpl = previousRewrite;

  const blockedChannelPosts = calls.filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length;
  const blockedAlerts = store.state.alerts.length;
  for (const [id, headline] of [
    ['manual_opinion_leak_block', 'رأي/تحليل: قرار حكومي خيالي يضر الجميع'],
    ['manual_diagnostic_leak_block', 'لا تقدم المادة وقائع موثقة كافية'],
  ]) {
    const unsafe = newsState().drafts[id] = {
      id, type: 'political', status: 'pending', politicalCategory: 'government_announcement', headline,
      sourceText: 'أعلنت الحكومة الانتقالية قراراً رسمياً بشأن الدعم في حمص اليوم.',
      loc: { scope: 'place', name_ar: 'حمص', governorate_ar: 'حمص', latitude: 34.7, longitude: 36.7 },
      extra: [], ttlMin: 360, srcs: [{ u: 'mock-source', local: false }], cards: [],
    };
    await tap(`nw:p:${id}`, owner);
    assert.equal(unsafe.status, 'pending', 'unsafe public copy remains in the review queue');
    assert.equal(unsafe.editorialHoldReason, 'private-editorial-copy-not-public');
    assert.throws(() => toBotDraft(unsafe), /cannot be converted to a public alert/);
    delete newsState().drafts[id];
  }
  assert.equal(store.state.alerts.length, blockedAlerts, 'blocked manual drafts create no map alerts');
  assert.equal(calls.filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length, blockedChannelPosts,
    'opinion and review diagnostics never reach the public channel through manual approval');

  const editorId = 8270709666;
  const editor = { id: editorId, is_bot: false, first_name: 'Local editor', language_code: 'ar' };
  const editorDraftId = 'editor_share_notification';
  const editorDraft = newsState().drafts[editorDraftId] = {
    id: editorDraftId, type: 'assassination', status: 'pending',
    headline: 'اعتقال تجريبي في حارم', body: 'تفاصيل محاكاة: أعلنت جهة عامة عن توقيف شخص في حارم.',
    loc: { scope: 'place', name_ar: 'حارم', name_en: 'Harem', governorate_ar: 'إدلب', governorate_en: 'Idlib' },
    extra: [], ttlMin: 360, srcs: [{ u: 'mock-source', local: false }], cards: [], created: Date.now(),
  };
  await store.addEditor(editorId);
  const editorBeforeAlerts = new Set(store.state.alerts.map((alert) => alert.id));
  const editorChannelBefore = calls.filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length;
  const editorPublishStart = calls.length;
  try {
    await tap(`nw:p:${editorDraftId}`, editor);
    assert.equal(editorDraft.status, 'published');
    const ownerNotice = calls.slice(editorPublishStart).find((call) => call.method === 'sendMessage' && call.chatId === ownerId && /نُشر تنبيه جديد على الخريطة/.test(call.payload.text));
    assert.ok(ownerNotice, 'successful publication by an editor sends a separate private notice to the owner');
    const buttons = ownerNotice.payload.reply_markup.inline_keyboard.flat();
    const whatsapp = buttons.find((button) => button.url?.startsWith('https://wa.me/?text='));
    const map = buttons.find((button) => button.text?.includes('على الخريطة'));
    assert.ok(map?.url, 'the owner notice contains a direct map link for this alert');
    assert.ok(whatsapp, 'the owner notice contains a WhatsApp manual-share button');
    const shareText = new URL(whatsapp.url).searchParams.get('text');
    assert.ok(shareText.includes(editorDraft.headline), 'WhatsApp share text contains the published headline');
    assert.ok(shareText.includes(editorDraft.body), 'WhatsApp share text contains the story details');
    assert.ok(shareText.includes(map.url), 'WhatsApp share text contains the direct map link');
    assert.equal(calls.slice(editorPublishStart).some((call) => /whatsapp/i.test(call.method)), false, 'the bot never sends a WhatsApp message automatically');
    const editorNewAlerts = store.state.alerts.filter((alert) => !editorBeforeAlerts.has(alert.id));
    assert.equal(editorNewAlerts.length, 1, 'the local editor approval creates exactly one mock map alert');
    addedAlertIds.push(...editorNewAlerts.map((alert) => alert.id));
    assert.equal(calls.filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length, editorChannelBefore + 1, 'the editor action creates one intercepted mock channel post');
  } finally {
    await store.removeEditor(editorId);
    delete newsState().drafts[editorDraftId];
  }
});

test('news draft ignore action marks the draft ignored without publishing it', async () => {
  const draftId = 'ignore_action_check';
  const beforeAlerts = store.state.alerts.length;
  const beforeChannelPosts = calls.filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length;
  const beforeIgnored = newsState().stats.ignored || 0;
  newsState().drafts[draftId] = {
    id: draftId,
    type: 'assassination',
    status: 'pending',
    headline: 'مسودة محلية لاختبار التجاهل',
    body: '',
    loc: { scope: 'place', name_ar: 'حارم', name_en: 'Harem', governorate_ar: 'إدلب', governorate_en: 'Idlib' },
    extra: [],
    ttlMin: 360,
    srcs: [{ u: 'mock-source', local: false }],
    cards: [],
    created: Date.now(),
  };

  const checkStart = calls.length;
  await tap(`nw:c:${draftId}`);
  const checkReply = calls.slice(checkStart).find((call) => call.method === 'sendMessage' && call.chatId === ownerId);
  assert.ok(checkReply, 'channel check result is sent before the ignore decision');
  const checkMessageId = messageId;
  const ignoreStart = calls.length;
  await tap(`nw:x:${draftId}`, owner, bot, checkMessageId);

  assert.equal(newsState().drafts[draftId].status, 'ignored', 'ignore callback moves a pending draft to ignored');
  assert.equal(newsState().drafts[draftId].by, ownerId, 'the moderator who ignored it is recorded');
  assert.equal(newsState().stats.ignored, beforeIgnored + 1, 'ignored statistics increment once');
  assert.equal(store.state.alerts.length, beforeAlerts, 'ignoring does not create a map alert');
  assert.equal(calls.filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length, beforeChannelPosts, 'ignoring does not publish to the Telegram channel');
  assert.ok(calls.slice(ignoreStart).some((call) => call.method === 'deleteMessage' && call.payload.message_id === checkMessageId), 'ignoring from the check result removes its stale buttons');
  assert.equal(newsState().drafts[draftId].cards.some(([, id]) => id === checkMessageId), false, 'the deleted ignore result is removed from persisted card tracking');
});

test('professional rewrite is a comparison preview, requires a separate apply action, and can restore the original', async (t) => {
  const draftId = 'rewrite_human_approval';
  const original = 'خبر مصدره محلي يذكر وقوع اشتباك قرب حارم مساء اليوم.';
  const rewritten = 'أفاد بوقوع اشتباك قرب حارم مساء اليوم.';
  let receivedSource = '';
  const channelPostsBefore = calls.filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length;
  newsMonitorTest.R.rewriteImpl = async (source) => { receivedSource = source; return rewritten; };
  newsState().drafts[draftId] = {
    id: draftId, type: 'attack', status: 'pending', headline: 'اشتباك قرب حارم', sourceText: original,
    loc: { scope: 'place', name_ar: 'حارم', name_en: 'Harem', governorate_ar: 'إدلب', governorate_en: 'Idlib' },
    extra: [], ttlMin: 180, srcs: [{ u: 'mock-source', name: 'مصدر محلي', local: false }],
    cards: [[ownerId, 745]], created: Date.now(),
  };
  t.after(() => { newsMonitorTest.R.rewriteImpl = null; delete newsState().drafts[draftId]; });

  const previewStart = calls.length;
  await tap(`nw:rw:${draftId}`, owner, bot, 745);
  assert.equal(receivedSource, original, 'the provider receives the stored source text, not another draft');
  assert.equal(newsState().drafts[draftId].headline, 'اشتباك قرب حارم', 'requesting a rewrite does not alter the draft');
  const preview = calls.slice(previewStart).find((call) => call.method === 'editMessageText');
  assert.match(preview?.payload?.text || '', /النص الأصلي من المصدر/);
  assert.match(preview?.payload?.text || '', /لم تُعتمد ولم تُنشر/);
  assert.match(preview?.payload?.text || '', new RegExp(rewritten));
  assert.doesNotMatch(preview?.payload?.text || '', /مصدر محلي/,
    'the private monitoring-feed identity is removed from rewrite previews');
  assert.ok(callbacksOf(keyboardAfter(previewStart)).includes(`nw:ra:${draftId}`), 'the preview requires an explicit apply button');
  assert.equal(newsState().drafts[draftId].status, 'pending');

  await tap(`nw:ra:${draftId}`, owner, bot, 745);
  assert.equal(newsState().drafts[draftId].headline, rewritten, 'apply changes only the pending draft headline');
  assert.equal(newsState().drafts[draftId].originalHeadline, 'اشتباك قرب حارم', 'the previous wording remains available for comparison');
  assert.equal(newsState().drafts[draftId].sourceText, original, 'the original source text is not overwritten');
  assert.equal(newsState().drafts[draftId].status, 'pending', 'applying a rewrite does not publish');
  assert.equal(calls.filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length, channelPostsBefore, 'applying a rewrite makes no channel post');

  await tap(`nw:ro:${draftId}`, owner, bot, 745);
  assert.equal(newsState().drafts[draftId].headline, 'اشتباك قرب حارم', 'the original headline can be restored');
  assert.equal(newsState().drafts[draftId].status, 'pending');
});

test('startup keyboard sync updates only existing pending review cards', async (t) => {
  const pendingId = 'existing_pending_keyboard_sync';
  const ignoredId = 'existing_ignored_keyboard_sync';
  const testId = 'existing_test_keyboard_sync';
  const previousHelpers = newsMonitorTest.R.H;
  const edits = [];
  newsMonitorTest.R.H = { apis: () => ({ admin: { editMessageReplyMarkup: async (chat, messageId, options) => edits.push({ chat, messageId, options }) } }) };
  const makeDraft = (id, status, test = false) => ({
    id, type: 'attack', status, ...(test ? { test: true } : {}), headline: 'Review wording unchanged',
    loc: { scope: 'country' }, extra: [], srcs: [], cards: [[ownerId, id === pendingId ? 88001 : id === ignoredId ? 88002 : 88003]],
  });
  newsState().drafts[pendingId] = makeDraft(pendingId, 'pending');
  newsState().drafts[ignoredId] = makeDraft(ignoredId, 'ignored');
  newsState().drafts[testId] = makeDraft(testId, 'pending', true);
  t.after(() => {
    newsMonitorTest.R.H = previousHelpers;
    delete newsState().drafts[pendingId];
    delete newsState().drafts[ignoredId];
    delete newsState().drafts[testId];
  });

  await newsMonitorTest.refreshPendingCardKeyboards();
  assert.ok(edits.some((edit) => edit.chat === ownerId && edit.messageId === 88001), 'an existing pending review card gets its current keyboard');
  assert.equal(edits.some((edit) => edit.messageId === 88002 || edit.messageId === 88003), false, 'ignored and test drafts are untouched');
  const updated = edits.find((edit) => edit.messageId === 88001);
  const callbacks = callbacksOf(updated.options.reply_markup.inline_keyboard);
  assert.ok(callbacks.includes(`nw:rw:${pendingId}`));
  assert.ok(callbacks.includes(`nw:c:${pendingId}`));
  assert.equal(Object.hasOwn(updated.options, 'text'), false, 'keyboard sync does not change card text');
});

test('clashes channel posts keep the dedicated label instead of the generic attack label', () => {
  const input = buildAlertInput({ type: 'clashes', location: { scope: 'country' }, extra: [], ttlMin: 240 }, { id: ownerId, name: 'test' });
  const post = channelPost({ ...input, id: 'test-clashes-label', timestamp: new Date().toISOString(), place: { scope: 'country' } });
  assert.equal(input.type, 'clashes');
  assert.match(post, /<b>اشتباكات مسلحة<\/b>/);
  assert.doesNotMatch(post, /<b>هجوم<\/b>/);
});

test('bot menus hide route creation while preserving regular aerial reports and historical movement data', async () => {
  const sendPoint = (user, targetBot) => targetBot.handleUpdate({
    update_id: updateId++,
    message: { message_id: ++messageId, date: 0, chat: { id: user.id, type: 'private' }, from: user,
      location: { latitude: 32.1234567, longitude: 34.8765432 } },
  });
  const lastText = () => [...calls].reverse().find(({ payload }) => typeof payload.text === 'string')?.payload.text || '';
  const buttons = () => [...calls].reverse().find(({ method }) => method === 'sendMessage' || method === 'editMessageText')?.payload.reply_markup?.inline_keyboard?.flat() || [];
  const start = calls.length;
  const freshReporter = { ...reporter, id: 999000000001 };
  for (const [user, targetBot] of [[owner, bot], [freshReporter, reportBot]]) {
    await tap('home', user, targetBot);
    await tap('ag:aerial', user, targetBot);
    assert.equal(buttons().some((button) => button.callback_data === 't:air_movement'), false, 'neither bot offers the direction button');
    const staleCallbackStart = calls.length;
    await tap('t:air_movement', user, targetBot);
    assert.equal(calls.slice(staleCallbackStart).filter(({ method }) => method === 'sendMessage' || method === 'editMessageText').length, 0, 'stale direction buttons cannot create new reports');

    await tap('home', user, targetBot);
    await tap('ag:aerial', user, targetBot);
    await tap('t:warplane', user, targetBot);
    assert.doesNotMatch(lastText(), /باتجاه سوريا \/ محافظة|Toward Syria \/ governorate/, 'the removed direction button is not mentioned in the prompt');
    assert.ok(buttons().some((button) => button.callback_data === 'airmode:over'));
    assert.equal(buttons().some((button) => button.callback_data === 'airmode:move'), false);
    await tap('airmode:over', user, targetBot);
    assert.match(lastText(), /اختر المحافظة/);
    assert.equal(buttons().some((button) => button.callback_data?.startsWith('flight:')), false);
    await sendPoint(user, targetBot);
    assert.match(lastText(), /خارج|ضمن|سوريا/, 'ordinary over-area alerts retain their location validation');
    await tap('cancel', user, targetBot);
  }
  assert.equal(calls.slice(start).some(({ chatId }) => chatId === '@mock_news_channel'), false, 'command and menu checks do not publish to the channel');
  const source = fs.readFileSync(new URL('../server/bot.js', import.meta.url), 'utf8');
  assert.match(source, /type === 'air_movement'[\s\S]{0,200}لم يعد متاحاً/);
  assert.match(source, /aerial: Object\.freeze\(ALERT_GROUPS\.aerial\.types\.filter\(\(type\) => type !== 'uav_strike' && type !== 'air_movement'\)\)/);
});


test('public reporters can attach a photo and video to one pending report before manual review', async (t) => {
  fs.mkdirSync(dataDir, { recursive: true });
  const mediaReporter = { id: 8270709661, is_bot: false, first_name: 'Media reporter', language_code: 'ar' };
  const reportIdsBefore = new Set(Object.keys(store.state.reports || {}));
  const start = calls.length;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const video = String(url).includes('/videos/');
    return new Response(Buffer.from(video ? 'local-video-bytes' : 'local-photo-bytes'), {
      status: 200,
      headers: { 'content-length': '17', 'content-type': video ? 'video/mp4' : 'image/jpeg' },
    });
  };
  let rid = null;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (rid && store.reportGet(rid)) store.reportTake(rid);
    await new Promise((resolve) => setTimeout(resolve, 350));
  });

  await tap('home', mediaReporter, reportBot);
  await tap('ag:protests', mediaReporter, reportBot);
  await tap('t:protest_action', mediaReporter, reportBot);
  const gov = governorates.find((item) => item.ar === 'حلب') || governorates[0];
  await tap(`g:${gov.code}`, mediaReporter, reportBot);
  await tap(`wg:${gov.code}`, mediaReporter, reportBot);
  await tap('skip', mediaReporter, reportBot);
  await tap('attachmedia', mediaReporter, reportBot);
  await sendPhoto(mediaReporter, reportBot, 'report-photo-e2e');
  const previewWithPhoto = [...calls.slice(start)].reverse().find(({ method }) => method === 'sendMessage' || method === 'editMessageText');
  assert.match(previewWithPhoto?.payload?.text || '', /مرفق صورة/);
  assert.ok(previewWithPhoto?.payload?.reply_markup?.inline_keyboard?.flat().some((button) => button.callback_data === 'attachmedia'), 'the reporter can add another media type after the first attachment');
  await tap('attachmedia', mediaReporter, reportBot);
  await sendVideo(mediaReporter, reportBot, 'report-video-e2e');
  const preview = [...calls.slice(start)].reverse().find(({ method }) => method === 'sendMessage' || method === 'editMessageText');
  assert.match(preview?.payload?.text || '', /مرفق صورة \+ فيديو/);
  assert.ok(preview?.payload?.reply_markup?.inline_keyboard?.flat().some((button) => button.callback_data === 'submit'));
  await tap('submit', mediaReporter, reportBot);

  rid = Object.keys(store.state.reports || {}).find((id) => !reportIdsBefore.has(id));
  assert.ok(rid, 'the report with both attachments is retained for manual review');
  const pending = store.reportGet(rid);
  const pendingMedia = pending.draft.media_items;
  assert.deepEqual(pendingMedia.map((item) => item.type), ['photo', 'video']);
  assert.ok(pendingMedia.every((item) => item.bot_role === 'admin'), 'reviewers receive media with file identifiers owned by the admin bot');
  assert.ok(calls.slice(start).some(({ method, chatId, payload }) => method === 'sendPhoto' && chatId === ownerId && payload.caption === '📎 مرفق البلاغ'), 'reviewers receive the photo before the decision card');
  assert.ok(calls.slice(start).some(({ method, chatId, payload }) => method === 'sendVideo' && chatId === ownerId && payload.caption === '📎 مرفق البلاغ'), 'reviewers receive the video before the decision card');
  const projectedPending = publicAlert(buildAlertInput(pending.draft, pending.from));
  assert.deepEqual(projectedPending.media_items.map((item) => item.type), ['photo', 'video']);
  assert.equal(projectedPending.media_items.some((item) => Object.hasOwn(item, 'file_id')), false, 'Telegram file identifiers are never exposed to map clients');
  assert.equal(JSON.stringify(projectedPending).includes('report-photo-e2e'), false);
  assert.equal(JSON.stringify(projectedPending).includes('report-video-e2e'), false);
  assert.equal(calls.slice(start).some(({ chatId }) => chatId === '@mock_news_channel'), false, 'the synthetic report remains pending and is never published');
  assert.equal(store.reportDone(rid), false, 'the report is still awaiting an editor decision');
});

test('news text and details accept short and long input without a custom character limit', async () => {
  const longDetails = 'تفصيل '.repeat(399) + 'النهاية';
  const testGov = governorates.find((governorate) => governorate.ar === 'إدلب');
  assert.ok(testGov, 'a governorate is available for the details flow');
  const lastPrivateScreen = (start) => [...calls.slice(start)].reverse().find(({ method, chatId }) =>
    ['sendMessage', 'editMessageText'].includes(method) && chatId === ownerId);

  let start = calls.length;
  await tap('t:breaking');
  await sendText(longDetails);
  await tap('noloc');
  let screen = lastPrivateScreen(start);
  assert.ok(screen?.payload?.text.includes(longDetails), 'breaking-news text beyond 900 and 2,000 characters is preserved');
  assert.equal(calls.slice(start).some(({ chatId }) => chatId === '@mock_news_channel'), false, 'the synthetic draft is not published');
  await tap('cancel');

  start = calls.length;
  await tap('t:attack');
  await tap(`g:${testGov.code}`);
  await tap(`wg:${testGov.code}`);
  await sendText('س');
  screen = lastPrivateScreen(start);
  assert.ok(screen?.payload?.text.includes('📝 <b>التفاصيل:</b> س'), 'a one-character detail is accepted without a minimum');
  await tap('cancel');

  start = calls.length;
  await tap('t:attack');
  await tap(`g:${testGov.code}`);
  await tap(`wg:${testGov.code}`);
  await sendText(longDetails);
  screen = lastPrivateScreen(start);
  assert.ok(screen?.payload?.text.includes(longDetails), 'long details are preserved in the preview');
  assert.equal(calls.slice(start).some(({ chatId }) => chatId === '@mock_news_channel'), false, 'the synthetic detail draft is not published');
  await tap('cancel');
});

test('admins can add a video to the map without changing the existing channel post', async (t) => {
  fs.mkdirSync(dataDir, { recursive: true });
  const source = buildAlertInput({ type: 'uav', location: { scope: 'country' }, extra: [], ttlMin: 60 }, { id: ownerId, name: 'Local owner' });
  const alert = store.addAlert(source);
  store.updateAlert(alert.id, { channel_message_id: 9000001, channel_media: 'text' });
  const start = calls.length;
  t.after(async () => {
    store.deleteAlert(alert.id);
    await new Promise((resolve) => setTimeout(resolve, 350));
  });

  await tap(`m:${alert.id}`, owner, bot);
  const menu = [...calls.slice(start)].reverse().find(({ method }) => method === 'sendMessage' || method === 'editMessageText');
  assert.ok(menu?.payload?.reply_markup?.inline_keyboard?.flat().some((button) => button.callback_data === `alertmedia:${alert.id}`), 'active alert management exposes the admin media button');
  await tap(`alertmedia:${alert.id}`, owner, bot);
  await sendVideo(owner, bot, 'admin-video-e2e');

  const saved = store.getAlert(alert.id);
  assert.equal(saved.channel_media, 'text', 'adding map media does not alter the existing channel post');
  assert.equal(saved.channel_message_id, 9000001, 'the original channel message remains in place');
  assert.equal(saved.media?.type, 'video');
  assert.deepEqual(saved.media_items.map((item) => item.type), ['video']);
  assert.equal(calls.slice(start).some(({ chatId }) => chatId === '@mock_news_channel'), false, 'map media updates never replace or repost an existing channel message');
  assert.equal(calls.slice(start).some(({ method, payload }) => method === 'deleteMessage' && payload.message_id === 9000001), false, 'the old channel post is not deleted');
  const confirmation = [...calls.slice(start)].reverse().find(({ method }) => method === 'sendMessage' || method === 'editMessageText')?.payload?.text || '';
  assert.match(confirmation, /حُفظ الوسيط على الخريطة/);
});

test('ministry-condolence source enables owner-only opinion and satire without changing or publishing the factual report', async () => {
  const sourceText = 'تقدمت وزارة الصحة السورية بالتعازي إلى أسر ضحايا حادث سير في حمص، وفق بيانها المنشور اليوم؛ ولا يذكر المصدر صلة الوزارة بوقوع الحادث.';
  const factualHeadline = 'وزارة الصحة السورية تقدم التعازي لأسر ضحايا حادث سير في حمص';
  const opinionId = 'synthetic_ministry_condolence_opinion';
  const satireId = 'synthetic_ministry_condolence_satire';
  const drafts = [opinionId, satireId].map((id) => ({
    id, type: 'accident', status: 'pending', headline: factualHeadline, sourceText,
    loc: { scope: 'place', name_ar: 'حمص', name_en: 'Homs', governorate_ar: 'حمص', governorate_en: 'Homs', latitude: 34.7, longitude: 36.7 },
    extra: [], ttlMin: 360, srcs: [{ u: 'synthetic-ministry-source', name: 'synthetic source', local: false }], cards: [], created: Date.now(),
  }));
  const previousRewrite = newsMonitorTest.R.rewriteImpl;
  const generatedModes = [];
  const start = calls.length;
  const publicPostsBefore = calls.filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length;
  newsMonitorTest.R.rewriteImpl = async (_source, { mode }) => {
    generatedModes.push(mode);
    return mode === 'satire'
      ? 'محاكاة ساخرة خيالية (ليست خبراً): في مسرح الخيال تتحول الوزارة إلى لافتة كبيرة فوق باب مغلق.'
      : 'رأي/تحليل: بيان التعزية وحده لا يجيب عن أسئلة الناس، وهذا رأي معارض لا خبر جديد.';
  };
  for (const draft of drafts) newsState().drafts[draft.id] = draft;
  try {
    for (const draft of drafts) assert.equal(newsMonitorTest.privateEditorialModeApplicable(draft), true,
      'an explicit ministry mention is sufficient even when the source denies a causal link to the accident');
    await tapInChat(`nw:op:${opinionId}`, owner, { id: -1001001001, type: 'group' });
    assert.deepEqual(generatedModes, [], 'a group callback cannot start a private owner critique');
    assert.equal(drafts[0].aiRewritePreview, undefined);

    await tap(`nw:op:${opinionId}`, owner);
    assert.deepEqual(generatedModes, ['opinion']);
    const opinionPreview = [...calls.slice(start)].reverse().find((call) => call.method === 'editMessageText' && call.chatId === ownerId && /معاينة نقد معارض خاصة — لم تُعتمد ولم تُنشر/.test(call.payload.text));
    assert.ok(opinionPreview, 'the critique preview is shown only in the owner’s private chat');
    assert.equal(drafts[0].headline, factualHeadline, 'generating an opinion leaves the factual headline unchanged');
    const beforeGroupApply = calls.length;
    await tapInChat(`nw:ra:${opinionId}`, owner, { id: -1001001001, type: 'group' });
    assert.equal(drafts[0].aiRewritePreview.applied, false, 'group callbacks cannot apply a private preview');
    assert.equal(calls.slice(beforeGroupApply).some((call) => call.chatId === -1001001001 && /رأي\/تحليل:/.test(call.payload?.text || '')), false,
      'no opinion text is sent to a group');
    await tap(`nw:ra:${opinionId}`, owner);
    assert.equal(drafts[0].privateEditorial.opinion, drafts[0].aiRewritePreview.text);
    assert.equal(drafts[0].headline, factualHeadline, 'applying a critique saves it separately from the factual report');
    assert.equal(drafts[0].editorialHold, true, 'the existing manual-review hold remains active');
    assert.equal(nightEligible(drafts[0]), false, 'the opinion cannot enter automatic publication');

    const satireStart = calls.length;
    await tap(`nw:sa:${satireId}`, owner);
    assert.deepEqual(generatedModes, ['opinion', 'satire']);
    const satirePreview = [...calls.slice(satireStart)].reverse().find((call) => call.method === 'editMessageText' && call.chatId === ownerId && /معاينة محاكاة ساخرة خيالية خاصة — ليست خبراً/.test(call.payload.text));
    assert.ok(satirePreview, 'the fictional satire preview is clearly labeled and private to the owner');
    await tap(`nw:ra:${satireId}`, owner);
    assert.match(drafts[1].privateEditorial.satire, /^محاكاة ساخرة خيالية \(ليست خبراً\):/);
    assert.equal(drafts[1].headline, factualHeadline, 'applying satire also leaves the factual report unchanged');
    assert.equal(nightEligible(drafts[1]), false, 'the satire cannot enter automatic publication');

    for (const draft of drafts) {
      const publicDraft = toBotDraft(draft);
      assert.equal(publicDraft.details, factualHeadline);
      assert.doesNotMatch(JSON.stringify(publicDraft), /رأي\/تحليل:|محاكاة ساخرة خيالية/,
        'the public bot draft contains factual wording only');
    }
    assert.equal(calls.filter((call) => call.method === 'sendMessage' && call.chatId === process.env.CHANNEL_ID).length, publicPostsBefore,
      'neither preview nor private application posts to Telegram');
    assert.equal(calls.slice(start).some((call) => call.chatId === -1001001001 && /محاكاة ساخرة خيالية|رأي\/تحليل:/.test(call.payload?.text || '')), false,
      'neither private tone is sent to a group');
  } finally {
    newsMonitorTest.R.rewriteImpl = previousRewrite;
    for (const draft of drafts) delete newsState().drafts[draft.id];
  }
});
