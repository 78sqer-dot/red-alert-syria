import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isAndroidTelegramClient,
  normalizeTelegramPublicUrl,
  telegramAndroidIntentUrl,
  telegramArchiveOpenLink,
} from '../shared/telegram-links.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontend = fs.readFileSync(path.join(ROOT, 'public/js/alnaba.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'server/alnaba-page.html'), 'utf8');

const ANDROID_MOBILE = {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36',
};
const ANDROID_DESKTOP_SITE = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  userAgentData: { platform: 'Android', mobile: false },
};
const DESKTOP_BROWSER = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
  userAgentData: { platform: 'Linux', mobile: false },
};

test('Telegram URL normalization accepts the live bot and channel links without changing records', () => {
  assert.equal(normalizeTelegramPublicUrl('https://t.me/SARHNA11bot'), 'https://t.me/SARHNA11bot');
  assert.equal(normalizeTelegramPublicUrl('https://t.me/kshskdkd'), 'https://t.me/kshskdkd');
  assert.equal(normalizeTelegramPublicUrl('https://telegram.me/RasArchiveFixture/'), 'https://t.me/RasArchiveFixture');
  assert.equal(normalizeTelegramPublicUrl('https://t.me/not-a-real-telegram-host.example'), null);
});

test('Android Telegram intents carry a safe HTTPS fallback for bots, channels and invite links', () => {
  assert.equal(
    telegramAndroidIntentUrl('https://t.me/SARHNA11bot'),
    'intent://resolve?domain=SARHNA11bot#Intent;scheme=tg;S.browser_fallback_url=https%3A%2F%2Ft.me%2FSARHNA11bot;end',
  );
  assert.equal(
    telegramAndroidIntentUrl('https://t.me/+AbCdEfgh_123-'),
    'intent://join?invite=AbCdEfgh_123-#Intent;scheme=tg;S.browser_fallback_url=https%3A%2F%2Ft.me%2F%2BAbCdEfgh_123-;end',
  );
  assert.equal(telegramAndroidIntentUrl('https://evil.example/not-telegram'), null);
});

test('Android detection includes desktop-site mode while ordinary desktop browsers keep the web link', () => {
  assert.equal(isAndroidTelegramClient(ANDROID_MOBILE), true);
  assert.equal(isAndroidTelegramClient(ANDROID_DESKTOP_SITE), true);
  assert.equal(isAndroidTelegramClient(DESKTOP_BROWSER), false);

  const android = telegramArchiveOpenLink('https://t.me/kshskdkd', ANDROID_DESKTOP_SITE);
  assert.equal(android.target, null, 'Android opens in the current browsing context so the app intent can launch');
  assert.match(android.href, /^intent:\/\/resolve\?domain=kshskdkd#Intent;/);
  assert.match(android.href, /S\.browser_fallback_url=https%3A%2F%2Ft\.me%2Fkshskdkd/);

  const desktop = telegramArchiveOpenLink('https://t.me/SARHNA11bot', DESKTOP_BROWSER);
  assert.deepEqual(desktop, {
    href: 'https://t.me/SARHNA11bot',
    target: '_blank',
    rel: 'noopener noreferrer',
  });
});

test('the archive uses the shared opener and loads its cache-busted frontend module', () => {
  assert.match(frontend, /telegramArchiveOpenLink\(item\.url, navigator\)/);
  assert.match(frontend, /href="\$\{esc\(openLink\.href\)\}"\$\{target\}/);
  assert.match(page, /\/js\/alnaba\.js\?v=6/);
});
