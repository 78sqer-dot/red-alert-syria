const TELEGRAM_HOSTS = new Set(['t.me', 'telegram.me']);
const USERNAME_PATH = /^\/([A-Za-z][A-Za-z0-9_]{4,31})$/;
const PLUS_INVITE_PATH = /^\/\+([A-Za-z0-9_-]{8,128})$/;
const JOINCHAT_PATH = /^\/joinchat\/([A-Za-z0-9_-]{8,128})$/;

export function normalizeTelegramPublicUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 512 || /\s|[\u0000-\u001f\u007f]/u.test(raw)) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || !TELEGRAM_HOSTS.has(url.hostname.toLowerCase())
    || url.username || url.password || url.port || url.search || url.hash) return null;

  const pathname = url.pathname.replace(/\/+$/, '');
  if (USERNAME_PATH.test(pathname) || PLUS_INVITE_PATH.test(pathname) || JOINCHAT_PATH.test(pathname)) {
    return `https://t.me${pathname}`;
  }
  return null;
}

export function telegramAndroidIntentUrl(value) {
  const webUrl = normalizeTelegramPublicUrl(value);
  if (!webUrl) return null;

  const pathname = new URL(webUrl).pathname;
  const username = pathname.match(USERNAME_PATH);
  const plusInvite = pathname.match(PLUS_INVITE_PATH);
  const joinchatInvite = pathname.match(JOINCHAT_PATH);
  const telegramRoute = username
    ? `resolve?domain=${encodeURIComponent(username[1])}`
    : `join?invite=${encodeURIComponent(plusInvite?.[1] || joinchatInvite?.[1] || '')}`;

  return `intent://${telegramRoute}#Intent;scheme=tg;S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
}

export function isAndroidTelegramClient(client = globalThis.navigator) {
  if (!client) return false;
  const platform = [client.userAgentData?.platform, client.platform, client.userAgent].filter(Boolean).join(' ');
  return /\bAndroid\b/i.test(platform);
}

export function telegramArchiveOpenLink(value, client = globalThis.navigator) {
  const webUrl = normalizeTelegramPublicUrl(value);
  if (!webUrl) return null;
  if (isAndroidTelegramClient(client)) {
    const appUrl = telegramAndroidIntentUrl(webUrl);
    if (!appUrl) return null;
    return { href: appUrl, target: null, rel: 'noopener noreferrer' };
  }
  return { href: webUrl, target: '_blank', rel: 'noopener noreferrer' };
}
