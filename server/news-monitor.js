// 📡 News monitor: the server (Render, 24/7) reads public Syrian news channels every minute, turns
// each NEW incident into a ready-made alert draft and sends it to the owner + editors in the private
// publishing bot with ✅ Publish / ❌ Ignore; only qualified AI news has an automatic fallback.
// No duplicates: an incident reported by several channels arrives once (the card lists the sources);
// an incident that is already on the map / channel (also from human reports), already waiting as a
// draft or report, or already ignored never comes back, and follow-ups ("ارتفاع الحصيلة", "القبض على
// المنفذين", "مجدداً"...) of a known incident don't create new drafts.
import crypto from 'node:crypto';
import { InlineKeyboard } from 'grammy';
import { config, isOwner } from './config.js';
import { store } from './store.js';
import { ALERT_TYPES, typeOf, droneAuto, alertEmoji } from '../shared/types.js';
import { locationFrom, normalizeArabic, governorates, getGov } from './places.js';
import { DEFAULT_SOURCES, fetchChannel, cleanPostText,
 parseUsername } from './news-sources.js';
import { onRoadNewsPost, roadMonitorDebug, roadMonitorActivationTime } from './road-monitor.js';
import { onNewsPost as onPowerPost, takeMisroutedWeatherPower } from './services.js';
import { onBorderNews } from './borders.js';
import { FUEL_NEWS_RE } from './fuel.js';
import { fuelRecheckSoon } from './prices.js';
const FUEL_HOOK = { at: 0 };
const normalizeFuelText = (t) => String(t || '').replace(/[ًٌٍَُِّْـ]/g, '').replace(/\s+/g, ' ');
import { NEWS_TYPES, prefilter, buildPrompt, callGemini, resolvePlace, nameInText, ruleClassify, scanTextPlaces, aiStats, govCodeOf, mentionsSyria, refineType, weatherWarningInfo } from './news-ai.js';
import { setKeep } from './ui-clean.js';
import { setSourceNames, cleanAlertText } from './clean-text.js';

const env = (k, d) => (process.env[k] != null && process.env[k] !== '' ? Number(process.env[k]) : d);
// bump when the pre-filter / AI rules change: on the next start the posts of the last RESCAN_MIN minutes
// that the old filter skipped are looked at again (once), so nothing recent is lost by a rule fix
export const FILTER_VER = 5;
const RESCAN_MIN = 120;
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
  maxSources: 25,
};
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
  setSourceNames(n.sources.map((s) => s.name));
  n.attr = false; // published text never names a source (sources stay in the owner's draft card only)
  if (!n.last || typeof n.last !== 'object') n.last = {};
  if (!n.seen || typeof n.seen !== 'object') n.seen = {};
  if (!n.drafts || typeof n.drafts !== 'object') n.drafts = {};
  if (!Array.isArray(n.alerts)) n.alerts = [];
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
const reviewerIds = () => [...new Set([...config.ownerIds, ...store.state.editors])];
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
  if (!d || d.test || d.rule) return false;
  const ss = d.srcs || [];
  return ss.length >= 2 || ss.some((x) => !isLocalSrc(x));
}
/** Daytime uses the same AI and source-confidence gate as overnight auto-publishing. */
export function daytimeAutoEligible(d) { return Boolean(d && d.status === 'pending' && nightEligible(d)); }
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
const whereOf = (locs) => (locs.length ? locs.map((l) => [l.name_ar, l.scope !== 'governorate' ? l.governorate_ar : ''].filter(Boolean).join('، ')).join(' + ') : 'سوريا');
const AIR = new Set(['uav', 'warplane', 'missile']);
const STRIKE = new Set(['attack', 'artillery', 'explosion']);
const CIVIL = new Set(['civil', 'accident', 'fire', 'civil_plane', 'explosion']);
const WINDOW_MIN = { uav: 120, uav_strike: 120, warplane: 120, missile: 180, attack: 360, assassination: 360, artillery: 360, explosion: 360, civil: 360, accident: 360, fire: 360, civil_plane: 240, protest: 480, breaking: 360, weather: 720 };
const sameFamily = (a, b) => a === b || (AIR.has(a) && AIR.has(b)) || (STRIKE.has(a) && STRIKE.has(b)) || ((a === 'civil' || b === 'civil') && CIVIL.has(a) && CIVIL.has(b));
const tokens = (s) => new Set(N(s).split(' ').filter((w) => w.length >= 3).map((w) => (w.startsWith('ال') && w.length > 4 ? w.slice(2) : w)));
function textSim(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
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
  if (c.type === 'breaking' || k.type === 'breaking') {
    if (c.type !== k.type) return (bothKnownAndNear && sim >= 0.25) || (locationMissing && sim >= 0.85);
    return (bothKnownAndNear && sim >= 0.2) || (locationMissing && sim >= 0.85);
  }
  if (!sameFamily(c.type, k.type)) return false;
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
    out.push({ kind: 'draft', status: d.status, draftId: d.id, type: d.type, ts: d.ts || d.created, headline: d.headline, where: whereOf(locs), geo: geoOf(locs) });
  }
  for (const a of n.alerts) {
    if (a.ts < since || fromDraft.has(a.id)) continue;
    out.push({ kind: 'alert', status: 'published', type: a.type, ts: a.ts, headline: a.headline, where: a.where, geo: a.geo });
  }
  for (const rep of Object.values(store.state.reports || {})) {
    const d = rep?.draft;
    if (!d || !ALERT_TYPES[d.type] || (rep.created || 0) < since) continue;
    const locs = locsOf(d.location, d.extra);
    out.push({ kind: 'report', status: 'pending-report', type: d.type, ts: rep.created, headline: [typeOf(d.type).ar, d.text || d.details || '', whereOf(locs)].join(' '), where: whereOf(locs), geo: geoOf(locs) });
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
  n.alerts.push({ id: pa.id, type: pa.type, ts: Date.parse(pa.timestamp) || Date.now(), headline: [pa.title, pa.description || ''].join(' ').trim(), where: whereOf(locs), geo });
  save(false);
}

// ---------------------------------------------------------------- drafts & cards
const fmtLoc = (l) => (l.scope === 'governorate' ? `محافظة ${l.name_ar}` : l.scope === 'district' ? `منطقة ${l.name_ar}، ${l.governorate_ar}` : [l.name_ar, l.district_ar && l.district_ar !== l.name_ar ? l.district_ar : '', l.governorate_ar].filter(Boolean).join('، '));
function cardText(d, lang = 'ar') {
  const t = typeOf(d.type);
  const locs = locsOf(d.loc, d.extra);
  const lines = [];
  lines.push(d.test
    ? tr(lang, '🧪 <b>تجربة — هذه مسودة تجريبية، لن يُنشر شيء</b>', '🧪 <b>TEST — a test draft, nothing will be published</b>')
    : tr(lang, '📡 <b>رصد إخباري — مسودة جاهزة للنشر</b>', '📡 <b>News monitor — draft ready to publish</b>'));
  lines.push('', `<b>${alertEmoji({ type: d.type, hazard: d.hazard })} ${esc(lang === 'en' ? t.en : t.ar)}</b>`);
  if (locs.length > 1) {
    lines.push(`📍 <b>${tr(lang, `المناطق (${locs.length})`, `Areas (${locs.length})`)}:</b>`);
    for (const l of locs) lines.push(`• ${esc(fmtLoc(l))}`);
  } else lines.push(`📍 <b>${tr(lang, 'المكان', 'Place')}:</b> ${esc(locs[0] ? fmtLoc(locs[0]) : tr(lang, 'سوريا', 'Syria'))}`);
  lines.push(`📝 ${esc(d.headline)}`);
  if (d.type === 'weather' && d.body) lines.push('', esc(d.body));
  const isLocal = (s) => s.local || (newsState().sources.find((x) => x.u === s.u) || {}).local;
  const srcs = (d.srcs || []).map((s) => (s.url ? `<a href="${esc(s.url)}">${esc(s.name)}</a>` : esc(s.name)) + (isLocal(s) ? tr(lang, ' <i>(محلي)</i>', ' <i>(local)</i>') : ''));
  lines.push('', `🗞 <b>${tr(lang, `المصادر (${srcs.length})`, `Sources (${srcs.length})`)}:</b> ${srcs.join(' · ')}`);
  const nMain = (d.srcs || []).filter((s) => !isLocal(s)).length;
  if ((d.srcs || []).length >= 2) lines.push(tr(lang, `✅ <i>مؤكد من ${((k) => (k === 2 ? 'مصدرين' : k <= 10 ? `${k} مصادر` : `${k} مصدراً`))((d.srcs || []).length)}</i>`, `✅ <i>Confirmed by ${(d.srcs || []).length} sources</i>`));
  else if (!nMain) lines.push(tr(lang, '⚠️ <i>مصدر محلي/ناشط واحد — غير مؤكد بعد، تأكد قبل النشر.</i>', '⚠️ <i>Single local/activist source — not confirmed yet, check before publishing.</i>'));
  lines.push(`🕒 ${tr(lang, 'أول خبر', 'First report')}: ${esc(clock(d.ts || d.created))} ${tr(lang, '(بتوقيت دمشق)', '(Damascus time)')}`);
  if (d.rule) lines.push(tr(lang, '⚙️ <i>تصنيف آلي بسيط (الذكاء الاصطناعي غير متاح حالياً) — راجع النوع والمكان.</i>', '⚙️ <i>Simple automatic classification (AI unavailable) — check type and place.</i>'));
  return lines.join('\n');
}
function cardKb(d, lang = 'ar') {
  const kb = new InlineKeyboard()
    .text(tr(lang, '✅ نشر', '✅ Publish'), 'nw:p:' + d.id).text(tr(lang, '❌ تجاهل', '❌ Ignore'), 'nw:x:' + d.id).row()
    .text(tr(lang, '🏷 تغيير النوع', '🏷 Change type'), 'nw:t:' + d.id).text(tr(lang, '✏️ تعديل قبل النشر', '✏️ Edit first'), 'nw:e:' + d.id)
  ;
  // Telegram refuses a whole message when one button has an empty text: the extra row only for drones
  if (d.type === 'uav') kb.row().text(intenseLabel(d, lang), 'nw:i:' + d.id);
  return kb;
}
const intenseOn = (d) => (typeof d.intense === 'boolean' ? d.intense : droneAuto(d.headline) > 1);
const intenseLabel = (d, lang) => (lang === 'en' ? `🛸 Intensive flight: ${intenseOn(d) ? '✅ on' : '⬜ off'}` : `🛸 تحليق مكثف: ${intenseOn(d) ? '✅ مفعّل' : '⬜ لا'}`);
function typeKb(d, lang = 'ar') {
  const kb = new InlineKeyboard();
  NEWS_TYPES.forEach((k, i) => { kb.text(`${d.type === k ? '• ' : ''}${ALERT_TYPES[k].emoji} ${lang === 'en' ? ALERT_TYPES[k].button_en : ALERT_TYPES[k].button_ar}`, `nw:s:${d.id}:${k}`); if (i % 2 === 1) kb.row(); });
  return kb.row().text(tr(lang, '↩️ رجوع', '↩️ Back'), 'nw:b:' + d.id);
}
async function sendCards(d, only = null) {
  const a = api();
  if (!a) return 0;
  d.cards ||= [];
  let n = 0;
  for (const uid of only ? [only] : reviewerIds()) {
    const lang = langOfId(uid);
    try {
      const m = await a.sendMessage(uid, cardText(d, lang), { parse_mode: 'HTML', reply_markup: cardKb(d, lang), link_preview_options: { is_disabled: true }, disable_notification: nightActive(), _keep: 'c' });
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
    try { await a.editMessageText(chat, mid, cardText(d, lang), { parse_mode: 'HTML', reply_markup: cardKb(d, lang), link_preview_options: { is_disabled: true } }); } catch { /* not modified / gone */ }
  }
}
async function closeCards(d, keep = null) {
  const a = api();
  for (const [chat, mid] of d.cards || []) {
    setKeep('admin', chat, mid, false);
    if (keep && keep[0] === chat && keep[1] === mid) continue;
    if (!a) continue;
    try { await a.deleteMessage(chat, mid); } catch {
      try { await a.editMessageText(chat, mid, '✔️', {}); } catch { /* ignore */ }
    }
  }
  d.cards = keep ? (d.cards || []).filter(([c, m]) => c === keep[0] && m === keep[1]) : [];
}
// ---------------------------------------------------------------- 🌙 night auto-publish + owner notice (undo)
const postUrl = (mid) => (mid && String(config.channel || '').startsWith('@') ? `https://t.me/${config.channel.slice(1)}/${mid}` : '');
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
  const kb = new InlineKeyboard();
  const u = postUrl(d.postId);
  if (u) kb.url(tr(lang, '📣 المنشور', '📣 Post'), u);
  if (R.H?.mapUrl && d.alertId) kb.url(tr(lang, '🗺 على الخريطة', '🗺 On the map'), R.H.mapUrl(d.alertId, lang));
  return kb.row().text(tr(lang, '↩️ تراجع (حذف من القناة والخريطة)', '↩️ Undo (remove from channel + map)'), 'nw:u:' + d.id);
}
async function nightPublish(d) {
  const a = api();
  if (!a || !R.H?.publishDraft || d.status !== 'pending') return false;
  const n = newsState();
  const mode = d.autoMode === 'day' ? 'day' : 'night';
  d.status = 'publishing'; save();
  let alert;
  try {
    alert = await R.H.publishDraft(a, toBotDraft(d), { id: 0, name: 'رصد تلقائي', via: mode === 'day' ? 'news-day-fallback' : 'news-night' });
  } catch (e) {
    d.status = 'pending';
    if (mode === 'day') d.dayAutoAt = Date.now() + DAY_AUTO_DELAY_MS;
    save();
    console.error(`[news] ${mode} auto-publish failed`, e.description || e.message);
    return false;
  }
  d.status = 'published'; d.auto = true; d.autoMode = mode; d.autoAt = Date.now(); d.alertId = alert?.id; d.postId = alert?.channel_message_id || null;
  n.stats.published++; n.stats.auto = (n.stats.auto || 0) + 1;
  save();
  await closeCards(d); // a draft that was waiting (single local source, then confirmed) leaves the chat
  d.notices = [];
  for (const uid of ownerIdsU()) {
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
  for (const d of Object.values(n.drafts)) {
    if (!dayAutoReady(d, now)) continue;
    d.autoMode = 'day';
    await nightPublish(d);
  }
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
  for (const uid of ownerIdsU()) {
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

/** the bot's normal draft (same as a hand-made alert) from a news draft */
export function toBotDraft(d) {
  const n = newsState();
  const body = d.headline;
  return {
    type: d.type, mode: 'publish', step: 'preview', ttlMin: typeOf(d.type).ttlMin,
    location: d.loc || locationFrom({}), extra: d.extra || [],
    details: d.type === 'breaking' ? '' : (d.body || body), text: d.type === 'breaking' ? body : '',
    created: Date.now(), source: 'news',
    ...(d.type === 'weather' && d.hazard ? { meta: { hazard: d.hazard } } : {}),
    ...(typeof d.intense === 'boolean' ? { intense: d.intense } : {}),
  };
}

// ---------------------------------------------------------------- pipeline
function buildLocations(r, it) {
  const out = [];
  const add = (loc) => { if (loc && !out.some((x) => x.scope === loc.scope && x.name_ar === loc.name_ar && x.governorate === loc.governorate)) out.push(loc); };
  const govs = new Set();
  for (const p of (r.places || []).slice(0, 4)) {
    if (!p?.name) continue;
    if (!nameInText(p.name, it.text) && !(p.gov && nameInText(p.gov, it.text))) continue; // invented by the AI
    const x = resolvePlace(p);
    if (!x) continue;
    if (x.govCode) govs.add(x.govCode);
    let loc = locationFrom(x);
    // "بريف القنيطرة" -> the countryside, not the city of the same name
    if (loc && loc.scope === 'place' && loc.governorate_ar && N(loc.name_ar) === N(loc.governorate_ar)) {
      const g = N(loc.governorate_ar);
      const nt = N(it.text);
      if (nt.includes(N('ريف') + ' ' + g) && !nt.split(N('ريف') + ' ' + g).join(' ').split(' ').includes(g)) loc = locationFrom({ govCode: loc.governorate });
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
  let fine = out.filter((l) => l.scope !== 'governorate');
  if (fine.filter(isEndCity).length >= 1 && fine.length > 1) {
    const rest = fine.filter((l) => !isEndCity(l));
    fine = rest.length ? rest : fine.slice(0, 1);
  }
  const list = fine.length ? fine : out.slice(0, 1);
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
  d.srcs.push({ u: it.src.u, name: it.src.name, url: it.url, ts: it.ts, local: !!it.src.local });
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
function explicitWeatherResult(it) {
  const info = weatherWarningInfo(it.text);
  if (!info) return null;
  const nt = N(it.text);
  const gs = governorates.filter((g) => [g.ar, g.en, ...(g.alt || [])].some((x) => nt.includes(N(x)))).slice(0, 4);
  if (!gs.length) return null;
  return { i: it.i, event: true, type: 'weather', new_incident: true, same_as: null,
    places: gs.map((g) => ({ name: g.ar, gov: g.ar })), headline: weatherHeadline(info.hazard, gs), hazard: info.hazard };
}
async function handleResult(it, r, known, pmap) {
  const n = newsState();
  if (!r || !r.event || !NEWS_TYPES.includes(r.type)) { note(it, 'not an event'); return; }
  { const t2 = refineType(r.type, `${r.headline || ''}\n${it.text}`); if (t2 !== r.type) { note(it, `type ${r.type} -> ${t2}`); r.type = t2; } }
  // the AI linked it to a known incident / an earlier post of this batch
  let target = null;
  const m = String(r.same_as || '').trim().match(/^([EP])(\d+)$/i);
  if (m && m[1].toUpperCase() === 'E') target = known[Number(m[2]) - 1] || null;
  if (m && m[1].toUpperCase() === 'P') target = pmap.get(Number(m[2])) || null;
  let rejectedSameAs = false;
  const locs = buildLocations(r, it);
  const tidy = (x) => cleanAlertText(String(x || '').replace(/[\u0000-\u001F]/g, ' ')).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();
  const headline = (tidy(r.headline) || tidy(it.text.split('\n')[0])).slice(0, 160);
  const cand = { type: r.type, ts: it.ts, headline, geo: geoOf(locs) };
  if (target && !sameIncident(cand, target)) {
    note(it, `AI same_as rejected: event type/location/time mismatch (${r.same_as})`);
    target = null;
    rejectedSameAs = true;
  }
  if (!target) target = known.find((k) => sameIncident(cand, k)) || null;
  if (!target && r.new_incident === false && !rejectedSameAs) { pmap.set(it.i, null); n.stats.dupes++; note(it, `follow-up of an older incident (${r.same_as || '?'})`); return; }
  if (target) {
    pmap.set(it.i, target);
    const d = target.draftId ? n.drafts[target.draftId] : null;
    if (d && d.status === 'pending') { const added = await mergeInto(d, it, locs); note(it, added ? `merged into draft ${d.id}` : `same source, already in draft ${d.id}`); return; }
    n.stats.dupes++; note(it, `duplicate of ${target.kind} (${target.status})`); return;
  }
  if (!n.types[r.type]) { note(it, `type ${r.type} switched off`); return; }
  if (!locs.length && r.type !== 'breaking') { note(it, 'no place found'); return; }
  if (!mentionsSyria(it.text) && !locs.length) { note(it, 'not in Syria'); return; }
  if (capReached()) { note(it, 'hourly cap reached'); return; }
  const d = {
    id: rid(), type: r.type, loc: locs[0] || locationFrom({}), extra: locs.slice(1), headline,
    srcs: [{ u: it.src.u, name: it.src.name, url: it.url, ts: it.ts, local: !!it.src.local }], ts: it.ts, created: Date.now(), status: 'pending', cards: [], rule: !!r.rule,
    sourceText: String(it.text || '').slice(0, 1200), ...(r.type === 'weather' ? { hazard: r.hazard || weatherWarningInfo(it.text)?.hazard } : {}),
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
    R.queue = R.queue.filter((x) => Date.now() - x.ts < ((x.rescan ? RESCAN_MIN : NEWS_CFG.maxAgeMin) + 30) * 60_000);
    R.queue.sort((a, b) => a.ts - b.ts);
    const batch = R.queue.splice(0, 20);
    if (!batch.length) return;
    batch.forEach((it, k) => { it.i = k + 1; });
    const known = knownEvents(12).slice(0, 40);
    const key = NEWS_CFG.aiKey();
    let results = null;
    if (key && aiBudgetOk() && Date.now() - R.lastAiAt >= NEWS_CFG.aiMinGapMs) {
      R.lastAiAt = Date.now();
      aiStats.today++;
      try {
        const prompt = buildPrompt(
          batch.map((it) => ({ i: it.i, source: it.src.name, local: !!it.src.local, ago: `${Math.max(0, Math.round((Date.now() - it.ts) / 60000))} min ago`, text: it.text })),
          known.map((k, i) => ({ id: 'E' + (i + 1), type: k.type, where: k.where, ago: `${Math.round((Date.now() - k.ts) / 60000)} min ago`, headline: `${k.headline} [${k.status}]`.slice(0, 220) })),
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
        if (!p.ts || Date.now() - p.ts > RESCAN_MIN * 60_000) continue;
        const key = `${src.u}/${p.id}`;
        if (n.handled[key] || drafted.has(p.url)) continue;
        const c = cleanPostText(p.text);
        const f = prefilter(c.text, { general: !!src.general, breaking: c.breaking });
        if (!f.ok) continue;
        const h = textHash(c.text);
        n.seen[h] = Date.now(); n.handled[key] = Date.now();
        const it = { src: { u: src.u, name: src.name, local: !!src.local }, url: p.url, ts: p.ts, qAt: Date.now(), text: c.text, breaking: c.breaking, rescan: true };
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
async function pollOnce() {
  const n = newsState();
  if (!n.on || R.stopped) return;
  const roadActiveSince = roadMonitorActivationTime();
  R.lastPollAt = Date.now();
  const fresh = [];
  for (const src of n.sources.filter((s) => s.on)) {
    if (R.stopped) return;
    try {
      const r = await fetchChannel(src.u);
      R.src[src.u] = { ok: true, at: Date.now(), n: r.posts.length };
      const maxId = r.posts.reduce((m, p) => Math.max(m, p.id), 0);
      const last = n.last[src.u];
      if (last == null) { n.last[src.u] = maxId; continue; } // a new source: start from now, no backlog
      for (const p of r.posts) if (p.id > last) fresh.push({ src, p });
      if (maxId > last) n.last[src.u] = maxId;
    } catch (e) {
      R.src[src.u] = { ok: false, at: Date.now(), err: e.code === 'nopreview' ? 'no public preview' : String(e.message || e).slice(0, 80) };
    }
    await sleep(700);
  }
  save(false);
  for (const { src, p } of fresh) {
    n.stats.posts++;
    const it = { src: { u: src.u, name: src.name, local: !!src.local, roadOnly: !!src.roadOnly }, url: p.url, ts: p.ts || Date.now(), qAt: Date.now() };
    if (!p.ts || Date.now() - p.ts > NEWS_CFG.maxAgeMin * 60_000) { it.text = p.text; note(it, 'too old'); continue; }
    const c = cleanPostText(p.text);
    it.text = c.text; it.breaking = c.breaking;
    const h = textHash(c.text);
    if (it.ts >= roadActiveSince) {
      try { if (await onRoadNewsPost(it)) note(it, 'road update -> confirmed or owner review'); }
      catch (e) { console.warn('[news] road hook failed', e?.message || e); }
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
    if (d.status === 'pending' && now - d.created > life) { d.status = 'expired'; await closeCards(d); changed = true; }
    if (now - d.created > 26 * H_MS) { delete n.drafts[d.id]; changed = true; }
  }
  const before = n.alerts.length;
  n.alerts = n.alerts.filter((a) => now - a.ts < 26 * H_MS);
  for (const [h, t] of Object.entries(n.seen)) if (now - t > 48 * H_MS) { delete n.seen[h]; changed = true; }
  for (const [k, t] of Object.entries(n.handled || {})) if (now - t > 48 * H_MS) { delete n.handled[k]; changed = true; }
  if (changed || before !== n.alerts.length) save(false);
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
      const t2 = refineType(d.type, text);
      if (t2 === d.type) continue;
      console.log(`[news] draft ${d.id} re-tagged ${d.type} -> ${t2}`);
      d.type = t2;
      if (t2 === 'weather') d.hazard = weatherWarningInfo(text)?.hazard || d.hazard; else delete d.hazard;
      save();
      try { await refreshCards(d); } catch { /* ignore */ }
    }
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
  const findDraft = async (id) => {
    const n = newsState();
    if (!n.drafts[id] && store.backup) await store.mergeFromBackup().catch(() => {});
    return newsState().drafts[id] || null;
  };
  const cur = (ctx) => (ctx.callbackQuery?.message ? [ctx.callbackQuery.message.chat.id, ctx.callbackQuery.message.message_id] : null);
  const toast = async (ctx, text, alert = false) => { try { await ctx.answerCallbackQuery({ text, show_alert: alert }); } catch { /* answered */ } };
  const vanish = async (ctx, text) => {
    await toast(ctx, text);
    try { await ctx.deleteMessage(); } catch { try { await ctx.editMessageText('✔️'); } catch { /* ignore */ } }
  };
  bot.callbackQuery(/^nw:i:(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const d = await findDraft(ctx.match[1]);
    if (!d || d.type !== 'uav' || (d.status !== 'pending' && !d.test)) return toast(ctx, '');
    d.intense = !intenseOn(d); save();
    await toast(ctx, t(ctx, d.intense ? 'مكثف: 2-3 مسيّرات فوق كل منطقة' : 'عادي: مسيّرة وحدة فوق كل منطقة', d.intense ? 'Intensive: 2-3 drones per area' : 'Normal: one drone per area'));
    try { await ctx.editMessageReplyMarkup({ reply_markup: cardKb(d, h.langOf(ctx)) }); } catch { /* ignore */ }
  });
  bot.callbackQuery(/^nw:(p|x|t|b|e):(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const [, act, id] = ctx.match;
    const d = await findDraft(id);
    if (!d) return vanish(ctx, t(ctx, 'هذه المسودة لم تعد متاحة', 'This draft is no longer available'));
    if (d.test && (act === 'p' || act === 'e')) {
      d.status = 'ignored'; await closeCards(d, cur(ctx)); save();
      return vanish(ctx, t(ctx, '🧪 تجربة فقط — لم يُنشر شيء. الأزرار تعمل ✅', '🧪 Test only — nothing was published. Buttons work ✅'));
    }
    if (act === 't') { await toast(ctx, ''); try { await ctx.editMessageReplyMarkup({ reply_markup: typeKb(d, h.langOf(ctx)) }); } catch { /* ignore */ } return; }
    if (act === 'b') { await toast(ctx, ''); try { await ctx.editMessageReplyMarkup({ reply_markup: cardKb(d, h.langOf(ctx)) }); } catch { /* ignore */ } return; }
    if (d.status !== 'pending') {
      const by = d.status === 'published' ? t(ctx, 'نُشرت مسبقاً ✔️', 'already published ✔️') : d.status === 'expired' ? t(ctx, 'انتهت صلاحيتها', 'expired') : t(ctx, 'تمت معالجتها مسبقاً ✔️', 'already handled ✔️');
      await closeCards(d, cur(ctx));
      return vanish(ctx, by);
    }
    const n = newsState();
    if (act === 'x') {
      d.status = 'ignored'; d.by = ctx.from.id; n.stats.ignored++;
      save();
      await closeCards(d, cur(ctx));
      return vanish(ctx, t(ctx, 'تم التجاهل — لن يصلك هذا الحدث مرة ثانية', 'Ignored — this incident will not come back'));
    }
    if (act === 'e') {
      d.status = 'editing'; d.by = ctx.from.id; save();
      await toast(ctx, '');
      const c = cur(ctx);
      await closeCards(d, c);
      if (c) setKeep('admin', c[0], c[1], false);
      return h.loadDraft(ctx, toBotDraft(d));
    }
    // publish: claimed once, so a second tap / a second reviewer can't publish it twice
    d.status = 'publishing'; save();
    await toast(ctx, t(ctx, '⏳ جاري النشر…', '⏳ Publishing…'));
    try { await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(t(ctx, '⏳ جاري النشر…', '⏳ Publishing…'), 'noop') }); } catch { /* ignore */ }
    let alert;
    try {
      alert = await h.publishDraft(ctx.api, toBotDraft(d), { id: ctx.from.id, name: ctx.from.first_name, via: 'news' });
    } catch (e) {
      d.status = 'pending'; save();
      console.error('[news] publish failed', e.description || e.message);
      try { await ctx.editMessageReplyMarkup({ reply_markup: cardKb(d, h.langOf(ctx)) }); } catch { /* ignore */ }
      return toast(ctx, t(ctx, '⚠️ تعذّر النشر — اضغط «نشر» مرة ثانية.', '⚠️ Publishing failed — tap Publish again.'), true);
    }
    d.status = 'published'; d.alertId = alert?.id; d.by = ctx.from.id; n.stats.published++;
    save();
    await closeCards(d, cur(ctx));
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    const kb = new InlineKeyboard();
    if (h.mapUrl && alert) kb.url(t(ctx, '🗺 على الخريطة', '🗺 On the map'), h.mapUrl(alert.id, h.langOf(ctx)));
    if (alert?.channel_message_id && config.channel.startsWith('@')) kb.url(t(ctx, '📣 المنشور', '📣 Post'), `https://t.me/${config.channel.slice(1)}/${alert.channel_message_id}`);
    await h.sendTransient(ctx.api, ctx.chat.id, t(ctx, `✅ تم النشر: ${typeOf(d.type).emoji} ${esc(typeOf(d.type).ar)} — ${esc(whereOf(locsOf(d.loc, d.extra)))}`, `✅ Published: ${typeOf(d.type).emoji} ${esc(typeOf(d.type).en)}`), { parse_mode: 'HTML', reply_markup: kb });
  });
  bot.callbackQuery(/^nw:s:(\w+):(\w+)$/, async (ctx) => {
    if (!staff(ctx)) return toast(ctx, '');
    const [, id, type] = ctx.match;
    const d = await findDraft(id);
    if (!d || !NEWS_TYPES.includes(type)) return vanish(ctx, t(ctx, 'هذه المسودة لم تعد متاحة', 'This draft is no longer available'));
    if (d.status !== 'pending') return vanish(ctx, t(ctx, 'تمت معالجتها مسبقاً ✔️', 'already handled ✔️'));
    d.type = type; save();
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
      t(ctx, 'السيرفر يتابع قنوات الأخبار السورية على مدار الساعة، وكل حدث جديد في سوريا يصلك هنا كمسودة جاهزة فيها النوع والمكان والمصادر. <b>بالنهار، الخبر المؤكد من مصدر رئيسي أو مصدرين يُنشر تلقائياً بعد دقيقتين إذا ما وافقت أو تجاهلت؛ وبالليل يبقى النشر التلقائي حسب إعداداته.</b> والحدث المكرر (نُشر، أو وصلك، أو تجاهلته) لا يصلك مرة ثانية.',
        'The server watches Syrian news channels around the clock; each new incident arrives here as a ready draft (type, place, sources). <b>By day, a confirmed AI-classified item backed by a main source or two sources is auto-published after 2 minutes if you do not approve or ignore it; overnight auto-publishing keeps its current settings.</b> Repeated incidents never come twice.'),
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
  const tyText = (ctx) => t(ctx, '🏷 <b>الأنواع المرصودة</b>\n\nاضغط النوع لإيقاف أو تشغيل رصده. الأنواع الموقوفة لا تصلك منها مسودات.', '🏷 <b>Watched types</b>\n\nTap a type to switch it on/off. No drafts arrive for switched-off types.');
  const tyKb = (ctx) => {
    const n = newsState();
    const kb = new InlineKeyboard();
    NEWS_TYPES.forEach((k, i) => { kb.text(`${n.types[k] ? '✅' : '⏸'} ${ALERT_TYPES[k].emoji} ${en(ctx) ? ALERT_TYPES[k].button_en : ALERT_TYPES[k].button_ar}`, 'nws:tt:' + k); if (i % 2 === 1) kb.row(); });
    return kb.row().text(t(ctx, '↩️ رجوع', '↩️ Back'), 'nws');
  };
  const ngText = (ctx) => {
    const g = newsState().night;
    return [
      t(ctx, '🌙 <b>النشر الليلي التلقائي</b>', '🌙 <b>Night auto-publish</b>'),
      '',
      t(ctx, 'بهالساعات (بتوقيت دمشق) مسودات الرصد بتنزل لحالها عالقناة والخريطة بنفس القالب وصورة الخريطة، ومن دون أي مصدر أو رابط. المكرر (منشور، أو بانتظارك، أو متجاهَل، أو نفس الحدث من مصدر تاني) ما بينزل، والتنبيه بينشال من الخريطة بوقته العادي.',
        'During these hours (Damascus time) monitor drafts are published to the channel and the map by themselves, same template and map image, no source or link. Duplicates never go out, and alerts leave the map on their normal timer.'),
      '',
      t(ctx, '• بينشر بس الخبر المؤكد من مصدر رئيسي أو من مصدرين. خبر من مصدر محلي/ناشط وحيد، أو تصنيف بسيط بدون Gemini، بيضل مسودة إلك (بدون صوت).', '• Only drafts backed by a main source or two sources. A single local/activist source, or a rules-only classification, stays a (silent) draft for you.'),
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

  bot.on('callback_query:data', async (ctx, next) => { if (ctx.callbackQuery.data !== 'nws:sa') pend.delete(ctx.from.id); return next(); });
  bot.command('news', (ctx) => (h.owner(ctx) ? showMain(ctx) : ctx.reply(h.L(ctx).onlyOwner)));
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
  bot.callbackQuery(/^nws:tt:(\w+)$/, (ctx) => onlyOwner(ctx, async () => {
    const k = ctx.match[1]; const n = newsState();
    if (NEWS_TYPES.includes(k)) { n.types[k] = !n.types[k]; save(); }
    await toast(ctx, '✅'); await h.show(ctx, tyText(ctx), tyKb(ctx));
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
  bot.callbackQuery('nws:sa', (ctx) => onlyOwner(ctx, async () => {
    await toast(ctx, '');
    pend.set(ctx.from.id, { k: 'add', exp: Date.now() + PEND_MS });
    await h.show(ctx, t(ctx, '➕ <b>إضافة مصدر</b>\n\nأرسل معرّف قناة تيليغرام <b>عامة</b> أو رابطها، مثل:\n<code>@ajasyr</code> أو <code>https://t.me/ajasyr</code>', '➕ <b>Add a source</b>\n\nSend the username or link of a <b>public</b> Telegram channel, e.g.\n<code>@ajasyr</code> or <code>https://t.me/ajasyr</code>'),
      new InlineKeyboard().text(t(ctx, '↩️ رجوع', '↩️ Back'), 'nws:src'));
  }));
  bot.on('message', async (ctx, next) => {
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
export const _test = { nightPublish, nightSummaryTick, noticeText, rescanIfFilterChanged, R, knownEvents, handleResult, processQueue, pollOnce, sweep, buildLocations, sameIncident, rememberAlert, cardText, cardKb, typeKb, govCodeOf, explicitWeatherResult };
