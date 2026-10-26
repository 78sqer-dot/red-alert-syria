import { installTracker, cleanChat, setKeep } from './ui-clean.js';
import { installResilience, isDefinitiveTelegramRejection } from './tg-net.js';
import { Bot, InlineKeyboard, InputFile, InputMediaBuilder, GrammyError, HttpError } from 'grammy';
import { config, isOwner, envDefaults, applyProject } from './config.js';
import { registerOwnerTools, registerReportOwnerCommands, runtimeHooks } from './owner-tools.js';
export { runtimeHooks };
import { store, publicAlert } from './store.js';
import { ALERT_TYPES, TYPE_KEYS, typeOf, alertEmoji, droneAuto } from '../shared/types.js';
import { T, TITLES, fmtDur } from './bot-texts.js';
import { collectStats, renderStatsPng, damascusParts } from './stats-image.js';
import { renderAlertPng } from './alert-image.js';
import { registerContactTools } from './contact-tools.js';
import { registerSupportTools } from './support-tools.js';
import { registerNewsTools, verifyReportSources } from './news-monitor.js';
import { ROAD_DURATIONS, roadLabel, addRoad, activeRoads, endRoad, roadWhere, postRoadToChannel, registerPowerTools } from './services.js';
import { registerPriceTools } from './prices.js';
import { registerQuakeTools } from './quakes.js';
import { registerWeatherTools } from './weather.js';
import { registerWxBulletinTools } from './wx-daily.js';
import { registerBorderTools } from './borders.js';
import { governorates, getGov, getDist, getSub, districtsOf, placesOf, subsOf, placesOfSub, searchPlaces, locationFrom, insideSyriaBox, centerOfDist, capitalOf, centerOfSub, centerSuggestions, getPlace } from './places.js';
// publishing bot: a custom name for the pinned spot ("مخيم الرسم الجديد") while the pin stays on the chosen centre
function withLabel(loc, label) {
  const base = loc.custom_label ? loc.base : { name_ar: loc.name_ar, name_en: loc.name_en, short_ar: loc.short_ar, short_en: loc.short_en };
  if (!label) return { ...loc, ...base, custom_label: undefined, base: undefined };
  return { ...loc, name_ar: label, name_en: label, short_ar: label, short_en: label, custom_label: true, base };
}
const centerBtn = (p, lang) => `📍 ${lang === 'en' ? 'Centre of' : 'مركز مدينة'} ${lang === 'en' ? p.en || p.ar : p.ar}`.slice(0, 60);
import { cleanAlertText } from './clean-text.js';

const PAGE = 24;
const SUB_MENU_MIN = 40; // districts with more towns than this get a ناحية (sub-district) step first
const DURATIONS = [15, 30, 60, 90, 120, 180, 360, 720];
const REPORT_COOLDOWN_MS = 2 * 60_000;

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clean = (s, max = 900) => String(s || '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const hashTag = (s) => '#' + String(s || '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');

const sessions = new Map(); // userId -> draft
// pending reports live in the store (store.reportPut/Take): they survive restarts and deploys
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
const typeLabel = (key, lang) => (key === 'road' ? (lang === 'en' ? '🛣 Road status' : '🛣 حالة طريق') : `${typeOf(key).emoji} ${lang === 'en' ? typeOf(key).en : typeOf(key).ar}`);
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
  let title = (TITLES[alert.type] || {}).ar || t.ar;
  if (alert.place?.head_ar) title = alert.place.head_ar;
  if (alert.type === 'quake') { const m = alert.meta?.mag ?? Number((String(alert.title || '').match(/([0-9]+(?:\.[0-9])?)/) || [])[1]); if (Number.isFinite(m)) title = `زلزال بقوة ${m.toFixed(1)}`; }
  const p = alert.place || {};
  const hasPlace = p.scope && p.scope !== 'country';
  const lines = [];
  lines.push(`${ended ? '✅ انتهى · ' : ''}<b>${esc(title)}</b> - ${alertEmoji(alert)}`, '');
  const desc = cleanAlertText(alert.description || '');
  if (alert.type === 'breaking') lines.push(`<b>${esc(desc || alert.title)}</b>`, '');
  if (hasPlace) for (const x of [p, ...(alert.extra || [])]) lines.push(`📍<b>${esc(locName(x, 'ar'))}</b>`);
  if (alert.type !== 'breaking' && desc) lines.push(`<blockquote>${esc(desc)}</blockquote>`);
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
  const lines = [`<b>${esc(d.type === 'road' ? roadLabel(d.road, lang) : typeLabel(d.type, lang))}</b>`];
  if (d.type === 'breaking') lines.push('', esc(d.text || ''));
  if (d.extra?.length) {
    lines.push('', `📍 <b>${lang === 'en' ? `Areas (${d.extra.length + 1})` : `المناطق (${d.extra.length + 1})`}:</b>`);
    for (const x of [loc, ...d.extra]) lines.push(`• ${esc(locName(x, lang))}`);
  } else lines.push('', `📍 <b>${l.locLabel}:</b> ${esc(loc ? locName(loc, lang) : (lang === 'en' ? 'Syria' : 'سوريا'))}`);
  if (d.type !== 'breaking' && d.details) lines.push(`📝 <b>${l.detailsLabel}:</b> ${esc(d.details)}`);
  lines.push(`⏱ <b>${l.durLabel}:</b> ${fmtDur(d.ttlMin, lang)}`);
  return lines.join('\n');
}

function reportReviewKeyboard(lang, rid) {
  const l = T[lang] || T.ar;
  const en = lang === 'en';
  return new InlineKeyboard()
    .text(l.btnApprove, 'rap:' + rid).row()
    .text(en ? '🔎 Verify from sources' : '🔎 تحقق من المصادر', 'rv:' + rid).row()
    .text(l.btnEditPublish, 'red:' + rid).row()
    .text(l.btnReject, 'rrj:' + rid).text(l.btnBan, 'rbn:' + rid);
}

function reportVerificationBlock(v, lang) {
  if (!v) return '';
  const en = lang === 'en';
  if (v.status === 'checking') return en
    ? '🔎 <b>Checking the enabled sources…</b>'
    : '🔎 <b>جارٍ فحص المصادر المفعّلة…</b>';
  const lines = [en
    ? '🔎 <b>Source check — not a final verdict</b>'
    : '🔎 <b>نتيجة فحص المصادر — ليست حكماً نهائياً</b>'];
  if (v.failed) {
    lines.push(en ? 'The source check could not be completed. Please try again.' : 'تعذّر إكمال فحص المصادر؛ جرّب مرة ثانية.');
  } else if (!v.totalSources) {
    lines.push(en ? 'No enabled sources were available to check.' : 'لا توجد مصادر مفعّلة للفحص حالياً.');
  } else {
    lines.push(en
      ? `Checked ${v.checkedSources} of ${v.totalSources} enabled sources.`
      : `تم فحص ${v.checkedSources} من ${v.totalSources} مصدر مفعّل.`);
  }
  if (v.matches?.length) {
    lines.push(en ? '<b>Potentially relevant coverage:</b>' : '<b>تغطية محتملة للخبر:</b>');
    for (const m of v.matches.slice(0, 5)) {
      const date = m.ts ? new Intl.DateTimeFormat(en ? 'en-GB' : 'ar-SY', { timeZone: config.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(m.ts)) : '';
      lines.push(`• <a href="${esc(m.url)}">${esc(m.name)}</a>${date ? ` · ${esc(date)}` : ''}`);
      if (m.excerpt) lines.push(`<blockquote>${esc(m.excerpt)}</blockquote>`);
    }
  } else if (v.totalSources && !v.checkedSources) {
    lines.push(en ? 'None of the enabled sources could be reached.' : 'تعذّر الوصول إلى أيٍّ من المصادر المفعّلة.');
  } else if (v.totalSources) {
    lines.push(en
      ? 'No clear matching coverage was found among the sources reached. This does <b>not</b> prove the report is false.'
      : 'لم يظهر تطابق واضح في المصادر التي أمكن الوصول إليها؛ وهذا <b>لا يثبت</b> أن البلاغ غير صحيح.');
  }
  if (v.errors?.length) {
    const names = v.errors.slice(0, 4).map(esc).join('، ');
    lines.push(en
      ? `Could not read ${v.errors.length} source(s)${names ? `: ${names}` : ''}.`
      : `تعذّر الوصول إلى ${v.errors.length} مصدر${names ? `: ${names}` : ''}.`);
  }
  lines.push(en
    ? '<i>Source posts are supporting leads, not independent proof; review the links before deciding.</i>'
    : '<i>المنشورات قرائن للمراجعة وليست إثباتاً مستقلاً؛ افتح الروابط قبل اتخاذ القرار.</i>');
  return lines.join('\n');
}

function reportCardText(rep, lang) {
  const hint = lang === 'en' ? '<i>↩️ Reply to this message to talk to the reporter.</i>' : '<i>↩️ لمراسلة صاحب البلاغ: اعمل «رد» على هذه الرسالة واكتب.</i>';
  return [T[lang].reportNew(who(rep.from)), draftSummary(rep.draft, lang), reportVerificationBlock(rep.verification, lang), hint].filter(Boolean).join('\n\n');
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
    .text(`${e('explosion')} ${b('explosion')}`, 't:explosion').text(`${e('missile')} ${b('missile')}`, 't:missile').row()
    .text(`${e('civil')} ${b('civil')}`, 'cv').row()
    .text(lang === 'en' ? '🛣 Road status' : '🛣 حالة طريق', 'rd');
  if (staff(ctx)) kb.text(lang === 'en' ? '🛂 Border crossings' : '🛂 المعابر', 'bd').row();
  else kb.url(lang === 'en' ? '🛂 Border crossings' : '🛂 حالة المعابر', `${(config.publicUrl || 'https://red-alert-syria.onrender.com').replace(/\/$/, '')}/${lang === 'en' ? 'en' : 'ar'}/#borders`).row();
  if (staff(ctx)) kb.text(l.btnActive, 'active').text(l.btnClear, 'clr').row().text(l.btnLang, 'lang').row();
  else kb.text(l.btnLang, 'lang').row();
  if (owner(ctx)) kb.text(l.btnEditors, 'editors').text(l.btnStats, 'stats').row().text(l.btnAuto(store.autoDeleteHours), 'auto').text(lang === 'en' ? '🔁 Project hand-over' : '🔁 نقل المشروع', 'xf').row().text(lang === 'en' ? '📞 Contact links' : '📞 روابط التواصل', 'ct').text(lang === 'en' ? '💝 Website support' : '💝 الدعم في الموقع', 'sp').row().text(lang === 'en' ? '📡 News monitor' : '📡 الرصد الإخباري', 'nws').row()
    .text(lang === 'en' ? '💱 Prices bulletin' : '💱 نشرة الأسعار', 'px').text(lang === 'en' ? '⚡ Electricity' : '⚡ الكهرباء', 'pwr').row()
    .text(lang === 'en' ? '🌍 Earthquakes' : '🌍 الزلازل', 'qk').text(lang === 'en' ? '⛈ Weather warnings' : '⛈ تحذيرات الطقس', 'wx').row()
    .text(lang === 'en' ? '🌤 Weather bulletin' : '🌤 نشرة الطقس', 'wxb').row();
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
  if (d.adding) return kb.text(langOf(ctx) === 'en' ? '↩️ Back to preview' : '↩️ رجوع للمعاينة', 'addback');
  if (d.type === 'breaking') kb.text(l.btnNoLocation, 'noloc').row();
  kb.text(l.btnCancel, 'cancel');
  return kb;
}

function distKeyboard(ctx, gov) {
  const l = L(ctx);
  const lang = langOf(ctx);
  const g = getGov(gov);
  const kb = new InlineKeyboard().text(l.btnWholeGov(lang === 'en' ? g.en : g.ar), 'wg:' + gov).row();
  const cap = staff(ctx) && gov !== '08' && capitalOf(gov);
  if (cap) kb.text(centerBtn(cap, lang), 'p:' + cap.id).row();
  districtsOf(gov).forEach((d, i) => {
    kb.text(lang === 'en' ? d.en : d.ar, 'd:' + d.code);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text(l.btnBack, 'back:gov').text(l.btnCancel, 'cancel');
  return kb;
}

// sub-districts (نواحي) of a big district: keeps every village a couple of taps away instead of 20 pages
const useSubs = (dist) => placesOf(dist).length > SUB_MENU_MIN && subsOf(dist).length > 1;
function subKeyboard(ctx, dist) {
  const l = L(ctx);
  const lang = langOf(ctx);
  const d = getDist(dist);
  const kb = new InlineKeyboard().text(l.btnWholeDist(lang === 'en' ? d.en : d.ar), 'wd:' + dist).row();
  const c0 = staff(ctx) && centerOfDist(dist);
  if (c0) kb.text(centerBtn(c0, lang), 'p:' + c0.id).row();
  subsOf(dist).forEach((x, i) => {
    kb.text((lang === 'en' ? x.en : x.ar).slice(0, 30), `s:${dist}:${x.code}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text(l.btnBack, 'back:dist').text(l.btnCancel, 'cancel');
  return kb;
}
// long lists (> 3 pages) start with an A-Z / ا-ي index: first letter of the name without "ال"
const LETTER_MIN = PAGE * 3;
const firstLetter = (p, lang) => {
  if (lang === 'en') return ((p.en || '').replace(/^(al|el|as|ad|ar|at|az|ash|an)[-\s]/i, '').match(/[a-z]/i)?.[0] || '#').toUpperCase();
  const n = (p.ar || '').replace(/[\u064B-\u065F\u0670\u0640(]/g, '').replace(/^ال(?=\S{2})/, '');
  return ({ 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ؤ': 'و', 'ئ': 'ي', 'ى': 'ي', 'ة': 'ه', 'چ': 'ج', 'ڤ': 'ف', 'گ': 'ك', 'پ': 'ب', 'ک': 'ك', 'ی': 'ي' })[n[0]] || n[0] || '#';
};
function letterKeyboard(ctx, dist, sub, all) {
  const l = L(ctx);
  const lang = langOf(ctx);
  const d = getDist(dist);
  const n = new Map();
  for (const p of all) { const c = firstLetter(p, lang); n.set(c, (n.get(c) || 0) + 1); }
  const letters = [...n.keys()].sort((a, b) => a.localeCompare(b, lang === 'en' ? 'en' : 'ar'));
  const kb = new InlineKeyboard().text(l.btnWholeDist(lang === 'en' ? d.en : d.ar), 'wd:' + dist).row();
  const c1 = staff(ctx) && (sub ? centerOfSub(dist, sub) : centerOfDist(dist));
  if (c1) kb.text(centerBtn(c1, lang), 'p:' + c1.id).row();
  // the big towns of the area stay one tap away
  all.filter((p) => p.rank <= 4).slice(0, 9).forEach((p, i) => {
    kb.text((lang === 'en' ? p.en || p.ar : p.ar).slice(0, 28), 'p:' + p.id);
    if (i % 3 === 2) kb.row();
  });
  kb.row();
  letters.forEach((c, i) => {
    kb.text(`${c} (${n.get(c)})`, `lt:${dist}:${sub || 0}:${encodeURIComponent(c)}:0`);
    if (i % 5 === 4) kb.row();
  });
  kb.row().text(l.btnBack, sub ? 'back:sub' : 'back:dist').text(l.btnCancel, 'cancel');
  return kb;
}
function placeKeyboard(ctx, dist, page, sub = '', letter = '') {
  const l = L(ctx);
  const lang = langOf(ctx);
  const d = getDist(dist);
  let all = sub ? placesOfSub(dist, sub) : placesOf(dist);
  if (!letter && all.length > LETTER_MIN) return { kb: letterKeyboard(ctx, dist, sub, all), page: 0, pages: 0, letters: true };
  if (letter) all = all.filter((p) => firstLetter(p, lang) === letter).sort((a, b) => a.ar.localeCompare(b.ar, 'ar'));
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  page = Math.min(Math.max(0, page), pages - 1);
  const kb = new InlineKeyboard().text(l.btnWholeDist(lang === 'en' ? d.en : d.ar), 'wd:' + dist).row();
  const c2 = staff(ctx) && !page && !letter && (sub ? centerOfSub(dist, sub) : centerOfDist(dist));
  if (c2) kb.text(centerBtn(c2, lang), 'p:' + c2.id).row();
  all.slice(page * PAGE, page * PAGE + PAGE).forEach((p, i) => {
    kb.text((lang === 'en' ? p.en || p.ar : p.ar).slice(0, 28), 'p:' + p.id);
    if (i % 3 === 2) kb.row();
  });
  kb.row();
  if (pages > 1) {
    const pg = (n) => (letter ? `lt:${dist}:${sub || 0}:${encodeURIComponent(letter)}:${n}` : sub ? `pg:${dist}:${sub}:${n}` : `pg:${dist}:${n}`);
    if (page > 0) kb.text(l.btnPrev, pg(page - 1));
    if (page < pages - 1) kb.text(l.btnNext, pg(page + 1));
    kb.row();
  }
  kb.text(l.btnBack, letter ? `lt:${dist}:${sub || 0}` : sub ? 'back:sub' : 'back:dist').text(l.btnCancel, 'cancel');
  return { kb, page: page + 1, pages };
}
function previewKeyboard(ctx, d) {
  const l = L(ctx);
  const kb = new InlineKeyboard();
  const enx = langOf(ctx) === 'en';
  if (d.mode === 'report') kb.text(l.btnSubmit, 'submit').row();
  else if (d.type === 'road') kb.text(enx ? '🗺 Publish on the map' : '🗺 نشر على الخريطة', 'publish').row().text(enx ? '📢 Map + channel' : '📢 الخريطة + القناة', 'publish:ch').row();
  else kb.text(l.btnPublish, 'publish').row();
  kb.text(l.btnDuration(d.ttlMin), 'dur').row();
  // drones: "تحليق مكثف" = 2-3 drones over every circle on the map instead of one
  if (d.type === 'uav' && d.mode !== 'report') {
    const on = typeof d.intense === 'boolean' ? d.intense : droneAuto(d.details) > 1;
    kb.text(enx ? `🛸 Intensive flight: ${on ? '✅ on' : '⬜ off'}` : `🛸 تحليق مكثف: ${on ? '✅ مفعّل' : '⬜ لا'}`, 'intense').row();
  }
  kb.text(l.btnEditDetails, 'editdetails').text(l.btnChangeLoc, 'back:gov').row();
  // publishing bot only: one alert can cover several areas, each with its own circle on the map
  if (d.mode !== 'report' && d.location && d.location.scope !== 'country') {
    const en = langOf(ctx) === 'en';
    kb.text(en ? (d.location.custom_label ? '🏷 Edit place name' : '🏷 Custom place name') : (d.location.custom_label ? '🏷 تعديل اسم المكان' : '🏷 اسم مخصص للمكان'), 'lbl').row();
    kb.text(en ? '➕ Add another area' : '➕ إضافة منطقة أخرى', 'addloc');
    if (d.extra?.length) kb.text(en ? '➖ Remove an area' : '➖ حذف منطقة', 'rmloc');
    kb.row();
  }
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
    extra: [], // further areas of the same alert (publishing bot)
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
  const en = langOf(ctx) === 'en';
  const head = d.adding ? (en ? `➕ <b>Add another area</b> (${(d.extra?.length || 0) + 1} selected so far)\n\n` : `➕ <b>إضافة منطقة أخرى</b> (المحدد حتى الآن: ${(d.extra?.length || 0) + 1})\n\n`) : '';
  await show(ctx, head + L(ctx).askGov(`<b>${esc(typeLabel(d.type, langOf(ctx)))}</b>`), govKeyboard(ctx, d));
}
const locKey = (x) => (x ? `${x.scope}:${x.place_id || x.district || x.governorate || ''}:${Number(x.latitude).toFixed(3)},${Number(x.longitude).toFixed(3)}` : '');
// a picked location: either the alert's (first) area, or one more area added from the preview
async function pickLocation(ctx, d, loc) {
  if (!loc) return;
  if (d.adding) {
    d.adding = false;
    if (!Array.isArray(d.extra)) d.extra = [];
    const k = locKey(loc);
    if (loc.scope !== 'country' && k !== locKey(d.location) && !d.extra.some((x) => locKey(x) === k) && d.extra.length < 19) d.extra.push(loc);
    return showPreview(ctx, d);
  }
  d.location = loc;
  if (loc.scope === 'country') d.extra = [];
  return afterLocation(ctx, d);
}

async function afterLocation(ctx, d) {
  if (d.type === 'breaking' || d.details) return showPreview(ctx, d);
  d.step = 'details';
  if (d.type === 'road') {
    const en = langOf(ctx) === 'en';
    const kb0 = new InlineKeyboard().text(L(ctx).btnSkip, 'skip').row().text(L(ctx).btnBack, 'back:gov').text(L(ctx).btnCancel, 'cancel');
    return show(ctx, en ? `<b>${esc(roadLabel(d.road, 'en'))}</b> — ${esc(locName(d.location, 'en'))}\n\n📝 Write a short description, e.g. <i>closed at the bridge entrance because of …</i>, or skip.` : `<b>${esc(roadLabel(d.road, 'ar'))}</b> — ${esc(locName(d.location, 'ar'))}\n\n📝 اكتب وصف مختصر، مثلاً: <i>مسكّر عند مدخل الجسر بسبب …</i> أو <i>في حاجز تفتيش وازدحام</i>، أو اضغط «تخطي».`, kb0);
  }
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
  const wxNames = { rain: ['أمطار غزيرة', 'Heavy rain'], snow: ['ثلوج', 'Snow'], wind: ['رياح قوية', 'Strong winds'], storm: ['عواصف رعدية', 'Thunderstorms'], heat: ['موجة حر', 'Heatwave'], frost: ['صقيع', 'Frost'], dust: ['غبار', 'Dust'] };
  const wx = d.type === 'weather' ? wxNames[d.meta?.hazard] : null;
  const named = loc.scope !== 'country';
  const areas = [];
  if (named) {
    if (loc.name_ar) areas.push(loc.name_ar);
    if (loc.district_ar && loc.district_ar !== loc.name_ar) areas.push(loc.district_ar);
    if (loc.governorate_ar && !areas.includes(loc.governorate_ar)) areas.push(loc.governorate_ar);
  }
  const extra = named && Array.isArray(d.extra) ? d.extra.filter((x) => x && x.scope !== 'country') : [];
  for (const x of extra) if (x.name_ar && !areas.includes(x.name_ar)) areas.push(x.name_ar);
  const more = (n, en) => (!n ? '' : en ? ` +${n} more` : n === 1 ? ' ومنطقة أخرى' : n === 2 ? ' ومنطقتان أخريان' : n <= 10 ? ` و${n} مناطق أخرى` : ` و${n} منطقة أخرى`);
  return {
    type: d.type,
    title: wx ? `${titles.ar}: ${wx[0]}${named ? ` — ${loc.name_ar}` : ''}` : named ? `${titles.ar} — ${loc.name_ar}${more(extra.length)}` : titles.ar,
    title_en: wx ? `${titles.en}: ${wx[1]}${named ? ` — ${loc.name_en}` : ''}` : named ? `${titles.en} — ${loc.name_en}${more(extra.length, true)}` : titles.en,
    extra,
    description: cleanAlertText(d.type === 'breaking' ? d.text : d.details),
    location: loc,
    areas,
    ttlMin: d.ttlMin,
    source: d.source === 'news' ? 'news' : 'telegram',
    author,
    ...(d.type === 'uav' && typeof d.intense === 'boolean' ? { meta: { intense: d.intense } } : {}),
    ...(d.type === 'weather' && d.meta?.hazard ? { meta: { hazard: d.meta.hazard } } : {}),
  };
}

// ---- channel post as a map image (like redalert.com.lb): photo + the usual text as caption + buttons.
// Falls back to plain text when image generation fails or Telegram explicitly rejects the photo.
// Never send a second post when photo delivery is ambiguous (network/5xx), as Telegram may have accepted it.
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
/**
 * Change the type of already-published alerts (owner request): map + stored alert + statistics log,
 * and EDIT (never delete/repost) the existing channel post: new title/emoji, new map image, same buttons.
 */
export async function retypeAlerts(api, ids, type, { gapMs = 4000 } = {}) {
  const out = [];
  const nt = TITLES[type];
  if (!nt) return [{ ok: false, why: 'unknown type ' + type }];
  for (const id of ids) {
    const a = store.getAlert(id);
    if (!a) { out.push({ id, ok: false, why: 'alert not found' }); continue; }
    const ot = TITLES[a.type];
    const patch = { type };
    if (ot && a.type !== type) {
      if (typeof a.title === 'string' && a.title.startsWith(ot.ar)) patch.title = nt.ar + a.title.slice(ot.ar.length);
      if (typeof a.title_en === 'string' && a.title_en.startsWith(ot.en)) patch.title_en = nt.en + a.title_en.slice(ot.en.length);
    }
    store.updateAlert(id, patch); // live map update
    store._logPatch(id, { ty: type }); // statistics / area pages
    store.persist();
    const b = store.getAlert(id);
    if (!b.channel_message_id || !api || !config.channel) { out.push({ id, ok: true, post: null }); continue; }
    const opts = { ended: !b.is_active };
    try {
      if (b.channel_media === 'photo') {
        const png = await withDeadline(alertImage(b, 'ar'), 30000);
        await api.editMessageMedia(config.channel, b.channel_message_id,
          InputMediaBuilder.photo(new InputFile(png, `red-alert-syria-${b.id.slice(0, 8)}.png`), { caption: channelCaption(b, opts), parse_mode: 'HTML' }),
          { reply_markup: channelKeyboard(b) });
      } else {
        await api.editMessageText(config.channel, b.channel_message_id, channelPost(b, opts), { parse_mode: 'HTML', reply_markup: channelKeyboard(b), link_preview_options: { is_disabled: true } });
      }
      out.push({ id, ok: true, post: b.channel_message_id });
    } catch (e) {
      const msg = String(e.description || e.message || e);
      const soft = /not modified|not found|message to edit/i.test(msg);
      out.push({ id, ok: soft, post: b.channel_message_id, why: msg });
      console.error(`[retype] channel edit ${b.channel_message_id}: ${msg}`);
    }
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return out;
}
export async function alertImage(alert, lang = 'ar') {
  const p = alert.place || {};
  const n = (alert.extra || []).length;
  const en = lang === 'en';
  const short = en ? p.short_en : p.short_ar;
  const placeLabel = short ? short : alert.scope === 'country' || !p.name_ar ? undefined
    : !n ? locName(p, lang)
    : `${en ? p.name_en || p.name_ar : p.name_ar}${en ? ` +${n} more` : n === 1 ? ' ومنطقة أخرى' : n === 2 ? ' ومنطقتان أخريان' : n <= 10 ? ` و${n} مناطق أخرى` : ` و${n} منطقة أخرى`}`;
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
  if (d.type === 'road') {
    const r = addRoad(d, author);
    if (d.toChannel) { try { await postRoadToChannel(api, r); } catch (e) { console.error('[road] channel post failed:', e.description || e.message); } }
    return r;
  }
  return publishInput(api, buildAlertInput(d, author));
}
/** add an alert to the map and (unless toChannel=false) post it to the channel */
export async function publishInput(api, input, { toChannel = true } = {}) {
  const alert = store.addAlert(input);
  if (input.meta) alert.meta = input.meta;
  if (!toChannel || !config.channel) return alert;
  const text = channelPost(alert);
  const extra = { parse_mode: 'HTML', reply_markup: channelKeyboard(alert) };
  let m = null; let media = 'text'; let uncertainPhotoSend = false;
  if (config.alertImages && visibleLen(text) <= CAPTION_MAX) {
    const t0 = Date.now();
    try {
      const png = await withDeadline(alertImage(alert, 'ar'), IMAGE_DEADLINE_MS);
      try {
        m = await api.sendPhoto(config.channel, new InputFile(png, `red-alert-syria-${alert.id.slice(0, 8)}.png`), { caption: text, ...extra });
        media = 'photo';
        console.log(`[img] channel image sent in ${Date.now() - t0} ms (${Math.round(png.length / 1024)} KB)`);
      } catch (e) {
        uncertainPhotoSend = !isDefinitiveTelegramRejection(e);
        console.error(`[img] channel image post failed after ${Date.now() - t0} ms:`, e.description || e.message);
      }
    } catch (e) {
      console.error(`[img] image generation failed after ${Date.now() - t0} ms:`, e.description || e.message);
    }
  }
  if (!m && !uncertainPhotoSend) {
    try {
      m = await api.sendMessage(config.channel, text, { ...extra, link_preview_options: { is_disabled: true } });
    } catch (e) {
      console.error('[bot] channel post failed:', e.description || e.message);
    }
  } else if (!m) {
    console.warn('[bot] photo delivery is uncertain; skipping text fallback to prevent a duplicate channel post');
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
  kb.row().text(l.btnEnd, 'end:' + alert.id);
  if (alert.expires_at) kb.text(l.btnExtend, 'ext:' + alert.id);
  kb.row().text(l.btnDelete, 'del:' + alert.id).row().text(l.btnHome, 'home');
  return kb;
}

/** remove an alert from the map and its post from the channel (weather / quake undo) */
export async function deleteAlertEverywhere(api, id) {
  const removed = store.deleteAlert(id);
  if (removed?.channel_message_id && api) { try { await api.deleteMessage(config.channel, removed.channel_message_id); } catch (e) { console.error('[bot] delete failed', e.description || e.message); } }
  return removed;
}
export async function refreshChannelPost(api, alert, ended) {
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
runtimeHooks.restoreApi = (role, old) => { APIS[role] = old.api; TOKENS[role] = old.token; };
const RELAY_KINDS = { photo: 'sendPhoto', video: 'sendVideo', voice: 'sendVoice', audio: 'sendAudio', document: 'sendDocument', animation: 'sendAnimation', video_note: 'sendVideoNote', sticker: 'sendSticker' };
const relayRate = new Map();
async function relayCopy(fromApi, fromToken, toApi, chatId, msg, header, footer) {
  const kind = Object.keys(RELAY_KINDS).find((k) => msg[k]);
  const body = msg.text || msg.caption || '';
  const txt = `${header}${body ? `\n\n${esc(body)}` : ''}${footer ? `\n\n${footer}` : ''}`;
  if (!kind) return toApi.sendMessage(chatId, txt.slice(0, 4096), { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, _keep: 'r' });
  const fileId = kind === 'photo' ? msg.photo[msg.photo.length - 1].file_id : msg[kind].file_id;
  const f = await fromApi.getFile(fileId);
  const res = await fetch(`https://api.telegram.org/file/bot${fromToken}/${f.file_path}`);
  if (!res.ok) throw new Error('file download failed');
  const file = new InputFile(Buffer.from(await res.arrayBuffer()), msg.document?.file_name || f.file_path.split('/').pop());
  if (kind === 'video_note' || kind === 'sticker') {
    await toApi[RELAY_KINDS[kind]](chatId, file, { _keep: 'r' });
    return toApi.sendMessage(chatId, txt.slice(0, 4096), { parse_mode: 'HTML', _keep: 'r' });
  }
  return toApi[RELAY_KINDS[kind]](chatId, file, { caption: txt.slice(0, 1024), parse_mode: 'HTML', _keep: 'r' });
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
export function startDailySummary(api0) {
  if (!api0 || !config.channel) return;
  // always the current publishing bot (it can be switched at runtime from 🔁 Project hand-over)
  const apiNow = () => APIS.admin || api0;
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
      await apiNow().sendPhoto(config.channel, new InputFile(renderStatsPng(st, 'ar'), `red-alert-syria-${p.date}.png`), { caption: dailyCaption(st), parse_mode: 'HTML', reply_markup: kb });
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
      await apiNow().sendPhoto(config.channel, new InputFile(renderStatsPng(st, 'ar'), `red-alert-syria-week-${p.date}.png`), { caption: weeklyCaption(st), parse_mode: 'HTML', reply_markup: kb });
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

// shared helpers for owner-tools (editors + project hand-over)
const OH = {
  show: (ctx, text, kb) => show(ctx, text, kb),
  langOf: (ctx) => langOf(ctx),
  L: (ctx) => L(ctx),
  owner: (ctx) => owner(ctx),
  staff: (ctx) => staff(ctx),
  isOwnerId: (id) => isOwner(id),
  botInfo,
  apis: () => APIS,
  mainKeyboard: (ctx) => mainKeyboard(ctx),
  dropSessions: (id) => { sessions.delete(`admin:${id}`); },
  resync: () => resyncChannelPosts(APIS.admin).catch(() => {}),
  sendTransient: (api, chat, text, o) => sendTransient(api, chat, text, o),
  publishDraft: (api, d, author) => publishDraft(api, d, author),
  mapUrl: (id, lang) => mapUrl(id, lang),
  // open a ready draft (news monitor "✏️ edit first") in this user's normal publishing preview
  loadDraft: (ctx, d) => { const x = { ...d, mode: 'publish', created: Date.now(), msgId: null }; sessions.set(sk(ctx), x); return showPreview(ctx, x); },
};
export function createBot({ role = 'admin', token = config.botToken, reviewApi = null } = {}) {
  if (!token) return null;
  const bot = new Bot(token);
  installResilience(bot.api, role); // first = closest to the network: short deadlines + retries
  APIS[role] = bot.api; TOKENS[role] = token;
  installTracker(bot.api, role); // records every message the bot sends (clean chats)
  // A tap that reaches us late ("query is too old" after a slow start/network) must still do its
  // job: only the little button spinner is lost, never the action itself.
  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method !== 'answerCallbackQuery') return prev(method, payload, signal);
    let res;
    try { res = await prev(method, payload, signal); } catch (e) { res = { ok: false, description: e.description || e.message }; }
    if (res && res.ok === false) { console.warn('[bot] answerCallbackQuery ignored:', res.description); return { ok: true, result: true }; }
    return res;
  });
  bot.use(cleanChat(role)); // after each tap/message: only the current screen stays
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
      return ctx.reply(l.privateBot(botInfo.report || 'Red_Alert_Syria') + '\n\n' + l.yourId(ctx.from.id), { parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } });
    }
    await next();
  });
  if (role === 'admin') { registerOwnerTools(bot, OH); registerContactTools(bot, OH); registerSupportTools(bot, OH); registerNewsTools(bot, OH); registerPriceTools(bot, OH); registerQuakeTools(bot, OH); registerWeatherTools(bot, OH); registerWxBulletinTools(bot, OH); registerBorderTools(bot, OH); registerPowerTools(bot, OH); } else registerReportOwnerCommands(bot, OH);
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
        ctx.ras.keepInput = true;
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
      if (ok) { store.convoAdd('report', ctx.chat.id, msg.message_id); ctx.ras.keepInput = true; } // reporter's own message
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
  // 🛣 road status: staff publish straight to the map layer, the public report bot sends it to review
  const roadMenu = async (ctx) => {
    const en = langOf(ctx) === 'en';
    const kb = new InlineKeyboard()
      .text(roadLabel('closed', langOf(ctx)), 'rd:closed').text(roadLabel('danger', langOf(ctx)), 'rd:danger').row()
      .text(roadLabel('open', langOf(ctx)), 'rd:open').row();
    const live = staff(ctx) ? activeRoads() : [];
    if (live.length) kb.text(en ? `📋 Active road statuses (${live.length})` : `📋 حالات الطرق الفعالة (${live.length})`, 'rdl').row();
    kb.text(L(ctx).btnBack, 'home');
    await show(ctx, en
      ? '🛣 <b>Road status</b>\n\nWhat is the road like? Then pick the place (you can add more places along the road).\nIt shows on the map\'s roads layer and disappears by itself when its time ends.'
      : '🛣 <b>حالة طريق</b>\n\nشو وضع الطريق؟ بعدها اختار المكان (فيك تضيف أكتر من مكان على نفس الطريق).\nبتظهر على طبقة الطرق بالخريطة وبتنشال لحالها لما تخلص مدتها.', kb);
  };
  bot.callbackQuery('rd', async (ctx) => { await ctx.answerCallbackQuery(); await roadMenu(ctx); });
  bot.callbackQuery(/^rd:(closed|danger|open)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!staff(ctx)) {
      if (store.isBanned(ctx.from.id)) return show(ctx, L(ctx).banned, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
      if (Date.now() - (lastReport.get(ctx.from.id) || 0) < REPORT_COOLDOWN_MS) return show(ctx, L(ctx).reportRate, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
    }
    const d = newDraft(ctx, 'road');
    d.road = ctx.match[1];
    d.ttlMin = d.road === 'open' ? 180 : 360;
    await askLocation(ctx, d);
  });
  bot.callbackQuery('rdl', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!staff(ctx)) return;
    const en = langOf(ctx) === 'en';
    const kb = new InlineKeyboard();
    for (const r of activeRoads().slice(0, 20)) kb.text(`🏁 ${roadLabel(r.status, langOf(ctx)).split(' ')[0]} ${roadWhere(r, langOf(ctx))}`.slice(0, 60), 'rdx:' + r.id).row();
    kb.text(L(ctx).btnBack, 'rd');
    await show(ctx, en ? '📋 <b>Active road statuses</b>\n\nTap one to end it now (it leaves the map).' : '📋 <b>حالات الطرق الفعالة</b>\n\nاضغط على أي وحدة لتنهيها هلق (بتنشال من الخريطة).', kb);
  });
  bot.callbackQuery(/^rdx:(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return ctx.answerCallbackQuery();
    const ok = endRoad(ctx.match[1]);
    await ctx.answerCallbackQuery(ok ? (langOf(ctx) === 'en' ? '🏁 Ended' : '🏁 انتهت وانشالت من الخريطة') : (langOf(ctx) === 'en' ? 'Already ended' : 'منتهية مسبقاً'));
    if (activeRoads().length) {
      ctx.callbackQuery.data = 'rdl';
      const en = langOf(ctx) === 'en';
      const kb = new InlineKeyboard();
      for (const r of activeRoads().slice(0, 20)) kb.text(`🏁 ${roadLabel(r.status, langOf(ctx)).split(' ')[0]} ${roadWhere(r, langOf(ctx))}`.slice(0, 60), 'rdx:' + r.id).row();
      kb.text(L(ctx).btnBack, 'rd');
      return show(ctx, en ? '📋 <b>Active road statuses</b>\n\nTap one to end it now.' : '📋 <b>حالات الطرق الفعالة</b>\n\nاضغط على أي وحدة لتنهيها هلق.', kb);
    }
    return roadMenu(ctx);
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
  bot.callbackQuery(/^wg:(\d+)$/, needDraft((ctx, d) => pickLocation(ctx, d, locationFrom({ govCode: ctx.match[1] }))));
  const showPlaces = async (ctx, d, dist, page, sub = '', letter = '') => {
    d.dist = dist; d.sub = sub; d.step = 'place';
    const lang = langOf(ctx);
    const { kb, page: p, pages, letters } = placeKeyboard(ctx, dist, page, sub, letter);
    const dd = getDist(dist);
    const ss = sub && getSub(sub);
    const where = (lang === 'en' ? dd.en : dd.ar) + (ss ? ' › ' + (lang === 'en' ? ss.en : ss.ar) : '') + (letter ? ` › ${letter}` : '');
    const head = `<b>${esc(typeLabel(d.type, lang))}</b>`;
    await show(ctx, letters ? L(ctx).askLetter(head, esc(where)) : L(ctx).askPlace(head, esc(where), p, pages), kb);
  };
  const showSubs = async (ctx, d, dist) => {
    d.dist = dist; d.sub = ''; d.step = 'place';
    const lang = langOf(ctx);
    const dd = getDist(dist);
    await show(ctx, L(ctx).askSub(`<b>${esc(typeLabel(d.type, lang))}</b>`, esc(lang === 'en' ? dd.en : dd.ar)), subKeyboard(ctx, dist));
  };
  bot.callbackQuery(/^d:(\d+)$/, needDraft((ctx, d) => (!getDist(ctx.match[1]) ? null : useSubs(ctx.match[1]) ? showSubs(ctx, d, ctx.match[1]) : showPlaces(ctx, d, ctx.match[1], 0))));
  bot.callbackQuery(/^s:(\d+):(\d+)$/, needDraft((ctx, d) => (getDist(ctx.match[1]) && getSub(ctx.match[2]) ? showPlaces(ctx, d, ctx.match[1], 0, ctx.match[2]) : null)));
  bot.callbackQuery(/^pg:(\d+):(\d+)$/, needDraft((ctx, d) => showPlaces(ctx, d, ctx.match[1], Number(ctx.match[2]))));
  bot.callbackQuery(/^lt:(\d+):(\d+)(?::([^:]+):(\d+))?$/, needDraft((ctx, d) => {
    const [, dist, sub, letter, page] = ctx.match;
    if (!getDist(dist)) return null;
    let c = '';
    try { c = letter ? decodeURIComponent(letter) : ''; } catch { c = ''; }
    return showPlaces(ctx, d, dist, Number(page) || 0, sub === '0' ? '' : sub, c);
  }));
  bot.callbackQuery(/^pg:(\d+):(\d+):(\d+)$/, needDraft((ctx, d) => showPlaces(ctx, d, ctx.match[1], Number(ctx.match[3]), ctx.match[2])));
  bot.callbackQuery(/^wd:(\d+)$/, needDraft((ctx, d) => pickLocation(ctx, d, locationFrom({ distCode: ctx.match[1] }))));
  bot.callbackQuery(/^p:(\d+)$/, needDraft((ctx, d) => pickLocation(ctx, d, locationFrom({ placeId: Number(ctx.match[1]) }))));
  // nothing found by name -> pin on a nearby centre and keep the typed name ("مخيم الرسم الجديد")
  bot.callbackQuery(/^pl:(\d+)$/, needDraft((ctx, d) => {
    if (d.mode === 'report' || !getPlace(ctx.match[1])) return null;
    const loc = locationFrom({ placeId: Number(ctx.match[1]) });
    return pickLocation(ctx, d, d.labelQ ? withLabel(loc, d.labelQ) : loc);
  }));
  bot.callbackQuery('lbl', needDraft(async (ctx, d) => {
    if (d.mode === 'report' || !d.location || d.location.scope === 'country') return;
    d.step = 'label';
    const en = langOf(ctx) === 'en';
    const kb = new InlineKeyboard();
    if (d.location.custom_label) kb.text(en ? '↩️ Use the original name' : '↩️ الرجوع للاسم الأصلي', 'lblx').row();
    kb.text(L(ctx).btnBack, 'lblb');
    const at = esc(d.location.custom_label ? d.location.base?.name_ar || '' : d.location.name_ar || '');
    await show(ctx, en ? `🏷 Send the name to show for this spot (e.g. <i>New Al-Rasm camp</i>).\nThe pin stays on <b>${at}</b>.` : `🏷 اكتب الاسم الذي سيظهر في الخبر لهذا الموقع (مثلاً: <i>مخيم الرسم الجديد</i>).\nيبقى الدبوس على <b>${at}</b>.`, kb);
  }));
  bot.callbackQuery('lblx', needDraft((ctx, d) => { if (d.location) d.location = withLabel(d.location, ''); return showPreview(ctx, d); }));
  bot.callbackQuery('lblb', needDraft((ctx, d) => showPreview(ctx, d)));
  bot.callbackQuery('noloc', needDraft(async (ctx, d) => {
    if (d.adding) { d.adding = false; return showPreview(ctx, d); }
    d.location = locationFrom({});
    d.extra = [];
    await showPreview(ctx, d);
  }));
  // ---- several areas for one alert (publishing bot only)
  bot.callbackQuery('addloc', needDraft(async (ctx, d) => {
    if (!staff(ctx) || d.mode === 'report' || !d.location || d.location.scope === 'country') return showPreview(ctx, d);
    if ((d.extra?.length || 0) >= 19) return showPreview(ctx, d);
    d.adding = true;
    return askLocation(ctx, d);
  }));
  bot.callbackQuery('addback', needDraft((ctx, d) => { d.adding = false; return showPreview(ctx, d); }));
  bot.callbackQuery('rmloc', needDraft(async (ctx, d) => {
    if (!d.extra?.length) return showPreview(ctx, d);
    const lang = langOf(ctx);
    const kb = new InlineKeyboard();
    [d.location, ...d.extra].forEach((x, i) => kb.text(`🗑 ${locName(x, lang)}`.slice(0, 60), 'rml:' + i).row());
    kb.text(L(ctx).btnBack, 'preview');
    await show(ctx, lang === 'en' ? '➖ <b>Remove an area</b>\n\nTap the area to remove from this alert:' : '➖ <b>حذف منطقة</b>\n\nاضغط على المنطقة اللي بدك تشيلها من هالتنبيه:', kb);
  }));
  bot.callbackQuery(/^rml:(\d+)$/, needDraft(async (ctx, d) => {
    const i = Number(ctx.match[1]);
    if (d.extra?.length) {
      if (i === 0) d.location = d.extra.shift();
      else if (i - 1 < d.extra.length) d.extra.splice(i - 1, 1);
    }
    return showPreview(ctx, d);
  }));
  bot.callbackQuery('skip', needDraft((ctx, d) => showPreview(ctx, d)));
  bot.callbackQuery(/^back:(gov|dist|sub)$/, needDraft(async (ctx, d) => {
    if (ctx.match[1] === 'sub' && d.dist && getDist(d.dist)) return showSubs(ctx, d, d.dist);
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
  bot.callbackQuery('intense', needDraft(async (ctx, d) => {
    if (!staff(ctx) || d.type !== 'uav') return;
    const on = typeof d.intense === 'boolean' ? d.intense : droneAuto(d.details) > 1;
    d.intense = !on;
    await ctx.answerCallbackQuery({ text: langOf(ctx) === 'en' ? (d.intense ? 'Intensive: 2-3 drones per area' : 'Normal: one drone per area') : (d.intense ? 'مكثف: 2-3 مسيّرات فوق كل منطقة' : 'عادي: مسيّرة وحدة فوق كل منطقة') }).catch(() => {});
    return showPreview(ctx, d);
  }));
  bot.callbackQuery('dur', needDraft(async (ctx, d) => {
    const kb = new InlineKeyboard();
    (d.type === 'road' ? ROAD_DURATIONS : DURATIONS).forEach((m, i) => {
      kb.text((m === d.ttlMin ? '• ' : '') + fmtDur(m, langOf(ctx)), 'setdur:' + m);
      if (i % 4 === 3) kb.row();
    });
    kb.row().text(L(ctx).btnBack, 'preview');
    await show(ctx, L(ctx).durTitle, kb);
  }));
  bot.callbackQuery(/^setdur:(\d+)$/, needDraft(async (ctx, d) => {
    const m = Number(ctx.match[1]);
    if ((d.type === 'road' ? ROAD_DURATIONS : DURATIONS).includes(m)) d.ttlMin = m;
    await showPreview(ctx, d);
  }));
  bot.callbackQuery('preview', needDraft((ctx, d) => showPreview(ctx, d)));

  const publishRoadDraft = async (ctx, d, toChannel) => {
    if (!staff(ctx)) return;
    if (!d.location) return askLocation(ctx, d);
    sessions.delete(sk(ctx));
    const en = langOf(ctx) === 'en';
    const r = await publishDraft(ctx.api, { ...d, toChannel }, d.fromReport ? { id: d.fromReport.id, name: d.fromReport.first_name, approvedBy: ctx.from.id } : { id: ctx.from.id, name: ctx.from.first_name });
    if (d.fromReport) await sendTransient(APIS[d.notifyVia] || APIS.report || ctx.api, d.fromReport.id, T[store.userLang(d.fromReport.id)].reportApprovedUser);
    const kb = new InlineKeyboard();
    if (config.publicUrl) kb.url(en ? '🗺 Open the map' : '🗺 افتح الخريطة', `${config.publicUrl}/${en ? 'en' : 'ar'}/#roads`).row();
    kb.text(en ? '🏁 End this road status' : '🏁 إنهاء حالة الطريق', 'rdx:' + r.id).row().text(L(ctx).btnHome, 'home');
    await show(ctx, `${en ? '✅ Added to the map\'s roads layer' : '✅ انضافت على طبقة الطرق بالخريطة'}${toChannel ? (en ? ' and posted in the channel' : ' وانتشرت بالقناة') : ''}.\n\n${draftSummary(d, langOf(ctx))}`, kb);
  };
  bot.callbackQuery('publish:ch', needDraft((ctx, d) => (d.type === 'road' ? publishRoadDraft(ctx, d, true) : null)));
  bot.callbackQuery('publish', needDraft(async (ctx, d) => {
    if (!staff(ctx)) return;
    if (d.type === 'road') return publishRoadDraft(ctx, d, false);
    if (d.type === 'breaking' && !d.text) return askLocation(ctx, d);
    sessions.delete(sk(ctx));
    if (config.alertImages) { try { await show(ctx, L(ctx).publishing, new InlineKeyboard()); } catch { /* ignore */ } }
    const alert = await publishDraft(ctx.api, d, d.fromReport ? { id: d.fromReport.id, name: d.fromReport.first_name, approvedBy: ctx.from.id } : { id: ctx.from.id, name: ctx.from.first_name });
    if (d.fromReport) await sendTransient(APIS[d.notifyVia] || APIS.report || ctx.api, d.fromReport.id, T[store.userLang(d.fromReport.id)].reportApprovedUser);
    await show(ctx, `${L(ctx).published}\n\n${draftSummary(d, langOf(ctx))}`, resultKeyboard(ctx, alert));
  }));

  bot.callbackQuery('submit', needDraft(async (ctx, d) => {
    if (store.isBanned(ctx.from.id)) return;
    sessions.delete(sk(ctx));
    lastReport.set(ctx.from.id, Date.now());
    const rid = Math.random().toString(36).slice(2, 10);
    const { msgId: _m, ...draft } = d;
    const rep = { draft, from: { id: ctx.from.id, first_name: ctx.from.first_name, last_name: ctx.from.last_name, username: ctx.from.username }, messages: [], created: Date.now(), via: roleOf(ctx) };
    const api = APIS.admin || reviewApi || ctx.api;
    store.reportPut(rid, rep);
    const reviewers = [...new Set([...config.ownerIds, ...store.state.editors])];
    for (const uid of reviewers) {
      const lang = store.userLang(uid) === 'en' ? 'en' : 'ar';
      try {
        const m = await api.sendMessage(uid, reportCardText(rep, lang), { parse_mode: 'HTML', reply_markup: reportReviewKeyboard(lang, rid), _keep: 'c' }); // stays until handled
        rep.messages.push([uid, m.message_id]);
        store.reportPut(rid, rep); // saved with every card, so a decision always finds it
        store.relayPut(`a:${uid}:${m.message_id}`, ctx.from.id);
      } catch (e) { /* reviewer has not started the bot */ }
    }
    store.openThread(ctx.from.id); // the reporter can now write to the team freely
    // short "thanks" notice that disappears by itself; the chat goes straight back to the menu
    await home(ctx);
    await sendTransient(ctx.api, ctx.chat.id, L(ctx).reportSent);
  }));

  bot.callbackQuery(/^rv:(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return ctx.answerCallbackQuery();
    const rid = ctx.match[1];
    if (!store.reportGet(rid) && !store.reportDone(rid)) await store.mergeFromBackup();
    const rep = store.reportGet(rid);
    if (!rep) {
      const en = langOf(ctx) === 'en';
      try { await ctx.answerCallbackQuery({ text: en ? 'This report is no longer available.' : 'هذا البلاغ لم يعد متاحاً.', show_alert: true }); } catch { /* ignore */ }
      return;
    }
    const en = langOf(ctx) === 'en';
    if (rep.verification?.status === 'checking' && Date.now() - (rep.verification.startedAt || 0) < 120_000) {
      return ctx.answerCallbackQuery({ text: en ? 'Source check is already running.' : 'التحقق من المصادر جارٍ بالفعل.' });
    }
    rep.verification = { status: 'checking', startedAt: Date.now(), by: ctx.from.id };
    store.reportPut(rid, rep);
    await ctx.answerCallbackQuery({ text: en ? 'Checking enabled sources…' : 'جارٍ فحص المصادر المفعّلة…' }).catch(() => {});

    const reviewerApi = APIS.admin || reviewApi || ctx.api;
    const refresh = async (current) => {
      for (const [chat, mid] of current.messages || []) {
        const lang = store.userLang(chat) === 'en' ? 'en' : 'ar';
        try {
          await reviewerApi.editMessageText(chat, mid, reportCardText(current, lang), {
            parse_mode: 'HTML', reply_markup: reportReviewKeyboard(lang, rid),
            link_preview_options: { is_disabled: true },
          });
        } catch { /* card may have been deleted or already updated */ }
      }
    };
    await refresh(rep);

    let result;
    try {
      result = await verifyReportSources(rep.draft);
    } catch (e) {
      console.warn('[bot] report source check failed', e?.message || e);
      result = { checkedAt: new Date().toISOString(), totalSources: 0, checkedSources: 0, errors: [], matches: [], failed: true };
    }
    const latest = store.reportGet(rid);
    if (!latest) return; // a reviewer may have made a decision while the lookup was running
    latest.verification = { ...result, status: 'done', by: ctx.from.id };
    store.reportPut(rid, latest);
    await refresh(latest);
  });

  // Remove the report from every reviewer's chat (optionally keeping the current one).
  const closeReport = async (ctx, rep, keepCurrent = false) => {
    if (!rep) return;
    for (const [chat, mid] of rep.messages) setKeep('admin', chat, mid, false); // handled: normal screen now
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
    const en = langOf(ctx) === 'en';
    // a card sent by the previous instance during a deploy: pull its final state first
    if (!store.reportGet(rid) && !store.reportDone(rid)) await store.mergeFromBackup();
    const rep = store.reportTake(rid); // claimed once: a second tap / a second reviewer can't publish it again
    if (!rep) {
      if (store.reportDone(rid)) return vanish(ctx, en ? 'This report was already handled ✔️' : 'تمت معالجة هذا البلاغ مسبقاً ✔️');
      // truly unknown (older than 48 h or lost): keep the card visible so its content can be published by hand
      try { await ctx.answerCallbackQuery({ text: en ? 'This report is no longer available — publish it from the menu.' : 'هذا البلاغ لم يعد متاحاً — انشره يدوياً من القائمة.', show_alert: true }); } catch { /* ignore */ }
      try { await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(en ? '🏠 Menu' : '🏠 القائمة', 'home') }); } catch { /* ignore */ }
      return;
    }
    const notify = APIS[rep.via] || APIS.report || ctx.api;
    if (action === 'ap') {
      try {
        await publishDraft(ctx.api, rep.draft, { id: rep.from.id, name: rep.from.first_name, approvedBy: ctx.from.id });
      } catch (e) {
        store.reportRestore(rid, rep); // nothing lost: the reviewer can tap again
        console.error('[bot] report publish failed', e.description || e.message);
        try { await ctx.answerCallbackQuery({ text: en ? '⚠️ Publishing failed — tap Approve again.' : '⚠️ تعذّر النشر — اضغط «موافقة» مرة ثانية.', show_alert: true }); } catch { /* ignore */ }
        return;
      }
      await closeReport(ctx, rep, true);
      await vanish(ctx, L(ctx).reportApproved(ctx.from.first_name || ''));
      await sendTransient(notify, rep.from.id, T[store.userLang(rep.from.id)].reportApprovedUser);
    } else if (action === 'ed') {
      // Load the report into this editor's publishing session so it can be adjusted first.
      await ctx.answerCallbackQuery();
      await closeReport(ctx, rep, true);
      const d = { ...rep.draft, mode: 'publish', created: Date.now(), msgId: null, fromReport: rep.from, notifyVia: rep.via };
      sessions.set(sk(ctx), d);
      await showPreview(ctx, d);
    } else {
      if (action === 'bn') store.ban(rep.from.id);
      await closeReport(ctx, rep, true);
      await vanish(ctx, L(ctx).reportRejected(ctx.from.first_name || '') + (action === 'bn' ? ' · 🚫' : ''));
    }
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
      kb.text(`${alertEmoji(a)} ${t} · ${(lang === 'en' ? a.title_en : a.title) || ''}`.slice(0, 60), 'm:' + a.id).row();
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
    return new InlineKeyboard().text(m(1, l.btnAuto1), 'auto:1').text(m(24, l.btnAuto24), 'auto:24').text(m(48, l.btnAuto48), 'auto:48').text(m(0, l.btnAutoOff), 'auto:0').row().text(l.btnHome, 'home');
  };
  bot.callbackQuery('auto', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!owner(ctx)) return;
    await show(ctx, L(ctx).autoTitle(store.autoDeleteHours), autoKb(ctx));
  });
  bot.callbackQuery(/^auto:(0|1|24|48)$/, async (ctx) => {
    if (!owner(ctx)) return ctx.answerCallbackQuery();
    store.setAutoDelete(Number(ctx.match[1]));
    await ctx.answerCallbackQuery(L(ctx).autoSaved);
    await show(ctx, L(ctx).autoTitle(store.autoDeleteHours), autoKb(ctx));
  });
  bot.callbackQuery('active', async (ctx) => { await ctx.answerCallbackQuery(); if (staff(ctx)) await showActive(ctx); });

  const manageText = (ctx, a) => {
    const lang = langOf(ctx);
    const exp = a.expires_at
      ? new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-SY', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(a.expires_at))
      : (lang === 'en' ? 'No expiry' : 'بلا انتهاء');
    return `${L(ctx).manageTitle}\n\n${alertEmoji(a)} <b>${esc(lang === 'en' ? a.title_en : a.title)}</b>\n${a.description ? esc(a.description) + '\n' : ''}🕒 ${esc(fmtTime(a.timestamp, lang))}\n⌛ ${lang === 'en' ? 'Expires' : 'ينتهي'}: ${exp}${a.is_active ? '' : '\n\n' + L(ctx).ended}`;
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
      if (!a.expires_at) {
        await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'This alert has no expiry.' : 'هذا التنبيه بلا انتهاء.');
        return show(ctx, manageText(ctx, a), resultKeyboard(ctx, a));
      }
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
    d.msgId = null;
    await pickLocation(ctx, d, locationFrom({ lat, lon }));
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
    if (d.step === 'label' && d.mode !== 'report') {
      const t = text.replace(/\s+/g, ' ').trim();
      if (!t || t.length > 60) return ctx.reply(langOf(ctx) === 'en' ? 'Please send a short name (up to 60 characters).' : 'اكتب اسماً قصيراً (حتى 60 حرفاً).');
      d.location = withLabel(d.location, t);
      return showPreview(ctx, d);
    }
    if (['gov', 'dist', 'place'].includes(d.step)) {
      const res = searchPlaces(text, 12);
      const lang = langOf(ctx);
      const sugg = !res.length && d.mode !== 'report' ? centerSuggestions(text, { gov: d.gov, dist: d.step !== 'dist' ? d.dist : '', sub: d.sub }) : [];
      if (sugg.length) {
        const q = text.replace(/\s+/g, ' ').trim().slice(0, 60);
        d.labelQ = q;
        const kb = new InlineKeyboard();
        for (const p of sugg) kb.text(`${centerBtn(p, lang)} — «${q}»`.slice(0, 64), 'pl:' + p.id).row();
        kb.text(l.btnBack, 'back:gov').text(l.btnCancel, 'cancel');
        const qq = esc(q);
        return ctx.reply(lang === 'en' ? `No place named “${qq}” in the list.\nPin it on a nearby centre — the post will show the name <b>${qq}</b>:` : `«${qq}» غير موجود في القائمة.\nثبّت الدبوس على مركز قريب، وسيظهر في الخبر باسم <b>${qq}</b>:`, { parse_mode: 'HTML', reply_markup: kb });
      }
      const hint = !res.length && d.mode !== 'report' ? (lang === 'en' ? '\n\n💡 Pick the governorate and district first, then send the name again — or add the town, e.g. <i>Al-Rasm camp Manbij</i> — to pin it on that centre with your name.' : '\n\n💡 اختر المحافظة ثم المنطقة وأرسل الاسم مرة ثانية، أو أضف اسم المدينة مثل <i>مخيم الرسم منبج</i>، لتثبيت الدبوس على مركزها مع الاسم الذي كتبته.') : '';
      if (!res.length) return ctx.reply(l.searchNone(esc(text.slice(0, 40))) + hint, { parse_mode: 'HTML' });
      const kb = new InlineKeyboard();
      for (const p of res) {
        if (p.scope === 'governorate') kb.text(`📍 ${lang === 'en' ? p.en : p.ar}`, 'wg:' + p.gov).row();
        else {
          const dd = getDist(p.dist);
          const g = getGov(p.gov);
          const ss = p.sub && getSub(p.sub);
          const subTxt = ss && !/^مركز/.test(ss.ar) && ss.ar !== p.ar ? ` › ${lang === 'en' ? ss.en : ss.ar}` : ''; // same name in two areas: say which
          kb.text(`${lang === 'en' ? p.en || p.ar : p.ar} — ${lang === 'en' ? dd?.en || g?.en : dd?.ar || g?.ar}${subTxt}`.slice(0, 60), 'p:' + p.id).row();
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
  if (role === 'admin') setInterval(() => store.reportsPrune(), 3600_000).unref();

  return bot;
}

// ---------------------------------------------------------------- backup adapter (pinned JSON in owner chat)

export function telegramBackupAdapter(api0) {
  if (!config.ownerIds[0]) return null;
  const NAME = 'red-alert-syria-backup.json';
  const last = new Map(); // `${token}|${chat}` -> pinned message id
  const caption = '🗄 نسخة احتياطية تلقائية لبيانات Red Alert Syria — لا تحذفها ولا تلغِ تثبيتها.\nAutomatic backup — keep pinned.';
  const put = async (api, token, chat, json) => {
    const key = `${token}|${chat}`;
    const file = () => new InputFile(Buffer.from(json), NAME);
    const prev = last.get(key);
    if (prev) {
      try { await api.editMessageMedia(chat, prev, InputMediaBuilder.document(file(), { caption })); return; } catch (e) {
        if (/not modified/i.test(e.description || '')) return;
        // Telegram slow / 5xx / network: the edit may still land. Do not post a second backup file now;
        // the store keeps the backup pending and retries on its next save.
        if (!(e instanceof GrammyError) || e.error_code >= 500 || e.error_code === 429) throw e;
      }
    }
    const m = await api.sendDocument(chat, file(), { caption, disable_notification: true, _keep: 'b' });
    try { await api.pinChatMessage(chat, m.message_id, { disable_notification: true }); } catch { /* ignore */ }
    if (prev) { try { await api.deleteMessage(chat, prev); } catch { /* ignore */ } }
    last.set(key, m.message_id);
  };
  return {
    async save(json) {
      const api = APIS.admin || api0;
      const owner = config.ownerIds[0];
      await put(api, config.botToken, owner, json);
      // After an in-bot hand-over (owner changed, same publishing bot) and until the Render env vars are
      // updated, a restart reads the backup from the env owner's chat: keep a copy there, without tokens.
      const envOwner = envDefaults.ownerIds[0];
      if (envOwner && envOwner !== owner && config.botToken === envDefaults.botToken) {
        try {
          const st = JSON.parse(json);
          if (st?.settings?.project) { delete st.settings.project.botToken; delete st.settings.project.reportBotToken; }
          await put(api, config.botToken, envOwner, JSON.stringify(st));
        } catch (e) { console.error('[store] mirror backup failed', e.description || e.message); }
      }
    },
    async load() {
      const api = APIS.admin || api0;
      const chat = await api.getChat(config.ownerIds[0]);
      const pm = chat.pinned_message;
      if (!pm?.document || pm.document.file_name !== NAME) return null;
      last.set(`${config.botToken}|${config.ownerIds[0]}`, pm.message_id);
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
