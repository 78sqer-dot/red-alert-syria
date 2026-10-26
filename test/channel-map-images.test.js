import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

process.env.TELEGRAM_BACKUP = 'false';
process.env.DATA_DIR = path.join(os.tmpdir(), `red-alert-channel-map-test-${process.pid}`);
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

const [{ InputFile }, image, border, services] = await Promise.all([
  import('grammy'),
  import('../server/alert-image.js'),
  import('../server/borders.js'),
  import('../server/services.js'),
]);

const tilePng = image.svgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e8e1d8"/><path d="M0 64h256M0 128h256M0 192h256M64 0v256M128 0v256M192 0v256" stroke="#b6aa9c" stroke-width="5"/><circle cx="128" cy="128" r="18" fill="#ffffff"/></svg>', 256);

function mockApi(calls, { failPhoto = false } = {}) {
  return {
    async sendPhoto(...args) {
      calls.push({ method: 'sendPhoto', args });
      if (failPhoto) throw new Error('simulated Telegram photo rejection');
      return { message_id: 456 };
    },
    async sendMessage(...args) {
      calls.push({ method: 'sendMessage', args });
      return { message_id: 457 };
    },
  };
}

test('future crossing and road channel posts include a map photo with no text fallback', async (t) => {
  const originalFetch = globalThis.fetch;
  let tileRequests = 0;
  globalThis.fetch = async () => {
    tileRequests++;
    return new Response(tilePng, { status: 200, headers: { 'Content-Type': 'image/png' } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  border._test.setBorder('nasib', 'closed', 'اختبار محلي فقط', 1);
  const crossingCalls = [];
  const crossingResult = await border._test.postToChannel(mockApi(crossingCalls), 'nasib');
  assert.equal(crossingResult.message_id, 456);
  assert.deepEqual(crossingCalls.map((x) => x.method), ['sendPhoto']);
  assert.ok(crossingCalls[0].args[1] instanceof InputFile);
  assert.match(crossingCalls[0].args[2].caption, /نصيب/);
  assert.ok(crossingCalls[0].args[2].reply_markup.inline_keyboard.length > 0);

  const roadCalls = [];
  const road = {
    id: 'local-road-test', status: 'closed', ts: Date.now(), note: 'بلاغ تجريبي محلي',
    pts: [
      { lat: 33.5138, lon: 36.2765, name_ar: 'دمشق', name_en: 'Damascus', gov_ar: 'دمشق', scope: 'city' },
      { lat: 33.5270, lon: 36.3070, name_ar: 'باب توما', name_en: 'Bab Touma', gov_ar: 'دمشق', scope: 'place' },
    ],
  };
  const roadResult = await services.postRoadToChannel(mockApi(roadCalls), road);
  assert.equal(roadResult.message_id, 456);
  assert.deepEqual(roadCalls.map((x) => x.method), ['sendPhoto']);
  assert.ok(roadCalls[0].args[1] instanceof InputFile);
  assert.match(roadCalls[0].args[2].caption, /طريق مسكّر/);
  assert.ok(roadCalls[0].args[2].caption.length <= 1024);
  assert.ok(roadCalls[0].args[2].reply_markup.inline_keyboard.length > 0);
  assert.ok(tileRequests > 0, 'the renderer requested mocked map tiles');

  const failedCalls = [];
  await assert.rejects(border._test.postToChannel(mockApi(failedCalls, { failPhoto: true }), 'nasib'), /simulated Telegram photo rejection/);
  assert.deepEqual(failedCalls.map((x) => x.method), ['sendPhoto'], 'a failed image post must not become a text-only channel post');
});
