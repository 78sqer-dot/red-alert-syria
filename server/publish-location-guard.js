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
import { locationFrom, mentionedGovernorates, normalizeArabic } from './places.js';
import { scanTextPlaces, resolvePlace } from './news-ai.js';

export const MISSING_CARD_LOCATION_REASON = 'missing-location';
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
      if (!slice.every((t, k) => t === words[k] || stripAlWord(t) === words[k])) continue;
      const before = i > 0 ? stripAlWord(tokens[i - 1]) : '';
      if (before === 'ريف' || before === 'بريف' || before === 'محافظه' || before === 'بمحافظه') continue;
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
export function placeIdFromText(text) {
  const ids = new Set();
  const govs = mentionedGovernorates(text);
  for (const g of govs) {
    for (const id of scanTextPlaces(text, g.code, 3)) ids.add(id);
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

/** The single identifiable place in the draft's own text, or null. */
export function resolveDraftPlaceId(d) {
  const texts = [];
  const add = (t) => { const s = String(t || '').trim(); if (s && !texts.includes(s)) texts.push(s); };
  add([d?.headline, d?.body].filter(Boolean).join('\n'));
  add(d?.sourceText);
  add([d?.title, d?.description].filter(Boolean).join('\n'));
  add(d?.searchSourceText);
  for (const text of texts) {
    const id = placeIdFromText(text);
    if (id != null) return id;
  }
  return null;
}

/** Run the guard on a draft (either location convention: d.location for
 * bot drafts, d.loc for monitor drafts — a bind writes both). Returns
 * {action: 'exempt'|'present'|'bound'|'held', ...}; 'held' carries the
 * recorded reason and means: do not publish. */
export function ensureDraftCardLocation(d) {
  if (!cardLocationGuardApplies(d)) return { action: 'exempt' };
  if (draftCardLocationState(d) === 'present') return { action: 'present' };
  const placeId = resolveDraftPlaceId(d);
  const loc = placeId == null ? null : locationFrom({ placeId });
  if (!loc) return { action: 'held', reason: MISSING_CARD_LOCATION_REASON };
  d.location = loc;
  d.loc = loc;
  return { action: 'bound', placeId, location: loc };
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
