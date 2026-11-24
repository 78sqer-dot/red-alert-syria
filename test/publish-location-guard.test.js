import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Owner order 2026-11-24: a map-card alert never publishes with an empty
// location. The publish-path guard binds the one identifiable Syrian place
// in the alert's own text from the project gazetteer, or holds the alert
// for manual review with the reason recorded — no bare whole-Syria cards,
// and no approximate guessing (the owner rejected that separately).
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-location-guard-'));
process.env.DATA_DIR = dataDir;
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_TOKEN = 'test-token';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL_ID = '@mock_news_channel';

const {
  ensureDraftCardLocation, cardLocationGuardApplies, draftCardLocationState,
  resolveDraftPlaceId, MissingCardLocationError, MISSING_CARD_LOCATION_REASON,
} = await import('../server/publish-location-guard.js');
const { locationFrom, getPlace } = await import('../server/places.js');
const { store } = await import('../server/store.js');
await store.init(null);
const { _test } = await import('../server/news-monitor.js');
const { publishDraft } = await import('../server/bot.js');

test.after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

const HAMA_ID = 170017; // حماة — a unique rank-1 city in the gazetteer
const HAMA_TEXT = 'وقع انفجار في مدينة حماة مساء اليوم وأصاب 3 أشخاص.';
const NO_PLACE_TEXT = 'وقع انفجار قوي مساء اليوم وأصاب 3 أشخاص.';
const TWO_PLACES_TEXT = 'وقع انفجار في مدينة حماة ووقع انفجار في مدينة حلب';

test('guard binds the one identifiable place from the draft text (the Hama failure mode)', () => {
  const d = { type: 'explosion', location: locationFrom({}), headline: '', sourceText: HAMA_TEXT };
  const r = ensureDraftCardLocation(d);
  assert.equal(r.action, 'bound');
  assert.equal(r.placeId, HAMA_ID);
  assert.equal(d.location.scope, 'place');
  assert.equal(d.location.place_id, HAMA_ID);
  assert.equal(d.location.name_ar, 'حماة');
  assert.equal(d.location.latitude, getPlace(HAMA_ID).lat);
  assert.equal(d.location.longitude, getPlace(HAMA_ID).lon);
  assert.equal(d.loc, d.location, 'both location conventions are written');
  assert.equal(draftCardLocationState(d), 'present');
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
  const loc = locationFrom({ placeId: HAMA_ID });
  const d = { type: 'explosion', location: loc, headline: '', sourceText: 'وقع انفجار في مدينة حلب مساء اليوم.' };
  assert.deepEqual(ensureDraftCardLocation(d), { action: 'present' });
  assert.equal(d.location, loc);
});

test('governorate scope and extra areas both count as having a location', () => {
  const gov = { type: 'explosion', location: locationFrom({ govCode: '10' }), headline: '', sourceText: NO_PLACE_TEXT };
  assert.equal(ensureDraftCardLocation(gov).action, 'present');
  const areas = { type: 'explosion', location: locationFrom({}), extra: [locationFrom({ placeId: HAMA_ID })], headline: '', sourceText: NO_PLACE_TEXT };
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

test('audit integration: a location-less auto draft naming Hama is bound and passes', () => {
  const d = {
    type: 'explosion', status: 'pending', created: Date.now(),
    headline: HAMA_TEXT, sourceText: HAMA_TEXT, loc: locationFrom({}),
    srcs: [{ u: 'audit-feed', local: false, ts: Date.now() }],
  };
  const r = _test.auditDraftForAutoPublish(d, 'night');
  assert.equal(r.ok, true);
  assert.ok(r.corrected.includes('location-bound-from-text'));
  assert.equal(d.loc.scope, 'place');
  assert.equal(d.loc.place_id, HAMA_ID);
});

test('audit integration: a location-less auto draft with no identifiable place fails as missing-location (held)', () => {
  const d = {
    type: 'explosion', status: 'pending', created: Date.now(),
    headline: NO_PLACE_TEXT, sourceText: NO_PLACE_TEXT, loc: locationFrom({}),
    srcs: [{ u: 'audit-feed', local: false, ts: Date.now() }],
  };
  assert.deepEqual(_test.auditDraftForAutoPublish(d, 'night'), { ok: false, reason: 'missing-location' });
  assert.equal(d.loc.scope, 'country');
});

test('publishDraft (the shared manual entry) refuses a held draft before anything is published', async () => {
  const d = { type: 'explosion', headline: '', sourceText: NO_PLACE_TEXT, location: locationFrom({}) };
  await assert.rejects(
    publishDraft({}, d, { id: 1, name: 'test' }),
    (e) => e instanceof MissingCardLocationError && e.code === MISSING_CARD_LOCATION_REASON,
  );
});
