import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Keep test persistence isolated from the working tree and production data.
process.env.DATA_DIR = path.join(os.tmpdir(), `ras-weather-controls-${process.pid}`);
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
process.env.TELEGRAM_BACKUP = 'false';
const { store } = await import('../server/store.js');
const { _test: weather } = await import('../server/weather.js');

const input = (title = 'Local weather test') => ({
  type: 'weather', source: 'weather', title, title_en: title,
  ttlMin: 60, // Simulates the old forecast/day boundary; it must not override owner duration.
  location: { latitude: 35, longitude: 37, name_ar: 'اختبار', name_en: 'Test', governorate_ar: 'حلب', governorate_en: 'Aleppo' },
  meta: { hazard: 'rain', day: '2026-10-27' },
});

function durationHours(alert) {
  return Math.round((Date.parse(alert.expires_at) - Date.parse(alert.timestamp)) / 3_600_000);
}

test('weather warnings follow 1h / 24h / 48h / no-expiry owner setting', () => {
  const created = [];
  try {
    for (const hours of [1, 24, 48]) {
      store.setAutoDelete(hours);
      const alert = store.addAlert(input(`Duration ${hours}`));
      created.push(alert.id);
      assert.equal(durationHours(alert), hours, `${hours}h should override the forecast TTL`);
    }

    store.setAutoDelete(0);
    const forever = store.addAlert(input('No expiry'));
    created.push(forever.id);
    assert.equal(forever.expires_at, null);
    store.expireSweep();
    assert.equal(store.getAlert(forever.id).is_active, true, 'no-expiry warning remains active');
  } finally {
    for (const id of created) store.deleteAlert(id);
  }
});

test('changing the owner setting updates active generated weather warnings only', () => {
  store.setAutoDelete(1);
  const warning = store.addAlert(input('Active warning'));
  const manualWeather = store.addAlert({ ...input('Manual warning'), source: 'telegram' });
  const originalManualExpiry = manualWeather.expires_at;
  try {
    store.setAutoDelete(48);
    assert.equal(durationHours(warning), 48);
    assert.equal(manualWeather.expires_at, originalManualExpiry, 'manual weather alert keeps its existing type TTL');
    store.setAutoDelete(0);
    assert.equal(warning.expires_at, null);
  } finally {
    store.deleteAlert(warning.id);
    store.deleteAlert(manualWeather.id);
  }
});

test('owner weather card states duration and keeps its delete button', () => {
  store.setAutoDelete(24);
  const alert = store.addAlert(input('Card duration'));
  try {
    const item = {
      id: 'local-test', pub: 'channel', alertId: alert.id,
      w: { hazard: 'rain', day: '2026-10-27', level: 1, govs: [{ gov: '08', v: 70, level: 1 }] },
    };
    const text = weather.cardText(item, false);
    assert.match(text, /مدة البقاء على الخريطة/);
    assert.match(text, /بعد 24 ساعة من النشر/);
    const buttons = weather.cardKb(item, false).inline_keyboard.flat();
    assert.ok(buttons.some((button) => button.callback_data === 'wx:d:local-test'));
    store.setAutoDelete(0);
    assert.match(weather.cardText(item, false), /بلا انتهاء/);
  } finally {
    store.deleteAlert(alert.id);
  }
});
