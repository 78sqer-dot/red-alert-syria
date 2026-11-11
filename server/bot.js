import { randomUUID } from 'node:crypto';
import { installTracker, cleanChat, cleanMenuMessages, setKeep } from './ui-clean.js';
import { installResilience, isDefinitiveTelegramRejection } from './tg-net.js';
import { Bot, InlineKeyboard, InputFile, InputMediaBuilder, GrammyError, HttpError } from 'grammy';
import { config, isOwner, envDefaults } from './config.js';
import { registerOwnerTools, registerReportOwnerCommands, runtimeHooks } from './owner-tools.js';
export { runtimeHooks };
import { store, publicAlert, sanitizeAlertMedia, sanitizeAlertMediaItems, mergeAlertMediaItems, ALERT_MEDIA_MAX_BYTES } from './store.js';
import { ALERT_TYPES, ALERT_GROUPS, TYPE_KEYS, POLITICAL_CATEGORIES, typeOf, alertEmoji, alertButtonLabel, droneAuto, BORDER_REGIONS, BORDER_MARKERS, FLIGHT_DIRECTIONS, FLIGHT_AIRCRAFT, CIVIL_EMOJIS, eventVisual } from '../shared/types.js';
import { T, TITLES, fmtDur } from './bot-texts.js';
import { collectStats, renderStatsPng, damascusParts } from './stats-image.js';
import { renderAlertPng } from './alert-image.js';
import { registerContactTools } from './contact-tools.js';
import { registerSupportTools } from './support-tools.js';
import { registerNewsTools, verifyReportSources } from './news-monitor.js';
import { registerJobsTools } from './jobs.js';
import { registerJobsAdminTools } from './jobs-admin-tools.js';
import { registerArmyAdminTools } from './army-admin-tools.js';
import { ROAD_DURATIONS, roadLabel, addRoad, activeRoads, endRoad, roadWhere, postRoadToChannel, registerPowerTools } from './services.js';
import { registerPriceTools } from './prices.js';
import { registerQuakeTools } from './quakes.js';
import { registerWeatherTools } from './weather.js';
import { registerWxBulletinTools } from './wx-daily.js';
import { registerBorderTools } from './borders.js';
import { registerRoadMonitorTools, rememberIgnoredRoadReport } from './road-monitor.js';
import { governorates, getGov, getDist, getSub, districtsOf, placesOf, subsOf, placesOfSub, searchPlaces, locationFrom, insideSyriaBox, centerOfDist, capitalOf, centerOfSub, centerSuggestions, getPlace } from './places.js';
// publishing bot: a custom name for the pinned spot ("مخيم الرسم الجديد") while the pin stays on the chosen centre
function withLabel(loc, label) {
  const base = loc.custom_label ? loc.base : { name_ar: loc.name_ar, name_en: loc.name_en, short_ar: loc.short_ar, short_en: loc.short_en };
  if (!label) return { ...loc, ...base, custom_label: undefined, base: undefined };
  return { ...loc, name_ar: label, name_en: label, short_ar: label, short_en: label, custom_label: true, base };
}
const centerBtn = (p, lang) => `📍 ${lang === 'en' ? 'Centre of' : 'مركز مدينة'} ${lang === 'en' ? p.en || p.ar : p.ar}`.slice(0, 60);
import { cleanAlertText, cleanAttributedNewsText, isPrivateEditorialCopy } from './clean-text.js';
import { isAlnabaOwner, prepareAlnabaUpload, publishAlnabaItem, prepareAlnabaArchiveEntry, publishAlnabaArchiveEntry, findAlnabaEntry, updateAlnabaEntry, deleteAlnabaEntry, sanitizeAlnabaState, fetchAlnabaTelegramBytes, parseWeeklyUploadCaption, mimeFromAlnabaFilename, weeklyIssueNumber, nextWeeklyIssueNumber } from './alnaba.js';

const PAGE = 24;
const SUB_MENU_MIN = 40; // districts with more towns than this get a ناحية (sub-district) step first
const DURATIONS = [15, 30, 60, 90, 120, 180, 360, 720];
const REPORT_COOLDOWN_MS = 2 * 60_000;

export const esc = (s) => String(s ?? '').replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cleanInputText = (s) => String(s || '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
const clean = (s, max = 900) => cleanInputText(s).slice(0, max);
function assertPublicCopySafe(...values) {
  if (values.some(isPrivateEditorialCopy)) throw new Error('Private editorial or internal review text cannot be published as public news');
}

const VEHICLE_COUNT_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
const VEHICLE_COUNT_MAX = 999;
const politicalCategory = (key) => Object.hasOwn(POLITICAL_CATEGORIES, key) ? key : null;

// Derive report choices from the current shared groups. Targeting stays separate
// so drone strikes and assassinations remain distinct alert types. Historical
// air_movement alerts remain renderable, but new reports are not offered in bot menus.
export const BOT_ALERT_MENU_GROUPS = Object.freeze({
  aerial: Object.freeze(ALERT_GROUPS.aerial.types.filter((type) => type !== 'uav_strike' && type !== 'air_movement')),
  targeting: Object.freeze(['targeted_strike', 'uav_strike', 'assassination']),
  strikes: Object.freeze(ALERT_GROUPS.strikes.types.filter((type) => type !== 'assassination' && type !== 'targeted_strike')),
  protests: Object.freeze(['protest_action', 'protest']),
  civil: Object.freeze(ALERT_GROUPS.civil.types.filter((type) => type !== 'protest' && type !== 'protest_action')),
  smuggling: Object.freeze([...ALERT_GROUPS.smuggling.types]),
  nature: Object.freeze([...ALERT_GROUPS.nature.types]),
});
export const BOT_ALERT_MENU_DIRECT_TYPES = Object.freeze(['breaking', 'political', 'border', 'military_incursion', 'patrol', 'signal_sweep']);
export const BOT_ALERT_MENU_PATROL_CHILD_TYPES = Object.freeze(['kidnapping']);
const REPORT_GROUP_EMOJI = Object.freeze({ aerial: '✈️', targeting: '🎯', strikes: '💥', protests: '📢', civil: '🛡️', smuggling: '🚚', nature: '🌦️' });
const quoteButtonLabel = (label, lang) => lang === 'en' ? `“${label}”` : `«${label}»`;
function reportGroupLabel(group, lang) {
  const value = group === 'targeting' ? { ar: 'استهداف', en: 'Targeting' } : group === 'protests' ? { ar: 'مظاهرة', en: 'Protest & demonstration' } : ALERT_GROUPS[group];
  if (!value) return group;
  return quoteButtonLabel(`${REPORT_GROUP_EMOJI[group] || '🏷️'} ${lang === 'en' ? value.en : value.ar}`, lang);
}
function reportGroupKeyboard(group, lang) {
  const types = BOT_ALERT_MENU_GROUPS[group] || [];
  const kb = new InlineKeyboard();
  types.forEach((type, index) => {
    const label = quoteButtonLabel(alertButtonLabel(type, lang), lang);
    kb.text(label, `t:${type}`);
    if (index % 2 === 1 && index < types.length - 1) kb.row();
  });
  if (types.length % 2 === 1 || types.length === 0) kb.row();
  return kb.text(lang === 'en' ? '↩️ Back to menu' : '↩️ العودة للقائمة', 'home');
}
function safeHttpUrl(value) {
  const text = String(value || '').trim();
  if (!/^https?:\/\//i.test(text) || text.length > 2048) return null;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
function sourceIso(value) {
  if (value == null || value === '') return null;
  const raw = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : value;
  const ms = typeof raw === 'string' && /^\d{10,13}$/.test(raw) ? Number(raw) * (raw.length === 10 ? 1000 : 1) : Date.parse(raw);
  return Number.isFinite(ms) && Number.isFinite(new Date(ms).getTime()) ? new Date(ms).toISOString() : null;
}
function politicalSourcesFor(d) {
  const sources = [];
  for (const item of Array.isArray(d.politicalSources) ? d.politicalSources : []) {
    const url = safeHttpUrl(item?.url);
    if (!url) continue;
    const timestamp = item?.timestamp == null || item.timestamp === '' ? null : sourceIso(item.timestamp);
    if (item?.timestamp != null && item.timestamp !== '' && !timestamp) continue;
    sources.push({ name: clean(item?.name, 120) || url, url, timestamp });
  }
  if (!sources.length) {
    const urls = String(d.details || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
    for (const token of urls) {
      const url = safeHttpUrl(token.replace(/[),.;!?\]}]+$/g, ''));
      if (url) {
        sources.push({ name: langSourceName(d), url, timestamp: null });
        break;
      }
    }
  }
  return sources;
}
function monitoredSourcesFor(d) {
  const sources = [];
  for (const item of Array.isArray(d.srcs) ? d.srcs : []) {
    const url = safeHttpUrl(item?.url);
    const name = clean(item?.name || item?.u, 120);
    if (!name || !url) continue;
    sources.push({ name, url, timestamp: sourceIso(item?.ts) });
    if (sources.length === 5) break;
  }
  return sources;
}
function langSourceName(d) { return d.lang === 'en' ? 'Source in report details' : 'مصدر مذكور في التفاصيل'; }
function parseVehicleCount(value) {
  const normalized = String(value ?? '').replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  }).trim();
  if (!/^\d{1,3}$/.test(normalized)) return null;
  const count = Number(normalized);
  return count >= 1 && count <= VEHICLE_COUNT_MAX ? count : null;
}
function vehicleCountPhrase(count, lang) {
  const digits = new Intl.NumberFormat(lang === 'en' ? 'en' : 'ar-SY', { useGrouping: false }).format(count);
  if (lang === 'en') return `${digits} ${count === 1 ? 'vehicle' : 'vehicles'}`;
  if (count === 1) return 'آلية واحدة';
  if (count === 2) return 'آليتان';
  return `${digits} ${count >= 3 && count <= 10 ? 'آليات' : 'آلية'}`;
}

const sessions = new Map(); // userId -> draft
const activeMediaSessions = new Map(); // userId -> { alertId, created }: admin attachment to an already-published alert
const alnabaSessions = new Map(); // ownerId -> { section, createdAt }
const alnabaPendingUploads = new Map(); // ownerId -> validated media waiting for explicit publish confirmation
const alnabaPendingForwardInputs = new Map(); // ownerId -> forwarded media waiting for section choice or required metadata
const alnabaUploadBatches = new Map(); // ownerId -> incoming owner files grouped by a short quiet period
const alnabaBatchQueues = new Map(); // ownerId -> ordered batch processing promise
const alnabaBatchSectionChoices = new Map(); // token -> one ambiguous forwarded file awaiting section choice
let alnabaBatchIntakePaused = false;
export function pauseAlnabaBatchIntake() { alnabaBatchIntakePaused = true; }
const alnabaPendingArchiveEntries = new Map(); // ownerId -> validated Telegram directory entry waiting for confirmation
const alnabaEditSessions = new Map(); // ownerId -> { section, id, field, page, createdAt }
const alnabaPendingManagementEdits = new Map(); // ownerId -> validated edit waiting for explicit save confirmation
const alnabaPendingManagementDeletes = new Map(); // ownerId -> entry waiting for explicit delete confirmation
let alnabaWriteQueue = Promise.resolve();
const withAlnabaWriteLock = (work) => {
  const next = alnabaWriteQueue.then(work, work);
  alnabaWriteQueue = next.then(() => undefined, () => undefined);
  return next;
};
const clearAlnabaManagementState = (uid) => {
  alnabaEditSessions.delete(uid);
  alnabaPendingManagementEdits.delete(uid);
  alnabaPendingManagementDeletes.delete(uid);
};
// pending reports live in the store (store.reportPut/Take): they survive restarts and deploys
const lastReport = new Map();

const isStaffId = (id) => isOwner(id) || store.isEditor(id);
// Two bots share this module: role 'admin' (private publishing panel) and role 'report' (public reports).
const roleOf = (ctx) => ctx.ras?.role || 'admin';
const staff = (ctx) => roleOf(ctx) === 'admin' && isStaffId(ctx.from?.id);
const owner = (ctx) => roleOf(ctx) === 'admin' && isOwner(ctx.from?.id);
const alnabaOwner = (ctx) => roleOf(ctx) === 'admin' && isAlnabaOwner(ctx.from?.id);
const sk = (ctx) => `${roleOf(ctx)}:${ctx.from?.id}`;
export const botInfo = { admin: null, report: null }; // usernames, filled at start
const L = (ctx) => T[store.userLang(ctx.from?.id)] || T.ar;
const langOf = (ctx) => store.userLang(ctx.from?.id) === 'en' ? 'en' : 'ar';
const typeLabel = (key, lang) => (key === 'road' ? (lang === 'en' ? '🛣 Road status' : '🛣 حالة طريق') : `${typeOf(key).emoji} ${lang === 'en' ? typeOf(key).en : typeOf(key).ar}`);
const draftTypeLabel = (d, lang) => d?.type === 'airstrike' && d.airstrikeForm
  ? `${typeOf('airstrike').emoji} ${d.airstrikeForm === 'plural' ? (lang === 'en' ? 'Airstrikes' : 'غارات جوية') : (lang === 'en' ? 'Airstrike' : 'غارة جوية')}`
  : d?.type === 'patrol' && d.patrolForm
    ? (d.patrolForm === 'plural' ? (lang === 'en' ? 'Patrols' : 'دوريات') : (lang === 'en' ? 'Patrol' : 'دورية'))
    : d?.type === 'signal_sweep' && d.signalPlatform === 'uav'
      ? (lang === 'en' ? '📡 Signal sweep by drone' : '📡 رصد/مسح الإشارة بمسيّرة')
    : d?.type === 'military_incursion' && d.incursionKind === 'soldiers'
      ? (lang === 'en' ? 'Military soldier incursion' : 'توغل جنود')
    : d?.type === 'military_incursion' && d.incursionKind === 'vehicles'
      ? (lang === 'en' ? 'Military vehicle incursion' : 'توغل آليات عسكرية')
      : d?.type === 'military_incursion' && d.incursionKind === 'barrier'
        ? (lang === 'en' ? 'Military checkpoint' : 'حاجز عسكري')
        : typeLabel(d?.type, lang);
const mapUrl = (id, lang = 'ar') => (config.publicUrl ? `${config.publicUrl}/${lang}/${id ? '#' + id : ''}` : '');
const WHATSAPP_CHANNEL = 'https://whatsapp.com/channel/0029VbEO1eGCBtxLP3jW8e1k';

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

const fmtClock = (iso) => new Intl.DateTimeFormat('ar-SY', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const fmtDate = (iso) => new Intl.DateTimeFormat('ar-SY', { timeZone: config.timezone, day: 'numeric', month: 'long' }).format(new Date(iso));
const MEETING_COUNTRIES = [
  { code: 'LB', flag: '🇱🇧', names: ['لبنان', 'lebanon'] },
  { code: 'JO', flag: '🇯🇴', names: ['الاردن', 'jordan'] },
  { code: 'TR', flag: '🇹🇷', names: ['تركيا', 'turkey'] },
  { code: 'IQ', flag: '🇮🇶', names: ['العراق', 'iraq'] },
  { code: 'EG', flag: '🇪🇬', names: ['مصر', 'egypt'] },
  { code: 'SA', flag: '🇸🇦', names: ['السعودية', 'المملكة العربية السعودية', 'saudi arabia'] },
  { code: 'AE', flag: '🇦🇪', names: ['الامارات', 'الامارات العربية المتحدة', 'united arab emirates', 'uae'] },
  { code: 'QA', flag: '🇶🇦', names: ['قطر', 'qatar'] },
  { code: 'KW', flag: '🇰🇼', names: ['الكويت', 'kuwait'] },
  { code: 'BH', flag: '🇧🇭', names: ['البحرين', 'bahrain'] },
  { code: 'OM', flag: '🇴🇲', names: ['سلطنة عمان', 'oman'] },
  { code: 'SY', flag: '🇸🇾', names: ['سوريا', 'syria'] },
  { code: 'PS', flag: '🇵🇸', names: ['فلسطين', 'palestine'] },
  { code: 'IR', flag: '🇮🇷', names: ['ايران', 'iran'] },
  { code: 'RU', flag: '🇷🇺', names: ['روسيا', 'russia'] },
  { code: 'US', flag: '🇺🇸', names: ['الولايات المتحدة', 'امريكا', 'united states', 'america'] },
  { code: 'GB', flag: '🇬🇧', names: ['المملكة المتحدة', 'بريطانيا', 'united kingdom', 'great britain'] },
  { code: 'FR', flag: '🇫🇷', names: ['فرنسا', 'france'] },
  { code: 'DE', flag: '🇩🇪', names: ['المانيا', 'germany'] },
  { code: 'CN', flag: '🇨🇳', names: ['الصين', 'china'] },
  { code: 'UA', flag: '🇺🇦', names: ['اوكرانيا', 'ukraine'] },
];
const normalizeCountryText = (value) => String(value || '').normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function explicitMeetingCountryFlag(alert) {
  const text = normalizeCountryText([alert.title, alert.title_en, alert.description, alert.description_en].filter(Boolean).join(' '));
  const hits = new Map();
  for (const country of MEETING_COUNTRIES) {
    for (const name of country.names) {
      const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(normalizeCountryText(name))})(?=$|[^\\p{L}\\p{N}])`, 'giu');
      for (const match of text.matchAll(pattern)) {
        const index = match.index + match[1].length;
        const before = text.slice(Math.max(0, index - 24), index);
        const locationMention = /(?:في|الي|الى|نحو|in|to|at)\s*$/iu.test(before);
        const existing = hits.get(country.code) || { country, locationMention: false };
        existing.locationMention ||= locationMention;
        hits.set(country.code, existing);
      }
    }
  }
  if (hits.size === 1) return hits.values().next().value.country.flag;
  const located = [...hits.values()].filter((hit) => hit.locationMention);
  return located.length === 1 ? located[0].country.flag : '';
}
function channelEventSymbol(alert) {
  if (alert.type !== 'political') return alertEmoji(alert);
  const category = alert.meta?.political?.category;
  if (category === 'meeting') return explicitMeetingCountryFlag(alert) || POLITICAL_CATEGORIES.meeting.emoji;
  return POLITICAL_CATEGORIES[category]?.emoji || alertEmoji(alert);
}
// Channel post (format requested by the owner):
//   تنبيه مدني - 🚑
//   📍كويرس شرقي، الباب، حلب
//   تاريخ :  ٢٣ تشرين الأول
//   الساعة :  ١٠:٣١ م
//
//   (no footer; map and channel links remain on the inline buttons)
export function channelPost(alert, { ended = false } = {}) {
  assertPublicCopySafe(alert?.title, alert?.title_en, alert?.description, alert?.description_en, alert?.meta?.channelTitle);
  const t = typeOf(alert.type);
  let title = alert.meta?.channelTitle || (TITLES[alert.type] || {}).ar || t.ar;
  if (alert.type === 'military_incursion') {
    const kind = alert.meta?.incursionKind || (Number.isInteger(alert.meta?.vehicleCount) ? 'vehicles' : null);
    title = kind === 'barrier' ? 'حاجز عسكري' : kind === 'soldiers' ? 'توغل جنود' : kind === 'vehicles' ? 'توغل آليات عسكرية' : 'توغل عسكري';
  }
  if (alert.type === 'patrol') title = alert.meta?.patrolForm === 'plural' ? 'دوريات' : 'دورية';
  if (alert.place?.head_ar) title = alert.place.head_ar;
  if (alert.type === 'air_movement') {
    const aircraft = FLIGHT_AIRCRAFT[alert.meta?.aircraft || alert.aircraft];
    const direction = FLIGHT_DIRECTIONS[alert.meta?.flightDirection || alert.flight_direction];
    title = [aircraft?.ar, direction?.ar].filter(Boolean).join(' — ') || title;
  }
  if (alert.type === 'quake') { const m = alert.meta?.mag ?? Number((String(alert.title || '').match(/([0-9]+(?:\.[0-9])?)/) || [])[1]); if (Number.isFinite(m)) title = `زلزال بقوة ${m.toFixed(1)}`; }
  if (alert.type === 'military_incursion' && Number.isInteger(alert.meta?.vehicleCount)) title += ` — ${vehicleCountPhrase(alert.meta.vehicleCount, 'ar')}`;
  if (alert.type === 'signal_sweep' && alert.meta?.signalPlatform === 'uav') title += ' — مسيّرة';
  const p = alert.place || {};
  const hasPlace = p.scope && p.scope !== 'country';
  const versioned = alert.channel_format === 2;
  const emoji = versioned ? channelEventSymbol(alert) : alertEmoji(alert);
  const dot = versioned ? `${eventVisual(alert.type).dot} ` : '';
  const preserveStoryAttribution = alert.source === 'news' || ['political', 'breaking'].includes(alert.type);
  const privateSources = [...(Array.isArray(alert.meta?.newsSources) ? alert.meta.newsSources : []), ...(Array.isArray(alert.meta?.political?.sources) ? alert.meta.political.sources : [])];
  const privateSourceNames = privateSources.flatMap((source) => [source?.name, source?.u]).filter(Boolean);
  title = (preserveStoryAttribution ? cleanAttributedNewsText : cleanAlertText)(title, privateSourceNames) || title;
  const sections = [`${ended ? '✅ انتهى · ' : ''}${dot}<b>${esc(title)}</b>${emoji ? ` - ${emoji}` : ''}`];
  const desc = preserveStoryAttribution
    ? cleanAttributedNewsText(alert.description || '', privateSourceNames)
    : cleanAlertText(alert.description || '');
  if (alert.type === 'breaking') sections.push(`<b>${esc(desc || alert.title)}</b>`);
  if (hasPlace) sections.push([p, ...(alert.extra || [])].map((x) => `📍<b>${esc(locName(x, 'ar'))}</b>`).join('\n'));
  else if (alert.type === 'political') sections.push('📍 <b>الموقع:</b> غير محدد — دون دبوس');
  if (alert.type !== 'breaking' && desc) sections.push(`<blockquote>${esc(desc)}</blockquote>`);
  if (alert.type === 'political') {
    const meta = alert.meta?.political || {};
    const category = POLITICAL_CATEGORIES[meta.category];
    if (category) {
      sections.push(`🏛 <b>الفئة:</b> ${esc(category.emoji)} «${esc(category.ar)}»`);
    }
  }
  if (alert.type === 'political') {
    sections.push(`📅 <b>التاريخ:</b> ${esc(fmtDate(alert.timestamp))}`);
    sections.push(`🕒 <b>الوقت:</b> ${esc(fmtClock(alert.timestamp))}`);
  } else {
    sections.push(`تاريخ :  ${esc(fmtDate(alert.timestamp))}`);
    sections.push(`الساعة :  ${esc(fmtClock(alert.timestamp))}`);
  }
  if (ended) sections.push(`انتهى :  ${esc(fmtClock(alert.ended_at || new Date().toISOString()))}`);
  return sections.join('\n\n');
}
export function channelKeyboard(alert) {
  const url = mapUrl(alert.id);
  const kb = new InlineKeyboard();
  if (url) kb.url('🗺 عرض على الخريطة', url);
  if (config.reportBotUsername) kb.url('📨 أرسل بلاغاً', `https://t.me/${config.reportBotUsername}?start=report`);
  kb.row()
    .url('🚀 عزّز القناة', 'https://t.me/boost/Red_Alert_Syria')
    .url('🟢 قناة واتساب', WHATSAPP_CHANNEL);
  return kb;
}
function draftSummary(d, lang) {
  const l = T[lang];
  const loc = d.location;
  const civilEmoji = d.type === 'civil' ? CIVIL_EMOJIS[d.civilEmoji]?.emoji : '';
  const lines = [`<b>${esc(d.type === 'road' ? roadLabel(d.road, lang) : draftTypeLabel(d, lang))}</b>${civilEmoji ? ` ${civilEmoji}` : ''}`];
  const mediaItems = sanitizeAlertMediaItems(Array.isArray(d.media_items) && d.media_items.length ? d.media_items : d.media);
  if (mediaItems.length) lines.push(lang === 'en'
    ? `📎 <b>${mediaItems.map((item) => item.type === 'video' ? 'Video' : 'Photo').join(' + ')} attached</b>`
    : `📎 <b>مرفق ${mediaItems.map((item) => item.type === 'video' ? 'فيديو' : 'صورة').join(' + ')}</b>`);
  if (d.border && BORDER_REGIONS[d.border]) lines.push(`🛂 <b>${esc(lang === 'en' ? BORDER_REGIONS[d.border].en : BORDER_REGIONS[d.border].ar)}</b>`);
  if (d.type === 'helicopter') lines.push(d.intense === true ? (lang === 'en' ? '🚁🚁 <b>Intensive flight — two helicopters</b>' : '🚁🚁 <b>تحليق مكثف — مروحيتان</b>') : (lang === 'en' ? '🚁 <b>One helicopter</b>' : '🚁 <b>مروحية واحدة</b>'));
  if (d.type === 'military_incursion' && Number.isInteger(d.vehicleCount) && d.vehicleCount > 0) {
    lines.push(`🚙 <b>${lang === 'en' ? 'Vehicle count' : 'عدد الآليات'}:</b> ${esc(vehicleCountPhrase(d.vehicleCount, lang))}`);
  }
  if (d.type === 'air_movement') {
    const aircraft = FLIGHT_AIRCRAFT[d.aircraft];
    const direction = FLIGHT_DIRECTIONS[d.flightDirection];
    if (aircraft) lines.push(`✈️ <b>${esc(lang === 'en' ? aircraft.en : aircraft.ar)}</b>`);
    if (direction) lines.push(`➜ <b>${esc(lang === 'en' ? direction.en : direction.ar)}</b>`);
  }
  if (d.type === 'breaking') lines.push('', esc(d.text || ''));
  if (d.type === 'air_movement' && (!loc || loc.scope === 'country')) {
    lines.push('', lang === 'en' ? '📍 No observed location selected — no map pin' : '📍 لم يُحدّد موقع الرصد — بلا دبوس على الخريطة');
    if (d.flightTarget?.scope === 'country') lines.push(lang === 'en'
      ? '↗️ General direction only; no precise route line will be drawn.'
      : '↗️ اتجاه عام فقط؛ لن يُرسم خط جغرافي بلا وجهة دقيقة.');
  } else if (d.type === 'air_movement' && d.flightTarget) {
    const general = d.flightTarget.scope === 'country';
    if (d.flightRouteOrigin === 'israel_approx_reference' && d.flightTarget.scope === 'governorate') {
      const israel = lang === 'en' ? 'Israel' : 'إسرائيل';
      if (d.flightDirection === 'leaving_syria') {
        const departureLabel = lang === 'en' ? 'Departure area' : 'منطقة الانطلاق';
        const destinationLabel = lang === 'en' ? 'Approx. reference destination' : 'وجهة مرجعية تقريبية';
        lines.push('', `📍 <b>${departureLabel}:</b> ${esc(locName(d.flightTarget, lang))}`);
        lines.push(`🎯 <b>${destinationLabel}:</b> ${esc(israel)}`);
      } else {
        const originLabel = lang === 'en' ? 'Approx. reference origin' : 'نقطة مرجعية تقريبية';
        const destinationLabel = lang === 'en' ? 'Destination' : 'الوجهة';
        lines.push('', `📍 <b>${originLabel}:</b> ${esc(israel)}`);
        lines.push(`🎯 <b>${destinationLabel}:</b> ${esc(locName(d.flightTarget, lang))}`);
      }
    } else {
      const originLabel = lang === 'en' ? 'Approximate observation point' : 'نقطة رصد تقريبية';
      const destinationLabel = lang === 'en' ? 'Destination' : 'الوجهة';
      lines.push('', `📍 <b>${originLabel}:</b> ${esc(locName(loc, lang))}`);
      lines.push(`🎯 <b>${destinationLabel}:</b> ${esc(locName(d.flightTarget, lang))}`);
    }
    if (general) lines.push(lang === 'en'
      ? '↗️ General direction only; no precise route line will be drawn.'
      : '↗️ اتجاه عام فقط؛ لن يُرسم خط جغرافي بلا وجهة دقيقة.');
    lines.push(lang === 'en'
      ? 'Illustrative direction only — not live tracking.'
      : 'اتجاه توضيحي فقط — وليس تتبعاً مباشراً.');
  } else if (d.type === 'political' && (!loc || loc.scope === 'country')) {
    lines.push('', lang === 'en' ? '📍 No verified location — no map pin' : '📍 موقع غير محدد — دون دبوس');
  } else if (d.extra?.length) {
    lines.push('', `📍 <b>${lang === 'en' ? `Areas (${d.extra.length + 1})` : `المناطق (${d.extra.length + 1})`}:</b>`);
    for (const x of [loc, ...d.extra]) lines.push(`• ${esc(locName(x, lang))}`);
  } else lines.push('', `📍 <b>${l.locLabel}:</b> ${esc(loc ? locName(loc, lang) : (lang === 'en' ? 'Syria' : 'سوريا'))}`);
  if (d.type !== 'breaking' && d.details) lines.push(`📝 <b>${l.detailsLabel}:</b> ${esc(d.details)}`);
  if (d.type === 'political') {
    const category = POLITICAL_CATEGORIES[politicalCategory(d.politicalCategory)];
    if (category) lines.push(`🏛 <b>${lang === 'en' ? 'Category' : 'الفئة'}:</b> ${esc(lang === 'en' ? category.en : category.ar)}`);
    lines.push(lang === 'en'
      ? '⚠️ Opinion or analysis is not news; report verifiable developments only.'
      : '⚠️ الرأي أو التحليل ليس خبراً؛ أدرج تطوراً قابلاً للتحقق فقط.');
  }
  if (['breaking', 'political'].includes(d.type)) lines.push(lang === 'en'
    ? '⚖️ Attribute claims to the speaker/institution stated in the story; preserve uncertainty and supplied context. Opinion is separate and clearly labeled; do not invent replies or balance.'
    : '⚖️ انسب الادعاء إلى المتحدث أو المؤسسة المذكورة في الخبر، واحفظ الشك والسياق المتاح. الرأي منفصل وموسوم بوضوح؛ لا تخترع ردوداً أو توازناً.');
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
  // This shared keyboard serves both the private publishing bot and the public reporting bot.
  const menuItems = [
    { type: 'breaking', callback: 't:breaking' },
    { type: 'political', callback: 't:political' },
    { group: 'aerial', callback: 'ag:aerial' },
    { group: 'targeting', callback: 'target' },
    { group: 'strikes', callback: 'ag:strikes' },
    { type: 'military_incursion', callback: 'mi' },
    { type: 'patrol', callback: 't:patrol' },
    { type: 'signal_sweep', callback: 't:signal_sweep' },
    { group: 'protests', callback: 'ag:protests' },
    { group: 'civil', callback: 'cv' },
    { group: 'smuggling', callback: 'sm' },
    { group: 'nature', callback: 'ag:nature' },
    { type: 'border', callback: 't:border' },
  ];
  const kb = new InlineKeyboard();
  for (let i = 0; i < menuItems.length; i += 2) {
    for (const item of menuItems.slice(i, i + 2)) {
      const label = item.group ? reportGroupLabel(item.group, lang) : quoteButtonLabel(alertButtonLabel(item.type, lang), lang);
      kb.text(label, item.callback);
    }
    kb.row();
  }
  kb.text(lang === 'en' ? '🛣 Road status' : '🛣 حالة طريق', 'rd');
  if (staff(ctx)) kb.text(lang === 'en' ? '🛂 Border crossings' : '🛂 المعابر', 'bd').row();
  else kb.url(lang === 'en' ? '🛂 Border crossings' : '🛂 حالة المعابر', `${(config.publicUrl || 'https://red-alert-syria.onrender.com').replace(/\/$/, '')}/${lang === 'en' ? 'en' : 'ar'}/#borders`).row();
  if (roleOf(ctx) === 'report' && !staff(ctx)) {
    const site = (config.publicUrl || 'https://red-alert-syria.onrender.com').replace(/\/$/, '');
    kb.url(lang === 'en' ? '🔎 Find a job' : '🔎 أبحث عن عمل', `${site}/${lang === 'en' ? 'en' : 'ar'}/#jobs`)
      .text(lang === 'en' ? '💼 Post a vacancy' : '💼 مطلوب موظف', 'j:new').row();
  }
  if (staff(ctx)) kb.text(l.btnActive, 'active').text(l.btnClear, 'clr').row().text(l.btnLang, 'lang').row();
  else kb.text(l.btnLang, 'lang').row();
  if (alnabaOwner(ctx)) kb.text(lang === 'en' ? '📰 Al-Nabaa publishing' : '📰 إدارة النبأ', 'nb:open').row();
  if (owner(ctx)) {
    kb.text(l.btnEditors, 'editors').text(l.btnStats, 'stats').row()
      .text(l.btnAuto(store.autoDeleteHours), 'auto').text(lang === 'en' ? '🔁 Project hand-over' : '🔁 نقل المشروع', 'xf').row()
      .text(lang === 'en' ? '📞 Contact links' : '📞 روابط التواصل', 'ct').text(lang === 'en' ? '💝 Website support' : '💝 الدعم في الموقع', 'sp').row()
      .text(lang === 'en' ? '📡 News monitor' : '📡 الرصد الإخباري', 'nws').row()
      .text(lang === 'en' ? '💼 Job listings admin' : '💼 إدارة إعلانات الوظائف', 'j:admin').row()
      .text(lang === 'en' ? '🏛 Syrian Army & salaries' : '🏛 الجيش السوري والرواتب', 'army:menu').row()
      .text(lang === 'en' ? '💱 Prices bulletin' : '💱 نشرة الأسعار', 'px').text(lang === 'en' ? '🔄 Refresh rates' : '🔄 تحديث الأسعار', 'px:refresh').row()
      .text(lang === 'en' ? '⚡ Electricity' : '⚡ الكهرباء', 'pwr').row()
      .text(lang === 'en' ? '🌍 Earthquakes' : '🌍 الزلازل', 'qk').text(lang === 'en' ? '⛈ Weather warnings' : '⛈ تحذيرات الطقس', 'wx').row()
      .text(lang === 'en' ? '🌤 Weather bulletin' : '🌤 نشرة الطقس', 'wxb').row();
  }
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
  if (d.selectingFlightTarget) kb.text(lang === 'en' ? '➡️ Keep direction only' : '➡️ اتجاه عام بلا منطقة', 'flightdest:none').row();
  if (d.type === 'breaking') kb.text(l.btnNoLocation, 'noloc').row();
  if (d.type === 'political') kb.text(lang === 'en' ? '📍 No verified location — no map pin' : '📍 موقع غير محدد — دون دبوس', 'pol:nopin').row();
  kb.text(l.btnCancel, 'cancel');
  return kb;
}

function distKeyboard(ctx, gov) {
  const l = L(ctx);
  const lang = langOf(ctx);
  const g = getGov(gov);
  const kb = new InlineKeyboard().text(l.btnWholeGov(lang === 'en' ? g.en : g.ar), 'wg:' + gov).row();
  const cap = gov !== '08' && capitalOf(gov);
  if (cap) kb.text(centerBtn(cap, lang), 'p:' + cap.id).row();
  else if (gov === '08') kb.text(lang === 'en' ? '📍 Approx. centre of Rif Dimashq' : '📍 مركز تقريبي لريف دمشق', 'gc:' + gov).row();
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
  const c0 = centerOfDist(dist);
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
  const c1 = sub ? centerOfSub(dist, sub) : centerOfDist(dist);
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
  const c2 = !page && !letter && (sub ? centerOfSub(dist, sub) : centerOfDist(dist));
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
  const mediaItems = sanitizeAlertMediaItems(Array.isArray(d.media_items) && d.media_items.length ? d.media_items : d.media);
  if (d.mode === 'report') kb.text(l.btnSubmit, 'submit').row();
  else if (d.mode === 'edit_published') kb.text(enx ? '✅ Save format edit' : '✅ حفظ تعديل الصيغة', 'save_edit').row();
  else if (d.type === 'road') kb.text(enx ? '🗺 Publish on the map' : '🗺 نشر على الخريطة', 'publish').row().text(enx ? '📢 Map + channel' : '📢 الخريطة + القناة', 'publish:ch').row();
  else kb.text(l.btnPublish, 'publish').row();
  kb.text(mediaItems.length ? l.btnReplaceMedia : l.btnAddMedia, 'attachmedia').row();
  if (mediaItems.length) kb.text(l.btnRemoveMedia, 'removemedia').row();
  kb.text(l.btnDuration(d.ttlMin), 'dur').row();
  // drones: "تحليق مكثف" = 2-3 drones over every circle on the map instead of one
  if (d.type === 'uav' && d.mode !== 'report') {
    const on = typeof d.intense === 'boolean' ? d.intense : droneAuto(d.details) > 1;
    kb.text(enx ? `${ALERT_TYPES.uav.emoji} Intensive flight: ${on ? '✅ on' : '⬜ off'}` : `${ALERT_TYPES.uav.emoji} تحليق مكثف: ${on ? '✅ مفعّل' : '⬜ لا'}`, 'intense').row();
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

// Notices and conversation history remain in the private bot chat; navigation never deletes them.
async function sendTransient(api, chatId, text, extra = {}) {
  try {
    return await api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true }, ...extra });
  } catch { return null; }
}
function clearTransientFor() { /* retained intentionally */ }

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
  activeMediaSessions.delete(sk(ctx));
  const d = {
    type,
    mode: staff(ctx) ? 'publish' : 'report',
    step: type === 'political' ? 'political_category' : type === 'military_incursion' ? 'incursion_kind' : type === 'patrol' ? 'patrol_form' : type === 'signal_sweep' ? 'signal_platform' : type === 'breaking' ? 'text' : type === 'border' ? 'border' : type === 'air_movement' ? 'aircraft' : ['uav', 'warplane'].includes(type) ? 'flightmode' : 'gov',
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

function vehicleCountKeyboard(ctx) {
  const en = langOf(ctx) === 'en';
  const kb = new InlineKeyboard();
  for (const count of VEHICLE_COUNT_OPTIONS) {
    kb.text(String(count), `vehc:${count}`);
    if (count % 4 === 0) kb.row();
  }
  kb.text(en ? '✍️ Other number' : '✍️ عدد آخر', 'vehc:custom').row();
  kb.text(L(ctx).btnCancel, 'cancel');
  return kb;
}
function vehicleCountInputKeyboard(ctx) {
  const en = langOf(ctx) === 'en';
  return new InlineKeyboard()
    .text(en ? '↩️ Preset counts' : '↩️ الأعداد الجاهزة', 'vehc:back')
    .text(L(ctx).btnCancel, 'cancel');
}
async function askVehicleCount(ctx, d) {
  d.incursionKind = 'vehicles';
  d.step = 'vehicle_count';
  const en = langOf(ctx) === 'en';
  await show(ctx, en ? '🚙 <b>Military vehicle incursion</b>\n\nChoose the number of vehicles:' : '🚙 <b>توغّل آليات عسكرية</b>\n\nاختر عدد الآليات:', vehicleCountKeyboard(ctx));
}
async function askMilitaryIncursionKind(ctx, d) {
  if (d) d.step = 'incursion_kind';
  const en = langOf(ctx) === 'en';
  const kb = new InlineKeyboard()
    .text(en ? '🪖 Soldiers' : '🪖 جنود', 'mi:soldiers')
    .text(en ? '🚙 Military vehicles' : '🚙 آليات عسكرية', 'mi:vehicles').row()
    .text(en ? '🚧 Military checkpoint' : '🚧 حاجز', 'mi:barrier').row()
    .text(L(ctx).btnCancel, 'cancel');
  await show(ctx, en ? 'Choose what the military incursion consists of:' : 'اختر ما يتكوّن منه التوغل العسكري:', kb);
}
async function askPatrolForm(ctx, d) {
  d.step = 'patrol_form';
  const en = langOf(ctx) === 'en';
  const kb = new InlineKeyboard()
    .text(en ? 'Single patrol' : 'دورية واحدة', 'pt:singular')
    .text(en ? 'Multiple patrols' : 'عدة دوريات', 'pt:plural').row()
    .text(quoteButtonLabel(alertButtonLabel('kidnapping', en ? 'en' : 'ar'), en ? 'en' : 'ar'), 't:kidnapping').row()
    .text(L(ctx).btnCancel, 'cancel');
  await show(ctx, en ? 'Choose the patrol count:' : 'اختر عدد الدوريات:', kb);
}
async function askSignalPlatform(ctx, d) {
  d.step = 'signal_platform';
  const en = langOf(ctx) === 'en';
  const kb = new InlineKeyboard()
    .text(en ? '🛩️ Drone' : '🛩️ مسيّرة', 'ss:uav').row()
    .text(en ? 'No platform specified' : 'بدون تحديد وسيلة الرصد', 'ss:none').row()
    .text(L(ctx).btnCancel, 'cancel');
  await show(ctx, en ? '📡 Signal sweep: choose the reported platform, or leave it unspecified.' : '📡 رصد/مسح الإشارة: اختر الوسيلة المذكورة في البلاغ، أو اتركها بلا تحديد.', kb);
}
async function askVehicleCountInput(ctx, d) {
  d.step = 'vehicle_count_input';
  const en = langOf(ctx) === 'en';
  await show(ctx, en ? 'Send a whole number from 1 to 999.' : 'أرسل عدد الآليات كرقم صحيح من 1 إلى 999.', vehicleCountInputKeyboard(ctx));
}

async function askLocation(ctx, d) {
  d.step = 'gov';
  const en = langOf(ctx) === 'en';
  const head = d.adding ? (en ? `➕ <b>Add another area</b> (${(d.extra?.length || 0) + 1} selected so far)\n\n` : `➕ <b>إضافة منطقة أخرى</b> (المحدد حتى الآن: ${(d.extra?.length || 0) + 1})\n\n`) : '';
  const aircraft = FLIGHT_AIRCRAFT[d.aircraft] || FLIGHT_AIRCRAFT[d.type];
  const targetPrompt = d.selectingFlightOrigin
    ? (en
      ? `📍 Choose the approximate observation point for this route. Send a pinned map location; it may be outside Syria. This is not a live aircraft position.${aircraft ? ` (${esc(aircraft.en)})` : ''}`
      : `📍 اختر <b>نقطة رصد تقريبية</b> لهذا المسار بإرسال نقطة تختارها من خريطة تيليغرام، ويمكن أن تكون خارج سوريا. هذه نقطة البلاغ وليست موقعاً مباشراً للطائرة.${aircraft ? ` (${esc(aircraft.ar)})` : ''}`)
    : d.selectingFlightTarget
    ? (en
      ? `📍 Choose the destination area.${aircraft ? ` (${esc(aircraft.en)})` : ''}`
      : `📍 اختر منطقة الوجهة.${aircraft ? ` (${esc(aircraft.ar)})` : ''}`)
    : head + L(ctx).askGov(`<b>${esc(draftTypeLabel(d, langOf(ctx)))}</b>`);
  const quantity = d.type === 'military_incursion' && Number.isInteger(d.vehicleCount) && d.vehicleCount > 0
    ? `\n\n🚙 <b>${en ? 'Vehicle count' : 'عدد الآليات'}:</b> ${esc(vehicleCountPhrase(d.vehicleCount, langOf(ctx)))}`
    : '';
  await show(ctx, `${targetPrompt}${quantity}`, govKeyboard(ctx, d));
}
async function askBorder(ctx, d) {
  d.step = 'border';
  const en = langOf(ctx) === 'en';
  const kb = new InlineKeyboard();
  for (const [key, name] of Object.entries(BORDER_REGIONS)) kb.text(`🛂 ${en ? name.en : name.ar}`, `bsel:${key}`).row();
  kb.text(L(ctx).btnCancel, 'cancel');
  await show(ctx, en ? 'Choose the border section for this report:' : 'اختر الحدود المقصودة لهذا البلاغ:', kb);
}
async function askAerialMode(ctx, d) {
  d.step = 'flightmode';
  const en = langOf(ctx) === 'en';
  const aircraft = d.type === 'uav' ? ALERT_TYPES.uav.emoji : ALERT_TYPES.warplane.emoji;
  const kb = new InlineKeyboard()
    .text(en ? `${aircraft} Hovering over the area` : `${aircraft} تحليق فوق المنطقة`, 'airmode:over').row();
  kb.text(L(ctx).btnCancel, 'cancel');
  const prompt = en ? 'Choose the reported aerial activity.' : 'اختر نوع النشاط الجوي المرصود.';
  await show(ctx, prompt, kb);
}
async function askHelicopterIntensity(ctx, d) {
  d.step = 'helicopter_intensity';
  const en = langOf(ctx) === 'en';
  const kb = new InlineKeyboard()
    .text(en ? '🚁 One helicopter' : '🚁 مروحية واحدة', 'heli:intensity:normal').row()
    .text(en ? '🚁🚁 Intensive — two helicopters' : '🚁🚁 تحليق مكثف — مروحيتان', 'heli:intensity:high').row()
    .text(L(ctx).btnCancel, 'cancel');
  await show(ctx, en ? 'Choose the observed helicopter activity:' : 'حدّد عدد المروحيات المرصودة:', kb);
}
async function askAirstrikeForm(ctx, d) {
  d.step = 'airstrike_form';
  const en = langOf(ctx) === 'en';
  const kb = new InlineKeyboard()
    .text(en ? '💥 Airstrike (one)' : '💥 غارة جوية', 'as:singular').row()
    .text(en ? '💥 Airstrikes (multiple)' : '💥 غارات جوية', 'as:plural').row()
    .text(L(ctx).btnCancel, 'cancel');
  await show(ctx, en ? 'Choose the airstrike wording:' : 'اختر صيغة البلاغ:', kb);
}
async function askFlightDirection(ctx, d) {
  d.step = 'flight';
  const en = langOf(ctx) === 'en';
  const kb = new InlineKeyboard();
  for (const key of ['toward_syria', 'entering_syria', 'leaving_syria']) {
    const name = FLIGHT_DIRECTIONS[key];
    kb.text(`✈️ ${en ? name.en : name.ar}`, `flight:${key}`).row();
  }
  kb.text(L(ctx).btnCancel, 'cancel');
  await show(ctx, en
    ? 'Choose a direction. A selected Syrian governorate is connected by an illustrative line to an approximate reference point inside Israel; withdrawal reverses the direction. This is not a confirmed or live track.'
    : 'اختر الاتجاه. عند تحديد محافظة سورية يظهر خط توضيحي بينها وبين نقطة مرجعية تقريبية داخل إسرائيل، وينعكس اتجاهه عند الانسحاب. هذا ليس مساراً مؤكداً أو تتبعاً مباشراً.', kb);
}
async function askFlightDestination(ctx, d) {
  d.step = 'flight_destination';
  const en = langOf(ctx) === 'en';
  const kb = new InlineKeyboard()
    .text(en ? '🇸🇾 Syria (general direction)' : '🇸🇾 سوريا — اتجاه عام', 'flightto:syria').row();
  governorates.forEach((g, i) => {
    kb.text(`📍 ${en ? g.en : g.ar}`, `flightto:${g.code}`);
    if (i % 2 === 1 && i < governorates.length - 1) kb.row();
  });
  const changeLabel = d.flightRouteOrigin === 'israel_approx_reference'
    ? (en ? '↩️ Change movement direction' : '↩️ تغيير اتجاه الحركة')
    : (en ? '↩️ Change approximate observation point' : '↩️ تغيير نقطة رصد تقريبية');
  kb.row().text(changeLabel, 'flightto:back').text(L(ctx).btnCancel, 'cancel');
  await show(ctx, en
    ? (d.flightRouteOrigin === 'israel_approx_reference'
      ? 'Choose a destination. A governorate draws an illustrative line from an approximate reference point inside Israel; “Syria (general)” has no endpoint. This is not a live track.'
      : 'Choose a destination. The line will use the selected observation point; “Syria (general)” has no precise endpoint.')
    : (d.flightRouteOrigin === 'israel_approx_reference'
      ? 'اختر الوجهة. اختيار محافظة يرسم خطاً توضيحياً من نقطة مرجعية تقريبية داخل إسرائيل؛ «سوريا — اتجاه عام» بلا نقطة نهاية. هذا ليس تتبعاً مباشراً.'
      : 'اختر الوجهة. سيستخدم الخط نقطة الرصد التي اخترتها؛ خيار «سوريا — اتجاه عام» لا يحدد نقطة نهاية دقيقة.'), kb);
}
async function askFlightAircraft(ctx, d) {
  d.step = 'aircraft';
  const en = langOf(ctx) === 'en';
  const kb = new InlineKeyboard();
  for (const [key, name] of Object.entries(FLIGHT_AIRCRAFT)) kb.text(`✈️ ${en ? name.en : name.ar}`, `flightair:${key}`).row();
  kb.text(L(ctx).btnCancel, 'cancel');
  await show(ctx, en ? 'Choose the aircraft type for this movement:' : 'اختر نوع الطائرة في بلاغ الحركة الجوية:', kb);
}
async function askCivilEmoji(ctx, d) {
  d.step = 'civilEmoji';
  const en = langOf(ctx) === 'en';
  const kb = new InlineKeyboard();
  let i = 0;
  for (const [key, choice] of Object.entries(CIVIL_EMOJIS)) {
    kb.text(`${choice.emoji} ${en ? choice.en : choice.ar}`, `ce:${key}`);
    if (++i % 2 === 0) kb.row();
  }
  if (i % 2) kb.row();
  kb.text(L(ctx).btnCancel, 'cancel');
  await show(ctx, en ? 'Choose the icon for this civil alert:' : 'اختر الرمز الذي سيظهر مع هذا البلاغ المدني:', kb);
}
async function askPoliticalCategory(ctx, d) {
  d.step = 'political_category';
  const en = langOf(ctx) === 'en';
  const kb = new InlineKeyboard();
  for (const [key, label] of Object.entries(POLITICAL_CATEGORIES)) kb.text([label.emoji, en ? label.en : label.ar].filter(Boolean).join(' '), `pcat:${key}`).row();
  kb.text(L(ctx).btnCancel, 'cancel');
  await show(ctx, en
    ? '🏛 <b>Political development</b>\n\nChoose the category. Opinions and analysis are not news.'
    : '🏛 <b>تطور سياسي</b>\n\nاختر الفئة. الرأي والتحليل ليسا خبراً.', kb);
}
async function askPoliticalLocationMode(ctx, d) {
  d.step = 'political_location_mode';
  const en = langOf(ctx) === 'en';
  const kb = new InlineKeyboard()
    .text(en ? '📰 General political news — no location or pin (default)' : '📰 خبر سياسي عام — بلا موقع أو دبوس (الخيار الافتراضي)', 'pol:general').row()
    .text(en ? '📍 Choose a verified location' : '📍 تحديد موقع مؤكد من القوائم', 'pol:location').row()
    .text(L(ctx).btnBack, 'pol:category').text(L(ctx).btnCancel, 'cancel');
  await show(ctx, en
    ? 'Choose whether this development has a verified location. The default is general news with no map pin.'
    : 'اختر إن كان للتطور موقع مؤكد. الخيار الافتراضي خبر عام بلا دبوس على الخريطة.', kb);
}
const locKey = (x) => (x ? `${x.scope}:${x.place_id || x.district || x.governorate || ''}:${Number(x.latitude).toFixed(3)},${Number(x.longitude).toFixed(3)}` : '');
// a picked location: either the alert's (first) area, or one more area added from the preview
async function pickLocation(ctx, d, loc) {
  if (!loc) return;
  if (d.selectingFlightOrigin) {
    d.selectingFlightOrigin = false;
    d.selectingFlightTarget = true;
    d.location = loc;
    d.extra = [];
    return askFlightDestination(ctx, d);
  }
  if (d.selectingFlightTarget) {
    d.selectingFlightTarget = false;
    d.flightTarget = loc;
    d.location = loc;
    d.extra = [];
    return afterLocation(ctx, d);
  }
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

function detailsExample(ctx, d) {
  if (d.type !== 'border') return '';
  return langOf(ctx) === 'en'
    ? 'military build-up, a crossing closure, or clashes near the border'
    : 'تعزيزات عسكرية أو إغلاق معبر أو اشتباكات قرب الحدود';
}

async function afterLocation(ctx, d) {
  if (d.mode === 'active_edit') return showActiveEditForm(ctx, d);
  if (d.type === 'breaking' || d.details) return showPreview(ctx, d);
  d.step = 'details';
  if (d.type === 'road') {
    const en = langOf(ctx) === 'en';
    const kb0 = new InlineKeyboard().text(L(ctx).btnSkip, 'skip').row().text(L(ctx).btnBack, 'back:gov').text(L(ctx).btnCancel, 'cancel');
    return show(ctx, en ? `<b>${esc(roadLabel(d.road, 'en'))}</b> — ${esc(locName(d.location, 'en'))}\n\n📝 Write a short description, e.g. <i>closed at the bridge entrance because of …</i>, or skip.` : `<b>${esc(roadLabel(d.road, 'ar'))}</b> — ${esc(locName(d.location, 'ar'))}\n\n📝 اكتب وصف مختصر، مثلاً: <i>مسكّر عند مدخل الجسر بسبب …</i> أو <i>في حاجز تفتيش وازدحام</i>، أو اضغط «تخطي».`, kb0);
  }
  const backKey = d.type === 'border' ? 'back:border' : d.type === 'air_movement' ? 'back:flight' : 'back:gov';
  const kb = new InlineKeyboard().text(L(ctx).btnSkip, 'skip').row().text(L(ctx).btnBack, backKey).text(L(ctx).btnCancel, 'cancel');
  const detailsLocation = d.type === 'air_movement' && d.location?.scope === 'country'
    ? (langOf(ctx) === 'en' ? 'general direction (no place or map pin)' : 'اتجاه عام — بلا تحديد منطقة أو دبوس خريطة')
    : locName(d.location, langOf(ctx));
  await show(ctx, L(ctx).askDetails(`<b>${esc(draftTypeLabel(d, langOf(ctx)))}</b>`, esc(detailsLocation), detailsExample(ctx, d)), kb);
}

async function showPreview(ctx, d) {
  d.step = 'preview';
  const l = L(ctx);
  await show(ctx, `${d.mode === 'report' ? l.previewReport : l.preview}\n\n${draftSummary(d, langOf(ctx))}`, previewKeyboard(ctx, d));
}

export function buildAlertInput(d, author) {
  assertPublicCopySafe(d?.title, d?.title_en, d?.headline, d?.body, d?.text, d?.details, d?.description, d?.description_en);
  const incursionKind = d.type === 'military_incursion'
    ? (d.incursionKind === 'vehicles' || Number.isInteger(d.vehicleCount) ? 'vehicles' : ['soldiers', 'barrier'].includes(d.incursionKind) ? d.incursionKind : null)
    : null;
  const patrolForm = d.type === 'patrol' ? (d.patrolForm === 'plural' ? 'plural' : 'singular') : null;
  const signalPlatform = d.type === 'signal_sweep' && d.signalPlatform === 'uav' ? 'uav' : null;
  const dronePresence = d.meta?.dronePresence === true;
  const titles = d.type === 'airstrike' && d.airstrikeForm === 'plural'
    ? { ar: 'غارات جوية', en: 'Airstrikes' }
    : d.type === 'patrol'
      ? (patrolForm === 'plural' ? { ar: 'دوريات', en: 'Patrols' } : { ar: 'دورية', en: 'Patrol' })
      : d.type === 'military_incursion' && incursionKind === 'soldiers'
        ? { ar: 'توغل جنود', en: 'Soldier incursion' }
      : d.type === 'military_incursion' && incursionKind === 'vehicles'
        ? { ar: 'توغل آليات عسكرية', en: 'Military vehicle incursion' }
        : d.type === 'military_incursion' && incursionKind === 'barrier'
          ? { ar: 'حاجز عسكري', en: 'Military checkpoint' }
          : d.type === 'military_incursion'
            ? { ar: 'توغل عسكري', en: 'Military incursion' }
    : TITLES[d.type] || { ar: typeOf(d.type).ar, en: typeOf(d.type).en };
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
  const border = BORDER_REGIONS[d.border];
  const flight = d.type === 'air_movement' ? FLIGHT_DIRECTIONS[d.flightDirection] : null;
  const aircraft = d.type === 'air_movement' ? FLIGHT_AIRCRAFT[d.aircraft] : null;
  const flightTarget = d.type === 'air_movement' && d.flightTarget?.scope !== 'country' ? d.flightTarget : null;
  const flightRouteOrigin = d.type === 'air_movement' && d.flightRouteOrigin === 'israel_approx_reference'
    && flightTarget?.scope === 'governorate' && Number.isFinite(flightTarget.latitude) && Number.isFinite(flightTarget.longitude)
    ? 'israel_approx_reference' : null;
  const flightTargetAr = flightTarget ? (d.flightDirection === 'leaving_syria' ? ` — من ${locName(flightTarget, 'ar')}` : ` — نحو ${locName(flightTarget, 'ar')}`) : '';
  const flightTargetEn = flightTarget ? (d.flightDirection === 'leaving_syria' ? ` — from ${locName(flightTarget, 'en')}` : ` — toward ${locName(flightTarget, 'en')}`) : '';
  const vehicleCount = d.type === 'military_incursion' && Number.isInteger(d.vehicleCount) && d.vehicleCount > 0 && d.vehicleCount <= VEHICLE_COUNT_MAX ? d.vehicleCount : null;
  const civilEmoji = d.type === 'civil' && CIVIL_EMOJIS[d.civilEmoji] ? d.civilEmoji : null;
  const politicalMeta = d.type === 'political' ? {
    category: politicalCategory(d.politicalCategory || d.politicalCategoryKey) || null,
    sources: politicalSourcesFor(d),
    sourceTimestamp: sourceIso(d.politicalSourceTimestamp),
  } : null;
  const monitoredSources = d.source === 'news' && d.type !== 'political' ? monitoredSourcesFor(d) : [];
  const privateSourceNames = [
    ...(Array.isArray(d.srcs) ? d.srcs.flatMap((source) => [source?.name, source?.u]) : []),
    ...(Array.isArray(d.politicalSources) ? d.politicalSources.flatMap((source) => [source?.name, source?.u]) : []),
  ].filter(Boolean);
  const mediaItems = sanitizeAlertMediaItems(Array.isArray(d.media_items) && d.media_items.length ? d.media_items : d.media);
  const baseTitle = d.type === 'air_movement'
    ? (aircraft?.ar || titles.ar)
    : wx ? `${titles.ar}: ${wx[0]}${named ? ` — ${loc.name_ar}` : ''}` : named ? `${titles.ar} — ${loc.name_ar}${more(extra.length)}` : titles.ar;
  const baseTitleEn = d.type === 'air_movement'
    ? (aircraft?.en || titles.en)
    : wx ? `${titles.en}: ${wx[1]}${named ? ` — ${loc.name_en}` : ''}` : named ? `${titles.en} — ${loc.name_en}${more(extra.length, true)}` : titles.en;
  return {
    type: d.type,
    title: `${baseTitle}${border ? ` — ${border.ar}` : ''}${flight ? ` — ${flight.ar}` : ''}${flightTargetAr}${vehicleCount ? ` — ${vehicleCountPhrase(vehicleCount, 'ar')}` : ''}${signalPlatform ? ' — مسيّرة' : ''}`,
    title_en: `${baseTitleEn}${border ? ` — ${border.en}` : ''}${flight ? ` — ${flight.en}` : ''}${flightTargetEn}${vehicleCount ? ` — ${vehicleCountPhrase(vehicleCount, 'en')}` : ''}${signalPlatform ? ' — Drone' : ''}`,
    extra,
    description: (d.source === 'news' || ['breaking', 'political'].includes(d.type)
      ? (text) => cleanAttributedNewsText(text, privateSourceNames) : cleanAlertText)(d.type === 'breaking' ? d.text : d.details),
    ...(mediaItems.length ? { media: mediaItems[0], media_items: mediaItems } : {}),
    location: loc,
    areas,
    ttlMin: d.ttlMin,
    source: d.source === 'news' ? 'news' : 'telegram',
    author,
    ...(((d.type === 'uav' || d.type === 'helicopter') && typeof d.intense === 'boolean') || (d.type === 'weather' && d.meta?.hazard) || border || flight || aircraft || (d.type === 'air_movement' && d.flightTarget) || civilEmoji || vehicleCount || incursionKind || patrolForm || signalPlatform || dronePresence || politicalMeta || monitoredSources.length ? {
      meta: {
        ...((d.type === 'uav' || d.type === 'helicopter') && typeof d.intense === 'boolean' ? { intense: d.intense } : {}),
        ...(d.type === 'weather' && d.meta?.hazard ? { hazard: d.meta.hazard } : {}),
        ...(border ? { border: d.border } : {}),
        ...(flight ? { flightDirection: d.flightDirection } : {}),
        ...(aircraft ? { aircraft: d.aircraft } : {}),
        ...(d.type === 'air_movement' && d.flightTarget ? { flightTarget: d.flightTarget } : {}),
        ...(flightRouteOrigin ? { flightRouteOrigin } : {}),
        ...(civilEmoji ? { civilEmoji } : {}),
        ...(vehicleCount ? { vehicleCount } : {}),
        ...(incursionKind ? { incursionKind } : {}),
        ...(patrolForm ? { patrolForm } : {}),
        ...(signalPlatform ? { signalPlatform } : {}),
        ...(dronePresence ? { dronePresence: true } : {}),
        ...(politicalMeta ? { political: politicalMeta } : {}),
        ...(monitoredSources.length ? { newsSources: monitoredSources } : {}),
      },
    } : {}),
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
const plainTelegramText = (value) => String(value ?? '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, String.fromCharCode(34))
  .trim();
function channelEditParts(value) {
  const blocks = String(value || '').trim().split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean);
  const first = blocks.shift() || '';
  const [header = '', ...inlineLines] = first.split('\n');
  const inlineBody = inlineLines.join('\n').trim();
  const sections = [...(inlineBody ? [inlineBody] : []), ...blocks];
  const isMetaBlock = (section) => {
    const lines = section.split('\n').map((line) => line.trim()).filter(Boolean);
    return lines.length > 0 && lines.every((line) => line.startsWith('📍') || /^(تاريخ|الساعة|انتهى|Date|Time|Ended)\s*:/i.test(line));
  };
  return { header: header.trim(), body: sections.filter((section) => !isMetaBlock(section)).join('\n\n').trim() };
}
function isConfiguredChannelMessage(message) {
  if (!config.channel || !message?.chat) return false;
  const channel = String(config.channel);
  if (channel.startsWith('@')) return String(message.chat.username || '').toLowerCase() === channel.slice(1).toLowerCase();
  return String(message.chat.id) === channel;
}
function channelEditPatch(alert, message) {
  const content = String(message.text ?? message.caption ?? '').trim();
  if (!content) return null;
  const opts = { ended: !alert.is_active };
  const expected = plainTelegramText(['photo', 'video'].includes(alert.channel_media) ? channelCaption(alert, opts) : channelPost(alert, opts));
  if (content === expected) return null;
  const previous = channelEditParts(expected);
  const edited = channelEditParts(content);
  const stripIcon = (headline) => {
    let value = headline.trim();
    const symbol = alert.channel_format === 2 ? channelEventSymbol(alert) : alertEmoji(alert);
    const suffix = ` - ${symbol}`;
    if (symbol && value.endsWith(suffix)) value = value.slice(0, -suffix.length).trim();
    if (alert.channel_format === 2) {
      const prefix = `${eventVisual(alert.type).dot} `;
      if (value.startsWith(prefix)) value = value.slice(prefix.length).trim();
    }
    return value;
  };
  const oldHeadline = stripIcon(previous.header);
  const newHeadline = stripIcon(edited.header);
  const patch = {};
  if (newHeadline && newHeadline !== oldHeadline) {
    const channelTitle = cleanAlertText(newHeadline);
    patch.title = channelTitle;
    patch.title_en = '';
    patch.meta = { ...(alert.meta || {}), channelTitle };
  }
  // Compare with the actually published body (which may be caption-truncated), so a title-only edit
  // never replaces a fuller map description with the shorter caption shown in Telegram.
  if (edited.body !== previous.body) {
    patch.description = cleanAlertText(edited.body);
    patch.description_en = '';
  }
  return Object.keys(patch).length ? patch : null;
}
function withDeadline(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(t));
}
/**
 * Change the type of already-published alerts (owner request): map + stored alert + statistics log,
 * and EDIT (never delete/repost) the existing channel post: new title/emoji, new map image, same buttons.
 */
export async function retypeAlerts(api, ids, type, { gapMs = 4000, markerGlyph = null, alertPatch = null } = {}) {
  const out = [];
  const nt = TITLES[type];
  if (!nt || (markerGlyph && markerGlyph !== 'weapon')) return [{ ok: false, why: 'unknown type or marker glyph' }];
  for (const id of ids) {
    const a = store.getAlert(id);
    if (!a) { out.push({ id, ok: false, why: 'alert not found' }); continue; }
    const oldType = a.type;
    const ot = TITLES[a.type];
    const patch = { ...(alertPatch && typeof alertPatch === 'object' ? alertPatch : {}), type };
    if (markerGlyph) patch.marker_glyph = markerGlyph;
    if (ot && a.type !== type) {
      if (typeof a.title === 'string' && a.title.startsWith(ot.ar)) patch.title = nt.ar + a.title.slice(ot.ar.length);
      if (typeof a.title_en === 'string' && a.title_en.startsWith(ot.en)) patch.title_en = nt.en + a.title_en.slice(ot.en.length);
    }
    if (markerGlyph) {
      const b = { ...a, ...patch };
      if (!api || !config.channel || !b.channel_message_id || !['photo', 'video'].includes(b.channel_media)) {
        out.push({ id, ok: false, why: 'existing channel photo unavailable; no map change made' });
        continue;
      }
      const opts = { ended: !b.is_active };
      try {
        if (sanitizeAlertMedia(b.media) || b.channel_media === 'video') {
          await api.editMessageCaption(config.channel, b.channel_message_id, { caption: channelCaption(b, opts), parse_mode: 'HTML', reply_markup: channelKeyboard(b) });
        } else {
          const png = await withDeadline(alertImage(b, 'ar'), 30000);
          try {
            await api.editMessageMedia(config.channel, b.channel_message_id,
              InputMediaBuilder.photo(new InputFile(png, `red-alert-syria-${b.id.slice(0, 8)}.png`), { caption: channelCaption(b, opts), parse_mode: 'HTML' }),
              { reply_markup: channelKeyboard(b) });
          } catch (e) {
            if (!/message is not modified/i.test(String(e.description || e.message || e))) throw e;
          }
        }
        store.updateAlert(id, patch); // emit the live-map update only after the existing photo edit succeeds
        store.persist();
        out.push({ id, ok: true, post: b.channel_message_id });
      } catch (e) {
        const msg = String(e.description || e.message || e);
        out.push({ id, ok: false, post: b.channel_message_id, why: msg });
        console.error(`[glyph] channel edit ${b.channel_message_id}: ${msg}`);
      }
      await new Promise((r) => setTimeout(r, gapMs));
      continue;
    }
    store.updateAlert(id, patch); // live map update
    if (oldType !== type) store._logPatch(id, { ty: type }); // statistics / area pages
    store.persist();
    const b = store.getAlert(id);
    if (!b.channel_message_id || !api || !config.channel) { out.push({ id, ok: true, post: null }); continue; }
    const opts = { ended: !b.is_active };
    try {
      if (b.channel_media === 'photo' && !sanitizeAlertMedia(b.media)) {
        const png = await withDeadline(alertImage(b, 'ar'), 30000);
        await api.editMessageMedia(config.channel, b.channel_message_id,
          InputMediaBuilder.photo(new InputFile(png, `red-alert-syria-${b.id.slice(0, 8)}.png`), { caption: channelCaption(b, opts), parse_mode: 'HTML' }),
          { reply_markup: channelKeyboard(b) });
      } else if (['photo', 'video'].includes(b.channel_media)) {
        await api.editMessageCaption(config.channel, b.channel_message_id, { caption: channelCaption(b, opts), parse_mode: 'HTML', reply_markup: channelKeyboard(b) });
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
/** Update an existing alert and its existing channel post in place. */
export async function editPublishedAlert(api, id, d, author) {
  const current = store.getAlert(id);
  if (!current) throw new Error('published alert not found');
  const input = buildAlertInput(d, author);
  const patch = {
    type: input.type,
    title: input.title,
    title_en: input.title_en,
    description: input.description || '',
    location: input.location?.latitude != null ? { latitude: input.location.latitude, longitude: input.location.longitude } : null,
    place: input.location || null,
    areas: input.areas || [],
    extra: input.extra || [],
    scope: input.location?.scope || 'country',
    meta: { ...(current.meta || {}), ...(input.meta || {}) },
  };
  store.updateAlert(id, patch);
  const updated = store.getAlert(id);
  await refreshChannelPost(api, updated, !updated.is_active);
  return updated;
}
/** add an alert to the map and (unless toChannel=false) post it to the channel */
export async function publishInput(api, input, { toChannel = true, renderSnapshot = null } = {}) {
  assertPublicCopySafe(input?.title, input?.title_en, input?.description, input?.description_en, input?.meta?.channelTitle);
  const alert = store.addAlert(input);
  if (input.meta) alert.meta = input.meta;
  if (!toChannel || !config.channel) return alert;
  // Persist the new public template version; alerts already present in storage keep their legacy headers.
  alert.channel_format = 2;
  store.persist();
  const text = channelPost(alert);
  const extra = { parse_mode: 'HTML', reply_markup: channelKeyboard(alert) };
  let m = null; let media = 'text'; let uncertainMediaSend = false;
  // Attached source media stays on the public map; channel posts use the rendered map snapshot only.
  const snapshotRenderer = typeof renderSnapshot === 'function' ? renderSnapshot : null;
  if ((snapshotRenderer || config.alertImages) && visibleLen(text) <= CAPTION_MAX) {
    const t0 = Date.now();
    try {
      const png = await withDeadline((snapshotRenderer || alertImage)(alert, 'ar'), IMAGE_DEADLINE_MS);
      try {
        m = await api.sendPhoto(config.channel, new InputFile(png, `red-alert-syria-${alert.id.slice(0, 8)}.png`), { caption: text, ...extra });
        media = 'photo';
        console.log(`[img] channel image sent in ${Date.now() - t0} ms (${Math.round(png.length / 1024)} KB)`);
      } catch (e) {
        uncertainMediaSend = !isDefinitiveTelegramRejection(e);
        console.error(`[img] channel image post failed after ${Date.now() - t0} ms:`, e.description || e.message);
      }
    } catch (e) {
      console.error(`[img] image generation failed after ${Date.now() - t0} ms:`, e.description || e.message);
    }
  }
  if (!m && !uncertainMediaSend) {
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
  if (staff(ctx) && alert.is_active) kb.row().text(alert.media ? l.btnReplaceMedia : l.btnAddMedia, 'alertmedia:' + alert.id);
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
  const hasCaption = ['photo', 'video'].includes(alert.channel_media);
  try {
    await (hasCaption ? editCaption() : editText());
  } catch (e) {
    const msg = String(e.description || e.message || '');
    if (msg.includes('not modified')) return;
    // stored kind missing or wrong: Telegram says so explicitly -> edit the other way and remember it
    if (/there is no (text|caption) in the message/i.test(msg)) {
      try {
        await (hasCaption ? editText() : editCaption());
        store.updateAlert(alert.id, { channel_media: hasCaption ? 'text' : 'photo' });
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
const alertMediaCache = new Map();
let alertMediaCacheBytes = 0;
const ALERT_MEDIA_CACHE_MAX = 32 * 1024 * 1024;
async function downloadAlertMediaBuffer(value) {
  const media = sanitizeAlertMedia(value);
  if (!media) throw new Error('invalid alert media');
  const key = `${media.bot_role}:${media.file_unique_id || media.file_id}`;
  const cached = alertMediaCache.get(key);
  if (cached) { alertMediaCache.delete(key); alertMediaCache.set(key, cached); return cached; }
  const api = APIS[media.bot_role];
  const token = TOKENS[media.bot_role];
  if (!api || !token) throw new Error('media source bot unavailable');
  const file = await api.getFile(media.file_id);
  const filePath = String(file?.file_path || '');
  if (!filePath || filePath.startsWith('/') || /[?#\\]/.test(filePath) || filePath.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('invalid Telegram file path');
  const url = `https://api.telegram.org/file/bot${token}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response;
  let buffer;
  try {
    response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('Telegram media download failed');
    const declaredSize = Number(response.headers.get('content-length') || file.file_size || media.file_size || 0);
    if (declaredSize > ALERT_MEDIA_MAX_BYTES) throw new Error('Telegram media exceeds size limit');
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > ALERT_MEDIA_MAX_BYTES) throw new Error('Telegram media exceeds size limit');
      chunks.push(Buffer.from(chunk));
    }
    buffer = Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timeout);
  }
  if (buffer.length && buffer.length <= ALERT_MEDIA_CACHE_MAX) {
    while (alertMediaCacheBytes + buffer.length > ALERT_MEDIA_CACHE_MAX && alertMediaCache.size) {
      const oldestKey = alertMediaCache.keys().next().value;
      const oldest = alertMediaCache.get(oldestKey);
      alertMediaCache.delete(oldestKey);
      alertMediaCacheBytes -= oldest.length;
    }
    alertMediaCache.set(key, buffer);
    alertMediaCacheBytes += buffer.length;
  }
  return buffer;
}
async function alertMediaInput(value, targetRole = 'admin') {
  const media = sanitizeAlertMedia(value);
  if (!media) throw new Error('invalid alert media');
  if (media.bot_role === targetRole) return media.file_id;
  const buffer = await downloadAlertMediaBuffer(media);
  const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' })[media.mime_type] || (media.type === 'photo' ? 'jpg' : 'mp4');
  return new InputFile(buffer, `red-alert-${media.type}.${extension}`);
}
function mediaFromTelegramMessage(message, type, botRole) {
  const item = type === 'photo' ? message?.photo?.at(-1) : message?.video;
  return sanitizeAlertMedia(item?.file_id ? {
    type,
    file_id: item.file_id,
    file_unique_id: item.file_unique_id,
    bot_role: botRole,
    mime_type: type === 'video' ? item.mime_type || 'video/mp4' : 'image/jpeg',
    file_size: item.file_size,
  } : null);
}
function mediaFromSentMessage(message, type, fallback, botRole = 'admin') {
  const item = type === 'photo' ? message?.photo?.at(-1) : message?.video;
  return item?.file_id ? (sanitizeAlertMedia({
    ...fallback,
    file_id: item.file_id,
    file_unique_id: item.file_unique_id,
    bot_role: botRole,
    mime_type: type === 'video' ? item.mime_type || 'video/mp4' : 'image/jpeg',
    file_size: item.file_size,
  }) || fallback) : fallback;
}
export async function fetchAlertMediaFile(id, requestedType = null) {
  const alert = store.getAlert(id);
  const available = sanitizeAlertMediaItems(Array.isArray(alert?.media_items) && alert.media_items.length ? alert.media_items : alert?.media);
  const media = requestedType ? available.find((item) => item.type === requestedType) : available[0];
  if (!alert || !media) return null;
  const buffer = await downloadAlertMediaBuffer(media);
  const projected = publicAlert(alert);
  const publicMedia = projected.media_items?.find((item) => item.type === media.type) || projected.media;
  return { buffer, contentType: media.mime_type, etag: `"${publicMedia.version}"` };
}
function updateAlertChannelMedia(_api, alert, mediaValue) {
  const media = sanitizeAlertMedia(mediaValue);
  if (!media || !alert?.id) return { ok: false, noMedia: true };
  const existing = Array.isArray(alert.media_items) && alert.media_items.length ? alert.media_items : alert.media;
  const mediaItems = mergeAlertMediaItems(existing, media, { replaceSameType: true });
  store.updateAlert(alert.id, { media_items: mediaItems });
  return { ok: true, mapOnly: true };
}
runtimeHooks.restoreApi = (role, old) => { APIS[role] = old.api; TOKENS[role] = old.token; };
const RELAY_KINDS = { photo: 'sendPhoto', video: 'sendVideo', voice: 'sendVoice', audio: 'sendAudio', document: 'sendDocument', animation: 'sendAnimation', video_note: 'sendVideoNote', sticker: 'sendSticker' };
const relayRate = new Map();
async function relayCopy(fromApi, fromToken, toApi, chatId, msg, header, footer) {
  const kind = Object.keys(RELAY_KINDS).find((k) => msg[k]);
  const body = msg.text || msg.caption || '';
  const txt = `${header}${body ? `\n\n${esc(body)}` : ''}${footer ? `\n\n${footer}` : ''}`;
  const relayResult = (message, extraIds = []) => ({ ...message, _relayedIds: [...new Set([...extraIds, message?.message_id].filter(Boolean))] });
  if (!kind) return relayResult(await toApi.sendMessage(chatId, txt.slice(0, 4096), { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, _keep: 'r' }));
  const fileId = kind === 'photo' ? msg.photo[msg.photo.length - 1].file_id : msg[kind].file_id;
  const f = await fromApi.getFile(fileId);
  const res = await fetch(`https://api.telegram.org/file/bot${fromToken}/${f.file_path}`);
  if (!res.ok) throw new Error('file download failed');
  const file = new InputFile(Buffer.from(await res.arrayBuffer()), msg.document?.file_name || f.file_path.split('/').pop());
  if (kind === 'video_note' || kind === 'sticker') {
    const media = await toApi[RELAY_KINDS[kind]](chatId, file, { _keep: 'r' });
    const caption = await toApi.sendMessage(chatId, txt.slice(0, 4096), { parse_mode: 'HTML', _keep: 'r' });
    return relayResult(caption, [media?.message_id]);
  }
  return relayResult(await toApi[RELAY_KINDS[kind]](chatId, file, { caption: txt.slice(0, 1024), parse_mode: 'HTML', _keep: 'r' }));
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
  dropSessions: (id) => { sessions.delete(`admin:${id}`); activeMediaSessions.delete(`admin:${id}`); },
  resync: () => resyncChannelPosts(APIS.admin).catch(() => {}),
  sendTransient: (api, chat, text, o) => sendTransient(api, chat, text, o),
  publishDraft: (api, d, author) => publishDraft(api, d, author),
  editPublishedAlert: (api, id, d, author) => editPublishedAlert(api, id, d, author),
  getAlert: (id) => store.getAlert(id),
  mapUrl: (id, lang) => mapUrl(id, lang),
  // open a ready draft (news monitor "✏️ edit first") in this user's normal publishing preview
  loadDraft: (ctx, d) => { const x = { ...d, mode: 'publish', created: Date.now(), msgId: null }; sessions.set(sk(ctx), x); return showPreview(ctx, x); },
  loadPublishedDraft: (ctx, d, id) => {
    const x = { ...d, mode: 'edit_published', publishedAlertId: id, created: Date.now(), msgId: null };
    sessions.set(sk(ctx), x);
    return showPreview(ctx, x);
  },
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
  if (role === 'admin') bot.on('edited_channel_post', (ctx) => {
    const post = ctx.editedChannelPost;
    if (!isConfiguredChannelMessage(post)) return;
    const alert = store.state.alerts.find((item) => item.channel_message_id === post.message_id);
    if (!alert) return;
    const patch = channelEditPatch(alert, post);
    if (!patch) return;
    store.updateAlert(alert.id, patch);
    console.log(`[channel-edit] ${alert.id}: synced ${Object.keys(patch).filter((key) => key !== 'meta').join(', ')}`);
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
  if (role === 'admin') { registerOwnerTools(bot, OH); registerContactTools(bot, OH); registerSupportTools(bot, OH); registerNewsTools(bot, OH); registerJobsTools(bot, OH, role); registerJobsAdminTools(bot, OH); registerArmyAdminTools(bot, OH); registerPriceTools(bot, OH); registerQuakeTools(bot, OH); registerWeatherTools(bot, OH); registerWxBulletinTools(bot, OH); registerBorderTools(bot, OH); registerPowerTools(bot, OH); registerRoadMonitorTools(bot, OH); } else { registerJobsTools(bot, OH, role); registerReportOwnerCommands(bot, OH); }
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
        const ids = m._relayedIds || [m.message_id];
        for (const id of ids) store.relayPut(`r:${uid}:${id}`, ctx.from.id);
        store.openThread(uid, ctx.from.id);
        store.convoAdd('admin', ctx.chat.id, ctx.message.message_id); // staff's own reply
        ctx.ras.keepInput = true;
        store.convoAdd('report', uid, ...ids); // media and any separate caption/guide copy
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
          const ids = m._relayedIds || [m.message_id];
          for (const id of ids) store.relayPut(`a:${sid}:${id}`, ctx.from.id);
          store.convoAdd('admin', sid, ...ids);
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
  const clearConvo = async (ctx) => {
    if (!ctx.chat || ctx.chat.type !== 'private') return;
    const ids = store.convoTake(role, ctx.chat.id);
    for (let i = 0; i < ids.length; i += 10) {
      const part = ids.slice(i, i + 10);
      const results = await Promise.allSettled(part.map((id) => ctx.api.deleteMessage(ctx.chat.id, id)));
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled' || result.value !== true) setKeep(role, ctx.chat.id, part[index], false);
      });
    }
  };
  const home = async (ctx) => {
    if (ctx.message) ctx.ras.keepInput = true; // cleanMenuMessages tracks and deletes this command itself
    alnabaSessions.delete(Number(ctx.from?.id));
    alnabaPendingUploads.delete(Number(ctx.from?.id));
    alnabaPendingForwardInputs.delete(Number(ctx.from?.id));
    alnabaPendingArchiveEntries.delete(Number(ctx.from?.id));
    clearAlnabaManagementState(Number(ctx.from?.id));
    await clearConvo(ctx);
    await cleanMenuMessages(ctx.api, role, ctx.chat?.id, ctx.message || ctx.callbackQuery?.message);
    sessions.delete(sk(ctx));
    const l = L(ctx);
    const name = esc(ctx.from.first_name || '');
    const text = staff(ctx) ? `${l.welcomeAdmin(name)}\n\n${l.mainMenu}` : `${l.welcomeReport(name)}\n\n${l.publicMenu}`;
    await show(ctx, text, mainKeyboard(ctx));
  };

  bot.command(['start', 'menu'], async (ctx) => {
    if (ctx.callbackQuery) return home(ctx);
    alnabaSessions.delete(Number(ctx.from?.id));
    alnabaPendingUploads.delete(Number(ctx.from?.id));
    alnabaPendingForwardInputs.delete(Number(ctx.from?.id));
    alnabaPendingArchiveEntries.delete(Number(ctx.from?.id));
    clearAlnabaManagementState(Number(ctx.from?.id));
    if (ctx.message) ctx.ras.keepInput = true; // cleanMenuMessages tracks and deletes this command itself
    await clearConvo(ctx);
    await cleanMenuMessages(ctx.api, role, ctx.chat?.id, ctx.message);
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
  const alnabaSite = (section = '') => `${(config.publicUrl || 'https://red-alert-syria.onrender.com').replace(/\/+$/, '')}/alnaba/${section ? `${section}/` : ''}`;
  const alnabaHomeKeyboard = (ctx) => new InlineKeyboard().text(langOf(ctx) === 'en' ? '↩️ Main menu' : '↩️ رجوع للقائمة', 'nb:home');
  const withAlnabaHomeButton = (keyboard, ctx) => keyboard
    .row()
    .text(langOf(ctx) === 'en' ? '↩️ Main menu' : '↩️ رجوع للقائمة', 'nb:home');
  const alnabaMenuKeyboard = (ctx) => {
    const en = langOf(ctx) === 'en';
    const keyboard = new InlineKeyboard()
      .text(en ? '🖼 Photo news' : '🖼 أخبار مصورة', 'nb:photos')
      .text(en ? '📄 Weekly newspaper' : '📄 الصحيفة الأسبوعية', 'nb:weekly').row()
      .text(en ? '📖 Quran' : '📖 القرآن الكريم', 'nb:quran')
      .text(en ? '🎵 Nasheeds' : '🎵 أناشيد', 'nb:nasheed').row()
      .text(en ? '🔗 Archive' : '🔗 الأرشيف', 'nb:archive').row()
      .url(en ? '🌐 Open Al-Nabaa' : '🌐 فتح صفحة النبأ', alnabaSite());
    return withAlnabaHomeButton(keyboard, ctx);
  };
  const alnabaMenuText = (ctx) => langOf(ctx) === 'en'
    ? '📰 <b>Al-Nabaa publishing</b>\n\nChoose photo news, the weekly newspaper, Quran, or nasheeds, or forward an item for automatic section preparation. Owner uploads are published directly to the Al-Nabaa website only, never to the Telegram channel. If an audio/video item is ambiguous, the bot will keep it private and ask you to choose Quran or nasheeds before publishing.'
    : '📰 <b>نشر محتوى النبأ</b>\n\nاختر الأخبار المصوّرة أو الصحيفة الأسبوعية أو القرآن الكريم أو الأناشيد، أو أعد توجيه مادة ليجهّزها البوت للقسم المناسب تلقائياً. ما ترسله من حساب المالك يُنشر مباشرةً على موقع النبأ فقط، ولا يُنشر في قناة تيليغرام. إذا التبس قسم الصوت أو الفيديو، سيبقى خاصاً حتى تختار القرآن أو الأناشيد.';
  const alnabaSectionPrompt = (section, en) => {
    if (section === 'photos') return en
      ? '🖼 <b>Photo news</b>\n\nSend one photo with its headline in the caption, or attach a JPG, PNG, or WebP file with a headline (maximum 10 MB). The original image is published directly on the Al-Nabaa website only and expires after 24 hours.'
      : '🖼 <b>أخبار مصوّرة</b>\n\nأرسل صورة مع عنوانها في وصفها، أو أرفق JPG أو PNG أو WebP مع العنوان (حتى 10 ميغابايت). تُنشر الصورة كما هي على موقع النبأ فقط، وتُزال بعد 24 ساعة.';
    if (section === 'weekly') return en
      ? '📄 <b>Weekly newspaper</b>\n\nSend PDFs up to 20 MB each. A positive issue number in the caption or filename is kept; otherwise the next number is assigned. The title is optional and defaults to the issue number. Telegram albums contain up to 10 same-type documents; consecutive albums or separate messages are processed in order, with a result for every file. Files publish directly on the Al-Nabaa website only.'
      : '📄 <b>الصحيفة الأسبوعية</b>\n\nأرسل ملفات PDF حتى 20 ميغابايت لكل ملف. يُحفظ رقم العدد الموجب الموجود في الوصف أو اسم الملف، وإلا يُخصّص الرقم التالي تلقائياً. العنوان اختياري، وعند غيابه يكون «العدد [الرقم]». حد ألبوم تيليغرام 10 ملفات من النوع نفسه؛ وتُعالج الألبومات المتتابعة أو الرسائل المنفصلة بالترتيب مع بيان نتيجة كل ملف. النشر مباشرةً على موقع النبأ فقط.';
    if (section === 'quran' || section === 'nasheed') {
      const name = section === 'quran' ? (en ? 'Quran' : 'القرآن الكريم') : (en ? 'Nasheeds' : 'الأناشيد');
      return en
        ? `📚 <b>${name}</b>\n\nSend audio/video files (up to 20 MB each; images up to 10 MB). A title in the caption or media metadata is used; if missing, a simple numbered title is generated. Telegram albums contain up to 10 same-type files; consecutive albums or separate messages are processed in order, with an individual result for every file. After validation, media is published directly to this Al-Nabaa website section only.`
        : `📚 <b>${name}</b>\n\nأرسل ملفات الصوت أو الفيديو (حتى 20 ميغابايت لكل ملف، والصور حتى 10 ميغابايت). يُستخدم العنوان الموجود في الوصف أو بيانات الوسيط، وإن غاب يُنشأ عنوان بسيط مرقّم. يضم ألبوم تيليغرام حتى 10 ملفات من النوع نفسه؛ وتُعالج الألبومات المتتابعة أو الرسائل المنفصلة بالترتيب مع نتيجة مستقلة لكل ملف. بعد التحقق يُنشر المحتوى مباشرةً في هذا القسم على موقع النبأ فقط.`;
    }
    return en
      ? '🔗 <b>Archive</b>\n\nSend one text message with two lines: the channel/group name or title first, then its HTTPS Telegram link (t.me or telegram.me). Public usernames and invite links are supported. The entry stays private until you confirm the preview.'
      : '🔗 <b>الأرشيف</b>\n\nأرسل رسالة نصية من سطرين: اسم/عنوان القناة أو المجموعة في السطر الأول، ثم رابط Telegram كامل يبدأ بـ HTTPS في السطر الثاني (t.me أو telegram.me). تُقبل الروابط العامة وروابط الدعوة، ولا يظهر الرابط للزوار قبل تأكيد المعاينة.';
  };
  const alnabaSectionName = (section, en) => ({
    photos: en ? 'Photo news' : 'الأخبار المصوّرة',
    weekly: en ? 'Weekly newspaper' : 'الصحيفة الأسبوعية',
    quran: en ? 'Quran' : 'القرآن الكريم',
    nasheed: en ? 'Nasheeds' : 'الأناشيد',
    archive: en ? 'Archive' : 'الأرشيف',
  })[section] || (en ? 'Al-Nabaa' : 'النبأ');
  const alnabaSectionIcon = (section) => ({ photos: '🖼', weekly: '📄', quran: '📖', nasheed: '🎵', archive: '🔗' })[section] || '📰';
  const shortAlnabaTitle = (title) => {
    const chars = Array.from(String(title || ''));
    return chars.length > 42 ? `${chars.slice(0, 39).join('')}…` : chars.join('');
  };
  const alnabaItemsForManagement = (section) => sanitizeAlnabaState(store.state.alnaba)[section]
    .sort((a, b) => section === 'weekly'
      ? (weeklyIssueNumber(a) || Number.MAX_SAFE_INTEGER) - (weeklyIssueNumber(b) || Number.MAX_SAFE_INTEGER)
      : (a.sequence || 0) - (b.sequence || 0));
  const alnabaManageListView = (ctx, section, page = 0) => {
    const en = langOf(ctx) === 'en';
    const items = alnabaItemsForManagement(section);
    const pageSize = 6;
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    const safePage = Math.max(0, Math.min(Number(page) || 0, pageCount - 1));
    const start = safePage * pageSize;
    const keyboard = new InlineKeyboard();
    for (const item of items.slice(start, start + pageSize)) {
      keyboard.text(`${alnabaSectionIcon(section)} ${shortAlnabaTitle(item.title)}`, `nb:item:${section}:${item.id}:${safePage}`).row();
    }
    if (pageCount > 1) {
      if (safePage > 0) keyboard.text(en ? '← Previous' : '← السابق', `nb:manage:${section}:${safePage - 1}`);
      if (safePage + 1 < pageCount) keyboard.text(en ? 'Next →' : 'التالي →', `nb:manage:${section}:${safePage + 1}`);
      keyboard.row();
    }
    keyboard.text(en ? '➕ Add new item' : '➕ إضافة محتوى', `nb:${section}`).row()
      .text(en ? '↩️ Al-Nabaa menu' : '↩️ قائمة النبأ', 'nb:open');
    withAlnabaHomeButton(keyboard, ctx);
    const title = alnabaSectionName(section, en);
    const pageInfo = pageCount > 1 ? `\n${en ? `Page ${safePage + 1} of ${pageCount}` : `الصفحة ${safePage + 1} من ${pageCount}`}` : '';
    const text = en
      ? `🛠 <b>Manage ${title}</b>\n\n${items.length ? `Choose an item to edit or delete (${items.length} total).` : 'No items in this section yet. You can add the first one below.'}${pageInfo}`
      : `🛠 <b>إدارة ${title}</b>\n\n${items.length ? `اختر منشوراً لتعديله أو حذفه (${items.length} إجمالاً).` : 'لا توجد منشورات في هذا القسم حالياً. يمكنك إضافة أول منشور من الزر أدناه.'}${pageInfo}`;
    return { text, keyboard, safePage };
  };
  const showAlnabaManageList = async (ctx, section, page = 0) => {
    const view = alnabaManageListView(ctx, section, page);
    return ctx.editMessageText(view.text, { parse_mode: 'HTML', reply_markup: view.keyboard });
  };
  const alnabaManageItemView = (ctx, section, id, page = 0) => {
    const en = langOf(ctx) === 'en';
    const item = findAlnabaEntry(store, section, id);
    if (!item) return null;
    const keyboard = new InlineKeyboard()
      .text(en ? '✏️ Edit title' : '✏️ تعديل العنوان', `nb:edit-title:${section}:${id}:${page}`);
    if (section === 'archive') keyboard.text(en ? '🔗 Edit link' : '🔗 تعديل الرابط', `nb:edit-link:${section}:${id}:${page}`);
    else keyboard.text(en ? '♻️ Replace file' : '♻️ استبدال الملف', `nb:replace:${section}:${id}:${page}`);
    keyboard.row()
      .text(en ? '🗑 Delete' : '🗑 حذف', `nb:delete:${section}:${id}:${page}`).row()
      .text(en ? '↩️ Back to item list' : '↩️ رجوع لقائمة الإدارة', `nb:manage:${section}:${page}`);
    withAlnabaHomeButton(keyboard, ctx);
    const dateSource = item.updated_at || item.published_at;
    const date = dateSource ? fmtTime(dateSource, en ? 'en' : 'ar') : '';
    const details = section === 'archive'
      ? `<a href="${esc(item.url)}">${esc(item.url)}</a>`
      : `${section === 'weekly' && weeklyIssueNumber(item) ? `${en ? 'Issue' : 'رقم العدد'}: ${weeklyIssueNumber(item)} · ` : ''}${esc(item.file_name)} · ${esc(item.mime_type)}${item.description ? `\n${esc(item.description)}` : ''}`;
    const text = en
      ? `🛠 <b>${alnabaSectionName(section, en)} · item controls</b>\n\n<b>${esc(item.title)}</b>\n${details}\n${date ? `Added/updated: ${esc(date)}` : ''}\n\nChoose an action. Nothing changes until you confirm the edit or deletion.`
      : `🛠 <b>${alnabaSectionName(section, en)} · إدارة المنشور</b>\n\n<b>${esc(item.title)}</b>\n${details}\n${date ? `أُضيف/عُدّل: ${esc(date)}` : ''}\n\nاختر الإجراء. لا يُحفظ أي تعديل ولا يُحذف شيء قبل التأكيد.`;
    return { item, text, keyboard };
  };
  const showAlnabaManageItem = async (ctx, section, id, page = 0) => {
    const view = alnabaManageItemView(ctx, section, id, page);
    if (!view) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'This item no longer exists.' : 'لم يعد هذا المنشور موجوداً.');
    return ctx.editMessageText(view.text, { parse_mode: 'HTML', reply_markup: view.keyboard, link_preview_options: { is_disabled: true } });
  };
  bot.command('alnaba', async (ctx) => {
    if (!alnabaOwner(ctx)) return ctx.reply(langOf(ctx) === 'en' ? 'This publishing option is not available for this account.' : 'هذه الصلاحية غير متاحة لهذا الحساب.');
    alnabaSessions.delete(Number(ctx.from.id));
    alnabaPendingUploads.delete(Number(ctx.from.id));
    alnabaPendingForwardInputs.delete(Number(ctx.from.id));
    alnabaPendingArchiveEntries.delete(Number(ctx.from.id));
    clearAlnabaManagementState(Number(ctx.from.id));
    await ctx.reply(alnabaMenuText(ctx), { parse_mode: 'HTML', reply_markup: alnabaMenuKeyboard(ctx) });
  });
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
  bot.callbackQuery(/^nb:/, async (ctx, next) => {
    const uid = Number(ctx.from?.id);
    if (!alnabaOwner(ctx) || !alnabaPendingForwardInputs.has(uid)) return next();
    const data = String(ctx.callbackQuery.data || '');
    if (['nb:cancel', 'nb:home', 'nb:open'].includes(data) || data.startsWith('nb:forward:section:')) return next();
    return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Finish or cancel the forwarded item first.' : 'أكمل العنصر المعاد توجيهه أو ألغِه أولاً.');
  });
  bot.callbackQuery(/^nb:(open|photos|weekly|quran|nasheed|archive|publish|cancel|home)$/, async (ctx) => {
    if (!alnabaOwner(ctx)) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Not authorized.' : 'ليست لديك صلاحية النشر.');
    const action = ctx.match[1];
    const uid = Number(ctx.from.id);
    if (action === 'home') {
      await ctx.answerCallbackQuery();
      return home(ctx);
    }
    if (action === 'open') {
      alnabaSessions.delete(uid);
      alnabaPendingUploads.delete(uid);
      alnabaPendingForwardInputs.delete(uid);
      alnabaPendingArchiveEntries.delete(uid);
      clearAlnabaManagementState(uid);
      await ctx.answerCallbackQuery();
      return ctx.editMessageText(alnabaMenuText(ctx), { parse_mode: 'HTML', reply_markup: alnabaMenuKeyboard(ctx) });
    }
    if (action === 'photos' || action === 'weekly' || action === 'quran' || action === 'nasheed' || action === 'archive') {
      if (alnabaPendingUploads.has(uid) || alnabaPendingForwardInputs.has(uid) || alnabaPendingArchiveEntries.has(uid) || alnabaPendingManagementEdits.has(uid) || alnabaPendingManagementDeletes.has(uid) || alnabaEditSessions.has(uid)) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Finish or cancel the current forwarded item first.' : 'أكمل العنصر المعاد توجيهه أو ألغِه أولاً.');
      const section = action;
      alnabaSessions.set(uid, { section, createdAt: Date.now() });
      const en = langOf(ctx) === 'en';
      const back = new InlineKeyboard()
        .text(en ? '↩️ Back' : '↩️ رجوع', 'nb:open')
        .text(en ? '🛠 Manage this section' : '🛠 إدارة هذا القسم', `nb:manage:${section}`).row()
        .text(en ? 'Cancel' : 'إلغاء', 'nb:cancel');
      withAlnabaHomeButton(back, ctx);
      await ctx.answerCallbackQuery();
      return ctx.editMessageText(alnabaSectionPrompt(section, en), { parse_mode: 'HTML', reply_markup: back });
    }
    if (action === 'cancel') {
      alnabaSessions.delete(uid);
      alnabaPendingUploads.delete(uid);
      alnabaPendingForwardInputs.delete(uid);
      alnabaPendingArchiveEntries.delete(uid);
      clearAlnabaManagementState(uid);
      await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Cancelled.' : 'تم الإلغاء.');
      return ctx.deleteMessage().catch(() => {});
    }

    return withAlnabaWriteLock(async () => {
    if (action === 'publish' && (alnabaPendingForwardInputs.has(uid) || alnabaPendingManagementEdits.has(uid) || alnabaPendingManagementDeletes.has(uid) || alnabaEditSessions.has(uid))) {
      return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Use the management preview controls to save this change.' : 'استخدم أزرار معاينة الإدارة لحفظ هذا التعديل.');
    }

    const archivePending = alnabaPendingArchiveEntries.get(uid);
    if (archivePending) {
      if (Date.now() - archivePending.createdAt > 30 * 60_000) {
        alnabaPendingArchiveEntries.delete(uid);
        await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'This preview expired. Start again with /alnaba.' : 'انتهت صلاحية المعاينة. ابدأ مجدداً عبر /alnaba.');
        return ctx.deleteMessage().catch(() => {});
      }
      if (!store.backup || !config.telegramBackup) {
        return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Publishing is paused: durable backup is unavailable.' : 'توقف النشر: النسخة الاحتياطية الدائمة غير متاحة حالياً.');
      }
      const oldState = store.state.alnaba;
      let item;
      try {
        item = publishAlnabaArchiveEntry(store, uid, archivePending, new Date());
        await store.flushBackup();
        if (store._backupPending) throw new Error('BACKUP_FAILED');
      } catch (error) {
        store.state.alnaba = oldState;
        store.persist({ backupSoon: false });
        const en = langOf(ctx) === 'en';
        const message = error.message === 'DUPLICATE_ARCHIVE_LINK'
          ? (en ? 'This Telegram link is already in the archive.' : 'هذا الرابط موجود مسبقاً في الأرشيف.')
          : (en ? 'Could not save a durable backup, so nothing was published. Please try again.' : 'تعذّر حفظ نسخة احتياطية دائمة؛ لذلك لم يُنشر شيء. حاول مجدداً.');
        await ctx.answerCallbackQuery(message);
        return;
      }
      alnabaPendingArchiveEntries.delete(uid);
      alnabaSessions.delete(uid);
      const en = langOf(ctx) === 'en';
      await ctx.answerCallbackQuery(en ? 'Added to the Al-Nabaa archive.' : 'أُضيف الرابط إلى أرشيف النبأ.');
      await ctx.deleteMessage().catch(() => {});
      const keyboard = new InlineKeyboard()
        .text(en ? '➕ Add another link' : '➕ إضافة رابط آخر', 'nb:archive').row()
        .url(en ? 'Open archive' : 'فتح الأرشيف', alnabaSite('archive'))
        .url(en ? 'Al-Nabaa home' : 'صفحة النبأ', alnabaSite());
      await ctx.reply(en ? `✅ Added to archive: <b>${esc(item.title)}</b>` : `✅ أُضيف إلى الأرشيف: <b>${esc(item.title)}</b>`, { parse_mode: 'HTML', reply_markup: withAlnabaHomeButton(keyboard, ctx) });
      return;
    }

    const pending = alnabaPendingUploads.get(uid);
    if (!pending || Date.now() - pending.createdAt > 30 * 60_000) {
      alnabaPendingUploads.delete(uid);
      await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'This preview expired. Start again with /alnaba.' : 'انتهت صلاحية المعاينة. ابدأ مجدداً عبر /alnaba.');
      return ctx.deleteMessage().catch(() => {});
    }
    if (!store.backup || !config.telegramBackup) {
      return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Publishing is paused: durable backup is unavailable.' : 'توقف النشر: النسخة الاحتياطية الدائمة غير متاحة حالياً.');
    }
    const oldState = store.state.alnaba;
    let item;
    try {
      item = publishAlnabaItem(store, uid, pending, new Date());
      await store.flushBackup();
      if (store._backupPending) throw new Error('BACKUP_FAILED');
    } catch (error) {
      store.state.alnaba = oldState;
      store.persist({ backupSoon: false });
      const en = langOf(ctx) === 'en';
      const message = error.message === 'DUPLICATE_MEDIA'
        ? (en ? 'This exact file is already published.' : 'هذا الملف منشور مسبقاً.')
        : error.message === 'DUPLICATE_ISSUE_NUMBER'
          ? (en ? 'That issue number is already in use.' : 'رقم هذا العدد مستخدم مسبقاً.')
          : error.message === 'MISSING_ISSUE_NUMBER'
            ? (en ? 'Add the issue number in the caption or filename and try again.' : 'أضف رقم العدد في الوصف أو اسم الملف ثم أعد الإرسال.')
        : (en ? 'Could not save a durable backup, so nothing was published. Please try again.' : 'تعذّر حفظ نسخة احتياطية دائمة؛ لذلك لم يُنشر شيء. حاول مجدداً.');
      await ctx.answerCallbackQuery(message);
      return;
    }
    alnabaPendingUploads.delete(uid);
    alnabaSessions.delete(uid);
    const en = langOf(ctx) === 'en';
    const link = alnabaSite(item.section);
    await ctx.answerCallbackQuery(en ? 'Published on the website.' : 'تم النشر على الموقع.');
    await ctx.deleteMessage().catch(() => {});
    const addLabel = item.section === 'photos'
      ? (en ? '➕ Add another item' : '➕ إضافة خبر جديد')
      : (en ? '➕ Add another item' : '➕ إضافة محتوى');
    const keyboard = new InlineKeyboard()
      .text(addLabel, `nb:${item.section}`).row()
      .url(en ? 'Open section' : 'فتح القسم', link)
      .url(en ? 'Al-Nabaa home' : 'صفحة النبأ', alnabaSite());
    await ctx.reply(en ? `✅ Published: <b>${esc(item.title)}</b>` : `✅ تم النشر: <b>${esc(item.title)}</b>`, { parse_mode: 'HTML', reply_markup: withAlnabaHomeButton(keyboard, ctx) });
    });
  });
  bot.callbackQuery(/^nb:manage:(photos|weekly|quran|nasheed|archive)(?::(\d{1,9}))?$/, async (ctx) => {
    if (!alnabaOwner(ctx)) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Not authorized.' : 'ليست لديك صلاحية الإدارة.');
    const uid = Number(ctx.from.id);
    if (alnabaPendingUploads.has(uid) || alnabaPendingForwardInputs.has(uid) || alnabaPendingArchiveEntries.has(uid) || alnabaPendingManagementEdits.has(uid) || alnabaPendingManagementDeletes.has(uid) || alnabaEditSessions.has(uid)) {
      return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Finish or cancel the current action first.' : 'أكمل الإجراء الحالي أو ألغِه أولاً.');
    }
    alnabaSessions.delete(uid);
    await ctx.answerCallbackQuery();
    return showAlnabaManageList(ctx, ctx.match[1], Number(ctx.match[2]) || 0);
  });
  bot.callbackQuery(/^nb:item:(photos|weekly|quran|nasheed|archive):([\w-]{36}):(\d{1,9})$/, async (ctx) => {
    if (!alnabaOwner(ctx)) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Not authorized.' : 'ليست لديك صلاحية الإدارة.');
    const uid = Number(ctx.from.id);
    if (alnabaPendingForwardInputs.has(uid) || alnabaPendingManagementEdits.has(uid) || alnabaPendingManagementDeletes.has(uid) || alnabaEditSessions.has(uid)) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Finish or cancel the current action first.' : 'أكمل الإجراء الحالي أو ألغِه أولاً.');
    alnabaSessions.delete(uid);
    await ctx.answerCallbackQuery();
    return showAlnabaManageItem(ctx, ctx.match[1], ctx.match[2], Number(ctx.match[3]) || 0);
  });
  bot.callbackQuery(/^nb:edit-(title|link):(photos|weekly|quran|nasheed|archive):([\w-]{36}):(\d{1,9})$/, async (ctx) => {
    if (!alnabaOwner(ctx)) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Not authorized.' : 'ليست لديك صلاحية الإدارة.');
    const [, field, section, id, pageRaw] = ctx.match;
    const uid = Number(ctx.from.id);
    const item = findAlnabaEntry(store, section, id);
    if (!item) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'This item no longer exists.' : 'لم يعد هذا المنشور موجوداً.');
    if (field === 'link' && section !== 'archive') return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Links can only be edited in the archive.' : 'تعديل الرابط متاح في الأرشيف فقط.');
    if (alnabaPendingManagementEdits.has(uid) || alnabaPendingManagementDeletes.has(uid)) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Finish or cancel the current action first.' : 'أكمل الإجراء الحالي أو ألغِه أولاً.');
    const page = Number(pageRaw) || 0;
    alnabaEditSessions.set(uid, { section, id, field, page, createdAt: Date.now() });
    const en = langOf(ctx) === 'en';
    const prompt = field === 'title'
      ? (en ? `Send the new title for <b>${esc(item.title)}</b> (up to 180 characters).` : `أرسل العنوان الجديد للمنشور <b>${esc(item.title)}</b> (حتى 180 حرفاً).`)
      : (en ? `Send the new HTTPS Telegram link for <b>${esc(item.title)}</b>.` : `أرسل رابط Telegram الجديد بصيغة HTTPS للعنصر <b>${esc(item.title)}</b>.`);
    const keyboard = new InlineKeyboard()
      .text(en ? '↩️ Back to item' : '↩️ رجوع للمنشور', `nb:item:${section}:${id}:${page}`)
      .text(en ? 'Cancel' : 'إلغاء', 'nb:cancel');
    await ctx.answerCallbackQuery();
    return ctx.editMessageText(prompt, { parse_mode: 'HTML', reply_markup: withAlnabaHomeButton(keyboard, ctx) });
  });
  bot.callbackQuery(/^nb:replace:(photos|weekly|quran|nasheed):([\w-]{36}):(\d{1,9})$/, async (ctx) => {
    if (!alnabaOwner(ctx)) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Not authorized.' : 'ليست لديك صلاحية الإدارة.');
    const [, section, id, pageRaw] = ctx.match;
    const uid = Number(ctx.from.id);
    const item = findAlnabaEntry(store, section, id);
    if (!item) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'This item no longer exists.' : 'لم يعد هذا المنشور موجوداً.');
    if (alnabaPendingManagementEdits.has(uid) || alnabaPendingManagementDeletes.has(uid) || alnabaPendingUploads.has(uid)) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Finish or cancel the current action first.' : 'أكمل الإجراء الحالي أو ألغِه أولاً.');
    const page = Number(pageRaw) || 0;
    alnabaSessions.set(uid, { section, mode: 'replace', itemId: id, page, createdAt: Date.now() });
    const en = langOf(ctx) === 'en';
    const prompt = section === 'photos'
      ? (en ? `Send a replacement image for <b>${esc(item.title)}</b>. It will replace the current image only after you confirm.` : `أرسل الصورة البديلة للمنشور <b>${esc(item.title)}</b>. لن تُستبدل الصورة الحالية حتى تؤكد المعاينة.`)
      : (en ? `Send a replacement PDF for <b>${esc(item.title)}</b>. It will replace the current issue only after you confirm.` : `أرسل ملف PDF البديل للعدد <b>${esc(item.title)}</b>. لن يُستبدل الملف الحالي حتى تؤكد المعاينة.`);
    const keyboard = new InlineKeyboard()
      .text(en ? '↩️ Back to item' : '↩️ رجوع للمنشور', `nb:item:${section}:${id}:${page}`)
      .text(en ? 'Cancel' : 'إلغاء', 'nb:cancel');
    await ctx.answerCallbackQuery();
    return ctx.editMessageText(prompt, { parse_mode: 'HTML', reply_markup: withAlnabaHomeButton(keyboard, ctx) });
  });
  bot.callbackQuery(/^nb:edit-save:([0-9a-f-]{36})$/, async (ctx) => {
    if (!alnabaOwner(ctx)) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Not authorized.' : 'ليست لديك صلاحية الإدارة.');
    return withAlnabaWriteLock(async () => {
    const uid = Number(ctx.from.id);
    const pending = alnabaPendingManagementEdits.get(uid);
    const en = langOf(ctx) === 'en';
    if (!pending || pending.token !== ctx.match[1]) return ctx.answerCallbackQuery(en ? 'This edit prompt is no longer current.' : 'لم تعد هذه المعاينة هي الحالية.');
    if (Date.now() - pending.createdAt > 30 * 60_000) {
      alnabaPendingManagementEdits.delete(uid);
      return ctx.answerCallbackQuery(en ? 'This edit preview expired.' : 'انتهت صلاحية معاينة التعديل.');
    }
    if (!store.backup || !config.telegramBackup) return ctx.answerCallbackQuery(en ? 'Saving is paused: durable backup is unavailable.' : 'توقف الحفظ: النسخة الاحتياطية الدائمة غير متاحة حالياً.');
    const oldState = store.state.alnaba;
    let updated;
    try {
      updated = updateAlnabaEntry(store, uid, pending.section, pending.id, pending.changes, new Date());
      await store.flushBackup();
      if (store._backupPending) throw new Error('BACKUP_FAILED');
    } catch (error) {
      store.state.alnaba = oldState;
      store.persist({ backupSoon: false });
      const message = error.message === 'DUPLICATE_ARCHIVE_LINK'
        ? (en ? 'This Telegram link is already in the archive.' : 'هذا الرابط موجود مسبقاً في الأرشيف.')
        : error.message === 'DUPLICATE_MEDIA'
          ? (en ? 'This exact file is already used by another item.' : 'هذا الملف مستخدم مسبقاً في منشور آخر.')
          : (en ? 'Could not save a durable backup; the item was not changed. Retry after backup recovers.' : 'تعذّر حفظ النسخة الاحتياطية؛ لم يتغير المنشور. أعد المحاولة بعد استعادة النسخ الاحتياطي.');
      return ctx.answerCallbackQuery(message);
    }
    alnabaPendingManagementEdits.delete(uid);
    alnabaEditSessions.delete(uid);
    alnabaSessions.delete(uid);
    await ctx.answerCallbackQuery(en ? 'Changes saved.' : 'تم حفظ التعديلات.');
    await ctx.deleteMessage().catch(() => {});
    const keyboard = new InlineKeyboard()
      .text(en ? '🛠 Manage item' : '🛠 إدارة المنشور', `nb:item:${pending.section}:${pending.id}:${pending.page}`).row()
      .text(en ? 'Back to section list' : 'العودة لقائمة القسم', `nb:manage:${pending.section}:${pending.page}`);
    const summary = pending.changes.media
      ? (en ? 'Replacement file saved' : 'تم حفظ الملف البديل')
      : (en ? 'Item updated' : 'تم تعديل المنشور');
    return ctx.reply(`✅ ${summary}: <b>${esc(updated.title)}</b>`, { parse_mode: 'HTML', reply_markup: withAlnabaHomeButton(keyboard, ctx) });
    });
  });
  bot.callbackQuery(/^nb:delete:(photos|weekly|quran|nasheed|archive):([\w-]{36}):(\d{1,9})$/, async (ctx) => {
    if (!alnabaOwner(ctx)) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Not authorized.' : 'ليست لديك صلاحية الإدارة.');
    const [, section, id, pageRaw] = ctx.match;
    const uid = Number(ctx.from.id);
    const item = findAlnabaEntry(store, section, id);
    if (!item) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'This item no longer exists.' : 'لم يعد هذا المنشور موجوداً.');
    if (alnabaPendingManagementEdits.has(uid) || alnabaPendingManagementDeletes.has(uid) || alnabaEditSessions.has(uid)) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Finish or cancel the current action first.' : 'أكمل الإجراء الحالي أو ألغِه أولاً.');
    const page = Number(pageRaw) || 0;
    const token = randomUUID();
    alnabaPendingManagementDeletes.set(uid, { section, id, page, title: item.title, token, createdAt: Date.now() });
    const en = langOf(ctx) === 'en';
    const text = en
      ? `⚠️ <b>Confirm deletion</b>\n\nDelete <b>${esc(item.title)}</b> from ${alnabaSectionName(section, en)}? This cannot be undone. Nothing has been deleted yet.`
      : `⚠️ <b>تأكيد الحذف</b>\n\nهل تريد حذف <b>${esc(item.title)}</b> من ${alnabaSectionName(section, en)}؟ لا يمكن التراجع بعد التأكيد. لم يُحذف شيء بعد.`;
    const keyboard = new InlineKeyboard()
      .text(en ? '🗑 Yes, delete' : '🗑 نعم، احذف', `nb:delete-confirm:${token}`)
      .text(en ? 'Cancel' : 'إلغاء', `nb:delete-cancel:${token}`);
    await ctx.answerCallbackQuery();
    return ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: withAlnabaHomeButton(keyboard, ctx) });
  });
  bot.callbackQuery(/^nb:delete-cancel:([0-9a-f-]{36})$/, async (ctx) => {
    if (!alnabaOwner(ctx)) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Not authorized.' : 'ليست لديك صلاحية الإدارة.');
    const uid = Number(ctx.from.id);
    const pending = alnabaPendingManagementDeletes.get(uid);
    if (!pending || pending.token !== ctx.match[1]) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'This deletion prompt is no longer current.' : 'لم تعد هذه المعاينة هي الحالية.');
    alnabaPendingManagementDeletes.delete(uid);
    await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Deletion cancelled.' : 'تم إلغاء الحذف.');
    return showAlnabaManageItem(ctx, pending.section, pending.id, pending.page);
  });
  bot.callbackQuery(/^nb:delete-confirm:([0-9a-f-]{36})$/, async (ctx) => {
    if (!alnabaOwner(ctx)) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Not authorized.' : 'ليست لديك صلاحية الإدارة.');
    return withAlnabaWriteLock(async () => {
    const uid = Number(ctx.from.id);
    const pending = alnabaPendingManagementDeletes.get(uid);
    const en = langOf(ctx) === 'en';
    if (!pending || pending.token !== ctx.match[1]) return ctx.answerCallbackQuery(en ? 'This deletion prompt is no longer current.' : 'لم تعد هذه المعاينة هي الحالية.');
    if (Date.now() - pending.createdAt > 10 * 60_000) {
      alnabaPendingManagementDeletes.delete(uid);
      return ctx.answerCallbackQuery(en ? 'This deletion confirmation expired.' : 'انتهت صلاحية تأكيد الحذف.');
    }
    if (!findAlnabaEntry(store, pending.section, pending.id)) {
      alnabaPendingManagementDeletes.delete(uid);
      return ctx.answerCallbackQuery(en ? 'This item no longer exists.' : 'لم يعد هذا المنشور موجوداً.');
    }
    if (!store.backup || !config.telegramBackup) return ctx.answerCallbackQuery(en ? 'Deletion is paused: durable backup is unavailable.' : 'توقف الحذف: النسخة الاحتياطية الدائمة غير متاحة حالياً.');
    const oldState = store.state.alnaba;
    try {
      deleteAlnabaEntry(store, uid, pending.section, pending.id);
      await store.flushBackup();
      if (store._backupPending) throw new Error('BACKUP_FAILED');
    } catch {
      store.state.alnaba = oldState;
      store.persist({ backupSoon: false });
      return ctx.answerCallbackQuery(en ? 'Could not save a durable backup; nothing was deleted. Retry later.' : 'تعذّر حفظ النسخة الاحتياطية؛ لم يُحذف شيء. أعد المحاولة لاحقاً.');
    }
    alnabaPendingManagementDeletes.delete(uid);
    await ctx.answerCallbackQuery(en ? 'Item deleted.' : 'تم حذف المنشور.');
    await ctx.deleteMessage().catch(() => {});
    const keyboard = new InlineKeyboard().text(en ? '🛠 Manage section' : '🛠 إدارة القسم', `nb:manage:${pending.section}:${pending.page}`);
    return ctx.reply(en ? '✅ The item was deleted from Al-Nabaa.' : '✅ تم حذف المنشور من النبأ.', { reply_markup: withAlnabaHomeButton(keyboard, ctx) });
    });
  });
  bot.callbackQuery('home', async (ctx) => { activeMediaSessions.delete(sk(ctx)); await ctx.answerCallbackQuery(); await home(ctx); });
  bot.callbackQuery('cancel', async (ctx) => { activeMediaSessions.delete(sk(ctx)); await ctx.answerCallbackQuery(L(ctx).cancelled); await home(ctx); });
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

  // Targeting sub-menu: drone strike and assassination remain distinct alert types.
  bot.callbackQuery('target', async (ctx) => {
    await ctx.answerCallbackQuery();
    const lang = langOf(ctx);
    await show(ctx, L(ctx).askTarget, reportGroupKeyboard('targeting', lang));
  });
  bot.callbackQuery(/^ag:(aerial|strikes|nature|protests)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const group = ctx.match[1];
    const lang = langOf(ctx);
    const prompt = {
      aerial: { ar: 'اختر نوع النشاط الجوي:', en: 'Choose the aerial activity type:' },
      strikes: { ar: 'اختر نوع الهجوم أو القصف:', en: 'Choose the attack or shelling type:' },
      nature: { ar: 'اختر نوع تنبيه الزلازل أو الطقس:', en: 'Choose the earthquake or weather alert type:' },
      protests: { ar: 'اختر بين الاحتجاج والمظاهرة:', en: 'Choose protest or demonstration:' },
    }[group];
    await show(ctx, lang === 'en' ? prompt.en : prompt.ar, reportGroupKeyboard(group, lang));
  });
  // Civil sub-menu: incident, safety and humanitarian reports.
  bot.callbackQuery('cv', async (ctx) => {
    await ctx.answerCallbackQuery();
    const lang = langOf(ctx);
    await show(ctx, L(ctx).askCivil, reportGroupKeyboard('civil', lang));
  });
  // 🛣 road status: staff publish straight to the map layer, the public report bot sends it to review
  const roadMenu = async (ctx) => {
    const en = langOf(ctx) === 'en';
    const kb = new InlineKeyboard()
      .text(roadLabel('closed', langOf(ctx)), 'rd:closed').text(roadLabel('danger', langOf(ctx)), 'rd:danger').row()
      .text(roadLabel('open', langOf(ctx)), 'rd:open').text(roadLabel('busy', langOf(ctx)), 'rd:busy').row();
    const live = staff(ctx) ? activeRoads() : [];
    if (live.length) kb.text(en ? `📋 Active road statuses (${live.length})` : `📋 حالات الطرق الفعالة (${live.length})`, 'rdl').row();
    kb.text(L(ctx).btnBack, 'home');
    await show(ctx, en
      ? '🛣 <b>Road status</b>\n\nWhat is the road like? Then pick the place (you can add more places along the road).\nIt shows on the map\'s roads layer and disappears by itself when its time ends.'
      : '🛣 <b>حالة طريق</b>\n\nشو وضع الطريق؟ بعدها اختار المكان (فيك تضيف أكتر من مكان على نفس الطريق).\nبتظهر على طبقة الطرق بالخريطة وبتنشال لحالها لما تخلص مدتها.', kb);
  };
  bot.callbackQuery('rd', async (ctx) => { await ctx.answerCallbackQuery(); await roadMenu(ctx); });
  bot.callbackQuery(/^rd:(closed|danger|open|busy)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!staff(ctx)) {
      if (store.isBanned(ctx.from.id)) return show(ctx, L(ctx).banned, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
      if (Date.now() - (lastReport.get(ctx.from.id) || 0) < REPORT_COOLDOWN_MS) return show(ctx, L(ctx).reportRate, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
    }
    const d = newDraft(ctx, 'road');
    d.road = ctx.match[1];
    d.ttlMin = d.road === 'open' || d.road === 'busy' ? 180 : 360;
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
    const type = ctx.match[1];
    if (!ALERT_TYPES[type]) return;
    if (type === 'air_movement') {
      return ctx.answerCallbackQuery({
        text: langOf(ctx) === 'en' ? 'This report option is no longer available.' : 'خيار «باتجاه سوريا / محافظة» لم يعد متاحاً.',
        show_alert: true,
      });
    }
    await ctx.answerCallbackQuery();
    if (!staff(ctx)) {
      if (store.isBanned(ctx.from.id)) return show(ctx, L(ctx).banned, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
      if (Date.now() - (lastReport.get(ctx.from.id) || 0) < REPORT_COOLDOWN_MS) return show(ctx, L(ctx).reportRate, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
    }
    const d = newDraft(ctx, type);
    if (type === 'breaking') {
      await show(ctx, L(ctx).askBreaking, new InlineKeyboard().text(L(ctx).btnCancel, 'cancel'));
    } else if (type === 'political') {
      await askPoliticalCategory(ctx, d);
    } else if (type === 'airstrike') {
      await askAirstrikeForm(ctx, d);
    } else if (type === 'military_incursion') {
      await askMilitaryIncursionKind(ctx, d);
    } else if (type === 'patrol') {
      await askPatrolForm(ctx, d);
    } else if (type === 'signal_sweep') {
      await askSignalPlatform(ctx, d);
    } else if (type === 'border') await askBorder(ctx, d);
    else if (type === 'air_movement') await askFlightAircraft(ctx, d);
    else if (type === 'helicopter') await askHelicopterIntensity(ctx, d);
    else if (type === 'civil') await askCivilEmoji(ctx, d);
    else if (type === 'uav' || type === 'warplane') await askAerialMode(ctx, d);
    else await askLocation(ctx, d);
  });

  bot.callbackQuery('mi', async (ctx) => {
    await ctx.answerCallbackQuery();
    return askMilitaryIncursionKind(ctx);
  });
  bot.callbackQuery('sm', async (ctx) => {
    await ctx.answerCallbackQuery();
    const en = langOf(ctx) === 'en';
    await show(ctx, en ? 'Choose the smuggling alert type:' : 'اختر نوع التهريب:', reportGroupKeyboard('smuggling', en ? 'en' : 'ar'));
  });
  bot.callbackQuery(/^mi:(soldiers|general|vehicles|barrier)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!staff(ctx)) {
      if (store.isBanned(ctx.from.id)) return show(ctx, L(ctx).banned, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
      if (Date.now() - (lastReport.get(ctx.from.id) || 0) < REPORT_COOLDOWN_MS) return show(ctx, L(ctx).reportRate, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
    }
    const d = newDraft(ctx, 'military_incursion');
    if (ctx.match[1] === 'soldiers' || ctx.match[1] === 'general' || ctx.match[1] === 'barrier') {
      d.incursionKind = ctx.match[1] === 'barrier' ? 'barrier' : 'soldiers';
      d.step = 'gov';
      return askLocation(ctx, d);
    }
    return askVehicleCount(ctx, d);
  });

  bot.callbackQuery(/^pcat:([a-z_]+)$/, async (ctx) => {
    const d = getDraft(ctx);
    if (!d) { await ctx.answerCallbackQuery(L(ctx).expiredSession); return; }
    await ctx.answerCallbackQuery();
    if (d.type !== 'political' || d.step !== 'political_category') return;
    const category = politicalCategory(ctx.match[1]);
    if (!category) return askPoliticalCategory(ctx, d);
    d.politicalCategory = category;
    return askPoliticalLocationMode(ctx, d);
  });
  bot.callbackQuery(/^pol:(general|location|category|nopin)$/, async (ctx) => {
    const d = getDraft(ctx);
    if (!d) { await ctx.answerCallbackQuery(L(ctx).expiredSession); return; }
    await ctx.answerCallbackQuery();
    const action = ctx.match[1];
    if (d.type !== 'political') return;
    if (action === 'category') return askPoliticalCategory(ctx, d);
    if (action === 'location' && d.step === 'political_location_mode') {
      d.politicalLocation = 'specific';
      return askLocation(ctx, d);
    }
    if (action === 'general' && d.step === 'political_location_mode' || action === 'nopin' && d.step === 'gov') {
      d.politicalLocation = 'general';
      d.location = locationFrom({});
      d.extra = [];
      return afterLocation(ctx, d);
    }
  });

  const needDraft = (fn) => async (ctx) => {
    activeMediaSessions.delete(sk(ctx));
    const d = getDraft(ctx);
    if (!d) {
      await ctx.answerCallbackQuery(L(ctx).expiredSession);
      return home(ctx);
    }
    await ctx.answerCallbackQuery();
    return fn(ctx, d);
  };

  bot.callbackQuery(/^as:(singular|plural)$/, needDraft(async (ctx, d) => {
    if (d.type !== 'airstrike') return;
    d.airstrikeForm = ctx.match[1];
    await askLocation(ctx, d);
  }));

  bot.callbackQuery(/^pt:(singular|plural)$/, needDraft(async (ctx, d) => {
    if (d.type !== 'patrol') return;
    d.patrolForm = ctx.match[1];
    await askLocation(ctx, d);
  }));

  bot.callbackQuery(/^ss:(uav|none)$/, needDraft(async (ctx, d) => {
    if (d.type !== 'signal_sweep' || d.step !== 'signal_platform') return;
    if (ctx.match[1] === 'uav') d.signalPlatform = 'uav';
    else delete d.signalPlatform;
    await askLocation(ctx, d);
  }));

  bot.callbackQuery(/^vehc:(\d+|custom|back)$/, needDraft(async (ctx, d) => {
    if (d.type !== 'military_incursion') return;
    const choice = ctx.match[1];
    if (choice === 'back') return askVehicleCount(ctx, d);
    if (choice === 'custom') return askVehicleCountInput(ctx, d);
    const count = Number(choice);
    if (!Number.isInteger(count) || !VEHICLE_COUNT_OPTIONS.includes(count)) return askVehicleCount(ctx, d);
    d.vehicleCount = count;
    return askLocation(ctx, d);
  }));

  bot.callbackQuery(/^ce:(protection|people|housing|emergency|warning|medical)$/, needDraft(async (ctx, d) => {
    if (d.type !== 'civil' || !CIVIL_EMOJIS[ctx.match[1]]) return;
    d.civilEmoji = ctx.match[1];
    await askLocation(ctx, d);
  }));

  bot.callbackQuery('back:border', needDraft(async (ctx, d) => {
    if (d.type !== 'border') return;
    await askBorder(ctx, d);
  }));
  bot.callbackQuery('back:flight', needDraft(async (ctx, d) => {
    if (d.type !== 'air_movement') return;
    await askFlightDirection(ctx, d);
  }));
  bot.callbackQuery(/^bsel:(iraq|jordan|lebanon|turkey|palestine)$/, needDraft(async (ctx, d) => {
    if (d.type !== 'border') return;
    d.border = ctx.match[1];
    const marker = BORDER_MARKERS[d.border];
    if (!marker) return;
    d.location = { scope: 'point', name_ar: marker.ar, name_en: marker.en, latitude: marker.lat, longitude: marker.lon };
    d.extra = [];
    await afterLocation(ctx, d);
  }));
  bot.callbackQuery(/^heli:intensity:(normal|high)$/, needDraft(async (ctx, d) => {
    if (d.type !== 'helicopter') return;
    d.intense = ctx.match[1] === 'high';
    await askLocation(ctx, d);
  }));
  bot.callbackQuery(/^airmode:over$/, needDraft(async (ctx, d) => {
    if (d.type !== 'uav' && d.type !== 'warplane') return;
    d.aerialMode = 'over';
    await askLocation(ctx, d);
  }));
  bot.callbackQuery(/^flightair:(warplane|uav)$/, needDraft(async (ctx, d) => {
    if (d.type !== 'air_movement') return;
    d.aircraft = ctx.match[1];
    await askFlightDirection(ctx, d);
  }));
  bot.callbackQuery(/^flight:(toward_syria|entering_syria|leaving_syria)$/, needDraft(async (ctx, d) => {
    if (d.type !== 'air_movement' || !FLIGHT_DIRECTIONS[ctx.match[1]]) return;
    d.flightDirection = ctx.match[1];
    d.flightTarget = null;
    d.location = locationFrom({});
    d.extra = [];
    d.flightRouteOrigin = 'israel_approx_reference';
    d.selectingFlightOrigin = false;
    d.selectingFlightTarget = true;
    await askFlightDestination(ctx, d);
  }));
  bot.callbackQuery(/^flightto:(syria|back|\d{1,2})$/, needDraft(async (ctx, d) => {
    if (d.type !== 'air_movement' || !d.selectingFlightTarget) return;
    const choice = ctx.match[1];
    if (choice === 'back') {
      d.selectingFlightTarget = false;
      if (d.flightRouteOrigin === 'israel_approx_reference') {
        d.flightRouteOrigin = null;
        d.flightTarget = null;
        d.location = locationFrom({});
        d.extra = [];
        return askFlightDirection(ctx, d);
      }
      d.selectingFlightOrigin = true;
      d.location = locationFrom({});
      return askLocation(ctx, d);
    }
    const target = choice === 'syria' ? locationFrom({}) : locationFrom({ govCode: choice });
    if (!target) return askFlightDestination(ctx, d);
    d.selectingFlightTarget = false;
    d.flightTarget = target;
    if (target.scope === 'country') d.flightRouteOrigin = null;
    d.location = target;
    return afterLocation(ctx, d);
  }));
  bot.callbackQuery('flightdest:none', needDraft(async (ctx, d) => {
    if (d.type !== 'air_movement' || !d.selectingFlightTarget) return;
    d.selectingFlightTarget = false;
    d.flightTarget = null;
    d.flightRouteOrigin = null;
    d.location = locationFrom({});
    d.extra = [];
    await afterLocation(ctx, d);
  }));

  bot.callbackQuery(/^g:(\d+)$/, needDraft(async (ctx, d) => {
    const gov = ctx.match[1];
    if (!getGov(gov)) return;
    d.gov = gov; d.step = 'dist';
    const lang = langOf(ctx);
    await show(ctx, L(ctx).askDist(`<b>${esc(draftTypeLabel(d, lang))}</b>`, esc(lang === 'en' ? getGov(gov).en : getGov(gov).ar)), distKeyboard(ctx, gov));
  }));
  bot.callbackQuery(/^wg:(\d+)$/, needDraft((ctx, d) => pickLocation(ctx, d, locationFrom({ govCode: ctx.match[1] }))));
  bot.callbackQuery(/^gc:(\d+)$/, needDraft((ctx, d) => {
    const g = getGov(ctx.match[1]);
    if (!g || g.code !== '08') return;
    const loc = locationFrom({ lat: g.lat, lon: g.lon, label: 'مركز تقريبي لريف دمشق' });
    if (loc) loc.name_en = 'Approx. centre of Rif Dimashq';
    return pickLocation(ctx, d, loc);
  }));
  const showPlaces = async (ctx, d, dist, page, sub = '', letter = '') => {
    d.dist = dist; d.sub = sub; d.step = 'place';
    const lang = langOf(ctx);
    const { kb, page: p, pages, letters } = placeKeyboard(ctx, dist, page, sub, letter);
    const dd = getDist(dist);
    const ss = sub && getSub(sub);
    const where = (lang === 'en' ? dd.en : dd.ar) + (ss ? ' › ' + (lang === 'en' ? ss.en : ss.ar) : '') + (letter ? ` › ${letter}` : '');
    const head = `<b>${esc(draftTypeLabel(d, lang))}</b>`;
    await show(ctx, letters ? L(ctx).askLetter(head, esc(where)) : L(ctx).askPlace(head, esc(where), p, pages), kb);
  };
  const showSubs = async (ctx, d, dist) => {
    d.dist = dist; d.sub = ''; d.step = 'place';
    const lang = langOf(ctx);
    const dd = getDist(dist);
    await show(ctx, L(ctx).askSub(`<b>${esc(draftTypeLabel(d, lang))}</b>`, esc(lang === 'en' ? dd.en : dd.ar)), subKeyboard(ctx, dist));
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
    if (ctx.match[1] === 'gov' && d.type === 'air_movement' && d.flightDirection) {
      d.selectingFlightOrigin = true;
      d.selectingFlightTarget = false;
      d.flightTarget = null;
      d.location = locationFrom({});
    }
    if (ctx.match[1] === 'sub' && d.dist && getDist(d.dist)) return showSubs(ctx, d, d.dist);
    if (ctx.match[1] === 'dist' && d.gov) {
      d.step = 'dist';
      const lang = langOf(ctx);
      return show(ctx, L(ctx).askDist(`<b>${esc(draftTypeLabel(d, lang))}</b>`, esc(lang === 'en' ? getGov(d.gov).en : getGov(d.gov).ar)), distKeyboard(ctx, d.gov));
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
    await show(ctx, L(ctx).askDetails(`<b>${esc(draftTypeLabel(d, langOf(ctx)))}</b>`, esc(locName(d.location, langOf(ctx))), detailsExample(ctx, d)), kb);
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

  bot.callbackQuery('save_edit', needDraft(async (ctx, d) => {
    if (!staff(ctx) || d.mode !== 'edit_published' || !d.publishedAlertId || d.type === 'road') return;
    if (d.type === 'breaking' && !d.text) return askLocation(ctx, d);
    sessions.delete(sk(ctx));
    try {
      const alert = await editPublishedAlert(ctx.api, d.publishedAlertId, d, { id: ctx.from.id, name: ctx.from.first_name });
      await show(ctx, `${langOf(ctx) === 'en' ? '✅ Published story format updated in place.' : '✅ تم تحديث صيغة الخبر المنشور في مكانه.'}\n\n${draftSummary(d, langOf(ctx))}`, resultKeyboard(ctx, alert));
    } catch (e) {
      console.error('[bot] published story edit failed:', e.description || e.message);
      await show(ctx, langOf(ctx) === 'en' ? '⚠️ Could not update the published story.' : '⚠️ تعذّر تحديث الخبر المنشور.', new InlineKeyboard().text(L(ctx).btnHome, 'home'));
    }
  }));

  bot.callbackQuery('attachmedia', needDraft(async (ctx, d) => {
    if (d.mode === 'active_edit') return;
    d.step = 'media';
    await show(ctx, L(ctx).askMedia, new InlineKeyboard().text(L(ctx).btnCancel, 'cancel').row().text(L(ctx).btnBack, 'preview'));
  }));
  bot.callbackQuery('removemedia', needDraft(async (ctx, d) => {
    if (d.mode === 'active_edit') return;
    delete d.media;
    delete d.media_items;
    return showPreview(ctx, d);
  }));

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
    const draft = { ...d };
    delete draft.msgId;
    const rep = { draft, from: { id: ctx.from.id, first_name: ctx.from.first_name, last_name: ctx.from.last_name, username: ctx.from.username }, messages: [], created: Date.now(), via: roleOf(ctx) };
    const api = APIS.admin || reviewApi || ctx.api;
    store.reportPut(rid, rep);
    const reviewers = [...new Set([...config.ownerIds, ...store.state.editors])];
    for (const uid of reviewers) {
      const lang = store.userLang(uid) === 'en' ? 'en' : 'ar';
      try {
        const reportMediaItems = sanitizeAlertMediaItems(Array.isArray(rep.draft.media_items) && rep.draft.media_items.length ? rep.draft.media_items : rep.draft.media);
        if (reportMediaItems.length) {
          try {
            for (const attachment of reportMediaItems) {
              const file = await alertMediaInput(attachment, 'admin');
              const mediaMessage = attachment.type === 'photo'
                ? await api.sendPhoto(uid, file, { caption: T[lang].mediaReviewAttachment })
                : await api.sendVideo(uid, file, { caption: T[lang].mediaReviewAttachment });
              if (mediaMessage?.message_id) {
                rep.messages.push([uid, mediaMessage.message_id]);
                store.relayPut(`a:${uid}:${mediaMessage.message_id}`, ctx.from.id);
                const remapped = mediaFromSentMessage(mediaMessage, attachment.type, attachment, 'admin');
                rep.draft.media_items = mergeAlertMediaItems(rep.draft.media_items || rep.draft.media, remapped, { replaceSameType: true });
                rep.draft.media = rep.draft.media_items[0];
                store.reportPut(rid, rep);
              }
            }
          } catch (e) { console.warn('[report] media preview to reviewer failed:', e.description || e.message); }
        }
        const m = await api.sendMessage(uid, reportCardText(rep, lang), { parse_mode: 'HTML', reply_markup: reportReviewKeyboard(lang, rid), _keep: 'c' }); // stays until handled
        rep.messages.push([uid, m.message_id]);
        store.reportPut(rid, rep); // saved with every card, so a decision always finds it
        store.relayPut(`a:${uid}:${m.message_id}`, ctx.from.id);
      } catch { /* reviewer has not started the bot */ }
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
      if (rep.draft?.type === 'road') rememberIgnoredRoadReport(rep.draft);
      await closeReport(ctx, rep, true);
      await vanish(ctx, L(ctx).reportRejected(ctx.from.first_name || '') + (action === 'bn' ? ' · 🚫' : ''));
    }
  });
  const activeEditKeyboard = (ctx, d = null) => {
    const en = langOf(ctx) === 'en';
    const kb = new InlineKeyboard()
      .text(en ? '✏️ Headline' : '✏️ العنوان', 'editfield:title').row()
      .text(en ? '📝 Details' : '📝 التفاصيل', 'editfield:details').row()
      .text(en ? '📍 Location' : '📍 الموقع', 'editfield:location').row()
      .text(en ? '👁 Preview changes' : '👁 معاينة التعديلات', 'editpreview').row();
    const a = d?.alertId ? store.getAlert(d.alertId) : null;
    if (a?.is_active) kb.text(a.media
      ? (en ? '🎞 Replace photo/video' : '🎞 استبدال الصورة/الفيديو')
      : (en ? '📎 Add photo/video' : '📎 إضافة صورة/فيديو'), 'alertmedia:' + a.id).row();
    return kb.text(en ? '↩️ Cancel' : '↩️ إلغاء', 'editcancel');
  };
  async function showActiveEditForm(ctx, d) {
    const en = langOf(ctx) === 'en';
    const a = store.getAlert(d.alertId);
    if (!a?.is_active || !a.channel_message_id) return show(ctx, en ? 'This active post is no longer available to edit.' : 'لم يعد هذا المنشور النشط متاحاً للتعديل.', new InlineKeyboard().text(L(ctx).btnBack, 'active'));
    const loc = d.location ? locName(d.location, langOf(ctx)) : (en ? 'Syria (no pin)' : 'سوريا (دون دبوس)');
    const body = `${en ? '<b>Edit channel post</b>' : '<b>تعديل منشور القناة</b>'}\n\n${en ? 'Headline' : 'العنوان'}: ${esc(d.editTitle || a.title || '—')}\n${en ? 'Details' : 'التفاصيل'}: ${esc(d.details || '—')}\n${en ? 'Location' : 'الموقع'}: ${esc(loc)}\n\n${en ? 'Choose a field, then preview and confirm to update the existing post.' : 'اختر حقلاً، ثم عاين وأكّد لتحديث المنشور الحالي.'}`;
    await show(ctx, body, activeEditKeyboard(ctx, d));
  }
  const activeEditDraft = (a) => ({
    mode: 'active_edit', alertId: a.id, type: a.type, step: 'edit_menu',
    editTitle: a.meta?.channelTitle || a.title || '', details: a.description || '',
    location: a.place || locationFrom({}), extra: Array.isArray(a.extra) ? [...a.extra] : [],
  });
  bot.callbackQuery(/^editpost:([\w-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!staff(ctx)) return;
    const a = store.getAlert(ctx.match[1]);
    if (!a?.is_active || !a.channel_message_id) return show(ctx, langOf(ctx) === 'en' ? 'This alert has no editable active channel post.' : 'لا يوجد منشور قناة نشط قابل للتعديل لهذا التنبيه.', new InlineKeyboard().text(L(ctx).btnBack, 'active'));
    sessions.set(sk(ctx), activeEditDraft(a));
    await showActiveEditForm(ctx, getDraft(ctx));
  });
  bot.callbackQuery(/^editfield:(title|details|location)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!staff(ctx)) return;
    const d = getDraft(ctx);
    if (!d || d.mode !== 'active_edit') return;
    const en = langOf(ctx) === 'en';
    if (ctx.match[1] === 'location') {
      d.step = 'gov'; d.gov = ''; d.dist = ''; d.sub = '';
      return askLocation(ctx, d);
    }
    d.step = ctx.match[1] === 'title' ? 'edit_title' : 'edit_details';
    const kb = new InlineKeyboard().text(en ? '↩️ Back' : '↩️ رجوع', 'editmenu').text(en ? 'Cancel' : 'إلغاء', 'editcancel');
    await show(ctx, ctx.match[1] === 'title' ? (en ? 'Send the new headline (up to 120 characters):' : 'أرسل العنوان الجديد (حتى 120 حرفاً):') : (en ? 'Send the updated details, or send “-” to clear them:' : 'أرسل التفاصيل الجديدة، أو أرسل «-» لحذفها:'), kb);
  });
  bot.callbackQuery('editmenu', async (ctx) => { await ctx.answerCallbackQuery(); const d = getDraft(ctx); if (staff(ctx) && d?.mode === 'active_edit') await showActiveEditForm(ctx, d); });
  bot.callbackQuery('editpreview', async (ctx) => {
    await ctx.answerCallbackQuery();
    const d = getDraft(ctx); if (!staff(ctx) || d?.mode !== 'active_edit') return;
    const a = store.getAlert(d.alertId); if (!a?.is_active) return show(ctx, L(ctx).notFound, activeEditKeyboard(ctx));
    d.step = 'preview';
    const loc = d.location ? locName(d.location, langOf(ctx)) : '—';
    const en = langOf(ctx) === 'en';
    const previewKb = new InlineKeyboard().text(en ? '✅ Confirm update' : '✅ تأكيد التحديث', 'editsave').row();
    previewKb.text(a.media ? (en ? '🎞 Replace photo/video' : '🎞 استبدال الصورة/الفيديو') : (en ? '📎 Add photo/video' : '📎 إضافة صورة/فيديو'), 'alertmedia:' + a.id).row();
    previewKb.text(en ? '↩️ Back to fields' : '↩️ رجوع للحقول', 'editmenu').text(en ? 'Cancel' : 'إلغاء', 'editcancel');
    await show(ctx, `${en ? '<b>Review before updating the existing channel post</b>' : '<b>راجع التغييرات قبل تحديث منشور القناة الحالي</b>'}\n\n<b>${esc(d.editTitle || '—')}</b>\n${esc(d.details || (en ? 'No details' : 'لا توجد تفاصيل'))}\n📍 ${esc(loc)}`, previewKb);
  });
  bot.callbackQuery('editsave', async (ctx) => {
    await ctx.answerCallbackQuery();
    const d = getDraft(ctx); if (!staff(ctx) || d?.mode !== 'active_edit' || d.step !== 'preview') return;
    const a = store.getAlert(d.alertId);
    if (!a?.is_active || !a.channel_message_id) return show(ctx, L(ctx).notFound, new InlineKeyboard().text(L(ctx).btnBack, 'active'));
    const meta = { ...(a.meta || {}), channelTitle: d.editTitle };
    const place = d.location || a.place;
    const candidate = { ...a, title: d.editTitle, description: d.details, place, extra: d.extra || [], meta };
    try {
      const text = channelPost(candidate);
      const opts = { parse_mode: 'HTML', reply_markup: channelKeyboard(candidate), link_preview_options: { is_disabled: true } };
      if (['photo', 'video'].includes(a.channel_media)) await ctx.api.editMessageCaption(config.channel, a.channel_message_id, { caption: channelCaption(candidate), parse_mode: 'HTML', reply_markup: channelKeyboard(candidate) });
      else await ctx.api.editMessageText(config.channel, a.channel_message_id, text, opts);
    } catch (e) {
      const msg = String(e.description || e.message || '');
      if (!msg.includes('not modified')) {
        console.error('[bot] active post edit failed:', msg);
        return show(ctx, langOf(ctx) === 'en' ? `Could not update the channel post: ${esc(msg)}` : `تعذر تحديث منشور القناة: ${esc(msg)}`, new InlineKeyboard().text(langOf(ctx) === 'en' ? '↩️ Back' : '↩️ رجوع', 'editmenu').text(langOf(ctx) === 'en' ? 'Cancel' : 'إلغاء', 'editcancel'));
      }
    }
    const areas = [place, ...(d.extra || [])].filter((x) => x && x.scope !== 'country').map((x) => x.name_ar).filter(Boolean);
    store.updateAlert(a.id, { title: d.editTitle, description: d.details, place, extra: d.extra || [], areas, meta });
    sessions.delete(sk(ctx));
    await show(ctx, langOf(ctx) === 'en' ? '✅ Existing channel post and map alert updated.' : '✅ تم تحديث المنشور الحالي والتنبيه على الخريطة.', resultKeyboard(ctx, store.getAlert(a.id)).row().text(L(ctx).btnBack, 'active'));
  });
  bot.callbackQuery('editcancel', async (ctx) => { await ctx.answerCallbackQuery(); if (staff(ctx)) { sessions.delete(sk(ctx)); await showActive(ctx); } });
  // -------- active alerts management
  async function showActive(ctx) {
    const l = L(ctx);
    const lang = langOf(ctx);
    const act = store.activeAlerts().slice(0, 30);
    if (!act.length) return show(ctx, l.noActive, new InlineKeyboard().text(l.btnHome, 'home'));
    const kb = new InlineKeyboard();
    for (const a of act) {
      const t = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(a.timestamp));
      const emoji = alertEmoji(a);
      kb.text(`${emoji ? `${emoji} ` : ''}${t} · ${(lang === 'en' ? a.title_en : a.title) || ''}`.slice(0, 60), 'm:' + a.id).row();
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
  bot.callbackQuery(/^alertmedia:([\w-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (role !== 'admin' || !staff(ctx)) return;
    const alert = store.getAlert(ctx.match[1]);
    if (!alert?.is_active) return show(ctx, L(ctx).notFound, new InlineKeyboard().text(L(ctx).btnBack, 'active'));
    activeMediaSessions.set(sk(ctx), { alertId: alert.id, created: Date.now() });
    const en = langOf(ctx) === 'en';
    const note = alert.channel_message_id
      ? (en ? 'The map attachment will change; the channel post keeps its map snapshot.' : 'سيتغير مرفق الخريطة فقط، ويبقى منشور القناة بلقطة الخريطة.')
      : (en ? 'This updates the map attachment only.' : 'سيُحدَّث مرفق الخريطة فقط.');
    await show(ctx, `${L(ctx).askMedia}\n\n<i>${note}</i>`, new InlineKeyboard().text(L(ctx).btnCancel, 'cancel').row().text(L(ctx).btnBack, 'm:' + alert.id));
  });

  const manageText = (ctx, a) => {
    const lang = langOf(ctx);
    const exp = a.expires_at
      ? new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-SY', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(a.expires_at))
      : (lang === 'en' ? 'No expiry' : 'بلا انتهاء');
    const emoji = alertEmoji(a);
    return `${L(ctx).manageTitle}\n\n${emoji ? `${emoji} ` : ''}<b>${esc(lang === 'en' ? a.title_en : a.title)}</b>\n${a.description ? esc(a.description) + '\n' : ''}🕒 ${esc(fmtTime(a.timestamp, lang))}\n⌛ ${lang === 'en' ? 'Expires' : 'ينتهي'}: ${exp}${a.is_active ? '' : '\n\n' + L(ctx).ended}`;
  };
  bot.callbackQuery(/^m:([\w-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!staff(ctx)) return;
    const a = store.getAlert(ctx.match[1]);
    if (!a) return show(ctx, L(ctx).notFound, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
    const kb = resultKeyboard(ctx, a);
    if (a.is_active && a.channel_message_id) kb.row().text(langOf(ctx) === 'en' ? '✏️ Edit channel post' : '✏️ تعديل المنشور', 'editpost:' + a.id);
    kb.row().text(L(ctx).btnBack, 'active');
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
    const flightOrigin = d.type === 'air_movement' && d.selectingFlightOrigin === true;
    const validPoint = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    if (!validPoint || (!flightOrigin && !insideSyriaBox(lat, lon))) return ctx.reply(L(ctx).outside);
    d.msgId = null;
    const loc = flightOrigin
      ? { scope: 'point', name_ar: 'نقطة رصد تقريبية', name_en: 'Approximate observation point', latitude: lat, longitude: lon }
      : locationFrom({ lat, lon });
    await pickLocation(ctx, d, loc);
  });

  const alnabaUploadError = (error, en) => {
    if (error?.message === 'FILE_TOO_LARGE') return en ? 'The file exceeds the limit: 10 MB for images, 20 MB for PDF/audio/video.' : 'حجم الملف أكبر من الحد: 10 ميغابايت للصور و20 ميغابايت لملفات PDF والصوت والفيديو.';
    if (error?.message === 'MISSING_TITLE') return en ? 'Add a headline in the caption, then resend.' : 'أضف عنواناً في وصف الملف ثم أعد إرساله.';
    if (error?.message === 'MISSING_ISSUE_NUMBER') return en ? 'Add a positive issue number in the caption or start the PDF filename with that number (for example, 5.pdf).' : 'أضف رقم العدد الموجب في الوصف أو ابدأ اسم ملف PDF بالرقم (مثلاً 5.pdf).';
    if (error?.message === 'INVALID_ISSUE_NUMBER') return en ? 'Use a positive whole-number issue number.' : 'استخدم رقماً صحيحاً موجباً للعدد.';
    if (error?.message === 'DUPLICATE_ISSUE_NUMBER') return en ? 'That issue number is already in use; choose another number.' : 'رقم هذا العدد مستخدم مسبقاً؛ اختر رقماً آخر.';
    if (error?.message === 'DUPLICATE_MEDIA') return en ? 'This exact file is already published in Al-Nabaa.' : 'هذا الملف منشور مسبقاً في النبأ.';
    if (['BACKUP_UNAVAILABLE', 'BACKUP_FAILED'].includes(error?.message)) return en ? 'The durable backup is unavailable. Files already saved in the queue will retry after recovery; resend only if the initial queue save failed.' : 'النسخة الاحتياطية الدائمة غير متاحة. ستُعاد محاولة الملفات المحفوظة في القائمة بعد استعادتها؛ أعد الإرسال فقط إذا فشل حفظ الملف في القائمة أول مرة.';
    if (['INVALID_MEDIA_TYPE', 'INVALID_FILE_NAME', 'INVALID_FILE_CONTENT'].includes(error?.message)) return en ? 'This file is not a valid supported image, PDF, audio, or video file for the selected section.' : 'الملف ليس صورة أو PDF أو صوتاً أو فيديو صالحاً ومدعوماً للقسم المحدد.';
    return en ? 'Telegram could not verify the file. Please retry with a smaller supported file.' : 'تعذّر التحقق من الملف عبر Telegram. أعد المحاولة بملف أصغر وبصيغة مدعومة.';
  };
  const alnabaQueueCheckpointError = (error, en) => ['BACKUP_UNAVAILABLE', 'BACKUP_FAILED'].includes(error?.message)
    ? (en ? 'This file was not durably queued or published because the backup could not be saved. Resend it after backup recovery.' : 'لم يُحفظ هذا الملف في قائمة انتظار دائمة ولم يُنشر لتعذّر حفظ النسخة الاحتياطية. أعد إرساله بعد استعادة النسخ الاحتياطي.')
    : alnabaUploadError(error, en);
  const ALNABA_BATCH_TTL_MS = 24 * 60 * 60_000;
  const batchRecord = (id) => store.state.alnabaBatches?.find((record) => record.id === id) || null;
  const batchEntry = (batchId, itemKey) => batchRecord(batchId)?.items.find((item) => item.key === itemKey) || null;
  const setBatchEntry = (batchId, itemKey, patch) => {
    const record = batchRecord(batchId);
    const entry = record?.items.find((item) => item.key === itemKey);
    if (!record || !entry) return false;
    Object.assign(entry, patch, { updated_at: new Date().toISOString() });
    record.updated_at = entry.updated_at;
    if (record.items.every((item) => ['published', 'failed', 'cancelled', 'expired'].includes(item.status))) record.status = 'complete';
    else if (record.status !== 'collecting') record.status = 'processing';
    return true;
  };
  const persistAlnabaBatchState = async () => withAlnabaWriteLock(async () => {
    if (!store.backup || !config.telegramBackup) throw new Error('BACKUP_UNAVAILABLE');
    store.persist();
    clearTimeout(store._saveTimer);
    store._writeLocal();
    await store.flushBackup();
    if (store._backupPending) throw new Error('BACKUP_FAILED');
  });
  let batchCheckpointTimer = null;
  let batchCheckpointPromise = null;
  let batchCheckpointResolve = null;
  let batchCheckpointReject = null;
  let batchCheckpointRevision = 0;
  const runBatchCheckpoint = async () => {
    const savedRevision = batchCheckpointRevision;
    try {
      await persistAlnabaBatchState();
      if (savedRevision !== batchCheckpointRevision) {
        batchCheckpointTimer = setTimeout(runBatchCheckpoint, 180).unref();
        return;
      }
      const resolve = batchCheckpointResolve;
      batchCheckpointPromise = null;
      batchCheckpointResolve = null;
      batchCheckpointReject = null;
      resolve?.();
    } catch (error) {
      const reject = batchCheckpointReject;
      batchCheckpointPromise = null;
      batchCheckpointResolve = null;
      batchCheckpointReject = null;
      reject?.(error);
    }
  };
  const scheduleBatchCheckpoint = () => {
    batchCheckpointRevision += 1;
    store.persist();
    store._writeLocal();
    if (!batchCheckpointPromise) {
      batchCheckpointPromise = new Promise((resolve, reject) => {
        batchCheckpointResolve = resolve;
        batchCheckpointReject = reject;
      });
    }
    clearTimeout(batchCheckpointTimer);
    batchCheckpointTimer = setTimeout(runBatchCheckpoint, 180).unref();
    return batchCheckpointPromise;
  };
  const findPublishedAlnabaUpload = (section, candidate) => (store.state.alnaba?.[section] || []).find((item) =>
    candidate.file_unique_id && item.file_unique_id
      ? item.file_unique_id === candidate.file_unique_id
      : item.file_id === candidate.file_id) || null;
  const receiveAlnabaUpload = async (ctx, candidate, { batch = false, keepSession = false, batchRef = null } = {}) => {
    const uid = Number(ctx.from?.id);
    if (!alnabaOwner(ctx)) return false;
    if (alnabaBatchIntakePaused) {
      await ctx.reply(langOf(ctx) === 'en'
        ? 'Al-Nabaa uploads are temporarily paused while the previous backup is being restored. Nothing was queued or published; please retry shortly.'
        : 'رفع النبأ متوقف مؤقتاً أثناء استعادة النسخة السابقة. لم يُحفظ الملف ولم يُنشر؛ أعد المحاولة بعد قليل.');
      return true;
    }
    const flow = alnabaSessions.get(uid);
    if (!flow) return false;
    const en = langOf(ctx) === 'en';
    if (alnabaPendingManagementEdits.has(uid) || alnabaPendingManagementDeletes.has(uid)) {
      await ctx.reply(en ? 'Finish or cancel the current management action first.' : 'أكمل إجراء الإدارة الحالي أو ألغِه أولاً.', { reply_markup: alnabaHomeKeyboard(ctx) });
      return true;
    }
    if (flow.section === 'archive') {
      await ctx.reply(en ? 'Send the archive title and Telegram link as a two-line text message.' : 'أرسل عنوان الأرشيف ورابط Telegram في رسالة نصية من سطرين.', { reply_markup: alnabaHomeKeyboard(ctx) });
      return true;
    }
    if (Date.now() - flow.createdAt > 30 * 60_000) {
      alnabaSessions.delete(uid);
      await ctx.reply(en ? 'The upload session expired. Start again with /alnaba.' : 'انتهت جلسة الرفع. ابدأ مجدداً عبر /alnaba.', { reply_markup: alnabaHomeKeyboard(ctx) });
      return true;
    }
    if (alnabaPendingUploads.has(uid)) {
      await ctx.reply(en ? 'Confirm or cancel the current upload before sending another.' : 'أكّد الملف الحالي أو ألغِه قبل إرسال ملف آخر.', { reply_markup: alnabaHomeKeyboard(ctx) });
      return true;
    }
    const replacementTarget = flow.mode === 'replace' ? findAlnabaEntry(store, flow.section, flow.itemId) : null;
    if (flow.mode === 'replace' && !replacementTarget) {
      alnabaSessions.delete(uid);
      await ctx.reply(en ? 'This item no longer exists. Open the management list again.' : 'لم يعد هذا المنشور موجوداً. افتح قائمة الإدارة مجدداً.', { reply_markup: alnabaHomeKeyboard(ctx) });
      return true;
    }
    try {
      let uploadInput = {
        ...candidate,
        section: flow.section,
        ...(replacementTarget ? {
          title: replacementTarget.title,
          description: candidate.description || replacementTarget.description,
          ...(flow.section === 'weekly' ? { issue_number: weeklyIssueNumber(replacementTarget) || candidate.issue_number } : {}),
        } : {}),
      };
      if (!replacementTarget && flow.section === 'weekly') {
        const suppliedIssue = Number(uploadInput.issue_number);
        const issueNumber = Number.isSafeInteger(suppliedIssue) && suppliedIssue > 0
          ? suppliedIssue : nextWeeklyIssueNumber(store.state.alnaba?.weekly || []);
        if (!issueNumber) throw new Error('ISSUE_NUMBER_EXHAUSTED');
        uploadInput = { ...uploadInput, issue_number: issueNumber, title: uploadInput.title || `العدد ${issueNumber}` };
      }
      const prepared = prepareAlnabaUpload(uploadInput);
      if (batchRef) {
        const alreadyPublished = findPublishedAlnabaUpload(flow.section, prepared);
        if (alreadyPublished) {
          await withAlnabaWriteLock(async () => {
            if (!store.backup || !config.telegramBackup) throw new Error('BACKUP_UNAVAILABLE');
            setBatchEntry(batchRef.batchId, batchRef.itemKey, { status: 'published', published_item_id: alreadyPublished.id, error: undefined });
            store.persist();
            await store.flushBackup();
            if (store._backupPending) {
              setBatchEntry(batchRef.batchId, batchRef.itemKey, { status: 'processing', error: 'BACKUP_FAILED' });
              store.persist({ backupSoon: false });
              throw new Error('BACKUP_FAILED');
            }
          });
          return { status: 'already_published', item: alreadyPublished };
        }
      }
      await fetchAlnabaTelegramBytes(prepared, { api: ctx.api, token: TOKENS.admin });
      if (replacementTarget) {
        const token = randomUUID();
        alnabaPendingManagementEdits.set(uid, { section: flow.section, id: flow.itemId, page: flow.page, changes: { media: prepared }, token, createdAt: Date.now() });
        alnabaSessions.delete(uid);
        const text = en
          ? `Review the replacement for <b>${esc(replacementTarget.title)}</b>:\n${esc(prepared.file_name)}\n\nThe current file stays in place until you save this change.`
          : `راجع الملف البديل للمنشور <b>${esc(replacementTarget.title)}</b>:\n${esc(prepared.file_name)}\n\nيبقى الملف الحالي كما هو حتى تؤكد التعديل.`;
        const keyboard = new InlineKeyboard()
          .text(en ? '✅ Save replacement' : '✅ حفظ الاستبدال', `nb:edit-save:${token}`)
          .text(en ? 'Cancel' : 'إلغاء', 'nb:cancel');
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: withAlnabaHomeButton(keyboard, ctx) });
        return true;
      }
      if (!store.backup || !config.telegramBackup) throw new Error('BACKUP_UNAVAILABLE');
      const item = await withAlnabaWriteLock(async () => {
        let finalPrepared = prepared;
        if (flow.section === 'weekly' && !replacementTarget && !candidate.issue_number) {
          const issueNumber = nextWeeklyIssueNumber(store.state.alnaba?.weekly || []);
          if (!issueNumber) throw new Error('ISSUE_NUMBER_EXHAUSTED');
          finalPrepared = prepareAlnabaUpload({ ...uploadInput, issue_number: issueNumber, title: candidate.title || `العدد ${issueNumber}` });
        }
        const oldSectionItems = structuredClone(store.state.alnaba?.[flow.section] || []);
        let publishedItemId = null;
        try {
          const alreadyPublished = findPublishedAlnabaUpload(flow.section, finalPrepared);
          if (alreadyPublished) {
            publishedItemId = alreadyPublished.id;
            if (batchRef) {
              setBatchEntry(batchRef.batchId, batchRef.itemKey, { status: 'published', published_item_id: alreadyPublished.id, error: undefined });
              store.persist();
            }
            await store.flushBackup();
            if (store._backupPending) throw new Error('BACKUP_FAILED');
            return { item: alreadyPublished, duplicate: true };
          }
          const published = publishAlnabaItem(store, uid, finalPrepared, new Date());
          publishedItemId = published.id;
          if (batchRef) {
            setBatchEntry(batchRef.batchId, batchRef.itemKey, { status: 'published', published_item_id: published.id, error: undefined });
            store.persist();
          }
          await store.flushBackup();
          if (store._backupPending) throw new Error('BACKUP_FAILED');
          return { item: published, duplicate: false };
        } catch (error) {
          if (batchRef && ['BACKUP_FAILED', 'BACKUP_UNAVAILABLE'].includes(error?.message)) {
            // The remote write may have landed even if Telegram returned an error. Keep the content
            // and the stable file reference, but leave this item processing so retry/recovery can
            // detect the existing publication and checkpoint it without creating another item.
            const entry = batchEntry(batchRef.batchId, batchRef.itemKey);
            setBatchEntry(batchRef.batchId, batchRef.itemKey, {
              status: 'processing', attempts: Math.min(100, entry?.attempts || 0), error: error.message,
            });
            store.persist({ backupSoon: false });
          } else if (batchRef && publishedItemId) {
            // A non-backup failure after the website item exists is also an ambiguous commit.
            // Keep that item and retry by its stable file reference; never roll back other queue entries.
            setBatchEntry(batchRef.batchId, batchRef.itemKey, {
              status: 'processing', published_item_id: publishedItemId,
              error: 'PUBLISH_COMMIT_UNCERTAIN',
            });
            store.persist({ backupSoon: false });
          } else {
            store.state.alnaba = { ...store.state.alnaba, [flow.section]: oldSectionItems };
            store.persist({ backupSoon: false });
          }
          throw error;
        }
      });
      const publishedItem = item.item;
      if (keepSession) alnabaSessions.set(uid, { section: publishedItem.section, createdAt: Date.now() });
      else alnabaSessions.delete(uid);
      alnabaPendingUploads.delete(uid);
      if (batch) return { status: item.duplicate ? 'already_published' : 'published', item: publishedItem };
      const link = alnabaSite(publishedItem.section);
      const addLabel = publishedItem.section === 'photos'
        ? (en ? '➕ Add another item' : '➕ إضافة خبر جديد')
        : (en ? '➕ Add another item' : '➕ إضافة محتوى');
      const keyboard = new InlineKeyboard()
        .text(addLabel, `nb:${publishedItem.section}`).row()
        .url(en ? 'Open section' : 'فتح القسم', link)
        .url(en ? 'Al-Nabaa home' : 'صفحة النبأ', alnabaSite());
      const expiry = publishedItem.section === 'photos' ? (en ? ' This photo-news item will be removed after 24 hours.' : ' سيُزال الخبر المصوّر بعد 24 ساعة.') : '';
      const success = en
        ? `✅ Published directly on the Al-Nabaa website only: <b>${esc(publishedItem.title)}</b>. It was not sent to the Telegram channel.${expiry}`
        : `✅ نُشر مباشرةً على موقع النبأ فقط: <b>${esc(publishedItem.title)}</b>، ولم يُرسل إلى قناة تيليغرام.${expiry}`;
      await ctx.reply(success, { parse_mode: 'HTML', reply_markup: withAlnabaHomeButton(keyboard, ctx) });
      return true;
    } catch (error) {
      if (batch) {
        if (batchRef && !['BACKUP_FAILED', 'BACKUP_UNAVAILABLE'].includes(error?.message)) {
          const entry = batchEntry(batchRef.batchId, batchRef.itemKey);
          const publicationMayExist = entry?.published_item_id
            && store.state.alnaba?.[entry.section]?.some((item) => item.id === entry.published_item_id);
          if (!publicationMayExist) {
            setBatchEntry(batchRef.batchId, batchRef.itemKey, { status: 'failed', attempts: (entry?.attempts || 0) + 1, error: String(error?.message || 'UPLOAD_FAILED').slice(0, 80) });
            try { await persistAlnabaBatchState(); } catch { /* keep the processing record for safe retry */ }
          }
        }
        return { status: 'failed', error };
      }
      await ctx.reply(alnabaUploadError(error, en), { reply_markup: alnabaHomeKeyboard(ctx) });
      return true;
    }
  };
  const captionMetadata = (section, caption, fileName, fallbackTitle) => {
    if (section === 'weekly') return parseWeeklyUploadCaption(caption, fileName);
    if (section === 'quran' || section === 'nasheed') {
      const lines = String(caption || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const inferredName = String(fileName || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      return { title: lines.shift() || inferredName || fallbackTitle, description: lines.join('\n') };
    }
    return { title: String(caption || '').trim() || fallbackTitle, description: '' };
  };
  const alnabaMediaFromMessage = (message, type) => {
    let media;
    if (type === 'photo') {
      media = message.photo?.at(-1);
      if (media) media = { ...media, mime_type: 'image/jpeg', file_name: 'alnaba-photo.jpg' };
    } else if (type === 'document') media = message.document;
    else if (type === 'voice') media = message.voice ? { ...message.voice, mime_type: message.voice.mime_type || 'audio/ogg', file_name: 'alnaba-voice.ogg' } : null;
    else media = message[type];
    if (!media) return null;
    const fileName = media.file_name || (type === 'video' ? 'alnaba-video.mp4' : type === 'audio' ? 'alnaba-audio.mp3' : '');
    const inferredMime = media.mime_type || mimeFromAlnabaFilename(fileName)
      || (type === 'video' ? 'video/mp4' : type === 'audio' ? 'audio/mpeg' : '');
    return { media, fileName, inferredMime };
  };
  const alnabaUploadCandidate = (message, type, section, { forwarded = false } = {}) => {
    const attachment = alnabaMediaFromMessage(message, type);
    if (!attachment) return null;
    const { media, fileName, inferredMime } = attachment;
    const metadata = captionMetadata(section, message.caption, fileName,
      section === 'quran' ? 'تلاوة قرآنية' : section === 'nasheed' ? 'محتوى صوتي' : '');
    const embeddedTitle = [media.performer, media.title].filter(Boolean).join(' — ').trim();
    if (['quran', 'nasheed'].includes(section) && embeddedTitle && !String(message.caption || '').trim()) metadata.title = embeddedTitle;
    const genericTitle = String(fileName || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    if (['quran', 'nasheed'].includes(section) && !String(message.caption || '').trim()
      && !embeddedTitle
      && /^(?:alnaba[\s_-]*)?(?:voice|audio|video|recording|media|file|clip|voice message|quran|koran|nasheed|nashid)$/iu.test(genericTitle)) metadata.title = '';
    return {
      ...metadata,
      file_id: media.file_id,
      file_unique_id: media.file_unique_id,
      file_size: media.file_size,
      mime_type: type === 'photo' ? 'image/jpeg' : inferredMime,
      file_name: fileName,
    };
  };
  const isForwardedAlnabaMessage = (message) => Boolean(message?.forward_origin || message?.forward_date || message?.forward_from || message?.forward_from_chat || message?.forward_sender_name);
  const isAudioVideoAlnabaMessage = (message, type) => {
    const attachment = alnabaMediaFromMessage(message, type);
    const mime = attachment?.inferredMime || '';
    return ['audio', 'voice', 'video'].includes(type) || mime.startsWith('audio/') || mime.startsWith('video/');
  };
  const classifyForwardedAlnabaSection = (message, type) => {
    const attachment = alnabaMediaFromMessage(message, type);
    if (!attachment) return null;
    const contentText = [message.caption, attachment.fileName, attachment.media.title, attachment.media.performer].filter(Boolean).join(' ');
    const origin = message.forward_origin || {};
    const originText = [origin.chat?.title, origin.chat?.username, message.forward_from_chat?.title, message.forward_from_chat?.username].filter(Boolean).join(' ');
    const quranPattern = /(?:^|[^\p{L}\p{N}])(?:القرآن|القران|قرآن|قران|قرآني(?:ة|ات)?|قراني(?:ة|ات)?|تلاو(?:ة|ات)|سورة|سور(?:ة|ات)?|آيات?|آية|ترتيل|مرتّل|qur(?:an|ān)|koran|surah|ayat|recitation|tajwid|tajweed)(?:$|[^\p{L}\p{N}])/iu;
    const nasheedPattern = /(?:^|[^\p{L}\p{N}])(?:أناشيد|اناشيد|نشيد(?:ة|ات)?|أنشودة|انشودة|إنشاد|انشاد|مدائح|nasheed(?:s)?|nashid(?:s)?)(?:$|[^\p{L}\p{N}])/iu;
    const classifyText = (value) => {
      const quran = quranPattern.test(value);
      const nasheed = nasheedPattern.test(value);
      return quran === nasheed ? null : quran ? 'quran' : 'nasheed';
    };
    const contentSection = classifyText(contentText);
    if (contentSection) return contentSection;
    if (quranPattern.test(contentText) && nasheedPattern.test(contentText)) return null;
    const originSection = classifyText(originText);
    if (originSection) return originSection;
    if (quranPattern.test(originText) && nasheedPattern.test(originText)) return null;
    const mime = attachment.inferredMime || '';
    if (mime === 'application/pdf' || /\.pdf$/i.test(attachment.fileName)) return 'weekly';
    if (type === 'photo' || mime.startsWith('image/') || /\.(?:jpe?g|png|webp)$/i.test(attachment.fileName)) return 'photos';
    return null;
  };
  const ALNABA_BATCH_QUIET_MS = 700;
  const ALNABA_BATCH_MAX_WAIT_MS = 3500;
  const batchContext = (ownerId, messageId, mediaGroupId = null) => ({
    from: { id: Number(ownerId) }, chat: { id: Number(ownerId), type: 'private' },
    message: { message_id: Number(messageId), ...(mediaGroupId ? { media_group_id: mediaGroupId } : {}) },
    api: bot.api,
    reply: (text, options) => bot.api.sendMessage(Number(ownerId), text, options),
  });
  const attachRuntimeBatchItem = (ctx, record, savedItem) => {
    const uid = Number(record.owner_id);
    let batch = alnabaUploadBatches.get(uid);
    if (!batch) {
      batch = { items: [], firstAt: Date.now(), timer: null };
      alnabaUploadBatches.set(uid, batch);
    }
    if (!batch.items.some((entry) => entry.itemKey === savedItem.key)) {
      batch.items.push({
        ctx, batchId: record.id, itemKey: savedItem.key, section: savedItem.section,
        candidate: savedItem.candidate, messageId: savedItem.message_id, mediaGroupId: savedItem.media_group_id || null,
      });
    }
    clearTimeout(batch.timer);
    const remainingMaxWait = Math.max(0, ALNABA_BATCH_MAX_WAIT_MS - (Date.now() - batch.firstAt));
    batch.timer = setTimeout(() => { void finishAlnabaBatch(uid); }, Math.min(ALNABA_BATCH_QUIET_MS, remainingMaxWait)).unref();
    return batch;
  };
  const retryRuntimeBatch = (uid, batch, delay = 30_000) => {
    const retry = { ...batch, timer: null };
    alnabaUploadBatches.set(uid, retry);
    retry.timer = setTimeout(() => { void finishAlnabaBatch(uid); }, delay).unref();
  };
  const finishAlnabaBatch = (uid) => {
    const batch = alnabaUploadBatches.get(Number(uid));
    if (!batch) return Promise.resolve();
    clearTimeout(batch.timer);
    alnabaUploadBatches.delete(Number(uid));
    const items = batch.items.sort((a, b) => a.messageId - b.messageId);
    const previous = alnabaBatchQueues.get(Number(uid)) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const eligible = items.filter((entry) => {
        const saved = batchEntry(entry.batchId, entry.itemKey);
        return saved && ['pending', 'processing'].includes(saved.status);
      });
      if (!eligible.length) return;
      for (const entry of eligible) {
        const saved = batchEntry(entry.batchId, entry.itemKey);
        setBatchEntry(entry.batchId, entry.itemKey, { status: 'processing', attempts: Math.min(100, (saved?.attempts || 0) + 1), error: undefined });
        const record = batchRecord(entry.batchId);
        if (record) record.status = 'processing';
      }
      try {
        await persistAlnabaBatchState();
      } catch (error) {
        for (const entry of eligible) {
          const en = langOf(entry.ctx) === 'en';
          await entry.ctx.reply(en
            ? '⏸️ This file is durably queued but was not published because the backup is unavailable. It will retry after backup recovery.'
            : '⏸️ الملف محفوظ في قائمة الانتظار ولم يُنشر لتعذّر النسخ الاحتياطي. ستُستأنف المحاولة عند عودته.').catch(() => {});
        }
        retryRuntimeBatch(uid, batch);
        console.error('[alnaba] could not checkpoint batch processing state', error?.message);
        return;
      }
      let retryNeeded = false;
      for (const entry of eligible) {
        let saved = batchEntry(entry.batchId, entry.itemKey);
        if (!saved || !['pending', 'processing'].includes(saved.status)) continue;
        const record = batchRecord(entry.batchId);
        const en = langOf(entry.ctx) === 'en';
        const fileLabel = saved.candidate?.file_name || `message ${entry.messageId}`;
        if (record && Date.parse(record.expires_at) <= Date.now()) {
          setBatchEntry(entry.batchId, entry.itemKey, { status: 'expired', error: 'BATCH_EXPIRED' });
          record.status = 'expired';
          try { await persistAlnabaBatchState(); } catch (error) { retryRuntimeBatch(uid, batch); break; }
          await entry.ctx.reply(en
            ? `⌛ ${entry.messageId}: <b>${esc(fileLabel)}</b> expired before publishing and was not published. Please resend it.`
            : `⌛ الرسالة ${entry.messageId}: انتهت مهلة الملف <b>${esc(fileLabel)}</b> قبل النشر ولم يُنشر. أعد إرساله.`, { parse_mode: 'HTML' }).catch(() => {});
          continue;
        }
        const section = saved.section;
        if (!section || !saved.candidate) continue;
        const candidate = { ...saved.candidate };
        if (['quran', 'nasheed'].includes(section) && !candidate.title) {
          const count = store.state.alnaba?.[section]?.length || 0;
          candidate.title = section === 'nasheed' ? `نشيد ${count + 1}` : `تلاوة قرآنية ${count + 1}`;
          saved.candidate.title = candidate.title;
        }
        alnabaSessions.set(Number(uid), { section, createdAt: Date.now() });
        let result;
        try {
          result = await receiveAlnabaUpload(entry.ctx, candidate, { batch: true, batchRef: { batchId: entry.batchId, itemKey: entry.itemKey } });
        } catch (error) {
          result = { status: 'failed', error };
        }
        saved = batchEntry(entry.batchId, entry.itemKey);
        if (result?.status === 'failed' && ['BACKUP_FAILED', 'BACKUP_UNAVAILABLE'].includes(result.error?.message)) {
          await entry.ctx.reply(alnabaUploadError(result.error, en), { reply_markup: alnabaHomeKeyboard(entry.ctx) }).catch(() => {});
          retryRuntimeBatch(uid, batch);
          break;
        }
        if (result?.status === 'failed' && saved?.status === 'processing' && saved.published_item_id) {
          await entry.ctx.reply(en
            ? `↻ ${entry.messageId}: the website may already have accepted this file. It remains queued for a duplicate-safe retry.`
            : `↻ الرسالة ${entry.messageId}: قد يكون الموقع قد قبل هذا الملف بالفعل. بقي في قائمة الانتظار لإعادة محاولة آمنة تمنع التكرار.`).catch(() => {});
          retryNeeded = true;
          continue;
        }
        if (['published', 'already_published'].includes(result?.status)) {
          const published = result.item;
          const label = published.section === 'weekly' ? `#${published.issue_number} — ${published.title}` : published.title;
          const text = result.status === 'already_published'
            ? (en ? `↩️ ${entry.messageId}: this exact file was already published as <b>${esc(label)}</b>; no duplicate was created.` : `↩️ الرسالة ${entry.messageId}: هذا الملف منشور مسبقاً بعنوان <b>${esc(label)}</b>؛ لم تُنشأ نسخة مكررة.`)
            : (en ? `✅ ${entry.messageId}: published directly on the Al-Nabaa website only, in <b>${esc(section)}</b>: <b>${esc(fileLabel)}</b> as <b>${esc(label)}</b>.` : `✅ الرسالة ${entry.messageId}: نُشر مباشرةً على موقع النبأ فقط، في قسم <b>${esc(section)}</b>: <b>${esc(fileLabel)}</b> بعنوان <b>${esc(label)}</b>.`);
          const addLabel = published.section === 'photos'
            ? (en ? '➕ Add another item' : '➕ إضافة خبر جديد')
            : (en ? '➕ Add another item' : '➕ إضافة محتوى');
          const keyboard = new InlineKeyboard()
            .text(addLabel, `nb:${published.section}`).row()
            .url(en ? 'Open section' : 'فتح القسم', alnabaSite(published.section))
            .url(en ? 'Al-Nabaa home' : 'صفحة النبأ', alnabaSite());
          await entry.ctx.reply(text, { parse_mode: 'HTML', reply_markup: withAlnabaHomeButton(keyboard, entry.ctx) }).catch((error) => console.error('[alnaba] batch success reply failed', error?.message));
        } else {
          const reason = result?.error ? alnabaUploadError(result.error, en) : (en ? 'Could not process this file.' : 'تعذّرت معالجة هذا الملف.');
          const text = en
            ? `❌ ${entry.messageId}: <b>${esc(fileLabel)}</b> was not published: ${esc(reason)}`
            : `❌ الرسالة ${entry.messageId}: لم يُنشر الملف <b>${esc(fileLabel)}</b>: ${esc(reason)}`;
          await entry.ctx.reply(text, { parse_mode: 'HTML', reply_markup: alnabaHomeKeyboard(entry.ctx) }).catch((error) => console.error('[alnaba] batch failure reply failed', error?.message));
        }
      }
      if (retryNeeded) retryRuntimeBatch(uid, batch);
      alnabaSessions.delete(Number(uid));
    }).catch((error) => console.error('[alnaba] batch processing failed', error?.message));
    alnabaBatchQueues.set(Number(uid), task);
    task.then(() => { if (alnabaBatchQueues.get(Number(uid)) === task) alnabaBatchQueues.delete(Number(uid)); });
    return task;
  };
  const issueBatchSectionPrompt = async (ctx, record, savedItem) => {
    for (const [existingToken, choice] of alnabaBatchSectionChoices) {
      if (choice.batchId !== record.id || choice.itemKey !== savedItem.key) continue;
      if (Date.now() - choice.createdAt <= 30 * 60_000) return null;
      alnabaBatchSectionChoices.delete(existingToken);
    }
    const token = randomUUID().replace(/-/g, '').slice(0, 12);
    const ownerId = Number(record.owner_id);
    alnabaBatchSectionChoices.set(token, { ownerId, batchId: record.id, itemKey: savedItem.key, createdAt: Date.now() });
    const keyboard = new InlineKeyboard()
      .text(langOf(ctx) === 'en' ? '📖 Quran' : '📖 القرآن الكريم', `nb:batch-section:${token}:quran`)
      .text(langOf(ctx) === 'en' ? '🎵 Nasheeds' : '🎵 الأناشيد', `nb:batch-section:${token}:nasheed`).row()
      .text(langOf(ctx) === 'en' ? 'Keep private / cancel this file' : 'إبقاء خاصاً / إلغاء هذا الملف', `nb:batch-cancel:${token}`);
    return ctx.reply(langOf(ctx) === 'en'
      ? `This forwarded file is ambiguous (message ${savedItem.message_id}); it remains private. Choose its section. Other files continue processing independently.`
      : `هذا الملف المعاد توجيهه ملتبس (الرسالة ${savedItem.message_id}) وسيبقى خاصاً. اختر قسمه؛ وتستمر معالجة بقية الملفات بشكل مستقل.`,
    { reply_markup: withAlnabaHomeButton(keyboard, ctx) });
  };
  const queueAlnabaBatchUpload = async (ctx, section, candidate, sourceMessageId = null, existingRef = null) => {
    const uid = Number(ctx.from?.id);
    if (!alnabaOwner(ctx) || !candidate || !['photos', 'weekly', 'quran', 'nasheed'].includes(section)) return false;
    if (alnabaBatchIntakePaused) {
      await ctx.reply(langOf(ctx) === 'en'
        ? 'Al-Nabaa uploads are temporarily paused while the previous backup is being restored. Nothing was queued or published; please retry shortly.'
        : 'رفع النبأ متوقف مؤقتاً أثناء استعادة النسخة السابقة. لم يُحفظ الملف ولم يُنشر؛ أعد المحاولة بعد قليل.');
      return true;
    }
    const messageId = Number(sourceMessageId || ctx.message?.message_id) || Date.now();
    const mediaGroupId = ctx.message?.media_group_id || null;
    const batchId = existingRef?.batchId || (mediaGroupId ? `alnaba:${uid}:group:${mediaGroupId}` : `alnaba:${uid}:message:${messageId}`);
    const itemKey = existingRef?.itemKey || `${uid}:${messageId}:${candidate.file_unique_id || candidate.file_id}`;
    let record = batchRecord(batchId);
    const priorItem = record?.items.find((item) => item.key === itemKey);
    if (priorItem && !existingRef) return true;
    if (!record) {
      const now = new Date().toISOString();
      record = { id: batchId, owner_id: uid, ...(mediaGroupId ? { media_group_id: String(mediaGroupId) } : {}), status: 'collecting', created_at: now, updated_at: now, expires_at: new Date(Date.now() + ALNABA_BATCH_TTL_MS).toISOString(), items: [] };
      store.state.alnabaBatches ||= [];
      store.state.alnabaBatches.push(record);
    }
    if (!priorItem && mediaGroupId && record.items.length >= 10) {
      await ctx.reply(langOf(ctx) === 'en' ? 'This album exceeds Telegram’s 10-file limit. This extra file was not queued or published.' : 'تجاوز هذا الألبوم حدّ تيليغرام البالغ 10 ملفات. لم يُضف هذا الملف الزائد ولم يُنشر.', { reply_markup: alnabaHomeKeyboard(ctx) });
      return true;
    }
    let savedItem = priorItem;
    if (existingRef && savedItem) {
      savedItem.section = section;
      savedItem.candidate = { ...candidate };
      savedItem.status = 'pending';
      delete savedItem.choices;
      delete savedItem.error;
      savedItem.updated_at = new Date().toISOString();
      record.status = 'queued';
      record.updated_at = savedItem.updated_at;
    } else if (!savedItem) {
      const now = new Date().toISOString();
      savedItem = { key: itemKey, message_id: messageId, ...(mediaGroupId ? { media_group_id: String(mediaGroupId) } : {}), section, status: 'pending', candidate: { ...candidate }, attempts: 0, created_at: now, updated_at: now };
      record.items.push(savedItem);
      record.status = 'collecting';
      record.updated_at = now;
    }
    try {
      await scheduleBatchCheckpoint();
    } catch (error) {
      setBatchEntry(batchId, itemKey, { status: 'failed', error: String(error?.message || 'BACKUP_FAILED').slice(0, 80) });
      store.persist({ backupSoon: false });
      store._writeLocal();
      await ctx.reply(alnabaQueueCheckpointError(error, langOf(ctx) === 'en'), { reply_markup: alnabaHomeKeyboard(ctx) }).catch(() => {});
      return true;
    }
    record = batchRecord(batchId);
    savedItem = record?.items.find((item) => item.key === itemKey);
    if (!savedItem) return true;
    attachRuntimeBatchItem(ctx, record, savedItem);
    return true;
  };
  const askAlnabaBatchSection = async (ctx, message, type) => {
    if (alnabaBatchIntakePaused) {
      await ctx.reply(langOf(ctx) === 'en'
        ? 'Al-Nabaa uploads are temporarily paused while the previous backup is being restored. Please forward this file again shortly.'
        : 'رفع النبأ متوقف مؤقتاً أثناء استعادة النسخة السابقة. أعد توجيه هذا الملف بعد قليل.');
      return true;
    }
    const ownerId = Number(ctx.from?.id);
    const messageId = Number(message.message_id);
    const mediaGroupId = message.media_group_id || null;
    const batchId = mediaGroupId ? `alnaba:${ownerId}:group:${mediaGroupId}` : `alnaba:${ownerId}:message:${messageId}`;
    const key = `${ownerId}:${messageId}:ambiguous:${type}`;
    store.state.alnabaBatches ||= [];
    let record = batchRecord(batchId);
    if (!record) {
      const now = new Date().toISOString();
      record = { id: batchId, owner_id: ownerId, ...(mediaGroupId ? { media_group_id: String(mediaGroupId) } : {}), status: 'collecting', created_at: now, updated_at: now, expires_at: new Date(Date.now() + ALNABA_BATCH_TTL_MS).toISOString(), items: [] };
      store.state.alnabaBatches.push(record);
    }
    if (!record.items.some((item) => item.key === key)) {
      if (mediaGroupId && record.items.length >= 10) {
        await ctx.reply(langOf(ctx) === 'en' ? 'This album exceeds Telegram’s 10-file limit. This extra file was not queued.' : 'تجاوز هذا الألبوم حدّ تيليغرام البالغ 10 ملفات. لم يُضف هذا الملف الزائد.', { reply_markup: alnabaHomeKeyboard(ctx) });
        return true;
      }
      const choices = { quran: alnabaUploadCandidate(message, type, 'quran', { forwarded: true }), nasheed: alnabaUploadCandidate(message, type, 'nasheed', { forwarded: true }) };
      if (!choices.quran || !choices.nasheed) return false;
      const now = new Date().toISOString();
      record.items.push({ key, message_id: messageId, ...(mediaGroupId ? { media_group_id: String(mediaGroupId) } : {}), section: null, status: 'awaiting_section', choices, attempts: 0, created_at: now, updated_at: now });
      record.updated_at = now;
      try {
        await scheduleBatchCheckpoint();
      } catch (error) {
        setBatchEntry(batchId, key, { status: 'failed', error: String(error?.message || 'BACKUP_FAILED').slice(0, 80) });
        store.persist({ backupSoon: false });
        store._writeLocal();
        await ctx.reply(alnabaQueueCheckpointError(error, langOf(ctx) === 'en'), { reply_markup: alnabaHomeKeyboard(ctx) }).catch(() => {});
        return true;
      }
    }
    const savedItem = batchRecord(batchId)?.items.find((item) => item.key === key);
    if (savedItem) await issueBatchSectionPrompt(ctx, batchRecord(batchId), savedItem);
    return true;
  };
  bot.callbackQuery(/^nb:batch-section:([0-9a-f]{12}):(quran|nasheed)$/, async (ctx) => {
    if (!alnabaOwner(ctx) || ctx.chat?.type !== 'private') return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Not authorized.' : 'ليست لديك صلاحية للنشر.');
    const [, token, section] = ctx.match;
    const pending = alnabaBatchSectionChoices.get(token);
    const savedItem = pending && batchEntry(pending.batchId, pending.itemKey);
    if (!pending || pending.ownerId !== Number(ctx.from.id) || Date.now() - pending.createdAt > 30 * 60_000 || savedItem?.status !== 'awaiting_section') {
      alnabaBatchSectionChoices.delete(token);
      await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'This file choice expired.' : 'انتهت صلاحية اختيار هذا الملف.');
      return ctx.deleteMessage().catch(() => {});
    }
    const candidate = savedItem.choices?.[section];
    if (!candidate) return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Unsupported media file.' : 'ملف الوسائط غير مدعوم.');
    alnabaBatchSectionChoices.delete(token);
    const savedCtx = batchContext(pending.ownerId, savedItem.message_id, savedItem.media_group_id);
    await queueAlnabaBatchUpload(savedCtx, section, candidate, savedItem.message_id, { batchId: pending.batchId, itemKey: pending.itemKey });
    await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Queued for website publishing.' : 'أُضيف إلى قائمة النشر على الموقع.');
    return ctx.deleteMessage().catch(() => {});
  });
  bot.callbackQuery(/^nb:batch-cancel:([0-9a-f]{12})$/, async (ctx) => {
    if (!alnabaOwner(ctx) || ctx.chat?.type !== 'private') return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Not authorized.' : 'ليست لديك صلاحية للنشر.');
    const pending = alnabaBatchSectionChoices.get(ctx.match[1]);
    let cancellationSaved = true;
    if (pending?.ownerId === Number(ctx.from.id)) {
      alnabaBatchSectionChoices.delete(ctx.match[1]);
      const record = batchRecord(pending.batchId);
      const itemIndex = record?.items.findIndex((item) => item.key === pending.itemKey) ?? -1;
      const oldItem = itemIndex >= 0 ? structuredClone(record.items[itemIndex]) : null;
      const oldRecordStatus = record?.status;
      const oldRecordUpdatedAt = record?.updated_at;
      setBatchEntry(pending.batchId, pending.itemKey, { status: 'cancelled' });
      try {
        await persistAlnabaBatchState();
      } catch (error) {
        console.error('[alnaba] could not persist batch cancellation', error?.message);
        const current = batchRecord(pending.batchId);
        const currentIndex = current?.items.findIndex((item) => item.key === pending.itemKey) ?? -1;
        if (current && currentIndex >= 0 && oldItem) current.items[currentIndex] = oldItem;
        if (current) { current.status = oldRecordStatus; current.updated_at = oldRecordUpdatedAt; }
        store.persist({ backupSoon: false });
        store._writeLocal();
        cancellationSaved = false;
        if (current && currentIndex >= 0 && oldItem) {
          await issueBatchSectionPrompt(batchContext(pending.ownerId, oldItem.message_id, oldItem.media_group_id), current, current.items[currentIndex])
            .catch((promptError) => console.error('[alnaba] could not reissue private section choice', promptError?.message));
        }
      }
    }
    if (!cancellationSaved) {
      await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'The cancel could not be saved; the file remains private and still needs a section choice.' : 'تعذّر حفظ الإلغاء؛ سيبقى الملف خاصاً وما زال يحتاج إلى اختيار القسم.');
      return ctx.deleteMessage().catch(() => {});
    }
    await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'This file stays private.' : 'سيبقى هذا الملف خاصاً.');
    return ctx.deleteMessage().catch(() => {});
  });
  if (role === 'admin') {
    runtimeHooks.flushAlnabaBatches = async () => {
      if (batchCheckpointPromise) await batchCheckpointPromise.catch(() => {});
      const ownerIds = new Set([...alnabaUploadBatches.keys(), ...alnabaBatchQueues.keys()]);
      await Promise.all([...ownerIds].map(async (uid) => {
        await finishAlnabaBatch(uid);
        const pending = alnabaBatchQueues.get(uid);
        if (pending) await pending;
      }));
      try { await persistAlnabaBatchState(); } catch (error) { console.error('[alnaba] final batch checkpoint failed', error?.message); }
    };
    runtimeHooks.resetAlnabaBatchRuntime = () => {
      for (const batch of alnabaUploadBatches.values()) clearTimeout(batch.timer);
      alnabaUploadBatches.clear();
      alnabaBatchQueues.clear();
      alnabaBatchSectionChoices.clear();
      clearTimeout(batchCheckpointTimer);
    };
    runtimeHooks.resumeAlnabaBatches = async () => {
      const now = Date.now();
      const owners = new Set();
      let changed = false;
      for (const record of [...(store.state.alnabaBatches || [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
        if (!isAlnabaOwner(record.owner_id)) continue;
        if (Date.parse(record.expires_at) <= now) {
          for (const item of record.items) {
            if (!['published', 'failed', 'cancelled', 'expired'].includes(item.status)) {
              setBatchEntry(record.id, item.key, { status: 'expired', error: 'BATCH_EXPIRED' });
              changed = true;
              const ctx = batchContext(record.owner_id, item.message_id, item.media_group_id);
              await ctx.reply(langOf(ctx) === 'en'
                ? `⌛ ${item.message_id}: <b>${esc(item.candidate?.file_name || 'file')}</b> expired before publishing and was not published. Please resend it.`
                : `⌛ الرسالة ${item.message_id}: انتهت مهلة الملف <b>${esc(item.candidate?.file_name || 'ملف')}</b> قبل النشر ولم يُنشر. أعد إرساله.`, { parse_mode: 'HTML' }).catch(() => {});
            }
          }
          record.status = 'expired';
          continue;
        }
        for (const item of record.items) {
          const ctx = batchContext(record.owner_id, item.message_id, item.media_group_id);
          if (item.status === 'awaiting_section') {
            await issueBatchSectionPrompt(ctx, record, item).catch((error) => console.error('[alnaba] recovery prompt failed', error?.message));
          } else if (['pending', 'processing'].includes(item.status)) {
            attachRuntimeBatchItem(ctx, record, item);
            owners.add(Number(record.owner_id));
          }
        }
      }
      if (changed) {
        try { await persistAlnabaBatchState(); } catch (error) { console.error('[alnaba] could not persist expired batch state', error?.message); }
      }
      for (const uid of owners) {
        const remaining = (store.state.alnabaBatches || []).filter((record) => Number(record.owner_id) === uid)
          .flatMap((record) => record.items.filter((item) => ['pending', 'processing'].includes(item.status)));
        if (!remaining.length) continue;
        const ctx = batchContext(uid, remaining[0].message_id, remaining[0].media_group_id);
        await ctx.reply(langOf(ctx) === 'en'
          ? `↻ Recovered ${remaining.length} queued file(s) after restart. Processing them in message order; already-published files will not be duplicated.`
          : `↻ استُعيدت ${remaining.length} ملفات من قائمة الانتظار بعد إعادة التشغيل. ستُعالج حسب ترتيب الرسائل، مع منع تكرار ما نُشر سابقاً.`).catch(() => {});
        await finishAlnabaBatch(uid);
        const task = alnabaBatchQueues.get(uid);
        if (task) await task;
      }
      alnabaBatchIntakePaused = false;
    };
  }
  const forwardMetadataPrompt = (section, candidate, en) => {
    if (section === 'weekly') return en
      ? 'The issue number is optional: a number in the caption or filename is preserved; otherwise the next number is assigned. The title is optional and defaults to the issue number.'
      : 'رقم العدد اختياري: يُحفظ الرقم الموجود في الوصف أو اسم الملف، وإلا يُخصّص الرقم التالي. العنوان اختياري ويُشتق من رقم العدد.';
    if (section === 'photos') return en
      ? 'Send the photo-news headline as text. The image will publish on the Al-Nabaa website only after its title is complete, then expire after 24 hours.'
      : 'أرسل عنوان الخبر المصوّر برسالة نصية. تُنشر الصورة على موقع النبأ فقط بعد اكتمال عنوانها، ثم تُزال بعد 24 ساعة.';
    return en
      ? 'Send the title on the first line and an optional description on the next lines. The media will then publish directly in its selected Al-Nabaa section only.'
      : 'أرسل العنوان في السطر الأول والوصف الاختياري في الأسطر التالية، ثم تُنشر الوسائط مباشرةً في قسم النبأ المختار فقط.';
  };
  const forwardInputKeyboard = (ctx) => withAlnabaHomeButton(
    new InlineKeyboard().text(langOf(ctx) === 'en' ? 'Cancel' : 'إلغاء', 'nb:cancel'), ctx,
  );
  const beginForwardedAlnabaUpload = async (ctx, message, type, section) => {
    const uid = Number(ctx.from?.id);
    const candidate = alnabaUploadCandidate(message, type, section, { forwarded: true });
    if (!candidate) {
      await ctx.reply(langOf(ctx) === 'en' ? 'This forwarded message has no supported media file.' : 'لا يحتوي هذا التوجيه على ملف وسائط مدعوم.', { reply_markup: alnabaHomeKeyboard(ctx) });
      return true;
    }
    if (section !== 'weekly' && !candidate.title) {
      const pending = { message, type, section, candidate, awaiting: 'metadata', createdAt: Date.now() };
      alnabaPendingForwardInputs.set(uid, pending);
      await ctx.reply(forwardMetadataPrompt(section, candidate, langOf(ctx) === 'en'), { reply_markup: forwardInputKeyboard(ctx) });
      return true;
    }
    if (['quran', 'nasheed'].includes(section) && !candidate.title) {
      const count = store.state.alnaba?.[section]?.length || 0;
      candidate.title = section === 'nasheed' ? `نشيد ${count + 1}` : `تلاوة قرآنية ${count + 1}`;
    }
    alnabaSessions.set(uid, { section, createdAt: Date.now() });
    return receiveAlnabaUpload(ctx, candidate);
  };
  bot.callbackQuery(/^nb:forward:section:(quran|nasheed)$/, async (ctx) => {
    if (!alnabaOwner(ctx) || ctx.chat?.type !== 'private') return ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'Not authorized.' : 'ليست لديك صلاحية النشر.');
    const uid = Number(ctx.from.id);
    const pending = alnabaPendingForwardInputs.get(uid);
    if (!pending || pending.awaiting !== 'section' || Date.now() - pending.createdAt > 30 * 60_000) {
      alnabaPendingForwardInputs.delete(uid);
      await ctx.answerCallbackQuery(langOf(ctx) === 'en' ? 'This forwarded item expired. Forward it again.' : 'انتهت صلاحية هذا العنصر. أعد توجيهه مجدداً.');
      return ctx.deleteMessage().catch(() => {});
    }
    const section = ctx.match[1];
    alnabaPendingForwardInputs.delete(uid);
    await ctx.answerCallbackQuery();
    return beginForwardedAlnabaUpload(ctx, pending.message, pending.type, section);
  });
  const handleAlnabaAttachment = async (ctx, next, type) => {
    const uid = Number(ctx.from?.id);
    if (!alnabaOwner(ctx)) return next();
    const message = ctx.message;
    const flow = alnabaSessions.get(uid);
    const forwarded = isForwardedAlnabaMessage(message) && ctx.chat?.type === 'private';
    const pendingForward = alnabaPendingForwardInputs.get(uid);
    if (pendingForward) {
      const expired = Date.now() - Number(pendingForward.createdAt || 0) > 30 * 60_000;
      if (expired || forwarded) {
        // A new owner-forward supersedes the previous private, unresolved item; never publish the old one.
        alnabaPendingForwardInputs.delete(uid);
      } else {
        return ctx.reply(langOf(ctx) === 'en'
          ? 'The previous forwarded item is still private. Tap Cancel or send /menu, then send the new item.'
          : 'العنصر السابق ما زال خاصاً. اضغط «إلغاء» أو أرسل /menu لمسح حالته، ثم أرسل العنصر الجديد.',
        { reply_markup: forwardInputKeyboard(ctx) });
      }
    }
    if (alnabaPendingUploads.has(uid) || alnabaPendingArchiveEntries.has(uid) || alnabaPendingManagementEdits.has(uid) || alnabaPendingManagementDeletes.has(uid)) {
      return ctx.reply(langOf(ctx) === 'en' ? 'Confirm or cancel the current preview before sending another item.' : 'أكّد المعاينة الحالية أو ألغِها قبل إرسال عنصر آخر.', { reply_markup: alnabaHomeKeyboard(ctx) });
    }
    if (alnabaEditSessions.has(uid)) return ctx.reply(langOf(ctx) === 'en' ? 'This edit is waiting for text; use Cancel or send the requested title/link.' : 'ينتظر هذا التعديل نصاً؛ استخدم «إلغاء» أو أرسل العنوان/الرابط المطلوب.', { reply_markup: alnabaHomeKeyboard(ctx) });
    if (flow?.section === 'archive') return next();
    if (flow?.mode !== 'replace') {
      const attachment = alnabaMediaFromMessage(message, type);
      const isPdf = type === 'document' && (attachment?.inferredMime === 'application/pdf' || /\.pdf$/i.test(attachment?.fileName || ''));
      if (isPdf) {
        const candidate = alnabaUploadCandidate(message, type, 'weekly', { forwarded });
        if (!candidate) return ctx.reply(langOf(ctx) === 'en' ? 'Send one supported PDF file (up to 20 MB).' : 'أرسل ملف PDF مدعوماً (حتى 20 ميغابايت).', { reply_markup: alnabaHomeKeyboard(ctx) });
        return queueAlnabaBatchUpload(ctx, 'weekly', candidate);
      }
      if (flow && ['quran', 'nasheed'].includes(flow.section) && isAudioVideoAlnabaMessage(message, type)) {
        const candidate = alnabaUploadCandidate(message, type, flow.section, { forwarded });
        if (!candidate) return ctx.reply(langOf(ctx) === 'en' ? 'Send one supported audio or video file.' : 'أرسل ملف صوت أو فيديو مدعوماً.', { reply_markup: alnabaHomeKeyboard(ctx) });
        return queueAlnabaBatchUpload(ctx, flow.section, candidate);
      }
    }
    if (!flow && !forwarded) return next();
    if (forwarded && flow?.mode !== 'replace') {
      const section = flow?.section || classifyForwardedAlnabaSection(message, type);
      if (section === 'weekly' || (['quran', 'nasheed'].includes(section) && isAudioVideoAlnabaMessage(message, type))) {
        const candidate = alnabaUploadCandidate(message, type, section, { forwarded: true });
        if (!candidate) return ctx.reply(langOf(ctx) === 'en' ? 'Send one supported media file.' : 'أرسل ملف وسائط مدعوماً.', { reply_markup: alnabaHomeKeyboard(ctx) });
        return queueAlnabaBatchUpload(ctx, section, candidate);
      }
      if (section) return beginForwardedAlnabaUpload(ctx, message, type, section);
      if (isAudioVideoAlnabaMessage(message, type)) {
        if (!alnabaMediaFromMessage(message, type)) return ctx.reply(langOf(ctx) === 'en' ? 'Send one supported audio or video file.' : 'أرسل ملف صوت أو فيديو مدعوماً.', { reply_markup: alnabaHomeKeyboard(ctx) });
        return askAlnabaBatchSection(ctx, message, type);
      }
      return next();
    }
    const candidate = alnabaUploadCandidate(message, type, flow.section);
    if (!candidate) return ctx.reply(langOf(ctx) === 'en' ? 'Send one supported media file.' : 'أرسل ملف وسائط واحداً بصيغة مدعومة.', { reply_markup: alnabaHomeKeyboard(ctx) });
    return receiveAlnabaUpload(ctx, candidate);
  };
  bot.on('message:photo', (ctx, next) => handleAlnabaAttachment(ctx, next, 'photo'));
  bot.on('message:document', (ctx, next) => handleAlnabaAttachment(ctx, next, 'document'));
  bot.on('message:video', (ctx, next) => handleAlnabaAttachment(ctx, next, 'video'));
  bot.on('message:audio', (ctx, next) => handleAlnabaAttachment(ctx, next, 'audio'));
  bot.on('message:voice', (ctx, next) => handleAlnabaAttachment(ctx, next, 'voice'));

  const receiveAlertMedia = async (ctx, type) => {
    const key = sk(ctx);
    const pending = activeMediaSessions.get(key);
    const media = mediaFromTelegramMessage(ctx.message, type, roleOf(ctx));
    if (!media) return ctx.reply(L(ctx).mediaTypeError);
    if (pending) {
      if (role !== 'admin' || !staff(ctx)) { activeMediaSessions.delete(key); return; }
      if (Date.now() - pending.created > 10 * 60_000) {
        activeMediaSessions.delete(key);
        return ctx.reply(L(ctx).expiredSession);
      }
      const alert = store.getAlert(pending.alertId);
      if (!alert?.is_active) {
        activeMediaSessions.delete(key);
        return ctx.reply(L(ctx).notFound);
      }
      activeMediaSessions.delete(key);
      updateAlertChannelMedia(ctx.api, alert, media);
      const current = store.getAlert(alert.id);
      return show(ctx, L(ctx).mediaMapAdded, resultKeyboard(ctx, current).row().text(L(ctx).btnBack, 'active'));
    }
    const d = getDraft(ctx);
    if (!d || d.step !== 'media' || d.mode === 'active_edit') return;
    d.media_items = mergeAlertMediaItems(Array.isArray(d.media_items) && d.media_items.length ? d.media_items : d.media, media, { replaceSameType: true });
    d.media = d.media_items[0];
    return showPreview(ctx, d);
  };
  bot.on('message:photo', (ctx) => receiveAlertMedia(ctx, 'photo'));
  bot.on('message:video', (ctx) => receiveAlertMedia(ctx, 'video'));

  bot.on('message:text', async (ctx) => {
    const text = cleanInputText(ctx.message.text);
    if (text.startsWith('/')) return;
    const uid = Number(ctx.from?.id);
    const forwardedInput = alnabaPendingForwardInputs.get(uid);
    if (alnabaOwner(ctx) && forwardedInput) {
      const en = langOf(ctx) === 'en';
      if (Date.now() - forwardedInput.createdAt > 30 * 60_000) {
        alnabaPendingForwardInputs.delete(uid);
        return ctx.reply(en ? 'The forwarded item expired. Forward it again.' : 'انتهت صلاحية العنصر المعاد توجيهه. أعد توجيهه مجدداً.', { reply_markup: alnabaHomeKeyboard(ctx) });
      }
      if (forwardedInput.awaiting === 'section') return ctx.reply(en ? 'Choose Quran or nasheeds using the buttons above, or cancel this item.' : 'اختر القرآن الكريم أو الأناشيد من الزرين أعلاه، أو ألغِ هذا العنصر.', { reply_markup: forwardInputKeyboard(ctx) });
      const candidate = { ...forwardedInput.candidate };
      if (forwardedInput.section === 'weekly') {
        const metadata = captionMetadata('weekly', text, candidate.file_name, '');
        if (!candidate.issue_number) candidate.issue_number = metadata.issue_number;
        const firstLine = text.trim().split(/\r?\n/)[0] || '';
        const invalidNumberLine = /^[0-9٠-٩۰-۹]+$/.test(firstLine) && !metadata.issue_number;
        if (!candidate.title && metadata.title && !invalidNumberLine) candidate.title = metadata.title;
        if (!candidate.description) candidate.description = metadata.description;
      } else if (forwardedInput.section === 'photos') {
        candidate.title = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
      } else {
        const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        candidate.title = lines.shift() || candidate.title;
        if (lines.length) candidate.description = lines.join('\n');
      }
      if (!candidate.title || (forwardedInput.section === 'weekly' && !candidate.issue_number)) {
        forwardedInput.candidate = candidate;
        alnabaPendingForwardInputs.set(uid, forwardedInput);
        return ctx.reply(forwardMetadataPrompt(forwardedInput.section, candidate, en), { reply_markup: forwardInputKeyboard(ctx) });
      }
      alnabaPendingForwardInputs.delete(uid);
      alnabaSessions.set(uid, { section: forwardedInput.section, createdAt: Date.now() });
      return receiveAlnabaUpload(ctx, candidate);
    }
    if (alnabaOwner(ctx) && (alnabaPendingUploads.has(uid) || alnabaPendingArchiveEntries.has(uid) || alnabaPendingManagementEdits.has(uid) || alnabaPendingManagementDeletes.has(uid))) return ctx.reply(langOf(ctx) === 'en' ? 'Use the Save/Confirm or Cancel buttons on the pending preview.' : 'استخدم زر «حفظ/تأكيد» أو «إلغاء» في المعاينة المعلّقة.', { reply_markup: alnabaHomeKeyboard(ctx) });
    const managementFlow = alnabaEditSessions.get(uid);
    if (alnabaOwner(ctx) && managementFlow) {
      const en = langOf(ctx) === 'en';
      if (Date.now() - managementFlow.createdAt > 30 * 60_000) {
        alnabaEditSessions.delete(uid);
        return ctx.reply(en ? 'The edit session expired. Open the management list again.' : 'انتهت جلسة التعديل. افتح قائمة الإدارة مجدداً.', { reply_markup: alnabaHomeKeyboard(ctx) });
      }
      const item = findAlnabaEntry(store, managementFlow.section, managementFlow.id);
      if (!item) {
        alnabaEditSessions.delete(uid);
        return ctx.reply(en ? 'This item no longer exists. Open the management list again.' : 'لم يعد هذا المنشور موجوداً. افتح قائمة الإدارة مجدداً.', { reply_markup: alnabaHomeKeyboard(ctx) });
      }
      let changes;
      try {
        if (managementFlow.field === 'title') {
          const title = text.replace(/\s+/g, ' ').trim();
          if (!title) throw new Error('MISSING_TITLE');
          if (title.length > 180) throw new Error('TITLE_TOO_LONG');
          changes = { title };
        } else {
          changes = { url: prepareAlnabaArchiveEntry({ title: item.title, url: text }).url };
        }
      } catch (error) {
        const message = error.message === 'TITLE_TOO_LONG'
          ? (en ? 'Keep the title within 180 characters.' : 'اجعل العنوان أقل من 180 حرفاً.')
          : error.message === 'MISSING_TITLE'
            ? (en ? 'The title cannot be empty.' : 'لا يمكن أن يكون العنوان فارغاً.')
            : (en ? 'Use a valid HTTPS Telegram channel/group or invite link.' : 'أرسل رابط Telegram صالحاً وآمناً يبدأ بـ HTTPS لقناة أو مجموعة أو دعوة.');
        return ctx.reply(message);
      }
      const token = randomUUID();
      alnabaPendingManagementEdits.set(uid, { section: managementFlow.section, id: managementFlow.id, page: managementFlow.page, changes, token, createdAt: Date.now() });
      alnabaEditSessions.delete(uid);
      const changeSummary = changes.url
        ? `<a href="${esc(changes.url)}">${esc(changes.url)}</a>`
        : `<b>${esc(item.title)}</b> → <b>${esc(changes.title)}</b>`;
      const preview = en
        ? `Review this change for <b>${esc(item.title)}</b>:\n${changeSummary}\n\nNothing changes until you save it.`
        : `راجع التعديل على <b>${esc(item.title)}</b>:\n${changeSummary}\n\nلن يتغير المنشور حتى تضغط «حفظ التعديل».`;
      const keyboard = new InlineKeyboard()
        .text(en ? '✅ Save change' : '✅ حفظ التعديل', `nb:edit-save:${token}`)
        .text(en ? 'Cancel' : 'إلغاء', 'nb:cancel');
      return ctx.reply(preview, { parse_mode: 'HTML', reply_markup: withAlnabaHomeButton(keyboard, ctx), link_preview_options: { is_disabled: true } });
    }
    const alnabaFlow = alnabaSessions.get(uid);
    if (alnabaOwner(ctx) && alnabaFlow?.section === 'archive') {
      const en = langOf(ctx) === 'en';
      if (Date.now() - alnabaFlow.createdAt > 30 * 60_000) {
        alnabaSessions.delete(uid);
        return ctx.reply(en ? 'The archive session expired. Start again with /alnaba.' : 'انتهت جلسة الأرشيف. ابدأ مجدداً عبر /alnaba.', { reply_markup: alnabaHomeKeyboard(ctx) });
      }
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length !== 2) return ctx.reply(en
        ? 'Send exactly two lines: the channel/group title, then its full HTTPS Telegram link.'
        : 'أرسل سطرين فقط: اسم/عنوان القناة أو المجموعة أولاً، ثم رابط Telegram الكامل في السطر الثاني.', { reply_markup: alnabaHomeKeyboard(ctx) });
      try {
        const prepared = prepareAlnabaArchiveEntry({ title: lines[0], url: lines[1] });
        alnabaPendingArchiveEntries.set(uid, { ...prepared, createdAt: Date.now() });
        alnabaSessions.delete(uid);
        const preview = en
          ? `Review this archive entry before publishing:\n<b>${esc(prepared.title)}</b>\n<a href="${esc(prepared.url)}">${esc(prepared.url)}</a>\n\nIt stays private until you confirm.`
          : `راجع مدخل الأرشيف قبل نشره:\n<b>${esc(prepared.title)}</b>\n<a href="${esc(prepared.url)}">${esc(prepared.url)}</a>\n\nلن يظهر للزوار حتى تؤكد النشر.`;
        const keyboard = new InlineKeyboard()
          .text(en ? '✅ Publish now' : '✅ نشر الآن', 'nb:publish')
          .text(en ? 'Cancel' : 'إلغاء', 'nb:cancel');
        return ctx.reply(preview, { parse_mode: 'HTML', reply_markup: withAlnabaHomeButton(keyboard, ctx), link_preview_options: { is_disabled: true } });
      } catch (error) {
        const message = error.message === 'MISSING_TITLE'
          ? (en ? 'Please include the channel/group title on the first line.' : 'أضف اسم/عنوان القناة أو المجموعة في السطر الأول.')
          : error.message === 'TITLE_TOO_LONG'
            ? (en ? 'Keep the title within 180 characters.' : 'اجعل العنوان أقل من 180 حرفاً.')
            : (en ? 'Use a valid HTTPS Telegram link (t.me or telegram.me) for a channel, group, or invite.' : 'أرسل رابط Telegram صالحاً وآمناً يبدأ بـ https://t.me أو https://telegram.me لقناة أو مجموعة أو دعوة.');
        return ctx.reply(message, { reply_markup: alnabaHomeKeyboard(ctx) });
      }
    }
    if (alnabaOwner(ctx) && alnabaFlow) return ctx.reply(langOf(ctx) === 'en' ? 'Send the selected image/PDF as a media file; add the photo headline as its caption.' : 'أرسل الصورة أو ملف PDF الذي اخترته؛ وضع عنوان الصورة في وصفها.', { reply_markup: alnabaHomeKeyboard(ctx) });
    const d = getDraft(ctx);
    if (!d) return home(ctx);
    const l = L(ctx);
    if (d.mode === 'active_edit' && ['edit_title', 'edit_details'].includes(d.step)) {
      if (d.step === 'edit_title') { if (!text || text.length > 120) return ctx.reply(langOf(ctx) === 'en' ? 'Please send a headline up to 120 characters.' : 'أرسل عنواناً لا يتجاوز 120 حرفاً.'); d.editTitle = text; }
      else { d.details = text === '-' ? '' : text; }
      d.step = 'edit_menu'; return showActiveEditForm(ctx, d);
    }
    if (d.step === 'vehicle_count_input') {
      const count = parseVehicleCount(text);
      if (!count) {
        const en = langOf(ctx) === 'en';
        return show(ctx, en ? 'Please send a whole number from 1 to 999.' : 'أدخل عدداً صحيحاً من 1 إلى 999.', vehicleCountInputKeyboard(ctx));
      }
      d.vehicleCount = count;
      return askLocation(ctx, d);
    }
    if (d.step === 'text') {
      d.text = text;
      if (d.location) return showPreview(ctx, d);
      return askLocation(ctx, d);
    }
    if (d.step === 'details') {
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
    await api.pinChatMessage(chat, m.message_id, { disable_notification: true });
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
      if (!res.ok) throw new Error(`backup download failed (${res.status})`);
      const payload = await res.text();
      if (!payload.trim()) throw new Error('backup payload is empty');
      return payload;
    },
  };
}
export const BOT_COMMANDS = {
  ar: [
    { command: 'start', description: 'القائمة الرئيسية' },
    { command: 'active', description: 'التنبيهات النشطة' },
    { command: 'alnaba', description: 'نشر أخبار مصورة وصحيفة أسبوعية' },
    { command: 'lang', description: 'English / العربية' },
    { command: 'id', description: 'معرّفي' },
    { command: 'help', description: 'المساعدة' },
  ],
  en: [
    { command: 'start', description: 'Main menu' },
    { command: 'active', description: 'Active alerts' },
    { command: 'alnaba', description: 'Publish photo news and weekly PDF' },
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

export async function fetchAlnabaMediaForWeb(item) {
  if (!APIS.admin || !TOKENS.admin) throw new Error('BOT_UNAVAILABLE');
  return fetchAlnabaTelegramBytes(item, { api: APIS.admin, token: TOKENS.admin });
}
