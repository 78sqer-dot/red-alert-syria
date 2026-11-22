// 📡 News monitor: the server (Render, 24/7) reads public Syrian news channels every minute, turns
// each NEW incident into a ready-made alert draft and sends it to the primary owner in the private
// publishing bot with ✅ Publish / ❌ Ignore; only qualified AI news has an automatic fallback.
// No duplicates: an incident reported by several channels arrives once (the card lists the sources);
// an incident that is already on the map / channel (also from human reports), already waiting as a
// draft or report, or already ignored never comes back, and follow-ups ("ارتفاع الحصيلة", "القبض على
// المنفذين", "مجدداً"...) of a known incident don't create new drafts.
import crypto from 'node:crypto';
import { unlinkCapturedMedia } from './news-media.js';
import { InlineKeyboard } from 'grammy';
import { automaticMonitorRecipientIds, config, isOwner } from './config.js';
import { store } from './store.js';
import { ALERT_TYPES, ALERT_GROUPS, POLITICAL_CATEGORIES, TYPE_MENU, TYPE_MENU_GROUPS, TYPE_MENU_DIRECT, typeMenuGroupOf, typeOf, droneAuto, alertEmoji, alertButtonLabel, stripTypeLabelPrefix } from '../shared/types.js';
import { CONDEMNATIONS, CONDEMNATION_KEYS, condemnationKey, condemnationText } from '../shared/condemnations.js';
import { locationFrom, normalizeArabic, localityQualifierOnly, governorates, districts, subdistricts, places, getGov, getPlace } from './places.js';
import { DEFAULT_SOURCES, fetchChannel, cleanPostText,
 parseUsername } from './news-sources.js';
import { onRoadNewsPost, roadMonitorDebug, roadMonitorActivationTime, parseRoadText } from './road-monitor.js';
import { onNewsPost as onPowerPost, takeMisroutedWeatherPower } from './services.js';
import { onBorderNews } from './borders.js';
import { FUEL_NEWS_RE } from './fuel.js';
import { fuelRecheckSoon } from './prices.js';
const FUEL_HOOK = { at: 0 };
const normalizeFuelText = (t) => String(t || '').replace(/[ًٌٍَُِّْـ]/g, '').replace(/\s+/g, ' ');
import { NEWS_TYPES, prefilter, buildPrompt, callGemini, rewriteArabicNews, rewriteSourceReviewReason, privateEditorialOutputReviewReason, finalizeRewriteOutput, resolvePlace, nameInText, ruleClassify, scanTextPlaces, aiStats, govCodeOf, mentionsSyria, refineType, hospitalDestinationOnly, weatherWarningInfo, hasNonWeatherSignal, inferPoliticalCategory, hasExplicitDroneFlight, extractFlightDirection, truncateAtWordBoundary, truncatedPrefixCut, altPinFromPersonName, sharpToneReason, isAltOnlyMatch, hasPlaceIntroducer } from './news-ai.js';
import { setKeep } from './ui-clean.js';
import { setSourceNames, cleanAlertText, cleanAttributedNewsText, cleanPublicNewsAttribution, isPrivateEditorialCopy, isPublicEditorialCopy } from './clean-text.js';

// All type pickers in this module — the draft edit menu (EDIT_TYPE_*) and the
// monitoring filter panel (NEWS_TYPE_GROUPS) — are generated from the ONE
// canonical TYPE_MENU in shared/types.js, the same definition the reporting
// bot's keyboards use, so the menus can never disagree again.
// NEWS_TYPE_GROUPS keeps only the monitorable types (NEWS_TYPES) per group;
// it controls automatic news monitoring only.
const NEWS_TYPE_GROUPS = Object.freeze(Object.fromEntries(
  TYPE_MENU.map((g) => [g.key, Object.freeze(g.types.filter((type) => NEWS_TYPES.includes(type)))]),
));
// The owner can reclassify a human-reviewed draft to any alert type.
const EDIT_TYPE_GROUPS = Object.freeze({
  // air_movement stays monitorable/auto-published but is not a hand-picked type
  // in any bot (owner 2026-11-20), mirroring BOT_ALERT_MENU_GROUPS.
  ...Object.fromEntries(TYPE_MENU_GROUPS.map((g) => [g.key, g.types.filter((type) => type !== 'air_movement')])),
  // Pseudo-group: picking an incursion KIND, not a type — the security group's
  // military_incursion button routes here (see typeGroupKb).
  incursion: Object.freeze(['military_incursion']),
});
const EDIT_TYPE_DIRECT_TYPES = TYPE_MENU_DIRECT;
const EDIT_TYPE_MENU = Object.freeze([
  ...TYPE_MENU_DIRECT.map((type) => Object.freeze({ type })),
  ...TYPE_MENU_GROUPS.map((g) => Object.freeze({ group: g.key })),
]);
const INCURSION_TYPE_CHOICES = Object.freeze([
  Object.freeze({ kind: 'general', ar: 'توغل عسكري', en: 'Military incursion' }),
  Object.freeze({ kind: 'soldiers', ar: 'توغل جنود', en: 'Military soldier incursion' }),
  Object.freeze({ kind: 'vehicles', ar: 'توغل آليات عسكرية', en: 'Military vehicle incursion' }),
  Object.freeze({ kind: 'barrier', ar: 'حاجز', en: 'Military checkpoint' }),
]);
const newsTypeGroupKeys = () => TYPE_MENU.map((g) => g.key).filter((key) => Object.hasOwn(NEWS_TYPE_GROUPS, key));
const TYPE_MENU_BY_KEY = new Map(TYPE_MENU.map((g) => [g.key, g]));
function newsGroupLabel(group, lang = 'ar') {
  if (group === 'incursion') return lang === 'en' ? '🪖 Military incursion' : '🪖 توغل عسكري';
  const g = TYPE_MENU_BY_KEY.get(group);
  if (!g) return group;
  return `${g.emoji} ${lang === 'en' ? g.en : g.ar}`;
}
function editableDraftTypeLabel(d, lang = 'ar') {
  if (d?.type === 'military_incursion') {
    const choice = INCURSION_TYPE_CHOICES.find(({ kind }) => kind === (d.incursionKind || 'general'));
    if (choice) return choice[lang];
  }
  const type = ALERT_TYPES[d?.type];
  if (d?.type === 'political') {
    const category = POLITICAL_CATEGORIES[d.politicalCategory];
    if (category) return lang === 'en' ? `Political development — ${category.en}` : `تطور سياسي — ${category.ar}`;
  }
  return type ? (lang === 'en' ? type.en : type.ar) : String(d?.type || '');
}

const ROAD_INCIDENT_WORDS = ['قصف', 'غارة', 'هجوم', 'اعتداء', 'اشتباك', 'انفجار', 'تفجير', 'استهداف', 'اطلاق نار', 'اغتيال', 'مقتل', 'قتلى', 'جرحى', 'اصابه', 'كمين', 'توغل', 'مداهمه', 'حادث', 'تصادم', 'انقلاب', 'حريق', 'احتجاج', 'مظاهره', 'قذائف', 'هاون'].map(normalizeArabic);
/** True for a road-state update that belongs in the road monitor, not a general breaking alert. */
export function isRoadStatusOnlyPost(text) {
  if (!parseRoadText(text) || weatherWarningInfo(text)) return false;
  const nt = normalizeArabic(String(text || ''));
  return !ROAD_INCIDENT_WORDS.some((word) => nt.includes(word));
}

const env = (k, d) => (process.env[k] != null && process.env[k] !== '' ? Number(process.env[k]) : d);
// bump when the pre-filter / AI rules change: on the next start the posts inside the freshness
// window (NEWS_CFG.maxAgeMin) that the old filter skipped are looked at again (once), so nothing
// recent is lost by a rule fix — and nothing older than the window can resurface through the rescan
export const FILTER_VER = 11;
export const NEWS_CFG = {
  pollSec: env('NEWS_POLL_SEC', 60),
  maxAgeMin: env('NEWS_MAX_AGE_MIN', 45), // older posts are history, not alerts
  startDelaySec: env('NEWS_START_DELAY_SEC', 100), // let the previous instance stop first (deploy hand-off)
  maxPerHour: env('NEWS_MAX_PER_HOUR', 20), // flood guard
  expireMin: env('NEWS_DRAFT_EXPIRE_MIN', 180), // an unanswered draft leaves the chat after 3 h
  aiDailyCap: env('NEWS_AI_DAILY_CAP', 1400),
  aiMinGapMs: env('NEWS_AI_MIN_GAP_MS', 12_000),
  models: () => (process.env.NEWS_AI_MODELS || 'gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-flash-latest').split(',').map((s) => s.trim()).filter(Boolean),
  aiKey: () => process.env.GEMINI_API_KEY || '',
  maxSources: 40, // raised from 25 with the 2026-11-17 expansion batch (32 defaults + owner headroom)
};
/** The one freshness rule for source posts, enforced at every gate (poll, rescan, queue,
 * desk, auto-publish eligibility): a post only counts as news while its SOURCE timestamp is
 * inside the window. Older posts are history — a restart, a rolled-back checkpoint or a
 * restored backup can never make them new again. Missing/invalid timestamps are never fresh. */
export function isFreshSourceTs(ts, now = Date.now()) {
  return Number.isFinite(ts) && ts > 0 && now - ts <= NEWS_CFG.maxAgeMin * 60_000;
}
/** Newest source timestamp behind a draft: its first post or any corroborating source.
 * Drafts that carry no source timestamp at all fall back to their creation time. */
export function draftSourceTs(d) {
  let newest = 0;
  const consider = (t) => { if (Number.isFinite(t) && t > newest) newest = t; };
  consider(d?.ts);
  if (Array.isArray(d?.srcs)) for (const s of d.srcs) consider(s?.ts);
  return newest || (Number.isFinite(d?.created) ? d.created : 0);
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => crypto.randomBytes(5).toString('hex');
const N = normalizeArabic;
const H_MS = 3600_000;
const DAY_AUTO_DELAY_MS = 2 * 60_000;
const WEATHER_NAME_AR = { rain: 'أمطار غزيرة', snow: 'ثلوج', wind: 'رياح قوية', storm: 'عواصف رعدية', heat: 'موجة حر', frost: 'صقيع', dust: 'غبار' };
const weatherHeadline = (hazard, govs) => `تحذير جوي: ${WEATHER_NAME_AR[hazard] || 'أحوال جوية خطرة'} — ${govs.map((g) => g.ar).join('، ')}`;
const dayKey = (t = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date(t));
const clock = (t) => new Intl.DateTimeFormat('ar-SY', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(t));
const nowDamascus = () => new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date());

// ---------------------------------------------------------------- persisted state (store.state.news)
export function newsState() {
  const st = store.state;
  if (!st.news || typeof st.news !== 'object') st.news = {};
  const n = st.news;
  if (typeof n.on !== 'boolean') n.on = true;
  if (!Array.isArray(n.sources)) n.sources = DEFAULT_SOURCES.map((s) => ({ ...s, on: true }));
  if (!n.types || typeof n.types !== 'object') n.types = {};
  for (const k of NEWS_TYPES) if (typeof n.types[k] !== 'boolean') n.types[k] = true;
  // one-time: add the local/activist channels (25 Oct 2026) to an existing saved list; they start from
  // their newest post (no backlog) like any new source. Sources the owner removed later stay removed.
  if (!n.mig || typeof n.mig !== 'object') n.mig = {};
  if (!n.mig.local1) {
    for (const s of DEFAULT_SOURCES) {
      if (!s.local) continue;
      const cur = n.sources.find((x) => x.u.toLowerCase() === s.u.toLowerCase());
      if (cur) { cur.local = true; cur.general = true; } else if (n.sources.length < NEWS_CFG.maxSources) n.sources.push({ ...s, on: true });
    }
    n.mig.local1 = new Date().toISOString();
  }
  // Add only official first-party channels needed for road status; pollOnce baselines new feeds at their
  // latest post, so deployment never replays existing events or changes current road records.
  if (!n.mig.roadOfficial1) {
    for (const s of DEFAULT_SOURCES.filter((x) => x.roadOnly)) {
      const cur = n.sources.find((x) => x.u.toLowerCase() === s.u.toLowerCase());
      if (cur) { cur.roadOnly = true; cur.general = true; }
      else if (n.sources.length < NEWS_CFG.maxSources) n.sources.push({ ...s, on: true });
    }
    n.mig.roadOfficial1 = new Date().toISOString();
  }
  // Add the new North Syria / Idlib feeds to existing saved configurations once; new feeds start at
  // their newest post, and an already-added source keeps the owner's enabled/paused choice.
  if (!n.mig.northNews1) {
    for (const s of DEFAULT_SOURCES.filter((x) => ['enabbaladi', 'syriadefence'].includes(x.u.toLowerCase()))) {
      const cur = n.sources.find((x) => x.u.toLowerCase() === s.u.toLowerCase());
      if (cur) {
        cur.name = s.name;
        cur.general = true;
        if (s.local) cur.local = true;
      } else if (n.sources.length < NEWS_CFG.maxSources) n.sources.push({ ...s, on: true });
    }
    n.mig.northNews1 = new Date().toISOString();
  }
  // Add the verified official Syrian News Agency public feed to saved configurations once.
  // Its first poll is baselined at the newest post, so no historic alerts are replayed.
  if (!n.mig.sanaOfficial1) {
    for (const s of DEFAULT_SOURCES.filter((x) => x.u.toLowerCase() === 'sana_gov')) {
      const cur = n.sources.find((x) => x.u.toLowerCase() === s.u.toLowerCase());
      if (cur) { cur.name = s.name; cur.general = true; }
      else if (n.sources.length < NEWS_CFG.maxSources) n.sources.push({ ...s, on: true });
    }
    n.mig.sanaOfficial1 = new Date().toISOString();
  }
  // Add three independently verified Syrian news feeds once. New feeds are baselined at their newest
  // post on the first poll; existing paused choices stay paused, and the source cap remains in force.
  if (!n.mig.verifiedFeeds1) {
    const verified = new Set(['hawarnews', 'zamanalwslnews', 'qasiounar1']);
    for (const s of DEFAULT_SOURCES.filter((x) => verified.has(x.u.toLowerCase()))) {
      const cur = n.sources.find((x) => x.u.toLowerCase() === s.u.toLowerCase());
      if (cur) {
        cur.name = s.name;
        cur.general = true;
        if (s.local) cur.local = true;
      } else if (n.sources.length < NEWS_CFG.maxSources) n.sources.push({ ...s, on: true });
    }
    n.mig.verifiedFeeds1 = new Date().toISOString();
  }
  // Expansion batch (2026-11-17, owner request): seven more verified Syrian channels.
  // Same one-time pattern: new feeds baseline at their newest post on first poll, an
  // already-added source keeps the owner's enabled/paused choice, cap respected.
  if (!n.mig.expandedFeeds1) {
    const expanded = new Set(['shaamnetwork', 'souriapost', 'orientnewsar', 'homs_news', 'golantimes', 'idlibplus', 'furatpost']);
    for (const s of DEFAULT_SOURCES.filter((x) => expanded.has(x.u.toLowerCase()))) {
      const cur = n.sources.find((x) => x.u.toLowerCase() === s.u.toLowerCase());
      if (cur) {
        cur.name = s.name;
        cur.general = true;
        if (s.local) cur.local = true;
      } else if (n.sources.length < NEWS_CFG.maxSources) n.sources.push({ ...s, on: true });
    }
    n.mig.expandedFeeds1 = new Date().toISOString();
  }
  // Existing political drafts must remain human-reviewed when night eligibility is enabled.
  // Only drafts created after this one-time activation checkpoint can qualify.
  if (!n.mig.politicalNightAuto1) {
    n.mig.politicalNightAuto1 = new Date().toISOString();
    save(false);
  }
  setSourceNames(n.sources.map((s) => s.name));
  if (!n.last || typeof n.last !== 'object') n.last = {};
  if (!n.seen || typeof n.seen !== 'object') n.seen = {};
  if (!n.drafts || typeof n.drafts !== 'object') n.drafts = {};
  if (!Array.isArray(n.alerts)) n.alerts = [];
  if (!Array.isArray(n.echoLog)) n.echoLog = [];
  // Expand the two-minute daytime fallback only for drafts discovered after this one-time checkpoint.
  // Existing pending drafts keep their review status and cannot be swept into the new policy.
  if (!n.mig.dayAutoAllTypes1) { n.mig.dayAutoAllTypes1 = new Date().toISOString(); save(false); }
  // 🌙 night auto-publish (owner request 27 Oct 2026: «من الساعة 10 المسا للساعة 8 الصبح»), Damascus time
  if (!n.night || typeof n.night !== 'object') n.night = { on: true, from: '22:00', to: '08:00', summary: true, sumDay: null, sumAt: 0 };
  if (!NIGHT_FROM.includes(n.night.from)) n.night.from = '22:00';
  if (!NIGHT_TO.includes(n.night.to)) n.night.to = '08:00';
  if (typeof n.night.summary !== 'boolean') n.night.summary = true;
  if (!n.mig.nightStart22) {
    if (n.night.from === '00:00') n.night.from = '22:00';
    n.mig.nightStart22 = new Date().toISOString();
    save();
  }
  if (!n.stats || n.stats.day !== dayKey()) n.stats = { day: dayKey(), posts: 0, drafts: 0, merged: 0, dupes: 0, published: 0, ignored: 0 };
  return n;
}
const save = (soon = true) => store.persist({ backupSoon: soon });

// A manual cross-check for human-submitted reports. This is deliberately a source
// lookup, not a truth classifier: a match is only evidence that a configured source
// published something relevant, and no match does not mean the report is false.
const REPORT_TYPE_TERMS = {
  uav: ['مسيرة', 'مسيرات', 'المسيرات', 'درون', 'طائرة بدون طيار', 'استطلاع', 'drone'],
  uav_strike: ['استهداف بمسيرة', 'استهداف بطائرة مسيرة', 'غارة بمسيرة', 'قصف بمسيرة', 'drone strike', 'uav strike'],
  assassination: ['اغتيال', 'اغتيل', 'محاولة اغتيال', 'assassination', 'assassinated'],
  warplane: ['طيران حربي', 'الطيران الحربي', 'طائرة حربية', 'طائرات حربية', 'غارة جوية', 'غارات جوية', 'قصف جوي', 'warplane', 'airstrike'],
  military_incursion: ['توغل آليات عسكرية', 'رتل عسكري', 'دورية عسكرية', 'تحرك آليات عسكرية', 'آليات عسكرية', 'military vehicle incursion', 'military convoy', 'armored vehicles'],
  artillery: ['قصف مدفعي', 'مدفعية', 'قذائف', 'قصف', 'shelling'],
  attack: ['هجوم', 'اشتباك', 'اقتحام', 'مسلح', 'attack', 'clash'],
  explosion: ['انفجار', 'تفجير', 'عبوة ناسفة', 'explosion', 'blast'],
  missile: ['صاروخ', 'صواريخ', 'الصواريخ', 'قذيفة', 'قذائف', 'missile', 'rocket'],
  civil: ['مدني', 'مدنيين', 'المدنيين', 'ضحايا', 'مواطنين', 'civilian'],
  accident: ['حادث سير', 'حادث مروري', 'تصادم', 'traffic accident'],
  fire: ['حريق', 'اندلاع النيران', 'fire'],
  protest: ['مظاهرة', 'احتجاج', 'تظاهر', 'protest'],
  civil_plane: ['طائرة مدنية', 'طائرة ركاب', 'هبوط اضطراري', 'civilian aircraft'],
  road: ['قطع طريق', 'إغلاق طريق', 'إغلاق الطريق', 'فتح الطريق', 'حالة الطريق', 'road closed', 'road closure'],
  quake: ['زلزال', 'هزة أرضية', 'earthquake'],
  weather: ['تحذير جوي', 'أمطار غزيرة', 'عاصفة', 'طقس', 'weather warning'],
};
const REPORT_STOP = new Set(['الى', 'على', 'عن', 'في', 'من', 'هذا', 'هذه', 'هناك', 'بعد', 'قبل', 'تم', 'كما', 'قد', 'ان', 'انه', 'الذي', 'التي', 'مع', 'كان', 'كانت', 'the', 'and', 'for', 'from', 'near', 'with', 'was', 'were', 'this', 'that']);
const reportWords = (text) => new Set(N(text).split(' ').filter((w) => w.length >= 3 && !REPORT_STOP.has(w)));
const reportPhraseIn = (text, phrase) => {
  const p = N(phrase);
  return p && (` ${text} `).includes(` ${p} `);
};
function reportLocationNames(d) {
  return [d?.location, ...(d?.extra || [])].filter(Boolean).flatMap((loc) => {
    // When a town is known, a governorate mention alone is too broad to count as corroboration.
    const names = loc.scope === 'governorate'
      ? [loc.name_ar, loc.name_en]
      : [loc.name_ar, loc.name_en, loc.district_ar, loc.district_en];
    return names.map((x) => N(x)).filter((x) => x.length >= 3);
  }).filter((x, i, all) => all.indexOf(x) === i);
}
function reportCandidate(d, text) {
  const normalized = N(text);
  const locs = reportLocationNames(d);
  const locHit = locs.some((name) => reportPhraseIn(normalized, name));
  const typeTerms = (REPORT_TYPE_TERMS[d?.type] || []).some((term) => reportPhraseIn(normalized, term));
  const details = d?.type === 'breaking' ? d?.text : d?.details;
  const wanted = reportWords(details || '');
  const shared = [...wanted].filter((w) => reportWords(text).has(w)).length;
  // Requiring the place plus a type/detail cue avoids treating every post about the same city as a match.
  const detailHit = shared >= (wanted.size <= 2 ? 1 : 2);
  const isMatch = locHit
    ? (typeTerms || detailHit)
    : (!locs.length && (shared >= 3 || (wanted.size <= 3 && shared >= 2)) && (typeTerms || shared >= 3));
  return { isMatch, score: (locHit ? 5 : 0) + (typeTerms ? 3 : 0) + shared, locHit, typeTerms, shared };
}

/** Check a report against recent public posts from the currently enabled configured sources. */
export async function verifyReportSources(draft, {
  sources = newsState().sources.filter((s) => s.on),
  fetchSource = (source) => fetchChannel(source.u, { timeoutMs: 8_000 }),
  now = Date.now(),
  concurrency = 8,
  maxAgeMs = 72 * H_MS,
} = {}) {
  const selected = (sources || []).filter((s) => s && s.on !== false && s.u).slice(0, NEWS_CFG.maxSources);
  const matches = [];
  const errors = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < selected.length) {
      const source = selected[cursor++];
      try {
        const page = await fetchSource(source);
        let best = null;
        for (const post of page?.posts || []) {
          if (post.ts && now - post.ts > maxAgeMs) continue;
          const cleaned = cleanPostText(post.text || '').text;
          if (!cleaned) continue;
          const fit = reportCandidate(draft, cleaned);
          if (!fit.isMatch) continue;
          const candidate = {
            name: source.name || page.title || source.u,
            url: /^https:\/\/t\.me\/[A-Za-z0-9_/-]+$/.test(post.url || '') ? post.url : `https://t.me/${encodeURIComponent(source.u)}`,
            ts: Number.isFinite(post.ts) ? post.ts : null,
            excerpt: cleaned.replace(/\s+/g, ' ').slice(0, 240),
            score: fit.score,
          };
          if (!best || candidate.score > best.score || (candidate.score === best.score && (candidate.ts || 0) > (best.ts || 0))) best = candidate;
        }
        if (best) matches.push(best);
      } catch {
        errors.push(source.name || source.u);
      }
    }
  };
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), selected.length) }, () => worker());
  await Promise.all(workers);
  matches.sort((a, b) => b.score - a.score || (b.ts || 0) - (a.ts || 0));
  return { checkedAt: new Date(now).toISOString(), totalSources: selected.length, checkedSources: selected.length - errors.length, errors, matches: matches.slice(0, 5) };
}

// ---------------------------------------------------------------- runtime
const R = {
  H: null, // bot helpers (registerNewsTools)
  rewriteImpl: null, // test-only override; production uses the dedicated free-tier key
  queue: [], // posts waiting for the AI
  log: [], // last decisions (debug endpoint)
  src: {}, // u -> { ok, at, err, n }
  lastPollAt: 0, lastAiAt: 0, aiOk: null, busy: false, stopped: false, started: false, timer: null,
  dayAutoTimer: null,
};
const note = (it, decision) => {
  R.log.push({ t: new Date().toISOString(), src: it.src?.u || it.u, url: it.url, text: String(it.text || '').slice(0, 140), decision });
  if (R.log.length > 120) R.log.splice(0, R.log.length - 120);
};
const api = () => R.H?.apis().admin || null;
const reviewerIds = () => automaticMonitorRecipientIds();
const ownerIdsU = () => [...new Set(config.ownerIds)];

// ---------------------------------------------------------------- 🌙 night window (Asia/Damascus)
export const NIGHT_FROM = ['22:00', '23:00', '00:00', '01:00'];
export const NIGHT_TO = ['06:00', '07:00', '08:00', '09:00'];
const hmNow = (t = Date.now()) => new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
const hhmm = (t) => new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
export function inNightWindow(g, hm) { return g.from <= g.to ? hm >= g.from && hm < g.to : hm >= g.from || hm < g.to; }
export function nightActive(t = Date.now()) { const g = newsState().night; return Boolean(g.on) && inNightWindow(g, hmNow(t)); }
export function daytimeWindow(t = Date.now()) { const hm = hmNow(t); return hm >= '08:00' && hm < '22:00'; }
const isLocalSrc = (s) => Boolean(s.local || (newsState().sources.find((x) => x.u === s.u) || {}).local);
/** auto-publishable at night: a real (non-test) AI classification, backed by a main source or by 2+ sources */
export function nightEligible(d) {
  if (!d || d.test || d.rule || d.editorialHold || Object.keys(d.privateEditorial || {}).length > 0 || (d.aiRewritePreview?.applied && ['opinion', 'satire'].includes(d.aiRewritePreview.mode)) || d.dronePresence === true || (Array.isArray(d.sourceMedia) && d.sourceMedia.length)) return false;
  if (!isFreshSourceTs(draftSourceTs(d))) return false; // stale reporting is never auto-published, however the draft got here (e.g. restored from an old backup)
  if (['breaking', 'weather', 'civil', 'arrest', 'death', 'martyrdom', 'brawl', 'shooting', 'helicopter', 'airstrike', 'detonation', 'smuggling_weapons', 'smuggling_drugs', 'smuggling_explosives', 'patrol', 'military_incursion', 'kidnapping', 'signal_sweep'].includes(d.type)) return false;
  if (d.type === 'political') {
    const activatedAt = Date.parse(newsState().mig.politicalNightAuto1);
    if (!POLITICAL_CATEGORIES[d.politicalCategory] || d.politicalNeedsCategory || !Number.isFinite(d.created) || !Number.isFinite(activatedAt) || d.created <= activatedAt) return false;
  }
  if (!d.loc || d.loc.scope === 'country' || !Number.isFinite(d.loc.latitude) || !Number.isFinite(d.loc.longitude)) return false;
  const ss = d.srcs || [];
  return ss.length >= 2 || ss.some((x) => !isLocalSrc(x));
}
const editorialDigits = (value) => String(value || '').replace(/[٠-٩۰-۹]/g, (digit) => {
  const code = digit.charCodeAt(0);
  return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
});
const editorialNorm = (value) => normalizeArabic(editorialDigits(value)).toLowerCase().replace(/\s+/g, ' ').trim();
const editorialPhrase = (value) => editorialNorm(value).replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const editorialHas = (text, phrase) => {
  const haystack = ` ${editorialPhrase(text)} `;
  const needle = editorialPhrase(phrase);
  return Boolean(needle && haystack.includes(` ${needle} `));
};
const editorialHasAny = (text, phrases) => phrases.some((phrase) => editorialHas(text, phrase) || editorialHas(text, `و${phrase}`));
const publicDraftCopyIssue = (d, allowedCopy = null) => [d?.headline, d?.body, d?.details, d?.text, d?.description, d?.title, d?.title_en, d?.description_en]
  .some((value) => isPrivateEditorialCopy(value) && !(allowedCopy && value === allowedCopy))
  ? 'private-editorial-copy-not-public' : null;
function privateEditorialModeApplicable(d) {
  if (!d || !NEWS_TYPES.includes(d.type) || !ALERT_TYPES[d.type]) return false;
  return rewriteSourceReviewReason(String(d.sourceText || d.headline || d.body || '')) === null;
}
function approvedOwnerEditorialCopy(d, ownerId) {
  const preview = d?.aiRewritePreview;
  const mode = preview?.mode;
  if (!['opinion', 'satire'].includes(mode) || preview.applied !== true || !ownerIdsU().includes(Number(ownerId))) return null;
  const sourceText = String(d.sourceText || d.headline || '').trim();
  if (preview.sourceText !== sourceText || preview.baseHeadline !== d.headline
    || (preview.baseType !== undefined && preview.baseType !== d.type)
    || !privateEditorialModeApplicable(d) || rewriteSourceReviewReason(sourceText)) return null;
  const stored = d.privateEditorial?.[mode];
  if (typeof stored !== 'string' || !stored.trim() || stored !== preview.text) return null;
  if (privateEditorialOutputReviewReason(sourceText, stored)) return null;
  let finalized;
  try { finalized = finalizeRewriteOutput(stored, mode, d.srcs?.[0]?.name || ''); } catch { return null; }
  if (finalized !== stored || !isPublicEditorialCopy(finalized, mode)) return null;
  return { mode, text: finalized };
}
/** A no-AI, fail-closed check: uncertain edits stay pending for the owner instead of reaching either public surface. */
function editorialGate(d) {
  const fail = (reason) => ({ ok: false, reason });
  const rawSource = String(d?.sourceText || d?.body || '').trim();
  const rawHeadline = String(d?.headline || '').trim();
  if (publicDraftCopyIssue(d)) return fail('private-editorial-copy-not-public');
  const source = editorialNorm(rawSource.replace(/https?:\/\/\S+|www\.\S+|t\.me\/\S+/gi, ' '));
  const headline = editorialNorm(rawHeadline);
  if (!source || !headline || !(d.srcs || []).length) return fail('missing-source-or-text');
  if (d.aiRewritePreview?.applied && ['opinion', 'satire'].includes(d.aiRewritePreview.mode)) return fail('opinion-analysis-not-auto-publish');
  if (!NEWS_TYPES.includes(d.type) || !ALERT_TYPES[d.type]) return fail('invalid-type');
  if (refineType(d.type, rawSource) !== d.type) return fail('type-conflict');
  if (d.type === 'political') {
    const inferred = inferPoliticalCategory(rawSource);
    if (!POLITICAL_CATEGORIES[d.politicalCategory] || (inferred && inferred !== d.politicalCategory)) return fail('political-category-conflict');
  }

  const publicRaw = `${rawHeadline}\n${d.body || ''}`;
  if (/https?:\/\/|www\.|t\.me\/|@[A-Za-z0-9_]{4,}/i.test(publicRaw)) return fail('public-link-or-handle');
  const feedNames = (d.srcs || []).flatMap((sourceItem) => [sourceItem?.name, sourceItem?.u]).filter(Boolean);
  if (d.sourceBodyVersion !== 1 && feedNames.some((name) => editorialHas(publicRaw, name))) return fail('private-feed-identity');

  const locs = locsOf(d.loc, d.extra);
  const placeNames = locs.flatMap((loc) => [loc?.name_ar, loc?.district_ar, loc?.governorate_ar]).filter(Boolean);
  const sourcePlaces = placeNames.filter((name) => nameInText(name, rawSource));
  const politicalWithoutPin = d.type === 'political' && d.sourceBodyVersion === 1 && d.loc?.scope === 'country';
  const sourceNamedWithoutPin = politicalWithoutPin || (d.sourceBodyVersion === 1 && d.loc?.scope === 'country' && d.loc.name_ar && d.loc.name_ar !== 'سوريا' && nameInText(d.loc.name_ar, rawSource));
  if (!sourceNamedWithoutPin && !sourcePlaces.length) return fail('place-missing-from-source');
  if (!sourceNamedWithoutPin && !sourcePlaces.some((name) => nameInText(name, rawHeadline))) return fail('place-missing-from-headline');

  const withoutLinks = editorialDigits(rawSource.replace(/https?:\/\/\S+|www\.\S+|t\.me\/\S+/gi, ' '));
  const publicDigits = editorialDigits(rawHeadline);
  const numbers = withoutLinks.match(/\d+(?::\d+)?(?:[.,]\d+)?/g) || [];
  if (numbers.some((number) => !publicDigits.includes(number))) return fail('number-or-time-omitted');
  for (const marker of ['اليوم', 'امس', 'غدا', 'صباح', 'ظهرا', 'مساء', 'فجر', 'ليلا', 'الساعة', 'كانون', 'شباط', 'اذار', 'نيسان', 'ايار', 'حزيران', 'تموز', 'اب', 'ايلول', 'تشرين', 'يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو', 'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر']) {
    if (editorialHas(source, marker) && !editorialHas(headline, marker)) return fail('date-or-time-omitted');
  }

  const attribution = /(?:^|\s)و?(?:قال|قالت|اعلن|اعلنت|افاد|افادت|ذكر|ذكرت|اكد|اكدت|اوضح|اوضحت|صرح|صرحت|بحسب|وفقا)(?:\s|$)/u;
  if (attribution.test(source) !== attribution.test(headline)) return fail('attribution-changed');
  const actorPattern = /(?:^|[\s:])و?(?:قال|قالت|اعلن|اعلنت|افاد|افادت|ذكر|ذكرت|اكد|اكدت|اوضح|اوضحت|صرح|صرحت|بحسب|وفقا)(?:\s+ل)?\s+([^،؛:.\n]{2,100}?)(?=\s+(?:ان|اليوم|امس|غدا|حول|بشان|عن|بعد|في|مع|انه|انها|بانه|بدء|بدا|سيتم|جديد)(?:\s|$)|[،؛:.\n]|$)/gu;
  const sourceActors = [...rawSource.matchAll(actorPattern)].map((match) => editorialPhrase(match[1])).filter((actor) => actor.length >= 3);
  const headlineActors = [...rawHeadline.matchAll(actorPattern)].map((match) => editorialPhrase(match[1])).filter((actor) => actor.length >= 3);
  if (sourceActors.some((actor) => !editorialHas(rawHeadline, actor))) return fail('attributed-actor-omitted');
  if (headlineActors.some((actor) => !editorialHas(rawSource, actor))) return fail('attributed-actor-invented');

  const uncertaintyGroups = [
    ['قد', 'ربما', 'على الارجح', 'احتمال', 'من المحتمل'],
    ['متداول'],
    ['غير مؤكد', 'لم يتسن التحقق', 'لم يتم التحقق', 'انباء غير مؤكدة', 'معلومات اولية', 'اولية'],
    ['يشتبه', 'مشتبه', 'مزعوم', 'مزعم', 'alleged', 'unconfirmed', 'possibly', 'may have'],
  ];
  for (const group of uncertaintyGroups) {
    const inSource = editorialHasAny(source, group);
    const inHeadline = editorialHasAny(headline, group);
    if (inSource !== inHeadline) return fail('uncertainty-changed');
  }

  const responseGroups = [
    ['نفى', 'نفت', 'ينفي', 'تنفي'], ['رد', 'ردت', 'ردوا'],
    ['اوضح', 'اوضحت'], ['في المقابل', 'من جهته', 'من جانبها', 'من جانبهم'],
    ['لم يعلق', 'رفض التعليق', 'تعليق رسمي'],
  ];
  for (const group of responseGroups) {
    const inSource = editorialHasAny(source, group);
    const inHeadline = editorialHasAny(headline, group);
    if (inSource !== inHeadline) return fail('response-or-context-changed');
  }

  const evaluative = ['بطولي', 'عبقري', 'خائن', 'مجرم', 'فاشل', 'ناجح', 'عظيم', 'رائع', 'مذهل', 'كارثي', 'فضيحة', 'انتصار ساحق', 'هزيمة ساحقة', 'فشل ذريع', 'heroic', 'brilliant', 'traitorous', 'disastrous', 'humiliating victory'];
  const sharpPoliticalPhrases = ['حكومة فاشلة', 'سياسة فاشلة', 'سياسات فاشلة', 'فشل ذريع', 'تخبط حكومي', 'فضيحة سياسية', 'نهج كارثي', 'حكومة عاجزة', 'قمع وحشي', 'عار سياسي', 'خيانة سياسية', 'حكومة انتقالية فاشلة'];
  if (d.type === 'political' && sharpPoliticalPhrases.some((phrase) => editorialHas(publicRaw, phrase))) return fail('sharp-political-tone-not-news');
  const attributionCue = /(?:^|\s)و?(?:قال|قالت|اعلن|اعلنت|افاد|افادت|ذكر|ذكرت|اكد|اكدت|اوضح|اوضحت|صرح|صرحت|وصف|وصفت|اعتبر|اعتبرت|اتهم|اتهمت|بحسب|وفقا)(?:\s|$)/u;
  for (const word of evaluative) {
    if (editorialHas(headline, word) && (!editorialHas(source, word) || !attributionCue.test(headline))) return fail('unsupported-evaluation');
  }
  return { ok: true, reason: null };
}
/** Daytime includes every monitored event type, but only for new drafts that pass the shared safety gates. */
export function daytimeAutoEligible(d) {
  if (!d || d.status !== 'pending' || d.test || d.rule || d.editorialHold
    || Object.keys(d.privateEditorial || {}).length > 0
    || (d.aiRewritePreview?.applied && ['opinion', 'satire'].includes(d.aiRewritePreview.mode))
    || (Array.isArray(d.sourceMedia) && d.sourceMedia.length)) return false;
  if (!isFreshSourceTs(draftSourceTs(d))) return false; // stale reporting is never auto-published, however the draft got here (e.g. restored from an old backup)
  const n = newsState();
  if (!NEWS_TYPES.includes(d.type) || !ALERT_TYPES[d.type] || n.types[d.type] === false) return false;
  const activatedAt = Date.parse(n.mig.dayAutoAllTypes1);
  if (!Number.isFinite(d.created) || !Number.isFinite(activatedAt) || d.created <= activatedAt) return false;
  if (d.type === 'political') {
    const politicalAt = Date.parse(n.mig.politicalNightAuto1);
    if (!POLITICAL_CATEGORIES[d.politicalCategory] || d.politicalNeedsCategory
      || !Number.isFinite(politicalAt) || d.created <= politicalAt) return false;
  }
  if (!d.loc || d.loc.scope === 'country' || !Number.isFinite(d.loc.latitude) || !Number.isFinite(d.loc.longitude)) return false;
  const sources = Array.isArray(d.srcs) ? d.srcs : [];
  return sources.length >= 2 || sources.some((source) => source && !isLocalSrc(source));
}
export function dayAutoDueAt(d, now = Date.now()) {
  return daytimeWindow(now) && daytimeAutoEligible(d) && !Number.isFinite(d.dayAutoAt) ? now + DAY_AUTO_DELAY_MS : null;
}
export function dayAutoReady(d, now = Date.now()) {
  return daytimeAutoEligible(d) && Number.isFinite(d.dayAutoAt) && d.dayAutoAt <= now;
}
function scheduleDayAuto(d, now = Date.now()) {
  const dueAt = dayAutoDueAt(d, now);
  if (dueAt == null) return false;
  d.dayAutoAt = dueAt;
  return true;
}

// ---------------------------------------------------------------- pre-publish audit (owner request 2026-11-17: «نشر تلقائي … مع تدقيق الخبر وتصحيحه»)
/** The editorial hold reason used when the pre-publish audit stops an auto-publish.
 * cardText already renders any editorialHold as a «held for editorial review» status
 * line, so the reviewer sees the hold on the card with no card changes. mergeInto
 * clears ONLY this reason, when a genuinely new source joins the draft. */
export const AUTO_AUDIT_HOLD_REASON = 'auto-audit-failed';
const auditTidy = (x) => cleanAttributedNewsText(String(x || '').replace(/[\u0000-\u001F]/g, ' ')).replace(/\s+/g, ' ').trim();
const auditTidyBody = (x) => cleanAttributedNewsText(String(x || '').replace(/[\u0000-\u001F]/g, ' ')).trim();
const stripAlAudit = (w) => (w.startsWith('ال') ? w.slice(2) : w);
const auditTokEq = (a, b) => a === b || stripAlAudit(a) === stripAlAudit(b);
/** Occurrences of a place-name form (token sequence) inside normalized, punctuation-free tokens. */
function formOccurrences(tokens, formTokens) {
  const out = [];
  if (!formTokens.length || formTokens.length > tokens.length) return out;
  outer: for (let i = 0; i + formTokens.length <= tokens.length; i++) {
    for (let k = 0; k < formTokens.length; k++) if (!auditTokEq(tokens[i + k], formTokens[k])) continue outer;
    out.push(i);
  }
  return out;
}
/** Publish-time place sanity for the draft's primary pin. Returns a failure reason or null.
 * Re-runs the desk's own defences on the FINAL draft, because a draft can be edited,
 * merged or restored after classification: the place must still be named in the source,
 * and a pin that rests only on an alternative spelling is refused when every mention of
 * that spelling is unintroduced (the free-text alt rule) or framed as a person's name —
 * the «سلمان» village vs «سليمان كرنوص» failure mode. Canonical mentions are unaffected. */
function auditPlaceSuspect(d) {
  const loc = d?.loc;
  if (!loc || loc.scope !== 'place' || !Number.isFinite(loc.place_id)) return null;
  const rec = getPlace(loc.place_id);
  if (!rec) return null;
  const source = String(d.sourceText || d.body || '');
  if (!source.trim()) return null;
  const tokens = N(source).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const canonTokens = N(rec.ar).split(/\s+/).filter(Boolean);
  const canonHits = formOccurrences(tokens, canonTokens);
  const altForms = [...new Set((rec.alt || []).map((a) => N(a)).filter((a) => a && a !== N(rec.ar)))];
  const altHits = [];
  for (const alt of altForms) {
    const altTokens = alt.split(/\s+/).filter(Boolean);
    for (const i of formOccurrences(tokens, altTokens)) altHits.push({ i, alt, single: altTokens.length === 1 ? altTokens[0] : null });
  }
  if (!canonHits.length && !altHits.length) return 'place-not-in-source';
  if (canonHits.length) return null; // the canonical name itself is in the text: the pin stands
  // the pin rests only on alternative spellings: at least one mention must be framed as a
  // place — a canonical variant form, or an explicit place introducer right before it —
  // exactly as the free-text scanners require. A bare alt mention («الزوجين "سليمان كرنوص"»)
  // is a person's name until proven otherwise, so the draft goes back to manual review.
  const placeFramed = altHits.some(({ i, single }) => {
    if (single && !isAltOnlyMatch(single, [rec])) return true; // this form is itself a canonical variant
    return hasPlaceIntroducer(tokens, i, tokens[i]);
  });
  return placeFramed ? null : 'place-person-name-suspect';
}
/** The single pre-publish audit every automatic publication must pass (owner request
 * 2026-11-17). Called by nightPublish for BOTH routes (night immediate + the daytime
 * 2-minute fallback) after eligibility and before the editorial gate.
 * VERIFY: source freshness, corroboration as it stands NOW, place sanity on the final text.
 * CORRECT: the outgoing copy is cleaned in place — duplicated type-label prefix stripped,
 * sharp-tone headlines replaced by a factual type + place line, truncated-copy headlines
 * rebuilt from the source lead at a word boundary, headline/body re-cleaned and capped at
 * word boundaries — so what publishes is the corrected version, never the raw draft text.
 * A failed audit NEVER publishes: the caller holds the draft for manual review with
 * d.autoAudit.reason recorded; the hold is lifted only by new corroborating input
 * (see mergeInto), so a failed draft is never re-audited in a timer loop. */
export function auditDraftForAutoPublish(d, mode = 'night') {
  if (!d) return { ok: false, reason: 'missing-draft' };
  if (!isFreshSourceTs(draftSourceTs(d))) return { ok: false, reason: 'stale-source' };
  const srcs = Array.isArray(d.srcs) ? d.srcs : [];
  if (!(srcs.length >= 2 || srcs.some((s) => s && !isLocalSrc(s)))) return { ok: false, reason: 'uncorroborated' };
  const placeReason = auditPlaceSuspect(d);
  if (placeReason) return { ok: false, reason: placeReason };
  const corrected = [];
  const source = String(d.sourceText || '');
  let headline = String(d.headline || '').trim();
  const stripped = stripTypeLabelPrefix(headline, d.type);
  if (stripped !== headline) { headline = stripped; corrected.push('type-label-prefix'); }
  const tone = sharpToneReason(headline);
  if (tone) {
    const label = ALERT_TYPES[d.type]?.ar || 'خبر';
    headline = d.loc?.name_ar ? `${label} — ${d.loc.name_ar}` : label;
    d.toneGuard = tone;
    corrected.push('tone-neutralized');
  }
  const cut = truncatedPrefixCut(headline, source);
  if (cut) {
    const rebuilt = truncateAtWordBoundary(auditTidy(source.split('\n')[0] || ''), 240);
    if (!rebuilt) return { ok: false, reason: 'headline-unusable' };
    headline = rebuilt;
    d.headlineRebuilt = cut;
    corrected.push('headline-rebuilt');
  }
  const capped = truncateAtWordBoundary(headline, 240);
  if (capped !== headline) { headline = capped; corrected.push('headline-truncated'); }
  if (headline !== String(d.headline || '').trim()) d.headline = headline;
  if (d.body) {
    let body = truncateAtWordBoundary(auditTidyBody(d.body), 1200);
    if (!body || body === d.headline) body = '';
    if (body !== d.body) { d.body = body; corrected.push('body-cleaned'); }
  }
  return { ok: true, corrected };
}
const langOfId = (id) => (store.userLang(id) === 'en' ? 'en' : 'ar');
const tr = (lang, ar, en) => (lang === 'en' ? en : ar);

// ---------------------------------------------------------------- geometry & matching
const km = (a, b) => {
  const R0 = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R0 * Math.asin(Math.sqrt(h));
};
const locsOf = (loc, extra) => [loc, ...(extra || [])].filter((x) => x && x.scope !== 'country');
function geoOf(locs) {
  const pts = [], dists = [], govs = [];
  let coarse = false;
  for (const l of locs) {
    if (l.scope === 'governorate') coarse = true;
    if (Number.isFinite(l.latitude) && l.scope !== 'governorate') pts.push({ lat: l.latitude, lon: l.longitude });
    if (l.district_ar) dists.push(N(l.district_ar));
    if (l.governorate_ar) govs.push(N(l.governorate_ar));
  }
  return { pts, dists, govs, coarse, none: !locs.length };
}
const whereOf = (locs) => (locs.length ? locs.map((l) => [l.name_ar, l.scope !== 'governorate' && l.governorate_ar !== l.name_ar ? l.governorate_ar : ''].filter(Boolean).join('، ')).join(' + ') : 'سوريا');
const AIR = new Set(['uav', 'warplane', 'helicopter', 'missile']);
const STRIKE = new Set(['attack', 'artillery', 'airstrike', 'explosion']);
const CIVIL = new Set(['civil', 'accident', 'fire', 'civil_plane', 'explosion']);
const WINDOW_MIN = { uav: 120, uav_strike: 120, warplane: 120, helicopter: 120, airstrike: 180, missile: 180, attack: 360, assassination: 360, artillery: 360, explosion: 360, civil: 360, accident: 360, fire: 360, civil_plane: 240, protest: 480, breaking: 360, weather: 720 };
const sameFamily = (a, b) => a === b || (AIR.has(a) && AIR.has(b)) || (STRIKE.has(a) && STRIKE.has(b)) || ((a === 'civil' || b === 'civil') && CIVIL.has(a) && CIVIL.has(b));
const tokens = (s) => new Set(N(s).split(' ').filter((w) => w.length >= 3).map((w) => (w.startsWith('ال') && w.length > 4 ? w.slice(2) : w)));
function textSim(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}
// A raid may be classified as attack by one source and patrol by another.
// Do not merge those families globally: nearby patrols and attacks can be distinct.
// Only full raid copy, strong text overlap and known compatible geography qualify.
function crossTypeRaidDuplicate(a, b, aText, bText) {
  if (!((a.type === 'attack' && b.type === 'patrol') || (a.type === 'patrol' && b.type === 'attack'))) return false;
  if (a.geo.none || b.geo.none || !near(a.geo, b.geo)) return false;
  if (Math.abs((a.ts || 0) - (b.ts || 0)) > 6 * H_MS) return false;
  const raid = (text) => /(?:مداهم|دهم|تفتيش)/u.test(N(text));
  return raid(aText) && raid(bText) && !distinctPersons(aText, bText) && textSim(aText, bText) >= 0.45;
}
function near(g1, g2) {
  for (const p of g1.pts) for (const q of g2.pts) if (km(p, q) <= 15) return true;
  if (g1.dists.some((d) => g2.dists.includes(d))) return true;
  if ((g1.coarse || g2.coarse) && g1.govs.some((g) => g2.govs.includes(g))) return true;
  return false;
}
/** is candidate `c` the same incident as known event `k`? */
export function sameIncident(c, k) {
  const win = Math.max(WINDOW_MIN[c.type] || 360, WINDOW_MIN[k.type] || 360) * 60_000;
  if (Math.abs((c.ts || 0) - (k.ts || 0)) > win) return false;
  const sim = textSim(c.headline, k.headline);
  const bothKnownAndNear = !c.geo.none && !k.geo.none && near(c.geo, k.geo);
  const locationMissing = c.geo.none || k.geo.none;
  if (c.type === 'political' || k.type === 'political') {
    return c.type === 'political' && k.type === 'political'
      && !!c.politicalCategory && c.politicalCategory === k.politicalCategory
      && sim >= 0.82;
  }
  if (c.type === 'breaking' || k.type === 'breaking') {
    if (c.type !== k.type) return (bothKnownAndNear && sim >= 0.25) || (locationMissing && sim >= 0.85);
    return (bothKnownAndNear && sim >= 0.2) || (locationMissing && sim >= 0.85);
  }
  if (!sameFamily(c.type, k.type)) return crossTypeRaidDuplicate(c, k, c.headline, k.headline);
  if (distinctPersons(c.headline, k.headline)) return false; // same kind/place, different named people
  // Similar wording alone is not evidence of the same event: two incidents in distant
  // governorates must remain separate. Unknown locations need near-identical headlines.
  return (bothKnownAndNear && sim >= 0.2) || (locationMissing && sim >= 0.85);
}
/** every incident we already know of, newest first: drafts (any status), published alerts, pending human reports */
function knownEvents(hours = 12) {
  const n = newsState();
  const since = Date.now() - hours * H_MS;
  const out = [];
  const fromDraft = new Set();
  for (const d of Object.values(n.drafts)) {
    if (d.test || (d.ts || d.created) < since) continue;
    const locs = locsOf(d.loc, d.extra);
    if (d.alertId) fromDraft.add(d.alertId);
    out.push({ kind: 'draft', status: d.status, draftId: d.id, alertId: d.alertId, type: d.type, politicalCategory: d.politicalCategory, ts: d.ts || d.created, headline: d.headline, where: whereOf(locs), geo: geoOf(locs) });
  }
  for (const a of n.alerts) {
    if (a.ts < since || fromDraft.has(a.id)) continue;
    const stored = store.getAlert(a.id);
    out.push({ kind: 'alert', status: 'published', alertId: a.id, type: a.type, politicalCategory: a.politicalCategory || stored?.meta?.political?.category, ts: a.ts, headline: a.headline, where: a.where, geo: a.geo });
  }
  for (const rep of Object.values(store.state.reports || {})) {
    const d = rep?.draft;
    if (!d || !ALERT_TYPES[d.type] || (rep.created || 0) < since) continue;
    const locs = locsOf(d.location, d.extra);
    out.push({ kind: 'report', status: 'pending-report', type: d.type, politicalCategory: d.meta?.political?.category || d.politicalCategory, ts: rep.created, headline: [typeOf(d.type).ar, d.text || d.details || '', whereOf(locs)].join(' '), where: whereOf(locs), geo: geoOf(locs) });
  }
  return out.sort((a, b) => b.ts - a.ts);
}
// published alerts (any origin: human reports, the owner's own alerts, news drafts) are remembered 24 h
function rememberAlert(pa) {
  if (!pa || !pa.id || !ALERT_TYPES[pa.type]) return;
  const n = newsState();
  if (n.alerts.some((a) => a.id === pa.id)) return;
  const locs = [];
  const p = pa.place || {};
  const main = { scope: pa.scope, name_ar: p.name_ar, district_ar: p.district_ar, governorate_ar: p.governorate_ar, latitude: pa.location?.latitude, longitude: pa.location?.longitude };
  if (pa.scope && pa.scope !== 'country') locs.push(main);
  for (const x of pa.more || []) locs.push({ ...x });
  const geo = geoOf(locs);
  for (const z of pa.zones || []) geo.pts.push({ lat: z.lat, lon: z.lon });
  n.alerts.push({ id: pa.id, type: pa.type, politicalCategory: pa.political_category || pa.meta?.political?.category, ts: Date.parse(pa.timestamp) || Date.now(), headline: [pa.title, pa.description || ''].join(' ').trim(), where: whereOf(locs), geo });
  // Echo log (see selfEchoOf): the full published text, kept 96h, so a story
  // other channels repost tomorrow is recognised as our own, not as news.
  const echoText = [pa.title, pa.description || '', pa.body || ''].join(' ').replace(/\s+/g, ' ').trim().slice(0, 1200);
  if (echoText) (n.echoLog ||= []).push({ id: pa.id, type: pa.type, politicalCategory: pa.political_category || pa.meta?.political?.category, ts: Date.parse(pa.timestamp) || Date.now(), text: echoText, geo });
  save(false);
}

// ---------------------------------------------------------------- drafts & cards
const fmtLoc = (l) => (l.scope === 'governorate' ? `محافظة ${l.name_ar}` : l.scope === 'district' ? `منطقة ${l.name_ar}${l.governorate_ar && l.governorate_ar !== l.name_ar ? `، ${l.governorate_ar}` : ''}` : [l.name_ar, l.district_ar && l.district_ar !== l.name_ar ? l.district_ar : '', l.governorate_ar && l.governorate_ar !== l.name_ar && l.governorate_ar !== l.district_ar ? l.governorate_ar : ''].filter(Boolean).join('، '));
function cardText(d, lang = 'ar') {
  const locs = locsOf(d.loc, d.extra);
  const lines = [];
  lines.push(d.test
    ? tr(lang, '🧪 <b>تجربة — هذه مسودة تجريبية، لن يُنشر شيء</b>', '🧪 <b>TEST — a test draft, nothing will be published</b>')
    : tr(lang, '📡 <b>رصد إخباري — مسودة جاهزة للنشر</b>', '📡 <b>News monitor — draft ready to publish</b>'));
  const typeEmoji = d.type === 'military_incursion' && d.incursionKind === 'barrier' ? '🚧' : alertEmoji({ type: d.type, hazard: d.hazard });
  lines.push('', `<b>${typeEmoji ? `${typeEmoji} ` : ''}${esc(editableDraftTypeLabel(d, lang))}</b>`);
  if (locs.length > 1) {
    lines.push(`📍 <b>${tr(lang, `المناطق (${locs.length})`, `Areas (${locs.length})`)}:</b>`);
    for (const l of locs) lines.push(`• ${esc(fmtLoc(l))}`);
  } else lines.push(`📍 <b>${tr(lang, 'المكان', 'Place')}:</b> ${esc(locs[0] ? fmtLoc(locs[0]) : d.type === 'political' ? tr(lang, 'غير محدد داخل سوريا', 'Unspecified within Syria') : tr(lang, 'سوريا', 'Syria'))}`);
  if (d.flightHeading) lines.push(`🧭 <b>${tr(lang, 'الاتجاه', 'Heading')}:</b> ${esc(d.flightHeading)}`);
  lines.push(`📝 ${esc(d.publishedHeadline || d.headline)}`);
  if (d.type === 'helicopter') lines.push(d.intense === true
    ? tr(lang, '🚁🚁 <b>تحليق مكثف — مروحيتان</b>', '🚁🚁 <b>Intensive flight — two helicopters</b>')
    : tr(lang, '🚁 <b>مروحية واحدة</b>', '🚁 <b>One helicopter</b>'));
  if (d.type === 'political') {
    const category = POLITICAL_CATEGORIES[d.politicalCategory];
    lines.push(category
      ? `🏛 ${tr(lang, 'الفئة', 'Category')}: ${esc(lang === 'en' ? category.en : category.ar)}`
      : tr(lang, '⚠️ <b>الفئة السياسية غير محددة — اخترها قبل النشر.</b>', '⚠️ <b>Political category is missing — choose one before publishing.</b>'));
  }
  if (d.type === 'weather' && d.body) lines.push('', esc(d.body));
  if (d.originalHeadline && d.originalHeadline !== d.headline) {
    lines.push(`📝 <i>${tr(lang, 'الصياغة الأصلية للمقارنة', 'Original wording for comparison')}:</i> ${esc(d.originalHeadline)}`);
  }
  const isLocal = (s) => s.local || (newsState().sources.find((x) => x.u === s.u) || {}).local;
  const srcs = (d.srcs || []).map((s) => (s.url ? `<a href="${esc(s.url)}">${esc(s.name)}</a>` : esc(s.name)) + (isLocal(s) ? tr(lang, ' <i>(محلي)</i>', ' <i>(local)</i>') : ''));
  lines.push('', `🗞 <b>${tr(lang, `المصادر (${srcs.length})`, `Sources (${srcs.length})`)}:</b> ${srcs.join(' · ')}`);
  const nMain = (d.srcs || []).filter((s) => !isLocal(s)).length;
  if (d.type === 'political') {
    lines.push(tr(lang, 'ℹ️ <i>صياغة منسوبة لما نشرته المصادر — ليست تحققاً مستقلاً، وتحتاج مراجعة بشرية.</i>', 'ℹ️ <i>Attributed to the cited sources; this is not independent verification and needs human review.</i>'));
  } else if ((d.srcs || []).length >= 2) lines.push(tr(lang, `📡 <i>ورد الخبر في ${((k) => (k === 2 ? 'مصدرين' : k <= 10 ? `${k} مصادر` : `${k} مصدراً`))((d.srcs || []).length)}؛ وهذا لا يثبت تحققاً مستقلاً.</i>`, `📡 <i>Reported in ${(d.srcs || []).length} feeds; this alone is not independent verification.</i>`));
  else if (!nMain) lines.push(tr(lang, '⚠️ <i>مصدر محلي/ناشط واحد — غير مؤكد بعد، تأكد قبل النشر.</i>', '⚠️ <i>Single local/activist source — not confirmed yet, check before publishing.</i>'));
  if (d.editorialHold) {
    const reason = d.editorialHoldReason === 'private-editorial-copy-not-public'
      ? tr(lang, 'النص يتضمن مادة رأي/سخرية خاصة أو تشخيصاً داخلياً، لذلك لم يُدرج في الخبر العام.', 'The text contains private opinion/satire or an internal diagnostic, so it was excluded from public news.')
      : d.editorialHoldReason === 'owner-private-editorial-note'
        ? tr(lang, 'المسودة موقوفة للمراجعة اليدوية؛ لم يُنشر شيء تلقائياً.', 'The draft is held for human review; nothing was auto-published.')
      : d.editorialHoldReason === 'opinion-analysis-requires-explicit-owner-publish'
        ? tr(lang, 'النقد/السخرية لا يدخلان النشر الآلي؛ لا يُنشر النص المختار إلا إذا ضغط المالك صراحةً «نشر».', 'Opinion/satire never enters automatic publishing; the selected copy is public only if the owner explicitly taps Publish.')
        : tr(lang, 'تعذّر التحقق الآلي المحافظ من حفظ الوقائع والإسناد والمكان والأرقام والسياق؛ راجع المصدر قبل القرار.', 'The conservative check could not confirm that facts, attribution, place, numbers, and context were preserved; review the source before deciding.');
    lines.push('', tr(lang, '⚖️ <b>موقوفة للمراجعة التحريرية:</b>', '⚖️ <b>Held for editorial review:</b>'), esc(reason));
  }
  const condemnLine = condemnationText(d.condemn);
  if (condemnLine) lines.push('', `⚖️ <b>${tr(lang, 'إدانة', 'Condemnation')}:</b> ${esc(condemnLine)}`);
  lines.push(`🕒 ${tr(lang, 'أول خبر', 'First report')}: ${esc(clock(d.ts || d.created))} ${tr(lang, '(بتوقيت دمشق)', '(Damascus time)')}`);
  if (d.rule) lines.push(tr(lang, '⚙️ <i>تصنيف آلي بسيط (الذكاء الاصطناعي غير متاح حالياً) — راجع النوع والمكان.</i>', '⚙️ <i>Simple automatic classification (AI unavailable) — check type and place.</i>'));
  return lines.join('\n');
}
function cardKb(d, lang = 'ar', chatId = null) {
  const kb = new InlineKeyboard()
    .text(tr(lang, '✅ نشر', '✅ Publish'), 'nw:p:' + d.id).text(tr(lang, '❌ تجاهل', '❌ Ignore'), 'nw:x:' + d.id).row()
    .text(tr(lang, '🏷 تغيير نوع هذا الخبر', '🏷 Change this story’s type'), 'nw:t:' + d.id).text(tr(lang, '✏️ تعديل قبل النشر', '✏️ Edit first'), 'nw:e:' + d.id).row()
    .text(tr(lang, '🪄 صياغة صحفية', '🪄 Rewrite professionally'), 'nw:rw:' + d.id)
    .text(tr(lang, '🔎 تحقق من سجل القناة', '🔎 Check channel records'), 'nw:c:' + d.id);
  if (ownerIdsU().includes(Number(chatId)) && NEWS_TYPES.includes(d.type)) kb.row()
    .text(tr(lang, '🧭 نقد حاد موثّق', '🧭 Sharp fact-based critique'), 'nw:op:' + d.id)
    .text(tr(lang, '🎭 محاكاة ساخرة خيالية', '🎭 Fictional satire'), 'nw:sa:' + d.id);

  if (d.originalHeadline && d.originalHeadline !== d.headline) {
    kb.row().text(tr(lang, '↩️ استعادة الصياغة الأصلية', '↩️ Restore original wording'), 'nw:ro:' + d.id);
  }

  if (d.type === 'political') kb.row().text(tr(lang, '🏛 الفئة السياسية', '🏛 Political category'), 'nw:pc:' + d.id);
  // Telegram refuses a whole message when one button has an empty text: the extra row only for drones
  if (d.type === 'uav') kb.row().text(intenseLabel(d, lang), 'nw:i:' + d.id);
  if (d.type === 'helicopter') kb.row().text(helicopterLabel(d, lang), 'nw:hi:' + d.id);
  kb.row().text(tr(lang, condemnationKey(d.condemn) ? '⚖️ إدانة ✓' : '⚖️ إدانة', condemnationKey(d.condemn) ? '⚖️ Condemnation ✓' : '⚖️ Condemnation'), 'nw:cd:' + d.id);
  return kb;
}
/** Variant picker for the monitor draft card (nw:cd: / nw:cdv: callbacks). */
function condemnKb(d, lang = 'ar') {
  const kb = new InlineKeyboard();
  for (const key of CONDEMNATION_KEYS) {
    const c = CONDEMNATIONS[key];
    kb.text(`${d.condemn === key ? '✓ ' : ''}${tr(lang, c.label_ar, c.label_en)}`, `nw:cdv:${d.id}:${key}`).row();
  }
  if (condemnationKey(d.condemn)) kb.text(tr(lang, '🗑 إزالة الإدانة', '🗑 Remove condemnation'), `nw:cdv:${d.id}:off`).row();
  return kb.text(tr(lang, '↩️ رجوع', '↩️ Back'), 'nw:b:' + d.id);
}
function rewritePreviewText(d, lang = 'ar') {
  const preview = d.aiRewritePreview || {};
  let source = String(preview.sourceText || d.sourceText || d.headline || '').slice(0, 500);
  const original = String(preview.originalHeadline || d.originalHeadline || d.headline || '');
  const render = (excerpt) => [
    preview.mode === 'opinion'
      ? tr(lang, preview.applied ? '🧭 <b>نقد/تحليل اختاره المالك — النشر يتطلب ضغط «نشر»</b>' : '🧭 <b>معاينة نقد/تحليل خاصة — لم تُعتمد ولم تُنشر</b>', preview.applied ? '🧭 <b>Owner-selected critique/analysis — publishing still requires Publish</b>' : '🧭 <b>Private critical-analysis preview — not applied or published</b>')
      : preview.mode === 'satire'
        ? tr(lang, preview.applied ? '🎭 <b>محاكاة ساخرة اختارها المالك — النشر يتطلب ضغط «نشر»</b>' : '🎭 <b>معاينة محاكاة ساخرة خيالية خاصة — ليست خبراً</b>', preview.applied ? '🎭 <b>Owner-selected satire — publishing still requires Publish</b>' : '🎭 <b>Private fictional-satire preview — not news</b>')
      : tr(lang, '🪄 <b>معاينة صياغة صحفية محايدة — لم تُعتمد ولم تُنشر</b>', '🪄 <b>Neutral news rewrite preview — not applied or published</b>'),
    '',
    `📝 <b>${tr(lang, 'عنوان المسودة الحالي', 'Current draft headline')}:</b> ${esc(original)}`,
    `📄 <b>${tr(lang, 'النص الأصلي من المصدر (مقتطف)', 'Original source text (excerpt)')}:</b> ${esc(excerpt)}`,
    `✨ <b>${tr(lang, 'المقترح', 'Suggestion')}:</b> ${esc(preview.text || '')}`,
    preview.manuallyEdited ? tr(lang, '🖊 عُدلت الصياغة يدوياً في هذه المعاينة الخاصة.', '🖊 Wording manually edited in this private preview.') : null,
    '',
    preview.mode === 'opinion'
      ? tr(lang, 'هذه ليست صياغة خبرية محايدة ولا تدخل النشر الآلي. يمكن نشرها فقط بعد اعتماد المالك ثم ضغطه صراحةً «نشر».', 'This is not neutral news copy and is never auto-published. It can be published only after the owner applies it and explicitly taps Publish.')
      : preview.mode === 'satire'
        ? tr(lang, 'هذه محاكاة خيالية موسومة بوضوح وليست خبراً، ولا تدخل النشر الآلي. يمكن نشرها فقط بعد اعتماد المالك ثم ضغطه صراحةً «نشر».', 'This is clearly labeled fictional satire, not news, and is never auto-published. It can be published only after the owner applies it and explicitly taps Publish.')
        : tr(lang, 'راجع الوقائع والمصدر بنفسك. هذه صياغة خبرية محايدة؛ لن يتغير نص المسودة إلا بعد اختيار اعتماد الصياغة.', 'Verify the facts and source yourself. This is neutral news wording; the draft changes only if you choose to apply it.'),
  ].join('\n');
  let text = render(source);
  while (text.length > 3900 && source.length > 80) { source = source.slice(0, Math.max(80, source.length - 80)); text = render(source); }
  return text;
}
function rewritePreviewKb(d, lang = 'ar') {
  const preview = d.aiRewritePreview || {};
  if (d.privateEditorialEdit?.mode === 'opinion' && d.privateEditorialEdit?.draftId === d.id) {
    return new InlineKeyboard().text(tr(lang, '❌ إلغاء تعديل الكلمات', '❌ Cancel word edits'), 'nw:oc:' + d.id);
  }
  if (d.aiRewritePreview?.applied) {
    if (['opinion', 'satire'].includes(d.aiRewritePreview.mode)) {
      return new InlineKeyboard()
        .text(tr(lang, '🗑 حذف النص الخاص', '🗑 Delete private text'), 'nw:ro:' + d.id)
        .text(tr(lang, '↩️ رجوع للمسودة', '↩️ Back to draft'), 'nw:rr:' + d.id);
    }
    return new InlineKeyboard()
      .text(tr(lang, '↩️ استعادة الأصل', '↩️ Restore original'), 'nw:ro:' + d.id)
      .text(tr(lang, '↩️ رجوع للمسودة', '↩️ Back to draft'), 'nw:rr:' + d.id);
  }
  const kb = new InlineKeyboard();
  if (preview.mode === 'opinion') kb.text(tr(lang, '✏️ تعديل كلمات الرأي يدوياً', '✏️ Edit opinion wording'), 'nw:oe:' + d.id).row();
  return kb
    .text(tr(lang, '✅ اعتماد الصياغة', '✅ Apply wording'), 'nw:ra:' + d.id)
    .text(tr(lang, '↩️ إبقاء النص الحالي', '↩️ Keep current wording'), 'nw:rr:' + d.id);
}
const OPINION_LABEL = /^(رأي\s*\/\s*تحليل|رأي|تحليل)\s*[:：—-]\s*/u;
function applyPrivateOpinionReplacements(baseText, instructions) {
  const base = String(baseText || '').trim();
  const label = OPINION_LABEL.exec(base);
  if (!label) return { ok: false, reason: 'not-opinion' };
  const edits = String(instructions || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!edits.length || edits.length > 5) return { ok: false, reason: 'edit-count' };
  let body = base.slice(label[0].length);
  for (const edit of edits) {
    const match = edit.match(/^(.+?)\s*=>\s*(.+)$/u);
    if (!match) return { ok: false, reason: 'format' };
    const from = match[1].trim();
    const to = match[2].trim();
    if (!from || !to || from === to || from.length > 80 || to.length > 80) return { ok: false, reason: 'replacement' };
    const count = body.split(from).length - 1;
    if (count !== 1) return { ok: false, reason: count ? 'ambiguous' : 'not-found' };
    body = body.replace(from, to);
  }
  const candidate = `${label[0]}${body}`;
  const numbers = (value) => [...String(value).matchAll(/\p{N}+(?:[.,٫]\p{N}+)*/gu)].map((match) => match[0]);
  if (JSON.stringify(numbers(candidate)) !== JSON.stringify(numbers(base))) return { ok: false, reason: 'numbers' };
  try {
    const finalized = finalizeRewriteOutput(candidate, 'opinion');
    const finalizedLabel = OPINION_LABEL.exec(finalized);
    if (!finalizedLabel) return { ok: false, reason: 'label' };
    const text = `${label[0]}${finalized.slice(finalizedLabel[0].length)}`;
    if (!text.startsWith(label[0]) || text.length > 280 || JSON.stringify(numbers(text)) !== JSON.stringify(numbers(base))) return { ok: false, reason: 'label' };
    return { ok: true, text };
  } catch {
    return { ok: false, reason: 'unsafe' };
  }
}
const helicopterAuto = (text) => /مروحيتين|مروحيات|مروحيتا|مروحيتان|مروحيات|عدة مروحيات|طائرات مروحية|helicopters|multiple helicopters|two helicopters|intensive/i.test(String(text || ''));
const helicopterOn = (d) => (typeof d.intense === 'boolean' ? d.intense : helicopterAuto(`${d.headline || ''} ${d.body || ''}`));
const helicopterLabel = (d, lang) => lang === 'en' ? `🚁 Intensive: ${helicopterOn(d) ? '✅ two helicopters' : '⬜ one helicopter'}` : `🚁 تحليق مكثف: ${helicopterOn(d) ? '✅ مروحيتان' : '⬜ مروحية واحدة'}`;
const intenseOn = (d) => (typeof d.intense === 'boolean' ? d.intense : droneAuto(d.headline) > 1);
const intenseLabel = (d, lang) => (lang === 'en' ? `${ALERT_TYPES.uav.emoji} Intensive flight: ${intenseOn(d) ? '✅ on' : '⬜ off'}` : `${ALERT_TYPES.uav.emoji} تحليق مكثف: ${intenseOn(d) ? '✅ مفعّل' : '⬜ لا'}`);
const quoteChoice = (label, lang) => lang === 'en' ? `“${label}”` : `«${label}»`;
function typeKb(d, lang = 'ar', namespace = 'nw') {
  const cb = (key) => `${namespace}:${key}:${d.id}`;
  const kb = new InlineKeyboard();
  EDIT_TYPE_MENU.forEach((item, i) => {
    if (item.type) {
      const selected = d.type === item.type ? '• ' : '';
      kb.text(`${selected}${quoteChoice(alertButtonLabel(item.type, lang), lang)}`, `${cb('s')}:${item.type}`);
    } else {
      const types = EDIT_TYPE_GROUPS[item.group] || [];
      const selected = types.includes(d.type) ? '• ' : '';
      kb.text(`${selected}${quoteChoice(`${newsGroupLabel(item.group, lang)} (${types.length})`, lang)}`, `${cb('tg')}:${item.group}`);
    }
    if (i % 2 === 1 && i < EDIT_TYPE_MENU.length - 1) kb.row();
  });
  if (EDIT_TYPE_MENU.length % 2 === 1) kb.row();
  return kb.text(tr(lang, '↩️ رجوع للخبر', '↩️ Back to draft'), cb('b'));
}
function typeGroupKb(d, group, lang = 'ar', namespace = 'nw') {
  const cb = (key) => `${namespace}:${key}:${d.id}`;
  const kb = new InlineKeyboard();
  const types = EDIT_TYPE_GROUPS[group] || [];
  if (group === 'incursion') {
    INCURSION_TYPE_CHOICES.forEach((choice, i) => {
      const selected = d.type === 'military_incursion' && (d.incursionKind || 'general') === choice.kind ? '• ' : '';
      const label = choice.kind === 'barrier' ? `🚧 ${choice[lang]}` : choice[lang];
      kb.text(`${selected}${quoteChoice(label, lang)}`, `${cb('si')}:${choice.kind}`);
      if (i % 2 === 1 && i < INCURSION_TYPE_CHOICES.length - 1) kb.row();
    });
  } else {
    types.forEach((type, i) => {
      // military_incursion routes to the incursion kind picker, not a plain
      // type set — same contract as the reporting bot's 'mi' entry point.
      const cbk = type === 'military_incursion' ? `${cb('tg')}:incursion` : `${cb('s')}:${type}`;
      kb.text(`${d.type === type ? '• ' : ''}${quoteChoice(alertButtonLabel(type, lang), lang)}`, cbk);
      if (i % 2 === 1 && i < types.length - 1) kb.row();
    });
  }
  const count = group === 'incursion' ? INCURSION_TYPE_CHOICES.length : types.length;
  if (count % 2 === 1 || count === 0) kb.row();
  return kb.text(tr(lang, '↩️ مجموعات الأنواع', '↩️ Type groups'), cb('tb'))
    .row().text(tr(lang, '↩️ رجوع للخبر', '↩️ Back to draft'), cb('b'));
}
function politicalCategoryKb(d, lang = 'ar', namespace = 'nw') {
  const kb = new InlineKeyboard();
  Object.entries(POLITICAL_CATEGORIES).forEach(([key, value], i) => {
    const callback = namespace === 'nw' ? `nw:ps:${d.id}:${key}` : `nwp:pc:${d.id}:${key}`;
    const label = lang === 'en' ? `“${value.en}”` : `«${value.ar}»`;
    kb.text(`${d.politicalCategory === key ? '• ' : ''}${value.emoji} ${label}`, callback);
    if (i % 2 === 1) kb.row();
  });
  return kb.row().text(tr(lang, '↩️ رجوع', '↩️ Back'), `${namespace}:b:${d.id}`);
}
async function sendCards(d, only = null) {
  const a = api();
  if (!a) return 0;
  d.cards ||= [];
  let n = 0;
  for (const uid of only ? [only] : reviewerIds()) {
    const lang = langOfId(uid);
    try {
      const m = await a.sendMessage(uid, cardText(d, lang), { parse_mode: 'HTML', reply_markup: cardKb(d, lang, uid), link_preview_options: { is_disabled: true }, disable_notification: nightActive(), _keep: 'c' });
      d.cards.push([uid, m.message_id]); n++;
    } catch (e) { console.warn('[news] card not delivered to', uid, e.description || e.message); }
  }
  return n;
}
async function refreshCards(d) {
  const a = api();
  if (!a) return;
  for (const [chat, mid] of d.cards || []) {
    const lang = langOfId(chat);
    try { await a.editMessageText(chat, mid, cardText(d, lang), { parse_mode: 'HTML', reply_markup: cardKb(d, lang, chat), link_preview_options: { is_disabled: true } }); } catch { /* not modified / gone */ }
  }
}
/** Add current review controls to existing pending cards without changing their text or creating messages. */
export async function refreshPendingCardKeyboards() {
  const a = api();
  if (!a) return;
  for (const d of Object.values(newsState().drafts)) {
    if (d.status !== 'pending' || d.test) continue;
    for (const [chat, mid] of d.cards || []) {
      try { await a.editMessageReplyMarkup(chat, mid, { reply_markup: cardKb(d, langOfId(chat), chat) }); } catch { /* not modified / gone */ }
    }
  }
}
async function closeCards(d, keep = null, closeMedia = false) {
  const a = api();
  for (const [chat, mid] of d.cards || []) {
    setKeep('admin', chat, mid, false);
    if (keep && keep[0] === chat && keep[1] === mid) continue;
    if (!a) continue;
    try { await a.deleteMessage(chat, mid); } catch {
      try { await a.editMessageText(chat, mid, '✔️', {}); } catch { /* ignore */ }
    }
  }
  if (closeMedia) {
    for (const [chat, mid] of d.mediaCards || []) { setKeep('admin', chat, mid, false); if (a) try { await a.deleteMessage(chat, mid); } catch { /* best effort */ } }
    d.mediaCards = [];
  }
  d.cards = keep ? (d.cards || []).filter(([c, m]) => c === keep[0] && m === keep[1]) : [];
}
// ---------------------------------------------------------------- 🌙 night auto-publish + owner notice (undo)
const postUrl = (mid) => (mid && String(config.channel || '').startsWith('@') ? `https://t.me/${config.channel.slice(1)}/${mid}` : '');
function publishedLinksKb(d, alert, lang = 'ar', includeWhatsApp = false) {
  const kb = new InlineKeyboard();
  const alertId = alert?.id || d.alertId;
  const map = alertId && R.H?.mapUrl ? R.H.mapUrl(alertId, lang) : '';
  const post = postUrl(alert?.channel_message_id || d.postId);
  if (map) kb.url(tr(lang, '🗺 على الخريطة', '🗺 On the map'), map);
  if (post) kb.url(tr(lang, '📣 المنشور', '📣 Post'), post);
  if (includeWhatsApp && map) {
    const shareText = [d.publishedHeadline || d.headline || d.title || '', d.body || d.details || '', map].filter(Boolean).join('\n\n');
    kb.row().url(tr(lang, '🟢 فتح واتساب للمشاركة اليدوية', '🟢 Open WhatsApp to share manually'), `https://wa.me/?text=${encodeURIComponent(shareText)}`);
  }
  return kb;
}
function noticeText(d, lang = 'ar') {
  const head = d.undone
    ? tr(lang, '↩️ <b>تم التراجع — حُذف من القناة والخريطة</b>', '↩️ <b>Undone — removed from the channel and the map</b>')
    : d.autoMode === 'day'
      ? tr(lang, `⏱ <b>نُشر تلقائياً بعد دقيقتين لعدم المراجعة</b> · ${esc(hhmm(d.autoAt || Date.now()))}`, `⏱ <b>Auto-published after 2 minutes without review</b> · ${esc(hhmm(d.autoAt || Date.now()))}`)
      : tr(lang, `🌙 <b>نُشر تلقائياً (النشر الليلي)</b> · ${esc(hhmm(d.autoAt || Date.now()))}`, `🌙 <b>Auto-published (night mode)</b> · ${esc(hhmm(d.autoAt || Date.now()))}`);
  return [head, ...cardText(d, lang).split('\n').slice(1)].join('\n');
}
function noticeKb(d, lang = 'ar') {
  if (d.undone) return undefined;
  const kb = publishedLinksKb(d, { id: d.alertId, channel_message_id: d.postId }, lang, true);
  kb.row().text(tr(lang, '🏷 تغيير نوع الخبر', '🏷 Change news type'), 'nw:pt:' + d.id);
  kb.row().text(tr(lang, '✏️ تعديل صيغة الخبر', '✏️ Edit story format'), 'nw:ed:' + d.id);
  return kb.row().text(tr(lang, '↩️ تراجع (حذف من القناة والخريطة)', '↩️ Undo (remove from channel + map)'), 'nw:u:' + d.id);
}
function channelPublishedDuplicateDraft(d) {
  const candidate = {
    type: d.type, politicalCategory: d.politicalCategory, ts: d.ts || d.created,
    headline: d.headline, geo: geoOf(locsOf(d.loc, d.extra)),
  };
  return knownEvents(12).find((known) => {
    if (known.draftId === d.id || !known.alertId || !sameIncident(candidate, known)) return false;
    const alert = store.getAlert(known.alertId);
    if (!alert?.channel_message_id) return false;
    return { ...known, channelMessageId: alert.channel_message_id };
  }) || null;
}
function channelCheckText(duplicate, lang = 'ar') {
  if (duplicate) {
    const details = [
      duplicate.headline ? `📝 ${esc(duplicate.headline)}` : '',
      duplicate.where ? `📍 ${esc(duplicate.where)}` : '',
      duplicate.ts ? `🕒 ${esc(clock(duplicate.ts))}` : '',
    ].filter(Boolean).join('\n');
    return tr(lang,
      `✅ <b>عُثر على مطابقة في سجل منشورات البوت</b>\n${details}\nالإجراء المقترح: تجاهل المسودة؛ المنشور الموجود لن يُحذف. المطابقة ضمن سجل البوت وليست بحثاً شاملاً في القناة.`,
      `✅ <b>A matching post was found in the bot's records</b>\n${details}\nRecommended: ignore this draft; the existing post will not be deleted. This is a bot-record match, not a full channel-history search.`);
  }
  return tr(lang,
    '🟡 <b>لم أجد تطابقاً في سجل البوت خلال نافذة الفحص (12 ساعة)</b>\nهذا لا يثبت أن الخبر غير منشور: الفحص لا يقرأ تاريخ القناة كاملاً ولا يشمل المنشورات التي أُضيفت خارج البوت. راجع القناة يدوياً قبل نشر نسخة أخرى.',
    '🟡 <b>No match in the bot records within the 12-hour check window</b>\nThis does not prove the story is unpublished: the check cannot search the full channel history or posts added outside the bot. Manually check the channel before publishing another copy.');
}
function channelCheckKeyboard(d, duplicate, lang = 'ar') {
  const kb = new InlineKeyboard();
  if (duplicate) {
    const url = postUrl(duplicate.channelMessageId);
    if (url) kb.url(tr(lang, '🔗 فتح المنشور الموجود', '🔗 Open existing post'), url).row();
    kb.text(tr(lang, '❌ تجاهل المسودة', '❌ Ignore draft'), 'nw:x:' + d.id);
  } else {
    kb.text(tr(lang, '✅ نشر الخبر', '✅ Publish this story'), 'nw:p:' + d.id);
    kb.text(tr(lang, '❌ تجاهل', '❌ Ignore'), 'nw:x:' + d.id);
  }
  return kb;
}
// Entity fallback for draft dedup (owner 2026-11-20, الحمادي duplicate): the same
// story retold by another source with a different place emphasis (a death announced
// at a Damascus hospital vs the accident site in al-Tayyana) fails sameIncident on
// geography and gets drafted twice. Person-name runs survive rewording — match them
// against pending drafts with a compatible type.
function entityDuplicateDraft(candType, text) {
  // Only PERSON-name runs may entity-match (owner 2026-11-20): place/event runs
  // like «عبوة ناسفة درعا» false-merge two different incidents in one town.
  const runs = personNameRuns(text).filter((r) => r.length >= 2);
  const DEATH_PAIR = new Set(['death', 'martyrdom']);
  const n = newsState();
  return knownEvents(12).find((k) => {
    if (k.kind !== 'draft' || !k.draftId) return false;
    const d2 = n.drafts[k.draftId];
    if (!d2 || d2.status !== 'pending') return false;
    if (d2.type !== candType && !(DEATH_PAIR.has(d2.type) && DEATH_PAIR.has(candType))) return false;
    const other = `${d2.headline || ''}\n${d2.body || ''}\n${d2.sourceText || ''}`;
    if (distinctPersons(text, other)) return false;
    const hay = normTokens(other);
    return runs.some((run) => runHit(run, hay, 2));
  }) || null;
}

function knownDuplicateDraft(d) {
  const candidate = {
    type: d.type, politicalCategory: d.politicalCategory, ts: d.ts || d.created,
    headline: d.headline, geo: geoOf(locsOf(d.loc, d.extra)),
  };
  return knownEvents(12).find((known) => known.draftId !== d.id && sameIncident(candidate, known)) || null;
}
// ------------------------------------------------------------ self-echo guard
// Other channels routinely repost OUR OWN channel posts (or the same wire
// copy we already published) many hours — often a full day — later. By then
// the incident matcher above has forgotten the story (knownEvents covers
// 12h; the per-type windows are ≤6h), so the echo arrives looking brand new
// and gets drafted and published a second time. The echo log keeps the full
// text of everything we published for 96h and matches by content instead:
// same type family (political: same category), compatible geography, and
// ≥0.5 token overlap with the published text.
const ECHO_HOURS = 96;
function selfEchoOf(cand, texts) {
  const log = newsState().echoLog;
  if (!Array.isArray(log) || !log.length) return null;
  const since = Date.now() - ECHO_HOURS * H_MS;
  let best = null;
  for (const e of log) {
    if (!e || e.ts < since || !e.text) continue;
    if (cand.type === 'political' || e.type === 'political') {
      if (cand.type !== 'political' || e.type !== 'political' || !cand.politicalCategory || cand.politicalCategory !== e.politicalCategory) continue;
    } else if (!sameFamily(cand.type, e.type) && !crossTypeRaidDuplicate(cand, e, texts, e.text)) continue;
    if (!cand.geo.none && !e.geo.none && !near(cand.geo, e.geo)) continue;
    const sim = Math.max(textSim(texts, e.text), textSim(cand.headline, e.text));
    if (sim >= 0.5 && (!best || sim > best.sim)) best = { id: e.id, sim };
  }
  return best;
}
async function suppressDuplicateDraft(d, duplicate, by = 0) {
  if (!d || d.status !== 'pending' || !duplicate) return false;
  d.status = 'duplicate';
  d.duplicateOf = duplicate.draftId || duplicate.alertId || duplicate.kind || 'known-event';
  d.duplicateMarkedAt = Date.now();
  if (by) d.by = by;
  newsState().stats.dupes++;
  save();
  await store.flushBackup(true);
  await closeCards(d);
  return true;
}
// ------------------------------------------------ final-text duplicate guard
// A draft-level check compares WORKING headlines, which diverge when two sources
// word the same incident differently — so two drafts of one story can both pass it
// and both reach the channel seconds apart. This guard runs on the FINAL cleaned
// publication text (after toBotDraft) against everything the bot actually published
// in the last 96h (echo log). Two matchers:
// 1) text: token similarity of the final copy — catches the same story with light edits;
// 2) entity: a contiguous run of name-like tokens (person/place names survive
//    rewording; news vocabulary is stoplisted so institutions alone never match),
//    with compatible geography — catches the same story retold by another agency.
const NEWS_WORDS = new Set(('قوى قوات سلطات امن الامن امني امنيه داخلي داخليه خارجيه مصدر مصادر محليه رسمي رسميه افاد افادت بحسب وفق وفقا خلال بحق بتهمه بتهمة مدينه محافظه ريف بلده اهالي شمال جنوب شرق غرب وسط امس اليوم عام اعلن اعلنت اكد اكدت نظام عهد سابق بائد عناصر مسلحه مسلحين جامعه متظاهرين متظاهري انتهاكات مساعده مذكره هيئه عداله انتقاليه اعتقال اعتقل اعتقلت تعتقل اوقفت توقيف القاء القبض قبض يلقي وزير وزاره رئيس حكومه مجلس لجنه بيان اصابه اصابات قتلى جرحى انفجار سياره مفخخه ساحه حريق اضرار ماديه مدنيين مخدرات تجاره مطلوب مطلوبين احد اخر عثر حمله دهم مداهمه اداره مكافحه ارهاب القت هنأ مخطط مجزره كمين').split(' '));
const normTokens = (text) => N(String(text || '')).split(' ').map((w) => (w.startsWith('ال') && w.length > 4 ? w.slice(2) : w)).filter((w) => w.length >= 3);
function nameRuns(text) {
  const runs = [];
  let cur = [];
  for (const w of normTokens(text)) {
    if (NEWS_WORDS.has(w) || /^\d+$/.test(w)) { if (cur.length) runs.push(cur); cur = []; }
    else cur.push(w);
  }
  if (cur.length) runs.push(cur);
  return runs;
}
function runHit(run, eTokens, need) {
  const hay = ' ' + eTokens.join(' ') + ' ';
  for (let L = Math.min(run.length, 5); L >= need; L--)
    for (let i = 0; i + L <= run.length; i++)
      if (hay.includes(' ' + run.slice(i, i + L).join(' ') + ' ')) return run.slice(i, i + L).join(' ');
  return null;
}
// Person-name extraction (owner 2026-11-20, رسلان/زيدان): two arrests in the same
// town and the same case are DIFFERENT stories when the named people differ. Names
// follow report verbs («القبض على أحمد…», «مقتل أنور…»); generic roles and news
// vocabulary are skipped, and a verb followed directly by event words («مقتل شاب
// جراء انفجار…») yields no name at all.
// NEWS_WORDS was written with Arabic spelling (قوى); normalizeArabic folds ى→ي, so
// the stoplist must be compared in normalized form or every ى-word leaks through.
const NEWS_WORDS_N = new Set([...NEWS_WORDS].map((w) => N(w)));
// Known Syrian place names are never person names («اعتقال — حلب» is type + city).
// Two tiers, single-token names only (every token of «تل أحمد» would brand the very
// common first name أحمد a place and gut extraction):
//  - strong (governorates + cities rank<=2, districts/subdistricts): skipped even at
//    the start of a name window — nobody in these alerts is named حلب;
//  - weak (other rank<=4 towns only): only ends a run already collecting, never
//    blocks a name from starting. Rank-5 villages and alt names are skipped: their
//    arbitrary tokens collide with first names (طلال is an alt of اسكوران).
const STRONG_PLACE_N = new Set();
const WEAK_PLACE_N = new Set();
{
  const add = (name, strong) => {
    const w = normTokens(name);
    if (w.length !== 1 || NEWS_WORDS_N.has(w[0])) return;
    (strong ? STRONG_PLACE_N : WEAK_PLACE_N).add(w[0]);
  };
  for (const pl of places) { if (pl.rank > 4) continue; const strong = pl.rank <= 2; add(pl.ar, strong); add(pl.en, strong); }
  for (const g of governorates) { add(g.ar, true); add(g.en, true); }
  for (const d of districts) { add(d.ar, true); add(d.en, true); }
  for (const sd of subdistricts) { add(sd.ar, true); add(sd.en, true); }
}
const PERSON_LEADS = new Set(['قبض', 'اعتقال', 'اعتقل', 'اعتقلت', 'توقيف', 'اوقفت', 'مقتل', 'اغتيال', 'اغتيل', 'وفاه', 'مصرع', 'استشهاد']);
const PERSON_SKIP = new Set(['مجرم', 'مجرمه', 'شاب', 'شابه', 'شخص', 'مواطن', 'مواطنه', 'مدعو', 'مدعوه', 'جراء', 'بسبب', 'علي']);
function personNameRuns(text) {
  const toks = normTokens(text);
  const runs = [];
  for (let i = 0; i < toks.length; i++) {
    if (!PERSON_LEADS.has(toks[i])) continue;
    const names = [];
    for (let j = i + 1; j < toks.length && names.length < 3; j++) {
      const w = toks[j];
      if (PERSON_SKIP.has(w)) continue;
      if (NEWS_WORDS_N.has(w) || /^\d+$/.test(w)) break;
      if (STRONG_PLACE_N.has(w) || (WEAK_PLACE_N.has(w) && names.length)) { if (names.length) break; continue; }
      names.push(w);
    }
    if (names.length) runs.push(names);
  }
  return runs;
}
// Both texts name people after report verbs and the names share no token: distinct
// stories, no matter how similar the wording or how close the geography.
function distinctPersons(aText, bText) {
  const a = new Set(personNameRuns(aText).flat());
  const b = new Set(personNameRuns(bText).flat());
  if (!a.size || !b.size) return false;
  for (const w of a) if (b.has(w)) return false;
  return true;
}
const ENTITY_DUP_HOURS = 48;
function finalPublishDuplicate(d, pub) {
  const log = newsState().echoLog;
  if (!Array.isArray(log) || !log.length) return null;
  const cand = { type: d.type, politicalCategory: d.politicalCategory, ts: d.ts || d.created, headline: pub?.headline || d.headline, geo: geoOf(locsOf(d.loc, d.extra)) };
  const text = `${pub?.headline || ''}\n${pub?.body || ''}`.trim();
  if (!text) return null;
  const candRuns = personNameRuns(text).filter((run) => run.length >= 3);
  const since = Date.now() - ECHO_HOURS * H_MS;
  const entitySince = Date.now() - ENTITY_DUP_HOURS * H_MS;
  let best = null;
  for (const e of log) {
    if (!e || e.ts < since || !e.text) continue;
    if (d.alertId && e.id === d.alertId) continue; // our own already-published copy of THIS draft
    if (cand.type === 'political' || e.type === 'political') {
      if (cand.type !== 'political' || e.type !== 'political' || !cand.politicalCategory || cand.politicalCategory !== e.politicalCategory) continue;
    } else if (!sameFamily(cand.type, e.type) && !crossTypeRaidDuplicate(cand, e, text, e.text)) continue;
    const geoKnown = !cand.geo.none && !e.geo.none;
    if (geoKnown && !near(cand.geo, e.geo)) continue;
    if (distinctPersons(text, e.text)) continue; // same case/town, different named people (رسلان vs زيدان)
    const sim = Math.max(textSim(text, e.text), textSim(cand.headline, e.text));
    if (sim >= 0.45) { if (!best || sim > best.sim) best = { id: e.id, sim, via: 'text' }; continue; }
    if (e.ts < entitySince) continue;
    const eTok = normTokens(e.text);
    const need = geoKnown ? 2 : 3; // without location support the bar is a full name
    for (const run of candRuns) {
      const hit = run.length >= need && runHit(run, eTok, need);
      if (hit) { best = { id: e.id, sim, via: 'entity', run: hit }; break; }
    }
  }
  return best;
}
// ------------------------------------------------ post-publish landed-dup sweep
// The pre-publish guard compares against the echo log BEFORE this draft publishes;
// two drafts of one story published seconds apart can both pass it (neither is in
// the log yet). Owner rule (2026-11-20): a duplicate that still lands must be
// deleted immediately and automatically. This runs right AFTER a news publish: if
// the log now holds an OLDER copy of the same story, this new alert is the dup —
// delete it everywhere (map + channel post) and mark the draft duplicate.
async function autoDeleteLandedDuplicate(d, publicationDraft, alertId) {
  if (!d || !alertId) return null;
  const landed = finalPublishDuplicate({ ...d, alertId }, publicationDraft);
  if (!landed || landed.id === alertId) return null;
  try {
    const { deleteAlertEverywhere } = await import('./bot.js');
    await deleteAlertEverywhere(api(), alertId);
  } catch (e) {
    console.error('[news] landed-dup delete failed', e.description || e.message);
  }
  d.status = 'duplicate'; d.duplicateOf = landed.id; d.duplicateMarkedAt = Date.now();
  newsState().stats.dupes++; save();
  await closeCards(d);
  console.log(`[news] auto-deleted landed duplicate alert ${alertId}: same story as published alert ${landed.id} (${landed.via})`);
  return landed;
}
async function nightPublish(d) {
  const mode = d?.autoMode === 'day' ? 'day' : 'night';
  const a = api();
  const eligible = mode === 'day' ? daytimeAutoEligible(d) : nightEligible(d);
  if (!a || !R.H?.publishDraft || !d || d.status !== 'pending' || !eligible) return false;
  const n = newsState();
  // pre-publish audit (owner request 2026-11-17): verify + correct the final draft before
  // anything automatic leaves the server. A failure is terminal for automation — the draft
  // is held for manual review under the same editorial-hold status line the card already
  // renders, and only new corroborating input (mergeInto) can earn it one re-audit.
  const audit = auditDraftForAutoPublish(d, mode);
  if (!audit.ok) {
    d.status = 'pending';
    d.editorialHold = true;
    d.editorialHoldReason = AUTO_AUDIT_HOLD_REASON;
    d.editorialHoldAt = Date.now();
    d.autoAudit = { ok: false, reason: audit.reason, mode, at: Date.now(), srcs: (d.srcs || []).length };
    d.dayAutoAt = null;
    delete d.autoMode;
    save();
    await store.flushBackup(true);
    await refreshCards(d);
    console.warn(`[news] auto-publish audit failed: ${d.id} (${audit.reason}) — held for manual review`);
    return false;
  }
  if (audit.corrected.length) {
    d.autoAudit = { ok: true, corrected: audit.corrected, mode, at: Date.now() };
    save();
    console.log(`[news] auto-publish audit corrected ${d.id}: ${audit.corrected.join(', ')}`);
  }
  let sourceCandidate;
  let editorial;
  try { sourceCandidate = sourceFirstCandidate(d); editorial = sourceFirstGate(d, sourceCandidate); }
  catch (e) { editorial = { ok: false, reason: e.message }; }
  if (!editorial.ok) {
    d.status = 'pending';
    d.editorialHold = true;
    d.editorialHoldReason = editorial.reason;
    d.editorialHoldAt = Date.now();
    d.dayAutoAt = null;
    delete d.autoMode;
    save();
    await store.flushBackup(true);
    await refreshCards(d);
    console.warn(`[news] automatic publication held for editorial review: ${d.id} (${editorial.reason})`);
    return false;
  }
  const duplicate = knownDuplicateDraft(d);
  if (duplicate) { await suppressDuplicateDraft(d, duplicate); return false; }
  let publicationDraft;
  try { publicationDraft = await automaticPublicDraft(d, sourceCandidate); }
  catch (e) {
    d.status = 'pending';
    if (mode === 'day') d.dayAutoAt = Date.now() + DAY_AUTO_DELAY_MS;
    save();
    console.error(`[news] ${mode} auto-publish draft preparation failed`, e.description || e.message);
    return false;
  }
  const finalDup = finalPublishDuplicate(d, publicationDraft);
  if (finalDup) {
    await suppressDuplicateDraft(d, { alertId: finalDup.id, kind: 'final-text' });
    console.log(`[news] ${mode} auto-publish blocked: final text matches published alert ${finalDup.id} (${finalDup.via})`);
    return false;
  }
  if (d.status !== 'pending') return false; // another reviewer/operator may have claimed it while preparing
  d.status = 'publishing'; save();
  let alert;
  try {
    alert = await R.H.publishDraft(a, publicationDraft, { id: 0, name: 'رصد تلقائي', via: mode === 'day' ? 'news-day-fallback' : 'news-night' });
  } catch (e) {
    d.status = 'pending';
    if (mode === 'day') d.dayAutoAt = Date.now() + DAY_AUTO_DELAY_MS;
    save();
    console.error(`[news] ${mode} auto-publish failed`, e.description || e.message);
    return false;
  }
  // A same-story alert that slipped through the pre-publish guard in a race is
  // deleted right away (map + channel post) — a duplicate never stays up.
  if (await autoDeleteLandedDuplicate(d, publicationDraft, alert?.id)) return false;
  d.status = 'published'; d.auto = true; d.autoMode = mode; d.autoAt = Date.now(); d.alertId = alert?.id; d.postId = alert?.channel_message_id || null; d.publishedHeadline = publicationDraft.headline || d.headline;
  n.stats.published++; n.stats.auto = (n.stats.auto || 0) + 1;
  save();
  await closeCards(d, null, true); await unlinkCapturedMedia(d.sourceMedia); // a draft that was waiting (single local source, then confirmed) leaves the chat
  d.notices = [];
  for (const uid of automaticMonitorRecipientIds()) {
    const lang = langOfId(uid);
    try {
      const m = await a.sendMessage(uid, noticeText(d, lang), { parse_mode: 'HTML', reply_markup: noticeKb(d, lang), link_preview_options: { is_disabled: true }, disable_notification: true, _keep: 'c' });
      d.notices.push([uid, m.message_id]);
    } catch (e) { console.warn('[news] night notice not delivered to', uid, e.description || e.message); }
  }
  save();
  console.log(`[news] ${mode.toUpperCase()} auto-published ${d.id}: ${d.type} -> alert ${d.alertId} post ${d.postId}`);
  return true;
}
async function dayAutoTick(now = Date.now()) {
  const n = newsState();
  if (!api() || !R.H?.publishDraft) return;
  let armedAny = false;
  for (const d of Object.values(n.drafts)) {
    // (Re)arm the 2-minute timer for eligible pending drafts that never received one:
    // drafts created overnight (the Damascus day gate was closed at creation, so
    // scheduleDayAuto could not arm them) or that became eligible only later. Arming is
    // the only new behaviour — scheduleDayAuto still refuses outside the day window,
    // for ineligible or held drafts, and never moves an existing deadline; a draft
    // armed here has by construction already waited since its card was sent.
    if (d.status === 'pending' && !Number.isFinite(d.dayAutoAt) && scheduleDayAuto(d, now)) armedAny = true;
    if (!dayAutoReady(d, now)) continue;
    d.autoMode = 'day';
    await nightPublish(d);
  }
  if (armedAny) save();
}
async function nightSummaryTick() {
  const n = newsState(); const g = n.night;
  if (!g.on || !g.summary) return;
  const a = api(); if (!a) return;
  const hm = hmNow(); const day = dayKey();
  const late = `${String(Math.min(23, Number(g.to.slice(0, 2)) + 4)).padStart(2, '0')}${g.to.slice(2)}`;
  if (g.sumDay === day || hm < g.to || hm >= late) return;
  g.sumDay = day; save();
  const since = Math.max(g.sumAt || 0, Date.now() - 16 * H_MS);
  const all = Object.values(n.drafts).filter((d) => !d.test);
  const items = all.filter((d) => d.auto && d.autoMode !== 'day' && d.autoAt > since).sort((x, y) => x.autoAt - y.autoAt);
  const held = all.filter((d) => !d.auto && d.created > since && inNightWindow(g, hhmm(d.created)) && d.status !== 'published').length;
  g.sumAt = Date.now(); save();
  for (const uid of automaticMonitorRecipientIds()) {
    const lang = langOfId(uid);
    const win = `${g.from}–${g.to}`;
    const lines = [];
    if (!items.length) lines.push(tr(lang, `🌙 <b>النشر الليلي (${win})</b>: ما نُشر شي تلقائياً هالليلة.`, `🌙 <b>Night mode (${win})</b>: nothing was auto-published tonight.`));
    else {
      lines.push(tr(lang, `🌙 <b>ملخص النشر الليلي (${win})</b> — نُشر تلقائياً ${items.length}:`, `🌙 <b>Night summary (${win})</b> — ${items.length} auto-published:`), '');
      for (const d of items) {
        const ty = typeOf(d.type); const u = postUrl(d.postId);
        const where = esc(whereOf(locsOf(d.loc, d.extra)));
        const link = d.undone ? tr(lang, ' <i>(تراجعت عنه)</i>', ' <i>(undone)</i>') : u ? ` · <a href="${esc(u)}">${tr(lang, 'المنشور', 'post')}</a>` : '';
        lines.push(`• ${esc(hhmm(d.autoAt))} — ${ty.emoji} ${esc(lang === 'en' ? ty.en : ty.ar)} — ${where}${link}`);
      }
    }
    if (held) lines.push('', tr(lang, `📝 ووصلك ${held} مسودة ما انتشرت تلقائياً (مصدر محلي واحد أو تصنيف غير مؤكد) — راجعها إذا لسا بوقتها.`, `📝 ${held} draft(s) were held for you (single local source or unsure classification).`));
    try { await a.sendMessage(uid, lines.join('\n'), { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, _keep: 'c' }); } catch (e) { console.warn('[news] night summary not delivered', e.description || e.message); }
  }
  console.log(`[news] night summary sent: ${items.length} item(s), ${held} held`);
}

/** A road's named city endpoints do not establish an incident at either city centre. */
function routePublicationGeography(d) {
  const source = String(d.sourceText || d.body || '');
  const route = source.match(/(?:طريق|أوتوستراد|اوتوستراد)\s+([^\s،.]+)\s*[-–—]\s*([^\s،.()]+)/u);
  if (!route) return { loc: d.loc, extra: d.extra || [] };
  const selected = locsOf(d.loc, d.extra);
  if (!selected.length || !selected.every((l) => l.scope === 'place' && (l.rank ?? 9) <= 2 && nameInText(l.name_ar, route[0]))) return { loc: d.loc, extra: d.extra || [] };
  return { loc: { ...locationFrom({}), name_ar: route[0], name_en: '' }, extra: [] };
}

/** the bot's normal draft (same as a hand-made alert) from a news draft */
export function toBotDraft(d, options = {}) {
  newsState();
  if (auditPlaceSuspect(d) || locsOf(d.loc, d.extra).some((l) => nonIncidentPlaceOnly(l.name_ar, d.sourceText || d.body || ''))) {
    throw new Error('publication-place-not-grounded-in-source');
  }
  const editorialSelection = options.editorialMode ? approvedOwnerEditorialCopy(d, options.ownerId) : null;
  if (options.editorialMode && (!editorialSelection || editorialSelection.mode !== options.editorialMode)) {
    throw new Error('The owner-selected editorial preview is stale or not approved for publication');
  }
  const geography = routePublicationGeography(d);
  const rawHeadline = editorialSelection?.text || d.headline;
  const rawBody = editorialSelection ? rawHeadline : d.body || rawHeadline;
  const safeDraft = {
    ...d, headline: rawHeadline,
    ...(editorialSelection ? { body: '', details: '', text: '', description: '', description_en: '' } : {}),
  };
  if (publicDraftCopyIssue(safeDraft, editorialSelection?.text)) throw new Error('Private editorial or internal review text cannot be converted to a public alert');
  const privateSourceNames = (d.srcs || []).map((source) => source?.name || '').filter(Boolean);
  const headline = options.preservePublishedCopy
    ? rawHeadline
    : cleanPublicNewsAttribution(rawHeadline, privateSourceNames);
  const body = options.preservePublishedCopy
    ? rawBody
    : cleanPublicNewsAttribution(rawBody, privateSourceNames);
  if (!headline) throw new Error('No public news copy remains after removing media attribution');
  const patrolText = N(`${headline || ''} ${editorialSelection ? '' : d.body || ''}`);
  const patrolForm = d.type === 'patrol' ? (/دوريات|دوريتين|patrols|multiple patrols/.test(patrolText) ? 'plural' : 'singular') : null;
  return {
    type: d.type, mode: 'publish', step: 'preview', ttlMin: typeOf(d.type).ttlMin, headline,
    // Full report text rides alongside the concise lead (details/text keep their
    // existing roles); owner-selected editorial previews never carry a body.
    ...(editorialSelection ? {} : { body }),
    ...(editorialSelection ? { publicEditorialTone: editorialSelection.mode, publicEditorialText: editorialSelection.text } : {}),
    location: geography.loc || locationFrom({}), extra: geography.extra || [],
    // ⚖️ Owner-attached condemnation rides as a variant key only; bot.js
    // (buildAlertInput) resolves the formula and appends it once at publish.
    ...(condemnationKey(d.condemn) ? { condemn: d.condemn } : {}),
    details: d.type === 'breaking' ? '' : body || headline, text: d.type === 'breaking' ? (editorialSelection ? '' : headline) : '',
    created: Date.now(), source: 'news',
    srcs: (d.srcs || []).map((s) => ({ u: s.u, name: s.name, url: s.url, ts: s.ts, local: !!s.local })),
    ...(d.type === 'military_incursion' && ['soldiers', 'vehicles', 'barrier'].includes(d.incursionKind) ? { incursionKind: d.incursionKind } : {}),
    ...(patrolForm ? { patrolForm } : {}),
    ...(d.flightHeading ? { flightHeading: d.flightHeading } : {}),
    ...((d.type === 'weather' && d.hazard) || d.dronePresence === true || editorialSelection ? { meta: { ...(d.type === 'weather' && d.hazard ? { hazard: d.hazard } : {}), ...(d.dronePresence === true ? { dronePresence: true } : {}), ...(editorialSelection ? { publicEditorialTone: editorialSelection.mode } : {}) } } : {}),
    ...((d.type === 'uav' || d.type === 'helicopter') && typeof d.intense === 'boolean' ? { intense: d.intense } : {}),
    ...(d.type === 'political' ? {
      politicalCategory: POLITICAL_CATEGORIES[d.politicalCategory] ? d.politicalCategory : null,
      politicalSources: (d.srcs || []).map((s) => ({ name: s.name || s.u || '', url: s.url || '', timestamp: Number.isFinite(s.ts) ? new Date(s.ts).toISOString() : null })),
      politicalSourceTimestamp: Number.isFinite(d.ts) ? new Date(d.ts).toISOString() : null,
    } : {}),
  };
}

/** Automatic publishing never calls a language model or trusts its factual headline.
 * The only body allowed is the cleaned source; a deterministic type/place line is
 * metadata, not a summary. Missing, truncated or overlong source stays in review. */
function sourceFirstCandidate(d) {
  const source = String(d.sourceText || '').trim();
  if (!source) throw new Error('missing-original-source');
  if (d.sourceTextVersion !== 2 && source.length >= 1200) throw new Error('legacy-source-may-be-truncated');
  if (publicDraftCopyIssue(d)) throw new Error('private-editorial-copy-not-public');
  const body = cleanPublicNewsAttribution(source, (d.srcs || []).map((s) => s.name).filter(Boolean));
  if (!body || body.length > 2800) throw new Error('source-length-needs-review');
  const roleConflict = locsOf(d.loc, d.extra).some((l) => nonIncidentPlaceOnly(l.name_ar, source));
  if (roleConflict) throw new Error('non-incident-location-role');
  const geography = d.type === 'political' ? politicalPublicationGeography(d) : routePublicationGeography(d);
  const where = geography.loc?.name_ar || 'سوريا';
  const headline = `${typeOf(d.type).ar} — ${where}`;
  // Drop every generated/public alternate-text field. The manual preview remains
  // on the private stored draft only, never on this publication candidate.
  return { ...d, ...geography, headline, body, details: '', text: '', description: '', description_en: '',
    title: '', title_en: '', aiRewritePreview: undefined, sourceBodyVersion: 1 };
}
function sourceFirstGate(d, candidate) {
  let expected;
  try { expected = sourceFirstCandidate(d); } catch (e) { return { ok: false, reason: e.message }; }
  if (candidate.body !== expected.body || candidate.headline !== expected.headline || JSON.stringify(candidate.loc) !== JSON.stringify(expected.loc) || JSON.stringify(candidate.extra) !== JSON.stringify(expected.extra)) return { ok: false, reason: 'source-copy-changed' };
  // Existing type, political-category, private-copy, attribution and uncertainty
  // checks now inspect the complete body, not an AI-authored summary.
  return editorialGate({ ...candidate, headline: candidate.body });
}
async function automaticPublicDraft(d, candidate = sourceFirstCandidate(d)) {
  return toBotDraft(candidate, { preservePublishedCopy: true });
}
/** Capital names often stand for governments, not meeting venues (1446).
 * Automatic political posts default to no pin. Only an explicit physical-venue
 * clause can retain a selected city; an unresolved venue clause stays in review. */
function politicalPublicationGeography(d) {
  const source = String(d.sourceText || '').split(/[،.\n]/u).map((part) => N(part)).join('\n');
  const venueClauses = [...source.matchAll(/(?:عقد|انعقد|جري|يجري|يعقد|انعقاد|اقيم|يقام)\s+(?:(?:هذا|ذلك)\s+)?(?:اللقاء|الاجتماع|المؤتمر|اجتماع|لقاء|مؤتمر)[^،.\n]{0,50}?\s+في\s+([^،.\n]+)/gu)].map((m) => m[1]);
  // A meeting explicitly at a named institution is a physical venue too, but a
  // ministry title in the speaker's job description is not.
  venueClauses.push(...[...source.matchAll(/(?:استقبل|التقي|اجتمع)[^،.\n]{0,80}?\s+في\s+مقر\s+([^،.\n]+)/gu)].map((m) => m[1]));
  if (!venueClauses.length) return { loc: locationFrom({}), extra: [] };
  if (/(?:^|\s)(?:لم|لن|قد|ربما|نفي|نفت|افتراضي|افتراضيا|متوقع|محتمل)(?:\s|$)/u.test(source)) throw new Error('political-venue-uncertain');
  const selected = locsOf(d.loc, d.extra);
  const grounded = selected.filter((l) => l.scope === 'place' && venueClauses.some((clause) => nameInText(l.name_ar, clause)));
  if (grounded.length !== 1) throw new Error('political-venue-needs-review');
  if (venueClauses.some((clause) => !nameInText(grounded[0].name_ar, clause))) throw new Error('political-venue-conflict');
  return { loc: grounded[0], extra: [] };
}
/** A place mentioned only as a directorate/hospital/hometown is not an event pin.
 * Remove these role-qualified mentions; an independent mention keeps the place. */
function nonIncidentPlaceOnly(name, text) {
  // Gazetteer display names can include parenthetical aliases absent from the source.
  const shortName = String(name || '').replace(/\([^)]*\)/g, '').trim();
  if (hospitalDestinationOnly(shortName, text)) return true;
  const n = N(shortName).trim();
  if (!n) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Preserve clause boundaries before normalization removes punctuation/hashtags.
  const nt = N(String(text || '').replace(/[،,\n؛.!؟?]/gu, ' rasroleboundary '));
  const role = '(?:(?:و|ف)?(?:ال)?(?:منحدر|منحدره|منحدرون|ينحدر|تنحدر|ينحدرون)\\s+من|(?:و|ف)?(?:ال)?(?:مقيم|مقيمه|مقيمون|يقيم|تقيم|يسكن|تسكن|يقطن|تقطن)\\s+(?:في|ب)|من\\s+(?:اهالي|ابناء)|مواليد|مسقط\\s+راس(?:ه|ها)\\s*(?:(?:في|هو|هي)\\s*)?)';
  const stop = '(?:و|ف)?(?:المقيم|المقيمه|يقيم|تقيم|يسكن|يقطن|عثر|يعثر|قتل|مقتل|اصيب|اصابه|استشهد|استهداف|انفجار|قصف|اعتقل|اوقف|وجد|نقل|اسعف|حيث|الذي|التي|بعد|قبل|جراء|اثر|وقد)|rasroleboundary';
  const word = '(?!(?:' + stop + ')(?=\\s|$))\\S+';
  const residenceOrOrigin = new RegExp('(?:^|\\s)' + role + '\\s+' + word + '(?:\\s+' + word + '){0,15}', 'gu');
  let rest = nt.replace(residenceOrOrigin, ' ');
  const institution = '(?:مديريه|قياده|فرع|مركز)\\s+(?:قوي\\s+)?(?:الامن|امن|الشرطه|شرطه|الداخلي)\\s+(?:الداخلي\\s+)?(?:في\\s+)?';
  rest = rest.replace(new RegExp(institution + escaped + '(?=\\s|$)', 'gu'), ' ');
  return rest !== nt && !nameInText(shortName, rest);
}

// ---------------------------------------------------------------- pipeline
function buildLocations(r, it) {
  const out = [];
  const add = (loc) => { if (loc && nonIncidentPlaceOnly(loc.name_ar, it.text)) return; if (loc && !out.some((x) => x.scope === loc.scope && x.name_ar === loc.name_ar && x.governorate === loc.governorate)) out.push(loc); };
  const govs = new Set();
  for (const p of (r.places || []).slice(0, 4)) {
    if (!p?.name) continue;
    if (!nameInText(p.name, it.text) && !(p.gov && nameInText(p.gov, it.text))) continue; // invented by the AI
    const x = resolvePlace(p);
    if (!x) continue;
    // Person-name guard: the proposed name may be in the post only as somebody's
    // name («وفاة الزوجين "سليمان كرنوص"…») while resolvePlace alt-matches it to
    // a village («سلمان», Hasakah). That pin comes from the person, not from a
    // place mention: drop the pin and keep only its governorate as the fallback
    // level (the draft then lands governorate-level or waits for review).
    if (x.kind === 'place' && altPinFromPersonName(p.name, it.text, getPlace(x.placeId))) {
      const pg = getPlace(x.placeId)?.gov;
      if (pg) govs.add(pg);
      continue;
    }
    if (x.govCode) govs.add(x.govCode);
    let loc = locationFrom(x);
    // "بريف القنيطرة" -> the countryside, not the city of the same name
    if (loc && loc.scope === 'place' && loc.governorate_ar && N(loc.name_ar) === N(loc.governorate_ar)) {
      const g = N(loc.governorate_ar);
      const nt = N(it.text);
      const broadOnly = nt.replace(new RegExp('(?:ريف|محافظه|محافظة)\\s+' + g, 'gu'), ' ');
      if (broadOnly !== nt && !nameInText(loc.name_ar, broadOnly)) loc = locationFrom({ govCode: loc.governorate });
    }
    if (loc) { add(loc); if (loc.governorate) govs.add(loc.governorate); }
  }
  // "اعتداءات في القنيطرة … منطقة المعكر": the city named like its governorate is just the governorate
  // when the post also names a more precise place of that governorate
  const cityLikeGov = (l) => l.scope === 'place' && l.governorate_ar && N(l.name_ar) === N(l.governorate_ar);
  for (let i = out.length - 1; i >= 0; i--) {
    const l = out[i];
    if (cityLikeGov(l) && out.some((o) => o !== l && !cityLikeGov(o) && (o.scope === 'place' || o.scope === 'district') && o.governorate === l.governorate)) out.splice(i, 1);
  }
  // only a governorate: look for an exact village/town of it in the text
  if (!out.some((l) => l.scope === 'place' || l.scope === 'district')) {
    for (const g of govs) for (const id of scanTextPlaces(it.text, g, 2)) add(locationFrom({ placeId: id }));
  }
  // "طريق درعا - دمشق" / "أوتوستراد حمص حماة": the two cities are the ends of the road, not the place
  // of the incident -> keep only the first of them (unless a village on the road was named)
  const nt = N(it.text);
  const ends = new Set();
  const addEnd = (w) => { for (const v of [w, w.replace(/^و/, ''), w.replace(/^و?ال/, '')]) if (v) ends.add(v); };
  for (const m of nt.matchAll(/(?:طريق|اوتوستراد|اوتستراد|الاوتوستراد|الطريق الدولي|الطريق|طريق عام)\s+(?:\S*\d\S*\s+)?(?:بين\s+)?(\S+)\s+(?:-\s*)?(\S+)/g)) { addEnd(m[1]); addEnd(m[2]); }
  for (const m of nt.matchAll(/بين\s+(?:مدينتي\s+)?(\S+)\s+(?:-\s*)?(\S+)/g)) { addEnd(m[1]); addEnd(m[2]); }
  const isEndCity = (l) => l.scope === 'place' && (l.rank ?? 9) <= 2 && (ends.has(N(l.name_ar)) || ends.has(N(l.name_ar).replace(/^ال/, '')));
  let fine = out.filter((l) => l.scope !== 'governorate' && !out.some((o) => o !== l && localityQualifierOnly(l.name_ar, o.name_ar, it.text)));
  if (fine.filter(isEndCity).length >= 1 && fine.length > 1) {
    const rest = fine.filter((l) => !isEndCity(l));
    fine = rest.length ? rest : fine.slice(0, 1);
  }
  const list = fine.length ? fine : out.slice(0, 1);
  if (!list.some((l) => l.scope === 'place' || l.scope === 'district')) {
    // An explicit incident village not in the gazetteer stays named, without
    // coordinates. The source-first editorial gate holds this for review.
    const village = String(it.text || '').match(/(?:في|من أبناء)\s+(?:قرية|بلدة)\s+([^،.\n]+?)(?=\s+(?:في|بريف|بمحافظة|الواقعة|حيث|بعد)|[،.\n]|$)/u)?.[1]?.trim();
    if (village && village.length < 60) return [{ ...locationFrom({}), name_ar: village, name_en: '' }];
  }
  return list.slice(0, 4);
}
function capReached() {
  const n = newsState();
  const since = Date.now() - H_MS;
  return Object.values(n.drafts).filter((d) => !d.test && d.created > since).length >= NEWS_CFG.maxPerHour;
}
async function mergeInto(d, it, locs = []) {
  const n = newsState();
  if ((d.srcs || []).some((s) => s.u === it.src.u)) return false;
  if (d.droneRuleVersion === 1 && hasExplicitDroneFlight(it.text)) d.dronePresence = true;
  d.srcs.push({ u: it.src.u, name: it.src.name, url: it.url, ts: it.ts, local: !!it.src.local });
  // new corroborating input is the ONE event that earns an audit-held draft a re-audit:
  // lift the audit hold (only that hold) so the eligibility + audit gates judge it afresh
  if (d.editorialHold && d.editorialHoldReason === AUTO_AUDIT_HOLD_REASON) {
    delete d.editorialHold; delete d.editorialHoldReason; delete d.editorialHoldAt;
  }
  scheduleDayAuto(d);
  // another channel names a more precise nearby place (e.g. "المعكر" next to "مزرعة الحانوت"): add it as an extra area
  const main = d.loc && Number.isFinite(d.loc.latitude) ? { lat: d.loc.latitude, lon: d.loc.longitude } : null;
  for (const l of locs) {
    if (!l || l.scope !== 'place' || !Number.isFinite(l.latitude) || (d.extra || []).length >= 3) continue;
    const same = (x) => x && x.scope === 'place' && x.place_id === l.place_id;
    if (same(d.loc) || (d.extra || []).some(same)) continue;
    if (d.loc?.scope === 'place' && main && km(main, { lat: l.latitude, lon: l.longitude }) > 20) continue;
    if (d.loc?.scope !== 'place' && d.loc?.governorate && l.governorate !== d.loc.governorate) continue;
    if (d.loc?.scope !== 'place') { d.extra = [...(d.extra || []), ...(d.loc?.scope === 'country' ? [] : [d.loc])].filter(Boolean).slice(0, 3); d.loc = l; }
    else (d.extra ||= []).push(l);
  }
  n.stats.merged++;
  save();
  await refreshCards(d);
  if (d.status === 'pending' && nightActive() && nightEligible(d)) await nightPublish(d); // confirmed by a 2nd source at night
  return true;
}
function refinePrimaryType(type, text) {
  const lead = String(text || '').split(/\r?\n/).find((line) => line.trim()) || '';
  return refineType(type, lead);
}
function explicitWeatherResult(it) {
  const info = weatherWarningInfo(it.text);
  if (!info || hasNonWeatherSignal(it.text)) return null;
  const nt = N(it.text);
  const gs = governorates.filter((g) => [g.ar, g.en, ...(g.alt || [])].some((x) => nt.includes(N(x)))).slice(0, 4);
  if (!gs.length) return null;
  return { i: it.i, event: true, type: 'weather', new_incident: true, same_as: null,
    places: gs.map((g) => ({ name: g.ar, gov: g.ar })), headline: weatherHeadline(info.hazard, gs), hazard: info.hazard };
}
async function handleResult(it, r, known, pmap) {
  const n = newsState();
  // the desk re-checks the source timestamp itself: whatever path queued the item
  // (live poll, filter rescan, a queue surviving a restart), a post older than the
  // freshness window is dropped here and can never be drafted as new
  if (!isFreshSourceTs(it.ts)) { note(it, 'too old'); return; }
  if (!r || !r.event || !NEWS_TYPES.includes(r.type)) { note(it, 'not an event'); return; }
  // Only the primary lead can correct Gemini's type. A secondary incident mentioned
  // later in the article must not route this story to a different button. Validate
  // against the SOURCE post's lead, not Gemini's headline: when Gemini picks the wrong
  // type it often also writes a generic headline without the cue words, so validating
  // its own output would hide the mistake from the safety net.
  if (!r.rule) { const t2 = refinePrimaryType(r.type, it.text || r.headline); if (t2 !== r.type) { note(it, `type ${r.type} -> ${t2}`); r.type = t2; } }
  if (r.type === 'weather' && !weatherWarningInfo(it.text)) { note(it, 'not an explicit actionable weather warning'); return; }
  // the AI linked it to a known incident / an earlier post of this batch
  let target = null;
  const m = String(r.same_as || '').trim().match(/^([EP])(\d+)$/i);
  if (m && m[1].toUpperCase() === 'E') target = known[Number(m[2]) - 1] || null;
  if (m && m[1].toUpperCase() === 'P') target = pmap.get(Number(m[2])) || null;
  let rejectedSameAs = false;
  const locs = buildLocations(r, it);
  const tidy = (x) => cleanAttributedNewsText(String(x || '').replace(/[\u0000-\u001F]/g, ' ')).replace(/\s+/g, ' ').trim();
  let headline = truncateAtWordBoundary(tidy(r.headline) || tidy(it.text.split('\n')[0]), 240);
  // Headline completeness guard: an AI headline that is a truncated copy of the
  // source (strict prefix, cut mid-word or dangling on a function word) is
  // rebuilt from the source's first line at a word boundary — the same cut the
  // rules path uses. The rules path is exempt (its headline is that cut already).
  let headlineRebuilt = null;
  if (!r.rule && headline) {
    const cut = truncatedPrefixCut(headline, tidy(it.text));
    if (cut) {
      const rebuilt = truncateAtWordBoundary(tidy(it.text.split('\n')[0]), 240);
      if (rebuilt && rebuilt !== headline) { headline = rebuilt; headlineRebuilt = cut; }
    }
  }
  // Full public body: the complete cleaned source text (same attribution-safe
  // cleaning as the headline, line breaks kept), capped like sourceText at 1200
  // chars and only at a word boundary. The headline stays the concise public lead;
  // this body is what the map panel and the channel post show in full. A body that
  // is itself private editorial copy is never attached (toBotDraft would refuse
  // the whole draft), and a body that merely repeats the headline is dropped.
  const tidyBody = (x) => cleanAttributedNewsText(String(x || '').replace(/[\u0000-\u001F]/g, ' ')).trim();
  let fullBody = truncateAtWordBoundary(tidyBody(it.text), 1200);
  if (fullBody && headline && fullBody.startsWith(headline)) fullBody = fullBody.slice(headline.length).replace(/^[\s:：\-–—]+/, '').trim();
  if (!fullBody || fullBody === headline || isPrivateEditorialCopy(fullBody)) fullBody = '';
  const politicalCategory = r.type === 'political'
    ? (inferPoliticalCategory(it.text) || (POLITICAL_CATEGORIES[r.political_category] ? r.political_category : null))
    : null;
  const cand = { type: r.type, politicalCategory, ts: it.ts, headline, geo: geoOf(locs) };
  if (target && !sameIncident(cand, target)) {
    note(it, `AI same_as rejected: event type/location/time mismatch (${r.same_as})`);
    target = null;
    rejectedSameAs = true;
  }
  if (!target) target = known.find((k) => sameIncident(cand, k)) || null;
  if (!target) {
    target = entityDuplicateDraft(r.type, `${headline}\n${fullBody || ''}\n${String(it.text || '')}`);
    if (target) note(it, `entity-matched into pending draft ${target.draftId} (same story, different wording)`);
  }
  if (!target && r.new_incident === false && !rejectedSameAs && !(r.type === 'political' && (!politicalCategory || r.political_category === 'none'))) { pmap.set(it.i, null); n.stats.dupes++; note(it, `follow-up of an older incident (${r.same_as || '?'})`); return; }
  if (target) {
    pmap.set(it.i, target);
    const d = target.draftId ? n.drafts[target.draftId] : null;
    if (d && d.status === 'pending') { const added = await mergeInto(d, it, locs); note(it, added ? `merged into draft ${d.id}` : `same source, already in draft ${d.id}`); return; }
    n.stats.dupes++; note(it, `duplicate of ${target.kind} (${target.status})`); return;
  }
  // Self-echo: the story is already OURS — published earlier and reposted by
  // another channel after the incident windows forgot it. Never draft it again.
  const echo = selfEchoOf(cand, `${headline}\n${fullBody || ''}\n${String(it.text || '')}`);
  if (echo) { pmap.set(it.i, null); n.stats.dupes++; note(it, `self-echo of published alert ${echo.id} (sim ${echo.sim.toFixed(2)}) — dropped`); return; }
  if (!n.types[r.type]) { note(it, 'type switched off'); return; }
  if (!locs.length && r.type !== 'political') { note(it, 'no verified Syrian place found'); return; }
  if (capReached()) { note(it, 'hourly cap reached'); return; }
  const d = {
    id: rid(), type: r.type, ...(r.type === 'helicopter' ? { intense: helicopterAuto(`${headline} ${it.text}`) } : {}), ...(r.type === 'political' ? { politicalCategory, politicalNeedsCategory: !politicalCategory } : {}),
    loc: locs[0] || locationFrom({}), extra: locs.slice(1), headline,
    ...(fullBody ? { body: fullBody } : {}), ...(r.toneGuard ? { toneNeutralized: r.toneGuard } : {}), ...(headlineRebuilt ? { headlineRebuilt } : {}),
    srcs: [{ u: it.src.u, name: it.src.name, url: it.url, ts: it.ts, local: !!it.src.local }], ts: it.ts, created: Date.now(), status: 'pending', cards: [], rule: !!r.rule,
    droneRuleVersion: 1, dronePresence: hasExplicitDroneFlight(it.text),
    ...(['uav', 'uav_strike', 'warplane', 'helicopter'].includes(r.type) && extractFlightDirection(it.text) ? { flightHeading: extractFlightDirection(it.text) } : {}),
    sourceText: String(it.text || ''), sourceTextVersion: 2, ...(r.type === 'weather' ? { hazard: r.hazard || weatherWarningInfo(it.text)?.hazard } : {}),
  };
  scheduleDayAuto(d, d.created);
  n.drafts[d.id] = d;
  n.stats.drafts++;
  const ev = { kind: 'draft', status: 'pending', draftId: d.id, type: d.type, ts: d.ts, headline, where: whereOf(locs), geo: cand.geo };
  known.unshift(ev); pmap.set(it.i, ev);
  save();
  if (nightActive() && nightEligible(d) && await nightPublish(d)) {
    note(it, `NIGHT auto-published ${d.id} (${d.type} @ ${ev.where})`);
    ev.status = 'published';
    return;
  }
  const sent = await sendCards(d);
  save();
  note(it, `NEW draft ${d.id} (${d.type} @ ${ev.where}) -> ${sent} reviewer(s)`);
  console.log(`[news] draft ${d.id}: ${d.type} @ ${ev.where} · ${it.src.u}`);
}
function aiBudgetOk() {
  const today = dayKey();
  if (aiStats.day !== today) { aiStats.day = today; aiStats.today = 0; }
  return aiStats.today < NEWS_CFG.aiDailyCap;
}
async function processQueue() {
  if (R.busy || !R.queue.length) return;
  R.busy = true;
  try {
    // the +30 min is only AI-processing slack for items ingested inside the window;
    // the hard freshness window itself is re-checked at the desk (handleResult)
    R.queue = R.queue.filter((x) => Date.now() - x.ts < (NEWS_CFG.maxAgeMin + 30) * 60_000);
    R.queue.sort((a, b) => a.ts - b.ts);
    const batch = R.queue.splice(0, 20);
    if (!batch.length) return;
    batch.forEach((it, k) => { it.i = k + 1; });
    // Keep the complete in-window event set for deterministic local matching; only cap the AI context.
    const known = knownEvents(12);
    const key = NEWS_CFG.aiKey();
    let results = null;
    if (key && aiBudgetOk() && Date.now() - R.lastAiAt >= NEWS_CFG.aiMinGapMs) {
      R.lastAiAt = Date.now();
      aiStats.today++;
      try {
        const prompt = buildPrompt(
          batch.map((it) => ({ i: it.i, source: it.src.name, local: !!it.src.local, ago: `${Math.max(0, Math.round((Date.now() - it.ts) / 60000))} min ago`, text: it.text })),
          known.slice(0, 40).map((k, i) => ({ id: 'E' + (i + 1), type: k.type, where: k.where, ago: `${Math.round((Date.now() - k.ts) / 60000)} min ago`, headline: `${k.headline} [${k.status}]`.slice(0, 220) })),
          nowDamascus(),
        );
        results = await callGemini(prompt, { key, models: NEWS_CFG.models() });
        R.aiOk = true;
      } catch (e) {
        R.aiOk = false;
        console.warn('[news] AI failed:', String(e.message || e).replace(/key=[^&\s]+/g, 'key=…').slice(0, 200));
      }
    }
    if (!results) {
      // AI unavailable: retry these posts on the next round; after 6 min fall back to simple rules
      const late = batch.filter((it) => !key || Date.now() - it.qAt > 6 * 60_000);
      R.queue.unshift(...batch.filter((it) => !late.includes(it)));
      // local/activist channels are never turned into drafts by the simple rules (too noisy without the AI)
      results = late.map((it) => ({ i: it.i, ...((!it.src.local && ruleClassify(it.text, { breaking: it.breaking })) || { event: false, type: 'none' }) }));
      batch.splice(0, batch.length, ...late);
    }
    const byI = new Map(results.filter((r) => r && Number.isInteger(r.i)).map((r) => [r.i, r]));
    for (const it of batch) { const forced = explicitWeatherResult(it); if (forced) byI.set(it.i, forced); }
    const pmap = new Map();
    for (const it of batch) {
      try { await handleResult(it, byI.get(it.i), known, pmap); } catch (e) { console.error('[news] handle failed', e.message); note(it, 'error: ' + e.message); }
    }
  } finally { R.busy = false; }
}
const textHash = (t) => crypto.createHash('sha1').update(N(t).slice(0, 400)).digest('base64').slice(0, 16);
/** once per FILTER_VER: re-read the channels and send the recent posts the old rules skipped to the desk */
async function rescanIfFilterChanged() {
  const n = newsState();
  if (n.fver === FILTER_VER) return;
  if (!n.on) { n.fver = FILTER_VER; save(false); return; }
  n.handled ||= {};
  const drafted = new Set(Object.values(n.drafts).flatMap((d) => (d.srcs || []).map((x) => x.url)).filter(Boolean));
  let queued = 0;
  for (const src of n.sources.filter((s) => s.on)) {
    if (R.stopped) return;
    try {
      const r = await fetchChannel(src.u);
      const last = n.last[src.u];
      for (const p of r.posts) {
        if (last == null || p.id > last) continue; // newer posts: the normal poll handles them
        if (!isFreshSourceTs(p.ts)) continue; // the rescan obeys the same freshness window as the live poll: older posts stay history, even after a rule fix
        const key = `${src.u}/${p.id}`;
        if (n.handled[key] || drafted.has(p.url)) continue;
        const c = cleanPostText(p.text);
        if (isRoadStatusOnlyPost(c.text)) {
          n.seen[textHash(c.text)] = Date.now(); n.handled[key] = Date.now();
          continue;
        }
        const f = prefilter(c.text, { general: !!src.general, breaking: c.breaking });
        if (!f.ok) continue;
        const h = textHash(c.text);
        n.seen[h] = Date.now(); n.handled[key] = Date.now();
        const it = { src: { u: src.u, name: src.name, local: !!src.local }, url: p.url, ts: p.ts, qAt: Date.now(), text: c.text, media: p.media, breaking: c.breaking, rescan: true };
        note(it, 'rescan: queued');
        R.queue.push(it); queued++;
      }
    } catch (e) { console.warn('[news] rescan', src.u, e.message); }
    await sleep(700);
  }
  n.fver = FILTER_VER;
  save(false);
  console.log(`[news] filter v${FILTER_VER}: rescan queued ${queued} recent post(s)`);
  if (R.queue.length) await processQueue();
}
export function checkpointSourcePosts(n, src, posts) {
  const last = n.last[src.u];
  const maxId = posts.reduce((max, post) => Math.max(max, post.id), 0);
  if (last == null) { n.last[src.u] = maxId; return []; }
  if (maxId > last) n.last[src.u] = maxId;
  return posts.filter((post) => post.id > last);
}

async function pollOnce() {
  const n = newsState();
  if (!n.on || R.stopped) return;
  const roadActiveSince = roadMonitorActivationTime();
  R.lastPollAt = Date.now();
  const fresh = [];
  for (const src of n.sources.filter((s) => s.on)) {
    if (R.stopped) return;
    try {
      const last = n.last[src.u];
      const r = await fetchChannel(src.u, { ...(last == null ? {} : { afterId: last }) });
      if (r.complete === false) {
        R.src[src.u] = { ok: false, at: Date.now(), n: r.posts.length, err: 'catch-up exceeds page limit; checkpoint preserved' };
        console.warn(`[news] ${src.u}: catch-up page limit reached; keeping checkpoint ${last}`);
        await sleep(700);
        continue;
      }
      R.src[src.u] = { ok: true, at: Date.now(), n: r.posts.length, pages: r.pages || 1 };
      for (const p of checkpointSourcePosts(n, src, r.posts)) fresh.push({ src, p });
    } catch (e) {
      R.src[src.u] = { ok: false, at: Date.now(), err: e.code === 'nopreview' ? 'no public preview' : String(e.message || e).slice(0, 80) };
    }
    await sleep(700);
  }
  // the per-source checkpoints were just advanced in the durable store: push them to the
  // remote backup promptly (backupSoon, not the lazy path), so a deploy/restart can only
  // ever roll the watermark back by seconds — and the freshness gate covers even that
  save();
  for (const { src, p } of fresh) {
    n.stats.posts++;
    const it = { src: { u: src.u, name: src.name, local: !!src.local, roadOnly: !!src.roadOnly }, url: p.url, ts: p.ts || Date.now(), qAt: Date.now(), media: p.media };
    // dropped as history — and marked handled in the durable state, so a rolled-back
    // checkpoint or a filter rescan can never reconsider it as new
    if (!isFreshSourceTs(p.ts)) { it.text = p.text; (n.handled ||= {})[`${src.u}/${p.id}`] = Date.now(); note(it, 'too old'); continue; }
    const c = cleanPostText(p.text);
    it.text = c.text; it.breaking = c.breaking;
    const h = textHash(c.text);
    let roadHandled = false;
    if (it.ts >= roadActiveSince) {
      try { roadHandled = await onRoadNewsPost(it); }
      catch (e) { console.warn('[news] road hook failed', e?.message || e); }
    }
    if (isRoadStatusOnlyPost(it.text)) {
      n.seen[h] = Date.now();
      (n.handled ||= {})[`${src.u}/${p.id}`] = Date.now();
      note(it, roadHandled ? 'road update -> dedicated road monitor only; excluded from breaking-news alerts' : 'road status withheld from general alerts; not accepted by road monitor');
      continue;
    }
    if (src.roadOnly) {
      n.seen[h] = Date.now();
      (n.handled ||= {})[`${src.u}/${p.id}`] = Date.now();
      continue; // official road feeds never enter the general news/alert pipeline
    }
    // ⚡ electricity / rationing updates -> a separate owner card (server/services.js), never an alert
    try { if (onPowerPost(it)) { note(it, 'electricity update -> owner card'); continue; } } catch (e) { console.warn('[news] power hook failed', e.message); }
    // 🛂 border crossing open/closed news -> owner suggestion card (server/borders.js); the post still goes on as news
    try { if (onBorderNews(it)) note(it, 'border crossing update -> owner card'); } catch (e) { console.warn('[news] border hook failed', e.message); }
    // ⛽ official fuel pricing decision -> re-check the fuel sources soon (server/prices.js); the post still goes on
    try { if (FUEL_NEWS_RE.test(normalizeFuelText(c.text)) && Date.now() - (FUEL_HOOK.at || 0) > 3 * 3600_000) { FUEL_HOOK.at = Date.now(); fuelRecheckSoon(); note(it, 'fuel pricing news -> fuel re-check scheduled'); } } catch (e) { console.warn('[news] fuel hook failed', e.message); }
    const f = prefilter(c.text, { general: !!src.general, breaking: c.breaking });
    if (!f.ok) { note(it, 'skipped: ' + f.why); continue; }
    // "seen" only once it really goes to the desk: a skipped post can be looked at again after a rule fix
    n.seen[h] = Date.now();
    (n.handled ||= {})[`${src.u}/${p.id}`] = Date.now();
    R.queue.push(it);
  }
  if (R.queue.length) await processQueue();
}
async function sweep() {
  const n = newsState();
  const now = Date.now();
  let changed = false;
  for (const d of Object.values(n.drafts)) {
    const life = d.test ? 10 * 60_000 : NEWS_CFG.expireMin * 60_000;
    if (d.status === 'pending' && now - d.created > life) { d.status = 'expired'; await closeCards(d, null, true); await unlinkCapturedMedia(d.sourceMedia); changed = true; }
    if (now - d.created > 26 * H_MS) { delete n.drafts[d.id]; changed = true; }
  }
  const before = n.alerts.length;
  n.alerts = n.alerts.filter((a) => now - a.ts < 26 * H_MS);
  const echoBefore = (n.echoLog || []).length;
  if (Array.isArray(n.echoLog)) n.echoLog = n.echoLog.filter((e) => now - e.ts < ECHO_HOURS * H_MS);
  for (const [h, t] of Object.entries(n.seen)) if (now - t > 48 * H_MS) { delete n.seen[h]; changed = true; }
  for (const [k, t] of Object.entries(n.handled || {})) if (now - t > 48 * H_MS) { delete n.handled[k]; changed = true; }
  if (changed || before !== n.alerts.length || echoBefore !== (n.echoLog || []).length) save(false);
  // Channel-post auto-retry: STOPPED by the owner (2026-11-18) — failed
  // posts are still flagged and warned about, but never re-posted on their own.
}

// ---------------------------------------------------------------- start / stop / hand-off
export function mergeNewsFromBackup(o) {
  const on = o?.news;
  if (!on || typeof on !== 'object') return;
  const n = newsState();
  for (const [id, d] of Object.entries(on.drafts || {})) {
    const mine = n.drafts[id];
    if (!mine) n.drafts[id] = d;
    else if (mine.status === 'pending' && d.status && d.status !== 'pending') { mine.status = d.status; mine.alertId ||= d.alertId; }
  }
  for (const [u, id] of Object.entries(on.last || {})) if (!(n.last[u] >= id)) n.last[u] = id;
  for (const [h, t] of Object.entries(on.seen || {})) if (!n.seen[h]) n.seen[h] = t;
  n.handled ||= {};
  for (const [k, t] of Object.entries(on.handled || {})) if (!n.handled[k]) n.handled[k] = t;
  if (Number(on.fver) > Number(n.fver || 0)) n.fver = on.fver;
  for (const a of on.alerts || []) if (a?.id && !n.alerts.some((x) => x.id === a.id)) n.alerts.push(a);
}
export function startNewsMonitor() {
  if (R.started) return;
  R.started = true;
  newsState();
  roadMonitorActivationTime();
  for (const a of store.state.alerts || []) { try { rememberAlert({ ...a, place: a.place, more: a.extra, zones: [] }); } catch { /* ignore */ } }
  store.on('alert', (pa) => { try { rememberAlert(pa); } catch (e) { console.warn('[news] remember failed', e.message); } });
  (store.mergeHooks ||= []).push(mergeNewsFromBackup);
  const loop = async () => {
    if (R.stopped) return;
    try { await pollOnce(); } catch (e) { console.error('[news] poll failed', e.message); }
    try { await sweep(); } catch (e) { console.error('[news] sweep failed', e.message); }
    R.timer = setTimeout(loop, NEWS_CFG.pollSec * 1000);
    R.timer.unref?.();
  };
  const first = async () => {
    if (store.backup && config.telegramBackup) { try { await store.mergeFromBackup(); } catch { /* ignore */ } }
    const n = newsState();
    try {
      const moved = await takeMisroutedWeatherPower();
      for (const p of moved) {
        const info = weatherWarningInfo(p.text || '');
        const g = getGov(p.gov);
        if (!info || !g) continue;
        const body = cleanAlertText(String(p.text || '')).slice(0, 900);
        const d = { id: rid(), type: 'weather', hazard: info.hazard, loc: locationFrom({ govCode: g.code }), extra: [],
          headline: weatherHeadline(info.hazard, [g]), body, sourceText: body,
          srcs: [{ u: p.src?.u || 'weather-warning', name: p.src?.name || 'الإخبارية السورية', url: p.src?.url || '', ts: p.ts, local: false }],
          ts: p.ts || Date.now(), created: Date.now(), status: 'pending', cards: [], rule: false };
        n.drafts[d.id] = d; n.stats.drafts++;
        const c = cleanPostText(body); n.seen[textHash(c.text)] = Date.now();
        const m = String(p.src?.url || '').match(/t\.me\/(?:s\/)?([^/]+)\/(\d+)/i);
        if (m) (n.handled ||= {})[`${m[1]}/${m[2]}`] = Date.now();
        save();
        const sent = await sendCards(d);
        console.log(`[news] corrected misrouted electricity card ${p.id} -> weather draft ${d.id} (${sent} reviewer(s))`);
      }
    } catch (e) { console.error('[news] weather-card correction failed', e.message); }
    try { await rescanIfFilterChanged(); } catch (e) { console.error('[news] rescan failed', e.message); }
    // re-tag drafts still waiting for review (e.g. explosions typed as the generic "civil")
    for (const d of Object.values(n.drafts)) {
      if (d.status !== 'pending' || d.test) continue;
      const text = d.sourceText || d.body || d.headline || '';
      const t2 = refinePrimaryType(d.type, d.headline || text);
      if (t2 === d.type) continue;
      console.log(`[news] draft ${d.id} re-tagged ${d.type} -> ${t2}`);
      d.type = t2;
      if (t2 === 'weather') d.hazard = weatherWarningInfo(text)?.hazard || d.hazard; else delete d.hazard;
      save();
      try { await refreshCards(d); } catch { /* ignore */ }
    }
    try { await refreshPendingLocationRoles(); } catch (e) { console.warn('[news] location-role repair failed', e.message); }
    try { await refreshPendingCardKeyboards(); } catch (e) { console.warn('[news] review keyboard sync failed', e.message); }
    console.log(`[news] monitor started: ${n.on ? 'ON' : 'paused'} · ${n.sources.filter((s) => s.on).length} sources · AI ${NEWS_CFG.aiKey() ? NEWS_CFG.models()[0] : 'OFF (rules only)'} · every ${NEWS_CFG.pollSec}s`);
    loop();
  };
  setInterval(() => { nightSummaryTick().catch((e) => console.warn('[news] night summary', e.message)); }, 60_000).unref?.();
  R.dayAutoTimer = setInterval(() => { dayAutoTick().catch((e) => console.warn('[news] daytime auto-publish', e.message)); }, 5_000);
  R.dayAutoTimer.unref?.();
  const t = setTimeout(first, NEWS_CFG.startDelaySec * 1000);
  t.unref?.();
}
export function stopNewsMonitor() { R.stopped = true; clearTimeout(R.timer); clearInterval(R.dayAutoTimer); }
/** Repair pending geography only, without replaying sources or moving published pins. */
export async function refreshPendingLocationRoles() {
  const changed = [];
  for (const d of Object.values(newsState().drafts)) {
    if (d.status !== 'pending' || d.test) continue;
    const before = locsOf(d.loc, d.extra);
    const kept = before.filter((l) => !nonIncidentPlaceOnly(l.name_ar, d.sourceText || d.body || ''));
    if (kept.length === before.length) continue;
    d.loc = kept[0] || locationFrom({}); d.extra = kept.slice(1);
    d.locationRoleRepair = { at: Date.now(), removed: before.filter((l) => !kept.includes(l)).map((l) => l.name_ar) };
    d.editorialHold = true; d.editorialHoldReason = 'location-role-repaired-needs-review';
    d.dayAutoAt = null; delete d.autoMode;
    changed.push(d.id);
  }
  if (changed.length) {
    save(); await store.flushBackup(true);
    for (const id of changed) await refreshCards(newsState().drafts[id]);
  }
  return changed;
}
const operatorRevision = (d) => crypto.createHash('sha256').update(JSON.stringify({
  status: d.status, type: d.type, headline: d.headline, body: d.body, sourceText: d.sourceText,
  loc: d.loc, extra: d.extra, srcs: d.srcs, politicalCategory: d.politicalCategory,
  editorialHold: d.editorialHold, privateEditorial: d.privateEditorial, aiRewritePreview: d.aiRewritePreview,
  operation: d.operatorReview,
})).digest('hex');
export function operatorNewsReview(id) {
  const d = newsState().drafts[id];
  if (!d) return null;
  let candidate = null, issue = null, duplicate = null;
  try {
    candidate = sourceFirstCandidate(d);
    const gate = sourceFirstGate(d, candidate);
    if (!gate.ok) issue = gate.reason;
    duplicate = finalPublishDuplicate(d, { headline: candidate.headline, body: candidate.body });
  } catch (e) { issue = e.message; }
  return { id: d.id, status: d.status, revision: operatorRevision(d), test: !!d.test,
    type: d.type, headline: d.headline, sourceText: d.sourceText, sources: d.srcs || [],
    location: d.loc, extra: d.extra || [], editorialHold: !!d.editorialHold,
    holdReason: d.editorialHoldReason || null, candidate: candidate ? { headline: candidate.headline, body: candidate.body, location: candidate.loc, extra: candidate.extra } : null,
    issue, duplicate, alertId: d.alertId || null, postId: d.postId || null, operation: d.operatorReview || null };
}
/** Uses only the already-running monitor. A durable claim precedes every send.
 * An uncertain send stays claimed, so retries/restarts cannot blindly repost it. */
export async function operateNewsDraft(id, request = {}) {
  const n = newsState(), d = n.drafts[id];
  const fail = (message) => { throw new Error(message); };
  if (!d) return fail('unknown-draft');
  const prior = d.operatorReview;
  if (prior?.revision === request.revision && ['published', 'map-only', 'duplicate', 'held'].includes(prior.result)) {
    return { ok: prior.result !== 'map-only', reused: true, status: prior.result, id: d.id, alertId: d.alertId || null, postId: d.postId || null, duplicateOf: d.duplicateOf || null };
  }
  if (d.status !== 'pending') return fail('draft-already-handled-or-publication-unresolved');
  if (!request.revision || request.revision !== operatorRevision(d)) return fail('stale-review');
  if (d.test) return fail('test-draft-cannot-publish');
  if (!['hold', 'duplicate', 'publish'].includes(request.action)) return fail('invalid-operation');
  if (request.action === 'hold') {
    d.editorialHold = true; d.editorialHoldReason = 'operator-review-hold'; d.dayAutoAt = null; delete d.autoMode;
    d.operatorReview = { revision: request.revision, at: Date.now(), result: 'held' };
    save(); await store.flushBackup(true); await refreshCards(d);
    return { ok: true, status: 'held', id: d.id };
  }
  const review = operatorNewsReview(id);
  if (review.issue && request.action === 'publish') return fail(review.issue);
  const duplicate = review.duplicate || knownDuplicateDraft(d);
  if (duplicate) {
    await suppressDuplicateDraft(d, { alertId: duplicate.id || duplicate.alertId, draftId: duplicate.draftId, kind: 'operator-reviewed-duplicate' });
    d.operatorReview = { revision: request.revision, at: Date.now(), result: 'duplicate' };
    save(); await store.flushBackup(true);
    return { ok: true, status: 'duplicate', id: d.id, duplicateOf: d.duplicateOf || null };
  }
  if (request.action === 'duplicate') return fail('no-supported-duplicate-match');
  if (d.aiRewritePreview?.applied && ['opinion', 'satire'].includes(d.aiRewritePreview.mode)) return fail('owner-private-editorial-approval-required');
  if ((d.srcs || []).length === 0 || (d.srcs || []).every((s) => s.local)) return fail('independent-source-review-required');
  const publication = toBotDraft(sourceFirstCandidate(d), { preservePublishedCopy: true });
  if (!api() || !R.H?.publishDraft) return fail('publisher-not-ready');
  d.status = 'publishing'; d.operatorReview = { revision: request.revision, at: Date.now(), result: 'claimed' };
  save();
  if (store.backup && !await store.flushBackup(true)) {
    d.editorialHold = true; d.editorialHoldReason = 'operator-claim-not-durable';
    return fail('durable-claim-failed-no-send');
  }
  let alert;
  try { alert = await R.H.publishDraft(api(), publication, { id: 0, name: 'مراجعة تحريرية', via: 'news-reviewed-operator' }); }
  catch (e) {
    d.operatorReview.result = 'uncertain'; d.editorialHold = true; d.editorialHoldReason = 'operator-send-needs-reconciliation';
    save(); await store.flushBackup(true);
    return fail('publication-outcome-unverified-do-not-retry');
  }
  if (!alert?.id) {
    d.operatorReview.result = 'uncertain'; save(); await store.flushBackup(true);
    return fail('publication-outcome-unverified-do-not-retry');
  }
  if (await autoDeleteLandedDuplicate(d, publication, alert.id)) {
    d.operatorReview.result = 'duplicate'; save(); await store.flushBackup(true);
    return { ok: true, status: 'duplicate', id: d.id, duplicateOf: d.duplicateOf || null };
  }
  d.alertId = alert.id; d.postId = alert.channel_message_id || null;
  d.status = 'published'; d.by = 0; d.publishedHeadline = publication.headline || d.headline;
  d.approvedBy = { id: 0, name: 'مراجعة تحريرية', via: 'delegated-project-operator' }; d.approvedAt = new Date().toISOString();
  d.operatorReview.result = d.postId ? 'published' : 'map-only'; n.stats.published++;
  save();
  if (store.backup && !await store.flushBackup(true)) {
    d.operatorReview.result = 'published-backup-unverified';
    return { ok: false, status: 'published-backup-unverified', id: d.id, alertId: d.alertId, postId: d.postId };
  }
  await closeCards(d, null, true); await unlinkCapturedMedia(d.sourceMedia);
  return { ok: !!d.postId, status: d.operatorReview.result, id: d.id, alertId: d.alertId, postId: d.postId };
}
export function newsDebug() {
  const n = newsState();
  return {
    on: n.on, started: R.started, lastPollAt: R.lastPollAt ? new Date(R.lastPollAt).toISOString() : null, queue: R.queue.length, aiOk: R.aiOk,
    ai: { ...aiStats, key: Boolean(NEWS_CFG.aiKey()), models: NEWS_CFG.models() }, stats: n.stats, night: { ...n.night, active: nightActive() },
    sources: n.sources.map((s) => ({ ...s, last: n.last[s.u] ?? null, status: R.src[s.u] || null })),
    types: n.types,
    drafts: Object.values(n.drafts).sort((a, b) => b.created - a.created).slice(0, 30).map((d) => ({ id: d.id, test: !!d.test, status: d.status, type: d.type, where: whereOf(locsOf(d.loc, d.extra)), headline: d.headline, sources: d.srcs.map((s) => s.u), created: new Date(d.created).toISOString() })),
    alertsKnown: n.alerts.length, roadMonitor: roadMonitorDebug(),
    recent: R.log.slice(-80),
  };
}
/** a clearly marked test draft (nothing can be published from it), removed after 10 minutes */
export async function sendTestDraft(chatId) {
  const n = newsState();
  const loc = locationFrom({ placeId: (await import('./places.js')).searchPlaces('بصرى الشام', 1)[0]?.id }) || locationFrom({});
  const d = {
    id: 't' + rid(), test: true, type: 'attack', loc, extra: [], headline: 'مثال: هجوم مسلح على حاجز أمني قرب بصرى الشام بريف درعا الشرقي (مسودة تجريبية)',
    srcs: [{ u: 'ajasyr', name: 'الجزيرة سوريا', url: 'https://t.me/ajasyr' }, { u: 'TelevisionSyria', name: 'تلفزيون سوريا', url: 'https://t.me/TelevisionSyria' }],
    ts: Date.now(), created: Date.now(), status: 'pending', cards: [],
  };
  n.drafts[d.id] = d;
  const sent = await sendCards(d, chatId);
  save();
  return { id: d.id, sent };
}

// ---------------------------------------------------------------- bot: draft buttons + owner settings
const PEND_MS = 10 * 60_000;
const pend = new Map(); // owner id -> { k: 'add', exp }
export function registerNewsTools(bot, h) {
  R.H = h;
  const en = (ctx) => h.langOf(ctx) === 'en';
  const t = (ctx, ar, e) => (en(ctx) ? e : ar);
  const staff = (ctx) => isOwner(ctx.from?.id) || store.isEditor(ctx.from?.id);
  const privateOwner = (ctx) => h.owner(ctx) && ownerIdsU().includes(Number(ctx.from?.id))
    && ctx.chat?.type === 'private' && Number(ctx.chat.id) === Number(ctx.from?.id);
  const findDraft = async (id) => {
    const n = newsState();
    if (!n.drafts[id] && store.backup) await store.mergeFromBackup().catch(() => {});
    return newsState().drafts[id] || null;
  };
  const cur = (ctx) => (ctx.callbackQuery?.message ? [ctx.callbackQuery.message.chat.id, ctx.callbackQuery.message.message_id] : null);
  const forgetCurrentCard = (d, ctx) => {
    const current = cur(ctx);
    if (current) d.cards = (d.cards || []).filter(([chat, id]) => chat !== current[0] || id !== current[1]);
  };
  const showRewritePreview = async (ctx, d, lang) => ctx.editMessageText(rewritePreviewText(d, lang), {
    parse_mode: 'HTML', reply_markup: rewritePreviewKb(d, lang), link_preview_options: { is_disabled: true },
  });
  const toast = async (ctx, text, alert = false) => { try { await ctx.answerCallbackQuery({ text, show_alert: alert }); } catch { /* answered */ } };
  const vanish = async (ctx, text) => {
    await toast(ctx, text);
    try { await ctx.deleteMessage(); } catch { try { await ctx.editMessageText('✔️'); } catch { /* ignore */ } }
  };
  const publishedNewsDraft = async (id) => {
    const d = await findDraft(id);
    return d?.auto && d.status === 'published' && !d.undone && d.alertId && store.getAlert(d.alertId) ? d : null;
  };
  const refreshPublishedNotices = async (d) => {
    const a = api();
    if (!a) return;
    for (const [chat, mid] of d.notices || []) {
      const lang = langOfId(chat);
      try { await a.editMessageText(chat, mid, noticeText(d, lang), { parse_mode: 'HTML', reply_markup: noticeKb(d, lang), link_preview_options: { is_disabled: true } }); } catch { /* notice may have been removed */ }
    }
  };
  const applyPublishedNewsType = async (ctx, d, type, { incursionKind = 'general', politicalCategory = null } = {}) => {
    if (!ALERT_TYPES[type]) return toast(ctx, t(ctx, 'نوع غير صالح', 'Invalid type'), true);
    const alert = store.getAlert(d.alertId);
    if (!alert) return vanish(ctx, t(ctx, 'التنبيه لم يعد موجوداً على الخريطة', 'This alert is no longer on the map'));
    const meta = { ...(alert.meta || {}) };
    if (type !== 'military_incursion') { delete meta.incursionKind; delete meta.vehicleCount; }
    else if (incursionKind === 'general') delete meta.incursionKind;
    else meta.incursionKind = incursionKind;
    if (type !== 'political') delete meta.political;
    else meta.political = { ...(meta.political || {}), category: politicalCategory || d.politicalCategory };
    if (type !== 'uav') delete meta.intense;
    if (type !== 'weather') delete meta.hazard;
    const { retypeAlerts } = await import('./bot.js');
    let result;
    try { [result] = await retypeAlerts(ctx.api, [d.alertId], type, { gapMs: 0, alertPatch: { meta: Object.keys(meta).length ? meta : null } }); }
    catch (e) { console.error('[news] published type change failed', e.description || e.message); return toast(ctx, t(ctx, 'تعذّر تعديل الخبر المنشور', 'Could not update the published story'), true); }
    // retypeAlerts updates the live map before attempting Telegram's in-place channel edit.
    if (store.getAlert(d.alertId)?.type !== type) return toast(ctx, t(ctx, 'تعذّر تعديل الخبر المنشور', 'Could not update the published story'), true);
    d.type = type;
    delete d.pendingPublishedType;
    if (type === 'military_incursion' && incursionKind !== 'general') d.incursionKind = incursionKind;
    else delete d.incursionKind;
    if (type === 'political') { d.politicalCategory = politicalCategory || d.politicalCategory; d.politicalNeedsCategory = !POLITICAL_CATEGORIES[d.politicalCategory]; }
    else { delete d.politicalCategory; delete d.politicalNeedsCategory; }
    const cached = newsState().alerts.find((item) => item.id === d.alertId);
    if (cached) {
      const updated = store.getAlert(d.alertId);
      cached.type = type;
      cached.politicalCategory = type === 'political' ? d.politicalCategory : undefined;
      cached.headline = [updated?.title, updated?.description].filter(Boolean).join(' ');
    }
    save();
    await refreshPublishedNotices(d);
    await toast(ctx, result?.ok === false
      ? t(ctx, 'تم تعديل الخريطة، لكن تعذّر تحديث منشور القناة', 'Map updated, but the channel post could not be edited')
      : `${ALERT_TYPES[type].emoji} ${en(ctx) ? ALERT_TYPES[type].en : ALERT_TYPES[type].ar}`);
  };
  const requirePublishedOwner = async (ctx, id) => {
    if (!h.owner(ctx)) { await toast(ctx, t(ctx, 'للأدمنية فقط', 'Admins only')); return null; }
    const d = await publishedNewsDraft(id);
    if (!d) { await vanish(ctx, t(ctx, 'هذا الخبر المنشور لم يعد متاحاً', 'This published story is no longer available')); return null; }
    return d;
  };
  bot.callbackQuery(/^nw:pt:(\w+)$/, async (ctx) => {
    const d = await requirePublishedOwner(ctx, ctx.match[1]);
    if (!d) return;
    await toast(ctx, '');
    try { await ctx.editMessageReplyMarkup({ reply_markup: typeKb(d, h.langOf(ctx), 'nwp') }); } catch { /* notice may be gone */ }
  });
  bot.callbackQuery(/^nwp:tg:(\w+):([a-z_]+)$/, async (ctx) => {
    const d = await requirePublishedOwner(ctx, ctx.match[1]);
    if (!d) return;
    const group = ctx.match[2];
    if (!Object.hasOwn(EDIT_TYPE_GROUPS, group)) return toast(ctx, '');
    await toast(ctx, '');
    try { await ctx.editMessageReplyMarkup({ reply_markup: typeGroupKb(d, group, h.langOf(ctx), 'nwp') }); } catch { /* ignore */ }
  });
  bot.callbackQuery(/^nwp:tb:(\w+)$/, async (ctx) => {
    const d = await requirePublishedOwner(ctx, ctx.match[1]);
    if (!d) return;
    await toast(ctx, '');
    try { await ctx.editMessageReplyMarkup({ reply_markup: typeKb(d, h.langOf(ctx), 'nwp') }); } catch { /* ignore */ }
  });
  bot.callbackQuery(/^nwp:b:(\w+)$/, async (ctx) => {
    const d = await requirePublishedOwner(ctx, ctx.match[1]);
    if (!d) return;
    delete d.pendingPublishedType; save();
    await toast(ctx, '');
    try { await ctx.editMessageText(noticeText(d, h.langOf(ctx)), { parse_mode: 'HTML', reply_markup: noticeKb(d, h.langOf(ctx)), link_preview_options: { is_disabled: true } }); } catch { /* ignore */ }
  });
  bot.callbackQuery(/^nwp:si:(\w+):(general|soldiers|vehicles|barrier)$/, async (ctx) => {
    const d = await requirePublishedOwner(ctx, ctx.match[1]);
    if (!d) return;
    await applyPublishedNewsType(ctx, d, 'military_incursion', { incursionKind: ctx.match[2] });
  });
  bot.callbackQuery(/^nwp:s:(\w+):(\w+)$/, async (ctx) => {
    const d = await requirePublishedOwner(ctx, ctx.match[1]);
    if (!d) return;
    const type = ctx.match[2];
    if (!ALERT_TYPES[type]) return toast(ctx, '');
    if (type === 'political') {
      d.pendingPublishedType = type; save();
      await toast(ctx, '');
      try { await ctx.editMessageReplyMarkup({ reply_markup: politicalCategoryKb(d, h.langOf(ctx), 'nwp') }); } catch { /* ignore */ }
      return;
    }
    await applyPublishedNewsType(ctx, d, type);
  });
  bot.callbackQuery(/^nwp:pc:(\w+):([a-z_]+)$/, async (ctx) => {
    const d = await requirePublishedOwner(ctx, ctx.match[1]);
    if (!d || d.pendingPublishedType !== 'political' || !POLITICAL_CATEGORIES[ctx.match[2]]) return toast(ctx, '');
    await applyPublishedNewsType(ctx, d, 'political', { politicalCategory: ctx.match[2] });
  });
  bot.callbackQuery(/^nw:hi:(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const d = await findDraft(ctx.match[1]);
    if (!d || d.type !== 'helicopter' || d.status !== 'pending') return toast(ctx, '');
    d.intense = !helicopterOn(d); save();
    await toast(ctx, d.intense ? t(ctx, 'تحليق مكثف: مروحيتان', 'Intensive flight: two helicopters') : t(ctx, 'مروحية واحدة', 'One helicopter'));
    await refreshCards(d);
  });
  bot.callbackQuery(/^nw:i:(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const d = await findDraft(ctx.match[1]);
    if (!d || d.type !== 'uav' || (d.status !== 'pending' && !d.test)) return toast(ctx, '');
    d.intense = !intenseOn(d); save();
    await toast(ctx, t(ctx, d.intense ? 'مكثف: 2-3 مسيّرات فوق كل منطقة' : 'عادي: مسيّرة وحدة فوق كل منطقة', d.intense ? 'Intensive: 2-3 drones per area' : 'Normal: one drone per area'));
    try { await ctx.editMessageReplyMarkup({ reply_markup: cardKb(d, h.langOf(ctx), ctx.from.id) }); } catch { /* ignore */ }
  });
  bot.callbackQuery(/^nw:(rw|op|sa):(\w+)$/, async (ctx) => {
    const mode = ctx.match[1] === 'op' ? 'opinion' : ctx.match[1] === 'sa' ? 'satire' : 'news';
    if (!staff(ctx) || (mode !== 'news' && !privateOwner(ctx))) return toast(ctx, '');
    const d = await findDraft(ctx.match[2]);
    if (!d || d.status !== 'pending') return vanish(ctx, t(ctx, 'تمت معالجة هذه المسودة مسبقاً ✔️', 'This draft has already been handled ✔️'));
    const sourceText = String(d.sourceText || d.headline || '').trim();
    if (!sourceText) return toast(ctx, t(ctx, 'لا يوجد نص مصدر لإعادة صياغته', 'No source text is available to rewrite'), true);
    const reviewReason = mode === 'news' ? null : rewriteSourceReviewReason(sourceText);
    const applicable = mode === 'news' || privateEditorialModeApplicable(d);
    if (mode !== 'news' && (!applicable || reviewReason)) {
      return toast(ctx, t(ctx,
        'لا توجد وقائع مصدرية كافية لمعاينة نقد أو سخرية آمنة؛ بقي الخبر الوقائعي كما هو.',
        'The source lacks enough factual detail for a safe private critique or satire preview; the factual story is unchanged.'), true);
    }
    const preview = d.aiRewritePreview;
    const previewIsCurrent = preview && preview.mode === mode && preview.sourceText === sourceText && preview.baseHeadline === d.headline;
    const previewAlreadyApplied = preview?.applied && (mode === 'news' ? preview.text === d.headline : d.privateEditorial?.[mode] === preview.text);
    const lang = h.langOf(ctx);
    if (previewIsCurrent || previewAlreadyApplied) {
      await toast(ctx, '');
      return showRewritePreview(ctx, d, lang);
    }
    if (!R.rewriteImpl && !process.env.NEWS_REWRITE_GEMINI_API_KEY) {
      return toast(ctx, t(ctx,
        'إعادة الصياغة غير مفعّلة بعد: يلزم مفتاح Google AI Studio مجاني منفصل في NEWS_REWRITE_GEMINI_API_KEY، مع إيقاف الفوترة.',
        'Rewrite is not configured: add a separate free Google AI Studio key as NEWS_REWRITE_GEMINI_API_KEY with billing disabled.'), true);
    }
    if (d.aiRewriteBusy) return toast(ctx, t(ctx, 'إعادة الصياغة قيد التنفيذ', 'Rewrite is already running'));
    d.aiRewriteBusy = true;
    await toast(ctx, t(ctx, '🪄 جارٍ إعداد معاينة فقط…', '🪄 Preparing a preview only…'));
    try {
      let text = String(R.rewriteImpl
        ? await R.rewriteImpl(sourceText, { mode })
        : await rewriteArabicNews(sourceText, { key: process.env.NEWS_REWRITE_GEMINI_API_KEY, sourceName: d.srcs?.[0]?.name || '', mode }));
      const editorialReviewReason = mode === 'news' ? null : privateEditorialOutputReviewReason(sourceText, text);
      if (editorialReviewReason) {
        const error = new Error(editorialReviewReason);
        error.code = 'REWRITE_NOT_APPLICABLE';
        throw error;
      }
      text = finalizeRewriteOutput(text, mode, d.srcs?.[0]?.name || '');
      d.aiRewritePreview = {
        text, mode, sourceText, baseHeadline: d.headline, baseType: d.type, originalHeadline: d.headline,
        createdAt: Date.now(), applied: false,
      };
      save();
      await showRewritePreview(ctx, d, lang);
    } catch (error) {
      console.warn('[news] professional rewrite unavailable; draft unchanged');
      await toast(ctx, error?.code === 'REWRITE_NOT_APPLICABLE'
        ? t(ctx, 'لا توجد وقائع كافية لتكوين مادة خاصة آمنة؛ بقي الخبر الوقائعي كما هو.', 'There is not enough factual basis for safe private commentary; the factual story is unchanged.')
        : t(ctx, 'تعذرت إعادة الصياغة الآن؛ بقيت المسودة كما هي ولم يُنشر شيء.', 'Rewrite failed; the draft is unchanged and nothing was published.'), true);
    } finally {
      delete d.aiRewriteBusy;
    }
  });
  bot.callbackQuery(/^nw:oe:(\w+)$/, async (ctx) => {
    const userId = Number(ctx.from?.id);
    if (!h.owner(ctx) || !ownerIdsU().includes(userId) || ctx.chat?.type !== 'private' || Number(ctx.chat.id) !== userId) return toast(ctx, '');
    const d = await findDraft(ctx.match[1]);
    const preview = d?.aiRewritePreview;
    const sourceText = String(d?.sourceText || d?.headline || '').trim();
    if (!d || d.status !== 'pending' || preview?.mode !== 'opinion' || preview.applied || !preview.text) return toast(ctx, t(ctx, 'معاينة الرأي الخاصة لم تعد متاحة للتعديل', 'The private opinion preview is no longer editable'), true);
    if (preview.sourceText !== sourceText || preview.baseHeadline !== d.headline || (preview.baseType !== undefined && preview.baseType !== d.type) || !privateEditorialModeApplicable(d) || rewriteSourceReviewReason(sourceText)) return toast(ctx, t(ctx, 'هذه معاينة قديمة أو لم تعد مؤهلة؛ لم يتغير النص', 'This preview is stale or no longer eligible; no text was changed'), true);
    for (const draft of Object.values(newsState().drafts)) {
      if (draft.privateEditorialEdit?.userId === userId) delete draft.privateEditorialEdit;
    }
    d.privateEditorialEdit = {
      userId, draftId: d.id, mode: 'opinion', baseText: preview.text,
      sourceText, baseHeadline: d.headline, chatId: Number(ctx.chat.id),
      messageId: Number(ctx.callbackQuery.message?.message_id), expiresAt: Date.now() + PEND_MS,
      promptMessageIds: [],
    };
    save();
    await toast(ctx, '');
    const prompt = await ctx.reply(t(ctx,
      '✏️ <b>تعديل خاص للرأي/التحليل</b>\nأرسل كل تعديل في سطر بصيغة <code>العبارة الحالية =&gt; العبارة الجديدة</code>؛ يمكن تعديل كلمة واحدة أو أكثر. يجب أن تبقى الوقائع كما في المصدر، ولا يُسمح بتغيير الأرقام. أرسل <code>/cancel</code> أو اضغط زر الإلغاء. هذا التعديل خاص ولن يغيّر الخبر العام أو يُنشر.',
      '✏️ <b>Private opinion/analysis edit</b>\nSend each change on a new line as <code>current wording =&gt; replacement wording</code>; one or more words can be changed. Keep the facts from the source and do not change numbers. Send <code>/cancel</code> or tap Cancel. This stays private and will not change or publish the public story.'), {
      parse_mode: 'HTML', reply_markup: { force_reply: true, selective: true, input_field_placeholder: t(ctx, 'العبارة الحالية => الجديدة', 'current wording => replacement') },
    });
    if (prompt?.message_id) d.privateEditorialEdit.promptMessageIds.push(Number(prompt.message_id));
    save();
    try { await ctx.editMessageReplyMarkup({ reply_markup: rewritePreviewKb(d, h.langOf(ctx)) }); } catch { /* preview may have been removed */ }
  });
  bot.callbackQuery(/^nw:oc:(\w+)$/, async (ctx) => {
    const userId = Number(ctx.from?.id);
    if (!h.owner(ctx) || !ownerIdsU().includes(userId) || ctx.chat?.type !== 'private' || Number(ctx.chat.id) !== userId) return toast(ctx, '');
    const d = await findDraft(ctx.match[1]);
    const edit = d?.privateEditorialEdit;
    if (!d || d.status !== 'pending' || edit?.mode !== 'opinion' || edit.userId !== userId || edit.draftId !== d.id) return toast(ctx, '');
    delete d.privateEditorialEdit;
    save();
    for (const messageId of edit.promptMessageIds || []) {
      try { await ctx.api.deleteMessage(edit.chatId, messageId); } catch { /* already gone */ }
    }
    await toast(ctx, t(ctx, 'أُلغي التعديل؛ بقيت المعاينة كما هي', 'Edit cancelled; the preview is unchanged'));
    try { await ctx.editMessageText(rewritePreviewText(d, h.langOf(ctx)), { parse_mode: 'HTML', reply_markup: rewritePreviewKb(d, h.langOf(ctx)), link_preview_options: { is_disabled: true } }); } catch { /* preview may have been removed */ }
  });
  bot.callbackQuery(/^nw:ra:(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const d = await findDraft(ctx.match[1]);
    const preview = d?.aiRewritePreview;
    if (!d || d.status !== 'pending' || !preview?.text) return toast(ctx, t(ctx, 'المسودة أو المعاينة لم تعد متاحة', 'Draft or preview is no longer available'), true);
    if (['opinion', 'satire'].includes(preview.mode) && !privateOwner(ctx)) return toast(ctx, '');
    const sourceText = String(d.sourceText || d.headline || '').trim();
    if (preview.sourceText !== sourceText || preview.baseHeadline !== d.headline || (preview.baseType !== undefined && preview.baseType !== d.type)) return toast(ctx, t(ctx, 'هذه معاينة قديمة؛ أعد فتح المراجعة', 'This preview is out of date; reopen the draft'), true);
    if (['opinion', 'satire'].includes(preview.mode) && !privateEditorialModeApplicable(d)) return toast(ctx, t(ctx,
      'لم تعد هذه المسودة مؤهلة للنقد أو السخرية؛ بقي الخبر الوقائعي كما هو.',
      'This draft is no longer eligible for critique or satire; its factual story remains unchanged.'), true);
    if (preview.mode === 'news') {
      if (preview.applied && d.headline === preview.text) return toast(ctx, t(ctx, 'الصياغة مطبقة بالفعل؛ لم يُنشر شيء', 'Wording already applied; nothing was published'));
      d.originalHeadline ||= d.headline;
      d.headline = preview.text;
      // The channel post renders the body, not the headline: the approved rewrite must replace
      // both, otherwise the post goes out with the original text under a restyled lead.
      d.originalBody ||= d.body;
      d.body = preview.text;
    } else if (['opinion', 'satire'].includes(preview.mode)) {
      d.privateEditorial ||= {};
      d.privateEditorial[preview.mode] = preview.text;
      d.editorialHold = true;
      d.editorialHoldReason = 'owner-private-editorial-note';
      d.editorialHoldAt = Date.now();
      d.dayAutoAt = null;
      delete d.autoMode;
    } else return toast(ctx, t(ctx, 'نوع المعاينة غير صالح', 'Invalid preview mode'), true);
    preview.applied = true;
    preview.appliedAt = Date.now();
    save();
    // An applied preview gates publishing (and blocks auto-publish for opinion/satire): flush the
    // backup NOW so a restart in the next seconds cannot resurrect the original text as publishable.
    try { await store.flushBackup(true); } catch { /* the 15s debounced flush retries */ }
    await refreshCards(d);
    await toast(ctx, ['opinion', 'satire'].includes(preview.mode)
      ? t(ctx, 'حُفظت الملاحظة لك في البوت فقط؛ لم يتغير الخبر ولم يُرسل شيء إلى الخريطة أو الموقع أو القناة.', 'Saved privately for you in the bot; the factual story is unchanged and nothing was sent to the map, site, or channel.')
      : t(ctx, 'تم اعتماد الصياغة الخبرية في المسودة فقط — لم يُنشر شيء', 'Factual wording applied to the draft only — nothing was published'));
  });
  bot.callbackQuery(/^nw:rr:(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const d = await findDraft(ctx.match[1]);
    if (!d || d.status !== 'pending') return vanish(ctx, t(ctx, 'تمت معالجة هذه المسودة مسبقاً ✔️', 'This draft has already been handled ✔️'));
    await toast(ctx, t(ctx, 'تم الإبقاء على الصياغة الحالية', 'Kept the current wording'));
    await refreshCards(d);
  });
  bot.callbackQuery(/^nw:ro:(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const d = await findDraft(ctx.match[1]);
    if (!d || d.status !== 'pending') return vanish(ctx, t(ctx, 'تمت معالجة هذه المسودة مسبقاً ✔️', 'This draft has already been handled ✔️'));
    const preview = d.aiRewritePreview;
    if (['opinion', 'satire'].includes(preview?.mode) && !privateOwner(ctx)) return toast(ctx, '');
    if (['opinion', 'satire'].includes(preview?.mode)) {
      if (d.privateEditorial) delete d.privateEditorial[preview.mode];
      if (!Object.keys(d.privateEditorial || {}).length) delete d.privateEditorial;
      if (d.editorialHoldReason === 'owner-private-editorial-note') {
        delete d.editorialHold; delete d.editorialHoldReason; delete d.editorialHoldAt;
      }
      preview.applied = false;
      save();
      await refreshCards(d);
      return toast(ctx, t(ctx, 'حُذفت الملاحظة الخاصة؛ لم يتغير الخبر الوقائعي.', 'Private note deleted; the factual story is unchanged.'));
    }
    if (!d.originalHeadline || d.headline === d.originalHeadline) return toast(ctx, t(ctx, 'النص الحالي هو الصياغة الأصلية', 'The current wording is already the original'));
    d.headline = d.originalHeadline;
    d.originalHeadline = null;
    if ('originalBody' in d) { d.body = d.originalBody; delete d.originalBody; }
    if (d.aiRewritePreview) d.aiRewritePreview.applied = false;
    save();
    await refreshCards(d);
    await toast(ctx, t(ctx, 'استُعيدت الصياغة الأصلية؛ لم يُنشر شيء', 'Original wording restored; nothing was published'));
  });
  bot.callbackQuery(/^nw:c:(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const d = await findDraft(ctx.match[1]);
    if (!d || d.status !== 'pending') return vanish(ctx, t(ctx, 'تمت معالجة هذه المسودة مسبقاً ✔️', 'This draft has already been handled ✔️'));
    const duplicate = channelPublishedDuplicateDraft(d);
    const lang = h.langOf(ctx);
    await toast(ctx, duplicate ? t(ctx, 'الخبر منشور بالفعل', 'Already published') : t(ctx, 'لم يُعثر على تطابق', 'No match found'));
    const message = await ctx.reply(channelCheckText(duplicate, lang), { parse_mode: 'HTML', reply_markup: channelCheckKeyboard(d, duplicate, lang), _keep: 'c' });
    const card = cur(ctx);
    if (message?.message_id && card) {
      d.cards ||= [];
      if (!d.cards.some(([chat, id]) => chat === card[0] && id === message.message_id)) d.cards.push([card[0], message.message_id]);
      save();
    }
    return message;
  });
  bot.callbackQuery(/^nw:ed:(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const d = await findDraft(ctx.match[1]);
    if (!d || d.status !== 'published' || !d.auto || !d.alertId || !h.loadPublishedDraft) return toast(ctx, '');
    const current = h.getAlert?.(d.alertId);
    const latest = current
      ? { ...d, body: current.description || d.body, ...(d.type === 'breaking' ? { headline: current.description || d.headline } : {}) }
      : d;
    await toast(ctx, '');
    return h.loadPublishedDraft(ctx, toBotDraft(latest, { preservePublishedCopy: true }), d.alertId);
  });
  bot.callbackQuery(/^nw:(p|x|t|b|e):(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const [, act, id] = ctx.match;
    const d = await findDraft(id);
    if (!d) return vanish(ctx, t(ctx, 'هذه المسودة لم تعد متاحة', 'This draft is no longer available'));
    if (d.test && (act === 'p' || act === 'e')) {
      d.status = 'ignored'; await closeCards(d, cur(ctx), true); await unlinkCapturedMedia(d.sourceMedia); save();
      await vanish(ctx, t(ctx, '🧪 تجربة فقط — لم يُنشر شيء. الأزرار تعمل ✅', '🧪 Test only — nothing was published. Buttons work ✅'));
      forgetCurrentCard(d, ctx); save();
      return;
    }
    if (act === 't') { await toast(ctx, ''); try { await ctx.editMessageReplyMarkup({ reply_markup: typeKb(d, h.langOf(ctx)) }); } catch { /* ignore */ } return; }
    if (act === 'b') { await toast(ctx, ''); try { await ctx.editMessageReplyMarkup({ reply_markup: cardKb(d, h.langOf(ctx), ctx.from.id) }); } catch { /* ignore */ } return; }
    if (d.status !== 'pending') {
      const by = d.status === 'published' ? t(ctx, 'نُشرت مسبقاً ✔️', 'already published ✔️') : d.status === 'expired' ? t(ctx, 'انتهت صلاحيتها', 'expired') : t(ctx, 'تمت معالجتها مسبقاً ✔️', 'already handled ✔️');
      await closeCards(d, cur(ctx));
      await vanish(ctx, by);
      forgetCurrentCard(d, ctx); save();
      return;
    }
    if ((act === 'p' || act === 'e') && publicDraftCopyIssue(d)) {
      d.editorialHold = true;
      d.editorialHoldReason = 'private-editorial-copy-not-public';
      d.editorialHoldAt = Date.now();
      d.dayAutoAt = null;
      delete d.autoMode;
      save();
      await refreshCards(d);
      return toast(ctx, t(ctx, 'توقفت هذه المسودة: النص يحتوي رأياً خاصاً أو تشخيص مراجعة، ولم يُرسل إلى النشر العام.', 'Draft held: the text contains private opinion or a review diagnostic and was not sent to public publishing.'), true);
    }
    const n = newsState();
    if (act === 'x') {
      d.status = 'ignored'; d.by = ctx.from.id; n.stats.ignored++;
      save();
      await closeCards(d, cur(ctx), true);
      await unlinkCapturedMedia(d.sourceMedia);
      await vanish(ctx, t(ctx, 'تم التجاهل — لن يصلك هذا الحدث مرة ثانية', 'Ignored — this incident will not come back'));
      forgetCurrentCard(d, ctx); save();
      return;
    }
    let ownerEditorialSelection = null;
    if (act === 'p' && d.aiRewritePreview?.applied && ['opinion', 'satire'].includes(d.aiRewritePreview.mode)) {
      if (!h.owner(ctx) || !ownerIdsU().includes(Number(ctx.from.id))) return toast(ctx, t(ctx, 'نشر مادة الرأي/السخرية يحتاج موافقتك كمالك', 'Only the owner may publish opinion/satire'), true);
      ownerEditorialSelection = approvedOwnerEditorialCopy(d, ctx.from.id);
      if (!ownerEditorialSelection) return toast(ctx, t(ctx, 'المعاينة الخاصة قديمة أو غير مطابقة للاختيار؛ لم يُنشر شيء. أعد معاينتها قبل القرار.', 'The private preview is stale or no longer matches the selection; nothing was published. Create a fresh preview before deciding.'), true);
    }
    if (d.type === 'political' && !POLITICAL_CATEGORIES[d.politicalCategory] && (act === 'p' || act === 'e')) {
      return toast(ctx, t(ctx, 'اختر فئة سياسية صالحة قبل النشر أو التعديل', 'Choose a valid political category before publishing or editing'), true);
    }
    if (act === 'e') {
      d.status = 'editing'; d.by = ctx.from.id; save();
      await toast(ctx, '');
      const c = cur(ctx);
      await closeCards(d, c);
      if (c) setKeep('admin', c[0], c[1], false);
      return h.loadDraft(ctx, toBotDraft(d));
    }
    // Last-moment duplicate check also covers incidents that arrived on separate queue paths.
    const duplicate = knownDuplicateDraft(d);
    if (duplicate) {
      await suppressDuplicateDraft(d, duplicate, ctx.from.id);
      return toast(ctx, t(ctx, '✔️ مُنع النشر: هذا الحدث مسجل مسبقاً. لم يُحذف أي منشور.', '✔️ Publishing blocked: this event is already recorded. No post was deleted.'));
    }
    let publicationDraft;
    try {
      publicationDraft = toBotDraft(d, ownerEditorialSelection
        ? { editorialMode: ownerEditorialSelection.mode, ownerId: ctx.from.id }
        : {});
    } catch {
      return toast(ctx, t(ctx, 'تعذّر اعتماد نص النشر الحالي بأمان؛ لم يُنشر شيء.', 'The current publication copy could not be safely validated; nothing was published.'), true);
    }
    // Final-copy duplicate guard: the draft-level check above compares working headlines;
    // this one compares the actual text about to be posted against what the channel already carries.
    const finalDup = finalPublishDuplicate(d, publicationDraft);
    if (finalDup) {
      await suppressDuplicateDraft(d, { alertId: finalDup.id, kind: 'final-text' }, ctx.from.id);
      return toast(ctx, t(ctx, '✔️ مُنع النشر: هذه القصة منشورة مسبقاً على القناة. لم يُحذف أي منشور.', '✔️ Publishing blocked: this story is already posted on the channel. No post was deleted.'));
    }
    // publish: claimed once, so a second tap / a second reviewer can't publish it twice
    d.status = 'publishing'; save();
    await toast(ctx, t(ctx, '⏳ جاري النشر…', '⏳ Publishing…'));
    try { await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(t(ctx, '⏳ جاري النشر…', '⏳ Publishing…'), 'noop') }); } catch { /* ignore */ }
    let alert;
    try {
      alert = await h.publishDraft(ctx.api, publicationDraft, { id: ctx.from.id, name: ctx.from.first_name, via: 'news' });
    } catch (e) {
      d.status = 'pending'; save();
      console.error('[news] publish failed', e.description || e.message);
      try { await ctx.editMessageText(cardText(d, h.langOf(ctx)), { parse_mode: 'HTML', reply_markup: cardKb(d, h.langOf(ctx), ctx.from.id), link_preview_options: { is_disabled: true } }); } catch { /* ignore */ }
      return toast(ctx, t(ctx, '⚠️ تعذّر النشر — اضغط «نشر» مرة ثانية.', '⚠️ Publishing failed — tap Publish again.'), true);
    }
    // Same landed-dup sweep as the auto path: a story another draft posted moments
    // earlier is removed at once instead of staying up as a second copy.
    if (await autoDeleteLandedDuplicate(d, publicationDraft, alert?.id)) {
      return toast(ctx, t(ctx, '✔️ حُذف مكرر فوراً: هذه القصة منشورة مسبقاً على القناة.', '✔️ Duplicate deleted immediately: this story is already posted on the channel.'), true);
    }
    d.status = 'published'; d.alertId = alert?.id; d.postId = alert?.channel_message_id || null; d.by = ctx.from.id; d.publishedHeadline = publicationDraft.headline || d.headline;
    await unlinkCapturedMedia(d.sourceMedia);
    d.approvedBy = { id: ctx.from.id, name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '), username: ctx.from.username || null };
    d.approvedAt = new Date().toISOString(); n.stats.published++;
    save();
    const reviewer = d.approvedBy.username ? `@${d.approvedBy.username}` : d.approvedBy.name;
    for (const ownerId of ownerIdsU()) {
      if (Number(ownerId) === Number(ctx.from.id)) continue;
      const ownerLang = langOfId(ownerId);
      const ownerText = tr(ownerLang, `<b>✅ نُشر تنبيه جديد على الخريطة</b>\n${esc(d.publishedHeadline || d.headline || d.title || '')}\n📍 ${esc(whereOf(locsOf(d.loc, d.extra)))}\nالمشرف: ${esc(reviewer || String(ctx.from.id))}\nالوقت: ${esc(new Date(d.approvedAt).toLocaleString('ar-SY', { timeZone: 'Asia/Damascus' }))}`, `<b>✅ New alert published to the map</b>\n${esc(d.publishedHeadline || d.headline || d.title || '')}\n📍 ${esc(whereOf(locsOf(d.loc, d.extra)))}\nApproved by: ${esc(reviewer || String(ctx.from.id))}\n${esc(new Date(d.approvedAt).toLocaleString('en-GB', { timeZone: 'Asia/Damascus' }))}`);
      try { await ctx.api.sendMessage(ownerId, ownerText, { parse_mode: 'HTML', reply_markup: publishedLinksKb(d, alert, ownerLang, true), link_preview_options: { is_disabled: true }, _keep: 'c' }); } catch (e) { console.warn('[news] owner approval notification failed', e.message); }
    }
    // A map-only publish is a FAILURE, never a silent success: warn every owner
    // with the reason and require a manual retry; no automatic retry is scheduled.
    if (alert && !alert.channel_message_id) {
      const why = alert.channel_post_failed?.why || 'unknown error';
      for (const ownerId of ownerIdsU()) {
        const ol = langOfId(ownerId);
        try { await ctx.api.sendMessage(ownerId, tr(ol, `⚠️ <b>تنبيه نُشر على الخريطة فقط — تعذّر نشره في القناة</b>\n${esc(d.publishedHeadline || d.headline || '')}\nالسبب: ${esc(why)}\nلا توجد إعادة تلقائية؛ أعد محاولة منشور القناة يدوياً بعد التأكد من أن بوت النشر مشرف ولديه صلاحية نشر الرسائل. لا تُعِد إنشاء تنبيه الخريطة.`, `⚠️ <b>Alert published to the map only — the channel post failed</b>\n${esc(d.publishedHeadline || d.headline || '')}\nReason: ${esc(why)}\nAutomatic retry is disabled; manually retry the channel post after confirming the publishing bot is a channel admin with post permission. Do not recreate the map alert.`), { parse_mode: 'HTML', _keep: 'c' }); } catch { /* ignore */ }
      }
    }
    await closeCards(d, cur(ctx), true);
    await unlinkCapturedMedia(d.sourceMedia);
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    forgetCurrentCard(d, ctx); save();
    const isOwner = ownerIdsU().includes(Number(ctx.from.id));
    const kb = publishedLinksKb(d, alert, h.langOf(ctx), isOwner);
    const publishedType = editableDraftTypeLabel(d, h.langOf(ctx));
    await h.sendTransient(ctx.api, ctx.chat.id, t(ctx, `✅ تم النشر: ${typeOf(d.type).emoji} ${esc(publishedType)} — ${esc(whereOf(locsOf(d.loc, d.extra)))}`, `✅ Published: ${typeOf(d.type).emoji} ${esc(publishedType)}`), { parse_mode: 'HTML', reply_markup: kb });
  });
  bot.callbackQuery(/^nw:pc:(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const d = await findDraft(ctx.match[1]);
    if (!d || d.type !== 'political' || d.status !== 'pending') return toast(ctx, '');
    await toast(ctx, '');
    try { await ctx.editMessageReplyMarkup({ reply_markup: politicalCategoryKb(d, h.langOf(ctx)) }); } catch { /* ignore */ }
  });
  bot.callbackQuery(/^nw:cd:(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const d = await findDraft(ctx.match[1]);
    if (!d || d.status !== 'pending') return toast(ctx, '');
    await toast(ctx, '');
    try { await ctx.editMessageReplyMarkup({ reply_markup: condemnKb(d, h.langOf(ctx)) }); } catch { /* ignore */ }
  });
  bot.callbackQuery(/^nw:cdv:(\w+):(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const [, id, key] = ctx.match;
    const d = await findDraft(id);
    if (!d || d.status !== 'pending') return toast(ctx, '');
    if (key === 'off') delete d.condemn;
    else if (condemnationKey(key)) d.condemn = key;
    else return toast(ctx, '');
    save();
    await toast(ctx, key === 'off' ? t(ctx, 'أُزيلت الإدانة', 'Condemnation removed') : t(ctx, 'أُرفقت الإدانة بنص النشر', 'Condemnation attached to the published text'));
    await refreshCards(d);
  });
  bot.callbackQuery(/^nw:ps:(\w+):(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const [, id, category] = ctx.match;
    const d = await findDraft(id);
    if (!d || d.type !== 'political' || d.status !== 'pending' || !POLITICAL_CATEGORIES[category]) return toast(ctx, '');
    d.politicalCategory = category;
    d.politicalNeedsCategory = false;
    save();
    await toast(ctx, h.langOf(ctx) === 'en' ? POLITICAL_CATEGORIES[category].en : POLITICAL_CATEGORIES[category].ar);
    await refreshCards(d);
  });
  bot.callbackQuery(/^nw:tg:(\w+):([a-z_]+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const [, id, group] = ctx.match;
    const d = await findDraft(id);
    if (!d || !Object.hasOwn(EDIT_TYPE_GROUPS, group)) return toast(ctx, '');
    if (d.status !== 'pending') return vanish(ctx, t(ctx, 'تمت معالجة هذه المسودة مسبقاً ✔️', 'This draft has already been handled ✔️'));
    await toast(ctx, '');
    try { await ctx.editMessageReplyMarkup({ reply_markup: typeGroupKb(d, group, h.langOf(ctx)) }); } catch { /* ignore */ }
  });
  bot.callbackQuery(/^nw:tb:(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const d = await findDraft(ctx.match[1]);
    if (!d || d.status !== 'pending') return toast(ctx, '');
    await toast(ctx, '');
    try { await ctx.editMessageReplyMarkup({ reply_markup: typeKb(d, h.langOf(ctx)) }); } catch { /* ignore */ }
  });
  bot.callbackQuery(/^nw:si:(\w+):(general|soldiers|vehicles|barrier)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const [, id, kind] = ctx.match;
    const d = await findDraft(id);
    if (!d || d.status !== 'pending') return vanish(ctx, t(ctx, 'تمت معالجة هذه المسودة مسبقاً ✔️', 'This draft has already been handled ✔️'));
    d.type = 'military_incursion';
    if (kind === 'general') delete d.incursionKind;
    else d.incursionKind = kind;
    delete d.vehicleCount;
    save();
    await toast(ctx, `${kind === 'barrier' ? '🚧 ' : ''}${editableDraftTypeLabel(d, h.langOf(ctx))}`);
    await refreshCards(d);
  });
  bot.callbackQuery(/^nw:s:(\w+):(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const [, id, type] = ctx.match;
    const d = await findDraft(id);
    if (!d || !ALERT_TYPES[type]) return vanish(ctx, t(ctx, 'هذه المسودة لم تعد متاحة', 'This draft is no longer available'));
    if (d.status !== 'pending') return vanish(ctx, t(ctx, 'تمت معالجتها مسبقاً ✔️', 'already handled ✔️'));
    d.type = type;
    delete d.incursionKind;
    delete d.vehicleCount;
    if (type !== 'political') { delete d.politicalCategory; delete d.politicalNeedsCategory; }
    else d.politicalNeedsCategory = !POLITICAL_CATEGORIES[d.politicalCategory];
    save();
    await toast(ctx, `${ALERT_TYPES[type].emoji} ${en(ctx) ? ALERT_TYPES[type].en : ALERT_TYPES[type].ar}`);
    await refreshCards(d);
  });
  // 🌙 undo an overnight auto-published alert (owner only): removed from the map and its channel post deleted
  bot.callbackQuery(/^nw:u:(\w+)$/, async (ctx) => {
    if (!h.owner(ctx)) return toast(ctx, t(ctx, 'للمالك فقط', 'Owner only'));
    const d = await findDraft(ctx.match[1]);
    if (!d || !d.auto) return vanish(ctx, t(ctx, 'هذا المنشور لم يعد متاحاً', 'No longer available'));
    if (d.undone) return toast(ctx, t(ctx, 'تم التراجع مسبقاً ✔️', 'Already undone ✔️'));
    try {
      const { deleteAlertEverywhere } = await import('./bot.js');
      if (d.alertId) await deleteAlertEverywhere(ctx.api, d.alertId);
    } catch (e) {
      console.error('[news] night undo failed', e.description || e.message);
      return toast(ctx, t(ctx, '⚠️ تعذّر الحذف — جرّب مرة ثانية', '⚠️ Could not remove — try again'), true);
    }
    d.undone = Date.now(); d.status = 'ignored'; d.by = ctx.from.id; save(); // stays known: the same event won't come back
    for (const [chat, mid] of d.notices || []) {
      const lang = langOfId(chat);
      try { await ctx.api.editMessageText(chat, mid, noticeText(d, lang), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }); } catch { /* gone */ }
    }
    await toast(ctx, t(ctx, '↩️ حُذف من القناة والخريطة', '↩️ Removed from the channel and the map'));
  });
  bot.callbackQuery('noop', (ctx) => toast(ctx, ''));

  // ---- owner settings: 📡 الرصد الإخباري
  const ago = (ts, ctx) => {
    if (!ts) return t(ctx, 'لم يبدأ بعد', 'not yet');
    const s = Math.round((Date.now() - ts) / 1000);
    return s < 90 ? t(ctx, `قبل ${s} ث`, `${s}s ago`) : t(ctx, `قبل ${Math.round(s / 60)} د`, `${Math.round(s / 60)} min ago`);
  };
  const mainText = (ctx) => {
    const n = newsState();
    const on = n.sources.filter((s) => s.on).length;
    const ty = NEWS_TYPES.filter((k) => n.types[k]).length;
    const pending = Object.values(n.drafts).filter((d) => d.status === 'pending' && !d.test).length;
    const ai = !NEWS_CFG.aiKey() ? t(ctx, '⚙️ تصنيف بسيط (لا يوجد مفتاح Gemini)', '⚙️ simple rules (no Gemini key)')
      : R.aiOk === false ? t(ctx, '⚠️ Gemini لا يستجيب الآن — تصنيف بسيط مؤقتاً', '⚠️ Gemini not answering — simple rules for now')
        : t(ctx, '🧠 Gemini ✅', '🧠 Gemini ✅');
    const bad = n.sources.filter((s) => s.on && R.src[s.u] && !R.src[s.u].ok).length;
    return [
      t(ctx, '📡 <b>الرصد الإخباري التلقائي</b>', '📡 <b>Automatic news monitor</b>'),
      '',
      t(ctx, 'السيرفر يتابع قنوات الأخبار السورية على مدار الساعة، وكل حدث جديد في سوريا يصلك هنا كمسودة جاهزة فيها النوع والمكان والمصادر. <b>بالنهار، الخبر المؤهل غير السياسي يُنشر تلقائياً بعد دقيقتين إذا ما راجعته؛ وبالليل قد يُنشر السياسي فقط إذا كان تصنيف Gemini حقيقياً، وفئته محددة، ومكانه السوري واضح، ومصدره مستوفياً للشروط. غير ذلك يبقى للمراجعة البشرية.</b> والحدث المكرر (نُشر، أو وصلك، أو تجاهلته) لا يصلك مرة ثانية.',
        'The server watches Syrian news channels around the clock; each new incident arrives as a ready draft (type, place, sources). <b>By day, eligible non-political news may auto-publish after 2 minutes if you have not reviewed it. At night, political news may publish only with a real Gemini classification, a valid category, a specific Syrian place, and the existing source checks; otherwise it stays for human review.</b> Repeated incidents never come twice.'),
      '',
      `${t(ctx, 'الحالة', 'Status')}: ${n.on ? t(ctx, '✅ يعمل', '✅ running') : t(ctx, '⏸ متوقف', '⏸ paused')}${n.on ? ` · ${t(ctx, 'آخر فحص', 'last check')} ${ago(R.lastPollAt, ctx)}` : ''}`,
      `${t(ctx, 'التصنيف', 'Classification')}: ${ai}`,
      `🌙 ${t(ctx, 'النشر الليلي', 'Night auto-publish')}: ${n.night.on ? `✅ ${n.night.from}–${n.night.to}${nightActive() ? t(ctx, ' (فعّال الآن)', ' (active now)') : ''}` : t(ctx, '⏸ متوقف', '⏸ off')}`,
      `📰 ${t(ctx, 'المصادر المفعّلة', 'Active sources')}: ${on} / ${n.sources.length}${bad ? t(ctx, ` (⚠️ ${bad} لا يُقرأ حالياً)`, ` (⚠️ ${bad} unreadable now)`) : ''}`,
      `🏷 ${t(ctx, 'الأنواع المرصودة', 'Watched types')}: ${ty} / ${NEWS_TYPES.length}`,
      `📊 ${t(ctx, 'اليوم (بتوقيت دمشق)', 'Today (Damascus time)')}: ${t(ctx, 'مسودات', 'drafts')} ${n.stats.drafts} · ${t(ctx, 'نُشر', 'published')} ${n.stats.published} · ${t(ctx, 'تُجوهل', 'ignored')} ${n.stats.ignored} · ${t(ctx, 'تكرار مُنع', 'duplicates stopped')} ${n.stats.merged + n.stats.dupes}${pending ? ` · ${t(ctx, 'بانتظارك', 'waiting')} ${pending}` : ''}`,
    ].join('\n');
  };
  const mainKb = (ctx) => {
    const n = newsState();
    return new InlineKeyboard()
      .text(n.on ? t(ctx, '⏸ إيقاف الرصد', '⏸ Pause monitoring') : t(ctx, '▶️ تشغيل الرصد', '▶️ Resume monitoring'), n.on ? 'nws:off' : 'nws:on').row()
      .text(t(ctx, '📰 المصادر', '📰 Sources'), 'nws:src').text(t(ctx, '🏷 الأنواع', '🏷 Types'), 'nws:ty').row()
      .text(t(ctx, '💼 رصد الوظائف', '💼 Jobs monitor'), 'j:menu').row()
      .text(t(ctx, '➕ إضافة مصدر', '➕ Add a source'), 'nws:sa:main').row()
      .text(`🌙 ${t(ctx, 'النشر الليلي', 'Night auto-publish')}: ${n.night.on ? `✅ ${n.night.from}–${n.night.to}` : '⏸'}`, 'nws:ng').row()
      .text(t(ctx, '🧪 إرسال مسودة تجريبية', '🧪 Send a test draft'), 'nws:test').row()
      .text(t(ctx, '🔄 تحديث', '🔄 Refresh'), 'nws').text(t(ctx, '🏠 القائمة', '🏠 Menu'), 'home');
  };
  const srcText = (ctx) => {
    const n = newsState();
    const lines = [t(ctx, `📰 <b>مصادر الرصد</b> (${n.sources.length})`, `📰 <b>Monitored sources</b> (${n.sources.length})`), '',
      t(ctx, 'اضغط اسم المصدر لإيقافه أو تشغيله، ، و📍/🏛 لتعليمه مصدراً محلياً (ناشط، أقل موثوقية) أو رئيسياً، و🗑 لحذفه. أي قناة تيليغرام <b>عامة</b> تصلح مصدراً.', 'Tap a source to pause/resume it, 📍/🏛 to mark it local (activist, less reliable) or main, 🗑 to remove it. Any <b>public</b> Telegram channel works.'), ''];
    for (const s of n.sources) {
      const st = R.src[s.u];
      const health = !s.on ? '⏸' : !st ? '…' : st.ok ? '✓' : '⚠️';
      lines.push(`${s.on ? '✅' : '⏸'} ${esc(s.name)} — <a href="https://t.me/${esc(s.u)}">@${esc(s.u)}</a> ${health}${s.local ? t(ctx, ' <i>(محلي/ناشط)</i>', ' <i>(local/activist)</i>') : ''}${s.general ? t(ctx, ' <i>(عامة: أخبار سوريا فقط)</i>', ' <i>(general: Syria only)</i>') : ''}`);
    }
    return lines.join('\n');
  };
  const srcKb = (ctx) => {
    const n = newsState();
    const kb = new InlineKeyboard();
    for (const s of n.sources) kb.text(`${s.on ? '✅' : '⏸'} ${s.name}`.slice(0, 40), 'nws:sv:' + s.u).text(s.local ? t(ctx, '📍 محلي', '📍 local') : t(ctx, '🏛 رئيسي', '🏛 main'), 'nws:sl:' + s.u).text('🗑', 'nws:sd:' + s.u).row();
    if (n.sources.length < NEWS_CFG.maxSources) kb.text(t(ctx, '➕ إضافة مصدر', '➕ Add a source'), 'nws:sa').row();
    kb.text(t(ctx, '♻️ المصادر الافتراضية', '♻️ Default sources'), 'nws:sr').row();
    return kb.text(t(ctx, '↩️ رجوع', '↩️ Back'), 'nws');
  };
  const tyText = (ctx, group = null) => group
    ? t(ctx, '🏷 <b>الأنواع المرصودة</b>\n\nاضغط النوع لتشغيل أو إيقاف رصده. الأنواع الموقوفة لا تصلك منها مسودات.', '🏷 <b>Watched types</b>\n\nTap a type to switch it on/off. No drafts arrive for switched-off types.')
    : t(ctx, '🏷 <b>الأنواع المرصودة</b>\n\nاختر مجموعة لعرض أنواعها، ثم اضغط النوع لتشغيل أو إيقاف رصده.', '🏷 <b>Watched types</b>\n\nChoose a group to see its types, then tap a type to switch monitoring on or off.');
  const tyKb = (ctx) => {
    const n = newsState();
    const kb = new InlineKeyboard();
    const lang = en(ctx) ? 'en' : 'ar';
    const groups = newsTypeGroupKeys();
    groups.forEach((group, i) => {
      const types = NEWS_TYPE_GROUPS[group];
      const active = types.filter((type) => n.types[type]).length;
      kb.text(`${newsGroupLabel(group, lang)} (${active}/${types.length})`, `nws:tg:${group}`);
      if (i % 2 === 1 && i < groups.length - 1) kb.row();
    });
    if (groups.length % 2 === 1) kb.row();
    return kb.text(t(ctx, '↩️ رجوع', '↩️ Back'), 'nws');
  };
  const tyGroupKb = (ctx, group) => {
    const n = newsState();
    const types = NEWS_TYPE_GROUPS[group] || [];
    const lang = en(ctx) ? 'en' : 'ar';
    const kb = new InlineKeyboard();
    types.forEach((type, i) => {
      kb.text(`${n.types[type] ? '✅' : '⏸'} ${quoteChoice(alertButtonLabel(type, lang), lang)}`, `nws:tt:${type}`);
      if (i % 2 === 1 && i < types.length - 1) kb.row();
    });
    if (types.length % 2 === 1 || types.length === 0) kb.row();
    return kb.text(t(ctx, '↩️ مجموعات الأنواع', '↩️ Type groups'), 'nws:ty');
  };
  const ngText = (ctx) => {
    const g = newsState().night;
    return [
      t(ctx, '🌙 <b>النشر الليلي التلقائي</b>', '🌙 <b>Night auto-publish</b>'),
      '',
      t(ctx, 'بهالساعات (بتوقيت دمشق) المسودات المؤهلة بتنزل لحالها عالقناة والخريطة بنفس القالب وصورة الخريطة. الخبر السياسي ما بينزل تلقائياً بالنهار؛ بالليل ممكن ينزل فقط إذا كان تصنيف Gemini حقيقياً وفئته ومكانه السوري المحدد ومصدره مستوفية الشروط، وإلا بيبقى للمراجعة.',
        'During these hours (Damascus time), eligible drafts publish to the channel and map with the usual template. Political news is not auto-published during the day; at night it qualifies only with a real Gemini classification, valid category, specific Syrian place, and the existing source checks. Otherwise it stays for review.'),
      '',
      t(ctx, '• بينشر الخبر المؤهل فقط؛ خبر من مصدر محلي/ناشط وحيد أو تصنيف بسيط بدون Gemini بيضل مسودة. الخبر السياسي غير المحدد الفئة أو الموقع، أو اللي ما استوفى شروط المصدر، بيضل للمراجعة.', '• Only eligible drafts auto-publish. A single local/activist source or rules-only classification stays a draft; political news with a missing category or place, or that fails the source checks, stays for review.'),
      t(ctx, '• كل منشور تلقائي بيوصلك إشعار صامت فيه زر ↩️ تراجع (بيحذفه من القناة والخريطة).', '• Each auto-post sends you a silent notice with ↩️ Undo (removes it from the channel and map).'),
      t(ctx, '• بلاغات بوت التبليغ ما بتنتشر تلقائياً — بتضل لمراجعتك.', '• Report-bot reports are never auto-published — they stay for your review.'),
      '',
      `${t(ctx, 'الحالة', 'Status')}: <b>${g.on ? t(ctx, '✅ مفعّل', '✅ on') : t(ctx, '⏸ متوقف', '⏸ off')}</b>${g.on && nightActive() ? t(ctx, ' · فعّال الآن', ' · active now') : ''}`,
      `${t(ctx, 'الساعات', 'Hours')}: <b>${g.from} – ${g.to}</b> ${t(ctx, 'بتوقيت دمشق', 'Damascus time')}`,
      `☀️ ${t(ctx, 'ملخص الصبح', 'Morning summary')} (${g.to}): <b>${g.summary ? t(ctx, '✅ مفعّل', '✅ on') : t(ctx, '⏸ متوقف', '⏸ off')}</b>`,
    ].join('\n');
  };
  const ngKb = (ctx) => {
    const g = newsState().night;
    const kb = new InlineKeyboard()
      .text(g.on ? t(ctx, '⏸ إيقاف النشر الليلي', '⏸ Turn off') : t(ctx, '▶️ تشغيل النشر الليلي', '▶️ Turn on'), g.on ? 'nws:ng:off' : 'nws:ng:on').row();
    kb.text(t(ctx, 'من:', 'From:'), 'noop');
    for (const x of NIGHT_FROM) kb.text(`${g.from === x ? '• ' : ''}${x}`, 'nws:ngf:' + x.replace(':', ''));
    kb.row().text(t(ctx, 'لـ:', 'To:'), 'noop');
    for (const x of NIGHT_TO) kb.text(`${g.to === x ? '• ' : ''}${x}`, 'nws:ngt:' + x.replace(':', ''));
    return kb.row()
      .text(`☀️ ${t(ctx, 'ملخص الصبح', 'Morning summary')}: ${g.summary ? '✅' : '⏸'}`, 'nws:ngs').row()
      .text(t(ctx, '↩️ رجوع', '↩️ Back'), 'nws');
  };
  const showNg = (ctx) => h.show(ctx, ngText(ctx), ngKb(ctx));
  const showMain = (ctx) => h.show(ctx, mainText(ctx), mainKb(ctx));
  const onlyOwner = async (ctx, fn) => { if (!h.owner(ctx)) { await toast(ctx, t(ctx, 'للمالك فقط', 'Owner only')); return; } return fn(); };

  bot.on('callback_query:data', async (ctx, next) => { if (!['nws:sa', 'nws:sa:main'].includes(ctx.callbackQuery.data)) pend.delete(ctx.from.id); return next(); });
  bot.command('news', (ctx) => (h.owner(ctx) ? showMain(ctx) : ctx.reply(h.L(ctx).onlyOwner)));
  bot.command('approvals', async (ctx) => {
    if (!staff(ctx) || ctx.chat?.type !== 'private') return;
    const rows = Object.values(newsState().drafts).filter((d) => d.status === 'published' && d.approvedAt)
      .sort((a, b) => Date.parse(b.approvedAt) - Date.parse(a.approvedAt)).slice(0, 20);
    const text = rows.length ? rows.map((d) => {
      const who = d.approvedBy?.username ? `@${d.approvedBy.username}` : (d.approvedBy?.name || `ID ${d.by || d.approvedBy?.id || '?'}`);
      const when = new Date(d.approvedAt).toLocaleString('ar-SY', { timeZone: 'Asia/Damascus' });
      return `• ${esc(d.headline || d.title || d.id)}\n  اعتمده: ${esc(who)} — ${esc(when)}`;
    }).join('\n\n') : 'لا توجد موافقات مسجلة بعد. سيبدأ السجل من الآن.';
    await ctx.reply(`<b>سجل اعتماد المنشورات — للمشرفين فقط</b>\n\n${text}`, { parse_mode: 'HTML' });
  });
  bot.callbackQuery('nws', (ctx) => onlyOwner(ctx, async () => { await toast(ctx, ''); await showMain(ctx); }));
  bot.callbackQuery(/^nws:(on|off)$/, (ctx) => onlyOwner(ctx, async () => {
    const n = newsState(); n.on = ctx.match[1] === 'on';
    if (n.on) { n.last = {}; R.queue = []; } // resume from "now": nothing old floods in after a pause
    save();
    await toast(ctx, n.on ? t(ctx, '▶️ عاد الرصد للعمل', '▶️ Monitoring resumed') : t(ctx, '⏸ تم إيقاف الرصد', '⏸ Monitoring paused'));
    await showMain(ctx);
  }));
  bot.callbackQuery('nws:ng', (ctx) => onlyOwner(ctx, async () => { await toast(ctx, ''); await showNg(ctx); }));
  bot.callbackQuery(/^nws:ng:(on|off)$/, (ctx) => onlyOwner(ctx, async () => {
    newsState().night.on = ctx.match[1] === 'on'; save();
    await toast(ctx, ctx.match[1] === 'on' ? t(ctx, '🌙 النشر الليلي مفعّل', '🌙 Night auto-publish on') : t(ctx, '⏸ النشر الليلي متوقف', '⏸ Night auto-publish off'));
    await showNg(ctx);
  }));
  bot.callbackQuery(/^nws:ng([ft]):(\d{4})$/, (ctx) => onlyOwner(ctx, async () => {
    const v = `${ctx.match[2].slice(0, 2)}:${ctx.match[2].slice(2)}`;
    const g = newsState().night;
    if (ctx.match[1] === 'f' && NIGHT_FROM.includes(v)) g.from = v;
    if (ctx.match[1] === 't' && NIGHT_TO.includes(v)) g.to = v;
    save(); await toast(ctx, `${g.from} – ${g.to}`); await showNg(ctx);
  }));
  bot.callbackQuery('nws:ngs', (ctx) => onlyOwner(ctx, async () => {
    const g = newsState().night; g.summary = !g.summary; save();
    await toast(ctx, g.summary ? '☀️ ✅' : '☀️ ⏸'); await showNg(ctx);
  }));
  bot.callbackQuery('nws:attr', (ctx) => onlyOwner(ctx, async () => { await toast(ctx, ''); await showMain(ctx); })); // old button (removed)
  bot.callbackQuery('nws:test', (ctx) => onlyOwner(ctx, async () => {
    await toast(ctx, t(ctx, '🧪 أرسلت مسودة تجريبية', '🧪 Test draft sent'));
    await sendTestDraft(ctx.from.id);
  }));
  bot.callbackQuery('nws:ty', (ctx) => onlyOwner(ctx, async () => { await toast(ctx, ''); await h.show(ctx, tyText(ctx), tyKb(ctx)); }));
  bot.callbackQuery(/^nws:tg:([a-z_]+)$/, (ctx) => onlyOwner(ctx, async () => {
    const group = ctx.match[1];
    if (!Object.hasOwn(NEWS_TYPE_GROUPS, group)) return toast(ctx, '');
    await toast(ctx, ''); await h.show(ctx, tyText(ctx, group), tyGroupKb(ctx, group));
  }));
  bot.callbackQuery(/^nws:tt:(\w+)$/, (ctx) => onlyOwner(ctx, async () => {
    const k = ctx.match[1]; const n = newsState();
    if (NEWS_TYPES.includes(k)) { n.types[k] = !n.types[k]; save(); }
    const group = typeMenuGroupOf(k);
    await toast(ctx, '✅');
    if (NEWS_TYPE_GROUPS[group]) await h.show(ctx, tyText(ctx, group), tyGroupKb(ctx, group));
    else await h.show(ctx, tyText(ctx), tyKb(ctx));
  }));
  bot.callbackQuery('nws:src', (ctx) => onlyOwner(ctx, async () => { await toast(ctx, ''); await h.show(ctx, srcText(ctx), srcKb(ctx)); }));
  // 📍 local/activist ⇄ 🏛 main source: local ones are labelled in drafts and handled more strictly
  bot.callbackQuery(/^nws:sl:(\w+)$/, (ctx) => onlyOwner(ctx, async () => {
    const n = newsState(); const s = n.sources.find((x) => x.u === ctx.match[1]);
    if (s) { s.local = !s.local; if (s.local) s.general = true; save(); }
    await toast(ctx, s ? (s.local ? t(ctx, `📍 ${s.name}: مصدر محلي/ناشط`, `📍 ${s.name}: local/activist`) : t(ctx, `🏛 ${s.name}: مصدر رئيسي`, `🏛 ${s.name}: main source`)) : '');
    await h.show(ctx, srcText(ctx), srcKb(ctx));
  }));
  bot.callbackQuery(/^nws:sv:(\w+)$/, (ctx) => onlyOwner(ctx, async () => {
    const n = newsState(); const s = n.sources.find((x) => x.u === ctx.match[1]);
    if (s) { s.on = !s.on; if (s.on) delete n.last[s.u]; save(); }
    await toast(ctx, s ? (s.on ? t(ctx, `✅ ${s.name}: يعمل`, `✅ ${s.name}: on`) : t(ctx, `⏸ ${s.name}: موقوف`, `⏸ ${s.name}: paused`)) : '');
    await h.show(ctx, srcText(ctx), srcKb(ctx));
  }));
  bot.callbackQuery(/^nws:sd:(\w+)$/, (ctx) => onlyOwner(ctx, async () => {
    const s = newsState().sources.find((x) => x.u === ctx.match[1]);
    await toast(ctx, '');
    if (!s) return h.show(ctx, srcText(ctx), srcKb(ctx));
    await h.show(ctx, t(ctx, `🗑 حذف المصدر <b>${esc(s.name)}</b> (@${esc(s.u)})؟`, `🗑 Remove <b>${esc(s.name)}</b> (@${esc(s.u)})?`),
      new InlineKeyboard().text(t(ctx, '🗑 نعم، احذفه', '🗑 Yes, remove'), 'nws:sdy:' + s.u).text(t(ctx, '↩️ لا', '↩️ No'), 'nws:src'));
  }));
  bot.callbackQuery(/^nws:sdy:(\w+)$/, (ctx) => onlyOwner(ctx, async () => {
    const n = newsState(); n.sources = n.sources.filter((x) => x.u !== ctx.match[1]); delete n.last[ctx.match[1]]; save();
    await toast(ctx, t(ctx, '🗑 تم الحذف', '🗑 Removed'));
    await h.show(ctx, srcText(ctx), srcKb(ctx));
  }));
  bot.callbackQuery('nws:sr', (ctx) => onlyOwner(ctx, async () => {
    const n = newsState();
    for (const s of DEFAULT_SOURCES) if (!n.sources.some((x) => x.u.toLowerCase() === s.u.toLowerCase())) n.sources.push({ ...s, on: true });
    for (const s of n.sources) if (DEFAULT_SOURCES.some((x) => x.u === s.u) && !s.on) { s.on = true; delete n.last[s.u]; }
    save();
    await toast(ctx, t(ctx, '♻️ أُعيدت المصادر الافتراضية', '♻️ Default sources restored'));
    await h.show(ctx, srcText(ctx), srcKb(ctx));
  }));
  const addSourcePrompt = (ctx, backTo) => onlyOwner(ctx, async () => {
    await toast(ctx, '');
    pend.set(ctx.from.id, { k: 'add', exp: Date.now() + PEND_MS });
    await h.show(ctx, t(ctx, '➕ <b>إضافة مصدر</b>\n\nأرسل معرّف قناة تيليغرام <b>عامة</b> أو رابطها، مثل:\n<code>@ajasyr</code> أو <code>https://t.me/ajasyr</code>', '➕ <b>Add a source</b>\n\nSend the username or link of a <b>public</b> Telegram channel, e.g.\n<code>@ajasyr</code> or <code>https://t.me/ajasyr</code>'),
      new InlineKeyboard().text(t(ctx, '↩️ رجوع', '↩️ Back'), backTo));
  });
  bot.callbackQuery('nws:sa', (ctx) => addSourcePrompt(ctx, 'nws:src'));
  bot.callbackQuery('nws:sa:main', (ctx) => addSourcePrompt(ctx, 'nws'));
  bot.on('message', async (ctx, next) => {
    const userId = Number(ctx.from?.id);
    const manualDraft = Object.values(newsState().drafts).find((draft) => draft.privateEditorialEdit?.userId === userId);
    if (manualDraft && h.owner(ctx) && ownerIdsU().includes(userId) && ctx.chat?.type === 'private' && Number(ctx.chat.id) === userId) {
      const edit = manualDraft.privateEditorialEdit;
      const text = String(ctx.message?.text || '').trim();
      const removeEditMessages = async (deleteIncoming = true) => {
        for (const messageId of edit.promptMessageIds || []) {
          try { await ctx.api.deleteMessage(edit.chatId, messageId); } catch { /* already gone */ }
        }
        if (deleteIncoming && ctx.message?.message_id) {
          try { await ctx.api.deleteMessage(edit.chatId, Number(ctx.message.message_id)); } catch { /* already gone */ }
        }
      };
      const restorePreview = async () => {
        try {
          await ctx.api.editMessageText(edit.chatId, edit.messageId, rewritePreviewText(manualDraft, langOfId(edit.chatId)), {
            parse_mode: 'HTML', reply_markup: rewritePreviewKb(manualDraft, langOfId(edit.chatId)), link_preview_options: { is_disabled: true },
          });
        } catch { /* preview may have been removed */ }
      };
      if (Date.now() > Number(edit.expiresAt || 0)) {
        delete manualDraft.privateEditorialEdit;
        save();
        await removeEditMessages(false);
        await restorePreview();
        return next();
      }
      if (/^\/cancel(?:@\w+)?$/i.test(text)) {
        delete manualDraft.privateEditorialEdit;
        save();
        await removeEditMessages();
        await restorePreview();
        return;
      }
      if (text.startsWith('/')) return next();
      const preview = manualDraft.aiRewritePreview;
      const sourceText = String(manualDraft.sourceText || manualDraft.headline || '').trim();
      const isCurrent = manualDraft.status === 'pending' && preview?.mode === 'opinion' && !preview.applied
        && preview.sourceText === sourceText && preview.sourceText === edit.sourceText
        && preview.baseHeadline === manualDraft.headline && preview.baseHeadline === edit.baseHeadline
        && (preview.baseType === undefined || preview.baseType === manualDraft.type)
        && preview.text === edit.baseText && privateEditorialModeApplicable(manualDraft)
        && !rewriteSourceReviewReason(sourceText);
      if (!isCurrent) {
        delete manualDraft.privateEditorialEdit;
        save();
        await removeEditMessages();
        await restorePreview();
        await ctx.reply(t(ctx, '⚠️ انتهت صلاحية المعاينة أو تغيّر مصدرها؛ أُلغيت التعديلات ولم يتغير النص.', '⚠️ The preview expired or its source changed; edits were cancelled and the text is unchanged.'));
        return;
      }
      const result = applyPrivateOpinionReplacements(edit.baseText, text);
      if (!result.ok) {
        const reason = {
          'format': ['استخدم الصيغة: العبارة الحالية => العبارة الجديدة.', 'Use: current wording => replacement wording.'],
          'not-found': ['لم أجد العبارة الحالية كما كُتبت في المعاينة؛ لم يتغير النص.', 'That exact current wording was not found; the preview is unchanged.'],
          'ambiguous': ['تتكرر العبارة الحالية؛ اختر عبارة أدق لتجنب استبدال غير مقصود.', 'That wording occurs more than once; use a more specific phrase.'],
          'numbers': ['لا يمكن تغيير الأرقام؛ يجب أن تبقى الوقائع الرقمية كما في المعاينة والمصدر.', 'Numbers cannot be changed; factual figures must remain as in the preview and source.'],
          'edit-count': ['أرسل من سطر واحد إلى خمسة أسطر من التعديلات.', 'Send between one and five replacement lines.'],
          'replacement': ['اكتب عبارة قديمة وجديدة مختلفتين، كل منهما حتى 80 حرفاً.', 'Use distinct old and new wording, each up to 80 characters.'],
        }[result.reason] || ['لم يُقبل هذا التعديل الآمن؛ المعاينة لم تتغير.', 'This edit did not pass the safety check; the preview is unchanged.'];
        const prompt = await ctx.reply(t(ctx, `⚠️ ${reason[0]}\nأعد الإرسال بصيغة <code>العبارة الحالية =&gt; العبارة الجديدة</code> أو أرسل <code>/cancel</code>.`, `⚠️ ${reason[1]}\nResend as <code>current wording =&gt; replacement wording</code> or send <code>/cancel</code>.`), {
          parse_mode: 'HTML', reply_markup: { force_reply: true, selective: true, input_field_placeholder: t(ctx, 'العبارة الحالية => الجديدة', 'current wording => replacement') },
        });
        if (prompt?.message_id) edit.promptMessageIds.push(Number(prompt.message_id));
        save();
        return;
      }
      preview.text = result.text;
      preview.manuallyEdited = true;
      preview.manuallyEditedAt = Date.now();
      delete manualDraft.privateEditorialEdit;
      save();
      await removeEditMessages();
      await restorePreview();
      return;
    }
    const p = pend.get(ctx.from?.id);
    if (!p) return next();
    if (!h.owner(ctx) || Date.now() > p.exp) { pend.delete(ctx.from.id); return next(); }
    const txt = String(ctx.message.text || '').trim();
    if (txt.startsWith('/')) { pend.delete(ctx.from.id); return next(); }
    const u = parseUsername(txt);
    const n = newsState();
    if (!u) return ctx.reply(t(ctx, '⚠️ هذا ليس معرّف قناة. أرسل مثلاً @ajasyr أو https://t.me/ajasyr', '⚠️ Not a channel username. Send e.g. @ajasyr or https://t.me/ajasyr'));
    if (n.sources.some((s) => s.u.toLowerCase() === u.toLowerCase())) { pend.delete(ctx.from.id); await h.show(ctx, srcText(ctx), srcKb(ctx)); return h.sendTransient(ctx.api, ctx.chat.id, t(ctx, 'هذا المصدر موجود مسبقاً ✔️', 'Already in the list ✔️')); }
    let r;
    try { r = await fetchChannel(u); } catch (e) {
      return ctx.reply(e.code === 'nopreview'
        ? t(ctx, `⚠️ القناة @${u} غير موجودة أو ليست عامة (لا يمكن قراءتها بدون اشتراك). جرّب قناة أخرى.`, `⚠️ @${u} doesn't exist or isn't public. Try another channel.`)
        : t(ctx, '⚠️ تعذّر الوصول إلى تيليغرام الآن، حاول بعد قليل.', '⚠️ Could not reach Telegram, try again shortly.'));
    }
    if (!r.posts.length) return ctx.reply(t(ctx, `⚠️ القناة @${u} لا تعرض منشورات للعامة.`, `⚠️ @${u} shows no public posts.`));
    const sy = r.posts.filter((x) => mentionsSyria(x.text)).length / r.posts.length;
    const general = sy < 0.6; // mostly non-Syrian news: keep only posts about Syria
    pend.delete(ctx.from.id);
    n.sources.push({ u, name: (r.title || u).slice(0, 40), general, on: true });
    save();
    await h.show(ctx, srcText(ctx), srcKb(ctx));
    return h.sendTransient(ctx.api, ctx.chat.id, t(ctx, `✅ أُضيف «${esc(r.title || u)}» — يبدأ رصده من الآن${general ? ' (قناة عامة: أخبار سوريا فقط)' : ''}.`, `✅ Added “${esc(r.title || u)}” — monitored from now on.`), { parse_mode: 'HTML' });
  });
}
export const _test = { routePublicationGeography, politicalPublicationGeography, sourceFirstCandidate, sourceFirstGate, automaticPublicDraft, nonIncidentPlaceOnly, nightPublish, entityDuplicateDraft, personNameRuns, distinctPersons, nameRuns, normTokens, runHit, locsOf, geoOf, sameFamily, near, auditDraftForAutoPublish, dayAutoTick, mergeInto, editorialGate, privateEditorialModeApplicable, applyPrivateOpinionReplacements, knownDuplicateDraft, finalPublishDuplicate, autoDeleteLandedDuplicate, selfEchoOf, channelPublishedDuplicateDraft, channelCheckText, helicopterAuto, helicopterOn, helicopterLabel, channelCheckKeyboard, suppressDuplicateDraft, nightSummaryTick, noticeText, noticeKb, rescanIfFilterChanged, refreshPendingCardKeyboards, R, knownEvents, handleResult, processQueue, pollOnce, sweep, buildLocations, sameIncident, rememberAlert, cardText, cardKb, condemnKb, typeKb, typeGroupKb, editableTypeGroups: EDIT_TYPE_GROUPS, editableTypeDirectTypes: EDIT_TYPE_DIRECT_TYPES, editTypeMenu: EDIT_TYPE_MENU, incursionTypeChoices: INCURSION_TYPE_CHOICES, govCodeOf, explicitWeatherResult, refinePrimaryType, newsTypeGroups: NEWS_TYPE_GROUPS, filterVersion: FILTER_VER };
