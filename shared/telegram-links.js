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

export function telegramArchiveOpenLink(value) {
  const webUrl = normalizeTelegramPublicUrl(value);
  if (!webUrl) return null;
  return { href: webUrl, target: '_blank', rel: 'noopener noreferrer' };
}
