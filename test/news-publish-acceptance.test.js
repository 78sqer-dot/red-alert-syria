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
const { buildAlertInput, createBot, channelKeyboard, channelPost } = await import('../server/bot.js');
const { BORDER_MARKERS, ALERT_TYPES, ALERT_GROUPS, POLITICAL_CATEGORIES } = await import('../shared/types.js');
const { NEWS_TYPES } = await import('../server/news-ai.js');
const { governorates } = await import('../server/places.js');
const { newsState } = await import('../server/news-monitor.js');
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
  assert.match(shootingPost, /<b>إطلاق نار<\/b> - 🔊/);
  assert.doesNotMatch(shootingPost, /🔫/);
  const assassinationAlert = store.addAlert(buildAlertInput({ type: 'assassination', location: { scope: 'country' }, extra: [], ttlMin: 60 }, { id: ownerId, name: 'test' }));
  addedAlertIds.push(assassinationAlert.id);
  const assassinationPost = channelPost(assassinationAlert);
  assert.match(assassinationPost, /🎯/);
  assert.doesNotMatch(assassinationPost, /🔫/);
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
  await tap('pcat:statement');
  assert.ok(buttons().some((button) => button.callback_data === 'pol:general'), 'general political news is offered as the default no-pin option');
  assert.ok(buttons().some((button) => button.callback_data === 'pol:location'), 'a confirmed location can be selected explicitly');
  await tap('pol:general');
  await sendText('بيان رسمي https://news.example/politics');
  assert.match(lastUi().payload.text, /موقع غير محدد — دون دبوس/);
  assert.match(lastUi().payload.text, /الرأي أو التحليل ليس خبراً/);
  assert.match(lastUi().payload.text, /الفئة:<\/b> تصريح أو موقف منسوب/);
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
  assert.match(politicalPost, /href="https:\/\/official\.example\/news"/);
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
  await tap('pcat:meeting', reporter, reportBot);
  await tap('pol:location', reporter, reportBot);
  assert.ok(buttons().some((button) => button.callback_data === 'pol:nopin'), 'location picker still permits an explicit no-pin choice');
  await tap(`g:${politicalIdlib.code}`, reporter, reportBot);
  await tap(`wg:${politicalIdlib.code}`, reporter, reportBot);
  await tap('skip', reporter, reportBot);
  assert.match(lastUi().payload.text, /الفئة:<\/b> لقاء أو زيارة/);
  assert.match(lastUi().payload.text, /إدلب/);
  assert.doesNotMatch(lastUi().payload.text, /No verified location|موقع غير محدد — دون دبوس/);
  await tap('home', reporter, reportBot);

  assert.ok(buttons().some((button) => button.callback_data === 't:warplane'));
  assert.ok(buttons().some((button) => button.callback_data === 't:uav'));
  assert.ok(buttons().some((button) => button.callback_data === 't:helicopter'));
  assert.ok(buttons().some((button) => button.callback_data === 't:airstrike'));
  assert.ok(buttons().some((button) => button.callback_data === 't:military_incursion'));
  assert.ok(buttons().some((button) => button.callback_data === 'cv' && button.text?.startsWith('🛡️ مدني')));
  assert.equal(buttons().some((button) => ['t:civil', 't:accident', 't:fire', 't:protest', 't:civil_plane', 't:arrest', 't:death', 't:martyrdom', 't:brawl', 't:shooting'].includes(button.callback_data)), false, 'civil choices stay inside the civil submenu');
  assert.equal(buttons().some((button) => button.callback_data === 't:air_movement'), false, 'aircraft direction is selected inside warplane/drone options, not as a separate main button');
  for (const [type, label] of [['helicopter', 'طيران مروحي'], ['airstrike', 'غارة جوية']]) {
    await tap(`t:${type}`);
    assert.match(lastUi()?.payload?.text || '', new RegExp(label), `${type} starts a manual publishing draft`);
    await tap('home');
  }
  await tap('t:military_incursion');
  assert.ok(buttons().some((button) => button.callback_data === 'vehc:1'));
  assert.ok(buttons().some((button) => button.callback_data === 'vehc:12'));
  assert.ok(buttons().some((button) => button.callback_data === 'vehc:custom'));
  await tap('vehc:3');
  assert.match(lastUi()?.payload?.text || '', /٣ آليات/, 'admin can choose a preset vehicle count before selecting a location');
  await tap('home');
  await tap('home', reporter, reportBot);
  const reportButtons = lastUi()?.payload?.reply_markup?.inline_keyboard?.flat() || [];
  assert.ok(reportButtons.some((button) => button.callback_data === 't:military_incursion'), 'vehicle incursion is available in the public report bot');
  for (const [type, label] of [['helicopter', 'طيران مروحي'], ['airstrike', 'غارة جوية']]) {
    const button = reportButtons.find((item) => item.callback_data === `t:${type}`);
    assert.ok(button, `${type} button is available in the public report bot`);
    assert.ok(button.text.includes(label), `${type} button has a clear Arabic label`);
    await tap(`t:${type}`, reporter, reportBot);
    assert.match(lastUi()?.payload?.text || '', new RegExp(label), `${type} starts a report with the selected type`);
    await tap('home', reporter, reportBot);
  }
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
  await tap('t:warplane');
  assert.ok(buttons().some((button) => button.callback_data === 'airmode:over'));
  assert.ok(buttons().some((button) => button.callback_data === 'airmode:move'));
  await tap('airmode:over');
  assert.match(lastUi().payload.text, /اختر المحافظة/);
  assert.equal(buttons().some((button) => button.callback_data?.startsWith('flight:')), false, 'warplane over area skips movement choices');

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
  await tap('t:military_incursion', reporter, reportBot);
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
  addedAlertIds.push(borderAlert.id, palestineAlert.id, flightAlert.id, droneAlert.id, movementAlert.id, targetedMovementAlert.id, militaryAlert.id);

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
  assert.ok(calls.every((call) => !call.chatId || [ownerId, reporter.id, process.env.CHANNEL_ID].includes(call.chatId)), 'all Telegram API calls are intercepted locally');
});
