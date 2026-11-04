import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ISRAEL_APPROX_REFERENCE,
  isLegacyQuneitraArchiveAlert,
  legacyQuneitraArchivePath,
} from '../shared/flight-path.js';

const alertFixture = () => ({
  id: 'be418c7b-510c-458e-b8d9-0c504730c50b',
  type: 'air_movement',
  aircraft: 'warplane',
  flight_direction: 'toward_syria',
  flight_target: { scope: 'governorate', name_ar: 'القنيطرة', name_en: 'Quneitra', latitude: 33.12595, longitude: 35.82461 },
  title: 'طيران حربي — باتجاه سوريا — نحو القنيطرة',
  title_en: 'Warplane — Toward Syria — toward Quneitra',
  location: { latitude: 32.87622, longitude: 35.87609 },
  place: { name_ar: 'صيدا', name_en: 'Sayda' },
  timestamp: '2026-11-04T20:37:48.846Z',
  expires_at: '2026-11-04T20:52:48.846Z',
  ended_at: '2026-11-04T20:52:48.846Z',
  is_active: false,
  telegram_url: 'https://t.me/Red_Alert_Syria/703',
});

test('the exact ended Sayda warplane alert receives only the approximate Israel-to-Quneitra archive route', () => {
  const alert = alertFixture();
  const before = structuredClone(alert);
  assert.equal(isLegacyQuneitraArchiveAlert(alert), true);
  assert.deepEqual(legacyQuneitraArchivePath(alert), [ISRAEL_APPROX_REFERENCE, [35.82461, 33.12595]]);
  assert.deepEqual(alert, before, 'route generation does not modify alert status, text, timestamp, Telegram link, or saved report location');
  assert.deepEqual(alert.location, { latitude: 32.87622, longitude: 35.87609 }, 'the report location remains Sayda');
  assert.equal(alert.is_active, false, 'the archived alert remains inactive');
});

test('active, differently identified, mismatched, or incomplete alerts never receive the archive exception', () => {
  const alert = alertFixture();
  const variants = [
    { ...alert, is_active: true },
    { ...alert, id: 'some-other-historical-alert' },
    { ...alert, aircraft: 'uav' },
    { ...alert, flight_direction: 'leaving_syria' },
    { ...alert, place: { ...alert.place, name_ar: 'مكان آخر' } },
    { ...alert, location: { ...alert.location, longitude: 35.8762 } },
    { ...alert, flight_target: { ...alert.flight_target, name_en: 'Daraa' } },
    { ...alert, ended_at: undefined },
    { ...alert, expires_at: 'invalid-date' },
  ];
  for (const variant of variants) {
    assert.equal(isLegacyQuneitraArchiveAlert(variant), false);
    assert.deepEqual(legacyQuneitraArchivePath(variant), []);
  }
});

test('the map renders the archive overlay only for the currently selected record and the detail panel labels it illustrative and expired', async () => {
  const map = await readFile(new URL('../public/js/map.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(map, /this\.selectedAlert\?\.id === this\.selectedId[\s\S]{0,180}isLegacyQuneitraArchiveAlert/);
  assert.match(map, /const archivedRoute = archivedAlert \? legacyQuneitraArchivePath\(archivedAlert\) : \[\]/);
  assert.match(map, /archived: true/);
  assert.match(map, /archiveRoute\.length === 2 && fly[\s\S]{0,260}this\.map\.fitBounds/);
  assert.match(app, /const archivedQuneitraRoute = isLegacyQuneitraArchiveAlert\(a\)/);
  assert.match(app, /Illustrative archive route only/);
  assert.match(app, /this alert is expired and inactive/);
  assert.match(app, /The original report location remains Sayda \(Saida\)/);
});
