const MAX_TEXT = 320;
export const LIVE_HEADLINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const LIVE_SOURCE_MAX_AGE_MS = 20 * 60 * 1000;
const cleanText = (value, max = MAX_TEXT) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
const firstText = (...values) => values.find((value) => typeof value === 'string' && value.trim()) || '';
const asList = (value) => Array.isArray(value) ? value.slice(0, 24) : [];

export function safeLiveSceneUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeFeedItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const title = cleanText(firstText(item.title, item.headline, item.text));
  if (!title) return null;
  return {
    title,
    source: cleanText(firstText(item.source, item.source_name, item.publisher), 120),
    url: safeLiveSceneUrl(item.url || item.link),
    publishedAt: cleanText(firstText(item.publishedAt, item.published_at, item.observedAt, item.observed_at, item.time, item.date), 64),
    current: item.current === true,
    region: item.region === 'syria' ? 'syria' : 'world',
  };
}

function normalizeMarketItem(item, locale) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const name = cleanText(firstText(locale === 'ar' ? item.nameAr : item.nameEn, item.name, item.title, item.label, item.symbol), 120);
  const value = cleanText(typeof item.value === 'number' ? String(item.value) : firstText(item.value, item.price, item.close), 64);
  if (!name || !value) return null;
  return {
    name,
    value,
    unit: cleanText(firstText(locale === 'ar' ? item.unitAr : item.unitEn, item.unit, item.currency), 48),
    change: cleanText(typeof item.change === 'number' ? String(item.change) : firstText(item.change, item.changePercent, item.change_percent), 64),
    source: cleanText(firstText(locale === 'ar' ? item.sourceAr : item.sourceEn, item.source, item.source_name), 120),
    url: safeLiveSceneUrl(item.url || item.link),
    observedAt: cleanText(firstText(item.observedAt, item.observed_at, item.updatedAt, item.updated_at, item.date), 64),
    stale: item.stale === true,
  };
}

export function normalizeLiveScenePayload(payload, locale = 'en') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { news: [], syriaNews: [], worldNews: [], osint: [], markets: [], updatedAt: '', degraded: false };
  }
  const news = asList(payload.news ?? payload.ticker).map(normalizeFeedItem).filter(Boolean);
  const sourceStatus = {};
  for (const key of ['bbc', 'gdelt', 'ecb', 'worldBank']) {
    const status = payload.sourceStatus?.[key];
    if (['ok', 'cached', 'unavailable'].includes(status)) sourceStatus[key] = status;
  }
  return {
    news,
    syriaNews: news.filter((item) => item.region === 'syria'),
    worldNews: news.filter((item) => item.region === 'world'),
    osint: asList(payload.osint ?? payload.signals).map(normalizeFeedItem).filter(Boolean),
    markets: asList(payload.markets ?? payload.market).map((item) => normalizeMarketItem(item, locale)).filter(Boolean),
    updatedAt: cleanText(firstText(payload.updatedAt, payload.updated_at), 64),
    degraded: payload.degraded === true,
    sourceStatus,
  };
}

/** Only return source-confirmed headlines with a valid link and fresh publication/source timestamps. */
export function selectCurrentLiveHeadlines(payload, now = Date.now()) {
  if (!payload || !Array.isArray(payload.news)) return [];
  if (!Object.values(payload.sourceStatus || {}).includes('ok')) return [];
  const sourceUpdatedAt = Date.parse(payload.updatedAt || '');
  if (!Number.isFinite(sourceUpdatedAt) || sourceUpdatedAt > now + 5 * 60_000 || now - sourceUpdatedAt > LIVE_SOURCE_MAX_AGE_MS) return [];
  const seen = new Set();
  return payload.news.filter((item) => {
    if (item.current !== true || !item.title?.trim() || !item.source?.trim() || !safeLiveSceneUrl(item.url)) return false;
    const publishedAt = Date.parse(item.publishedAt || '');
    if (!Number.isFinite(publishedAt) || publishedAt > now + 5 * 60_000 || now - publishedAt > LIVE_HEADLINE_MAX_AGE_MS) return false;
    const key = item.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 12);
}

export function formatLiveSceneTime(value, locale = 'en', timeZone = 'UTC') {
  if (typeof value !== 'string' || !value.trim()) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SY' : 'en', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return '';
  }
}
