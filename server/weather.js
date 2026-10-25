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
const cardKb = (it) => (it.pub
  ? new InlineKeyboard().text('🗑 حذف التحذير', `wx:d:${it.id}`)
  : new InlineKeyboard().text('📢 الخريطة + القناة', `wx:c:${it.id}`).row().text('🗺 الخريطة فقط', `wx:m:${it.id}`).text('❌ تجاهل', `wx:x:${it.id}`));
function cardText(it) {
  const head = it.pub === 'channel' && it.auto ? '✅ <b>نُشر تلقائياً (تحذير شديد)</b>\n\n' : it.pub ? `✅ <b>منشور${it.pub === 'map' ? ' على الخريطة' : ''}</b>\n\n` : '📝 <b>مسودة تحذير جوي</b> — بتنتظر قرارك\n\n';
  return head + warningText(it.w) + '\n\n<i>المصدر: توقعات Open-Meteo (للمراجعة)</i>';
}
async function sendCards(it) {
  const api = R.H?.apis().admin; if (!api) return;
  it.cards = [];
  for (const uid of reviewers()) {
    try { const m = await api.sendMessage(uid, cardText(it), { parse_mode: 'HTML', reply_markup: cardKb(it), _keep: 'c' }); it.cards.push([uid, m.message_id]); } catch { /* owner never opened the bot */ }
  }
  save();
}
async function refreshCards(it) {
  const api = R.H?.apis().admin; if (!api) return;
  for (const [chat, mid] of it.cards || []) {
    try { await api.editMessageText(chat, mid, cardText(it), { parse_mode: 'HTML', reply_markup: it.pub || it.ignored ? (it.pub ? cardKb(it) : undefined) : cardKb(it) }); } catch { /* gone */ }
  }
}

// ---------------------------------------------------------------- check
export async function checkWeather({ dry = false, force = false } = {}) {
  const st = wxState();
  R.last = Date.now();
  const rows = await fetchForecast();
  const today = dayStr(); const tomorrow = dayStr(Date.now() + 24 * 3600_000);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  const days = hour >= 15 ? [tomorrow] : [today, tomorrow];
  const ws = buildWarnings(rows, { days });
  if (dry) return ws;
  const fresh = [];
  for (const w of ws) {
    const prev = st.sent[w.key];
    const newGovs = prev ? w.govs.filter((g) => !prev.govs.includes(g.gov)) : w.govs;
    const escalated = prev && w.level > prev.level;
    if (prev && !escalated && newGovs.length < 2 && !force) continue;
    st.sent[w.key] = { level: w.level, govs: w.govs.map((g) => g.gov), at: Date.now() };
    const it = { id: rid(), w, ts: Date.now(), pub: '', auto: false };
    st.items.push(it);
    fresh.push(it);
    if (w.level === 2 && st.autoSevere && config.channel) {
      try { await publish(it, true); it.auto = true; } catch (e) { console.error('[weather] auto publish failed', e.message); }
    }
    await sendCards(it);
  }
  const cutoff = Date.now() - 4 * 86400_000;
  st.items = st.items.filter((i) => i.ts > cutoff).slice(-40);
  for (const [k, v] of Object.entries(st.sent)) if (v.at < cutoff) delete st.sent[k];
  save();
  return fresh;
}
export function startWeather(h) {
  if (h) R.H = h;
  if (R.started) return;
  R.started = true;
  const tick = async () => {
    const st = wxState();
    if (!st.on || R.running || !R.H) return;
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    const slot = hm >= '07:30' && hm < '12:00' ? 'am' : hm >= '17:30' && hm < '22:00' ? 'pm' : '';
    if (!slot) return;
    const key = `${dayStr()}:${slot}`;
    if (st.slots[key]) return;
    R.running = true;
    try {
      await checkWeather();
      st.slots[key] = Date.now(); R.lastErr = '';
      for (const k of Object.keys(st.slots)) if (Date.now() - st.slots[k] > 3 * 86400_000) delete st.slots[k];
      save();
    } catch (e) { R.lastErr = e.message; console.error('[weather] check failed', e.message); } finally { R.running = false; }
  };
  setTimeout(tick, 40_000).unref();
  setInterval(tick, 10 * 60_000).unref();
}
export function weatherDebug() { const st = wxState(); return { on: st.on, autoSevere: st.autoSevere, last: R.last, err: R.lastErr, slots: st.slots, items: st.items.slice(-8).map((i) => ({ id: i.id, key: i.w.key, level: i.w.level, govs: i.w.govs.length, pub: i.pub })) }; }

export function registerWeatherTools(bot, h) {
  R.H = h;
  startWeather(h);
  const only = async (ctx, fn) => { if (!h.owner(ctx)) return ctx.answerCallbackQuery().catch(() => {}); return fn(); };
  const find = (id) => wxState().items.find((i) => i.id === id);
  const mainText = () => {
    const st = wxState();
    const recent = st.items.slice(-5).reverse().map((i) => `• ${HAZARDS[i.w.hazard].emoji} ${HAZARDS[i.w.hazard].ar} — ${esc(dayName(i.w.day))} (${i.w.govs.length} محافظة)${i.pub ? ' ✅' : i.ignored ? ' ✖️' : ' 📝'}`).join('\n');
    return `⛈ <b>تحذيرات الطقس</b>\n\nالحالة: <b>${st.on ? '✅ مفعّلة' : '⏸ موقوفة'}</b>\nالنشر التلقائي للتحذيرات الشديدة: <b>${st.autoSevere ? '✅ نعم' : '⏸ لا، كلها مسودات'}</b>\n\n`
      + 'فحص التوقعات مرتين باليوم (7:30 الصبح و5:30 المسا) لكل المحافظات: أمطار غزيرة، ثلوج، رياح، عواصف رعدية، موجات حر، صقيع، وعواصف غبار.\nالتحذير العادي بيوصلك مسودة، والشديد بينزل لحاله بالقناة وعلى الخريطة.\n\n'
      + `<b>آخر التحذيرات:</b>\n${recent || '— ما في تحذيرات حالياً'}`;
  };
  const mainKb = () => {
    const st = wxState();
    return new InlineKeyboard().text('🔎 افحص التوقعات الآن', 'wx:now').row().text('🌤 نشرة الطقس الصباحية', 'wxb').row()
      .text(st.on ? '⏸ إيقاف' : '▶️ تشغيل', 'wx:on').text(st.autoSevere ? '📝 الشديد كمان مسودة' : '⚡ انشر الشديد تلقائياً', 'wx:auto').row()
      .text('🏠 القائمة', 'home');
  };
  bot.callbackQuery('wx', (ctx) => only(ctx, async () => { await ctx.answerCallbackQuery().catch(() => {}); await h.show(ctx, mainText(), mainKb()); }));
  bot.callbackQuery('wx:on', (ctx) => only(ctx, async () => { const st = wxState(); st.on = !st.on; save(); await ctx.answerCallbackQuery().catch(() => {}); await h.show(ctx, mainText(), mainKb()); }));
  bot.callbackQuery('wx:auto', (ctx) => only(ctx, async () => { const st = wxState(); st.autoSevere = !st.autoSevere; save(); await ctx.answerCallbackQuery().catch(() => {}); await h.show(ctx, mainText(), mainKb()); }));
  bot.callbackQuery('wx:now', (ctx) => only(ctx, async () => {
    await ctx.answerCallbackQuery({ text: '⏳' }).catch(() => {});
    let n = 0; let err = '';
    try { n = (await checkWeather()).length; } catch (e) { err = e.message; }
    await ctx.answerCallbackQuery?.().catch(() => {});
    await h.show(ctx, mainText() + `\n\n${err ? `⚠️ ما قدرت جيب التوقعات: ${esc(err)}` : n ? `🆕 ${n} تحذير جديد — وصلتك البطاقات.` : '✅ ما في تحذيرات جديدة.'}`, mainKb());
  }));
  // test cards (🧪): their buttons never publish anything — they only answer, «تجاهل» removes the card
  bot.callbackQuery(/^wx:t:(c|m|x)$/, async (ctx) => {
    if (ctx.match[1] === 'x') {
      await ctx.answerCallbackQuery({ text: '🧪 هذه تجربة — انحذفت البطاقة' }).catch(() => {});
      try { await ctx.deleteMessage(); } catch { /* */ }
      return;
    }
    await ctx.answerCallbackQuery({ text: '🧪 هذه تجربة — ما رح ينشر شي على القناة أو الخريطة', show_alert: true }).catch(() => {});
  });
  bot.callbackQuery(/^wx:(c|m|x|d):(\w+)$/, (ctx) => only(ctx, async () => {
    const [, act, id] = ctx.match;
    const it = find(id);
    if (!it) return ctx.answerCallbackQuery({ text: 'انتهت صلاحية المسودة' }).catch(() => {});
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
export const _test = { buildWarnings, warningText, alertInput, HAZARDS };
