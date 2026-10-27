import crypto from 'node:crypto';
import { InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { store } from './store.js';
import { locationFrom, governorates, normalizeArabic } from './places.js';
import { scanTextPlaces, resolvePlace } from './news-ai.js';
import { addRoad, activeRoads } from './services.js';
import { setKeep } from './ui-clean.js';

const HOUR = 3_600_000;
const N = normalizeArabic;
const rid = () => crypto.randomBytes(5).toString('hex');
const esc = (s) => String(s ?? '').replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ROAD_OFFICIAL = new Set(['syrsmot', 'syrianmoi', 'sweidagov1']);
const ROAD_OUTLETS = new Map([
  ['ajasyr', 'aljazeera'], ['ajanews', 'aljazeera'],
  ['alarabiya_sy', 'alarabiya'], ['alarabiyabr', 'alarabiya'], ['alhadath_brk', 'alarabiya'],
  ['alarabytvsy', 'alaraby'], ['alarabytelevision', 'alaraby'], ['televisionsyria', 'syria-tv'],
]);
const ROAD_CONTEXT = /(?:^|\s)(?:طريق|طرق|الطريق|اوتوستراد|جسر|highway|road|route)(?:\s|$)/;
const CLOSED = /(?:قطع (?:ال)?طريق|اغلاق (?:ال)?طريق|اغلق (?:ال)?طريق|اغلقت (?:ال)?طريق|تسكير (?:ال)?طريق|غلق (?:ال)?طريق|(?:ال)?طريق (?:مغلق|مقطوع|مسكر)|(?:مغلق|مقطوع|مسكر) امام (?:حركه )?(?:السير|المرور)|road (?:is )?closed|highway (?:is )?closed|road blocked|highway blocked|road closure)/;
const UNSAFE = /(?:غير سالك|غير صالح للسير|لا يمكن المرور|تعذر المرور|تعذر السير|ممنوع المرور|غير امن|صعوبه المرور|impassable|unsafe to travel)/;
const STATUS_CUE = /(?:قطع (?:ال)?طريق|اغلاق|اغلق|اغلقت|تسكير|غلق|مغلق|مقطوع|مسكر|غير سالك|غير صالح للسير|لا يمكن المرور|تعذر المرور|تعذر السير|ممنوع المرور|صعوبه المرور|blocked|closure|impassable|unsafe to travel)/;
const OPEN_CUE = /(?:اعيد فتح|اعاده فتح|فتح الطريق|فتح (?:ال)?طريق|الطريق مفتوح|الطريق سالك|استئناف حركه السير|عادت حركه السير|reopened|open to traffic)/;
const NEGATED = /(?:ليس|ليست|لم يعد|لم تعد|غير|لا يزال غير|لا توجد|نفى|ينفي) (?:الطريق )?(?:مغلق|مقطوع|مسكر|مغلقا|مقطوعا|اغلاق)/;
const FUTURE = /(?:سيتم|سوف يتم|سيجري|يعتزم|تعتزم|يبدأ غدا|اعتبارا من غد|ابتداء من غد|will be closed|scheduled closure)/;
const TERMINAL = new Set(['published', 'ignored', 'duplicate', 'pending-report', 'published-existing']);

function watch() {
  const svc = (store.state.svc ||= {});
  const w = (svc.roadWatch ||= { events: [], ignoredReports: [] });
  if (!Array.isArray(w.events)) w.events = [];
  if (!Array.isArray(w.ignoredReports)) w.ignoredReports = [];
  return w;
}
const save = () => store.persist({ backupSoon: true });

/** Returns a clear current-state cue or a review-only ambiguous candidate. */
export function parseRoadText(text) {
  const n = N(text);
  if (!ROAD_CONTEXT.test(n) || !STATUS_CUE.test(n)) return null;
  if (NEGATED.test(n)) return { road: null, reason: 'الخبر ينفي الإغلاق أو ينقل نفيه' };
  if (FUTURE.test(n)) return { road: null, reason: 'الخبر يتحدث عن إغلاق مستقبلي أو مخطط' };
  const closed = CLOSED.test(n);
  const unsafe = UNSAFE.test(n);
  if (OPEN_CUE.test(n)) return { road: null, reason: 'الخبر يذكر فتح الطريق أو عودة الحركة، والحالة تحتاج مراجعة' };
  if (closed && unsafe) return { road: null, reason: 'وصف الحالة متضارب أو يجمع بين الإغلاق والخطر' };
  if (closed) return { road: 'closed', reason: null };
  if (unsafe) return { road: 'danger', reason: null };
  return { road: null, reason: 'لم تتضح حالة الطريق من صياغة الخبر' };
}

/** A place is accepted only when an exact Syrian place is named in the post. */
export function roadLocations(text) {
  const normalized = ` ${N(text)} `;
  const matches = governorates.flatMap((g) => [g.ar, g.en, ...(g.alt || [])].flatMap((name) => {
    const n = N(name);
    if (n.length < 3) return [];
    const out = [];
    for (const prefix of ['', 'و', 'ب', 'ل']) {
      const phrase = ` ${prefix}${n} `; let at = normalized.indexOf(phrase);
      while (at >= 0) { out.push({ g, start: at, end: at + phrase.length }); at = normalized.indexOf(phrase, at + 1); }
    }
    return out;
  }));
  const govs = [...new Map(matches.filter((m) => !matches.some((x) => x !== m && x.start <= m.start && x.end >= m.end && x.end - x.start > m.end - m.start)).map((m) => [m.g.code, m.g])).values()];
  const ids = [];
  for (const g of govs) {
    for (const id of scanTextPlaces(text, g.code, 4)) if (!ids.includes(id)) ids.push(id);
    const city = resolvePlace({ name: g.ar, gov: g.ar });
    if (city?.kind === 'place' && !ids.includes(city.placeId)) ids.push(city.placeId);
  }
  const locs = ids.slice(0, 4).map((placeId) => locationFrom({ placeId })).filter((x) => x?.scope === 'place');
  return locs.filter((l) => !(N(l.name_ar) === N(l.governorate_ar) && locs.some((x) => x !== l && x.governorate === l.governorate)));
}

function sourceIdentity(it, locations) {
  const u = String(it?.src?.u || '').toLowerCase();
  if (ROAD_OFFICIAL.has(u)) {
    if (u !== 'sweidagov1' || locations.some((l) => N(l.governorate_ar || '').includes(N('السويداء')))) {
      return { u, name: it.src.name || u, url: it.url || '', ts: it.ts || Date.now(), official: true, group: null };
    }
  }
  return { u, name: it?.src?.name || u || 'مصدر', url: it?.url || '', ts: it?.ts || Date.now(), official: false, group: ROAD_OUTLETS.get(u) || null };
}

function words(text) {
  return new Set(N(text).split(' ').filter((x) => x.length > 2 && !['طريق', 'الطريق', 'الى', 'على', 'في', 'من', 'هذا', 'هذه', 'تم', 'بعد', 'قبل', 'سوريا', 'السوريه', 'المرور', 'السير', 'مغلق', 'مقطوع'].includes(x)));
}
function textSimilarity(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / (x.size + y.size - common);
}
function evidence(sources) {
  if (sources.some((s) => s.official)) return 'official';
  const accepted = [];
  const groups = new Set();
  for (const s of sources) {
    if (!s.group || groups.has(s.group)) continue;
    if (accepted.some((p) => textSimilarity(p.text, s.text) >= 0.82)) continue;
    groups.add(s.group); accepted.push(s);
  }
  return groups.size >= 2 ? 'two-independent' : null;
}
export function roadEvidence(sources) { return evidence(sources || []); }

function coords(loc) {
  if (Number.isFinite(loc?.latitude) && Number.isFinite(loc?.longitude)) return { lat: loc.latitude, lon: loc.longitude };
  if (Number.isFinite(loc?.lat) && Number.isFinite(loc?.lon)) return { lat: loc.lat, lon: loc.lon };
  return null;
}
function distanceKm(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
function locationsNear(a, b, limit = 20) {
  const aa = (a || []).map(coords).filter(Boolean), bb = (b || []).map(coords).filter(Boolean);
  return aa.some((x) => bb.some((y) => distanceKm(x, y) <= limit));
}
const eventLocs = (e) => [e?.location, ...(e?.extra || [])].filter(Boolean);
const relatedEvent = (a, b) => locationsNear(eventLocs(a), eventLocs(b))
  || (!eventLocs(a).length && !eventLocs(b).length && !!a?.route && !!b?.route && N(a.route) === N(b.route));

function pendingHumanReport(ev) {
  for (const rep of Object.values(store.state.reports || {})) {
    const d = rep?.draft;
    if (d?.type !== 'road') continue;
    if (relatedEvent(ev, { location: d.location, extra: d.extra || [], road: d.road })) return true;
  }
  return false;
}
function ignoredHumanReport(ev, now = Date.now()) {
  return watch().ignoredReports.some((r) => now - (r.ts || 0) <= 72 * HOUR && (!r.road || r.road === ev.road) && relatedEvent(ev, r));
}
function publishedRoadMatches(ev, now = Date.now()) {
  return activeRoads(now).filter((r) => now - Number(r.ts || 0) <= 12 * HOUR
    && locationsNear(eventLocs(ev), r.pts || []));
}
function findEvent(ev, now) {
  return watch().events.find((x) => now - (x.ts || x.created || 0) <= 6 * HOUR && relatedEvent(x, ev));
}
function routeName(ev) {
  const locs = eventLocs(ev);
  if (locs.length) return locs.map((x) => x.name_ar).join(' – ');
  return ev.route || 'موقع غير محدد';
}
function tidyNote(text) {
  return String(text || '').replace(/https?:\/\/\S+/g, '').replace(/[@#][\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim().slice(0, 300);
}
function sourceLink(s) {
  return /^https:\/\/t\.me\/[A-Za-z0-9_/-]+$/.test(s?.url || '') ? s.url : '';
}
function reviewText(ev) {
  const srcs = (ev.sources || []).slice(0, 5).map((s) => sourceLink(s) ? `<a href="${esc(sourceLink(s))}">${esc(s.name)}</a>` : esc(s.name));
  const status = ev.road === 'closed' ? '⛔ طريق مسكّر' : ev.road === 'danger' ? '⚠️ طريق غير سالك/خطر' : '🛣 حالة طريق تحتاج تحقق';
  const action = ev.conflict ? 'توجد حالة طريق مختلفة ما زالت نشطة للموقع؛ راجعها من أدوات الطرق أولاً.' : ev.road && eventLocs(ev).length ? 'إذا راجعت المصدر، يمكنك إضافته إلى الخريطة فقط من الزر أدناه.' : 'تحقّق منه يدوياً من المصدر؛ لا يُنشر حتى تتضح الحالة والموقع.';
  return `🛣 <b>خبر طريق للمراجعة — لم يُنشر تلقائياً</b>\n\n${status}\n📍 ${esc(routeName(ev))}\n\n${esc(ev.note || ev.reason || 'تعذّر تحديد الحالة أو موقعها بدقة.')}${ev.reason ? `\n\n⚠️ ${esc(ev.reason)}` : ''}\n\n🗞 <b>المصادر:</b> ${srcs.join(' · ') || '—'}\n\n<i>النشر التلقائي يتطلب مصدراً رسمياً مؤهلاً أو مصدرين صحفيين مستقلين، وموقعاً واضحاً. ${esc(action)}</i>`;
}
function reviewKeyboard(ev) {
  const kb = new InlineKeyboard();
  if (ev.road && eventLocs(ev).length && !ev.conflict) kb.text('✅ نشر على الخريطة فقط', `rmon:p:${ev.id}`).row();
  kb.text('❌ تجاهل', `rmon:i:${ev.id}`);
  return kb;
}
const R = { H: null, retryTimer: null };
const adminApi = () => R.H?.apis?.().admin || null;
async function sendReview(ev) {
  if (!ev || TERMINAL.has(ev.state)) return;
  const api = adminApi();
  if (!api) return;
  ev.cards ||= [];
  for (const uid of config.ownerIds) {
    const old = ev.cards.find(([chat]) => Number(chat) === Number(uid));
    const opts = { parse_mode: 'HTML', reply_markup: reviewKeyboard(ev), link_preview_options: { is_disabled: true }, _keep: 'c' };
    try {
      if (old) await api.editMessageText(uid, old[1], reviewText(ev), opts);
      else { const m = await api.sendMessage(uid, reviewText(ev), opts); ev.cards.push([uid, m.message_id]); }
    } catch (e) { console.warn('[roads] review notice failed', e.description || e.message); }
  }
  save();
}
async function closeReview(ev, keep = null) {
  const api = adminApi();
  for (const [chat, mid] of ev.cards || []) {
    if (keep && keep[0] === chat && keep[1] === mid) continue;
    setKeep('admin', chat, mid, false);
    if (!api) continue;
    try { await api.deleteMessage(chat, mid); } catch { try { await api.editMessageText(chat, mid, '✔️', {}); } catch { /* stale card */ } }
  }
  ev.cards = keep ? (ev.cards || []).filter(([c, m]) => c === keep[0] && m === keep[1]) : [];
}
function noticeText(ev, mode) {
  const label = ev.road === 'closed' ? '⛔ طريق مسكّر' : '⚠️ طريق غير سالك/خطر';
  const sources = (ev.sources || []).slice(0, 5).map((s) => sourceLink(s) ? `<a href="${esc(sourceLink(s))}">${esc(s.name)}</a>` : esc(s.name));
  const map = config.publicUrl ? `\n\n<a href="${esc(config.publicUrl)}/ar/#roads">🗺 فتح طبقة الطرق على الخريطة</a>` : '';
  const why = mode === 'official' ? 'مصدر رسمي أولي' : mode === 'two-independent' ? 'مصدران صحفيان مستقلان' : 'مراجعتك';
  return `✅ <b>أُضيف تحديث الطريق إلى الخريطة فقط</b>\n\n${label}\n📍 ${esc(routeName(ev))}\n🗞 التحقق: ${esc(why)}\nالمصادر: ${sources.join(' · ') || '—'}${map}\n\n<i>لم يُنشر شيء في قناة تيليغرام العامة.</i>`;
}
async function notifyOwner(ev) {
  if (!ev || ev.state !== 'published' || ev.noticeSent) return;
  const api = adminApi();
  if (!api) return;
  let sent = 0;
  for (const uid of config.ownerIds) {
    try { await api.sendMessage(uid, noticeText(ev, ev.evidence), { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, _keep: 'c' }); sent++; }
    catch (e) { console.warn('[roads] owner notice failed', e.description || e.message); }
  }
  if (sent) { ev.noticeSent = true; save(); }
}
function duplicateReason(ev, now) {
  if (ignoredHumanReport(ev, now)) return 'ignored-report';
  if (pendingHumanReport(ev)) return 'pending-report';
  const published = publishedRoadMatches(ev, now);
  if (published.length) return published.every((r) => r.status === ev.road) ? 'published-road' : 'conflicting-road';
  return null;
}
async function publishCandidate(ev, evidenceKind, { automatic = false, keep = null } = {}) {
  if (!ev?.road || !eventLocs(ev).length || ev.state === 'published' || ev.state === 'ignored') return false;
  const now = Date.now();
  const dupe = duplicateReason(ev, now);
  if (dupe === 'conflicting-road') {
    ev.conflict = true; ev.reason = 'توجد حالة طريق منشورة مختلفة ما زالت نشطة للموقع نفسه؛ تحتاج مراجعة يدوية.';
    save(); await sendReview(ev); return false;
  }
  if (dupe) {
    ev.state = dupe === 'ignored-report' ? 'ignored' : dupe === 'pending-report' ? 'pending-report' : 'published-existing';
    ev.reason = dupe === 'pending-report' ? 'يوجد بلاغ طريق معلّق للموقع نفسه' : 'يوجد تحديث طريق منشور أو متجاهل للموقع نفسه';
    await closeReview(ev); save();
    return false;
  }
  const road = addRoad({ road: ev.road, location: ev.location, extra: ev.extra || [], details: ev.note || '', ttlMin: 360 },
    { id: 0, name: automatic ? 'رصد الطرق' : 'مراجعة المالك' });
  ev.state = 'published'; ev.evidence = evidenceKind; ev.roadId = road.id; ev.publishedAt = now;
  ev.auto = automatic; ev.noticeSent = false;
  save();
  await closeReview(ev, automatic ? null : keep);
  if (automatic) await notifyOwner(ev);
  return true;
}
function addSource(ev, src, text) {
  ev.sources ||= [];
  if (!src.u || ev.sources.some((x) => x.u === src.u)) return false;
  ev.sources.push({ ...src, text: String(text || '').slice(0, 1200) });
  ev.sources = ev.sources.slice(-8);
  return true;
}

/** Process one fresh post. It only adds a road after strict source + status + location checks. */
export async function onRoadNewsPost(it, { now = Date.now() } = {}) {
  const parsed = parseRoadText(it?.text || '');
  if (!parsed) return false;
  const locations = roadLocations(it.text || '');
  const src = sourceIdentity(it, locations);
  const route = locations.map((x) => x.name_ar).join(' – ') || '';
  const next = {
    id: rid(), state: 'pending', road: parsed.road, reason: parsed.reason || (!locations.length ? 'لم يُذكر مكان سوري محدد يمكن تثبيته على الخريطة' : null),
    location: locations[0] || null, extra: locations.slice(1), route,
    note: tidyNote(it.text), ts: it.ts || now, created: now, sources: [], cards: [], auto: false,
  };
  let ev = findEvent(next, now);
  if (ev) {
    if (TERMINAL.has(ev.state)) return true;
    if (ev.road && next.road && ev.road !== next.road) {
      ev.road = null; ev.reason = 'تضاربت حالة الطريق بين الأخبار؛ يحتاج تأكيداً يدوياً';
    } else if (!ev.road && next.road && !ev.reason?.includes('تضاربت')) {
      ev.road = next.road; ev.reason = next.reason;
    } else if (ev.road === next.road) ev.reason = next.reason;
    if (!ev.location && next.location) { ev.location = next.location; ev.extra = next.extra; ev.route = next.route; }
    addSource(ev, src, it.text);
    if (ev.sources.length > 1) ev.note = ev.note || next.note;
  } else {
    ev = next;
    addSource(ev, src, it.text);
    watch().events.unshift(ev);
    watch().events = watch().events.slice(0, 300);
  }
  const dupe = duplicateReason(ev, now);
  if (dupe === 'conflicting-road') {
    ev.state = 'pending'; ev.conflict = true;
    ev.reason = 'توجد حالة طريق منشورة مختلفة ما زالت نشطة للموقع نفسه؛ تحتاج مراجعة يدوية.';
    save(); await sendReview(ev); return true;
  }
  ev.conflict = false;
  if (dupe) {
    ev.state = dupe === 'ignored-report' ? 'ignored' : dupe === 'pending-report' ? 'pending-report' : 'published-existing';
    ev.reason = dupe === 'pending-report' ? 'يوجد بلاغ طريق معلّق للموقع نفسه' : 'يوجد تحديث طريق منشور أو متجاهل للموقع نفسه';
    await closeReview(ev); save(); return true;
  }
  const provenBy = ev.road ? evidence(ev.sources) : null;
  if (provenBy && eventLocs(ev).length) {
    ev.evidence = provenBy;
    const ok = await publishCandidate(ev, provenBy, { automatic: true });
    if (ok) console.log(`[roads] auto-published ${ev.id} at ${routeName(ev)} (${provenBy})`);
  } else {
    if (!ev.reason && !eventLocs(ev).length) ev.reason = 'لم يُذكر مكان سوري محدد يمكن تثبيته على الخريطة';
    if (!ev.reason && !ev.road) ev.reason = parsed.reason || 'حالة الطريق غير واضحة';
    if (!ev.reason && !provenBy) ev.reason = 'لم يتأكد الخبر من مصدر رسمي أو مصدرين مستقلين بعد';
    save();
    await sendReview(ev);
  }
  return true;
}

/** Store ignored human road reports so the news monitor cannot resurrect them. */
export function rememberIgnoredRoadReport(draft) {
  if (draft?.type !== 'road' || !draft.location) return;
  const w = watch();
  const rec = { location: draft.location, extra: draft.extra || [], road: draft.road || null, route: '', ts: Date.now() };
  if (!w.ignoredReports.some((x) => relatedEvent(x, rec) && x.road === rec.road)) w.ignoredReports.unshift(rec);
  w.ignoredReports = w.ignoredReports.filter((x) => Date.now() - x.ts <= 72 * HOUR).slice(0, 200);
  save();
}

export function roadMonitorDebug() {
  const w = watch();
  return {
    enabled: true,
    activeSince: w.enabledSince ? new Date(w.enabledSince).toISOString() : null,
    officialSources: [...ROAD_OFFICIAL],
    independentSourceGroups: Object.fromEntries(ROAD_OUTLETS),
    pending: w.events.filter((e) => !TERMINAL.has(e.state)).length,
    publishedLast24h: w.events.filter((e) => e.state === 'published' && Date.now() - (e.publishedAt || 0) < 24 * HOUR).length,
    lastCandidateAt: w.events[0]?.created ? new Date(w.events[0].created).toISOString() : null,
  };
}

export function roadMonitorActivationTime() {
  const w = watch();
  if (!Number.isFinite(w.enabledSince) || !w.enabledSince) { w.enabledSince = Date.now(); save(); }
  return w.enabledSince;
}

export function registerRoadMonitorTools(bot, h) {
  R.H = h;
  bot.callbackQuery(/^rmon:(p|i):([a-f0-9]{10})$/, async (ctx) => {
    if (!h.owner(ctx)) return ctx.answerCallbackQuery().catch(() => {});
    const [, action, id] = ctx.match;
    const ev = watch().events.find((x) => x.id === id);
    if (!ev) return ctx.answerCallbackQuery({ text: 'لم يعد هذا الخبر متاحاً', show_alert: true }).catch(() => {});
    if (action === 'i') {
      ev.state = 'ignored'; ev.ignoredAt = Date.now(); save();
      await closeReview(ev);
      return ctx.answerCallbackQuery('تم التجاهل').catch(() => {});
    }
    if (!ev.road || !eventLocs(ev).length) return ctx.answerCallbackQuery({ text: 'لا يمكن النشر قبل تحديد الحالة والموقع', show_alert: true }).catch(() => {});
    await ctx.answerCallbackQuery('جارٍ التحقق من عدم التكرار…').catch(() => {});
    const msg = ctx.callbackQuery.message;
    const keep = msg ? [msg.chat.id, msg.message_id] : null;
    const ok = await publishCandidate(ev, 'owner-review', { automatic: false, keep });
    if (!ok) return ctx.reply('ℹ️ لم يُضف تحديث جديد: يوجد بلاغ معلّق أو حالة منشورة/متجاهلة للموقع نفسه.');
    try {
      const url = `${(config.publicUrl || 'https://red-alert-syria.onrender.com').replace(/\/$/, '')}/ar/#roads`;
      await ctx.editMessageText(`✅ أُضيفت حالة الطريق إلى الخريطة فقط — ${esc(routeName(ev))}. لم يُنشر شيء في القناة.`,
        { parse_mode: 'HTML', reply_markup: new InlineKeyboard().url('🗺 الخريطة', url) });
    } catch { /* message may have been removed */ }
  });
  if (!R.retryTimer) {
    R.retryTimer = setInterval(async () => {
      const w = watch();
      for (const ev of w.events) {
        if (ev.state === 'published' && !ev.noticeSent && ev.auto) await notifyOwner(ev);
        else if (!TERMINAL.has(ev.state) && !(ev.cards || []).length) await sendReview(ev);
      }
    }, 60_000);
    R.retryTimer.unref?.();
  }
}

export function mergeRoadWatchFromBackup(o) {
  const older = o?.svc?.roadWatch;
  if (!older || typeof older !== 'object') return;
  const w = watch();
  for (const e of older.events || []) {
    if (!e?.id) continue;
    const current = w.events.find((x) => x.id === e.id);
    if (!current) w.events.push(e);
    else if (!TERMINAL.has(current.state) && TERMINAL.has(e.state)) Object.assign(current, e);
  }
  const ignored = new Set(w.ignoredReports.map((x) => `${x.ts}:${N(x.location?.name_ar || '')}`));
  for (const x of older.ignoredReports || []) if (!ignored.has(`${x.ts}:${N(x.location?.name_ar || '')}`)) w.ignoredReports.push(x);
  w.events = w.events.slice(0, 300);
  w.ignoredReports = w.ignoredReports.slice(0, 200);
}
