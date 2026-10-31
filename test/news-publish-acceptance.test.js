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
const { BORDER_MARKERS } = await import('../shared/types.js');
const { NEWS_TYPES } = await import('../server/news-ai.js');
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

test('every monitored alert type builds, and accepting the same mock draft twice posts once', async (t) => {
  const addedAlertIds = [];
  const draftId = 'a1b2c3d4e5';
  t.after(async () => {
    delete newsState().drafts[draftId];
    for (const id of addedAlertIds) store.deleteAlert(id);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  for (const type of NEWS_TYPES) {
    const input = buildAlertInput({ type, location: { scope: 'country' }, extra: [], ttlMin: 60 }, { id: ownerId, name: 'test' });
    assert.ok(input.title, `${type} must have a publish title`);
    assert.ok(input.title_en, `${type} must have an English publish title`);
  }
  const socialRow = channelKeyboard({ id: 'test-social-buttons' }).inline_keyboard.find((row) => row.some((button) => button.url?.includes('/boost/')));
  assert.equal(socialRow?.length, 2, 'boost and WhatsApp channel buttons share one professional row');
  assert.equal(socialRow[1].url, 'https://whatsapp.com/channel/0029VbDl95H5fM5V2HJ2PO10');
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
  await tap('home');
  assert.ok(buttons().some((button) => button.callback_data === 't:warplane'));
  assert.ok(buttons().some((button) => button.callback_data === 't:uav'));
  assert.ok(buttons().some((button) => button.callback_data === 'cv' && button.text?.startsWith('🛡️ مدني')));
  assert.equal(buttons().some((button) => ['t:civil', 't:accident', 't:fire', 't:protest', 't:civil_plane'].includes(button.callback_data)), false, 'civil choices stay inside the civil submenu');
  assert.equal(buttons().some((button) => button.callback_data === 't:air_movement'), false, 'aircraft direction is selected inside warplane/drone options, not as a separate main button');
  await tap('cv');
  for (const callback of ['t:accident', 't:fire', 't:protest', 't:civil_plane', 't:civil']) {
    assert.ok(buttons().some((button) => button.callback_data === callback), `civil submenu includes ${callback}`);
  }
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
  assert.doesNotMatch(lastUi().payload.text, /اختر المحافظة/);
  assert.match(lastUi().payload.text, /بلا تحديد منطقة أو دبوس/);
  assert.equal(buttons().some((button) => button.callback_data?.startsWith('g:')), false, 'direction-only alerts never offer a governorate selector');
  await tap('skip', reporter, reportBot);
  assert.match(lastUi().payload.text, /بلا تحديد منطقة أو دبوس/);

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
  addedAlertIds.push(borderAlert.id, palestineAlert.id, flightAlert.id, droneAlert.id, movementAlert.id);

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
