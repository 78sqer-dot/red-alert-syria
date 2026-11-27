import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Owner order 2026-11-24 (restored 2026-11-25 after the live failure):
// a map-card alert never publishes with an empty location. The publish-path
// guard binds the one identifiable Syrian place in the alert's own text
// from the project gazetteer, or holds the alert for manual review with
// the reason recorded — no bare whole-Syria cards, no approximate guessing.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-location-guard-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = 'test-token-not-real-123456';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';

const {
  ensureDraftCardLocation, cardLocationGuardApplies, draftCardLocationState,
  resolveDraftPlaceId, MissingCardLocationError, MISSING_CARD_LOCATION_REASON,
  districtFramedNames, ensureBuiltAlertLocation,
} = await import('../server/publish-location-guard.js');
const { locationFrom, getPlace } = await import('../server/places.js');
const { store } = await import('../server/store.js');
await store.init(null);
const { nightEligible } = await import('../server/news-monitor.js');
const { publishDraft } = await import('../server/bot.js');
const { nameInText } = await import('../server/news-ai.js');

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

const HAMA_TEXT = 'وقع انفجار في مدينة حماة مساء اليوم وأصاب 3 أشخاص.';
const NO_PLACE_TEXT = 'وقع انفجار قوي مساء اليوم وأصاب 3 أشخاص.';
const TWO_PLACES_TEXT = 'وقع انفجار في مدينة حماة ووقع انفجار في مدينة حلب';
// The two live failures of 2026-11-25, in the form they were published:
// the gazetteer holds both places (جدوع 169292 via its alias جدوعة, and
// رجم العجوز 4343) — the drafts still went out with a whole-country card.
const JADUA_TEXT = 'اغتيال شخص بإطلاق نار في بلدة جدوعة بريف حماة الشمالي';
const RAJM_TEXT = 'انفجار عبوة ناسفة في قرية رجم العجوز بريف الرقة الشرقي';

test('guard binds the one identifiable place from the draft text', () => {
  const d = { type: 'explosion', location: locationFrom({}), headline: '', sourceText: HAMA_TEXT };
  const r = ensureDraftCardLocation(d);
  assert.equal(r.action, 'bound');
  assert.equal(d.location.scope, 'place');
  assert.equal(d.location.place_id, r.placeId);
  assert.equal(d.location.name_ar, 'حماة');
  assert.equal(d.location.latitude, getPlace(r.placeId).lat);
  assert.equal(d.location.longitude, getPlace(r.placeId).lon);
  assert.equal(d.loc, d.location, 'both location conventions are written');
  assert.equal(draftCardLocationState(d), 'present');
});

test('LIVE REGRESSION 2026-11-25: a Jadu\'a-style assassination draft binds جدوع from its alias جدوعة', () => {
  const d = { type: 'assassination', location: locationFrom({}), headline: '', sourceText: JADUA_TEXT };
  const r = ensureDraftCardLocation(d);
  assert.equal(r.action, 'bound');
  assert.equal(r.placeId, 169292);
  assert.equal(d.location.name_ar, 'جدوع');
  assert.equal(d.location.latitude, 35.13967);
  assert.equal(d.location.longitude, 37.18467);
});

test('LIVE REGRESSION 2026-11-25: a Rajm al-Ajuz-style explosion draft binds رجم العجوز', () => {
  const d = { type: 'explosion', loc: locationFrom({}), headline: '', sourceText: RAJM_TEXT };
  const r = ensureDraftCardLocation(d);
  assert.equal(r.action, 'bound');
  assert.equal(r.placeId, 4343);
  assert.equal(d.loc.name_ar, 'رجم العجوز');
  assert.equal(d.loc.latitude, 35.54336);
  assert.equal(d.loc.longitude, 39.06326);
  assert.equal(d.location, d.loc);
});

test('guard holds a location-less draft whose text names no identifiable place', () => {
  const d = { type: 'explosion', location: locationFrom({}), headline: '', sourceText: NO_PLACE_TEXT };
  const r = ensureDraftCardLocation(d);
  assert.deepEqual(r, { action: 'held', reason: MISSING_CARD_LOCATION_REASON });
  assert.equal(d.location.scope, 'country', 'a held draft is never mutated into a guess');
});

test('guard holds when the text names two different incident places (no unique binding)', () => {
  const d = { type: 'explosion', location: locationFrom({}), headline: '', sourceText: TWO_PLACES_TEXT };
  assert.equal(resolveDraftPlaceId(d), null);
  assert.equal(ensureDraftCardLocation(d).action, 'held');
});

test('guard leaves a located draft untouched when its text names no conflicting place', () => {
  // Superseded expectation (Saqr's correction 2026-11-25): the old version
  // of this test pinned the bypass he flagged — a located draft passed even
  // when its text named a different place. Now: no unique text place (or a
  // matching one) leaves the location untouched; a positive conflict holds
  // (covered by the corrections tests below).
  const loc = locationFrom({ placeId: 169292 });
  const d = { type: 'explosion', location: loc, headline: '', sourceText: NO_PLACE_TEXT };
  assert.deepEqual(ensureDraftCardLocation(d), { action: 'present' });
  assert.equal(d.location, loc);
});

test('governorate scope and extra areas both count as having a location', () => {
  const gov = { type: 'explosion', location: locationFrom({ govCode: '10' }), headline: '', sourceText: NO_PLACE_TEXT };
  assert.equal(ensureDraftCardLocation(gov).action, 'present');
  const areas = { type: 'explosion', location: locationFrom({}), extra: [locationFrom({ placeId: 169292 })], headline: '', sourceText: NO_PLACE_TEXT };
  assert.equal(ensureDraftCardLocation(areas).action, 'present');
});

test('designed-context and non-incident flows are exempt', () => {
  const base = { location: locationFrom({}), headline: '', sourceText: NO_PLACE_TEXT };
  for (const type of ['weather', 'political', 'air_movement', 'civil_plane', 'road']) {
    assert.equal(cardLocationGuardApplies({ ...base, type }), false, type);
    assert.equal(ensureDraftCardLocation({ ...base, type }).action, 'exempt', type);
  }
  assert.equal(ensureDraftCardLocation({ ...base, type: 'breaking', reviewedCopy: { version: 2 } }).action, 'exempt');
  assert.equal(ensureDraftCardLocation({ ...base, type: 'breaking', reviewedNewsCopy: {} }).action, 'exempt');
  assert.equal(ensureDraftCardLocation({ ...base, type: 'explosion', imageContext: { latitude: 34.85, longitude: 38.6 } }).action, 'exempt');
  assert.equal(ensureDraftCardLocation({ ...base, type: 'explosion', channel_media: 'photo' }).action, 'exempt');
  assert.equal(cardLocationGuardApplies({ ...base, type: 'explosion' }), true);
});

test('auto-publish integration: a bound Jadu\'a draft becomes night-eligible; an unresolvable one stays ineligible', () => {
  const srcs = [{ u: 'wire-1', local: false }, { u: 'wire-2', local: false }];
  const bound = { type: 'assassination', status: 'pending', created: Date.now(), headline: JADUA_TEXT, sourceText: JADUA_TEXT, loc: locationFrom({}), srcs };
  assert.equal(nightEligible(bound), false, 'location-less drafts are not auto-eligible before the guard');
  assert.equal(ensureDraftCardLocation(bound).action, 'bound');
  assert.equal(nightEligible(bound), true, 'once bound from the gazetteer the draft may auto-publish with a zoomed card');
  const held = { type: 'explosion', status: 'pending', created: Date.now(), headline: NO_PLACE_TEXT, sourceText: NO_PLACE_TEXT, loc: locationFrom({}), srcs };
  assert.equal(ensureDraftCardLocation(held).action, 'held');
  assert.equal(nightEligible(held), false);
});

test('publishDraft (the shared manual entry) refuses a held draft before anything is published', async () => {
  const d = { type: 'explosion', headline: '', sourceText: NO_PLACE_TEXT, location: locationFrom({}) };
  await assert.rejects(
    publishDraft({}, d, { id: 1, name: 'test' }),
    (e) => e instanceof MissingCardLocationError && e.code === MISSING_CARD_LOCATION_REASON,
  );
});

test('nameInText: the gazetteer primary name matches its ة-form in the text (the alias hole)', () => {
  assert.equal(nameInText('جدوع', JADUA_TEXT), true);
  assert.equal(nameInText('جدوعة', JADUA_TEXT), true);
  assert.equal(nameInText('الصنمين', JADUA_TEXT), false, 'absent places still fail the anti-invention check');
});

test("Saqr's corrections (2026-11-25): headline and source naming different places is a conflict, never a first-wins bind", () => {
  // His synthetic, with the project's own live places: the outgoing copy
  // names جدوعة (binds جدوع, Hama) while the source names رجم العجوز (Raqqa).
  const d = { type: 'explosion', location: locationFrom({}), headline: JADUA_TEXT, sourceText: RAJM_TEXT };
  const r = ensureDraftCardLocation(d);
  assert.equal(r.action, 'held');
  assert.equal(r.reason, 'location-text-conflict');
  assert.equal(d.location?.scope, 'country', 'nothing was bound over the conflict');
  // and the resolver itself reports the disagreement instead of picking one
  assert.equal(resolveDraftPlaceId(d), null);
});

test("Saqr's corrections: a pre-existing location is re-verified against the text — a mismatch holds, a match passes", () => {
  const jaduaLoc = locationFrom({ placeId: 169292 });
  const matching = { type: 'assassination', location: jaduaLoc, headline: JADUA_TEXT, sourceText: JADUA_TEXT };
  assert.equal(ensureDraftCardLocation(matching).action, 'present', 'bound place == text place: passes');
  const mismatched = { type: 'explosion', location: jaduaLoc, headline: RAJM_TEXT, sourceText: RAJM_TEXT };
  const r = ensureDraftCardLocation(mismatched);
  assert.equal(r.action, 'held', 'coordinates naming جدوع over a رجم العجوز text no longer sail through');
  assert.equal(r.reason, 'location-text-conflict');
});

test("Saqr's corrections: the manual publish path checks the guard before claiming, and a guard throw never becomes «uncertain»", () => {
  const monitor = fs.readFileSync(new URL('../server/news-monitor.js', import.meta.url), 'utf8');
  const guardAt = monitor.indexOf('Location guard BEFORE the claim');
  const claimAt = monitor.indexOf('if (!await durablePublicationClaim(d)) return toast', guardAt);
  assert.ok(guardAt > 0 && claimAt > guardAt, 'the guard runs before durablePublicationClaim in the manual path');
  const catchAt = monitor.indexOf("e?.name === 'MissingCardLocationError'", claimAt);
  const uncertainAt = monitor.indexOf('await uncertainPublication(d);', claimAt);
  assert.ok(catchAt > claimAt && catchAt < uncertainAt, 'the catch releases a guard-stopped claim instead of marking the send uncertain');
});

// LIVE REGRESSION 2026-11-25 (evening): «المشيرفة» — a Hasakah-city
// neighbourhood absent from the gazetteer. Classification degraded the
// named place to governorate scope; the old 'present' check counted
// governorate scope as a real location and two alerts (breaking 41d6f520,
// clashes b182d7a5) auto-published with location:null and a bare
// governorate card. The city fallback also could not see «بالحسكة»
// (preposition glued to the city name).
const MUSHAIRIFA_TEXT = 'سماع أصوات اشتباكات في حي المشيرفة بالحسكة مساء اليوم';
const govLoc = () => locationFrom({ govCode: '01' });

test('LIVE REGRESSION 2026-11-25: a neighbourhood draft degraded to governorate scope binds its parent city named in the text', () => {
  const d = { type: 'clashes', loc: govLoc(), location: govLoc(), headline: 'اشتباكات مسلحة — المشيرفة بالحسكة', sourceText: MUSHAIRIFA_TEXT, unresolvedPlaceName: 'المشيرفة' };
  const r = ensureDraftCardLocation(d);
  assert.equal(r.action, 'bound');
  assert.equal(r.upgradedFromGovernorate, true);
  assert.equal(d.location.scope, 'place');
  assert.equal(d.location.name_ar, 'الحسكة');
});

test('an unresolved named place with NO resolvable city in the text is HELD, never published bare', () => {
  const d = { type: 'clashes', loc: govLoc(), location: govLoc(), headline: 'اشتباكات في حي المشيرفة بريف الحسكة', sourceText: 'اشتباكات في حي المشيرفة بريف الحسكة مساء اليوم', unresolvedPlaceName: 'المشيرفة' };
  const r = ensureDraftCardLocation(d);
  assert.equal(r.action, 'held');
  assert.equal(r.reason, MISSING_CARD_LOCATION_REASON);
});

test('genuine governorate-wide news (no unresolved named place) still passes with governorate scope', () => {
  const d = { type: 'breaking', loc: govLoc(), location: govLoc(), headline: 'انقطاع الكهرباء عن محافظة الحسكة', sourceText: 'انقطاع التيار الكهربائي عن عموم محافظة الحسكة' };
  const r = ensureDraftCardLocation(d);
  assert.equal(r.action, 'present');
  assert.equal(d.location.scope, 'governorate');
});

// LIVE REGRESSION 2026-11-25 (late): the draft-stage guard was not the last
// word — buildAlertInput's incident-location derivation runs after it and
// (a) fabricated a coordinate-less governorate label for e2aac81d
// («مشيرفة بمدينة الحسكة», 22:53, published bare), (b) kept the
// name-collision village for post 1599. The funnel check on the built
// input is now the last word.
test('funnel: a coordinate-less governorate label binds the parent city from the outgoing copy', async () => {
  const { ensureBuiltAlertLocation } = await import('../server/publish-location-guard.js');
  const input = {
    type: 'martyrdom',
    title: 'استشهاد — مشيرفة بمدينة الحسكة',
    description: 'إعلان مقتل عنصري أمن داخلي وإصابة 5 آخرين في الهجوم على مقر عسكري بحي مشيرفة في الحسكة',
    location: { scope: 'governorate', name_ar: 'مشيرفة بمدينة الحسكة', governorate: '01', governorate_ar: 'الحسكة', governorate_en: 'Al Hasakah' },
    meta: { sourceText: 'إعلان مقتل عنصرين في الهجوم على مقر عسكري بحي مشيرفة في الحسكة' },
  };
  const r = ensureBuiltAlertLocation(input, {});
  assert.equal(r.action, 'bound');
  assert.equal(input.location.scope, 'place');
  assert.equal(input.location.name_ar, 'الحسكة');
  assert.equal(input.place, input.location);
});

test('funnel: a name-collision village is held when the outgoing copy frames it as a city district (post 1599)', async () => {
  const { ensureBuiltAlertLocation } = await import('../server/publish-location-guard.js');
  const input = {
    type: 'explosion',
    title: 'انفجار — المشيرفة',
    description: 'صوت الانفجار الذي سُمِع في حي المشيرفة بالحسكة ناجم عن تفجير دراجة نارية مفخخة عند مدخل نقطة أمنية',
    location: locationFrom({ placeId: 383659 }),
    meta: { sourceText: 'صوت انفجار سُمِع في حي المشيرفة بالحسكة' },
  };
  const r = ensureBuiltAlertLocation(input, {});
  assert.equal(r.action, 'held');
  assert.equal(r.reason, 'location-text-conflict');
});

// LIVE REGRESSION, end-to-end (post 1599, 2026-11-25): a news draft bound to
// the name-collision village المشيرفة (383659, at 42.13E) whose OUTGOING
// body frames it as a Hasakah-city district must be refused by the shared
// publish entry — the funnel check is the last word.
test('publishDraft refuses the post-1599 shape end-to-end (village pin vs حي framing)', async () => {
  const { config } = await import('../server/config.js');
  config.alertImages = false; config.channel = '@synthetic';
  const BODY = 'صوت الانفجار الذي سُمِع في حي المشيرفة بالحسكة ناجم عن تفجير دراجة نارية مفخخة عند مدخل نقطة أمنية';
  const d = {
    source: 'news', type: 'explosion',
    location: locationFrom({ placeId: 383659 }), extra: [],
    headline: 'انفجار — المشيرفة', details: BODY, text: BODY,
    sourceText: 'انفجار دراجة نارية مفخخة عند نقطة أمنية في المشيرفة بالحسكة',
  };
  const api = { sendMessage: async () => ({ message_id: 999 }), sendPhoto: async () => ({ message_id: 999 }) };
  await assert.rejects(
    publishDraft(api, d, { id: 1, name: 'test' }),
    (e) => e.name === 'MissingCardLocationError' && e.code === 'location-text-conflict',
  );
});

// LIVE REGRESSION (owner's own report, 2026-11-26): a 'toward' drone report
// whose ORIGIN is a specific city place (Aleppo city) and whose generated
// title names the destination (Safira) was held by the funnel as a
// 'location-text-conflict' — the cross-check read the alert's own heading
// phrase as a rival location claim. The governorate-origin variant passed
// (bind/upgrade branch), which is why the bot-side flow tests stayed green
// while the owner's real report vanished. The target naming its own
// destination is not a contradiction; a third place still is.
test('funnel: a toward alert naming its flight target in the title is not a location conflict', async () => {
  const { ensureBuiltAlertLocation } = await import('../server/publish-location-guard.js');
  const input = {
    type: 'uav',
    title: 'تحليق مسيّرة — حلب — نحو السفيرة - حلب',
    description: '',
    location: locationFrom({ placeId: 170063 }), // Aleppo city (origin)
    meta: { flightTarget: locationFrom({ placeId: 172503 }) }, // Safira (target)
  };
  const r = ensureBuiltAlertLocation(input, {});
  assert.equal(r.action, 'present');
  assert.equal(r.flightTargetNamed, true);
});

test('funnel: a flight target does not forgive a genuinely conflicting third place', async () => {
  const { ensureBuiltAlertLocation } = await import('../server/publish-location-guard.js');
  const input = {
    type: 'uav',
    title: 'تحليق مسيّرة — حلب — نحو السفيرة - حلب',
    description: '',
    location: locationFrom({ placeId: 170063 }),
    meta: { flightTarget: locationFrom({ placeId: 172503 }), sourceText: 'تحليق مسيّرة فوق حمص' },
  };
  const r = ensureBuiltAlertLocation(input, {});
  assert.equal(r.action, 'held');
  assert.equal(r.reason, 'location-text-conflict');
});

test('publishDraft publishes the owner-shape toward report (city origin, place target)', async () => {
  const { config } = await import('../server/config.js');
  config.alertImages = false; config.channel = '@synthetic';
  const d = {
    source: 'telegram', type: 'uav', aerialMode: 'toward',
    location: locationFrom({ placeId: 170063 }), extra: [],
    flightTarget: locationFrom({ placeId: 172503 }),
    details: '', text: '',
  };
  const api = { sendMessage: async () => ({ message_id: 999 }), sendPhoto: async () => ({ message_id: 999 }) };
  const alert = await publishDraft(api, d, { id: 1, name: 'test' });
  assert.ok(alert && alert.id, 'the toward report published instead of being held');
  assert.equal(alert.meta?.aerialMode, 'toward');
  assert.equal(alert.meta?.flightTarget?.place_id, 172503);
  // the stored alert location is the ORIGIN (Aleppo city), coordinates only
  assert.equal(alert.location?.latitude, 36.20124);
  assert.equal(alert.location?.longitude, 37.16117);
});

// Same owner-shape regression for the warplane (owner order 2026-11-26:
// «شوف كمان الحربي والمروحية»): a toward warplane report with a city origin
// died on the same funnel conflict before f0dbaee and must publish.
test('publishDraft publishes the owner-shape toward report for a warplane (city origin, place target)', async () => {
  const { config } = await import('../server/config.js');
  config.alertImages = false; config.channel = '@synthetic';
  const d = {
    source: 'telegram', type: 'warplane', aerialMode: 'toward',
    location: locationFrom({ placeId: 170063 }), extra: [],
    flightTarget: locationFrom({ placeId: 172503 }),
    details: '', text: '',
  };
  const api = { sendMessage: async () => ({ message_id: 999 }), sendPhoto: async () => ({ message_id: 999 }) };
  const alert = await publishDraft(api, d, { id: 1, name: 'test' });
  assert.ok(alert && alert.id, 'the toward warplane report published instead of being held');
  assert.equal(alert.meta?.aerialMode, 'toward');
  assert.equal(alert.meta?.flightTarget?.place_id, 172503);
  assert.equal(alert.location?.latitude, 36.20124);
  assert.equal(alert.location?.longitude, 37.16117);
});

// LIVE REGRESSION 2026-11-26 (post 1632, alert e166a6c4): «دوار الصالحية»
// is a roundabout INSIDE Hasakah city; the gazetteer also holds a village
// named الصالحية in Al-Malikiyah countryside (id 8595805, 37.0132/41.9823).
// The frame set recognised only «حي», so the resolver bound the village
// and the alert published with a false 1.8 km zone ~55 km from the event.
const SALIHIYA_TEXT = 'مقتل شخص برصاص طائش جراء الاشتباك الذي وقع قرب دوار الصالحية في الحسكة.';

test('LIVE REGRESSION 2026-11-26: a roundabout-framed name binds the named city, not the same-named village', () => {
  const d = { type: 'death', location: locationFrom({ govCode: '01' }), headline: 'وفاة — الصالحية', sourceText: SALIHIYA_TEXT };
  assert.equal(resolveDraftPlaceId(d), 173811, 'Hasakah city, not the Al-Malikiyah village 8595805');
  assert.deepEqual([...districtFramedNames(SALIHIYA_TEXT)].some((n) => n.includes('صالحي')), true);
});

test('LIVE REGRESSION 2026-11-26: a square-framed name binds the named city too', () => {
  const d = { type: 'death', location: locationFrom({ govCode: '01' }), headline: '', sourceText: 'إصابة شخص جراء حادث سير في ساحة الصالحية في الحسكة.' };
  assert.equal(resolveDraftPlaceId(d), 173811);
});

test('LIVE REGRESSION 2026-11-26: a village-built alert whose text frames the name as a roundabout is held, not passed', () => {
  const village = locationFrom(getPlace(8595805));
  const built = { type: 'death', location: village, loc: village, title: 'وفاة — الصالحية', description: SALIHIYA_TEXT, place: village };
  assert.deepEqual(ensureBuiltAlertLocation(built, {}), { action: 'held', reason: 'location-text-conflict' });
});

// LIVE REGRESSION 2026-11-27 (post 1645, alert 176c3b25): «أطراف وادي
// الرقاد بريف درعا» — a specific wadi absent from the gazetteer. The
// draft reached the guard at governorate scope with NO unresolved-place
// marking (classification never marked a place the resolver cannot find
// at all), so the governorate branch waved a bare governorate card
// through and the API served the capital's point with a 4.5 km circle.
const RAQAD_TEXT = 'توغل ثماني آليات عسكرية إسرائيلية على أطراف وادي الرقاد بريف درعا';
const govLoc06 = () => locationFrom({ govCode: '06' });

test('LIVE REGRESSION 2026-11-27: a governorate draft whose text frames an unresolvable specific place is held, marking or not', () => {
  const d = { type: 'military_incursion', loc: govLoc06(), location: govLoc06(), headline: 'توغل عسكري — وادي الرقاد', sourceText: RAQAD_TEXT };
  assert.deepEqual(ensureDraftCardLocation(d), { action: 'held', reason: MISSING_CARD_LOCATION_REASON });
});

test('LIVE REGRESSION 2026-11-27: genuine governorate-wide news still passes at governorate scope', () => {
  const d = { type: 'clashes', loc: govLoc06(), location: govLoc06(), headline: '', sourceText: 'اشتباكات عنيفة بريف درعا الشمالي وقصف متبادل على عدة محاور' };
  assert.equal(ensureDraftCardLocation(d).action, 'present');
});

test('LIVE REGRESSION 2026-11-27: a framed village the gazetteer knows still binds from the governorate branch', () => {
  const d = { type: 'clashes', loc: govLoc06(), location: govLoc06(), headline: '', sourceText: 'اشتباكات في بلدة القنية بريف درعا' };
  const r = ensureDraftCardLocation(d);
  assert.equal(r.action, 'bound');
  assert.equal(r.placeId, 166139);
});
