// Publish-path location guard (owner order 2026-11-24, kept as an exception to
// the handover restoration): an alert whose card would render must never go
// out with an empty location — the card image falls back to a bare whole-Syria
// view and the incident loses its place on the map. The guard runs in the
// publish path itself, for automatic and manual publication alike:
//   - the draft already carries a real location (or extra areas) -> untouched;
//   - its text names ONE identifiable Syrian place -> that place is bound from
//     the project's own gazetteer (places.js), exactly as a human drafter
//     picking it from the menu would, so the card zooms with its circle;
//   - no location and no single identifiable place in the text -> the draft
//     is HELD for manual review with the reason recorded — never published
//     bare, and a place is never guessed or approximated.
import { locationFrom } from './places.js';
import { sourceCardLocality } from './news-card-locality.js';

export const MISSING_CARD_LOCATION_REASON = 'missing-location';
export const CARD_LOCATION_BOUND_CORRECTION = 'location-bound-from-text';

export class MissingCardLocationError extends Error {
  constructor() {
    super('لا موقع محدداً ولا مكان قابلاً للتحديد في النص — حدّد الموقع أولاً.');
    this.name = 'MissingCardLocationError';
    this.code = MISSING_CARD_LOCATION_REASON;
    this.reason = MISSING_CARD_LOCATION_REASON;
  }
}

// Draft kinds whose card is not the incident map card, or whose country scope
// is a designed state — the guard never touches them.
const EXEMPT_TYPES = new Set(['political', 'air_movement', 'civil_plane', 'weather', 'road']);

export function cardLocationGuardApplies(d) {
  if (!d || typeof d !== 'object') return false;
  if (EXEMPT_TYPES.has(d.type)) return false;
  if (d.kind === 'channel_media' || d.channel_media) return false;
  // Designed-context editorial products carry their own reviewed geography.
  if (d.reviewedNewsCopy || d.reviewedCopy || d.attributedReport || d.timedNews || d.localityReference || d.imageContext) return false;
  if (d.location_display === 'geographic_reference' || d.location_display === 'approximate_point') return false;
  return true;
}

const realLoc = (l) => Boolean(l && l.scope !== 'country' && Number.isFinite(l.latitude) && Number.isFinite(l.longitude));

export function draftCardLocationState(d) {
  if (realLoc(d?.location) || realLoc(d?.loc)) return 'present';
  if ((Array.isArray(d?.extra) && d.extra.length) || (Array.isArray(d?.areas) && d.areas.length) || (Array.isArray(d?.zones) && d.zones.length)) return 'present';
  return 'missing';
}

/** The single identifiable place in the draft's own text, or null.
 * Governorate-only references do not bind (the owner asked for a city /
 * neighbourhood / town); ambiguity, person-name framing and unattached
 * mentions all fail closed inside sourceCardLocality. */
export function resolveDraftPlaceId(d) {
  const texts = [];
  const add = (t) => { const s = String(t || '').trim(); if (s && !texts.includes(s)) texts.push(s); };
  add([d?.headline, d?.body].filter(Boolean).join('\n'));
  add(d?.sourceText);
  add([d?.title, d?.description].filter(Boolean).join('\n'));
  add(d?.searchSourceText);
  const evidence = (Array.isArray(d?.srcs) ? d.srcs.map((s) => s?.u || s?.url).filter(Boolean) : []);
  for (const text of texts) {
    let ref = null;
    try { ref = sourceCardLocality(text, evidence.length ? evidence : ['publish-location-guard']); } catch { ref = null; }
    if (ref && Number.isFinite(ref.placeId)) return ref.placeId;
  }
  return null;
}

// Ensure a card-carrying draft has a location before it publishes.
// Returns { action: 'exempt' | 'present' | 'bound' | 'held', placeId? }.
// A bind writes the canonical gazetteer location onto the draft (both field
// spellings the pipelines use); a hold mutates nothing.
export function ensureDraftCardLocation(d) {
  if (!cardLocationGuardApplies(d)) return { action: 'exempt' };
  if (draftCardLocationState(d) === 'present') return { action: 'present' };
  const placeId = resolveDraftPlaceId(d);
  if (placeId == null) return { action: 'held', reason: MISSING_CARD_LOCATION_REASON };
  const loc = locationFrom({ placeId });
  if (!realLoc(loc)) return { action: 'held', reason: MISSING_CARD_LOCATION_REASON };
  d.location = loc;
  d.loc = loc;
  return { action: 'bound', placeId };
}
