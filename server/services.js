// 🛣 Road status layer + ⚡ electricity updates.
//  - Roads: published from the publishing bot (staff) or approved public reports; each entry has one or
//    more points (the bot's place picker), a status (closed / danger / open), a note and an expiry.
//    Shown on the map as a toggleable layer; expired entries disappear by themselves.
//  - Electricity: rationing / outage / tariff updates per governorate. Only government/SANA URLs are
//    accepted from the news monitor or the owner; news becomes a review card and is never auto-published.
//    Published items retain a direct source link on the website and in the channel.
import crypto from 'node:crypto';
import { InlineKeyboard, InputFile } from 'grammy';
import { config } from './config.js';
import { store } from './store.js';
import { governorates, normalizeArabic } from './places.js';
import { weatherWarningInfo } from './news-ai.js';
import { renderRoadPng } from './alert-image.js';

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
export function roadChannelCaption(r) {
  const s = ROAD_STATUS[r.status] || ROAD_STATUS.danger;
  const statusLine = `${s.emoji} <b>${esc(s.ar)}</b>`;
  const timeLine = `🕒 ${clock(r.ts)}`;
  const allPlaces = roadWhere(r); const allNote = String(r.note || '');
  let places = allPlaces; let note = allNote;
  const build = () => {
    const lines = [statusLine, '', `📍 ${esc(places)}${places.length < allPlaces.length ? '…' : ''}`];
    if (note) lines.push(`📝 ${esc(note)}${note.length < allNote.length ? '…' : ''}`);
    lines.push(timeLine);
    return lines.join('\n');
  };
  let caption = build();
  while (caption.length > 1000 && (note.length || places.length)) {
    if (note.length) note = note.slice(0, Math.max(0, note.length - 10));
    else places = places.slice(0, Math.max(0, places.length - 10));
    caption = build();
  }
  return caption;
}
export async function postRoadToChannel(api, r) {
  if (!config.channel) return null;
  const kb = new InlineKeyboard().url('🗺 حالة الطرق على الخريطة', `${siteUrl()}/ar/#roads`);
  const png = await renderRoadPng(r, ROAD_STATUS[r.status] || ROAD_STATUS.danger, { timestamp: r.ts });
  const m = await api.sendPhoto(config.channel, new InputFile(png, `red-alert-syria-road-${r.id || 'report'}.png`), {
    caption: roadChannelCaption(r), parse_mode: 'HTML', reply_markup: kb,
  });
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
const POWER_SUBJECT = ['الكهرباء', 'كهرباء', 'التيار الكهربائي', 'الكهربائي', 'الكهربائية', 'الشبكة الكهربائية', 'محطة توليد', 'محطة الكهرباء', 'وزارة الكهرباء', 'مؤسسة الكهرباء'].map(N);
const POWER_EVENT = ['تقنين', 'ساعات الوصل', 'ساعات القطع', 'انقطاع التيار', 'انقطاع الكهرباء', 'قطع التيار', 'عودة التيار', 'عاد التيار', 'رجوع التيار', 'إعادة التيار', 'برنامج التقنين', 'تعرفة الكهرباء', 'التعرفة الكهربائية', 'فاتورة الكهرباء', 'زيادة ساعات التغذية', 'تخفيض التعرفة', 'عطل كهربائي', 'عطل في الشبكة', 'عطل بالشبكة', 'صيانة الشبكة', 'إصلاح الشبكة', 'خرجت محطة توليد', 'خرجت عن الخدمة', 'تحسن التغذية الكهربائية', 'جدول وصل الكهرباء', 'زيادة ساعات الوصل', 'خفض ساعات الوصل'].map(N);
const NOISE = ['مسيرة', 'غارة', 'قصف', 'استهداف', 'اشتباك', 'انفجار'];
const POWER_NATIONAL_SCOPE = ['عموم سوريا', 'عموم سورية', 'عموم المحافظات السورية', 'جميع المحافظات السورية', 'كل المحافظات السورية', 'كافة المحافظات السورية', 'على مستوى سوريا', 'على مستوى سورية', 'في مختلف المحافظات السورية', 'في أنحاء سوريا', 'في عموم البلاد السورية', 'across syria', 'all of syria', 'nationwide in syria'].map(N);
const FOREIGN = ['السعودية', 'السعودي', 'الملك سلمان', 'ولي العهد', 'المملكة', 'لبنان', 'اللبنانية', 'العراق', 'العراقية', 'الأردن', 'الاردن', 'الأردنية', 'مصر', 'المصرية', 'تركيا', 'التركية', 'إيران', 'الإمارات', 'الكويت', 'قطر', 'اليمن', 'ليبيا', 'غزة', 'إسرائيل', 'كييف', 'أوكرانيا', 'الأوكرانية', 'روسيا', 'الروسي', 'موسكو', 'بغداد', 'عمان', 'القاهرة'].map(N);
export function isOfficialGovernmentUrl(value) {
  try {
    const u = new URL(String(value || ''));
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return ['http:', 'https:'].includes(u.protocol) && (host === 'gov.sy' || host.endsWith('.gov.sy') || host === 'sana.sy' || host.endsWith('.sana.sy'));
  } catch { return false; }
}
/** Electricity hook only catches service/operations updates, not any text that merely mentions electricity. */
export function isPowerNews(text) {
  if (weatherWarningInfo(text)) return { ok: false, why: 'explicit weather warning' };
  const t = ` ${N(text)} `;
  const hasAny = (xs) => xs.some((k) => t.includes(N(k)));
  if (!hasAny(POWER_SUBJECT) || !hasAny(POWER_EVENT)) return { ok: false };
  // A strike at a power facility is a security alert, not a service update.
  if (NOISE.some((k) => t.includes(N(k)))) return { ok: false };
  // An explicit foreign place wins over a passing Syria mention; never guess that an unlocated outage is nationwide in Syria.
  if (FOREIGN.some((k) => t.includes(N(k)))) return { ok: false, why: 'foreign location' };
  const g = govOfText(text);
  if (g) return { ok: true, gov: g.code };
  if (!POWER_NATIONAL_SCOPE.some((k) => t.includes(k))) return { ok: false, why: 'no verified Syrian location or national scope' };
  return { ok: true, gov: null };
}
// drop stored items that fail the Syria-only filter (e.g. a Saudi tariff post caught before the filter)
export function purgeForeignPower() {
  const arr = powerArr(); let n = 0;
  for (let i = arr.length - 1; i >= 0; i--) if (!isOfficialGovernmentUrl(arr[i].src?.url) || (!isPowerNews(arr[i].text || '').ok && !arr[i].manual)) { arr.splice(i, 1); n++; }
  if (n) { save(); emitPower(); }
  return n;
}
const govName = (code, lang = 'ar') => { const g = governorates.find((x) => x.code === code); return g ? (lang === 'en' ? g.en : g.ar) : (lang === 'en' ? 'All Syria' : 'عموم سوريا'); };
export function publicPower(limit = 60) {
  return powerArr().filter((p) => p.pub && isOfficialGovernmentUrl(p.src?.url)).sort((a, b) => b.ts - a.ts).slice(0, limit)
    .map((p) => ({ id: p.id, gov: p.gov || null, gov_ar: govName(p.gov), gov_en: govName(p.gov, 'en'), text: p.text, ts: new Date(p.ts).toISOString(), source_name: p.src?.name || 'مصدر حكومي رسمي', source_url: p.src.url }));
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
  setTimeout(() => { try { const n = purgeForeignPower(); if (n) console.log('[power] removed non-Syrian items:', n); } catch { /* ignore */ } }, 5000).unref();
}
export function mergeServicesFromBackup(o) {
  const os = o?.svc; if (!os) return;
  const ids = new Set(roadsArr().map((r) => r.id));
  for (const r of os.roads || []) if (!ids.has(r.id)) roadsArr().push(r);
  const pids = new Set(powerArr().map((p) => p.id));
  const suppressed = new Set(svc().powerSuppressed || []);
  for (const p of os.power || []) if (!pids.has(p.id) && !suppressed.has(p.id)) powerArr().push(p);
  if (os.roadWatch) {
    const rw = (svc().roadWatch ||= { events: [], ignoredReports: [] });
    rw.events ||= []; rw.ignoredReports ||= [];
    const terminal = new Set(['published', 'ignored', 'duplicate', 'pending-report', 'published-existing']);
    for (const e of os.roadWatch.events || []) {
      if (!e?.id) continue;
      const cur = rw.events.find((x) => x.id === e.id);
      if (!cur) rw.events.push(e);
      else {
        const sources = [...new Map([...(cur.sources || []), ...(e.sources || [])].map((x) => [x.u, x])).values()].slice(-8);
        const cards = [...new Map([...(cur.cards || []), ...(e.cards || [])].map((x) => [`${x[0]}:${x[1]}`, x])).values()];
        if (!terminal.has(cur.state) && terminal.has(e.state)) Object.assign(cur, e);
        cur.sources = sources; cur.cards = cards;
        cur.reason ||= e.reason; cur.evidence ||= e.evidence;
      }
    }
    const ignored = new Set(rw.ignoredReports.map((x) => `${x.ts}:${N(x.location?.name_ar || '')}`));
    for (const x of os.roadWatch.ignoredReports || []) if (!ignored.has(`${x.ts}:${N(x.location?.name_ar || '')}`)) rw.ignoredReports.push(x);
    rw.events = rw.events.slice(0, 300); rw.ignoredReports = rw.ignoredReports.slice(0, 200);
  }
}

// ---------------------------------------------------------------- bot: electricity tools (publishing bot)
const pend = new Map(); // owner id -> { k: 'text'|'edit', gov, id, exp }
const R = { H: null };
const reviewerIds = () => [...new Set([...config.ownerIds])];
function powerCardText(p) {
  return `⚡ <b>تحديث كهرباء${p.src ? ' من الرصد' : ''}</b> — ${esc(govName(p.gov))}\n\n${esc(p.text)}\n\n`
    + `${p.src?.url ? `<i>المصدر: <a href="${esc(p.src.url)}">${esc(p.src.name || 'مصدر حكومي رسمي')}</a></i>\n` : ''}<i>${dayClock(p.ts)}</i>`;
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
export async function takeMisroutedWeatherPower() {
  const s = svc(); const arr = powerArr(); const moved = [];
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    if (p.pub || !p.gov || !weatherWarningInfo(p.text || '')) continue;
    moved.unshift(p); arr.splice(i, 1);
    const tomb = (s.powerSuppressed ||= []);
    if (!tomb.includes(p.id)) tomb.push(p.id);
  }
  if (!moved.length) return [];
  s.powerSuppressed = (s.powerSuppressed || []).slice(-300);
  save(); emitPower();
  const api = R.H?.apis().admin;
  if (api) for (const p of moved) for (const [chat, mid] of p.cards || []) {
    try { await api.deleteMessage(chat, mid); } catch (e) { console.warn('[power] old misrouted card cleanup failed', p.id, e.description || e.message); }
  }
  console.log(`[power] removed ${moved.length} pending weather warning(s) misrouted to electricity`);
  return moved;
}
/** news-monitor hook: only real electricity service updates become power cards. */
export function onNewsPost(it) {
  const sourceUrl = it.url || it.src?.url || '';
  if (!isOfficialGovernmentUrl(sourceUrl)) return false;
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
  const p = { id: rid(), gov: r.gov, text, ts: it.ts || Date.now(), src: { name: it.src?.name || 'مصدر حكومي رسمي', url: sourceUrl }, pub: false };
  powerArr().push(p); trimPower(); save();
  sendPowerCard(p).catch(() => {});
  return true;
}
async function publishPower(api, p, channel) {
  if (!isOfficialGovernmentUrl(p.src?.url)) throw new Error('لا يمكن نشر تحديث كهرباء بلا رابط مصدر حكومي رسمي (.gov.sy أو سانا).');
  p.pub = true; p.ts = p.ts || Date.now(); p.pubAt = Date.now(); save(); emitPower();
  if (channel && config.channel) {
    const kb = new InlineKeyboard().url('⚡ كل تحديثات الكهرباء', `${siteUrl()}/ar/#power`);
    const m = await api.sendMessage(config.channel, `⚡ <b>الكهرباء — ${esc(govName(p.gov))}</b>\n\n${esc(p.text)}\n\n🔗 <a href="${esc(p.src.url)}">${esc(p.src.name || 'المصدر الحكومي الرسمي')}</a>`, { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } });
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
  const E = (ctx) => h.langOf?.(ctx) === 'en';
  const T = (ctx, ar, en) => (E(ctx) ? en : ar);
  const gName = (ctx, code) => { if (!E(ctx)) return govName(code); if (!code) return 'All of Syria'; const g = governorates.find((x) => x.code === code); return g?.en || g?.name_en || govName(code); };
  const find = async (id) => {
    let p = powerArr().find((x) => x.id === id);
    if (!p && store.backup) { await store.mergeFromBackup().catch(() => {}); p = powerArr().find((x) => x.id === id); }
    return p || null;
  };
  const govKb = (prefix, back, ctx) => {
    const en = ctx && E(ctx);
    const kb = new InlineKeyboard().text(en ? '🇸🇾 All of Syria' : '🇸🇾 عموم سوريا', `${prefix}:all`).row();
    governorates.forEach((g, i) => { kb.text(en ? g.en || g.name_en || g.ar : g.ar, `${prefix}:${g.code}`); if (i % 3 === 2) kb.row(); });
    return kb.row().text(en ? '↩️ Back' : '↩️ رجوع', back);
  };
  const mainText = (ctx) => {
    const n = (svc().powerNews ||= { on: true });
    const pub = publicPower(5);
    if (ctx && E(ctx)) {
      const l = pub.length ? pub.map((p) => `• <b>${esc(gName(ctx, p.gov))}</b> — ${esc(p.text.slice(0, 70))}${p.text.length > 70 ? '…' : ''}`).join('\n') : '— Nothing published yet.';
      return `⚡ <b>Electricity</b>\n\nPower and rationing news is shown on the website in the “⚡ Electricity” section, by governorate.\n\n📡 Pick up electricity news from the monitor: <b>${n.on ? '✅ On' : '⏸ Off'}</b>\n(each item reaches you as a card; nothing is posted without your approval)\n\n<b>Latest published:</b>\n${l}`;
    }
    const list = pub.length ? pub.map((p) => `• <b>${esc(p.gov_ar)}</b> — ${esc(p.text.slice(0, 70))}${p.text.length > 70 ? '…' : ''}`).join('\n') : '— ما في تحديثات منشورة بعد.';
    return `⚡ <b>الكهرباء</b>\n\nأخبار الكهرباء والتقنين بتنعرض على الموقع بقسم «⚡ الكهرباء» حسب المحافظة.\n\n📡 التقاط أخبار الكهرباء من الرصد: <b>${n.on ? '✅ مفعّل' : '⏸ متوقف'}</b>\n(كل خبر بيوصلك كبطاقة، وما بينشر شي إلا بموافقتك)\n\n<b>آخر المنشور:</b>\n${list}`;
  };
  const mainKb = (ctx) => {
    const n = (svc().powerNews ||= { on: true });
    const kb = new InlineKeyboard().text(T(ctx, '➕ أضف تحديث كهرباء', '➕ Add an electricity update'), 'pwr:add').row();
    if (publicPower(1).length) kb.text(T(ctx, '🗑 حذف تحديث منشور', '🗑 Remove a published update'), 'pwr:del').row();
    return kb.text(n.on ? T(ctx, '⏸ إيقاف الالتقاط من الرصد', '⏸ Stop picking up from the monitor') : T(ctx, '▶️ تشغيل الالتقاط من الرصد', '▶️ Pick up from the monitor'), n.on ? 'pwr:off' : 'pwr:on').row()
      .url(T(ctx, '🌐 القسم على الموقع', '🌐 Section on the website'), `${siteUrl()}/${E(ctx) ? 'en' : 'ar'}/#power`).row().text(h.L(ctx).btnHome, 'home');
  };
  const showMain = (ctx) => h.show(ctx, mainText(ctx), mainKb(ctx));
  bot.on('callback_query:data', async (ctx, next) => { pend.delete(ctx.from?.id); return next(); });
  bot.callbackQuery('pwr', (ctx) => onlyOwner(ctx, async () => { await ctx.answerCallbackQuery(); await showMain(ctx); }));
  bot.callbackQuery(/^pwr:(on|off)$/, (ctx) => onlyOwner(ctx, async () => {
    (svc().powerNews ||= {}).on = ctx.match[1] === 'on'; save();
    await ctx.answerCallbackQuery('✔️'); await showMain(ctx);
  }));
  bot.callbackQuery('pwr:add', (ctx) => onlyOwner(ctx, async () => {
    await ctx.answerCallbackQuery();
    await h.show(ctx, T(ctx, '⚡ <b>تحديث كهرباء رسمي جديد</b>\n\nلأي محافظة؟ يجب إرفاق رابط الخبر من موقع حكومي أو سانا قبل النشر.', '⚡ <b>New official electricity update</b>\n\nFor which governorate? A government-site or SANA source link is required before publishing.'), govKb('pwr:g', 'pwr', ctx));
  }));
  bot.callbackQuery(/^pwr:g:(\w+)$/, (ctx) => onlyOwner(ctx, async () => {
    await ctx.answerCallbackQuery();
    const gov = ctx.match[1] === 'all' ? null : ctx.match[1];
    pend.set(ctx.from.id, { k: 'source', gov, exp: Date.now() + 10 * 60_000 });
    await h.show(ctx, E(ctx) ? `⚡ <b>${esc(gName(ctx, gov))}</b>\n\nFirst send the direct URL of the government/SANA announcement, then send the update text.` : `⚡ <b>${esc(govName(gov))}</b>\n\nأرسل أولاً رابط الخبر المباشر من موقع حكومي أو سانا، وبعدها أرسل نص التحديث.`, new InlineKeyboard().text(T(ctx, '↩️ رجوع', '↩️ Back'), 'pwr:add'));
  }));
  bot.callbackQuery('pwr:del', (ctx) => onlyOwner(ctx, async () => {
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    for (const p of publicPower(12)) kb.text(`🗑 ${E(ctx) ? gName(ctx, p.gov) : p.gov_ar} · ${p.text.slice(0, 34)}`, `pwr:dx:${p.id}`).row();
    await h.show(ctx, T(ctx, '🗑 اختر التحديث يلي بدك تشيله من الموقع:', '🗑 Pick the update to remove from the website:'), kb.text(T(ctx, '↩️ رجوع', '↩️ Back'), 'pwr'));
  }));
  bot.callbackQuery(/^pwr:dx:(\w+)$/, (ctx) => onlyOwner(ctx, async () => {
    const p = await find(ctx.match[1]);
    if (p) { p.pub = false; p.ts = Date.now() - 47 * H_MS; save(); emitPower(); }
    await ctx.answerCallbackQuery(T(ctx, '🗑 انشال من الموقع', '🗑 Removed from the website')); await showMain(ctx);
  }));
  // review cards (from the news monitor) and the owner's own preview
  bot.callbackQuery(/^pw:(s|c|e|g|x|gg):(\w+)(?::(\w+))?$/, (ctx) => onlyOwner(ctx, async () => {
    const [, a, id, extra] = ctx.match;
    const p = await find(id);
    const cur = ctx.callbackQuery.message ? [ctx.callbackQuery.message.chat.id, ctx.callbackQuery.message.message_id] : null;
    if (!p) { await ctx.answerCallbackQuery({ text: T(ctx, 'هذا التحديث لم يعد متاحاً', 'This update is no longer available'), show_alert: true }); try { await ctx.deleteMessage(); } catch { /* ignore */ } return; }
    if (a === 'x') { p.cards = p.cards || []; await closePowerCards(ctx.api, p); powerArr().splice(powerArr().indexOf(p), 1); save(); await ctx.answerCallbackQuery(T(ctx, 'تم التجاهل', 'Ignored')); try { await ctx.deleteMessage(); } catch { /* ignore */ } return; }
    if (a === 'e') {
      await ctx.answerCallbackQuery();
      pend.set(ctx.from.id, { k: 'edit', id, exp: Date.now() + 10 * 60_000, card: cur });
      return ctx.reply(T(ctx, '✏️ أرسل النص الجديد للتحديث (رح يحل محل النص الحالي):', '✏️ Send the new text for this update (it replaces the current text):'), { _keep: 'c' }).then((m) => { pend.get(ctx.from.id).ask = [m.chat.id, m.message_id]; }).catch(() => {});
    }
    if (a === 'g') { await ctx.answerCallbackQuery(); return ctx.editMessageReplyMarkup({ reply_markup: govKb(`pw:gg:${id}`, `pw:back:${id}`, ctx) }).catch(() => {}); }
    if (a === 'gg') {
      p.gov = extra === 'all' ? null : extra; save();
      await ctx.answerCallbackQuery('✔️');
      return ctx.editMessageText(powerCardText(p), { parse_mode: 'HTML', reply_markup: powerCardKb(p), link_preview_options: { is_disabled: true } }).catch(() => {});
    }
    if (p.pub && a !== 'c') { await ctx.answerCallbackQuery(T(ctx, 'منشور مسبقاً ✔️', 'Already published ✔️')); return; }
    await ctx.answerCallbackQuery(T(ctx, 'جارٍ النشر…', 'Publishing…'));
    try { await publishPower(ctx.api, p, a === 'c'); } catch (e) { return ctx.reply(`⚠️ ${esc(e.description || e.message)}`); }
    await closePowerCards(ctx.api, p, cur);
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await h.sendTransient(ctx.api, ctx.chat.id, a === 'c' ? T(ctx, '✅ نُشر التحديث على الموقع وبالقناة.', '✅ Published on the website and in the channel.') : T(ctx, '✅ نُشر التحديث على الموقع (قسم الكهرباء).', '✅ Published on the website (Electricity section).'));
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
    if (q.k === 'source') {
      if (!isOfficialGovernmentUrl(txt)) return ctx.reply(T(ctx, '⚠️ أرسل رابطاً مباشراً من نطاق ‎.gov.sy‎ أو sana.sy.', '⚠️ Send a direct link from a .gov.sy or sana.sy domain.'));
      q.sourceUrl = txt; q.k = 'text'; q.exp = Date.now() + 10 * 60_000;
      return ctx.reply(T(ctx, '✅ تم قبول رابط المصدر. أرسل الآن نص تحديث الكهرباء الذي تريد نشره.', '✅ Source accepted. Now send the electricity update text.'), { _keep: 'c' });
    }
    if (txt.length < 8) return ctx.reply(T(ctx, '⚠️ النص قصير كتير، اكتب التحديث كامل.', '⚠️ That text is too short — please write the full update.'));
    pend.delete(ctx.from.id);
    if (q.k === 'edit') {
      const p = await find(q.id);
      if (!p) return ctx.reply(T(ctx, 'هذا التحديث لم يعد متاحاً', 'This update is no longer available'));
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
    const p = { id: rid(), gov: q.gov, text: txt.slice(0, 700), ts: Date.now(), src: { name: 'مصدر حكومي رسمي', url: q.sourceUrl }, pub: false, manual: true };
    powerArr().push(p); save();
    const m = await ctx.reply(`${T(ctx, '👀 <b>معاينة</b> — هيك رح يظهر على الموقع:', '👀 <b>Preview</b> — this is how it will appear on the website:')}\n\n${powerCardText(p)}`, { parse_mode: 'HTML', reply_markup: powerCardKb(p), _keep: 'c' });
    p.cards = [[m.chat.id, m.message_id]]; save();
  });
}
export const _test = { isPowerNews, govOfText, cleanPowerText, addRoad, publicRoads, endRoad, takeMisroutedWeatherPower };
