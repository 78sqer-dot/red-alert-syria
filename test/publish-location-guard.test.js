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

test('guard leaves a draft that already has a location untouched, even if the text names another place', () => {
  const loc = locationFrom({ placeId: 169292 });
  const d = { type: 'explosion', location: loc, headline: '', sourceText: 'وقع انفجار في مدينة حلب مساء اليوم.' };
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
