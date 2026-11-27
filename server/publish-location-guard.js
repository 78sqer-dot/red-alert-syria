// Publish-path location guard (owner order 2026-11-24, restored + adapted
// 2026-11-25 after the live جدوعة / رجم العجوز failure).
//
// The founding card design zooms into the alert's place with an impact
// circle. An alert published with an empty location falls back to a bare
// whole-Syria card — the owner rejected papering over that with an
// approximate guess; the incomplete publish itself must not happen.
//
// So, for every alert type that renders a map card, before publication:
//   1. a draft that already carries a real location (place / district /
//      governorate) or extra areas passes untouched;
//   2. a location-less draft whose own text names ONE identifiable Syrian
//      place gets that place bound from the project's gazetteer (the same
//      conservative exact-name machinery the news desk uses:
//      mentionedGovernorates + scanTextPlaces — exact names only, unique
//      result only, fail-closed) and then publishes with the zoomed card;
//   3. a location-less draft with no identifiable place in its text is
//      HELD for manual review with the reason recorded — never published
//      with a bare card.
//
// Designed-context products are out of scope by construction: reviewed /
// timed-professional copies and locality-reference cards carry their own
// signed geography and are never the bare-card failure. Political
// statements, flight movements and weather warnings are likewise exempt —
// country scope is a designed state for them, not a missing location.
import { locationFrom, getPlace, mentionedGovernorates, normalizeArabic, governorates } from './places.js';
import { scanTextPlaces, resolvePlace } from './news-ai.js';

export const MISSING_CARD_LOCATION_REASON = 'missing-location';
export const LOCATION_TEXT_CONFLICT_REASON = 'location-text-conflict';
export const CARD_LOCATION_BOUND_CORRECTION = 'location-bound-from-text';

export const CARD_LOCATION_EXEMPT_TYPES = new Set(['political', 'air_movement', 'civil_plane', 'weather']);

const hasRealLocation = (loc) => !!loc && !!loc.scope && loc.scope !== 'country'
  && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude);
const hasAreas = (d) => (Array.isArray(d?.extra) && d.extra.some((x) => x && x.scope !== 'country'))
  || (Array.isArray(d?.zones) && d.zones.length > 0);

/** True when the guard governs this draft at all (see the header). */
export function cardLocationGuardApplies(d) {
  if (!d || typeof d !== 'object') return false;
  if (!d.type || d.type === 'road') return false;
  if (CARD_LOCATION_EXEMPT_TYPES.has(d.type)) return false;
  if (d.reviewedNewsCopy || d.reviewedCopy || d.attributedReport) return false;
  if (d.timedNews || d.localityReference || d.imageContext) return false;
  if (d.location_display === 'geographic_reference' || d.location_display === 'approximate_point') return false;
  if (d.channel_media === 'photo' || d.channel_media === 'video') return false;
  return true;
}

/** 'present' when the alert already has a real location or areas. */
export function draftCardLocationState(d) {
  return hasRealLocation(d?.location || d?.loc || null) || hasAreas(d) ? 'present' : 'missing';
}

const stripAlWord = (w) => (w.startsWith('ال') && w.length > 3 ? w.slice(2) : w);
// Arabic proclitics (و ف ب ل ك) glued to the next word: «بالحسكة» is the city
// mentioned with a preposition, and the 2026-11-25 المشيرفة failure turned on
// exactly that («المشيرفة بالحسكة» never matched the bare city name).
const stripClitic = (w) => (w.length >= 3 && w.length - 1 >= 2 && 'وفبلك'.includes(w[0]) ? w.slice(1) : w);
const bareToken = (w) => stripAlWord(stripClitic(w));

/** True when a governorate is mentioned as its capital CITY (bare name or
 * «مدينة X»), not as its countryside («ريف X») or as a province reference
 * («محافظة X») — only the city framing may bind the city place. */
function govMentionedAsCity(text, gov) {
  const tokens = normalizeArabic(text).split(/\s+/).filter(Boolean);
  const forms = [...new Set([normalizeArabic(gov.ar), normalizeArabic(gov.ar).split(' ').map(stripAlWord).join(' ')])]
    .map((f) => f.split(' ').filter(Boolean));
  for (const words of forms) {
    for (let i = 0; i + words.length <= tokens.length; i++) {
      const slice = tokens.slice(i, i + words.length);
      if (!slice.every((t, k) => t === words[k] || bareToken(t) === words[k] || stripAlWord(t) === words[k])) continue;
      const before = i > 0 ? bareToken(tokens[i - 1]) : '';
      if (before === 'ريف' || before === 'محافظه') continue;
      return true;
    }
  }
  return false;
}

/** The single identifiable place in a text, or null. Scans the text with
 * the desk's exact-name gazetteer scan for every governorate the text
 * itself mentions; when the scan finds nothing, a governorate mentioned
 * as its capital city binds that city (resolvePlace's own city/governorate
 * disambiguation). Binds only when the whole text yields exactly ONE
 * place — ambiguity fails closed. */
export function placeIdFromText(text, districtNames = new Set()) {
  const ids = new Set();
  const govs = mentionedGovernorates(text);
  for (const g of govs) {
    for (const id of scanTextPlaces(text, g.code, 3)) ids.add(id);
  }
  // Urban-feature frame («حي X» / «دوار X» / «ساحة X»): a text of this draft
  // declares X a feature inside a city, so a same-named gazetteer village
  // is a name collision, not the place —
  // the live trap is المشيرفة (a Hasakah-city neighbourhood) vs the
  // gazetteer's same-named village at 42.13E near the Iraqi border;
  // binding it would pin the news ~130 km from the event. Drop scan hits
  // whose name is district-framed anywhere in the draft; the city
  // fallback below then binds the parent city the text itself names.
  if (ids.size && districtNames.size) {
    for (const id of [...ids]) {
      const place = getPlace(id);
      if (place && (districtNames.has(normalizeArabic(place.ar)) || districtNames.has(bareToken(normalizeArabic(place.ar))))) ids.delete(id);
    }
  }
  if (!ids.size) {
    for (const g of govs) {
      if (!govMentionedAsCity(text, g)) continue;
      const r = resolvePlace({ name: g.ar, gov: g.ar });
      if (r && r.kind === 'place') ids.add(r.placeId);
    }
  }
  return ids.size === 1 ? [...ids][0] : null;
}

/** Urban-feature frame words: a name right after one of these is a feature
 * INSIDE a city (a neighbourhood, a roundabout, a square), never a
 * standalone gazetteer place. «دوار» was missing until live post 1632
 * (2026-11-26): «دوار الصالحية في الحسكة» bound the same-named village in
 * Al-Malikiyah countryside (id 8595805) with a false 1.8 km zone. */
const URBAN_FEATURE_FRAMES = new Set(['حي', 'دوار', 'ساحة'].map((w) => bareToken(normalizeArabic(w))));

/** Frames that name a SPECIFIC locality or geographic feature: a name
 * right after one of these is a concrete place the text pins the event to
 * (a town, a neighbourhood, a crossing, a wadi, a hill…). Used by the
 * governorate-scope branch: when classification left no unresolved-place
 * marking (its own hole, closed in buildLocations for AI-named places),
 * a framed specific name in the draft's texts that the gazetteer scan
 * could not resolve is still a named place with unproven coordinates —
 * the draft must hold, not publish a bare governorate card (live post
 * 1645, 2026-11-27: «أطراف وادي الرقاد بريف درعا»). */
const SPECIFIC_PLACE_FRAMES = new Set(['بلدة', 'قرية', 'مخيم', 'مدينة', 'منطقة', 'منطقه', 'حي', 'دوار', 'ساحة', 'وادي', 'نهر', 'جبل', 'تلة', 'تل', 'سهل', 'معبر', 'أطراف', 'اطراف'].map((w) => bareToken(normalizeArabic(w))));

/** Specific place names framed in a text (token(s) right after a frame
 * word, up to two, stopping at a glued preposition — same walk as
 * districtFramedNames). */
export function framedSpecificNames(text) {
  const toks = normalizeArabic(String(text || '')).split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + 1 < toks.length; i++) {
    if (!SPECIFIC_PLACE_FRAMES.has(bareToken(toks[i]))) continue;
    const first = bareToken(toks[i + 1]);
    if (first) { out.add(first); out.add(toks[i + 1]); }
    const second = toks[i + 2] ? bareToken(toks[i + 2]) : '';
    if (second && !'وفبلك'.includes(String(toks[i + 2])[0])) { out.add(`${first} ${second}`); out.add(`${toks[i + 1]} ${toks[i + 2]}`); }
  }
  return out;
}

/** True when the draft's texts frame a specific place name that is not a
 * governorate's own name — i.e. the report pins its event to a concrete
 * locality/feature, whether or not classification marked it. */
function textsFrameSpecificPlace(d) {
  const govNames = new Set(governorates.flatMap((g) => [normalizeArabic(g.ar), bareToken(normalizeArabic(g.ar))]));
  for (const text of draftTexts(d)) {
    for (const n of framedSpecificNames(text)) {
      if (!govNames.has(normalizeArabic(n)) && !govNames.has(bareToken(normalizeArabic(n)))) return true;
    }
  }
  return false;
}

/** Names the draft's texts frame as an intra-city feature: the token(s)
 * right after «حي» / «دوار» / «ساحة», up to two, stopping at a glued
 * preposition («حي المشيرفة بالحسكة» -> {المشيرفة}). */
export function districtFramedNames(text) {
  const toks = normalizeArabic(String(text || '')).split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + 1 < toks.length; i++) {
    if (!URBAN_FEATURE_FRAMES.has(bareToken(toks[i]))) continue;
    const first = bareToken(toks[i + 1]);
    if (first) { out.add(first); out.add(toks[i + 1]); }
    const second = toks[i + 2] ? bareToken(toks[i + 2]) : '';
    if (second && !'وفبلك'.includes(String(toks[i + 2])[0])) { out.add(`${first} ${second}`); out.add(`${toks[i + 1]} ${toks[i + 2]}`); }
  }
  return out;
}

/** The draft's texts, in desk order: the outgoing copy first, then the source. */
function draftTexts(d) {
  const texts = [];
  const add = (t) => { const s = String(t || '').trim(); if (s && !texts.includes(s)) texts.push(s); };
  add([d?.headline, d?.body].filter(Boolean).join('\n'));
  add(d?.sourceText);
  add([d?.title, d?.description].filter(Boolean).join('\n'));
  add(d?.searchSourceText);
  return texts;
}

/** Cross-checked place resolution (Saqr's correction, 2026-11-25): every
 * text of the draft that yields a unique place must agree on the SAME
 * place. The old resolver returned the first text's hit without ever
 * looking at the others, so a Damascus headline over an Aleppo source
 * bound Damascus. Disagreement is a conflict — never a silent first-wins. */
/** Toward flight reports (aerialMode 'toward', owner order 2026-11-25) name
 * TWO places by design: the observed area (the bound location) and the
 * destination (meta.flightTarget, picked from the same gazetteer). The
 * outgoing copy itself carries the destination («— نحو X» in the built
 * title, and reporters naturally name it in the details), so a text place
 * that IS the destination — or lies inside the destination's district /
 * governorate scope — is not a location conflict and must not hold or
 * rebind the publish. Live failure 2026-11-26: a drone report Aleppo city
 * -> As-Safira was held at approval with location-text-conflict on every
 * attempt, because this guard had no knowledge of flightTarget. */
export function flightTargetExempts(d, placeId) {
  if (!d || d.aerialMode !== 'toward' || !d.flightTarget) return false;
  const p = getPlace(placeId);
  if (!p) return false;
  const t = d.flightTarget;
  if (t.scope === 'place') return Number(t.place_id) === Number(p.id);
  if (t.scope === 'district') return String(t.district) === String(p.dist);
  if (t.scope === 'governorate') return String(t.governorate) === String(p.gov);
  return false;
}

export function resolveDraftPlace(d) {
  const ids = new Set();
  const texts = draftTexts(d);
  const districtNames = new Set();
  for (const text of texts) for (const n of districtFramedNames(text)) districtNames.add(n);
  for (const text of texts) {
    const id = placeIdFromText(text, districtNames);
    if (id != null && !flightTargetExempts(d, id)) ids.add(id);
  }
  if (ids.size > 1) return { placeId: null, conflict: true };
  return { placeId: ids.size === 1 ? [...ids][0] : null, conflict: false };
}

/** The single identifiable place in the draft's own text, or null. */
export function resolveDraftPlaceId(d) {
  return resolveDraftPlace(d).placeId;
}

/** Run the guard on a draft (either location convention: d.location for
 * bot drafts, d.loc for monitor drafts — a bind writes both). Returns
 * {action: 'exempt'|'present'|'bound'|'held', ...}; 'held' carries the
 * recorded reason and means: do not publish. */
export function ensureDraftCardLocation(d) {
  if (!cardLocationGuardApplies(d)) return { action: 'exempt' };
  const resolved = resolveDraftPlace(d);
  if (resolved.conflict) return { action: 'held', reason: LOCATION_TEXT_CONFLICT_REASON };
  // Governorate scope alone is NOT a card location when the report named a
  // more specific place that failed to resolve (the 2026-11-25 المشيرفة
  // failure: «المشيرفة» is a Hasakah-city neighbourhood absent from the
  // gazetteer; classification degraded to governorate scope and the old
  // 'present' check waved the bare governorate card through). Bind the one
  // identifiable place the text itself names — for a neighbourhood that is
  // its parent city, named in the same text («المشيرفة بالحسكة» -> the city
  // of Hasakah, not a guess) — or HOLD. Genuine governorate-wide news (no
  // unresolved named place) keeps passing as before.
  const loc0 = d.location || d.loc || null;
  if (loc0 && loc0.scope === 'governorate' && !hasAreas(d)) {
    if (resolved.placeId != null) {
      const loc = locationFrom({ placeId: resolved.placeId });
      if (loc) { d.location = loc; d.loc = loc; return { action: 'bound', placeId: resolved.placeId, location: loc, upgradedFromGovernorate: true }; }
    }
    if (String(d.unresolvedPlaceName || '').trim()) return { action: 'held', reason: MISSING_CARD_LOCATION_REASON };
    // Safety net for the marking's own gaps (live post 1645, 2026-11-27):
    // classification may leave no unresolved-place marking at all — e.g.
    // the named feature never reached its places list — while the text
    // itself frames a specific locality/feature («أطراف وادي الرقاد»).
    // A framed specific name the scan could not resolve (this branch is
    // only reached with resolved.placeId == null) means the event's place
    // is named but unproven: hold for review, never a bare governorate
    // card with a representative circle on the capital.
    if (textsFrameSpecificPlace(d)) return { action: 'held', reason: MISSING_CARD_LOCATION_REASON };
    return { action: 'present' };
  }
  if (draftCardLocationState(d) === 'present') {
    // Saqr's correction (2026-11-25): a pre-existing location no longer
    // bypasses verification. When the draft's own texts uniquely name a
    // place, it must be the bound one (same place, or at least the same
    // governorate for district/governorate-scope locations) — a positive
    // mismatch holds the publish for review instead of shipping a card
    // pinned somewhere the text never said.
    const loc = d.location || d.loc || null;
    if (resolved.placeId != null && loc) {
      if (loc.place_id != null) {
        if (Number(loc.place_id) !== Number(resolved.placeId)) return { action: 'held', reason: LOCATION_TEXT_CONFLICT_REASON };
      } else if (loc.governorate) {
        const p = getPlace(resolved.placeId);
        if (p && p.gov !== loc.governorate) return { action: 'held', reason: LOCATION_TEXT_CONFLICT_REASON };
      }
    }
    return { action: 'present' };
  }
  const loc = resolved.placeId == null ? null : locationFrom({ placeId: resolved.placeId });
  if (!loc) return { action: 'held', reason: MISSING_CARD_LOCATION_REASON };
  d.location = loc;
  d.loc = loc;
  return { action: 'bound', placeId: resolved.placeId, location: loc };
}

/** Final funnel check on the BUILT alert input — the guard gets the last
 * word on location. buildAlertInput re-derives locations through
 * newsIncidentLocations AFTER the draft-stage guard ran, and that
 * derivation can (a) replace a bound location with a coordinate-less
 * governorate LABEL location («مشيرفة بمدينة الحسكة», live alert e2aac81d,
 * 2026-11-25 22:53 — published bare although the draft-stage guard had
 * bound the city), or (b) keep a name-collision village the outgoing copy
 * frames as a city district (live post 1599). A coordinate-less location
 * is treated as missing here; a coordinated one goes through the usual
 * cross-check against the outgoing texts. `src` is the caller's draft
 * (exemption flags + unresolved-place marking). */
export function ensureBuiltAlertLocation(input, src = {}) {
  if (!input || typeof input !== 'object') return { action: 'exempt' };
  const hasCoords = Number.isFinite(input.location?.latitude) && Number.isFinite(input.location?.longitude);
  const view = {
    type: input.type,
    location: hasCoords ? input.location : null,
    headline: input.title || '',
    body: input.description || '',
    sourceText: input.meta?.sourceText || src.sourceText || '',
    unresolvedPlaceName: src.unresolvedPlaceName || '',
    reviewedNewsCopy: src.reviewedNewsCopy, reviewedCopy: src.reviewedCopy,
    attributedReport: src.attributedReport, timedNews: src.timedNews,
    localityReference: src.localityReference, imageContext: src.imageContext,
    location_display: src.location_display, channel_media: src.channel_media,
    aerialMode: input.meta?.aerialMode || src.aerialMode || null,
    flightTarget: input.meta?.flightTarget || src.flightTarget || null,
  };
  const r = ensureDraftCardLocation(view);
  if (r.action === 'bound') { input.location = view.location; input.place = view.location; }
  if (r.action === 'held' && r.reason === LOCATION_TEXT_CONFLICT_REASON) {
    // A 'toward' flight alert legitimately names a SECOND place in its own
    // outgoing copy: the destination. buildAlertInput generates the title
    // itself («origin — نحو target») and the reporter's details describe
    // the same heading, so the cross-check's winning place can be exactly
    // the flight target — that is the copy naming its own destination, not
    // a contradiction of the origin pin. Forgive ONLY that exact case: a
    // single, conflict-free resolution that lands on the target place. A
    // winner that is a third place, or genuinely conflicting texts, still
    // holds. (Owner's own Aleppo-city -> Safira drone report was held by
    // this check on 2026-11-26 while the governorate-origin variant —
    // which takes the bind/upgrade branch instead — passed.)
    const targetId = input.meta?.flightTarget?.place_id ?? src.flightTarget?.place_id ?? null;
    if (targetId != null) {
      const resolved = resolveDraftPlace(view);
      if (!resolved.conflict && resolved.placeId != null && Number(resolved.placeId) === Number(targetId)) {
        return { action: 'present', flightTargetNamed: true };
      }
    }
  }
  return r;
}

/** Thrown by the shared publish entry when the guard holds a draft, so a
 * location-less card can never slip out through any caller. */
export class MissingCardLocationError extends Error {
  constructor() {
    super('النشر متوقف: هذا الخبر بلا موقع، ونصّه لا يذكر مكاناً سورياً قابلاً للتحديد من بيانات المشروع الجغرافية. حدّد الموقع يدوياً ثم أعد النشر.');
    this.name = 'MissingCardLocationError';
    this.code = MISSING_CARD_LOCATION_REASON;
  }
}
