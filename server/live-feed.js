// «المباشر» (Live) — website-only aggregation for the map page: a moving news
// ticker + a popup window with the news only (Syria first, then world, from
// major Arabic channels). Everything is fetched by the server itself, cached,
// and served from GET /api/live. Nothing here publishes to Telegram/WhatsApp,
// and a failing source degrades to an empty section — it never breaks the
// request path.
//
// Owner simplification (2026-11-17): the Markets and OSINT sections were
// removed from the Live window entirely — this module no longer fetches
// market quotes (Yahoo) or Telegram OSINT previews, and /api/live returns
// the news payload only.
//
// Sources were verified live from the server on 2026-11-17:
//  - RSS: Al Jazeera, BBC Arabic, Sky News Arabia, France 24 Arabic, Euronews
//    Arabic, RT Arabic. (Al Arabiya's feed answers 403 to this server.)
import { mentionsSyria } from './news-ai.js';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const NEWS_TTL_MS = 5 * 60_000;
const MAX_NEWS = { syria: 30, world: 40 };

export const NEWS_FEEDS = [
  { name: 'الجزيرة', url: 'https://www.aljazeera.net/rss' },
  { name: 'BBC عربي', url: 'https://feeds.bbci.co.uk/arabic/rss.xml' },
  { name: 'سكاي نيوز عربية', url: 'https://www.skynewsarabia.com/rss.xml' },
  { name: 'فرانس 24', url: 'https://www.france24.com/ar/rss' },
  { name: 'يورونيوز عربي', url: 'https://arabic.euronews.com/rss' },
  { name: 'RT عربي', url: 'https://arabic.rt.com/rss' },
];

// ------------------------------------------------------------ RSS parsing (dependency-free)
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', ndash: '–', mdash: '—', laquo: '«', raquo: '»' };
export const decodeEntities = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&([a-z0-9#]+);/gi, (m, k) => ENT[k] ?? m);
const cdata = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
export const cleanFeedText = (s) => decodeEntities(cdata(s)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tagText = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? cleanFeedText(m[1]) : '';
};

/** Parse an RSS/Atom document into [{ title, url, ts, desc }] (newest first as published). */
export function parseRssItems(xml, limit = 30) {
  const items = [];
  const blocks = String(xml || '').split(/<item[\s>]/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/item>/i)[0];
    const title = tagText(block, 'title');
    let url = tagText(block, 'link');
    if (!url) { const g = block.match(/<guid[^>]*>(https?[^<]+)<\/guid>/i); if (g) url = cleanFeedText(g[1]); }
    if (!title || !/^https?:\/\//.test(url)) continue;
    const ts = Date.parse(tagText(block, 'pubDate') || tagText(block, 'dc:date') || '');
    items.push({ title: title.slice(0, 300), url, ts: Number.isFinite(ts) ? ts : null, desc: tagText(block, 'description').slice(0, 300) });
    if (items.length >= limit) break;
  }
  return items;
}

/** Syria bucket: the HEADLINE mentions Syria or a Syrian place. Title-only on
 * purpose: feed descriptions routinely mention Syria in passing (related
 * coverage, place-name collisions), which flooded the Syria section with
 * world stories; a Syria story's headline names Syria or a Syrian place. */
export const isSyriaItem = (item) => mentionsSyria(item?.title || '');

// ------------------------------------------------------------ fetching + cache
const fetchText = async (url, timeoutMs = 12_000) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};

async function fetchNews() {
  const syria = [], world = [];
  const seen = new Set();
  const pages = await Promise.allSettled(NEWS_FEEDS.map(async (feed) => ({ feed, items: parseRssItems(await fetchText(feed.url)) })));
  for (const page of pages) {
    if (page.status !== 'fulfilled') continue;
    for (const item of page.value.items) {
      const key = item.url || item.title;
      if (seen.has(key)) continue;
      seen.add(key);
      (isSyriaItem(item) ? syria : world).push({ title: item.title, source: page.value.feed.name, ts: item.ts, url: item.url });
    }
  }
  const byTime = (a, b) => (b.ts || 0) - (a.ts || 0);
  return { syria: syria.sort(byTime).slice(0, MAX_NEWS.syria), world: world.sort(byTime).slice(0, MAX_NEWS.world) };
}

const cache = { news: null, newsAt: 0, busy: null };
async function refresh() {
  if (cache.busy) return cache.busy;
  cache.busy = (async () => {
    const news = await fetchNews().catch(() => null);
    if (news && (news.syria.length || news.world.length)) { cache.news = news; cache.newsAt = Date.now(); }
  })().catch(() => {}).finally(() => { cache.busy = null; });
  return cache.busy;
}

/** The /api/live payload: news only (owner simplification, 2026-11-17).
 * Serves the cache immediately; refreshes in the background when stale. Never throws. */
export async function getLiveFeed() {
  const stale = !cache.news || Date.now() - cache.newsAt > NEWS_TTL_MS;
  if (stale) {
    if (!cache.news) await refresh(); // first hit: wait once so the ticker isn't empty
    else refresh().catch(() => {});
  }
  return {
    news: cache.news || { syria: [], world: [] },
    server_time: new Date().toISOString(),
  };
}

let timer = null;
export function startLiveFeed() {
  if (timer) return;
  refresh().catch(() => {});
  timer = setInterval(() => { refresh().catch(() => {}); }, NEWS_TTL_MS);
  timer.unref?.();
}
export const _test = { parseRssItems, isSyriaItem, NEWS_FEEDS, cache };
