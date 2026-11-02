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
const { buildAlertInput, createBot, channelKeyboard, channelPost, BOT_ALERT_MENU_GROUPS, BOT_ALERT_MENU_DIRECT_TYPES } = await import('../server/bot.js');
const { BORDER_MARKERS, ALERT_TYPES, ALERT_GROUPS, POLITICAL_CATEGORIES } = await import('../shared/types.js');
const { NEWS_TYPES } = await import('../server/news-ai.js');
const { governorates } = await import('../server/places.js');
const { newsState, sendTestDraft, toBotDraft } = await import('../server/news-monitor.js');
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

test('report menus expose every current alert type and keep aerial movement reachable', async () => {
  const routedTypes = [...BOT_ALERT_MENU_DIRECT_TYPES, ...Object.values(BOT_ALERT_MENU_GROUPS).flat()];
  assert.equal(new Set(routedTypes).size, routedTypes.length, 'each alert type has exactly one report-menu route');
  assert.deepEqual([...routedTypes].sort(), Object.keys(ALERT_TYPES).sort(), 'the current menu covers the full shared alert registry');

  let start = calls.length;
  await tap('home');
  const top = callbacksOf(keyboardAfter(start));
  for (const callback of ['t:breaking', 't:political', 'ag:aerial', 'target', 'ag:strikes', 'mi', 't:patrol', 'cv', 'sm', 'ag:nature', 't:border']) {
    assert.ok(top.includes(callback), `main menu includes ${callback}`);
  }
  assert.equal(top.includes('t:air_movement'), false, 'air movement is chosen inside the aerial group, not misrouted directly');
  start = calls.length;
  await tap('mi');
  assert.deepEqual(callbacksOf(keyboardAfter(start)).filter((value) => value.startsWith('mi:')).sort(), ['mi:soldiers', 'mi:vehicles'], 'incursion menu separates soldiers from vehicle counts');

  const menus = [
    ['ag:aerial', 'aerial'], ['target', 'targeting'], ['ag:strikes', 'strikes'],
    ['cv', 'civil'], ['sm', 'smuggling'], ['ag:nature', 'nature'],
  ];
  for (const [callback, group] of menus) {
    start = calls.length;
    await tap(callback);
    const children = callbacksOf(keyboardAfter(start)).filter((value) => value.startsWith('t:')).sort();
    assert.deepEqual(children, BOT_ALERT_MENU_GROUPS[group].map((type) => `t:${type}`).sort(), `${group} buttons route to their own alert types`);
  }
});

test('public report bot exposes every current category and sends a clashes report only to review', async (t) => {
  const publicReporter = { id: 8270709635, is_bot: false, first_name: 'Local clash reporter', language_code: 'ar' };
  const currentUi = () => [...calls].reverse().find(({ method }) => method === 'sendMessage' || method === 'editMessageText');
  const currentButtons = () => currentUi()?.payload?.reply_markup?.inline_keyboard?.flat() || [];
  const routedTypes = [...BOT_ALERT_MENU_DIRECT_TYPES, ...Object.values(BOT_ALERT_MENU_GROUPS).flat()];
  assert.deepEqual([...routedTypes].sort(), Object.keys(ALERT_TYPES).sort(), 'the public menu routes every alert type exactly once');

  let start = calls.length;
  await tap('home', publicReporter, reportBot);
  const top = callbacksOf(keyboardAfter(start));
  for (const callback of ['t:breaking', 't:political', 'ag:aerial', 'target', 'ag:strikes', 'mi', 't:patrol', 'cv', 'sm', 'ag:nature', 't:border']) {
    assert.ok(top.includes(callback), `public main menu includes ${callback}`);
  }
  start = calls.length;
  await tap('mi', publicReporter, reportBot);
  assert.deepEqual(callbacksOf(keyboardAfter(start)).filter((value) => value.startsWith('mi:')).sort(), ['mi:soldiers', 'mi:vehicles'], 'public incursion menu separates soldiers from vehicle counts');
  for (const adminOnly of ['active', 'clr', 'bd', 'editors', 'stats', 'nws', 'px', 'pwr', 'qk', 'wx', 'wxb']) {
    assert.equal(top.includes(adminOnly), false, `public bot does not expose admin action ${adminOnly}`);
  }

  const menus = [
    ['ag:aerial', 'aerial'], ['target', 'targeting'], ['ag:strikes', 'strikes'],
    ['cv', 'civil'], ['sm', 'smuggling'], ['ag:nature', 'nature'],
  ];
  for (const [callback, group] of menus) {
    start = calls.length;
    await tap(callback, publicReporter, reportBot);
    const children = callbacksOf(keyboardAfter(start)).filter((value) => value.startsWith('t:')).sort();
    assert.deepEqual(children, BOT_ALERT_MENU_GROUPS[group].map((type) => `t:${type}`).sort(), `public ${group} submenu routes every type`);
  }

  const reportIdsBefore = new Set(Object.keys(store.state.reports || {}));
  const activeBefore = store.activeAlerts().length;
  start = calls.length;
  await tap('home', publicReporter, reportBot);
  await tap('ag:strikes', publicReporter, reportBot);
  assert.ok(currentButtons().some((button) => button.callback_data === 't:clashes' && button.text?.includes('اشتباكات')), 'clashes has its own public button');
  await tap('t:clashes', publicReporter, reportBot);
  const gov = governorates.find((item) => item.ar === 'حلب') || governorates[0];
  await tap(`g:${gov.code}`, publicReporter, reportBot);
  await tap(`wg:${gov.code}`, publicReporter, reportBot);
  await tap('skip', publicReporter, reportBot);
  assert.match(currentUi()?.payload?.text || '', /اشتباكات مسلحة/, 'the public preview retains the dedicated category label');
  assert.ok(currentButtons().some((button) => button.callback_data === 'submit'), 'the public flow offers submit-for-review, not publish');
  await tap('submit', publicReporter, reportBot);

  const rid = Object.keys(store.state.reports || {}).find((id) => !reportIdsBefore.has(id));
  assert.ok(rid, 'submission is saved as a pending report for editors');
  const pending = store.reportGet(rid);
  assert.equal(pending.draft.type, 'clashes');
  assert.equal(pending.draft.mode, 'report');
  assert.equal(store.activeAlerts().length, activeBefore, 'a public report is not auto-published to the map');
  assert.equal(calls.slice(start).some(({ method, chatId }) => method === 'sendMessage' && chatId === '@mock_news_channel'), false, 'a public report is not posted to the channel before review');
  t.after(async () => {
    store.reportTake(rid);
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
});

test('news-monitor category menus cover every monitored type and save the selected type key', async (t) => {
  const { id } = await sendTestDraft(ownerId);
  t.after(() => { delete newsState().drafts[id]; });

  let start = calls.length;
  await tap(`nw:t:${id}`);
  const groupCallbacks = callbacksOf(keyboardAfter(start)).filter((value) => value.startsWith(`nw:tg:${id}:`));
  const groups = groupCallbacks.map((value) => value.split(':').at(-1));
  const draftTypeCallbacks = [];
  for (const group of groups) {
    start = calls.length;
    await tap(`nw:tg:${id}:${group}`);
    draftTypeCallbacks.push(...callbacksOf(keyboardAfter(start)).filter((value) => value.startsWith(`nw:s:${id}:`)));
  }
  assert.deepEqual(draftTypeCallbacks.sort(), NEWS_TYPES.map((type) => `nw:s:${id}:${type}`).sort(), 'each current monitor type is selectable under exactly one group');

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

  await tap(`nw:tg:${id}:aerial`);
  await tap(`nw:s:${id}:helicopter`);
  assert.equal(newsState().drafts[id].type, 'helicopter', 'the selected button stores the exact category key on the local test draft');
  await tap(`nw:tg:${id}:other`);
  await tap(`nw:s:${id}:patrol`);
  assert.equal(newsState().drafts[id].type, 'patrol', 'patrol appears in the current monitored-type menu as its own category');
  const pluralPatrol = toBotDraft({ type: 'patrol', headline: 'رصد دوريات عسكرية في محيط بلدة كودنة' });
  assert.equal(pluralPatrol.patrolForm, 'plural', 'the monitoring draft preserves plural patrol wording for the map title');
  assert.equal(toBotDraft({ type: 'patrol', headline: 'رصد دورية عسكرية قرب كودنة' }).patrolForm, 'singular');
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
  assert.match(politicalPost, /موقع غير محدد — دون دبوس/);
  assert.match(politicalPost, /الفئة:<\/b> مفاوضات أو اتفاق/);
  assert.match(politicalPost, /🔎 <b>المصدر:<\/b> &lt;Official source&gt;/);
  assert.doesNotMatch(politicalPost, /<a\b|href=/, 'political source is plain text with no clickable link');
  assert.match(politicalPost, /&lt;Official source&gt;/, 'source labels are escaped in channel HTML');
  assert.match(politicalPost, /تاريخ المصدر/);
  assert.match(politicalPost, /منقول بحسب المصدر؛ لم يُسجّل تحقق مستقل/);
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
  assert.equal(buttons().some((button) => ['t:civil', 't:accident', 't:fire', 't:protest', 't:civil_plane', 't:arrest', 't:death', 't:martyrdom', 't:brawl', 't:shooting'].includes(button.callback_data)), false, 'civil choices stay inside the civil submenu');
  assert.equal(buttons().some((button) => button.callback_data === 't:air_movement'), false, 'aircraft direction is selected inside warplane/drone options, not as a separate main button');
  await tap('ag:aerial', reporter, reportBot);
  for (const type of ['t:warplane', 't:uav', 't:helicopter', 't:air_movement']) assert.ok(buttons().some((button) => button.callback_data === type), `aerial submenu contains ${type}`);
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
  assert.equal(buttons().some((button) => button.callback_data === 'mi:general'), false, 'the obsolete general-incursion button is not displayed');
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
  for (const callback of ['t:accident', 't:fire', 't:protest', 't:civil_plane', 't:arrest', 't:death', 't:martyrdom', 't:brawl', 't:shooting', 't:civil']) {
    assert.ok(buttons().some((button) => button.callback_data === callback), `civil submenu includes ${callback}`);
  }
  assert.ok(buttons().some((button) => button.callback_data === 't:brawl' && button.text?.includes('مشاجرة')));
  assert.ok(buttons().some((button) => button.callback_data === 't:shooting' && button.text?.includes('إطلاق نار')));
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
  assert.ok(buttons().some((button) => button.callback_data === 'airmode:move'));
  await tap('airmode:over');
  assert.match(lastUi().payload.text, /اختر المحافظة/);
  assert.equal(buttons().some((button) => button.callback_data?.startsWith('flight:')), false, 'warplane over area skips movement choices');

  await tap('home', reporter, reportBot);
  await tap('ag:aerial', reporter, reportBot);
  await tap('t:uav', reporter, reportBot);
  assert.ok(buttons().some((button) => button.callback_data === 'airmode:over'));
  assert.ok(buttons().some((button) => button.callback_data === 'airmode:move'));
  await tap('airmode:move', reporter, reportBot);
  assert.ok(buttons().some((button) => button.callback_data === 'flight:toward_syria'));
  assert.ok(buttons().some((button) => button.callback_data === 'flight:entering_syria'));
  assert.ok(buttons().some((button) => button.callback_data === 'flight:leaving_syria'));
  assert.equal(buttons().some((button) => button.callback_data === 'flight:from_area'), false, 'hovering over an area remains its own alert type');
  await tap('flight:entering_syria', reporter, reportBot);
  assert.match(lastUi().payload.text, /اختر المنطقة التي يتجه إليها الطيران/);
  assert.ok(buttons().some((button) => button.callback_data?.startsWith('g:')), 'movement reports offer a governorate selector for the target area');
  assert.ok(buttons().some((button) => button.callback_data === 'flightdest:none'), 'reporters can keep the direction general');
  await tap('flightdest:none', reporter, reportBot);
  assert.match(lastUi().payload.text, /بلا تحديد منطقة أو دبوس/);
  await tap('skip', reporter, reportBot);
  assert.match(lastUi().payload.text, /بلا تحديد منطقة أو دبوس/);

  const idlib = governorates.find((g) => g.ar === 'إدلب');
  assert.ok(idlib, 'Idlib governorate is available in the area picker');
  await tap('home', reporter, reportBot);
  await tap('ag:aerial', reporter, reportBot);
  await tap('t:warplane', reporter, reportBot);
  await tap('airmode:move', reporter, reportBot);
  await tap('flight:toward_syria', reporter, reportBot);
  await tap(`g:${idlib.code}`, reporter, reportBot);
  assert.ok(buttons().some((button) => button.callback_data === `wg:${idlib.code}`));
  await tap(`wg:${idlib.code}`, reporter, reportBot);
  assert.match(lastUi().payload.text, /إدلب/);
  await tap('skip', reporter, reportBot);
  assert.match(lastUi().payload.text, /نحو إدلب/);

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
    type: 'air_movement', aircraft: 'warplane', flightDirection: 'toward_syria', flightTarget: idlibTarget, location: idlibTarget, extra: [], ttlMin: 60,
  }, { id: ownerId, name: 'test' });
  assert.match(targetedMovementInput.title, /نحو إدلب/);
  assert.match(targetedMovementInput.title_en, /toward Idlib/);
  assert.equal(targetedMovementInput.location.name_ar, 'إدلب');
  assert.equal(targetedMovementInput.location.latitude, idlibTarget.latitude);
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
  assert.equal(publicAlert(targetedMovementAlert).place.name_ar, 'إدلب');
  assert.equal(publicAlert(targetedMovementAlert).location.latitude, idlibTarget.latitude);
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
  assert.ok(calls.every((call) => !call.chatId || [ownerId, reporter.id, 8270709635, process.env.CHANNEL_ID].includes(call.chatId)), 'all Telegram API calls are intercepted locally');
});

test('clashes channel posts keep the dedicated label instead of the generic attack label', () => {
  const input = buildAlertInput({ type: 'clashes', location: { scope: 'country' }, extra: [], ttlMin: 240 }, { id: ownerId, name: 'test' });
  const post = channelPost({ ...input, id: 'test-clashes-label', timestamp: new Date().toISOString(), place: { scope: 'country' } });
  assert.equal(input.type, 'clashes');
  assert.match(post, /<b>اشتباكات مسلحة<\/b>/);
  assert.doesNotMatch(post, /<b>هجوم<\/b>/);
});
