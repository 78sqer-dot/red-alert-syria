// 🛣 Road status layer + ⚡ electricity updates.
//  - Roads: published from the publishing bot (staff) or approved public reports; each entry has one or
//    more points (the bot's place picker), a status (closed / danger / open), a note and an expiry.
//    Shown on the map as a toggleable layer; expired entries disappear by themselves.
//  - Electricity: rationing / outage / tariff updates per governorate. Fed by the news monitor (posts
//    about electricity become cards for the owner, never auto-published) and by the owner by hand.
//    Shown on the website (⚡ panel); optionally posted to the channel.
import crypto from 'node:crypto';
import { InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { store } from './store.js';
import { governorates, normalizeArabic } from './places.js';

const H_MS = 3600_000;
const N = normalizeArabic;
const rid = () => crypto.randomBytes(5).toString('hex');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const save = (soon = true) => store.persist({ backupSoon: soon });
const siteUrl = () => (config.publicUrl || 'https://red-alert-syria.onrender.com').replace(/\/$/, '');
const clock = (t) => new Intl.DateTimeFormat('ar-SY', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(t));
const dayClock = (t) => new Intl.DateTimeFormat('ar-SY', { timeZone: config.timezone, weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(t));

export const ROAD_STATUS = {
  closed: { emoji: '⛔', ar: 'طريق مسكّر', en: 'Road closed', color: '#ef4444' },
  danger: { emoji: '⚠️', ar: 'طريق خطر', en: 'Dangerous road', color: '#f59e0b' },
  open: { emoji: '✅', ar: 'طريق سالك', en: 'Road open', color: '#22c55e' },
};
export const ROAD_DURATIONS = [60, 120, 360, 720, 1440, 2880];
export const roadLabel = (st, lang = 'ar') => { const s = ROAD_STATUS[st] || ROAD_STATUS.danger; return `${s.emoji} ${lang === 'en' ? s.en : s.ar}`; };

function svc() { return (store.state.svc ||= {}); }
function roadsArr() { const s = svc(); if (!Array.isArray(s.roads)) s.roads = []; return s.roads; }
function powerArr() { const s = svc(); if (!Array.isArray(s.power)) s.power = []; return s.power; }

// ---------------------------------------------------------------- roads
const ptOf = (l) => (l && Number.isFinite(l.latitude) && Number.isFinite(l.longitude) && l.scope !== 'country'
  ? { lat: +l.latitude.toFixed(5), lon: +l.longitude.toFixed(5), name_ar: l.name_ar || '', name_en: l.name_en || l.name_ar || '', gov_ar: l.governorate_ar || '', gov_en: l.governorate_en || '', scope: l.scope }
  : null);
export function activeRoads(now = Date.now()) { return roadsArr().filter((r) => r.expires > now).sort((a, b) => b.ts - a.ts); }
export function publicRoads(now = Date.now()) {
  return activeRoads(now).map((r) => ({ id: r.id, status: r.status, pts: r.pts, note: r.note || '', ts: new Date(r.ts).toISOString(), expires: new Date(r.expires).toISOString() }));
}
const emitRoads = () => store.emit('roads', publicRoads());
/** a bot draft (type 'road') -> road entry */
export function addRoad(d, author) {
  const pts = [d.location, ...(d.extra || [])].map(ptOf).filter(Boolean).slice(0, 12);
  if (!pts.length) throw new Error('road needs a place');
  const now = Date.now();
  const r = { id: rid(), status: ROAD_STATUS[d.road] ? d.road : 'danger', pts, note: String(d.details || '').trim().slice(0, 400), ts: now, expires: now + Math.min(2880, Math.max(30, d.ttlMin || 360)) * 60_000, by: author || null };
  const arr = roadsArr();
  arr.push(r);
  while (arr.length > 300) arr.shift();
  save(); emitRoads();
  return r;
}
export function endRoad(id) {
  const r = roadsArr().find((x) => x.id === id);
  if (!r || r.expires <= Date.now()) return false;
  r.expires = Date.now(); save(); emitRoads();
  return true;
}
export const roadWhere = (r, lang = 'ar') => r.pts.map((p) => (lang === 'en' ? p.name_en : p.name_ar) + (p.scope !== 'governorate' && (lang === 'en' ? p.gov_en : p.gov_ar) ? `، ${lang === 'en' ? p.gov_en : p.gov_ar}` : '')).join(' ← ');
export function roadChannelText(r) {
  const s = ROAD_STATUS[r.status];
  const L = [`${s.emoji} <b>${s.ar}</b>`, '', `📍 ${esc(roadWhere(r))}`];
  if (r.note) L.push(`📝 ${esc(r.note)}`);
  L.push(`🕒 ${clock(r.ts)}`);
  return L.join('\n');
}
export async function postRoadToChannel(api, r) {
  const kb = new InlineKeyboard().url('🗺 حالة الطرق على الخريطة', `${siteUrl()}/ar/#roads`);
  const m = await api.sendMessage(config.channel, roadChannelText(r), { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } });
  r.channel_message_id = m.message_id; save();
  return m;
}

// ---------------------------------------------------------------- electricity
const GOVS = [...governorates].sort((a, b) => b.ar.length - a.ar.length); // "ريف دمشق" before "دمشق"
export function govOfText(text) {
  const t = ` ${N(text)} `;
  for (const g of GOVS) {
    const names = [g.ar, ...(g.alt || [])];
    if (names.some((n) => t.includes(` ${N(n)} `) || t.includes(` ${N('ب' + n)} `) || t.includes(` ${N('و' + n)} `) || t.includes(` ${N('ل' + n)} `))) return g;
  }
  return null;
}
const STRONG = ['تقنين', 'التقنين', 'الكهرباء', 'كهرباء', 'الكهربائي', 'الكهربائية', 'التيار الكهربائي', 'محطة توليد', 'محطات التوليد', 'ساعات الوصل', 'ساعات القطع', 'المنظومة الكهربائية', 'الشبكة الكهربائية', 'التغذية الكهربائية', 'العنفات', 'ميغاواط'];
const NOISE = ['مسيرة', 'غارة', 'قصف', 'استهداف', 'اشتباك', 'انفجار'];
/** is this news post an electricity update? -> { ok, gov } */
export function isPowerNews(text) {
  const t = ` ${N(text)} `;
  const hits = STRONG.filter((k) => t.includes(` ${N(k)}`) || t.includes(`${N(k)} `)).length;
  if (!hits) return { ok: false };
  // a strike that hit a power station is an alert, not a service update
  if (NOISE.some((k) => t.includes(N(k)))) return { ok: false };
  const g = govOfText(text);
  return { ok: true, gov: g ? g.code : null };
}
const govName = (code, lang = 'ar') => { const g = governorates.find((x) => x.code === code); return g ? (lang === 'en' ? g.en : g.ar) : (lang === 'en' ? 'All Syria' : 'عموم سوريا'); };
export function publicPower(limit = 60) {
  return powerArr().filter((p) => p.pub).sort((a, b) => b.ts - a.ts).slice(0, limit)
    .map((p) => ({ id: p.id, gov: p.gov || null, gov_ar: govName(p.gov), gov_en: govName(p.gov, 'en'), text: p.text, ts: new Date(p.ts).toISOString() }));
}
const emitPower = () => store.emit('power', publicPower());
function trimPower() {
  const arr = powerArr(); const now = Date.now();
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    if ((!p.pub && now - p.ts > 48 * H_MS) || now - p.ts > 45 * 24 * H_MS) arr.splice(i, 1);
  }
  while (arr.length > 200) arr.shift();
}
/** clean a news post into a short public text: no hashtags, links, @handles or source signatures */
export function cleanPowerText(s) {
  return String(s || '')
    .replace(/https?:\/\/\S+/g, '').replace(/[@#][\p{L}\p{N}_]+/gu, '')
    .replace(/^.*(تابعونا|للاشتراك|قناة|تلغرام|تيليغرام|telegram).*$/gimu, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\uFE0F/g, '').replace(/^\s*(عاجل|خاص|متابعة)\s*[|:\-–]\s*/u, '')
    .replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim().slice(0, 700);
}

// ---------------------------------------------------------------- timers
let swept = 0;
function sweep() {
  const now = Date.now();
  const arr = roadsArr();
  const before = arr.length;
  // keep ended entries 3 days for history, then drop
  for (let i = arr.length - 1; i >= 0; i--) if (now - arr[i].expires > 72 * H_MS) arr.splice(i, 1);
  const live = activeRoads(now).length;
  if (live !== swept || before !== arr.length) { swept = live; save(false); emitRoads(); }
  trimPower();
}
let started = false;
export function startServices() {
  if (started) return;
  started = true;
  swept = activeRoads().length;
  (store.mergeHooks ||= []).push(mergeServicesFromBackup);
  setInterval(sweep, 60_000).unref();
}
export function mergeServicesFromBackup(o) {
  const os = o?.svc; if (!os) return;
  const ids = new Set(roadsArr().map((r) => r.id));
  for (const r of os.roads || []) if (!ids.has(r.id)) roadsArr().push(r);
  const pids = new Set(powerArr().map((p) => p.id));
  for (const p of os.power || []) if (!pids.has(p.id)) powerArr().push(p);
}

// ---------------------------------------------------------------- bot: electricity tools (publishing bot)
const pend = new Map(); // owner id -> { k: 'text'|'edit', gov, id, exp }
const R = { H: null };
const reviewerIds = () => [...new Set([...config.ownerIds])];
function powerCardText(p) {
  return `⚡ <b>تحديث كهرباء${p.src ? ' من الرصد' : ''}</b> — ${esc(govName(p.gov))}\n\n${esc(p.text)}\n\n`
    + `${p.src ? `<i>المصدر (للمراجعة فقط، ما بينذكر بالنشر): ${esc(p.src.name)}</i>\n` : ''}<i>${dayClock(p.ts)}</i>`;
}
const powerCardKb = (p) => new InlineKeyboard()
  .text('✅ نشر على الموقع', `pw:s:${p.id}`).row()
  .text('📢 الموقع + القناة', `pw:c:${p.id}`).row()
  .text('✏️ تعديل النص', `pw:e:${p.id}`).text('🗺 المحافظة', `pw:g:${p.id}`).row()
  .text('❌ تجاهل', `pw:x:${p.id}`);
async function sendPowerCard(p) {
  const api = R.H?.apis().admin;
  if (!api) return;
  p.cards = [];
  for (const uid of reviewerIds()) {
    try { const m = await api.sendMessage(uid, powerCardText(p), { parse_mode: 'HTML', reply_markup: powerCardKb(p), link_preview_options: { is_disabled: true }, _keep: 'c' }); p.cards.push([uid, m.message_id]); } catch { /* not started */ }
  }
  save();
}
/** news-monitor hook: an electricity post -> owner card (never auto-published) */
export function onNewsPost(it) {
  const s = svc();
  const n = (s.powerNews ||= { on: true, day: '', count: 0 });
  if (!n.on) return false;
  const r = isPowerNews(it.text || '');
  if (!r.ok) return false;
  const text = cleanPowerText(it.text);
  if (text.length < 25) return false;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
  if (n.day !== day) { n.day = day; n.count = 0; }
  if (n.count >= 12) return false; // flood guard
  const h = crypto.createHash('sha1').update(N(text).slice(0, 300)).digest('base64').slice(0, 14);
  const seen = (s.powerSeen ||= {});
  if (seen[h]) return false;
  seen[h] = Date.now();
  for (const [k, t] of Object.entries(seen)) if (Date.now() - t > 72 * H_MS) delete seen[k];
  n.count++;
  const p = { id: rid(), gov: r.gov, text, ts: it.ts || Date.now(), src: { name: it.src?.name || '', url: it.url || '' }, pub: false };
  powerArr().push(p); trimPower(); save();
  sendPowerCard(p).catch(() => {});
  return true;
}
async function publishPower(api, p, channel) {
  p.pub = true; p.ts = p.ts || Date.now(); p.pubAt = Date.now(); save(); emitPower();
  if (channel && config.channel) {
    const kb = new InlineKeyboard().url('⚡ كل تحديثات الكهرباء', `${siteUrl()}/ar/#power`);
    const m = await api.sendMessage(config.channel, `⚡ <b>الكهرباء — ${esc(govName(p.gov))}</b>\n\n${esc(p.text)}`, { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } });
    p.channel_message_id = m.message_id; save();
  }
}
async function closePowerCards(api, p, keep) {
  for (const [chat, mid] of p.cards || []) {
    if (keep && keep[0] === chat && keep[1] === mid) continue;
    try { await api.deleteMessage(chat, mid); } catch { /* ignore */ }
  }
  p.cards = [];
}
export function registerPowerTools(bot, h) {
  R.H = h;
  const onlyOwner = async (ctx, fn) => { if (!h.owner(ctx)) return ctx.answerCallbackQuery().catch(() => {}); return fn(); };
  const find = async (id) => {
    let p = powerArr().find((x) => x.id === id);
    if (!p && store.backup) { await store.mergeFromBackup().catch(() => {}); p = powerArr().find((x) => x.id === id); }
    return p || null;
  };
  const govKb = (prefix, back) => {
    const kb = new InlineKeyboard().text('🇸🇾 عموم سوريا', `${prefix}:all`).row();
    governorates.forEach((g, i) => { kb.text(g.ar, `${prefix}:${g.code}`); if (i % 3 === 2) kb.row(); });
    return kb.row().text('↩️ رجوع', back);
  };
  const mainText = () => {
    const n = (svc().powerNews ||= { on: true });
    const pub = publicPower(5);
    const list = pub.length ? pub.map((p) => `• <b>${esc(p.gov_ar)}</b> — ${esc(p.text.slice(0, 70))}${p.text.length > 70 ? '…' : ''}`).join('\n') : '— ما في تحديثات منشورة بعد.';
    return `⚡ <b>الكهرباء</b>\n\nأخبار الكهرباء والتقنين بتنعرض على الموقع بقسم «⚡ الكهرباء» حسب المحافظة.\n\n📡 التقاط أخبار الكهرباء من الرصد: <b>${n.on ? '✅ مفعّل' : '⏸ متوقف'}</b>\n(كل خبر بيوصلك كبطاقة، وما بينشر شي إلا بموافقتك)\n\n<b>آخر المنشور:</b>\n${list}`;
  };
  const mainKb = (ctx) => {
    const n = (svc().powerNews ||= { on: true });
    const kb = new InlineKeyboard().text('➕ أضف تحديث كهرباء', 'pwr:add').row();
    if (publicPower(1).length) kb.text('🗑 حذف تحديث منشور', 'pwr:del').row();
    return kb.text(n.on ? '⏸ إيقاف الالتقاط من الرصد' : '▶️ تشغيل الالتقاط من الرصد', n.on ? 'pwr:off' : 'pwr:on').row()
      .url('🌐 القسم على الموقع', `${siteUrl()}/ar/#power`).row().text(h.L(ctx).btnHome, 'home');
  };
  const showMain = (ctx) => h.show(ctx, mainText(), mainKb(ctx));
  bot.on('callback_query:data', async (ctx, next) => { pend.delete(ctx.from?.id); return next(); });
  bot.callbackQuery('pwr', (ctx) => onlyOwner(ctx, async () => { await ctx.answerCallbackQuery(); await showMain(ctx); }));
  bot.callbackQuery(/^pwr:(on|off)$/, (ctx) => onlyOwner(ctx, async () => {
    (svc().powerNews ||= {}).on = ctx.match[1] === 'on'; save();
    await ctx.answerCallbackQuery('✔️'); await showMain(ctx);
  }));
  bot.callbackQuery('pwr:add', (ctx) => onlyOwner(ctx, async () => {
    await ctx.answerCallbackQuery();
    await h.show(ctx, '⚡ <b>تحديث كهرباء جديد</b>\n\nلأي محافظة؟', govKb('pwr:g', 'pwr'));
  }));
  bot.callbackQuery(/^pwr:g:(\w+)$/, (ctx) => onlyOwner(ctx, async () => {
    await ctx.answerCallbackQuery();
    const gov = ctx.match[1] === 'all' ? null : ctx.match[1];
    pend.set(ctx.from.id, { k: 'text', gov, exp: Date.now() + 10 * 60_000 });
    await h.show(ctx, `⚡ <b>${esc(govName(gov))}</b>\n\nاكتب نص التحديث، مثلاً:\n<i>برنامج التقنين الجديد: 4 ساعات وصل مقابل ساعتين قطع اعتباراً من اليوم.</i>`, new InlineKeyboard().text('↩️ رجوع', 'pwr:add'));
  }));
  bot.callbackQuery('pwr:del', (ctx) => onlyOwner(ctx, async () => {
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    for (const p of publicPower(12)) kb.text(`🗑 ${p.gov_ar} · ${p.text.slice(0, 34)}`, `pwr:dx:${p.id}`).row();
    await h.show(ctx, '🗑 اختر التحديث يلي بدك تشيله من الموقع:', kb.text('↩️ رجوع', 'pwr'));
  }));
  bot.callbackQuery(/^pwr:dx:(\w+)$/, (ctx) => onlyOwner(ctx, async () => {
    const p = await find(ctx.match[1]);
    if (p) { p.pub = false; p.ts = Date.now() - 47 * H_MS; save(); emitPower(); }
    await ctx.answerCallbackQuery('🗑 انشال من الموقع'); await showMain(ctx);
  }));
  // review cards (from the news monitor) and the owner's own preview
  bot.callbackQuery(/^pw:(s|c|e|g|x|gg):(\w+)(?::(\w+))?$/, (ctx) => onlyOwner(ctx, async () => {
    const [, a, id, extra] = ctx.match;
    const p = await find(id);
    const cur = ctx.callbackQuery.message ? [ctx.callbackQuery.message.chat.id, ctx.callbackQuery.message.message_id] : null;
    if (!p) { await ctx.answerCallbackQuery({ text: 'هذا التحديث لم يعد متاحاً', show_alert: true }); try { await ctx.deleteMessage(); } catch { /* ignore */ } return; }
    if (a === 'x') { p.cards = p.cards || []; await closePowerCards(ctx.api, p); powerArr().splice(powerArr().indexOf(p), 1); save(); await ctx.answerCallbackQuery('تم التجاهل'); try { await ctx.deleteMessage(); } catch { /* ignore */ } return; }
    if (a === 'e') {
      await ctx.answerCallbackQuery();
      pend.set(ctx.from.id, { k: 'edit', id, exp: Date.now() + 10 * 60_000, card: cur });
      return ctx.reply('✏️ أرسل النص الجديد للتحديث (رح يحل محل النص الحالي):', { _keep: 'c' }).then((m) => { pend.get(ctx.from.id).ask = [m.chat.id, m.message_id]; }).catch(() => {});
    }
    if (a === 'g') { await ctx.answerCallbackQuery(); return ctx.editMessageReplyMarkup({ reply_markup: govKb(`pw:gg:${id}`, `pw:back:${id}`) }).catch(() => {}); }
    if (a === 'gg') {
      p.gov = extra === 'all' ? null : extra; save();
      await ctx.answerCallbackQuery('✔️');
      return ctx.editMessageText(powerCardText(p), { parse_mode: 'HTML', reply_markup: powerCardKb(p), link_preview_options: { is_disabled: true } }).catch(() => {});
    }
    if (p.pub && a !== 'c') { await ctx.answerCallbackQuery('منشور مسبقاً ✔️'); return; }
    await ctx.answerCallbackQuery('جارٍ النشر…');
    try { await publishPower(ctx.api, p, a === 'c'); } catch (e) { return ctx.reply(`⚠️ ${esc(e.description || e.message)}`); }
    await closePowerCards(ctx.api, p, cur);
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await h.sendTransient(ctx.api, ctx.chat.id, a === 'c' ? '✅ نُشر التحديث على الموقع وبالقناة.' : '✅ نُشر التحديث على الموقع (قسم الكهرباء).');
  }));
  bot.callbackQuery(/^pw:back:(\w+)$/, (ctx) => onlyOwner(ctx, async () => {
    const p = await find(ctx.match[1]); await ctx.answerCallbackQuery();
    if (p) await ctx.editMessageReplyMarkup({ reply_markup: powerCardKb(p) }).catch(() => {});
  }));
  bot.on('message:text', async (ctx, next) => {
    const q = pend.get(ctx.from?.id);
    if (!q) return next();
    if (!h.owner(ctx) || Date.now() > q.exp) { pend.delete(ctx.from.id); return next(); }
    const txt = String(ctx.message.text || '').trim();
    if (txt.startsWith('/')) { pend.delete(ctx.from.id); return next(); }
    if (txt.length < 8) return ctx.reply('⚠️ النص قصير كتير، اكتب التحديث كامل.');
    pend.delete(ctx.from.id);
    if (q.k === 'edit') {
      const p = await find(q.id);
      if (!p) return ctx.reply('هذا التحديث لم يعد متاحاً');
      p.text = cleanPowerText(txt) || txt.slice(0, 700); save();
      if (p.pub) emitPower();
      if (q.ask) { try { await ctx.api.deleteMessage(q.ask[0], q.ask[1]); } catch { /* ignore */ } }
      if (q.card) {
        try { await ctx.api.editMessageText(q.card[0], q.card[1], powerCardText(p), { parse_mode: 'HTML', reply_markup: powerCardKb(p), link_preview_options: { is_disabled: true } }); return; } catch { /* send a new card */ }
      }
      const m = await ctx.reply(powerCardText(p), { parse_mode: 'HTML', reply_markup: powerCardKb(p), _keep: 'c' });
      p.cards = [[m.chat.id, m.message_id]]; save();
      return;
    }
    const p = { id: rid(), gov: q.gov, text: txt.slice(0, 700), ts: Date.now(), src: null, pub: false };
    powerArr().push(p); save();
    const m = await ctx.reply(`👀 <b>معاينة</b> — هيك رح يظهر على الموقع:\n\n${powerCardText(p)}`, { parse_mode: 'HTML', reply_markup: powerCardKb(p), _keep: 'c' });
    p.cards = [[m.chat.id, m.message_id]]; save();
  });
}
export const _test = { isPowerNews, govOfText, cleanPowerText, addRoad, publicRoads, endRoad };
