import { Bot, InlineKeyboard, InputFile, InputMediaBuilder, GrammyError, HttpError } from 'grammy';
import { config, isOwner } from './config.js';
import { store, publicAlert } from './store.js';
import { ALERT_TYPES, TYPE_KEYS, typeOf } from '../shared/types.js';
import { T, TITLES, fmtDur } from './bot-texts.js';
import { collectStats, renderStatsPng, damascusParts } from './stats-image.js';
import { renderAlertPng } from './alert-image.js';
import { governorates, getGov, getDist, districtsOf, placesOf, searchPlaces, locationFrom, insideSyriaBox } from './places.js';

const PAGE = 18;
const DURATIONS = [15, 30, 60, 90, 120, 180, 360, 720];
const REPORT_COOLDOWN_MS = 2 * 60_000;

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clean = (s, max = 900) => String(s || '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const hashTag = (s) => '#' + String(s || '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');

const sessions = new Map(); // userId -> draft
const reports = new Map(); // reportId -> { draft, from, messages: [[chatId, msgId]] }
const lastReport = new Map();

const isStaffId = (id) => isOwner(id) || store.isEditor(id);
// Two bots share this module: role 'admin' (private publishing panel) and role 'report' (public reports).
const roleOf = (ctx) => ctx.ras?.role || 'admin';
const staff = (ctx) => roleOf(ctx) === 'admin' && isStaffId(ctx.from?.id);
const owner = (ctx) => roleOf(ctx) === 'admin' && isOwner(ctx.from?.id);
const sk = (ctx) => `${roleOf(ctx)}:${ctx.from?.id}`;
export const botInfo = { admin: null, report: null }; // usernames, filled at start
const L = (ctx) => T[store.userLang(ctx.from?.id)] || T.ar;
const langOf = (ctx) => store.userLang(ctx.from?.id) === 'en' ? 'en' : 'ar';
const typeLabel = (key, lang) => `${typeOf(key).emoji} ${lang === 'en' ? typeOf(key).en : typeOf(key).ar}`;
const mapUrl = (id, lang = 'ar') => (config.publicUrl ? `${config.publicUrl}/${lang}/${id ? '#' + id : ''}` : '');

// spelling-insensitive key: "داريّا" == "داريا", "حماه" == "حماة", "أعزاز" == "اعزاز"
const nameKey = (x) => String(x || '').normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g, '')
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/^ال/, '').replace(/[\s\-'’.]/g, '').toLowerCase();
function locName(loc, lang) {
  if (!loc) return '—';
  const n = lang === 'en' ? loc.name_en : loc.name_ar;
  const d = lang === 'en' ? loc.district_en : loc.district_ar;
  const g = lang === 'en' ? loc.governorate_en : loc.governorate_ar;
  const cand = (loc.scope === 'place' || loc.scope === 'point') ? [n, d, g] : loc.scope === 'district' ? [n, g] : [n];
  const seen = new Set(); const parts = [];
  for (const x of cand) { const k = nameKey(x); if (!x || seen.has(k)) continue; seen.add(k); parts.push(x); }
  return parts.join(lang === 'en' ? ', ' : '، ');
}
// ---------------------------------------------------------------- formatting

const fmtTime = (iso, lang) =>
  new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-SY', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'long' }).format(new Date(iso));

const SEP = '━━━━━━━━━━━━━━━';
const fmtClock = (iso) => new Intl.DateTimeFormat('ar-SY', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const fmtDay = (iso) => new Intl.DateTimeFormat('ar-SY', { timeZone: config.timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
const fmtDate = (iso) => new Intl.DateTimeFormat('ar-SY', { timeZone: config.timezone, day: 'numeric', month: 'long' }).format(new Date(iso));
// Channel post (format requested by the owner):
//   تنبيه مدني - 🚑
//   📍كويرس شرقي، الباب، حلب
//   تاريخ :  ٢٣ تشرين الأول
//   الساعة :  ١٠:٣١ م
//
//   🗺 الخريطة المباشرة · Red Alert Syria
export function channelPost(alert, { ended = false } = {}) {
  const t = typeOf(alert.type);
  const title = (TITLES[alert.type] || {}).ar || t.ar;
  const p = alert.place || {};
  const hasPlace = p.scope && p.scope !== 'country';
  const lines = [];
  lines.push(`${ended ? '✅ انتهى · ' : ''}<b>${esc(title)}</b> - ${t.emoji}`, '');
  if (alert.type === 'breaking') lines.push(`<b>${esc(alert.description || alert.title)}</b>`, '');
  if (hasPlace) lines.push(`📍<b>${esc(locName(p, 'ar'))}</b>`);
  if (alert.type !== 'breaking' && alert.description) lines.push(`<blockquote>${esc(alert.description)}</blockquote>`);
  lines.push('');
  lines.push(`تاريخ :  ${esc(fmtDate(alert.timestamp))}`);
  lines.push(`الساعة :  ${esc(fmtClock(alert.timestamp))}`);
  if (ended) lines.push(`انتهى :  ${esc(fmtClock(alert.ended_at || new Date().toISOString()))}`);
  lines.push('');
  const url = mapUrl(alert.id);
  lines.push(`🗺 ${url ? `<a href="${esc(url)}">الخريطة المباشرة</a>` : 'الخريطة المباشرة'} · <a href="${esc(config.channelUrl)}">Red Alert Syria</a>`);
  return lines.join('\n');
}
export function channelKeyboard(alert) {
  const url = mapUrl(alert.id);
  const kb = new InlineKeyboard();
  if (url) kb.url('🗺 عرض على الخريطة', url);
  if (config.reportBotUsername) kb.url('📨 أرسل بلاغاً', `https://t.me/${config.reportBotUsername}?start=report`);
  return kb;
}
function draftSummary(d, lang) {
  const l = T[lang];
  const loc = d.location;
  const lines = [`<b>${esc(typeLabel(d.type, lang))}</b>`];
  if (d.type === 'breaking') lines.push('', esc(d.text || ''));
  lines.push('', `📍 <b>${l.locLabel}:</b> ${esc(loc ? locName(loc, lang) : (lang === 'en' ? 'Syria' : 'سوريا'))}`);
  if (d.type !== 'breaking' && d.details) lines.push(`📝 <b>${l.detailsLabel}:</b> ${esc(d.details)}`);
  lines.push(`⏱ <b>${l.durLabel}:</b> ${fmtDur(d.ttlMin, lang)}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- keyboards

function mainKeyboard(ctx) {
  const l = L(ctx);
  const lang = langOf(ctx);
  const b = (k) => (lang === 'en' ? ALERT_TYPES[k].button_en : ALERT_TYPES[k].button_ar);
  const e = (k) => ALERT_TYPES[k].emoji;
  const kb = new InlineKeyboard()
    .text(`${e('breaking')} ${b('breaking')}`, 't:breaking').row()
    .text(`${e('uav')} ${b('uav')}`, 't:uav').text(`${e('warplane')} ${b('warplane')}`, 't:warplane').row()
    .text(`${e('artillery')} ${b('artillery')}`, 't:artillery').text(`${e('attack')} ${b('attack')}`, 't:attack').row()
    .text(`${e('civil')} ${b('civil')}`, 'cv').text(`${e('missile')} ${b('missile')}`, 't:missile').row();
  if (staff(ctx)) kb.text(l.btnActive, 'active').text(l.btnClear, 'clr').row().text(l.btnLang, 'lang').row();
  else kb.text(l.btnLang, 'lang').row();
  if (owner(ctx)) kb.text(l.btnEditors, 'editors').text(l.btnStats, 'stats').row().text(l.btnAuto(store.autoDeleteHours), 'auto').row();
  if (config.publicUrl) kb.url(l.btnMap, mapUrl('', lang));
  kb.url(l.btnChannel, config.channelUrl);
  return kb;
}

function govKeyboard(ctx, d) {
  const l = L(ctx);
  const lang = langOf(ctx);
  const kb = new InlineKeyboard();
  governorates.forEach((g, i) => {
    kb.text(lang === 'en' ? g.en : g.ar, 'g:' + g.code);
    if (i % 3 === 2) kb.row();
  });
  kb.row();
  if (d.type === 'breaking') kb.text(l.btnNoLocation, 'noloc').row();
  kb.text(l.btnCancel, 'cancel');
  return kb;
}

function distKeyboard(ctx, gov) {
  const l = L(ctx);
  const lang = langOf(ctx);
  const g = getGov(gov);
  const kb = new InlineKeyboard().text(l.btnWholeGov(lang === 'en' ? g.en : g.ar), 'wg:' + gov).row();
  districtsOf(gov).forEach((d, i) => {
    kb.text(lang === 'en' ? d.en : d.ar, 'd:' + d.code);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text(l.btnBack, 'back:gov').text(l.btnCancel, 'cancel');
  return kb;
}

function placeKeyboard(ctx, dist, page) {
  const l = L(ctx);
  const lang = langOf(ctx);
  const d = getDist(dist);
  const all = placesOf(dist);
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  page = Math.min(Math.max(0, page), pages - 1);
  const kb = new InlineKeyboard().text(l.btnWholeDist(lang === 'en' ? d.en : d.ar), 'wd:' + dist).row();
  all.slice(page * PAGE, page * PAGE + PAGE).forEach((p, i) => {
    kb.text((lang === 'en' ? p.en : p.ar).slice(0, 28), 'p:' + p.id);
    if (i % 3 === 2) kb.row();
  });
  kb.row();
  if (pages > 1) {
    if (page > 0) kb.text(l.btnPrev, `pg:${dist}:${page - 1}`);
    if (page < pages - 1) kb.text(l.btnNext, `pg:${dist}:${page + 1}`);
    kb.row();
  }
  kb.text(l.btnBack, 'back:dist').text(l.btnCancel, 'cancel');
  return { kb, page: page + 1, pages };
}

function previewKeyboard(ctx, d) {
  const l = L(ctx);
  const kb = new InlineKeyboard();
  if (d.mode === 'report') kb.text(l.btnSubmit, 'submit').row();
  else kb.text(l.btnPublish, 'publish').row();
  kb.text(l.btnDuration(d.ttlMin), 'dur').row();
  kb.text(l.btnEditDetails, 'editdetails').text(l.btnChangeLoc, 'back:gov').row();
  kb.text(l.btnCancel, 'cancel');
  return kb;
}

// ---------------------------------------------------------------- helpers

// Show a short toast for the pressed button and remove the message from the chat (keeps the chat clean).
// ---- transient notices ("thanks", "approved"...): removed on the user's next tap/message, or after 2 min
const transient = new Map(); // `${botId}:${chatId}` -> [{ api, msgId, timer }]
async function sendTransient(api, chatId, text, extra = {}) {
  try {
    const m = await api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true }, ...extra });
    const key = `${api.token ? api.token.split(':')[0] : 'x'}:${chatId}`;
    const item = { api, msgId: m.message_id };
    item.timer = setTimeout(() => dropTransient(key, item), 120_000);
    if (item.timer.unref) item.timer.unref();
    if (!transient.has(key)) transient.set(key, []);
    transient.get(key).push(item);
    return m;
  } catch { return null; }
}
function dropTransient(key, only) {
  const list = transient.get(key);
  if (!list) return;
  for (const it of list.slice()) {
    if (only && it !== only) continue;
    clearTimeout(it.timer);
    it.api.deleteMessage(Number(key.split(':')[1]), it.msgId).catch(() => {});
    list.splice(list.indexOf(it), 1);
  }
  if (!list.length) transient.delete(key);
}
function clearTransientFor(ctx) {
  const chatId = ctx.chat?.id ?? ctx.from?.id;
  if (chatId == null) return;
  dropTransient(`${ctx.api.token ? ctx.api.token.split(':')[0] : 'x'}:${chatId}`);
}

async function vanish(ctx, text) {
  try { await ctx.answerCallbackQuery(text ? { text: String(text).replace(/<[^>]+>/g, '').slice(0, 190) } : undefined); } catch { /* already answered */ }
  try { await ctx.deleteMessage(); } catch {
    try { await ctx.editMessageText(text || '✔️', { parse_mode: 'HTML' }); } catch { /* ignore */ }
  }
}
async function show(ctx, text, keyboard) {
  const opts = { parse_mode: 'HTML', reply_markup: keyboard, link_preview_options: { is_disabled: true } };
  const d = sessions.get(sk(ctx));
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, opts);
      return;
    } catch (e) {
      if (String(e?.description || e).includes('message is not modified')) return;
      if (ctx.callbackQuery.message.photo) { try { await ctx.deleteMessage(); } catch { /* ignore */ } }
    }
  }
  const m = await ctx.reply(text, opts);
  if (d) d.msgId = m.message_id;
}

function newDraft(ctx, type) {
  const d = {
    type,
    mode: staff(ctx) ? 'publish' : 'report',
    step: type === 'breaking' ? 'text' : 'gov',
    ttlMin: typeOf(type).ttlMin,
    location: null,
    details: '',
    text: '',
    created: Date.now(),
  };
  sessions.set(sk(ctx), d);
  return d;
}

const getDraft = (ctx) => {
  const d = sessions.get(sk(ctx));
  if (d && Date.now() - d.created > 6 * 3600_000) { sessions.delete(sk(ctx)); return null; }
  return d;
};

async function askLocation(ctx, d) {
  d.step = 'gov';
  await show(ctx, L(ctx).askGov(`<b>${esc(typeLabel(d.type, langOf(ctx)))}</b>`), govKeyboard(ctx, d));
}

async function afterLocation(ctx, d) {
  if (d.type === 'breaking' || d.details) return showPreview(ctx, d);
  d.step = 'details';
  const kb = new InlineKeyboard().text(L(ctx).btnSkip, 'skip').row().text(L(ctx).btnBack, 'back:gov').text(L(ctx).btnCancel, 'cancel');
  await show(ctx, L(ctx).askDetails(`<b>${esc(typeLabel(d.type, langOf(ctx)))}</b>`, esc(locName(d.location, langOf(ctx)))), kb);
}

async function showPreview(ctx, d) {
  d.step = 'preview';
  const l = L(ctx);
  await show(ctx, `${d.mode === 'report' ? l.previewReport : l.preview}\n\n${draftSummary(d, langOf(ctx))}`, previewKeyboard(ctx, d));
}

function buildAlertInput(d, author) {
  const titles = TITLES[d.type];
  const loc = d.location || locationFrom({});
  const named = loc.scope !== 'country';
  const areas = [];
  if (named) {
    if (loc.name_ar) areas.push(loc.name_ar);
    if (loc.district_ar && loc.district_ar !== loc.name_ar) areas.push(loc.district_ar);
    if (loc.governorate_ar && !areas.includes(loc.governorate_ar)) areas.push(loc.governorate_ar);
  }
  return {
    type: d.type,
    title: named ? `${titles.ar} — ${loc.name_ar}` : titles.ar,
    title_en: named ? `${titles.en} — ${loc.name_en}` : titles.en,
    description: d.type === 'breaking' ? d.text : d.details,
    location: loc,
    areas,
    ttlMin: d.ttlMin,
    source: 'telegram',
    author,
  };
}

// ---- channel post as a map image (like redalert.com.lb): photo + the usual text as caption + buttons.
// Falls back to the plain text post when the image can't be made in time or the text is too long.
const CAPTION_MAX = 1024;
const IMAGE_DEADLINE_MS = Number(process.env.ALERT_IMAGE_DEADLINE_MS) || 12000;
const visibleLen = (html) => html.replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp|quot|#39);/g, 'x').length;
// Caption for an existing photo post; trims a long description if an edit (e.g. "ended") pushes it over.
function channelCaption(alert, opts) {
  let s = channelPost(alert, opts);
  if (visibleLen(s) <= CAPTION_MAX) return s;
  const desc = String(alert.description || alert.title || '');
  for (let keep = desc.length - (visibleLen(s) - CAPTION_MAX) - 4; keep > 0; keep -= 40) {
    s = channelPost({ ...alert, description: desc.slice(0, keep).trimEnd() + '…' }, opts);
    if (visibleLen(s) <= CAPTION_MAX) return s;
  }
  return channelPost({ ...alert, description: '' }, opts).slice(0, CAPTION_MAX);
}
function withDeadline(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(t));
}
export async function alertImage(alert, lang = 'ar') {
  const p = alert.place || {};
  const placeLabel = alert.scope === 'country' || !p.name_ar ? undefined : locName(p, lang);
  return renderAlertPng(alert, { lang, placeLabel });
}
// Render sample channel images on this server and send them to a private chat (never the channel).
// Used by the owner's /imgtest command and the token-protected /api/imgtest check.
export async function imageTest(api, chatId, { type = 'uav', q = '', lang = 'ar' } = {}) {
  const query = q || 'دوما';
  const hits = searchPlaces(query, 8);
  const hit = hits.find((x) => !x.scope) || hits[0];
  const loc = hit ? (hit.scope === 'governorate' ? locationFrom({ govCode: hit.gov }) : hit.scope === 'district' ? locationFrom({ distCode: hit.code || hit.dist }) : locationFrom({ placeId: hit.id })) : locationFrom({});
  const types = type === 'all' ? TYPE_KEYS : [ALERT_TYPES[type] ? type : 'uav'];
  const results = [];
  for (const t of types) {
    const fake = { id: 'imgtest-' + Math.random().toString(16).slice(2).padEnd(28, '0'), type: t, scope: loc?.scope || 'country', location: loc?.latitude != null ? { latitude: loc.latitude, longitude: loc.longitude } : null, place: loc, timestamp: new Date().toISOString(), description: t === 'breaking' ? 'معاينة خبر عاجل' : '' };
    const t0 = Date.now(); const c0 = process.cpuUsage();
    try {
      const png = await withDeadline(alertImage(fake, lang === 'en' ? 'en' : 'ar'), IMAGE_DEADLINE_MS);
      const cpu = process.cpuUsage(c0); const ms = Date.now() - t0;
      const cpuMs = Math.round((cpu.user + cpu.system) / 1000);
      const note = `\n\n🧪 <i>معاينة فقط — لم تُنشر في القناة · ${ms} ms (CPU ${cpuMs} ms) · ${Math.round(png.length / 1024)} KB</i>`;
      await api.sendPhoto(chatId, new InputFile(png, `imgtest-${t}.png`), { caption: channelCaption(fake, {}).slice(0, CAPTION_MAX - note.length) + note, parse_mode: 'HTML', reply_markup: channelKeyboard(fake) });
      results.push({ type: t, ok: true, ms, cpuMs, kb: Math.round(png.length / 1024), sentMs: Date.now() - t0 });
    } catch (e) {
      results.push({ type: t, ok: false, error: e.description || e.message, ms: Date.now() - t0 });
      try { await api.sendMessage(chatId, `⚠️ imgtest ${t}: ${esc(e.description || e.message)} — كان سيُنشر نصاً.`, { parse_mode: 'HTML' }); } catch { /* ignore */ }
    }
  }
  return { place: loc?.name_ar || 'سوريا', scope: loc?.scope || 'country', results };
}
export async function publishDraft(api, d, author) {
  const alert = store.addAlert(buildAlertInput(d, author));
  const text = channelPost(alert);
  const extra = { parse_mode: 'HTML', reply_markup: channelKeyboard(alert) };
  let m = null; let media = 'text';
  if (config.alertImages && visibleLen(text) <= CAPTION_MAX) {
    const t0 = Date.now();
    try {
      const png = await withDeadline(alertImage(alert, 'ar'), IMAGE_DEADLINE_MS);
      m = await api.sendPhoto(config.channel, new InputFile(png, `red-alert-syria-${alert.id.slice(0, 8)}.png`), { caption: text, ...extra });
      media = 'photo';
      console.log(`[img] channel image sent in ${Date.now() - t0} ms (${Math.round(png.length / 1024)} KB)`);
    } catch (e) {
      console.error(`[img] image post failed after ${Date.now() - t0} ms, falling back to text:`, e.description || e.message);
    }
  }
  if (!m) {
    try {
      m = await api.sendMessage(config.channel, text, { ...extra, link_preview_options: { is_disabled: true } });
    } catch (e) {
      console.error('[bot] channel post failed:', e.description || e.message);
    }
  }
  if (m) store.updateAlert(alert.id, { channel_message_id: m.message_id, channel_media: media });
  return store.getAlert(alert.id);
}

function resultKeyboard(ctx, alert) {
  const l = L(ctx);
  const kb = new InlineKeyboard();
  if (config.publicUrl) kb.url(l.btnOpenMap, mapUrl(alert.id, langOf(ctx)));
  const pa = publicAlert(alert);
  if (pa.telegram_url) kb.url(l.btnOpenPost, pa.telegram_url);
  kb.row().text(l.btnEnd, 'end:' + alert.id).text(l.btnExtend, 'ext:' + alert.id).row().text(l.btnDelete, 'del:' + alert.id).row().text(l.btnHome, 'home');
  return kb;
}

async function refreshChannelPost(api, alert, ended) {
  if (!alert?.channel_message_id) return;
  const editText = () => api.editMessageText(config.channel, alert.channel_message_id, channelPost(alert, { ended }), { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: channelKeyboard(alert) });
  const editCaption = () => api.editMessageCaption(config.channel, alert.channel_message_id, { caption: channelCaption(alert, { ended }), parse_mode: 'HTML', reply_markup: channelKeyboard(alert) });
  const photo = alert.channel_media === 'photo';
  try {
    await (photo ? editCaption() : editText());
  } catch (e) {
    const msg = String(e.description || e.message || '');
    if (msg.includes('not modified')) return;
    // stored kind missing or wrong: Telegram says so explicitly -> edit the other way and remember it
    if (/there is no (text|caption) in the message/i.test(msg)) {
      try {
        await (photo ? editText() : editCaption());
        store.updateAlert(alert.id, { channel_media: photo ? 'text' : 'photo' });
        return;
      } catch (e2) {
        if (String(e2.description || '').includes('not modified')) return;
        console.error('[bot] edit channel failed:', e2.description || e2.message);
        return;
      }
    }
    console.error('[bot] edit channel failed:', msg);
  }
}
function who(u) {
  const name = esc([u.first_name, u.last_name].filter(Boolean).join(' ') || 'user');
  return `<a href="tg://user?id=${u.id}">${name}</a>${u.username ? ' @' + esc(u.username) : ''} (<code>${u.id}</code>)`;
}

// ---------------------------------------------------------------- bot

// Re-apply the current post layout and buttons to the channel posts of recent alerts (runs once per
// start; Telegram answers "not modified" for posts that are already up to date). Throttled for limits.
export async function resyncChannelPosts(api) {
  const list = store.recentAlerts().filter((a) => a.channel_message_id);
  for (const a of list) {
    await refreshChannelPost(api, a, !a.is_active);
    await new Promise((r) => setTimeout(r, 3500));
  }
  return list.length;
}
// ---------------------------------------------------------------- owner <-> reporter relay
// The owner/editors simply use Telegram's "Reply" on a report card or on a relayed message in the
// publishing bot; the reporter gets it in the report bot signed as the team (staff identity hidden).
// The reporter answers in the report bot (reply, or a plain message while a conversation is open).
const APIS = {}; const TOKENS = {};
const RELAY_KINDS = { photo: 'sendPhoto', video: 'sendVideo', voice: 'sendVoice', audio: 'sendAudio', document: 'sendDocument', animation: 'sendAnimation', video_note: 'sendVideoNote', sticker: 'sendSticker' };
const relayRate = new Map();
async function relayCopy(fromApi, fromToken, toApi, chatId, msg, header, footer) {
  const kind = Object.keys(RELAY_KINDS).find((k) => msg[k]);
  const body = msg.text || msg.caption || '';
  const txt = `${header}${body ? `\n\n${esc(body)}` : ''}${footer ? `\n\n${footer}` : ''}`;
  if (!kind) return toApi.sendMessage(chatId, txt.slice(0, 4096), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  const fileId = kind === 'photo' ? msg.photo[msg.photo.length - 1].file_id : msg[kind].file_id;
  const f = await fromApi.getFile(fileId);
  const res = await fetch(`https://api.telegram.org/file/bot${fromToken}/${f.file_path}`);
  if (!res.ok) throw new Error('file download failed');
  const file = new InputFile(Buffer.from(await res.arrayBuffer()), msg.document?.file_name || f.file_path.split('/').pop());
  if (kind === 'video_note' || kind === 'sticker') {
    await toApi[RELAY_KINDS[kind]](chatId, file);
    return toApi.sendMessage(chatId, txt.slice(0, 4096), { parse_mode: 'HTML' });
  }
  return toApi[RELAY_KINDS[kind]](chatId, file, { caption: txt.slice(0, 1024), parse_mode: 'HTML' });
}
const reviewerIds = () => [...new Set([...config.ownerIds, ...store.state.editors])];

// ---------------------------------------------------------------- daily summary
const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const AR_MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
function dailyCaption(st) {
  const p = damascusParts(st.to);
  const top = st.byGov[0];
  const types = Object.entries(st.byType).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, n]) => `${ALERT_TYPES[k].emoji} ${ALERT_TYPES[k].button_ar} ${n}`).join(' · ');
  return `🗓 <b>الملخص اليومي — ${AR_DAYS[p.wd]} ${p.d} ${AR_MONTHS[p.m - 1]} ${p.y}</b>\n\n`
    + `📊 إجمالي التنبيهات خلال 24 ساعة: <b>${st.total}</b>\n`
    + (types ? `🔺 الأكثر: ${types}\n` : '')
    + (top ? `📍 أكثر المحافظات: <b>${esc(top.ar)}</b> (${top.n})\n` : '')
    + `\n🗺 الخريطة الحية: ${(config.publicUrl || 'https://red-alert-syria.onrender.com').replace(/\/$/, '')}/ar/`;
}
function weeklyCaption(st) {
  const a = damascusParts(st.from + 3600_000); const b = damascusParts(st.to);
  const range = a.m === b.m ? `من ${a.d} إلى ${b.d} ${AR_MONTHS[b.m - 1]} ${b.y}` : `من ${a.d} ${AR_MONTHS[a.m - 1]} إلى ${b.d} ${AR_MONTHS[b.m - 1]} ${b.y}`;
  const top = st.byGov[0];
  const types = Object.entries(st.byType).filter(([, n]) => n).sort((x, y) => y[1] - x[1]).slice(0, 3)
    .map(([k, n]) => `${ALERT_TYPES[k].emoji} ${ALERT_TYPES[k].button_ar} ${n}`).join(' · ');
  const diff = st.total - st.prev;
  const cmp = st.prev ? ` (${diff > 0 ? '▲' : diff < 0 ? '▼' : '='} ${Math.abs(Math.round((diff / st.prev) * 100))}% عن الأسبوع السابق)` : '';
  const bd = st.busiestDay; const bh = st.busiestHour;
  const url = (config.publicUrl || 'https://red-alert-syria.onrender.com').replace(/\/$/, '');
  return `📅 <b>التقرير الأسبوعي — ${range}</b>\n\n`
    + `📊 إجمالي التنبيهات: <b>${st.total}</b>${cmp}\n`
    + (types ? `🔺 الأكثر: ${types}\n` : '')
    + (top ? `📍 أكثر المحافظات: <b>${esc(top.ar)}</b> (${top.n})\n` : '')
    + (bd ? `📆 أكثر الأيام نشاطاً: <b>${bd.label.ar} ${bd.label.d}</b> (${bd.n})\n` : '')
    + (bh ? `⏰ ساعة الذروة: <b>${String(bh.h).padStart(2, '0')}:00</b>\n` : '')
    + `\n🗺 الخريطة الحية: ${url}/ar/`;
}
/** Built-in scheduler: posts the statistics image in the channel once a day at the configured Damascus time. */
export function startDailySummary(api) {
  if (!api || !config.channel) return;
  const d0 = store.daily; const p0 = damascusParts();
  if (!d0.last && p0.hm >= d0.time) store.setDaily({ last: p0.date }); // first boot after the time: start tomorrow
  let busy = false;
  const tick = async () => {
    const d = store.daily;
    if (!d.on || busy) return;
    const p = damascusParts();
    if (p.hm < d.time || d.last === p.date) return;
    busy = true;
    store.setDaily({ last: p.date }); // mark first: never posts twice the same day
    try {
      const st = collectStats('day');
      if (!st.total) { console.log(`[daily] ${p.date}: no alerts, nothing posted`); return; }
      const kb = new InlineKeyboard();
      kb.url('🗺 الخريطة الحية', `${(config.publicUrl || 'https://red-alert-syria.onrender.com').replace(/\/$/, '')}/ar/`);
      if (config.reportBotUsername) kb.url('📝 أرسل بلاغاً', `https://t.me/${config.reportBotUsername}?start=report`);
      await api.sendPhoto(config.channel, new InputFile(renderStatsPng(st, 'ar'), `red-alert-syria-${p.date}.png`), { caption: dailyCaption(st), parse_mode: 'HTML', reply_markup: kb });
      console.log(`[daily] ${p.date}: summary posted (${st.total} alerts)`);
    } catch (e) {
      console.error('[daily] post failed', e.description || e.message);
    } finally { busy = false; }
  };
  // weekly report: same mechanics, on the configured weekday
  const w0 = store.weekly;
  if (!w0.last && p0.wd === w0.day && p0.hm >= w0.time) store.setWeekly({ last: p0.date });
  let wbusy = false;
  const wtick = async () => {
    const w = store.weekly;
    if (!w.on || wbusy) return;
    const p = damascusParts();
    if (p.wd !== w.day || p.hm < w.time || w.last === p.date) return;
    wbusy = true;
    store.setWeekly({ last: p.date });
    try {
      const st = collectStats('week');
      if (!st.total) { console.log(`[weekly] ${p.date}: no alerts this week, nothing posted`); return; }
      const kb = new InlineKeyboard();
      kb.url('🗺 الخريطة الحية', `${(config.publicUrl || 'https://red-alert-syria.onrender.com').replace(/\/$/, '')}/ar/`);
      if (config.reportBotUsername) kb.url('📝 أرسل بلاغاً', `https://t.me/${config.reportBotUsername}?start=report`);
      await api.sendPhoto(config.channel, new InputFile(renderStatsPng(st, 'ar'), `red-alert-syria-week-${p.date}.png`), { caption: weeklyCaption(st), parse_mode: 'HTML', reply_markup: kb });
      console.log(`[weekly] ${p.date}: report posted (${st.total} alerts)`);
    } catch (e) {
      console.error('[weekly] post failed', e.description || e.message);
    } finally { wbusy = false; }
  };
  setInterval(tick, 30_000).unref();
  setTimeout(tick, 5_000).unref();
  setInterval(wtick, 30_000).unref();
  setTimeout(wtick, 8_000).unref();
}

export function createBot({ role = 'admin', token = config.botToken, reviewApi = null } = {}) {
  if (!token) return null;
  const bot = new Bot(token);
  APIS[role] = bot.api; TOKENS[role] = token;
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') return; // only private chats
    ctx.ras = { role };
    if (ctx.from) store.touchUser(ctx.from);
    clearTransientFor(ctx); // any new tap/message removes earlier "thanks"/"approved" notices
    // The publishing bot is private: only the owner and the editors can use it.
    if (role === 'admin' && ctx.from && !isStaffId(ctx.from.id)) {
      const txt = ctx.message?.text || '';
      if (/^\/id\b/.test(txt)) return ctx.reply(L(ctx).yourId(ctx.from.id), { parse_mode: 'HTML' });
      if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
      const l = L(ctx);
      const kb = new InlineKeyboard();
      if (botInfo.report) kb.url(l.btnReportBot, `https://t.me/${botInfo.report}?start=report`).row();
      kb.url(l.btnChannel, config.channelUrl);
      if (config.publicUrl) kb.url(l.btnMap, mapUrl('', langOf(ctx)));
      return ctx.reply(l.privateBot(botInfo.report || 'Red_Alert_Syria'), { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } });
    }
    await next();
  });
  // ---- relay: staff reply (publishing bot) -> reporter (report bot); no menus, no buttons
  if (role === 'admin') {
    bot.on('message', async (ctx, next) => {
      const rt = ctx.message.reply_to_message;
      if (!rt || !staff(ctx) || ctx.message.text?.startsWith('/')) return next();
      const uid = store.relayGet(`a:${ctx.chat.id}:${rt.message_id}`);
      if (!uid) return next();
      const en = langOf(ctx) === 'en';
      if (!APIS.report) return sendTransient(ctx.api, ctx.chat.id, en ? '⚠️ The report bot is not running.' : '⚠️ بوت التبليغ غير متصل حالياً.');
      const rl = store.userLang(uid) === 'en';
      const header = rl ? '💬 <b>Message from the Red Alert Syria team</b>' : '💬 <b>رسالة من إدارة Red Alert Syria</b>';
      const footer = rl ? '<i>↩️ To answer, just write your message here.</i>' : '<i>↩️ للرد، اكتب رسالتك هنا مباشرة.</i>';
      try {
        const m = await relayCopy(ctx.api, TOKENS.admin, APIS.report, uid, ctx.message, header, footer);
        store.relayPut(`r:${uid}:${m.message_id}`, ctx.from.id);
        store.openThread(uid, ctx.from.id);
        store.convoAdd('admin', ctx.chat.id, ctx.message.message_id); // staff's own reply
        store.convoAdd('report', uid, m.message_id); // the copy the reporter received
        await sendTransient(ctx.api, ctx.chat.id, en ? '✅ Your reply was sent to the reporter.' : '✅ تم إرسال ردك إلى صاحب البلاغ.');
      } catch (e) {
        const d = String(e.description || e.message || '');
        await sendTransient(ctx.api, ctx.chat.id, /blocked|deactivated|chat not found/i.test(d)
          ? (en ? '⚠️ Not delivered: the reporter blocked or left the report bot.' : '⚠️ لم يصل: صاحب البلاغ حظر بوت التبليغ أو غادره.')
          : (en ? '⚠️ Could not send the reply, please try again.' : '⚠️ تعذّر إرسال الرد، حاول مرة أخرى.'));
      }
    });
  }
  // ---- relay: reporter (report bot) -> staff (publishing bot)
  if (role === 'report') {
    bot.on('message', async (ctx, next) => {
      const msg = ctx.message;
      if (msg.text?.startsWith('/') || msg.location || store.isBanned(ctx.from.id)) return next();
      const rt = msg.reply_to_message;
      const linked = rt ? store.relayGet(`r:${ctx.from.id}:${rt.message_id}`) : null;
      const th = store.thread(ctx.from.id);
      if (!linked && (getDraft(ctx) || !th)) return next();
      const en = langOf(ctx) === 'en';
      const now = Date.now(); const rr = (relayRate.get(ctx.from.id) || []).filter((t) => now - t < 3600_000);
      if (rr.length >= 20) return sendTransient(ctx.api, ctx.chat.id, en ? '⏳ Too many messages, please wait a little.' : '⏳ رسائل كثيرة، انتظر قليلاً من فضلك.');
      rr.push(now); relayRate.set(ctx.from.id, rr);
      const api = APIS.admin || reviewApi;
      const targets = linked ? [linked] : th?.staff ? [th.staff] : reviewerIds();
      let ok = 0;
      for (const sid of targets) {
        const sl = store.userLang(sid) === 'en';
        const header = `${sl ? '💬 <b>Message from a reporter</b>' : '💬 <b>رسالة من صاحب بلاغ</b>'}\n${who(ctx.from)}`;
        const footer = sl ? '<i>↩️ Use "Reply" on this message to answer.</i>' : '<i>↩️ اعمل «رد» على هذه الرسالة لتجيبه.</i>';
        try {
          const m = await relayCopy(ctx.api, TOKENS.report, api, sid, msg, header, footer);
          store.relayPut(`a:${sid}:${m.message_id}`, ctx.from.id);
          store.convoAdd('admin', sid, m.message_id);
          ok += 1;
        } catch (e) { console.warn('[relay] to staff failed', e.description || e.message); }
      }
      store.openThread(ctx.from.id);
      if (ok) store.convoAdd('report', ctx.chat.id, msg.message_id); // reporter's own message
      await sendTransient(ctx.api, ctx.chat.id, ok ? (en ? '✅ Your message reached the team.' : '✅ وصلت رسالتك إلى الإدارة.') : (en ? '⚠️ Could not deliver, try again later.' : '⚠️ تعذّر الإيصال، حاول لاحقاً.'));
    });
  }
  // pressing the menu clears this chat's relay conversation (the thread itself stays open:
  // the reporter can still write, and staff can answer his next message)
  const clearConvo = (ctx) => {
    if (!ctx.chat || ctx.chat.type !== 'private') return;
    const ids = store.convoTake(role, ctx.chat.id);
    for (const id of ids) ctx.api.deleteMessage(ctx.chat.id, id).catch(() => {});
  };
  const home = async (ctx) => {
    clearConvo(ctx);
    sessions.delete(sk(ctx));
    const l = L(ctx);
    const name = esc(ctx.from.first_name || '');
    const text = staff(ctx) ? `${l.welcomeAdmin(name)}\n\n${l.mainMenu}` : `${l.welcomeReport(name)}\n\n${l.publicMenu}`;
    await show(ctx, text, mainKeyboard(ctx));
  };

  bot.command(['start', 'menu'], async (ctx) => {
    if (ctx.callbackQuery) return home(ctx);
    clearConvo(ctx);
    sessions.delete(sk(ctx));
    const l = L(ctx);
    const name = esc(ctx.from.first_name || '');
    const text = staff(ctx) ? `${l.welcomeAdmin(name)}\n\n${l.mainMenu}` : `${l.welcomeReport(name)}\n\n${l.publicMenu}`;
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainKeyboard(ctx), link_preview_options: { is_disabled: true } });
  });
  bot.command('help', (ctx) => ctx.reply(staff(ctx) ? L(ctx).help : L(ctx).helpReport, { parse_mode: 'HTML' }));
  bot.command('id', (ctx) => ctx.reply(L(ctx).yourId(ctx.from.id), { parse_mode: 'HTML' }));
  bot.command('lang', async (ctx) => {
    store.setUserLang(ctx.from.id, langOf(ctx) === 'ar' ? 'en' : 'ar');
    await ctx.reply(L(ctx).langSet);
    await ctx.reply(L(ctx).mainMenu, { reply_markup: mainKeyboard(ctx) });
  });
  bot.command('active', (ctx) => (staff(ctx) ? showActive(ctx) : null));

  // Owner commands
  const ownerOnly = (fn) => async (ctx) => (owner(ctx) ? fn(ctx) : ctx.reply(L(ctx).onlyOwner));
  const editorsText = (ctx) => {
    const list = store.state.editors.map((id) => {
      const u = store.state.users[id];
      return `• <code>${id}</code> ${u?.name ? esc(u.name) : ''} ${u?.username ? '@' + esc(u.username) : ''}`;
    }).join('\n');
    return L(ctx).editorsTitle(list);
  };
  // Owner-only: render sample channel images on this server and send them to the owner's private chat
  // (never to the channel). /imgtest [type] [place name] — e.g. "/imgtest uav دوما", "/imgtest all".
  bot.command('imgtest', ownerOnly(async (ctx) => {
    const args = String(ctx.match || '').trim().split(/\s+/).filter(Boolean);
    const type = args[0] && (ALERT_TYPES[args[0]] || args[0] === 'all') ? args.shift() : 'uav';
    await imageTest(ctx.api, ctx.chat.id, { type, q: args.join(' '), lang: langOf(ctx) });
  }));
  bot.command('editors', ownerOnly((ctx) => ctx.reply(editorsText(ctx), { parse_mode: 'HTML' })));
  bot.command('addeditor', ownerOnly(async (ctx) => {
    const id = Number(String(ctx.match || '').trim());
    if (!Number.isFinite(id) || id <= 0) return ctx.reply('/addeditor 123456789');
    store.addEditor(id);
    await ctx.reply(L(ctx).editorAdded(id), { parse_mode: 'HTML' });
  }));
  bot.command('removeeditor', ownerOnly(async (ctx) => {
    const id = Number(String(ctx.match || '').trim());
    store.removeEditor(id);
    await ctx.reply(L(ctx).editorRemoved(id), { parse_mode: 'HTML' });
  }));
  const statsText = (ctx) => {
    const day = Date.now() - 86400_000;
    return L(ctx).stats({
      active: store.activeAlerts().length,
      day: store.state.alerts.filter((a) => Date.parse(a.timestamp) >= day).length,
      total: store.state.stats.published || 0,
      editors: store.state.editors.length,
      backup: store.lastBackupAt ? fmtTime(store.lastBackupAt, langOf(ctx)) : null,
    });
  };
  bot.command('stats', ownerOnly(async (ctx) => { await ctx.replyWithChatAction('upload_photo').catch(() => {}); await sendStats(ctx, '24h'); }));
  bot.command('backup', ownerOnly(async (ctx) => {
    await store.backup?.save(JSON.stringify(store.state));
    store.lastBackupAt = new Date().toISOString();
    await ctx.reply(L(ctx).backupDone);
  }));

  // -------- callbacks
  bot.callbackQuery('home', async (ctx) => { await ctx.answerCallbackQuery(); await home(ctx); });
  bot.callbackQuery('cancel', async (ctx) => { await ctx.answerCallbackQuery(L(ctx).cancelled); await home(ctx); });
  bot.callbackQuery('lang', async (ctx) => {
    store.setUserLang(ctx.from.id, langOf(ctx) === 'ar' ? 'en' : 'ar');
    await ctx.answerCallbackQuery(L(ctx).langSet);
    await home(ctx);
  });
  bot.callbackQuery('editors', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!owner(ctx)) return;
    await show(ctx, editorsText(ctx), new InlineKeyboard().text(L(ctx).btnHome, 'home'));
  });
  // ---- statistics as an image (owner only): 24h / 7 days / 30 days
  const statsKb = (ctx, kind) => {
    const en = langOf(ctx) === 'en'; const m = (k, t) => (k === kind ? '✅ ' : '') + t;
    return new InlineKeyboard()
      .text(m('24h', en ? '24 hours' : '24 ساعة'), 'st:24h').text(m('7d', en ? '7 days' : '7 أيام'), 'st:7d').text(m('30d', en ? '30 days' : '30 يوماً'), 'st:30d').row()
      .text(en ? '🗓 Daily summary' : '🗓 الملخص اليومي', 'dly').text(en ? '📅 Weekly report' : '📅 التقرير الأسبوعي', 'wkl').row()
      .text(L(ctx).btnHome, 'home');
  };
  const statsCaption = (ctx) => `${statsText(ctx)}\n\n${langOf(ctx) === 'en' ? 'Generated' : 'أُنشئت'}: ${damascusParts().hm}`;
  const sendStats = async (ctx, kind = '24h') => {
    const lang = langOf(ctx);
    const png = renderStatsPng(collectStats(kind), lang);
    const file = new InputFile(png, `red-alert-syria-stats-${kind}.png`);
    const msg = ctx.callbackQuery?.message;
    if (msg?.photo) {
      try {
        await ctx.editMessageMedia(InputMediaBuilder.photo(file, { caption: statsCaption(ctx), parse_mode: 'HTML' }), { reply_markup: statsKb(ctx, kind) });
        return;
      } catch (e) { if (String(e?.description || e).includes('not modified')) return; }
    }
    if (msg) { try { await ctx.deleteMessage(); } catch { /* ignore */ } }
    await ctx.replyWithPhoto(file, { caption: statsCaption(ctx), parse_mode: 'HTML', reply_markup: statsKb(ctx, kind) });
  };
  bot.callbackQuery('stats', async (ctx) => {
    if (!owner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Building the image…' : 'جارٍ تجهيز الصورة…');
    await ctx.replyWithChatAction('upload_photo').catch(() => {});
    await sendStats(ctx, '24h');
  });
  bot.callbackQuery(/^st:(24h|7d|30d)$/, async (ctx) => {
    if (!owner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    await sendStats(ctx, ctx.match[1]);
  });
  // ---- daily summary settings (owner only)
  const DAILY_TIMES = ['20:00', '21:00', '22:00', '23:00', '23:30', '23:55'];
  const dailyText = (ctx) => {
    const d = store.daily; const en = langOf(ctx) === 'en';
    return en
      ? `🗓 <b>Daily summary</b>\n\nStatus: <b>${d.on ? '✅ On' : '⏸ Off'}</b>\nTime: <b>${d.time}</b> (Damascus time)\n\nEvery day at this time the bot posts the statistics image of the last 24 hours in the channel. Nothing is posted on a day without alerts.${d.last ? `\nLast run: ${d.last}` : ''}`
      : `🗓 <b>الملخص اليومي</b>\n\nالحالة: <b>${d.on ? '✅ مفعّل' : '⏸ متوقف'}</b>\nالوقت: <b>${d.time}</b> بتوقيت دمشق\n\nكل يوم بهذا الوقت ينشر البوت في القناة صورة إحصاءات آخر 24 ساعة. لا يُنشر شيء في يوم بلا تنبيهات.${d.last ? `\nآخر تشغيل: ${d.last}` : ''}`;
  };
  const dailyKb = (ctx) => {
    const d = store.daily; const en = langOf(ctx) === 'en';
    const kb = new InlineKeyboard().text(d.on ? (en ? '⏸ Turn off' : '⏸ إيقاف') : (en ? '▶️ Turn on' : '▶️ تشغيل'), d.on ? 'dly:off' : 'dly:on').row();
    DAILY_TIMES.forEach((t, i) => { kb.text((t === d.time ? '✅ ' : '') + t, `dly:t:${t}`); if (i % 3 === 2) kb.row(); });
    return kb.text(en ? '📤 Send me a test now' : '📤 أرسل لي تجربة الآن', 'dly:test').row()
      .text(en ? '📊 Statistics' : '📊 الإحصاءات', 'stats').text(L(ctx).btnHome, 'home');
  };
  // a time that already passed today starts tomorrow (never posts by surprise right after a change)
  const markIfPassed = (time) => { const p = damascusParts(); if (p.hm >= time) store.setDaily({ last: p.date }); };
  bot.callbackQuery('dly', async (ctx) => { await ctx.answerCallbackQuery(); if (owner(ctx)) await show(ctx, dailyText(ctx), dailyKb(ctx)); });
  bot.callbackQuery(/^dly:(on|off)$/, async (ctx) => {
    if (!owner(ctx)) return ctx.answerCallbackQuery();
    const on = ctx.match[1] === 'on';
    if (on && !store.daily.on) markIfPassed(store.daily.time);
    store.setDaily({ on });
    await ctx.answerCallbackQuery(on ? (langOf(ctx) === 'en' ? 'Daily summary on' : 'تم تفعيل الملخص اليومي') : (langOf(ctx) === 'en' ? 'Daily summary off' : 'تم إيقاف الملخص اليومي'));
    await show(ctx, dailyText(ctx), dailyKb(ctx));
  });
  bot.callbackQuery(/^dly:t:(\d\d:\d\d)$/, async (ctx) => {
    if (!owner(ctx)) return ctx.answerCallbackQuery();
    const time = ctx.match[1];
    if (!DAILY_TIMES.includes(time)) return ctx.answerCallbackQuery();
    store.setDaily({ time });
    markIfPassed(time);
    await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? `Time set to ${time}` : `تم ضبط الوقت على ${time}`);
    await show(ctx, dailyText(ctx), dailyKb(ctx));
  });
  // ---- weekly report settings (owner only)
  const WEEK_TIMES = ['20:00', '21:00', '22:00', '23:00', '23:30'];
  const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5]; // Saturday .. Friday
  const DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weeklyText = (ctx) => {
    const w = store.weekly; const en = langOf(ctx) === 'en';
    return en
      ? `📅 <b>Weekly report</b>\n\nStatus: <b>${w.on ? '✅ On' : '⏸ Off'}</b>\nDay: <b>${DAY_EN[w.day]}</b> · Time: <b>${w.time}</b> (Damascus time)\n\nEvery week at this time the bot posts the report image of the past 7 days in the channel (totals, event types, governorates, busiest day and hour, comparison with the previous week). Nothing is posted in a week without alerts.${w.last ? `\nLast run: ${w.last}` : ''}`
      : `📅 <b>التقرير الأسبوعي</b>\n\nالحالة: <b>${w.on ? '✅ مفعّل' : '⏸ متوقف'}</b>\nاليوم: <b>${AR_DAYS[w.day]}</b> · الوقت: <b>${w.time}</b> بتوقيت دمشق\n\nكل أسبوع بهذا الموعد ينشر البوت في القناة صورة تقرير آخر 7 أيام (الإجمالي، أنواع الأحداث، المحافظات، أكثر يوم وساعة نشاطاً، والمقارنة مع الأسبوع السابق). لا يُنشر شيء في أسبوع بلا تنبيهات.${w.last ? `\nآخر تشغيل: ${w.last}` : ''}`;
  };
  const weeklyKb = (ctx) => {
    const w = store.weekly; const en = langOf(ctx) === 'en';
    const kb = new InlineKeyboard().text(w.on ? (en ? '⏸ Turn off' : '⏸ إيقاف') : (en ? '▶️ Turn on' : '▶️ تشغيل'), w.on ? 'wkl:off' : 'wkl:on').row();
    DAY_ORDER.forEach((d, i) => { kb.text((d === w.day ? '✅ ' : '') + (en ? DAY_EN[d] : AR_DAYS[d]), `wkl:d:${d}`); if (i === 3) kb.row(); });
    kb.row();
    WEEK_TIMES.forEach((t) => kb.text((t === w.time ? '✅ ' : '') + t, `wkl:t:${t}`));
    return kb.row().text(en ? '📤 Send me a test now' : '📤 أرسل لي تجربة الآن', 'wkl:test').row()
      .text(en ? '📊 Statistics' : '📊 الإحصاءات', 'stats').text(L(ctx).btnHome, 'home');
  };
  const weekMarkIfPassed = () => { const w = store.weekly; const p = damascusParts(); if (p.wd === w.day && p.hm >= w.time) store.setWeekly({ last: p.date }); };
  bot.callbackQuery('wkl', async (ctx) => { await ctx.answerCallbackQuery(); if (owner(ctx)) await show(ctx, weeklyText(ctx), weeklyKb(ctx)); });
  bot.callbackQuery(/^wkl:(on|off)$/, async (ctx) => {
    if (!owner(ctx)) return ctx.answerCallbackQuery();
    const on = ctx.match[1] === 'on';
    if (on && !store.weekly.on) weekMarkIfPassed();
    store.setWeekly({ on });
    await ctx.answerCallbackQuery(on ? (langOf(ctx) === 'en' ? 'Weekly report on' : 'تم تفعيل التقرير الأسبوعي') : (langOf(ctx) === 'en' ? 'Weekly report off' : 'تم إيقاف التقرير الأسبوعي'));
    await show(ctx, weeklyText(ctx), weeklyKb(ctx));
  });
  bot.callbackQuery(/^wkl:d:([0-6])$/, async (ctx) => {
    if (!owner(ctx)) return ctx.answerCallbackQuery();
    store.setWeekly({ day: Number(ctx.match[1]) }); weekMarkIfPassed();
    await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Day saved' : 'تم حفظ اليوم');
    await show(ctx, weeklyText(ctx), weeklyKb(ctx));
  });
  bot.callbackQuery(/^wkl:t:(\d\d:\d\d)$/, async (ctx) => {
    if (!owner(ctx) || !WEEK_TIMES.includes(ctx.match[1])) return ctx.answerCallbackQuery();
    store.setWeekly({ time: ctx.match[1] }); weekMarkIfPassed();
    await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? `Time set to ${ctx.match[1]}` : `تم ضبط الوقت على ${ctx.match[1]}`);
    await show(ctx, weeklyText(ctx), weeklyKb(ctx));
  });
  bot.callbackQuery('wkl:test', async (ctx) => {
    if (!owner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Sending a private test…' : 'جارٍ إرسال تجربة خاصة لك…');
    await ctx.replyWithChatAction('upload_photo').catch(() => {});
    const st = collectStats('week');
    const head = langOf(ctx) === 'en' ? '🧪 <b>Test only — not posted in the channel.</b>\nThis is exactly what the channel will receive:' : '🧪 <b>تجربة خاصة — لم تُنشر في القناة.</b>\nهكذا سيظهر التقرير في القناة:';
    await ctx.replyWithPhoto(new InputFile(renderStatsPng(st, 'ar'), 'weekly-report-test.png'), { caption: `${head}\n\n${weeklyCaption(st)}`, parse_mode: 'HTML', reply_markup: new InlineKeyboard().text(L(ctx).btnHome, 'home') });
  });
  bot.callbackQuery('dly:test', async (ctx) => {
    if (!owner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Sending a private test…' : 'جارٍ إرسال تجربة خاصة لك…');
    const st = collectStats('day');
    const png = renderStatsPng(st, 'ar');
    const head = langOf(ctx) === 'en' ? '🧪 <b>Test only — not posted in the channel.</b>\nThis is exactly what the channel will receive:' : '🧪 <b>تجربة خاصة — لم تُنشر في القناة.</b>\nهكذا سيظهر الملخص في القناة:';
    await ctx.replyWithPhoto(new InputFile(png, 'daily-summary-test.png'), { caption: `${head}\n\n${dailyCaption(st)}`, parse_mode: 'HTML', reply_markup: new InlineKeyboard().text(L(ctx).btnHome, 'home') });
  });

  // civil sub-menu: general civil alert + traffic accident, protest, fire, civil aircraft
  bot.callbackQuery('cv', async (ctx) => {
    await ctx.answerCallbackQuery();
    const lang = langOf(ctx);
    const b = (k) => `${ALERT_TYPES[k].emoji} ${lang === 'en' ? ALERT_TYPES[k].button_en : ALERT_TYPES[k].button_ar}`;
    const kb = new InlineKeyboard()
      .text(b('accident'), 't:accident').text(b('fire'), 't:fire').row()
      .text(b('protest'), 't:protest').text(b('civil_plane'), 't:civil_plane').row()
      .text(`🚑 ${lang === 'en' ? 'Other civil alert' : 'تنبيه مدني آخر'}`, 't:civil').row()
      .text(L(ctx).btnBack, 'home');
    await show(ctx, L(ctx).askCivil, kb);
  });
  bot.callbackQuery(/^t:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const type = ctx.match[1];
    if (!ALERT_TYPES[type]) return;
    if (!staff(ctx)) {
      if (store.isBanned(ctx.from.id)) return show(ctx, L(ctx).banned, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
      if (Date.now() - (lastReport.get(ctx.from.id) || 0) < REPORT_COOLDOWN_MS) return show(ctx, L(ctx).reportRate, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
    }
    const d = newDraft(ctx, type);
    if (type === 'breaking') {
      await show(ctx, L(ctx).askBreaking, new InlineKeyboard().text(L(ctx).btnCancel, 'cancel'));
    } else {
      await askLocation(ctx, d);
    }
  });

  const needDraft = (fn) => async (ctx) => {
    const d = getDraft(ctx);
    if (!d) {
      await ctx.answerCallbackQuery(L(ctx).expiredSession);
      return home(ctx);
    }
    await ctx.answerCallbackQuery();
    return fn(ctx, d);
  };

  bot.callbackQuery(/^g:(\d+)$/, needDraft(async (ctx, d) => {
    const gov = ctx.match[1];
    if (!getGov(gov)) return;
    d.gov = gov; d.step = 'dist';
    const lang = langOf(ctx);
    await show(ctx, L(ctx).askDist(`<b>${esc(typeLabel(d.type, lang))}</b>`, esc(lang === 'en' ? getGov(gov).en : getGov(gov).ar)), distKeyboard(ctx, gov));
  }));
  bot.callbackQuery(/^wg:(\d+)$/, needDraft(async (ctx, d) => {
    d.location = locationFrom({ govCode: ctx.match[1] });
    await afterLocation(ctx, d);
  }));
  const showPlaces = async (ctx, d, dist, page) => {
    d.dist = dist; d.step = 'place';
    const lang = langOf(ctx);
    const { kb, page: p, pages } = placeKeyboard(ctx, dist, page);
    const dd = getDist(dist);
    await show(ctx, L(ctx).askPlace(`<b>${esc(typeLabel(d.type, lang))}</b>`, esc(lang === 'en' ? dd.en : dd.ar), p, pages), kb);
  };
  bot.callbackQuery(/^d:(\d+)$/, needDraft((ctx, d) => (getDist(ctx.match[1]) ? showPlaces(ctx, d, ctx.match[1], 0) : null)));
  bot.callbackQuery(/^pg:(\d+):(\d+)$/, needDraft((ctx, d) => showPlaces(ctx, d, ctx.match[1], Number(ctx.match[2]))));
  bot.callbackQuery(/^wd:(\d+)$/, needDraft(async (ctx, d) => {
    d.location = locationFrom({ distCode: ctx.match[1] });
    await afterLocation(ctx, d);
  }));
  bot.callbackQuery(/^p:(\d+)$/, needDraft(async (ctx, d) => {
    const loc = locationFrom({ placeId: Number(ctx.match[1]) });
    if (!loc) return;
    d.location = loc;
    await afterLocation(ctx, d);
  }));
  bot.callbackQuery('noloc', needDraft(async (ctx, d) => {
    d.location = locationFrom({});
    await showPreview(ctx, d);
  }));
  bot.callbackQuery('skip', needDraft((ctx, d) => showPreview(ctx, d)));
  bot.callbackQuery(/^back:(gov|dist)$/, needDraft(async (ctx, d) => {
    if (ctx.match[1] === 'dist' && d.gov) {
      d.step = 'dist';
      const lang = langOf(ctx);
      return show(ctx, L(ctx).askDist(`<b>${esc(typeLabel(d.type, lang))}</b>`, esc(lang === 'en' ? getGov(d.gov).en : getGov(d.gov).ar)), distKeyboard(ctx, d.gov));
    }
    return askLocation(ctx, d);
  }));
  bot.callbackQuery('editdetails', needDraft(async (ctx, d) => {
    if (d.type === 'breaking') {
      d.step = 'text';
      return show(ctx, L(ctx).askBreaking, new InlineKeyboard().text(L(ctx).btnCancel, 'cancel'));
    }
    d.details = '';
    d.step = 'details';
    const kb = new InlineKeyboard().text(L(ctx).btnSkip, 'skip').row().text(L(ctx).btnCancel, 'cancel');
    await show(ctx, L(ctx).askDetails(`<b>${esc(typeLabel(d.type, langOf(ctx)))}</b>`, esc(locName(d.location, langOf(ctx)))), kb);
  }));
  bot.callbackQuery('dur', needDraft(async (ctx, d) => {
    const kb = new InlineKeyboard();
    DURATIONS.forEach((m, i) => {
      kb.text((m === d.ttlMin ? '• ' : '') + fmtDur(m, langOf(ctx)), 'setdur:' + m);
      if (i % 4 === 3) kb.row();
    });
    kb.row().text(L(ctx).btnBack, 'preview');
    await show(ctx, L(ctx).durTitle, kb);
  }));
  bot.callbackQuery(/^setdur:(\d+)$/, needDraft(async (ctx, d) => {
    const m = Number(ctx.match[1]);
    if (DURATIONS.includes(m)) d.ttlMin = m;
    await showPreview(ctx, d);
  }));
  bot.callbackQuery('preview', needDraft((ctx, d) => showPreview(ctx, d)));

  bot.callbackQuery('publish', needDraft(async (ctx, d) => {
    if (!staff(ctx)) return;
    if (d.type === 'breaking' && !d.text) return askLocation(ctx, d);
    sessions.delete(sk(ctx));
    if (config.alertImages) { try { await show(ctx, L(ctx).publishing, new InlineKeyboard()); } catch { /* ignore */ } }
    const alert = await publishDraft(ctx.api, d, d.fromReport ? { id: d.fromReport.id, name: d.fromReport.first_name, approvedBy: ctx.from.id } : { id: ctx.from.id, name: ctx.from.first_name });
    if (d.fromReport) await sendTransient(d.notifyApi || ctx.api, d.fromReport.id, T[store.userLang(d.fromReport.id)].reportApprovedUser);
    await show(ctx, `${L(ctx).published}\n\n${draftSummary(d, langOf(ctx))}`, resultKeyboard(ctx, alert));
  }));

  bot.callbackQuery('submit', needDraft(async (ctx, d) => {
    if (store.isBanned(ctx.from.id)) return;
    sessions.delete(sk(ctx));
    lastReport.set(ctx.from.id, Date.now());
    const rid = Math.random().toString(36).slice(2, 10);
    const rep = { draft: d, from: { id: ctx.from.id, first_name: ctx.from.first_name, last_name: ctx.from.last_name, username: ctx.from.username }, messages: [], created: Date.now(), notifyApi: ctx.api };
    const api = reviewApi || ctx.api;
    reports.set(rid, rep);
    const reviewers = [...new Set([...config.ownerIds, ...store.state.editors])];
    for (const uid of reviewers) {
      const lang = store.userLang(uid) === 'en' ? 'en' : 'ar';
      const l = T[lang];
      const kb = new InlineKeyboard().text(l.btnApprove, 'rap:' + rid).row().text(l.btnEditPublish, 'red:' + rid).row().text(l.btnReject, 'rrj:' + rid).text(l.btnBan, 'rbn:' + rid);
      try {
        const hint = lang === 'en' ? '<i>↩️ To talk to the reporter, use "Reply" on this message.</i>' : '<i>↩️ لمراسلة صاحب البلاغ: اعمل «رد» على هذه الرسالة واكتب.</i>';
        const m = await api.sendMessage(uid, `${l.reportNew(who(ctx.from))}\n\n${draftSummary(d, lang)}\n\n${hint}`, { parse_mode: 'HTML', reply_markup: kb });
        rep.messages.push([uid, m.message_id]);
        store.relayPut(`a:${uid}:${m.message_id}`, ctx.from.id);
      } catch (e) { /* reviewer has not started the bot */ }
    }
    store.openThread(ctx.from.id); // the reporter can now write to the team freely
    // short "thanks" notice that disappears by itself; the chat goes straight back to the menu
    await home(ctx);
    await sendTransient(ctx.api, ctx.chat.id, L(ctx).reportSent);
  }));

  // Remove the report from every reviewer's chat (optionally keeping the current one).
  const closeReport = async (ctx, rid, keepCurrent = false) => {
    const rep = reports.get(rid);
    if (!rep) return;
    reports.delete(rid);
    const cur = ctx.callbackQuery?.message;
    for (const [chat, mid] of rep.messages) {
      if (cur && chat === cur.chat.id && mid === cur.message_id) { if (keepCurrent) continue; }
      try { await ctx.api.deleteMessage(chat, mid); } catch {
        const lang = store.userLang(chat) === 'en' ? 'en' : 'ar';
        try { await ctx.api.editMessageText(chat, mid, `${T[lang].reportNew(who(rep.from))}\n\n${draftSummary(rep.draft, lang)}\n\n✔️`, { parse_mode: 'HTML' }); } catch { /* ignore */ }
      }
    }
  };
  bot.callbackQuery(/^r(ap|rj|bn|ed):(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return ctx.answerCallbackQuery();
    const [, action, rid] = ctx.match;
    const rep = reports.get(rid);
    if (!rep) return vanish(ctx, L(ctx).notFound);
    const by = esc(ctx.from.first_name || String(ctx.from.id));
    if (action === 'ap') {
      await publishDraft(ctx.api, rep.draft, { id: rep.from.id, name: rep.from.first_name, approvedBy: ctx.from.id });
      await closeReport(ctx, rid, true);
      await vanish(ctx, L(ctx).reportApproved(ctx.from.first_name || ''));
      await sendTransient(rep.notifyApi || ctx.api, rep.from.id, T[store.userLang(rep.from.id)].reportApprovedUser);
    } else if (action === 'ed') {
      // Load the report into this editor's publishing session so it can be adjusted first.
      await ctx.answerCallbackQuery();
      await closeReport(ctx, rid, true);
      const d = { ...rep.draft, mode: 'publish', created: Date.now(), msgId: null, fromReport: rep.from, notifyApi: rep.notifyApi };
      sessions.set(sk(ctx), d);
      await showPreview(ctx, d);
    } else {
      if (action === 'bn') store.ban(rep.from.id);
      await closeReport(ctx, rid, true);
      await vanish(ctx, L(ctx).reportRejected(ctx.from.first_name || '') + (action === 'bn' ? ' · 🚫' : ''));
    }
    void by;
  });
  // -------- active alerts management
  async function showActive(ctx) {
    const l = L(ctx);
    const lang = langOf(ctx);
    const act = store.activeAlerts().slice(0, 30);
    if (!act.length) return show(ctx, l.noActive, new InlineKeyboard().text(l.btnHome, 'home'));
    const kb = new InlineKeyboard();
    for (const a of act) {
      const t = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(a.timestamp));
      kb.text(`${typeOf(a.type).emoji} ${t} · ${(lang === 'en' ? a.title_en : a.title) || ''}`.slice(0, 60), 'm:' + a.id).row();
    }
    kb.text(l.btnHome, 'home');
    await show(ctx, l.activeTitle(store.activeAlerts().length), kb);
  }
  // -------- bulk clear of active alerts (staff)
  bot.callbackQuery('clr', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!staff(ctx)) return;
    const l = L(ctx);
    const n = store.activeAlerts().length;
    if (!n) return show(ctx, l.clearNone, new InlineKeyboard().text(l.btnHome, 'home'));
    await show(ctx, l.clearConfirm(n), new InlineKeyboard().text(l.btnEndAll, 'clr:end').row().text(l.btnDelAll, 'clr:del').row().text(l.btnBack, 'home'));
  });
  bot.callbackQuery(/^clr:(end|del)$/, async (ctx) => {
    if (!staff(ctx)) return ctx.answerCallbackQuery();
    const l = L(ctx);
    if (ctx.match[1] === 'end') {
      const ended = store.endAll();
      await vanish(ctx, l.clearedEnd(ended.length));
      for (const a of ended) {
        try { await refreshChannelPost(ctx.api, store.getAlert(a.id), true); } catch (e) { console.error('[bot] refresh failed', e.description || e.message); }
        await new Promise((r) => setTimeout(r, 120));
      }
    } else {
      const gone = store.deleteActive();
      await vanish(ctx, l.clearedDel(gone.length));
    }
    console.log(`[bot] bulk ${ctx.match[1]} by ${ctx.from.id}`);
  });
  // -------- auto-delete setting (owner)
  const autoKb = (ctx) => {
    const l = L(ctx); const h = store.autoDeleteHours; const m = (v, t) => (h === v ? '✅ ' : '') + t;
    return new InlineKeyboard().text(m(24, l.btnAuto24), 'auto:24').text(m(48, l.btnAuto48), 'auto:48').text(m(0, l.btnAutoOff), 'auto:0').row().text(l.btnHome, 'home');
  };
  bot.callbackQuery('auto', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!owner(ctx)) return;
    await show(ctx, L(ctx).autoTitle(store.autoDeleteHours), autoKb(ctx));
  });
  bot.callbackQuery(/^auto:(0|24|48)$/, async (ctx) => {
    if (!owner(ctx)) return ctx.answerCallbackQuery();
    store.setAutoDelete(Number(ctx.match[1]));
    await ctx.answerCallbackQuery(L(ctx).autoSaved);
    await show(ctx, L(ctx).autoTitle(store.autoDeleteHours), autoKb(ctx));
  });
  bot.callbackQuery('active', async (ctx) => { await ctx.answerCallbackQuery(); if (staff(ctx)) await showActive(ctx); });

  const manageText = (ctx, a) => {
    const lang = langOf(ctx);
    const exp = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-SY', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(a.expires_at));
    return `${L(ctx).manageTitle}\n\n${typeOf(a.type).emoji} <b>${esc(lang === 'en' ? a.title_en : a.title)}</b>\n${a.description ? esc(a.description) + '\n' : ''}🕒 ${esc(fmtTime(a.timestamp, lang))}\n⌛ ${lang === 'en' ? 'Expires' : 'ينتهي'}: ${exp}${a.is_active ? '' : '\n\n' + L(ctx).ended}`;
  };
  bot.callbackQuery(/^m:([\w-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!staff(ctx)) return;
    const a = store.getAlert(ctx.match[1]);
    if (!a) return show(ctx, L(ctx).notFound, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
    const kb = resultKeyboard(ctx, a).row().text(L(ctx).btnBack, 'active');
    await show(ctx, manageText(ctx, a), kb);
  });
  bot.callbackQuery(/^(end|del|ext):([\w-]{36})$/, async (ctx) => {
    if (!staff(ctx)) return ctx.answerCallbackQuery();
    const [, action, id] = ctx.match;
    const a = store.getAlert(id);
    if (!a) return vanish(ctx, L(ctx).notFound);
    if (action === 'end') {
      store.endAlert(id);
      await refreshChannelPost(ctx.api, store.getAlert(id), true);
      await vanish(ctx, L(ctx).ended);
    } else if (action === 'ext') {
      const base = Math.max(Date.now(), Date.parse(a.expires_at));
      store.updateAlert(id, { expires_at: new Date(base + 30 * 60_000).toISOString(), is_active: true, ended_at: undefined });
      await refreshChannelPost(ctx.api, store.getAlert(id), false);
      await ctx.answerCallbackQuery(L(ctx).extended);
      await show(ctx, manageText(ctx, store.getAlert(id)), resultKeyboard(ctx, store.getAlert(id)));
    } else {
      const removed = store.deleteAlert(id);
      if (removed?.channel_message_id) {
        try { await ctx.api.deleteMessage(config.channel, removed.channel_message_id); } catch (e) { console.error('[bot] delete failed', e.description); }
      }
      await vanish(ctx, L(ctx).deleted);
    }
  });

  // -------- text & location input
  bot.on('message:location', async (ctx) => {
    const d = getDraft(ctx);
    if (!d || !['gov', 'dist', 'place', 'details'].includes(d.step)) return;
    const { latitude: lat, longitude: lon } = ctx.message.location;
    if (!insideSyriaBox(lat, lon)) return ctx.reply(L(ctx).outside);
    d.location = locationFrom({ lat, lon });
    d.msgId = null;
    await afterLocation(ctx, d);
  });

  bot.on('message:text', async (ctx) => {
    const text = clean(ctx.message.text, 2000);
    if (text.startsWith('/')) return;
    const d = getDraft(ctx);
    if (!d) return home(ctx);
    const l = L(ctx);
    if (d.step === 'text') {
      if (text.length > 900) return ctx.reply(l.tooLong);
      d.text = text;
      if (d.location) return showPreview(ctx, d);
      return askLocation(ctx, d);
    }
    if (d.step === 'details') {
      if (text.length > 900) return ctx.reply(l.tooLong);
      d.details = text;
      return showPreview(ctx, d);
    }
    if (['gov', 'dist', 'place'].includes(d.step)) {
      const res = searchPlaces(text, 12);
      const lang = langOf(ctx);
      if (!res.length) return ctx.reply(l.searchNone(esc(text.slice(0, 40))), { parse_mode: 'HTML' });
      const kb = new InlineKeyboard();
      for (const p of res) {
        if (p.scope === 'governorate') kb.text(`📍 ${lang === 'en' ? p.en : p.ar}`, 'wg:' + p.gov).row();
        else {
          const dd = getDist(p.dist);
          const g = getGov(p.gov);
          kb.text(`${lang === 'en' ? p.en : p.ar} — ${lang === 'en' ? dd?.en || g?.en : dd?.ar || g?.ar}`.slice(0, 60), 'p:' + p.id).row();
        }
      }
      kb.text(l.btnBack, 'back:gov').text(l.btnCancel, 'cancel');
      return ctx.reply(l.searchResults(esc(text.slice(0, 40))), { parse_mode: 'HTML', reply_markup: kb });
    }
    if (d.step === 'preview') return showPreview(ctx, d);
  });

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) console.error('[bot] API error:', e.description);
    else if (e instanceof HttpError) console.error('[bot] network error:', e.message);
    else console.error('[bot] error:', e?.message || e);
  });

  // When alerts expire automatically, mark the channel post as ended.
  if (role === 'admin') store.on('expired', (a) => refreshChannelPost(bot.api, a, true));

  // Clean old pending reports
  setInterval(() => {
    for (const [k, r] of reports) if (Date.now() - r.created > 12 * 3600_000) reports.delete(k);
  }, 3600_000).unref();

  return bot;
}

// ---------------------------------------------------------------- backup adapter (pinned JSON in owner chat)

export function telegramBackupAdapter(api) {
  const owner = config.ownerIds[0];
  if (!owner) return null;
  let lastMsgId = null;
  const NAME = 'red-alert-syria-backup.json';
  return {
    async save(json) {
      const file = () => new InputFile(Buffer.from(json), NAME);
      const caption = '🗄 نسخة احتياطية تلقائية لبيانات Red Alert Syria — لا تحذفها ولا تلغِ تثبيتها.\nAutomatic backup — keep pinned.';
      if (lastMsgId) {
        try {
          await api.editMessageMedia(owner, lastMsgId, InputMediaBuilder.document(file(), { caption }));
          return;
        } catch (e) {
          if (/not modified/i.test(e.description || '')) return;
        }
      }
      const m = await api.sendDocument(owner, file(), { caption, disable_notification: true });
      try { await api.pinChatMessage(owner, m.message_id, { disable_notification: true }); } catch { /* ignore */ }
      if (lastMsgId) { try { await api.deleteMessage(owner, lastMsgId); } catch { /* ignore */ } }
      lastMsgId = m.message_id;
    },
    async load() {
      const chat = await api.getChat(owner);
      const pm = chat.pinned_message;
      if (!pm?.document || pm.document.file_name !== NAME) return null;
      lastMsgId = pm.message_id;
      const f = await api.getFile(pm.document.file_id);
      const res = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${f.file_path}`);
      if (!res.ok) return null;
      return await res.text();
    },
  };
}

export const BOT_COMMANDS = {
  ar: [
    { command: 'start', description: 'القائمة الرئيسية' },
    { command: 'active', description: 'التنبيهات النشطة' },
    { command: 'lang', description: 'English / العربية' },
    { command: 'id', description: 'معرّفي' },
    { command: 'help', description: 'المساعدة' },
  ],
  en: [
    { command: 'start', description: 'Main menu' },
    { command: 'active', description: 'Active alerts' },
    { command: 'lang', description: 'العربية / English' },
    { command: 'id', description: 'My ID' },
    { command: 'help', description: 'Help' },
  ],
};

export { TYPE_KEYS };
export const REPORT_COMMANDS = {
  ar: [
    { command: 'start', description: 'إرسال بلاغ جديد' },
    { command: 'lang', description: 'English / العربية' },
    { command: 'help', description: 'المساعدة' },
  ],
  en: [
    { command: 'start', description: 'Send a new report' },
    { command: 'lang', description: 'العربية / English' },
    { command: 'help', description: 'Help' },
  ],
};
