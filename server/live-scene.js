const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_STALE_MS = DAY_MS;
const MAX_SOURCE_BYTES = 1_000_000;
const BBC_RSS_URL = 'https://feeds.bbci.co.uk/arabic/rss.xml';
const WORLD_BANK_URL = 'https://api.worldbank.org/v2/country/SYR/indicator/NY.GDP.MKTP.CD?format=json&per_page=10';
const ECB_DATA_URL = 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP+JPY.EUR.SP00.A?lastNObservations=1&format=csvdata';
const WORLD_BANK_PAGE = 'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD?locations=SY';
const ECB_PAGE = 'https://data.ecb.europa.eu/data/datasets/EXR';
const GDELT_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';
const HEADLINE_RELEVANCE = /(?:\bsyria\b|\bsyrian\b|سور(?:يا|ي|ية|يه)|دمشق|حلب|إدلب|ادلب|حمص|حماة|اللاذقية|طرطوس|درعا|السويداء|دير الزور|الحسكة|القنيطرة|الجولان|الرقة|عفرين|البوكمال)/iu;
const OSINT_RELEVANCE = /(?:قصف|غارة|غارات|مسيّرة|مسيرة|توغّل|توغل|اشتباك|هجوم|انفجار|إسرائيل|إسرائيلي|الحدود|داعش|مفاوض|روسيا|إيران|عقوبات|نفط|الجيش|احتجاج|قواعد|وساطة|مخيم|لاجئ|airstrike|strike|attack|drone|military|troops|sanction|oil|border|ceasefire)/iu;
const SOURCE_LABELS = new Map([
  ['bbc.co.uk', 'BBC News عربي'], ['bbc.com', 'BBC News عربي'],
  ['aljazeera.net', 'الجزيرة'], ['alarabiya.net', 'العربية'],
  ['enabbaladi.net', 'عنب بلدي'], ['sana.sy', 'سانا'],
  ['syriatv.net', 'تلفزيون سوريا'], ['orient-news.net', 'أورينت'],
]);

function cleanText(value, max = 320) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function safeHttpUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\\]/.test(value)) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function decodeXml(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
    const lower = code.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    if (lower === 'nbsp') return ' ';
    const number = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    return Number.isInteger(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : ' ';
  });
}

function xmlTagText(block, name) {
  const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, 'i'));
  if (!match) return '';
  const raw = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ');
  return cleanText(decodeXml(raw));
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : '';
}

function parseGdeltTimestamp(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) return parseTimestamp(value);
  return parseTimestamp(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
}

function publisherLabel(domain, url) {
  let host = cleanText(domain, 150).toLowerCase();
  if (!host && url) {
    try { host = new URL(url).hostname.toLowerCase(); } catch { /* ignored */ }
  }
  host = host.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  for (const [root, label] of SOURCE_LABELS) {
    if (host === root || host.endsWith(`.${root}`)) return label;
  }
  return cleanText(host, 120);
}

export function parseBbcRss(xml) {
  if (typeof xml !== 'string') return [];
  const items = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi)) {
    const block = match[1];
    const title = xmlTagText(block, 'title');
    const url = safeHttpUrl(xmlTagText(block, 'link'));
    if (!title || !url) continue;
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch { continue; }
    if (!(host === 'bbc.co.uk' || host.endsWith('.bbc.co.uk') || host === 'bbc.com' || host.endsWith('.bbc.com'))) continue;
    items.push({ title, source: 'BBC News عربي', url, publishedAt: parseTimestamp(xmlTagText(block, 'pubDate')) });
    if (items.length >= 30) break;
  }
  return items;
}

export function parseGdeltResponse(value) {
  let payload = value;
  if (typeof value === 'string') {
    try { payload = JSON.parse(value); } catch { return []; }
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.articles)) return [];
  const items = [];
  const seen = new Set();
  for (const article of payload.articles.slice(0, 100)) {
    if (!article || typeof article !== 'object' || String(article.language || '').toLowerCase() !== 'arabic') continue;
    const title = cleanText(article.title);
    const url = safeHttpUrl(article.url);
    if (!title || !url || !HEADLINE_RELEVANCE.test(title)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const source = publisherLabel(article.domain, url);
    if (!source) continue;
    items.push({ title, source, url, publishedAt: parseGdeltTimestamp(article.seendate) });
    if (items.length >= 30) break;
  }
  return items;
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else value += character;
  }
  values.push(value);
  return values;
}

function significantNumber(value) {
  return String(Number(value.toPrecision(6)));
}

export function parseEcbCsv(csv, now = Date.now()) {
  if (typeof csv !== 'string') return [];
  const rows = csv.split(/\r?\n/).filter((line) => line.trim()).map(parseCsvLine);
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => value.trim());
  const index = Object.fromEntries(headers.map((key, position) => [key, position]));
  const get = (row, key) => index[key] === undefined ? '' : String(row[index[key]] ?? '').trim();
  const currencies = {
    USD: { nameAr: 'دولار أمريكي لكل يورو · مرجعي', nameEn: 'USD per EUR · reference' },
    GBP: { nameAr: 'جنيه إسترليني لكل يورو · مرجعي', nameEn: 'GBP per EUR · reference' },
    JPY: { nameAr: 'ين ياباني لكل يورو · مرجعي', nameEn: 'JPY per EUR · reference' },
  };
  const result = [];
  for (const [currency, labels] of Object.entries(currencies)) {
    const observations = rows.slice(1).map((row) => ({
      currency: get(row, 'CURRENCY'), denominator: get(row, 'CURRENCY_DENOM'),
      date: get(row, 'TIME_PERIOD'), value: Number(get(row, 'OBS_VALUE')),
    })).filter((item) => item.currency === currency && item.denominator === 'EUR' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(item.value) && item.value > 0)
      .sort((a, b) => b.date.localeCompare(a.date));
    const observation = observations[0];
    if (!observation) continue;
    const observationEnd = Date.parse(`${observation.date}T23:59:59Z`);
    result.push({
      ...labels,
      name: labels.nameEn,
      value: significantNumber(observation.value),
      unit: '', unitAr: '', unitEn: '',
      source: 'ECB', sourceAr: 'البنك المركزي الأوروبي (ECB)', sourceEn: 'ECB',
      url: ECB_PAGE, observedAt: observation.date,
      stale: Number.isFinite(observationEnd) && Number(now) - observationEnd > 7 * DAY_MS,
    });
  }
  return result;
}

export function parseWorldBankResponse(payload) {
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) return [];
  const observation = payload[1].filter((item) => item && /^\d{4}$/.test(String(item.date || '')) && item.value !== null && item.value !== undefined && Number.isFinite(Number(item.value)))
    .sort((a, b) => Number(b.date) - Number(a.date))[0];
  if (!observation) return [];
  const billions = Number((Number(observation.value) / 1_000_000_000).toFixed(1));
  if (!Number.isFinite(billions)) return [];
  return [{
    name: 'Syria GDP (annual, current US$)',
    nameAr: 'الناتج المحلي لسوريا (سنوي، دولار حالي)',
    nameEn: 'Syria GDP (annual, current US$)',
    value: billions.toFixed(1), unit: 'B USD', unitAr: 'مليار دولار', unitEn: 'B USD',
    source: 'World Bank · WDI', sourceAr: 'البنك الدولي · WDI', sourceEn: 'World Bank · WDI',
    url: WORLD_BANK_PAGE, observedAt: String(observation.date), stale: true,
  }];
}

function uniqueByUrl(items) {
  const byUrl = new Map();
  for (const item of items) {
    const key = (item.url || item.title).toLowerCase();
    const previous = byUrl.get(key);
    const itemTime = Date.parse(item.publishedAt) || 0;
    const previousTime = Date.parse(previous?.publishedAt) || 0;
    if (!previous || (item.current === true && previous.current !== true)
      || (item.current === previous.current && itemTime > previousTime)) byUrl.set(key, item);
  }
  return [...byUrl.values()].sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)).slice(0, 30);
}

function makePayload(sections, updatedAt, sourceStatus) {
  const news = uniqueByUrl([
    ...sections.bbc.map((item) => ({ ...item, current: sourceStatus.bbc === 'ok' })),
    ...sections.gdelt.map((item) => ({ ...item, current: sourceStatus.gdelt === 'ok' })),
  ].map((item) => ({
    ...item,
    region: HEADLINE_RELEVANCE.test(item.title) ? 'syria' : 'world',
  })));
  const osint = sections.gdelt.filter((item) => OSINT_RELEVANCE.test(item.title)).slice(0, 24);
  const markets = [...sections.ecb, ...sections.worldBank].slice(0, 12);
  return { updatedAt, news, osint, markets, degraded: Object.values(sourceStatus).some((status) => status !== 'ok'), sourceStatus };
}

async function readBoundedText(response) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error('upstream response too large');
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_SOURCE_BYTES) throw new Error('upstream response too large');
    return text;
  }
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      byteLength += chunk.length;
      if (byteLength > MAX_SOURCE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error('upstream response too large');
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, byteLength).toString('utf8');
}

export function createLiveSceneService({ fetchImpl = globalThis.fetch, now = () => Date.now(), cacheTtlMs = DEFAULT_CACHE_TTL_MS, maxStaleMs = DEFAULT_MAX_STALE_MS, timeoutMs = 8_000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  let cache = null;
  let sourceCache = {};
  let inFlight = null;

  const requestText = async (url, accept) => {
    const response = await fetchImpl(url, {
      headers: { Accept: accept, 'User-Agent': 'RedAlertSyria-LiveScene/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response?.ok) throw new Error(`upstream status ${response?.status || 0}`);
    return readBoundedText(response);
  };

  const requests = () => {
    const gdeltUrl = new URL(GDELT_ENDPOINT);
    gdeltUrl.search = new URLSearchParams({
      query: 'Syria sourcelang:arabic', mode: 'artlist', maxrecords: '50', timespan: '1d', sort: 'datedesc', format: 'json',
    }).toString();
    return [
      async () => {
        const xml = await requestText(BBC_RSS_URL, 'application/rss+xml, application/xml, text/xml');
        if (!/<rss\b/i.test(xml)) throw new Error('invalid BBC RSS response');
        return parseBbcRss(xml);
      },
      async () => {
        const text = await requestText(gdeltUrl.href, 'application/json');
        let body;
        try { body = JSON.parse(text); } catch { throw new Error('invalid GDELT JSON'); }
        if (!body || !Array.isArray(body.articles)) throw new Error('invalid GDELT article list');
        return parseGdeltResponse(body);
      },
      async () => {
        const csv = await requestText(ECB_DATA_URL, 'text/csv');
        const header = parseCsvLine(csv.split(/\r?\n/, 1)[0] || '');
        if (!header.includes('TIME_PERIOD') || !header.includes('OBS_VALUE')) throw new Error('invalid ECB CSV');
        return parseEcbCsv(csv, now());
      },
      async () => {
        const text = await requestText(WORLD_BANK_URL, 'application/json');
        let body;
        try { body = JSON.parse(text); } catch { throw new Error('invalid World Bank response'); }
        if (!Array.isArray(body) || !Array.isArray(body[1])) throw new Error('invalid World Bank data');
        return parseWorldBankResponse(body);
      },
    ];
  };

  async function refresh() {
    const timestamp = Number(now());
    const results = await Promise.allSettled(requests().map((request) => request()));
    const keys = ['bbc', 'gdelt', 'ecb', 'worldBank'];
    const sections = {};
    const sourceStatus = {};
    const nextSourceCache = { ...sourceCache };
    results.forEach((result, index) => {
      const key = keys[index];
      if (result.status === 'fulfilled') {
        sections[key] = result.value;
        sourceStatus[key] = 'ok';
        nextSourceCache[key] = { value: result.value, fetchedAt: timestamp };
      } else {
        const prior = sourceCache[key];
        if (prior && timestamp - prior.fetchedAt <= maxStaleMs) {
          sections[key] = prior.value;
          sourceStatus[key] = 'cached';
        } else {
          sections[key] = [];
          sourceStatus[key] = 'unavailable';
          delete nextSourceCache[key];
        }
      }
    });
    const successCount = results.filter((result) => result.status === 'fulfilled').length;
    sourceCache = nextSourceCache;
    const availableCount = keys.filter((key) => sourceStatus[key] !== 'unavailable').length;
    if (!availableCount) throw new Error('live scene sources unavailable');
    const newestSourceAt = Math.max(...keys.map((key) => sourceCache[key]?.fetchedAt || 0));
    const updatedAt = successCount ? new Date(timestamp).toISOString() : new Date(newestSourceAt).toISOString();
    const payload = makePayload(sections, updatedAt, sourceStatus);
    const cachedSourceExpiries = keys
      .filter((key) => sourceStatus[key] === 'cached')
      .map((key) => sourceCache[key].fetchedAt + maxStaleMs);
    const validUntil = Math.min(timestamp + cacheTtlMs, ...cachedSourceExpiries);
    cache = { payload, validUntil };
    return JSON.parse(JSON.stringify(payload));
  }

  return {
    async getLiveScene() {
      const timestamp = Number(now());
      if (cache && timestamp < cache.validUntil) return JSON.parse(JSON.stringify(cache.payload));
      if (!inFlight) {
        inFlight = refresh().finally(() => { inFlight = null; });
      }
      return inFlight;
    },
  };
}
