import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeTelegramPublicUrl,
  telegramArchiveOpenLink,
} from '../shared/telegram-links.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = fs.readFileSync(path.join(ROOT, 'public/js/alnaba.js'), 'utf8');
const mapFrontend = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'server/alnaba-page.html'), 'utf8');

const clients = {
  android: {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36',
  },
  androidDesktopSite: {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    userAgentData: { platform: 'Android', mobile: false },
  },
  desktop: {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    userAgentData: { platform: 'Linux', mobile: false },
  },
};

test('Telegram URL normalization accepts public bot, channel and invite links but rejects unsafe destinations', () => {
  assert.equal(normalizeTelegramPublicUrl('https://t.me/SARHNA11bot'), 'https://t.me/SARHNA11bot');
  assert.equal(normalizeTelegramPublicUrl('https://t.me/kshskdkd'), 'https://t.me/kshskdkd');
  assert.equal(normalizeTelegramPublicUrl('https://telegram.me/RasArchiveFixture/'), 'https://t.me/RasArchiveFixture');
  assert.equal(normalizeTelegramPublicUrl('https://t.me/+AbCdEfgh_123-'), 'https://t.me/+AbCdEfgh_123-');
  assert.equal(normalizeTelegramPublicUrl('https://t.me/joinchat/AbCdEfgh123456'), 'https://t.me/joinchat/AbCdEfgh123456');
  assert.equal(normalizeTelegramPublicUrl('https://t.me/not-a-real-telegram-host.example'), null);
  assert.equal(normalizeTelegramPublicUrl('https://t.me/SARHNA11bot?start=unexpected'), null);
});

test('public archive links stay HTTPS on Android, Android desktop-site mode and desktop', () => {
  for (const [device, client] of Object.entries(clients)) {
    assert.deepEqual(
      telegramArchiveOpenLink('https://t.me/SARHNA11bot', client),
      {
        href: 'https://t.me/SARHNA11bot',
        target: '_blank',
        rel: 'noopener noreferrer',
      },
      `${device} keeps the public web landing URL instead of forcing the app`,
    );
    assert.deepEqual(
      telegramArchiveOpenLink('https://t.me/kshskdkd', client),
      {
        href: 'https://t.me/kshskdkd',
        target: '_blank',
        rel: 'noopener noreferrer',
      },
    );
  }
  assert.equal(telegramArchiveOpenLink('https://evil.example/not-telegram', clients.android), null);
});

test('map and archive no longer rewrite Telegram links to app schemes', () => {
  assert.doesNotMatch(mapFrontend, /intent:\/\/|tg:\/\/|tgDeep\(/);
  assert.match(frontend, /telegramArchiveOpenLink\(item\.url\)/);
  assert.doesNotMatch(frontend, /navigator\.userAgent|intent:\/\/|tg:\/\//);
});

test('the archive has a fresh module URL and explains Telegram account limits', () => {
  assert.match(frontend, /shared\/telegram-links\.js\?v=2/);
  assert.match(frontend, /href="\$\{esc\(openLink\.href\)\}"\$\{target\}/);
  assert.match(page, /\/js\/alnaba\.js\?v=7/);
  assert.match(page, /دون تسجيل دخول للموقع/);
  assert.match(page, /قد يتطلب حساب Telegram/);
});
