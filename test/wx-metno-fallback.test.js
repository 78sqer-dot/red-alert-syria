import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ras-metno-fallback-'));
process.env.TELEGRAM_BACKUP = 'false';
process.env.BOT_MODE = 'webhook';

const { CAP_FEED_URL } = await import('../server/weather-official.js');
const { publicWeather, weatherNowDebug } = await import('../server/wx-daily.js');

function forecastFixture() {
  const stamp = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const instant = (temperature) => ({ air_temperature: temperature, relative_humidity: 57, wind_speed: 2.5, wind_speed_of_gust: 6 });
  return {
    properties: {
      timeseries: [
        { time: stamp(0), data: { instant: { details: instant(14.6) }, next_1_hours: { summary: { symbol_code: 'clearsky_day' }, details: { precipitation_amount: 0, probability_of_precipitation: 0 } } } },
        { time: stamp(6), data: { instant: { details: instant(12.4) }, next_6_hours: { summary: { symbol_code: 'lightrain' }, details: { precipitation_amount: 1.2, probability_of_precipitation: 40, air_temperature_max: 18.1, air_temperature_min: 11.8 } } } },
        { time: stamp(30), data: { instant: { details: instant(10.2) }, next_6_hours: { summary: { symbol_code: 'partlycloudy_day' }, details: { precipitation_amount: 0.2, probability_of_precipitation: 10, air_temperature_max: 17.3, air_temperature_min: 9.9 } } } },
      ],
    },
  };
}

test('MET Norway fills the forecast layer when Open-Meteo is rate-limited and is cached with attribution', async () => {
  const originalFetch = globalThis.fetch;
  const counts = { openMeteo: 0, metNorway: 0, cap: 0, activeMet: 0, maxActiveMet: 0 };
  const lastModified = new Date(Date.now() - 60_000).toUTCString();
  const expires = new Date(Date.now() + 25 * 60_000).toUTCString();
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === 'api.open-meteo.com') {
      counts.openMeteo += 1;
      return new Response('', { status: 429 });
    }
    if (url.hostname === 'api.met.no' && url.pathname === '/weatherapi/locationforecast/2.0/compact') {
      counts.metNorway += 1;
      counts.activeMet += 1;
      counts.maxActiveMet = Math.max(counts.maxActiveMet, counts.activeMet);
      const ua = options.headers?.['User-Agent'] || options.headers?.get?.('User-Agent') || '';
      assert.match(ua, /red-alert-syria\.onrender\.com/, 'MET Norway requests carry an identifying application URL');
      assert.match(url.searchParams.get('lat') || '', /^-?\d+\.\d{4}$/);
      assert.match(url.searchParams.get('lon') || '', /^-?\d+\.\d{4}$/);
      await new Promise((resolve) => setTimeout(resolve, 3));
      counts.activeMet -= 1;
      return new Response(JSON.stringify(forecastFixture()), { status: 200, headers: { 'Content-Type': 'application/json', Expires: expires, 'Last-Modified': lastModified } });
    }
    if (url.href === CAP_FEED_URL) {
      counts.cap += 1;
      return new Response('<rss><channel></channel></rss>', { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
    }
    throw new Error(`Unexpected external request in isolated test: ${url.href}`);
  };

  try {
    const result = await publicWeather();
    assert.equal(result.forecastSource.name, 'MET Norway');
    assert.equal(result.forecastSource.adapted, true);
    assert.equal(result.forecastSource.licenceUrl, 'https://creativecommons.org/licenses/by/4.0/');
    assert.equal(result.forecastsAvailable, true);
    assert.ok(result.points.filter((point) => point.main).length >= 10);
    assert.equal(result.points[0].now.t, 15);
    assert.equal(result.points[0].now.wind, 9, 'MET Norway m/s are converted to the map’s km/h');
    assert.equal(result.points[0].now.hum, 57);
    assert.equal(result.points[0].now.k, 'sun');
    assert.ok(result.points[0].days.length >= 1);
    assert.equal(weatherNowDebug().source, 'MET Norway');
    assert.equal(counts.openMeteo, 1, 'a failed primary request immediately activates fallback');
    assert.ok(counts.metNorway >= 10);
    assert.ok(counts.maxActiveMet <= 4, 'fallback requests remain below the per-application request limit');

    const afterFirstLoad = counts.metNorway;
    const cached = await publicWeather();
    assert.equal(cached.forecastSource.name, 'MET Norway');
    assert.equal(counts.metNorway, afterFirstLoad, 'the MET Expires cache prevents repeated point requests');
    assert.equal(counts.cap, 1, 'official CAP warnings remain a separate feed and are fetched once');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
