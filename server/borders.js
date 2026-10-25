// 🛂 Border crossings: a fixed list of Syria's main crossings with a status set by the owner/editors
// from the publishing bot (optionally posted to the channel) and suggestions from the news monitor
// (owner card, never auto-published). Shown on the website (services panel tab + map layer).
import crypto from 'node:crypto';
import { InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { store } from './store.js';
import { normalizeArabic } from './places.js';

const N = normalizeArabic;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rid = () => crypto.randomBytes(4).toString('hex');
const save = () => store.persist({ backupSoon: true });
const siteUrl = () => (config.publicUrl || 'https://red-alert-syria.onrender.com').replace(/\/$/, '');
const when = (t) => new Intl.DateTimeFormat('ar-SY', { timeZone: config.timezone, weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(t));

export const COUNTRIES = {
  lb: { ar: 'لبنان', en: 'Lebanon', flag: '🇱🇧' },
  jo: { ar: 'الأردن', en: 'Jordan', flag: '🇯🇴' },
  tr: { ar: 'تركيا', en: 'Türkiye', flag: '🇹🇷' },
  iq: { ar: 'العراق', en: 'Iraq', flag: '🇮🇶' },
};
// [id, country, Syrian side (ar), other side (ar), en name, lat, lon, extra keywords]
export const CROSSINGS = [
  ['jdeideh', 'lb', 'جديدة يابوس', 'المصنع', 'Jdeidet Yabous – Masnaa', 33.6579, 35.9777, ['جديده يابوس', 'المصنع', 'يابوس']],
  ['dabousieh', 'lb', 'الدبوسية', 'العبودية', 'Dabousieh – Aboudieh', 34.6406, 36.1188, ['الدبوسيه', 'العبوديه']],
  ['jousieh', 'lb', 'جوسية', 'القاع', 'Jousieh – Qaa', 34.4231, 36.5444, ['جوسيه', 'القاع']],
  ['talkalakh', 'lb', 'تلكلخ', 'البقيعة', 'Talkalakh – Bqaiaa', 34.6680, 36.3033, ['البقيعه']],
  ['arida', 'lb', 'طرطوس (العريضة)', 'العريضة', 'Arida', 34.6362, 35.9760, ['العريضه']],
  ['nasib', 'jo', 'نصيب', 'جابر', 'Nasib – Jaber', 32.5424, 36.2029, ['نصيب', 'جابر']],
  ['babalhawa', 'tr', 'باب الهوى', 'جيلفا غوزو', 'Bab al-Hawa – Cilvegözü', 36.2305, 36.6927, ['باب الهوى']],
  ['babalsalama', 'tr', 'باب السلامة', 'أونجو بينار', 'Bab al-Salama – Öncüpınar', 36.6329, 37.0844, ['باب السلامه']],
  ['alrai', 'tr', 'الراعي', 'تشوبان بيه', 'Al-Rai – Çobanbey', 36.6345, 37.4700, ['معبر الراعي']],
  ['jarablus', 'tr', 'جرابلس', 'قرقميش', 'Jarablus – Karkamış', 36.8297, 38.0007, ['جرابلس', 'قرقميش']],
  ['kasab', 'tr', 'كسب', 'يايلاداغي', 'Kasab – Yayladağı', 35.9050, 36.0103, ['كسب']],
  ['telabyad', 'tr', 'تل أبيض', 'أقجة قلعة', 'Tal Abyad – Akçakale', 36.7035, 38.9581, ['تل ابيض']],
  ['rasalain', 'tr', 'رأس العين', 'جيلان بينار', 'Ras al-Ain – Ceylanpınar', 36.8556, 40.0610, ['راس العين', 'جيلان بينار']],
  ['qamishli', 'tr', 'القامشلي', 'نصيبين', 'Qamishli – Nusaybin', 37.0627, 41.2177, ['معبر القامشلي', 'نصيبين']],
  ['bukamal', 'iq', 'البوكمال', 'القائم', 'Al-Bukamal – Al-Qaim', 34.3958, 40.9773, ['البوكمال', 'القائم']],
  ['yarubiyah', 'iq', 'اليعربية', 'ربيعة', 'Al-Yarubiyah – Rabia', 36.8066, 42.0730, ['اليعربيه', 'ربيعه']],
  ['semalka', 'iq', 'سيمالكا', 'فيشخابور', 'Semalka – Faysh Khabur', 37.0892, 42.3484, ['سيمالكا', 'فيشخابور']],
  ['tanf', 'iq', 'التنف', 'الوليد', 'Al-Tanf – Al-Walid', 33.4374, 38.8352, ['التنف', 'الوليد']],
].map(([id, c, ar, other, en, lat, lon, kw]) => ({ id, country: c, ar, other, en, lat, lon, kw }));
const byId = (id) => CROSSINGS.find((x) => x.id === id);
export const BORDER_STATUS = {
  open: { ar: 'مفتوح', en: 'Open', emoji: '🟢', color: '#16a34a' },
  busy: { ar: 'مفتوح مع ازدحام', en: 'Open – heavy traffic', emoji: '🟡', color: '#eab308' },
  partial: { ar: 'مفتوح جزئياً', en: 'Partially open', emoji: '🟠', color: '#f97316' },
  closed: { ar: 'مغلق', en: 'Closed', emoji: '🔴', color: '#dc2626' },
  unknown: { ar: 'غير معروف', en: 'Unknown', emoji: '⚪', color: '#94a3b8' },
};
const STALE_MS = 72 * 3600_000; // a status older than 3 days is shown as "not updated"

function bstate() {
  const svc = (store.state.svc ||= {});
  svc.borders ||= {};
  svc.borderSugg ||= [];
  svc.borderNews ??= true;
  return svc;
}
export function publicBorders(now = Date.now()) {
  const b = bstate().borders;
  return CROSSINGS.map((c) => {
    const s = b[c.id];
    const fresh = s && now - s.ts < STALE_MS;
    return { id: c.id, country: c.country, country_ar: COUNTRIES[c.country].ar, country_en: COUNTRIES[c.country].en,
      name_ar: c.ar, other_ar: c.other, name_en: c.en, lat: c.lat, lon: c.lon,
      status: fresh ? s.st : 'unknown', note: fresh ? s.note || '' : '', ts: s?.ts || null };
  });
}
const emit = () => store.emit?.('borders', publicBorders());
export function setBorder(id, st, note, by) {
  const c = byId(id); if (!c || !BORDER_STATUS[st]) return null;
  const b = bstate().borders;
  b[id] = { st, note: String(note || '').slice(0, 300), ts: Date.now(), by: by || 0 };
  save(); emit();
  return b[id];
}
export function mergeBordersFromBackup(o) {
  const ob = o?.svc?.borders; if (!ob) return;
  const b = bstate().borders;
  for (const [k, v] of Object.entries(ob)) if (!b[k] || (v.ts || 0) > (b[k].ts || 0)) b[k] = v;
}
export function borderChannelText(id) {
  const c = byId(id); const s = bstate().borders[id]; if (!c || !s) return '';
  const S = BORDER_STATUS[s.st];
  return `🛂 <b>معبر ${esc(c.ar)}</b> ${COUNTRIES[c.country].flag} (${esc(c.other)} — ${esc(COUNTRIES[c.country].ar)})\n\n`
    + `الحالة: ${S.emoji} <b>${esc(S.ar)}</b>${s.note ? `\n<blockquote>${esc(s.note)}</blockquote>` : ''}\n\n<i>${esc(when(s.ts))}</i>`;
}
async function postToChannel(api, id) {
  if (!config.channel) return null;
  const kb = new InlineKeyboard().url('🛂 حالة كل المعابر', `${siteUrl()}/ar/#borders`);
  return api.sendMessage(config.channel, borderChannelText(id), { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } });
}

// ---------------------------------------------------------------- news monitor suggestions
const ST_WORDS = [
  ['closed', ['اغلاق', 'اغلق', 'مغلق', 'اقفال', 'ايقاف حركه', 'توقف حركه', 'توقف العمل', 'تعليق العمل', 'تعليق الحركه', 'اغلاق معبر', 'closed', 'closure']],
  ['busy', ['ازدحام', 'زحمه', 'طوابير', 'انتظار طويل', 'اكتظاظ']],
  ['partial', ['جزئي', 'للمغادرين فقط', 'للقادمين فقط', 'باتجاه واحد', 'للشاحنات فقط', 'للمسافرين فقط']],
  ['open', ['افتتاح', 'اعاده فتح', 'اعاده افتتاح', 'استئناف', 'عوده الحركه', 'فتح معبر', 'مفتوح', 'reopen']],
];
/** which crossing a post talks about and the status it suggests (null if not about a crossing) */
export function matchBorderNews(text) {
  const t = N(text || '');
  if (!/معبر|منفذ/.test(t)) return null;
  let hit = null; let at = Infinity;
  for (const c of CROSSINGS) {
    for (const k of new Set([c.ar, c.other, ...c.kw])) {
      const nk = N(k).replace(/^معبر /, '');
      for (const pre of ['معبر ', 'منفذ ', 'معبري ', 'المعبر ']) {
        const i = t.indexOf(N(pre + nk));
        if (nk.length >= 3 && i >= 0 && i < at) { hit = c; at = i; }
      }
    }
  }
  if (!hit) return null;
  let st = null;
  for (const [s, words] of ST_WORDS) if (words.some((w) => t.includes(N(w)))) { st = s; break; }
  if (!st) return null;
  return { id: hit.id, st };
}
const R = { H: null };
export function onBorderNews(it) {
  const s = bstate();
  if (!s.borderNews) return false;
  const m = matchBorderNews(it.text || '');
  if (!m) return false;
  const h = crypto.createHash('sha1').update(N(it.text).slice(0, 300)).digest('base64').slice(0, 12);
  if (s.borderSugg.some((x) => x.h === h)) return true;
  const sg = { id: rid(), h, cid: m.id, st: m.st, text: String(it.text).slice(0, 600), src: it.src?.name || '', ts: Date.now() };
  s.borderSugg.push(sg);
  s.borderSugg = s.borderSugg.filter((x) => Date.now() - x.ts < 3 * 86400_000).slice(-30);
  save();
  sendSuggestion(sg).catch(() => {});
  return true;
}
const suggKb = (sg) => new InlineKeyboard()
  .text('✅ اعتمد على الموقع', `bs:s:${sg.id}`).row()
  .text('📢 الموقع + القناة', `bs:c:${sg.id}`).row()
  .text('🔁 غيّر الحالة', `bs:e:${sg.id}`).text('❌ تجاهل', `bs:x:${sg.id}`);
function suggText(sg) {
  const c = byId(sg.cid); const S = BORDER_STATUS[sg.st];
  return `🛂 <b>تحديث معبر من الرصد</b> — بانتظار قرارك\n\nالمعبر: <b>${esc(c.ar)}</b> ${COUNTRIES[c.country].flag}\nالحالة المقترحة: ${S.emoji} <b>${esc(S.ar)}</b>\n\n<blockquote>${esc(sg.text.slice(0, 500))}</blockquote>\n<i>المصدر (للمراجعة فقط): ${esc(sg.src)}</i>`;
}
async function sendSuggestion(sg) {
  const api = R.H?.apis().admin; if (!api) return;
  sg.cards = [];
  for (const uid of new Set(config.ownerIds)) {
    try { const m = await api.sendMessage(uid, suggText(sg), { parse_mode: 'HTML', reply_markup: suggKb(sg), _keep: 'c' }); sg.cards.push([uid, m.message_id]); } catch { /* */ }
  }
  save();
}

// ---------------------------------------------------------------- publishing bot
const pend = new Map(); // uid -> { id, st }
export function registerBorderTools(bot, h) {
  R.H = h;
  (store.mergeHooks ||= []).push(mergeBordersFromBackup);
  const only = async (ctx, fn) => { if (!h.staff(ctx)) return ctx.answerCallbackQuery().catch(() => {}); return fn(); };
  const listText = () => {
    const pb = publicBorders();
    const lines = Object.entries(COUNTRIES).map(([k, co]) => `${co.flag} <b>${co.ar}</b>\n${pb.filter((x) => x.country === k).map((x) => `${BORDER_STATUS[x.status].emoji} ${esc(x.name_ar)}${x.status !== 'unknown' ? ` — ${esc(BORDER_STATUS[x.status].ar)}` : ''}`).join('\n')}`);
    return `🛂 <b>المعابر الحدودية</b>\n\nاختار المعبر لتحدّث حالته. التحديث بيظهر على الموقع فوراً، وفيك تنشره بالقناة كمان.\nالحالة اللي ما بتتحدّث 3 أيام بترجع «غير معروف».\n\n${lines.join('\n\n')}`;
  };
  const listKb = (ctx) => {
    const kb = new InlineKeyboard();
    for (const k of Object.keys(COUNTRIES)) {
      const cs = CROSSINGS.filter((c) => c.country === k);
      cs.forEach((c, i) => { kb.text(`${COUNTRIES[k].flag} ${c.ar}`, `bd:c:${c.id}`); if (i % 2 === 1) kb.row(); });
      if (cs.length % 2) kb.row();
    }
    if (h.owner(ctx)) kb.text(bstate().borderNews ? '⏸ إيقاف الالتقاط من الرصد' : '▶️ تشغيل الالتقاط من الرصد', 'bd:news').row();
    return kb.url('🌐 الصفحة على الموقع', `${siteUrl()}/ar/#borders`).row().text('🏠 القائمة', 'home');
  };
  const stKb = (id) => {
    const kb = new InlineKeyboard();
    ['open', 'busy', 'partial', 'closed'].forEach((s, i) => { kb.text(`${BORDER_STATUS[s].emoji} ${BORDER_STATUS[s].ar}`, `bd:s:${id}:${s}`); if (i % 2) kb.row(); });
    return kb.text('⚪ مسح الحالة', `bd:s:${id}:unknown`).row().text('↩️ رجوع', 'bd');
  };
  const doneKb = (id) => new InlineKeyboard().text('📢 انشر بالقناة', `bd:p:${id}`).row().text('✏️ أضف/عدّل ملاحظة', `bd:n:${id}`).row().text('↩️ كل المعابر', 'bd').text('🏠 القائمة', 'home');
  const curText = (id, extra = '') => {
    const c = byId(id); const s = bstate().borders[id];
    const S = BORDER_STATUS[s?.st || 'unknown'];
    return `🛂 <b>معبر ${esc(c.ar)}</b> ${COUNTRIES[c.country].flag} — ${esc(c.other)}\n\nالحالة الحالية: ${S.emoji} <b>${esc(S.ar)}</b>${s?.note ? `\nملاحظة: ${esc(s.note)}` : ''}${s?.ts ? `\n<i>آخر تحديث: ${esc(when(s.ts))}</i>` : ''}${extra}`;
  };
  bot.on('callback_query:data', async (ctx, next) => { if (!/^bd:n:/.test(ctx.callbackQuery.data)) pend.delete(ctx.from?.id); return next(); });
  bot.callbackQuery('bd', (ctx) => only(ctx, async () => { await ctx.answerCallbackQuery().catch(() => {}); await h.show(ctx, listText(), listKb(ctx)); }));
  bot.callbackQuery('bd:news', (ctx) => only(ctx, async () => {
    if (!h.owner(ctx)) return ctx.answerCallbackQuery().catch(() => {});
    const s = bstate(); s.borderNews = !s.borderNews; save();
    await ctx.answerCallbackQuery().catch(() => {}); await h.show(ctx, listText(), listKb(ctx));
  }));
  bot.callbackQuery(/^bd:c:(\w+)$/, (ctx) => only(ctx, async () => {
    await ctx.answerCallbackQuery().catch(() => {});
    const id = ctx.match[1]; if (!byId(id)) return;
    await h.show(ctx, curText(id, '\n\nاختار الحالة الجديدة 👇'), stKb(id));
  }));
  bot.callbackQuery(/^bd:s:(\w+):(\w+)$/, (ctx) => only(ctx, async () => {
    const [, id, st] = ctx.match;
    if (!setBorder(id, st, '', ctx.from.id)) return ctx.answerCallbackQuery().catch(() => {});
    await ctx.answerCallbackQuery({ text: '✅' }).catch(() => {});
    await h.show(ctx, curText(id, '\n\n✅ انحفظت على الموقع.'), doneKb(id));
  }));
  bot.callbackQuery(/^bd:n:(\w+)$/, (ctx) => only(ctx, async () => {
    await ctx.answerCallbackQuery().catch(() => {});
    const id = ctx.match[1]; if (!bstate().borders[id]) return;
    pend.set(ctx.from.id, { id, exp: Date.now() + 10 * 60_000 });
    await h.show(ctx, curText(id, '\n\n✏️ اكتب الملاحظة برسالة (مثلاً: «ازدحام كبير باتجاه لبنان، الانتظار حوالي 3 ساعات»).'), new InlineKeyboard().text('↩️ رجوع', `bd:c:${id}`));
  }));
  bot.callbackQuery(/^bd:p:(\w+)$/, (ctx) => only(ctx, async () => {
    const id = ctx.match[1]; const s = bstate().borders[id];
    if (!s) return ctx.answerCallbackQuery().catch(() => {});
    if (s.posted && Date.now() - s.posted < 60_000) return ctx.answerCallbackQuery({ text: '✅ منشور' }).catch(() => {});
    try { await postToChannel(ctx.api, id); s.posted = Date.now(); save(); } catch (e) { return ctx.answerCallbackQuery({ text: '⚠️ ' + String(e.description || e.message).slice(0, 80), show_alert: true }).catch(() => {}); }
    await ctx.answerCallbackQuery({ text: '📢 انتشر بالقناة' }).catch(() => {});
    await h.show(ctx, curText(id, '\n\n📢 انتشر بالقناة.'), doneKb(id));
  }));
  bot.on('message:text', async (ctx, next) => {
    const p = pend.get(ctx.from?.id);
    if (!p || p.exp < Date.now() || ctx.message.text.startsWith('/') || !h.staff(ctx)) return next();
    pend.delete(ctx.from.id);
    const s = bstate().borders[p.id];
    setBorder(p.id, s?.st || 'open', ctx.message.text.trim(), ctx.from.id);
    try { await ctx.deleteMessage(); } catch { /* */ }
    await h.show(ctx, curText(p.id, '\n\n✅ انحفظت الملاحظة.'), doneKb(p.id));
  });
  // owner: suggestions from the news monitor
  bot.callbackQuery(/^bs:(s|c|e|x):(\w+)$/, (ctx) => only(ctx, async () => {
    const [, act, id] = ctx.match;
    const s = bstate(); const sg = s.borderSugg.find((x) => x.id === id);
    if (!sg) return ctx.answerCallbackQuery({ text: 'انتهت صلاحية الاقتراح' }).catch(() => {});
    const close = async () => { for (const [c, m] of sg.cards || []) { try { await ctx.api.deleteMessage(c, m); } catch { /* */ } } sg.cards = []; save(); };
    if (act === 'x') { await ctx.answerCallbackQuery({ text: '✖️' }).catch(() => {}); return close(); }
    if (act === 'e') { await ctx.answerCallbackQuery().catch(() => {}); return h.show(ctx, curText(sg.cid, '\n\nاختار الحالة الصحيحة 👇'), stKb(sg.cid)); }
    setBorder(sg.cid, sg.st, '', ctx.from.id);
    if (act === 'c') { try { await postToChannel(ctx.api, sg.cid); } catch { /* */ } }
    await ctx.answerCallbackQuery({ text: '✅' }).catch(() => {});
    await close();
  }));
}
export const _test = { matchBorderNews, publicBorders, setBorder };
