// Weather warnings by governorate (Open-Meteo forecast + dust): twice a day the next ~36 h are checked
// against fixed thresholds. Ordinary warnings go to the owner as a draft card; severe ones are posted
// automatically (channel + map) and the owner gets a notice with an undo button.
import { InlineKeyboard } from 'grammy';
import { store } from './store.js';
import { config } from './config.js';
import { governorates, locationFrom } from './places.js';

const R = { H: null, started: false, last: 0, lastErr: '', running: false };
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const rid = () => Math.random().toString(36).slice(2, 9);
const durationLabel = (hours, en = false) => hours
  ? (en ? `${hours} ${hours === 1 ? 'hour' : 'hours'} after publishing` : `بعد ${hours === 1 ? 'ساعة' : `${hours} ساعة`} من النشر`)
  : (en ? 'No expiry — stays on the map until ended or deleted' : 'بلا انتهاء — يبقى على الخريطة حتى إنهائه أو حذفه');
const durationShort = (hours, en = false) => hours
  ? (en ? `${hours}h` : `${hours} ساعة`)
  : (en ? 'never' : 'بلا انتهاء');
const actualDuration = (alert, en = false) => {
  if (!alert) return durationLabel(store.autoDeleteHours, en);
  if (!alert.expires_at) return durationLabel(0, en);
  const hours = Math.round((Date.parse(alert.expires_at) - Date.parse(alert.timestamp)) / 3600_000);
  return durationLabel(hours, en);
};
export function wxState() {
  const svc = (store.state.svc ||= {});
  const w = (svc.weather ||= {});
  w.on ??= true;
  w.autoSevere ??= true;
  w.sent ||= {}; // `${date}:${hazard}` -> { level, govs:[], id, at }
  w.items ||= []; // drafts / published warnings (last few days)
  w.slots ||= {}; // run slots done: 'YYYY-MM-DD:am|pm'
  return w;
}
const save = () => store.persist();

// extra forecast points where the hazard (snow on the mountains, coastal storms) differs from the capital
export const EXTRA_POINTS = [
  { gov: '08', lat: 33.72, lon: 36.1, label: 'الزبداني', en: 'Zabadani' },
  { gov: '02', lat: 35.6, lon: 36.19, label: 'صلنفة', en: 'Slinfah' },
  { gov: '10', lat: 34.85, lon: 36.11, label: 'تلكلخ', en: 'Talkalakh' },
  { gov: '05', lat: 32.6, lon: 36.73, label: 'جبل العرب', en: 'Jabal al-Arab' },
];

// ---------------------------------------------------------------- hazards & thresholds
export const HAZARDS = {
  rain: { ar: 'أمطار غزيرة', en: 'Heavy rain', emoji: '🌧', unit: 'ملم', warn: 25, severe: 50, key: 'rain',
    tip: 'تجنّب العبور بالأودية ومجاري السيول والطرق المنخفضة، وابتعد عن الأبنية المتصدعة.' },
  snow: { ar: 'تساقط ثلوج', en: 'Snowfall', emoji: '❄️', unit: 'سم', warn: 2, severe: 10, key: 'snow',
    tip: 'تجنّب السفر على الطرق الجبلية، وجهّز وسائل التدفئة الآمنة وتأكد من تهوية الغرف.' },
  wind: { ar: 'رياح شديدة', en: 'Strong winds', emoji: '💨', unit: 'كم/س', warn: 60, severe: 85, key: 'gust',
    tip: 'ثبّت الألواح والخيام والأغراض على الأسطح، وابتعد عن الأشجار وأعمدة الكهرباء.' },
  storm: { ar: 'عواصف رعدية', en: 'Thunderstorms', emoji: '⛈', unit: '', warn: 1, severe: 2, key: 'storm',
    tip: 'ابقَ داخل المباني أثناء البرق، وابتعد عن الأماكن المكشوفة والأشجار المنفردة.' },
  heat: { ar: 'موجة حر', en: 'Heat wave', emoji: '🌡', unit: '°م', warn: 40, severe: 45, key: 'tmax',
    tip: 'اشرب الماء بكثرة وتجنّب الشمس بين 11 الصبح و4 العصر، وانتبه للأطفال وكبار السن.' },
  frost: { ar: 'صقيع', en: 'Frost', emoji: '🥶', unit: '°م', warn: 0, severe: -4, key: 'tmin', low: true,
    tip: 'احمِ المزروعات وأنابيب المياه، وانتبه لتجمّد الطرق صباحاً، ولا تستخدم المدافئ بغرف مغلقة.' },
  dust: { ar: 'عاصفة غبارية', en: 'Dust storm', emoji: '🌫', unit: 'ميكروغرام/م³', warn: 600, severe: 1500, key: 'dust',
    tip: 'خفّف الخروج وارتدِ كمامة، وانتبه لضعف الرؤية على الطرق، ومرضى الربو يبقوا بالداخل.' },
};
const levelOf = (hz, v) => {
  if (!Number.isFinite(v)) return 0;
  if (hz.low) return v <= hz.severe ? 2 : v <= hz.warn ? 1 : 0;
  return v >= hz.severe ? 2 : v >= hz.warn ? 1 : 0;
};

// ---------------------------------------------------------------- data
const points = () => [
  ...governorates.filter((g) => Number.isFinite(g.lat)).map((g) => ({ gov: g.code, lat: g.lat, lon: g.lon, label: g.ar })),
  ...EXTRA_POINTS,
];
async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'RedAlertSyria/1.0' }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
/** per point & day: { tmax, tmin, rain, snow, gust, storm(0/1/2), dust } */
export async function fetchForecast() {
  const P = points();
  const lat = P.map((p) => p.lat).join(','); const lon = P.map((p) => p.lon).join(',');
  const tz = encodeURIComponent(config.timezone || 'Asia/Damascus');
  const [fc, aq] = await Promise.all([
    getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_gusts_10m_max&timezone=${tz}&forecast_days=3`),
    getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=dust&timezone=${tz}&forecast_days=3`).catch(() => null),
  ]);
  const fcs = Array.isArray(fc) ? fc : [fc];
  const aqs = aq ? (Array.isArray(aq) ? aq : [aq]) : [];
  const out = [];
  P.forEach((p, i) => {
    const d = fcs[i]?.daily; if (!d) return;
    const dust = {};
    const h = aqs[i]?.hourly;
    if (h?.time) h.time.forEach((t, k) => { const day = t.slice(0, 10); const v = h.dust[k]; if (Number.isFinite(v)) dust[day] = Math.max(dust[day] || 0, v); });
    d.time.forEach((day, k) => {
      const code = d.weather_code[k];
      out.push({ ...p, day,
        tmax: d.temperature_2m_max[k], tmin: d.temperature_2m_min[k], rain: d.precipitation_sum[k],
        snow: d.snowfall_sum[k], gust: d.wind_gusts_10m_max[k],
        storm: code >= 96 ? 2 : code === 95 ? 1 : 0, dust: dust[day] });
    });
  });
  return out;
}
const dayStr = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date(ms));
const dayName = (day, en) => new Intl.DateTimeFormat(en ? 'en-GB' : 'ar-SY', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(day + 'T12:00:00Z'));
const govAr = (code) => governorates.find((g) => g.code === code)?.ar || code;
const wday = (day, en) => new Intl.DateTimeFormat(en ? 'en-GB' : 'ar-SY', { timeZone: 'UTC', weekday: 'long' }).format(new Date(day + 'T12:00:00Z'));
const govEn = (code) => governorates.find((g) => g.code === code)?.en || code;

/** group the forecast into warnings: one per (day, hazard) with the governorates it covers */
export function buildWarnings(rows, { days } = {}) {
  const map = new Map();
  for (const r of rows) {
    if (days && !days.includes(r.day)) continue;
    for (const [k, hz] of Object.entries(HAZARDS)) {
      const v = r[hz.key];
      const lv = levelOf(hz, v);
      if (!lv) continue;
      // light snow only counts with real cold; thunderstorms only with some rain
      if (k === 'storm' && !(r.rain >= 5)) continue;
      const id = `${r.day}:${k}`;
      const w = map.get(id) || { key: id, day: r.day, hazard: k, level: 0, govs: {} };
      w.level = Math.max(w.level, lv);
      const g = (w.govs[r.gov] ||= { gov: r.gov, v, level: lv, where: [] });
      if (hz.low ? v < g.v : v > g.v) g.v = v;
      g.level = Math.max(g.level, lv);
      if (!g.where.includes(r.label)) g.where.push(r.label);
      map.set(id, w);
    }
  }
  return [...map.values()].map((w) => ({ ...w, govs: Object.values(w.govs).sort((a, b) => b.level - a.level || (HAZARDS[w.hazard].low ? a.v - b.v : b.v - a.v)) }));
}
const fmtV = (hz, v) => (hz.key === 'storm' ? '' : `${Math.round(v)} ${hz.unit}`);
function warningText(w, { html = true } = {}) {
  const hz = HAZARDS[w.hazard];
  const b = (s) => (html ? `<b>${esc(s)}</b>` : s);
  const lines = [`${hz.emoji} ${b(`${w.level === 2 ? 'تحذير شديد' : 'تحذير جوي'}: ${hz.ar}`)}`, `📅 ${esc(dayName(w.day))}`, ''];
  for (const g of w.govs.slice(0, 14)) {
    const v = fmtV(hz, g.v);
    lines.push(`📍 ${b(govAr(g.gov))}${v ? ` — ${hz.low ? 'حتى' : 'حتى'} ${esc(v)}` : ''}${g.level === 2 && w.level === 2 ? ' ⚠️' : ''}`);
  }
  lines.push('', esc(hz.tip));
  return lines.join('\n');
}

// ---------------------------------------------------------------- alert (map + channel)
function minutesLeftOf(day) {
  // until 23:59 Damascus time of the warned day (min 60 min)
  const now = Date.now();
  let end = now;
  for (let m = 0; m <= 48 * 60; m += 15) { const t = now + m * 60_000; if (dayStr(t) > day) break; end = t; }
  return Math.max(60, Math.round((end - now) / 60_000));
}
function alertInput(w) {
  const hz = HAZARDS[w.hazard];
  const zone = (code) => ({ ...locationFrom({ govCode: code }), zone_km: 38 });
  const [first, ...rest] = w.govs;
  const loc = { ...zone(first.gov),
    head_ar: `${w.level === 2 ? 'تحذير شديد' : 'تحذير'}: ${hz.ar}`, head_en: `${w.level === 2 ? 'Severe warning' : 'Warning'}: ${hz.en}`,
    short_ar: `${wday(w.day)} · ${w.govs.length === 1 ? govAr(first.gov) : `${w.govs.length} محافظات`}`,
    short_en: `${wday(w.day, true)} · ${w.govs.length === 1 ? govEn(first.gov) : `${w.govs.length} governorates`}` };
  const extra = rest.map((g) => zone(g.gov));
  const desc = [
    `${hz.ar} متوقعة ${dayName(w.day)}.`,
    ...w.govs.map((g) => { const v = fmtV(hz, g.v); return `• ${govAr(g.gov)}${v ? `: حتى ${v}` : ''}`; }),
    hz.tip,
  ].join('\n');
  return {
    type: 'weather',
    title: `${hz.ar} — ${govAr(first.gov)}${rest.length === 1 ? ' ومحافظة أخرى' : rest.length === 2 ? ' ومحافظتان أخريان' : rest.length ? ` و${rest.length} محافظات أخرى` : ''}`,
    title_en: `${hz.en} — ${govEn(first.gov)}${rest.length ? ` +${rest.length} more` : ''}`,
    description: desc,
    location: loc,
    extra,
    areas: w.govs.map((g) => govAr(g.gov)),
    ttlMin: minutesLeftOf(w.day),
    source: 'weather',
    author: { id: 0, name: 'Open-Meteo' },
    meta: { hazard: w.hazard, level: w.level, day: w.day },
  };
}
async function publish(item, toChannel) {
  const { publishInput } = await import('./bot.js');
  const api = R.H?.apis().admin;
  if (!api) throw new Error('admin bot not ready');
  const a = await publishInput(api, alertInput(item.w), { toChannel });
  item.alertId = a.id; item.pub = toChannel ? 'channel' : 'map'; item.pubAt = Date.now();
  save();
  return a;
}

// ---------------------------------------------------------------- owner cards
const reviewers = () => [...new Set(config.ownerIds)];
const isEnUid = (uid) => store.userLang?.(uid) === 'en';
const cardKb = (it, en = false) => (it.pub
  ? new InlineKeyboard().text(en ? '🗑 Delete the warning' : '🗑 حذف التحذير', `wx:d:${it.id}`)
  : new InlineKeyboard().text(en ? '📢 Map + channel' : '📢 الخريطة + القناة', `wx:c:${it.id}`).row().text(en ? '🗺 Map only' : '🗺 الخريطة فقط', `wx:m:${it.id}`).text(en ? '❌ Ignore' : '❌ تجاهل', `wx:x:${it.id}`));
function cardText(it, en = false) {
  const alert = it.alertId ? store.getAlert(it.alertId) : null;
  const duration = it.pub ? actualDuration(alert, en) : durationLabel(store.autoDeleteHours, en);
  const head = en
    ? (it.pub === 'channel' && it.auto ? '✅ <b>Auto-posted (severe warning)</b>\n\n' : it.pub ? `✅ <b>Published${it.pub === 'map' ? ' on the map' : ''}</b>\n\n` : '📝 <b>Weather warning draft</b> — awaiting your decision\n\n')
    : (it.pub === 'channel' && it.auto ? '✅ <b>نُشر تلقائياً (تحذير شديد)</b>\n\n' : it.pub ? `✅ <b>منشور${it.pub === 'map' ? ' على الخريطة' : ''}</b>\n\n` : '📝 <b>مسودة تحذير جوي</b> — بتنتظر قرارك\n\n');
  const lifetime = en ? `⌛ <b>Map duration:</b> ${esc(duration)}` : `⌛ <b>مدة البقاء على الخريطة:</b> ${esc(duration)}`;
  return head + warningText(it.w) + `\n\n${lifetime}` + (en ? '\n\n<i>Source: Open-Meteo forecast (for review)</i>' : '\n\n<i>المصدر: توقعات Open-Meteo (للمراجعة)</i>');
}
async function sendCards(it) {
  const api = R.H?.apis().admin; if (!api) return;
  it.cards = [];
  for (const uid of reviewers()) {
    try { const m = await api.sendMessage(uid, cardText(it, isEnUid(uid)), { parse_mode: 'HTML', reply_markup: cardKb(it, isEnUid(uid)), _keep: 'c' }); it.cards.push([uid, m.message_id]); } catch { /* owner never opened the bot */ }
  }
  save();
}
async function refreshCards(it) {
  const api = R.H?.apis().admin; if (!api) return;
  for (const [chat, mid] of it.cards || []) {
    const en = isEnUid(chat); try { await api.editMessageText(chat, mid, cardText(it, en), { parse_mode: 'HTML', reply_markup: it.pub || it.ignored ? (it.pub ? cardKb(it, en) : undefined) : cardKb(it, en) }); } catch { /* gone */ }
  }
}

// ---------------------------------------------------------------- check
export async function checkWeather({ dry = false, force = false } = {}) {
  void dry; void force;
  throw new Error('توقفت تنبيهات الطقس الآلية المعتمدة على التوقعات الخارجية. استخدم تنبيهات المركز الوطني الرسمية في صفحة الطقس.');
}
export function startWeather(h) {
  if (h) R.H = h;
  if (R.started) return;
  R.started = true;
  const st = wxState(); st.on = false; st.autoSevere = false; save();
}
export function weatherDebug() { const st = wxState(); return { on: st.on, autoSevere: st.autoSevere, last: R.last, err: R.lastErr, slots: st.slots, items: st.items.slice(-8).map((i) => ({ id: i.id, key: i.w.key, level: i.w.level, govs: i.w.govs.length, pub: i.pub })) }; }

export function registerWeatherTools(bot, h) {
  R.H = h;
  startWeather(h);
  const only = async (ctx, fn) => { if (!h.owner(ctx)) return ctx.answerCallbackQuery().catch(() => {}); return fn(); };
  const find = (id) => wxState().items.find((i) => i.id === id);
  const E = (ctx) => h.langOf?.(ctx) === 'en';
  const T = (ctx, ar, en) => (E(ctx) ? en : ar);
  const activeWarnings = () => store.activeAlerts().filter((a) => a.type === 'weather');
  const expiryLabel = (ctx, alert) => {
    if (!alert.expires_at) return T(ctx, '♾ بلا انتهاء', '♾ No expiry');
    const date = new Date(alert.expires_at);
    if (!Number.isFinite(date.getTime())) return T(ctx, '⌛ وقت الانتهاء غير معروف', '⌛ Expiry unknown');
    const formatted = new Intl.DateTimeFormat(E(ctx) ? 'en-GB' : 'ar-SY', {
      timeZone: config.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(date);
    const remaining = Math.ceil((date.getTime() - Date.now()) / 60_000);
    if (remaining <= 0) return `${T(ctx, '⌛ انتهت المدة', '⌛ Expired')} · ${formatted}`;
    const days = Math.floor(remaining / 1440);
    const hours = Math.floor((remaining % 1440) / 60);
    const minutes = remaining % 60;
    const left = E(ctx)
      ? [days && `${days}d`, hours && `${hours}h`, !days && minutes && `${minutes}m`].filter(Boolean).join(' ')
      : [days && `${days} يوم`, hours && `${hours} ساعة`, !days && minutes && `${minutes} دقيقة`].filter(Boolean).join(' و');
    return `${T(ctx, '⌛ ينتهي', '⌛ Expires')} ${formatted} · ${T(ctx, 'المتبقي', 'left')} ${left}`;
  };
  const warningsView = (ctx, requestedPage = 0) => {
    const alerts = activeWarnings();
    const pageSize = 8;
    const pages = Math.max(1, Math.ceil(alerts.length / pageSize));
    const page = Math.max(0, Math.min(Number(requestedPage) || 0, pages - 1));
    const first = page * pageSize;
    const current = alerts.slice(first, first + pageSize);
    const lines = current.map((a, i) => {
      const title = E(ctx) ? (a.title_en || a.title) : (a.title || a.title_en);
      return `${first + i + 1}. ⛈ <b>${esc(title || T(ctx, 'تحذير جوي', 'Weather warning'))}</b>\n   ${expiryLabel(ctx, a)}`;
    });
    const text = `${T(ctx, `⛈ <b>التحذيرات الجوية المنشورة والنشطة (${alerts.length})</b>`, `⛈ <b>Published active weather warnings (${alerts.length})</b>`)}\n\n${lines.length ? lines.join('\n\n') : T(ctx, 'لا توجد تحذيرات جوية نشطة حالياً.', 'There are no active weather warnings right now.')}`;
    const kb = new InlineKeyboard();
    for (let i = 0; i < current.length; i++) {
      const a = current[i];
      const title = E(ctx) ? (a.title_en || a.title) : (a.title || a.title_en);
      kb.text(`${T(ctx, '🗑 حذف', '🗑 Delete')} · ${(title || T(ctx, 'التحذير', 'warning')).slice(0, 38)}`, `wxw:delete:${a.id}:${page}`).row();
    }
    if (pages > 1) {
      if (page > 0) kb.text(T(ctx, '⬅️ السابق', '⬅️ Previous'), `wxw:list:${page - 1}`);
      kb.text(`${page + 1}/${pages}`, `wxw:list:${page}`);
      if (page + 1 < pages) kb.text(T(ctx, 'التالي ➡️', 'Next ➡️'), `wxw:list:${page + 1}`);
      kb.row();
    }
    kb.text(T(ctx, `⏱ المدة: ${durationShort(store.autoDeleteHours)}`, `⏱ Duration: ${durationShort(store.autoDeleteHours, true)}`), 'auto')
      .row().text(T(ctx, '↩️ رجوع لتحذيرات الطقس', '↩️ Back to weather'), 'wx');
    return { text, keyboard: kb, page };
  };
  const showWarnings = async (ctx, page = 0) => {
    const view = warningsView(ctx, page);
    await h.show(ctx, view.text, view.keyboard);
  };
  const dayEn = (d) => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00:00Z')); } catch { return d; } };
  const mainText = (ctx) => {
    const st = wxState(); const en = E(ctx);
    const recent = st.items.slice(-5).reverse().map((i) => `• ${HAZARDS[i.w.hazard].emoji} ${en ? HAZARDS[i.w.hazard].en : HAZARDS[i.w.hazard].ar} — ${esc(en ? dayEn(i.w.day) : dayName(i.w.day))} (${i.w.govs.length} ${en ? (i.w.govs.length === 1 ? 'governorate' : 'governorates') : 'محافظة'})${i.pub ? ' ✅' : i.ignored ? ' ✖️' : ' 📝'}`).join('\n');
    if (en) return `⛈ <b>Weather warnings</b>\n\n⏸ Third-party forecast-based automatic alerts are disabled.\nMap duration: <b>${esc(durationLabel(store.autoDeleteHours, true))}</b>\n\n`
      + 'The weather service panel and morning bulletin now use only official warnings and links from Syria’s National Meteorological Center. Existing published warnings can still be reviewed below.\n\n'
      + `<b>Latest warnings:</b>\n${recent || '— No warnings right now'}`;
    return `⛈ <b>تحذيرات الطقس</b>\n\n⏸ أوقفنا التنبيهات الآلية المبنية على توقعات خارجية.\nمدة بقاء التحذير المنشور على الخريطة: <b>${esc(durationLabel(store.autoDeleteHours))}</b>\n\n`
      + 'لوحة الطقس والنشرة الصباحية تعرضان الآن التحذيرات والروابط الرسمية للمركز الوطني للأرصاد الجوية فقط. يمكن مراجعة التحذيرات المنشورة سابقاً أدناه.\n\n'
      + `<b>آخر التحذيرات:</b>\n${recent || '— ما في تحذيرات حالياً'}`;
  };
  const mainKb = (ctx) => {
    return new InlineKeyboard().url(T(ctx, '🌐 نشرة المركز الرسمية', '🌐 Official weather bulletin'), 'https://climweb.med.gov.sy/منتجاتنا/النشرة-اليومية/').row()
      .text(T(ctx, '🌤 النشرة الصباحية', '🌤 Morning bulletin settings'), 'wxb').row()
      .text(T(ctx, `⏱ المدة: ${durationShort(store.autoDeleteHours)}`, `⏱ Duration: ${durationShort(store.autoDeleteHours, true)}`), 'auto').row()
      .text(T(ctx, `📋 التحذيرات المنشورة (${activeWarnings().length})`, `📋 Published warnings (${activeWarnings().length})`), 'wxw:list:0').row()
      .text(T(ctx, '🏠 القائمة', '🏠 Menu'), 'home');
  };
  bot.callbackQuery('wx', (ctx) => only(ctx, async () => { await ctx.answerCallbackQuery().catch(() => {}); await h.show(ctx, mainText(ctx), mainKb(ctx)); }));
  bot.callbackQuery(/^wxw:list:(\d+)$/, (ctx) => only(ctx, async () => {
    await ctx.answerCallbackQuery().catch(() => {});
    await showWarnings(ctx, Number(ctx.match[1]));
  }));
  bot.callbackQuery(/^wxw:delete:([\w-]{36}):(\d+)$/, (ctx) => only(ctx, async () => {
    await ctx.answerCallbackQuery().catch(() => {});
    const [, id, page] = ctx.match;
    const alert = store.getAlert(id);
    if (!alert || !alert.is_active || alert.type !== 'weather') return showWarnings(ctx, Number(page));
    const title = E(ctx) ? (alert.title_en || alert.title) : (alert.title || alert.title_en);
    const prompt = `${T(ctx, '🗑 <b>تأكيد حذف تحذير الطقس</b>', '🗑 <b>Confirm weather-warning deletion</b>')}\n\n⛈ <b>${esc(title || T(ctx, 'تحذير جوي', 'Weather warning'))}</b>\n${expiryLabel(ctx, alert)}\n\n${T(ctx, 'سيُزال التحذير من الخريطة ويُحذف منشوره من القناة.', 'This removes the warning from the map and deletes its channel post.')}`;
    const kb = new InlineKeyboard()
      .text(T(ctx, '🗑 نعم، احذف التحذير', '🗑 Yes, delete warning'), `wxw:confirm:${id}:${page}`)
      .text(T(ctx, '↩️ إلغاء', '↩️ Cancel'), `wxw:list:${page}`);
    await h.show(ctx, prompt, kb);
  }));
  bot.callbackQuery(/^wxw:confirm:([\w-]{36}):(\d+)$/, (ctx) => only(ctx, async () => {
    const [, id, page] = ctx.match;
    const alert = store.getAlert(id);
    if (!alert || !alert.is_active || alert.type !== 'weather') {
      await ctx.answerCallbackQuery(T(ctx, 'لم يعد التحذير متاحاً', 'This warning is no longer available')).catch(() => {});
      return showWarnings(ctx, Number(page));
    }
    await ctx.answerCallbackQuery(T(ctx, 'تم تأكيد الحذف', 'Deletion confirmed')).catch(() => {});
    const { deleteAlertEverywhere } = await import('./bot.js');
    await deleteAlertEverywhere(ctx.api, id);
    await showWarnings(ctx, Number(page));
  }));
  bot.callbackQuery('wx:on', (ctx) => only(ctx, async () => { const st = wxState(); st.on = !st.on; save(); await ctx.answerCallbackQuery().catch(() => {}); await h.show(ctx, mainText(ctx), mainKb(ctx)); }));
  bot.callbackQuery('wx:auto', (ctx) => only(ctx, async () => { const st = wxState(); st.autoSevere = !st.autoSevere; save(); await ctx.answerCallbackQuery().catch(() => {}); await h.show(ctx, mainText(ctx), mainKb(ctx)); }));
  bot.callbackQuery('wx:now', (ctx) => only(ctx, async () => {
    await ctx.answerCallbackQuery({ text: '⏳' }).catch(() => {});
    let n = 0; let err = '';
    try { n = (await checkWeather()).length; } catch (e) { err = e.message; }
    await ctx.answerCallbackQuery?.().catch(() => {});
    const msg = err
      ? (E(ctx) ? '⚠️ Third-party forecast-based alerts are disabled. Use the official National Meteorological Center bulletin.' : '⚠️ تنبيهات التوقعات الخارجية متوقفة؛ استخدم نشرة المركز الوطني الرسمية.')
      : (E(ctx) ? (n ? `🆕 ${n} new warning(s) — the cards were sent to you.` : '✅ No new warnings.') : (n ? `🆕 ${n} تحذير جديد — وصلتك البطاقات.` : '✅ ما في تحذيرات جديدة.'));
    await h.show(ctx, mainText(ctx) + `\n\n${msg}`, mainKb(ctx));
  }));
  // test cards (🧪): their buttons never publish anything — they only answer, «تجاهل» removes the card
  bot.callbackQuery(/^wx:t:(c|m|x)$/, async (ctx) => {
    if (ctx.match[1] === 'x') {
      await ctx.answerCallbackQuery({ text: T(ctx, '🧪 هذه تجربة — انحذفت البطاقة', '🧪 Test only — card removed') }).catch(() => {});
      try { await ctx.deleteMessage(); } catch { /* */ }
      return;
    }
    await ctx.answerCallbackQuery({ text: T(ctx, '🧪 هذه تجربة — ما رح ينشر شي على القناة أو الخريطة', '🧪 Test only — nothing will be posted to the channel or the map'), show_alert: true }).catch(() => {});
  });
  bot.callbackQuery(/^wx:(c|m|x|d):(\w+)$/, (ctx) => only(ctx, async () => {
    const [, act, id] = ctx.match;
    const it = find(id);
    if (!it) return ctx.answerCallbackQuery({ text: T(ctx, 'انتهت صلاحية المسودة', 'This draft has expired') }).catch(() => {});
    if (act === 'x') { it.ignored = true; save(); await ctx.answerCallbackQuery({ text: '✖️' }).catch(() => {}); for (const [c, m] of it.cards || []) { try { await ctx.api.deleteMessage(c, m); } catch { /* */ } } return; }
    if (act === 'd') {
      const { deleteAlertEverywhere } = await import('./bot.js');
      if (it.alertId) await deleteAlertEverywhere(ctx.api, it.alertId).catch(() => {});
      it.pub = ''; it.ignored = true; save();
      await ctx.answerCallbackQuery({ text: '🗑' }).catch(() => {});
      for (const [c, m] of it.cards || []) { try { await ctx.api.deleteMessage(c, m); } catch { /* */ } }
      return;
    }
    if (it.pub) return ctx.answerCallbackQuery({ text: '✅' }).catch(() => {});
    try { await publish(it, act === 'c'); } catch (e) { return ctx.answerCallbackQuery({ text: '⚠️ ' + e.message.slice(0, 60), show_alert: true }).catch(() => {}); }
    await ctx.answerCallbackQuery({ text: '✅' }).catch(() => {});
    await refreshCards(it);
  }));
}
export const _test = { buildWarnings, warningText, alertInput, cardKb, cardText, durationLabel, HAZARDS };
