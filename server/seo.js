// Search & sharing: server-rendered, indexable pages around the live map.
//   /ar/area/<slug>/  /en/area/<slug>/   "شو صاير بدرعا هلق؟" — recent alerts of one governorate / city
//   /ar/areas/        /en/areas/         hub linking every area page
//   /ar/a/<id>        /en/a/<id>         share link of one alert: link-preview bots get Open Graph tags
//                                        with the alert's map card, people are redirected to the map
//   /og/area/<slug>-<lang>.png, /og/a/<id>-<lang>.png, /og/site-<lang>.png   preview images (cached)
//   /sitemap.xml, /robots.txt, optional Google/Bing verification (env GOOGLE_SITE_VERIFICATION, ...)
// All times in Damascus time.
import { store } from './store.js';
import { config } from './config.js';
import { governorates, places, getGov, getDist } from './places.js';
import { ALERT_TYPES } from '../shared/types.js';
import { svgToPng, renderAlertPng, channelBadge, badgeWidth, logoAt } from './alert-image.js';

const TZ = 'Asia/Damascus';
const SITE = () => (config.publicUrl || process.env.PUBLIC_URL || 'https://red-alert-syria-q6k8.onrender.com').replace(/\/+$/, '');
const CHANNEL_URL = 'https://t.me/Red_Alert_Syria';
const REPORT_URL = 'https://t.me/Rad_Alert_Syria1_bot?start=report';
const WA_CHANNEL_URL = 'https://whatsapp.com/channel/0029VbEO1eGCBtxLP3jW8e1k';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arDigits = (s) => String(s).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
const num = (n, lang) => (lang === 'ar' ? arDigits(n) : String(n));

// ------------------------------------------------------------------ areas
const GOV_SLUG = {
  'Damascus': 'damascus', 'Rif Dimashq': 'rif-dimashq', 'Rural Damascus': 'rif-dimashq', "Dar'a": 'daraa', 'Daraa': 'daraa',
  'As-Suwayda': 'suwayda', 'Al Qunaytirah': 'quneitra', 'Quneitra': 'quneitra', 'Homs': 'homs', 'Hamah': 'hama', 'Hama': 'hama',
  'Aleppo': 'aleppo', 'Idlib': 'idlib', 'Latakia': 'latakia', 'Tartus': 'tartus', 'Ar Raqqah': 'raqqa', 'Ar-Raqqah': 'raqqa', 'Deir ez-Zor': 'deir-ez-zor', 'Al Hasakah': 'hasakah', 'Al-Hasakah': 'hasakah',
};
const EN_NICE = { 'Ar-Raqqah': 'Raqqa', 'Al-Hasakah': 'Hasakah', 'Hamah': 'Hama', "Dar'a": 'Daraa', 'Al Qunaytirah': 'Quneitra', 'Ar Raqqah': 'Raqqa', 'Al Hasakah': 'Hasakah', 'As-Suwayda': 'Suwayda' };
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/['’`ʿʾ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  .replace(/^(al|ar|as|at|az|ad|an|ash|el)-(?=[a-z]{3})/, ''); // al-qamishli -> qamishli
const cleanAr = (s) => String(s || '').replace(/\s*\(.*?\)\s*/g, ' ').trim(); // "السيدة زينب (قبر الست)" -> "السيدة زينب"

export const AREAS = [];
const BY_SLUG = new Map();
function buildAreas() {
  for (const g of governorates) {
    const slug = GOV_SLUG[g.en] || slugify(g.en);
    const a = { kind: 'gov', slug, code: g.code, gov: g.code, ar: g.ar, en: EN_NICE[g.en] || g.en, lat: g.lat, lon: g.lon, zoom: 9 };
    AREAS.push(a); BY_SLUG.set(slug, a);
  }
  // main towns: rank-2 places (district centres) that are not also a governorate centre
  const govNames = new Set(governorates.map((g) => g.ar));
  // one town per district: prefer the place named like its district (الطبقة, not الثورة)
  const perDist = new Map();
  for (const p of places.filter((x) => x.rank === 2 && !govNames.has(x.ar))) {
    const cur = perDist.get(p.dist);
    const named = (q) => q.ar === getDist(q.dist)?.ar;
    if (!cur || (named(p) && !named(cur))) perDist.set(p.dist, p);
  }
  for (const p of [...perDist.values()].sort((a, b) => a.gov.localeCompare(b.gov) || a.ar.localeCompare(b.ar, 'ar'))) {
    let slug = slugify(p.en) || `place-${p.id}`;
    if (BY_SLUG.has(slug)) slug = `${slug}-${BY_SLUG.get(GOV_SLUG[getGov(p.gov)?.en])?.slug || p.gov}`;
    if (BY_SLUG.has(slug)) slug = `${slug}-${p.id}`;
    const a = { kind: 'city', slug, placeId: p.id, dist: p.dist, gov: p.gov, ar: cleanAr(p.ar), en: EN_NICE[p.en] || p.en, lat: p.lat, lon: p.lon, zoom: 11 };
    AREAS.push(a); BY_SLUG.set(slug, a);
  }
}
buildAreas();
const govArea = (code) => AREAS.find((a) => a.kind === 'gov' && a.code === code);
const citiesOf = (code) => AREAS.filter((a) => a.kind === 'city' && a.gov === code);

/** the area's events from the statistics log (newest first) */
function matches(area, e) {
  if (area.kind === 'gov') return e.g === area.code || (e.xg || []).includes(area.code);
  return e.p === area.placeId || e.d === area.dist || (e.xd || []).includes(area.dist);
}
function areaEvents(area, days = 30) {
  const since = Date.now() - days * 86400_000;
  const out = [];
  const log = store.state.log || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    const t = Date.parse(e.ts);
    if (!(t >= since)) { if (t < since) break; continue; }
    if (matches(area, e)) out.push(e);
  }
  return out;
}
const typeLabel = (k, lang) => { const t = ALERT_TYPES[k]; return t ? (lang === 'en' ? t.en : t.ar) : k; };
const typeColor = (k) => ALERT_TYPES[k]?.color || '#ff3b4e';
const areaName = (a, lang) => (lang === 'en' ? a.en : a.ar);
const withBi = (name) => `ب${name}`; // بدرعا، بالحسكة

function fmtWhen(ms, lang) {
  const d = new Date(ms);
  const day = (x) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(x);
  const today = day(new Date()); const yest = day(new Date(Date.now() - 86400_000)); const k = day(d);
  const time = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-SY', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: lang !== 'en' }).format(d);
  const date = k === today ? (lang === 'en' ? 'Today' : 'اليوم') : k === yest ? (lang === 'en' ? 'Yesterday' : 'أمس')
    : new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-SY', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'long' }).format(d);
  return lang === "en" ? `${date} · ${time}` : `${date}، ${time}`;
}

function summary(area) {
  const ev = areaEvents(area, 30);
  const now = Date.now();
  const d1 = ev.filter((e) => now - Date.parse(e.ts) < 86400_000).length;
  const d7list = ev.filter((e) => now - Date.parse(e.ts) < 7 * 86400_000);
  const byType = {};
  for (const e of d7list) byType[e.ty] = (byType[e.ty] || 0) + 1;
  const active = store.activeAlerts().filter((a) => matches(area, store._logEntry(a)));
  return { ev, d1, d7: d7list.length, d30: ev.length, byType, active, last: ev[0] ? Date.parse(ev[0].ts) : null };
}

// ------------------------------------------------------------------ html shell
const verifyMeta = () => [
  process.env.GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${esc(process.env.GOOGLE_SITE_VERIFICATION)}">` : '',
  process.env.BING_SITE_VERIFICATION ? `<meta name="msvalidate.01" content="${esc(process.env.BING_SITE_VERIFICATION)}">` : '',
  process.env.YANDEX_VERIFICATION ? `<meta name="yandex-verification" content="${esc(process.env.YANDEX_VERIFICATION)}">` : '',
].join('');
export const verifyMetaTags = verifyMeta;

const CSS = `@font-face{font-family:Kufi;src:url(/fonts/noto-kufi-arabic-arabic-400-normal.woff2) format('woff2');font-weight:400;font-display:swap;unicode-range:U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFF}
@font-face{font-family:Kufi;src:url(/fonts/noto-kufi-arabic-arabic-700-normal.woff2) format('woff2');font-weight:700;font-display:swap;unicode-range:U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFF}
@font-face{font-family:Kufi;src:url(/fonts/noto-kufi-arabic-latin-400-normal.woff2) format('woff2');font-weight:400;font-display:swap}
@font-face{font-family:Kufi;src:url(/fonts/noto-kufi-arabic-latin-700-normal.woff2) format('woff2');font-weight:700;font-display:swap}
:root{--bg:#f6f7fb;--card:#fff;--fg:#0f172a;--mut:#64748b;--bd:#e2e8f0;--red:#ff3b4e;--navy:#0f1729}
@media(prefers-color-scheme:dark){:root{--bg:#0b0f17;--card:#141a26;--fg:#e5e7eb;--mut:#94a3b8;--bd:#253041}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 Kufi,system-ui,sans-serif}
a{color:inherit}.top{background:var(--navy);color:#fff;border-bottom:4px solid var(--red)}
.top .in{max-width:880px;margin:auto;padding:12px 16px;display:flex;align-items:center;gap:12px}
.top img{height:38px;width:auto}.top .sp{flex:1}.top a.l{font-size:13px;opacity:.85;text-decoration:none;border:1px solid #334155;padding:4px 10px;border-radius:999px}
main{max-width:880px;margin:auto;padding:18px 16px 40px}
.crumbs{font-size:12.5px;color:var(--mut);margin-bottom:6px}.crumbs a{text-decoration:none}
h1{font-size:clamp(22px,5vw,32px);line-height:1.35;margin:4px 0 6px}
.lead{color:var(--mut);margin:0 0 16px}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0 18px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:12px;font-weight:700;text-decoration:none;border:1px solid var(--bd);background:var(--card)}
.btn.red{background:var(--red);border-color:var(--red);color:#fff}.btn.tg{background:#229ed9;border-color:#229ed9;color:#fff}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:8px 0 18px}
.st{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:12px;text-align:center}
.st b{display:block;font-size:26px;line-height:1.2}.st span{font-size:12.5px;color:var(--mut)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 18px}.chip{font-size:12.5px;padding:3px 10px;border-radius:999px;border:1px solid var(--bd);background:var(--card)}
.chip i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-inline-end:6px;vertical-align:middle}
h2{font-size:18px;margin:22px 0 10px}
.list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.ev{background:var(--card);border:1px solid var(--bd);border-inline-start:5px solid var(--c);border-radius:12px;padding:10px 12px;display:flex;gap:10px;align-items:center}
.ev .t{font-weight:700}.ev .p{color:var(--mut);font-size:13px}.ev .w{margin-inline-start:auto;font-size:12.5px;color:var(--mut);white-space:nowrap;text-align:end}
.ev .w a{color:#229ed9;text-decoration:none}.live{color:#fff;background:var(--red);border-radius:6px;padding:0 6px;font-size:11.5px;margin-inline-start:6px}
.empty{background:var(--card);border:1px dashed var(--bd);border-radius:12px;padding:16px;color:var(--mut)}
.share{display:flex;flex-wrap:wrap;gap:8px}.share a{font-size:13.5px;padding:8px 14px;border-radius:10px;text-decoration:none;color:#fff;font-weight:700}
.wa{background:#25d366}.tgs{background:#229ed9}.fb{background:#1877f2}
.areas{display:flex;flex-wrap:wrap;gap:8px}.areas a{font-size:13.5px;padding:6px 12px;border-radius:999px;border:1px solid var(--bd);background:var(--card);text-decoration:none}
.areas a.cur{border-color:var(--red);color:var(--red);font-weight:700}
.hub h3{margin:16px 0 8px;font-size:16px}.faq p{margin:0 0 10px;color:var(--mut)}.faq b{color:var(--fg)}
footer{max-width:880px;margin:auto;padding:16px;color:var(--mut);font-size:12.5px;border-top:1px solid var(--bd)}
.govs{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin:0 0 20px}
.gov{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:14px}
.gov h3{margin:0 0 4px;font-size:17px}.gov .n{color:var(--mut);font-size:13px;margin:0 0 10px}
.gov .row{display:flex;gap:8px;flex-wrap:wrap}.gov .row a{font-size:13px;padding:6px 12px;border-radius:10px;text-decoration:none;border:1px solid var(--bd);font-weight:700}
.gov .row a.m{background:var(--red);border-color:var(--red);color:#fff}
.facts{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--bd);border-radius:14px;overflow:hidden;margin:0 0 18px}
.facts th,.facts td{padding:10px 12px;border-bottom:1px solid var(--bd);text-align:start;font-size:14px;vertical-align:top}
.facts tr:last-child th,.facts tr:last-child td{border-bottom:0}.facts th{width:34%;color:var(--mut)}
.term{background:var(--card);border:1px solid var(--bd);border-inline-start:5px solid var(--c);border-radius:12px;padding:10px 12px;margin:0 0 8px}
.term b{font-size:15px}.term p{margin:2px 0 0;color:var(--mut);font-size:13.5px}`;

function shell({ lang, title, desc, path, alt, ogImage, ogW = 1200, ogH = 630, jsonld = [], body, robots = 'index,follow,max-image-preview:large' }) {
  const site = SITE();
  const other = lang === 'ar' ? 'en' : 'ar';
  const url = site + path;
  return `<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${robots}">
<meta name="theme-color" content="#ff3b4e">
<link rel="canonical" href="${esc(url)}">
${alt ? `<link rel="alternate" hreflang="${lang}" href="${esc(url)}"><link rel="alternate" hreflang="${other}" href="${esc(site + alt)}"><link rel="alternate" hreflang="x-default" href="${esc(site + (lang === 'ar' ? path : alt))}">` : ''}
<meta property="og:type" content="website"><meta property="og:site_name" content="Red Alert Syria">
<meta property="og:locale" content="${lang === 'ar' ? 'ar_SY' : 'en_US'}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="${ogW}"><meta property="og:image:height" content="${ogH}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(ogImage)}">
<link rel="icon" type="image/svg+xml" href="/img/icon.svg"><link rel="apple-touch-icon" href="/img/icon-180.png">
${verifyMeta()}
<style>${CSS}</style>
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body>
<header class="top"><div class="in"><a href="/${lang}/" aria-label="Red Alert Syria"><img src="/img/logo-wordmark.svg" alt="Red Alert Syria" width="96" height="38"></a><span class="sp"></span>
<a class="l" href="${esc(alt || `/${other}/`)}" hreflang="${other}">${lang === 'ar' ? 'English' : 'العربية'}</a></div></header>
<main>${body}</main>
<footer>${lang === 'ar'
    ? `الإنذار الأحمر سوريا — خريطة مباشرة مجانية للتنبيهات في سوريا. الأوقات بتوقيت دمشق. تابعنا على <a href="${CHANNEL_URL}">تيليغرام @Red_Alert_Syria</a> · <a href="/ar/areas/">كل المناطق</a> · <a href="/ar/about/">عن المشروع</a> · <a href="/ar/glossary/">المصطلحات</a> · <a href="/ar/press/">للصحفيين</a> · <a href="/ar/">الخريطة المباشرة</a>`
    : `Red Alert Syria — free live map of alerts across Syria. Times are Damascus time. Follow on <a href="${CHANNEL_URL}">Telegram @Red_Alert_Syria</a> · <a href="/en/areas/">All areas</a> · <a href="/en/about/">About</a> · <a href="/en/glossary/">Glossary</a> · <a href="/en/press/">For journalists</a> · <a href="/en/">Live map</a>`}</footer>
</body></html>`;
}

const shareLinks = (url, text, lang) => `<div class="share">
<a class="wa" href="https://wa.me/?text=${encodeURIComponent(text + '\n' + url)}" target="_blank" rel="noopener">${lang === 'ar' ? 'واتساب' : 'WhatsApp'}</a>
<a class="tgs" href="https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${lang === 'ar' ? 'تيليغرام' : 'Telegram'}</a>
<a class="fb" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener">${lang === 'ar' ? 'فيسبوك' : 'Facebook'}</a></div>`;

const ORG = () => ({ '@type': 'Organization', '@id': `${SITE()}/#org`, name: 'Red Alert Syria', alternateName: 'الإنذار الأحمر سوريا', url: `${SITE()}/`, logo: `${SITE()}/img/icon-512.png`, sameAs: [CHANNEL_URL] });

/** JSON-LD for the map's home pages (index.html) */
export function homeJsonLd(lang) {
  const site = SITE();
  return [{
    '@context': 'https://schema.org',
    '@graph': [
      ORG(),
      { '@type': 'WebSite', '@id': `${site}/#site`, url: `${site}/${lang}/`, name: lang === 'ar' ? 'الإنذار الأحمر سوريا' : 'Red Alert Syria', alternateName: lang === 'ar' ? 'Red Alert Syria' : 'الإنذار الأحمر سوريا', inLanguage: lang, publisher: { '@id': `${site}/#org` } },
      { '@type': 'WebApplication', name: 'Red Alert Syria', url: `${site}/${lang}/`, applicationCategory: 'NewsApplication', operatingSystem: 'Any', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, inLanguage: lang },
    ],
  }];
}

// ------------------------------------------------------------------ area page
function areaPage(area, lang) {
  const site = SITE();
  const en = lang === 'en';
  const name = areaName(area, lang);
  const gov = area.kind === 'city' ? govArea(area.gov) : area;
  const govName = gov ? areaName(gov, lang) : '';
  const s = summary(area);
  const path = `/${lang}/area/${area.slug}/`;
  const alt = `/${en ? 'ar' : 'en'}/area/${area.slug}/`;
  const title = en
    ? `Live alerts in ${name}${area.kind === 'city' ? `, ${govName}` : ''}, Syria — what's happening now | Red Alert Syria`
    : `شو صاير ${withBi(name)} هلق؟ أخبار وتنبيهات ${name} العاجلة لحظة بلحظة | الإنذار الأحمر سوريا`;
  const desc = en
    ? `What is happening in ${name}${area.kind === 'city' ? ` (${govName})` : ''} right now: live alerts for drones, warplanes, shelling, missiles, attacks, accidents and fires on a free real-time map of Syria. ${s.d1} alerts in the last 24 hours.`
    : `شو عم يصير ${withBi(name)}${area.kind === 'city' ? ` (${govName})` : ''} هلق؟ تنبيهات عاجلة مباشرة: مسيّرات، طيران حربي، قصف، صواريخ، هجمات، حوادث وحرائق على خريطة سوريا المباشرة المجانية. ${arDigits(s.d1)} تنبيه آخر ٢٤ ساعة.`;
  const mapHref = `/${lang}/?at=${area.lat.toFixed(4)},${area.lon.toFixed(4)},${area.zoom}`;
  const shareText = en ? `🚨 Live alerts in ${name}, Syria — Red Alert Syria` : `🚨 شو صاير ${withBi(name)} هلق؟ تنبيهات ${name} المباشرة على خريطة الإنذار الأحمر سوريا`;
  const activeIds = new Set(s.active.map((a) => a.id));
  const items = s.ev.slice(0, 25).map((e) => {
    const place = en ? (e.pe || e.pa || e.ge || '') : (e.pa || e.ga || '');
    const placeLine = [place, area.kind === 'city' || !e.ga ? '' : (en ? e.ge : e.ga)].filter((x, i, arr) => x && arr.indexOf(x) === i).join(en ? ', ' : '، ');
    const tg = e.m ? `<a href="${CHANNEL_URL}/${e.m}" target="_blank" rel="noopener">${en ? 'Telegram post' : 'منشور القناة'}</a>` : '';
    const live = activeIds.has(e.id) ? `<a class="live" href="/${lang}/#${esc(e.id)}">${en ? 'LIVE' : 'نشط الآن'}</a>` : '';
    return `<li class="ev" style="--c:${typeColor(e.ty)}"><div><div class="t">${esc(typeLabel(e.ty, lang))}${live}</div>${placeLine ? `<div class="p">📍 ${esc(placeLine)}</div>` : ''}</div><div class="w">${esc(fmtWhen(Date.parse(e.ts), lang))}${tg ? `<br>${tg}` : ''}</div></li>`;
  }).join('');
  const chips = Object.entries(s.byType).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="chip"><i style="background:${typeColor(k)}"></i>${esc(typeLabel(k, lang))}: ${num(n, lang)}</span>`).join('');
  const siblings = area.kind === 'gov' ? citiesOf(area.code) : citiesOf(area.gov).filter((c) => c.slug !== area.slug);
  const govLinks = AREAS.filter((a) => a.kind === 'gov').map((g) => `<a href="/${lang}/area/${g.slug}/"${g.slug === (gov?.slug) ? ' class="cur"' : ''}>${esc(areaName(g, lang))}</a>`).join('');
  const crumbs = [[en ? 'Live map' : 'الخريطة المباشرة', `/${lang}/`], [en ? 'Areas' : 'المناطق', `/${lang}/areas/`], ...(area.kind === 'city' && gov ? [[govName, `/${lang}/area/${gov.slug}/`]] : []), [name, path]];
  const body = `
<nav class="crumbs">${crumbs.map(([t, h], i) => (i < crumbs.length - 1 ? `<a href="${h}">${esc(t)}</a> › ` : esc(t))).join('')}</nav>
<h1>${en ? `What's happening in ${esc(name)} right now?` : `شو صاير ${esc(withBi(name))} هلق؟`}</h1>
<p class="lead">${en
    ? `Live alerts and breaking events in ${esc(name)}${area.kind === 'city' ? `, ${esc(govName)} governorate` : ''}, Syria — drones, warplanes, shelling, missiles, attacks, road accidents and fires, as they are reported. Updated around the clock.`
    : `آخر التنبيهات والأخبار العاجلة ${esc(withBi(name))}${area.kind === 'city' ? ` بمحافظة ${esc(govName)}` : ''} لحظة بلحظة: تحليق مسيّرات، طيران حربي، قصف مدفعي، صواريخ، هجمات، حوادث سير وحرائق. الصفحة بتتحدّث على مدار الساعة.`}</p>
<div class="cta"><a class="btn red" href="${mapHref}">${en ? `Open the live map on ${esc(name)}` : `افتح الخريطة المباشرة على ${esc(name)}`}</a>
<a class="btn tg" href="${CHANNEL_URL}" target="_blank" rel="noopener">${en ? 'Instant alerts on Telegram' : 'تنبيهات فورية على تيليغرام'}</a>
<a class="btn" href="${REPORT_URL}" target="_blank" rel="noopener">${en ? 'Report an event' : 'بلّغ عن حدث'}</a></div>
<div class="stats"><div class="st"><b>${num(s.active.length, lang)}</b><span>${en ? 'active now' : 'نشط الآن'}</span></div>
<div class="st"><b>${num(s.d1, lang)}</b><span>${en ? 'last 24 hours' : 'آخر ٢٤ ساعة'}</span></div>
<div class="st"><b>${num(s.d7, lang)}</b><span>${en ? 'last 7 days' : 'آخر ٧ أيام'}</span></div></div>
${chips ? `<div class="chips">${chips}</div>` : ''}
<h2>${en ? `Latest alerts in ${esc(name)}` : `آخر التنبيهات ${esc(withBi(name))}`}</h2>
${items ? `<ul class="list">${items}</ul>` : `<div class="empty">${en ? `No alerts in ${esc(name)} in the last 30 days. Follow the channel to be the first to know.` : `ما في تنبيهات ${esc(withBi(name))} آخر ٣٠ يوم. تابع القناة لتعرف أول بأول.`}</div>`}
<h2>${en ? 'Share with family and friends' : 'شاركها مع أهلك ورفقاتك'}</h2>
${shareLinks(site + path, shareText, lang)}
${siblings.length ? `<h2>${en ? (area.kind === 'gov' ? `Towns in ${esc(name)}` : `Other towns in ${esc(govName)}`) : (area.kind === 'gov' ? `مدن ومناطق ${esc(name)}` : `مناطق تانية بمحافظة ${esc(govName)}`)}</h2>
<div class="areas">${siblings.map((c) => `<a href="/${lang}/area/${c.slug}/">${esc(areaName(c, lang))}</a>`).join('')}</div>` : ''}
<h2>${en ? 'All governorates' : 'كل المحافظات'}</h2><div class="areas">${govLinks}</div>
<h2>${en ? 'About this page' : 'عن هالصفحة'}</h2>
<div class="faq">${en
    ? `<p><b>Where do the alerts come from?</b> From reports verified by the Red Alert Syria team and from Syrian news channels; every alert is reviewed before it is published.</p><p><b>How do I get notified instantly?</b> Join the Telegram channel <a href="${CHANNEL_URL}">@Red_Alert_Syria</a> or keep the live map open — it updates by itself.</p>`
    : `<p><b>من وين التنبيهات؟</b> من بلاغات بيتحقق منها فريق الإنذار الأحمر سوريا ومن قنوات الأخبار السورية، وكل تنبيه بيتراجع قبل ما ينشر.</p><p><b>كيف بوصلني التنبيه فوراً؟</b> اشترك بقناة تيليغرام <a href="${CHANNEL_URL}">@Red_Alert_Syria</a> أو خلّي الخريطة المباشرة مفتوحة، بتتحدّث لحالها.</p>`}</div>`;
  const jsonld = [{
    '@context': 'https://schema.org',
    '@graph': [
      ORG(),
      {
        '@type': 'WebPage', '@id': site + path, url: site + path, name: title, description: desc, inLanguage: lang,
        isPartOf: { '@type': 'WebSite', url: `${site}/${lang}/`, name: 'Red Alert Syria' }, publisher: { '@id': `${site}/#org` },
        ...(s.last ? { dateModified: new Date(s.last).toISOString() } : {}),
        about: { '@type': 'Place', name, alternateName: en ? area.ar : area.en, geo: { '@type': 'GeoCoordinates', latitude: area.lat, longitude: area.lon }, containedInPlace: area.kind === 'city' && gov ? { '@type': 'AdministrativeArea', name: govName } : { '@type': 'Country', name: en ? 'Syria' : 'سوريا' } },
        primaryImageOfPage: { '@type': 'ImageObject', url: `${site}/og/area/${area.slug}-${lang}.png` },
      },
      { '@type': 'BreadcrumbList', itemListElement: crumbs.map(([t, h], i) => ({ '@type': 'ListItem', position: i + 1, name: t, item: site + h })) },
    ],
  }];
  return shell({ lang, title, desc, path, alt, ogImage: `${site}/og/area/${area.slug}-${lang}.png`, jsonld, body });
}

function hubPage(lang) {
  const en = lang === 'en';
  const path = `/${lang}/areas/`;
  const title = en ? 'Live alerts by area — every governorate and main town in Syria | Red Alert Syria' : 'شو صاير بمنطقتك؟ تنبيهات سوريا حسب المحافظة والمدينة | الإنذار الأحمر سوريا';
  const desc = en ? 'Pick your governorate or town in Syria to see its latest live alerts: drones, warplanes, shelling, missiles, accidents and fires.' : 'اختار محافظتك أو مدينتك بسوريا وشوف آخر التنبيهات العاجلة فيها: مسيّرات، طيران حربي، قصف، صواريخ، حوادث وحرائق.';
  const blocks = AREAS.filter((a) => a.kind === 'gov').map((g) => `<h3><a href="/${lang}/area/${g.slug}/">${esc(areaName(g, lang))}</a></h3><div class="areas">${citiesOf(g.code).map((c) => `<a href="/${lang}/area/${c.slug}/">${esc(areaName(c, lang))}</a>`).join('') || ''}</div>`).join('');
  const body = `<nav class="crumbs"><a href="/${lang}/">${en ? 'Live map' : 'الخريطة المباشرة'}</a> › ${en ? 'Areas' : 'المناطق'}</nav>
<h1>${en ? 'Live alerts by area' : 'شو صاير بمنطقتك؟'}</h1><p class="lead">${esc(desc)}</p>
<div class="cta"><a class="btn red" href="/${lang}/">${en ? 'Open the live map' : 'افتح الخريطة المباشرة'}</a><a class="btn tg" href="${CHANNEL_URL}" target="_blank" rel="noopener">${en ? 'Follow on Telegram' : 'تابعنا على تيليغرام'}</a></div>
<div class="govs">${AREAS.filter((a) => a.kind === 'gov').map((g) => { const gs = summary(g); return `<div class="gov"><h3>${esc(areaName(g, lang))}</h3><p class="n">${en ? `${gs.active.length} active now · ${gs.d1} in the last 24 hours` : `${num(gs.active.length, lang)} نشط الآن · ${num(gs.d1, lang)} آخر ٢٤ ساعة`}</p><div class="row"><a class="m" href="/${lang}/?at=${g.lat.toFixed(4)},${g.lon.toFixed(4)},${g.zoom}">${en ? 'Open the map on it' : 'افتح الخريطة عليها'}</a><a href="/${lang}/area/${g.slug}/">${en ? 'Its alerts page' : 'صفحتها وتنبيهاتها'}</a></div></div>`; }).join('')}</div>
<div class="hub">${blocks}</div>`;
  const site = SITE();
  const jsonld = [{ '@context': 'https://schema.org', '@graph': [ORG(), { '@type': 'CollectionPage', url: site + path, name: title, description: desc, inLanguage: lang },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: en ? 'Live map' : 'الخريطة المباشرة', item: `${site}/${lang}/` }, { '@type': 'ListItem', position: 2, name: en ? 'Areas' : 'المناطق', item: site + path }] }] }];
  return shell({ lang, title, desc, path, alt: `/${en ? 'ar' : 'en'}/areas/`, ogImage: `${site}/og/site-${lang}.png`, jsonld, body });
}

// ------------------------------------------------------------------ alert share page
const BOT_UA = /bot|crawl|spider|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|twitter|linkedin|skype|vkshare|pinterest|embedly|quora|outbrain|viber|snapchat|signal|preview|google|bing|yandex|applebot|iframely/i;
function alertLastUpdate(a) {
  const base = Date.parse(a?.timestamp) || 0;
  const updates = Array.isArray(a?.history) ? a.history : Array.isArray(a?.updates) ? a.updates : [];
  const candidates = [Date.parse(a?.updated_at) || 0, ...updates.filter((u) => u?.kind && u.kind !== 'published').map((u) => Date.parse(u.at) || 0)];
  const latest = Math.max(...candidates);
  return latest > base ? latest : 0;
}
function alertInfo(id) {
  const a = store.getAlert(id);
  if (a) {
    const p = a.place || {};
    return { a, ty: a.type, ts: Date.parse(a.timestamp), updatedTs: alertLastUpdate(a), pa: p.scope === 'governorate' ? p.governorate_ar : (p.name_ar || p.governorate_ar), pe: p.scope === 'governorate' ? p.governorate_en : (p.name_en || p.governorate_en), ga: p.governorate_ar, ge: p.governorate_en, desc: a.description || '', desc_en: a.description_en || '' };
  }
  const e = (store.state.log || []).findLast?.((x) => x.id === id) || [...(store.state.log || [])].reverse().find((x) => x.id === id);
  if (e) return { ty: e.ty, ts: Date.parse(e.ts), updatedTs: 0, pa: e.pa || e.ga, pe: e.pe || e.ge, ga: e.ga, ge: e.ge, desc: '', m: e.m };
  return null;
}
function alertSharePage(id, lang) {
  const en = lang === 'en';
  const site = SITE();
  const info = alertInfo(id);
  const target = `/${lang}/#${encodeURIComponent(id)}`;
  if (!info) return null;
  const place = en ? info.pe : info.pa;
  const gov = en ? info.ge : info.ga;
  const placeLine = [place, gov].filter((x, i, arr) => x && arr.indexOf(x) === i).join(en ? ', ' : '، ');
  const title = `🚨 ${typeLabel(info.ty, lang)}${placeLine ? ` — ${placeLine}` : ''} | ${en ? 'Red Alert Syria' : 'الإنذار الأحمر سوريا'}`;
  const when = fmtWhen(info.ts, lang);
  const lastUpdated = info.updatedTs ? fmtWhen(info.updatedTs, lang) : '';
  const dtx = (en && info.desc_en) || info.desc;
  const updateText = lastUpdated ? (en ? ` · Last updated ${lastUpdated}` : ` · آخر تحديث ${lastUpdated}`) : '';
  const desc = `${dtx ? dtx.slice(0, 160) + ' · ' : ''}${when} (${en ? 'Damascus time' : 'بتوقيت دمشق'})${updateText}. ${en ? 'Live map of alerts across Syria — follow t.me/Red_Alert_Syria' : 'خريطة سوريا المباشرة للتنبيهات — تابعنا t.me/Red_Alert_Syria'}`;
  const version = info.updatedTs || info.ts;
  const og = info.a ? `${site}/og/a/${encodeURIComponent(id)}-${lang}.png?v=${encodeURIComponent(version)}` : `${site}/og/site-${lang}.png`;
  const body = `<h1>${esc(typeLabel(info.ty, lang))}${placeLine ? ` — ${esc(placeLine)}` : ''}</h1><p class="lead">${en ? 'Reported' : 'وقت البلاغ'}: ${esc(when)}</p>${lastUpdated ? `<p class="lead">${en ? 'Last updated' : 'آخر تحديث'}: ${esc(lastUpdated)}</p>` : ''}
<div class="cta"><a class="btn red" href="${target}">${en ? 'Open on the live map' : 'افتح على الخريطة المباشرة'}</a><a class="btn tg" href="${CHANNEL_URL}">${en ? 'Follow on Telegram' : 'تابعنا على تيليغرام'}</a></div>`;
  let html = shell({ lang, title, desc, path: `/${lang}/a/${encodeURIComponent(id)}`, alt: null, ogImage: og, ogW: info.a ? 820 : 1200, ogH: info.a ? 791 : 630, body, robots: 'noindex,follow' });
  html = html.replace('<meta name="robots"', `<meta http-equiv="refresh" content="0;url=${esc(target)}"><meta name="robots"`);
  return html;
}

// ------------------------------------------------------------------ preview images
const imgCache = new Map(); // key -> { at, png }
function cached(key, ttlMs, make) {
  const c = imgCache.get(key);
  if (c && Date.now() - c.at < ttlMs) return c.png;
  const out = make();
  const store1 = (png) => { imgCache.set(key, { at: Date.now(), png }); if (imgCache.size > 120) imgCache.delete(imgCache.keys().next().value); return png; };
  return out instanceof Promise ? out.then(store1) : store1(out);
}
const OW = 1200; const OH = 630;
function ogSvg({ lang, title, sub, stats }) {
  const en = lang === 'en';
  const A = en ? 'start' : 'end'; const X = en ? 70 : OW - 70; const dir = en ? '' : ' direction="rtl"';
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${OW}" height="${OH}" viewBox="0 0 ${OW} ${OH}">`,
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#121c33"/><stop offset="1" stop-color="#0a0f1c"/></linearGradient>',
    '<radialGradient id="r" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ff3b4e" stop-opacity="0.55"/><stop offset="1" stop-color="#ff3b4e" stop-opacity="0"/></radialGradient></defs>',
    `<rect width="${OW}" height="${OH}" fill="url(#g)"/><rect width="${OW}" height="10" fill="#ff3b4e"/>`];
  const rx = en ? OW - 190 : 190; // radar decoration on the trailing side
  o.push(`<circle cx="${rx}" cy="300" r="150" fill="url(#r)"/>`);
  for (const r of [60, 105, 150]) o.push(`<circle cx="${rx}" cy="300" r="${r}" fill="none" stroke="#ff3b4e" stroke-opacity="0.45" stroke-width="2"/>`);
  o.push(`<circle cx="${rx}" cy="300" r="16" fill="#ff3b4e"/>`);
  const lw = logoAt(0, 52, 64).w;
  o.push(logoAt(en ? 70 : OW - 70 - lw, 52, 64).svg);
  const lines = Array.isArray(title) ? title : [title];
  const longest = Math.max(...lines.map((l) => l.length));
  const ts = longest > 22 ? 58 : 70;
  const sh = lines.length > 1 ? 40 : 0;
  lines.forEach((l, i) => o.push(`<text x="${X}" y="${250 - (lines.length - 1) * 86 + i * 86 + sh}" font-family="${en ? 'Noto Sans' : 'Noto Kufi Arabic'}" font-size="${ts}" font-weight="800" fill="#ffffff" text-anchor="${A}"${dir}>${esc(l)}</text>`));
  o.push(`<text x="${X}" y="${318 + sh}" font-family="${en ? 'Noto Sans' : 'Noto Kufi Arabic'}" font-size="32" font-weight="500" fill="#cbd5e1" text-anchor="${A}"${dir}>${esc(sub)}</text>`);
  if (stats) o.push(`<text x="${X}" y="${395 + sh}" font-family="${en ? 'Noto Sans' : 'Noto Kufi Arabic'}" font-size="34" font-weight="700" fill="#fca5a5" text-anchor="${A}"${dir}>${esc(stats)}</text>`);
  o.push(`<rect x="0" y="${OH - 96}" width="${OW}" height="96" fill="#060a14" fill-opacity="0.65"/>`);
  const bh = 52; const bw = badgeWidth(bh);
  o.push(channelBadge(en ? OW - 70 - bw : 70, OH - 74, { h: bh, dark: true }));
  const domain = SITE().replace(/^https?:\/\//, '');
  o.push(`<text x="${en ? 70 : OW - 70}" y="${OH - 37}" font-family="Noto Sans" font-size="28" font-weight="700" fill="#e2e8f0" text-anchor="${en ? 'start' : 'end'}">${esc(domain)}</text>`);
  o.push('</svg>');
  return o.join('');
}
function areaOgPng(area, lang) {
  return cached(`area:${area.slug}:${lang}`, 10 * 60_000, () => {
    const s = summary(area); const en = lang === 'en'; const name = areaName(area, lang);
    const one = en ? `What's happening in ${name} now?` : `شو صاير ${withBi(name)} هلق؟`;
    const title = one.length > (en ? 24 : 20) ? (en ? ["What's happening in", `${name} now?`] : ['شو صاير', `${withBi(name)} هلق؟`]) : one;
    const sub = en ? 'Live alerts on the map of Syria, moment by moment' : 'تنبيهات مباشرة لحظة بلحظة على خريطة سوريا';
    const stats = en ? `Last 24 h: ${s.d1}   |   Last 7 days: ${s.d7}` : `آخر ٢٤ ساعة: ${arDigits(s.d1)}   |   آخر ٧ أيام: ${arDigits(s.d7)}`;
    return svgToPng(ogSvg({ lang, title, sub, stats }), OW);
  });
}
function siteOgPng(lang) {
  return cached(`site:${lang}`, 24 * 3600_000, () => svgToPng(ogSvg({
    lang,
    title: lang === 'en' ? 'Red Alert Syria' : 'الإنذار الأحمر سوريا',
    sub: lang === 'en' ? 'Live map of alerts across Syria' : 'خريطة سوريا المباشرة للتنبيهات العاجلة',
    stats: lang === 'en' ? 'Drones | Warplanes | Shelling | Accidents' : 'مسيّرات  |  طيران حربي  |  قصف  |  حوادث',
  }), OW));
}

// ------------------------------------------------------------------ content pages (about / glossary / press)
// Phase 1 of the owner's content-pages order (2026-11-25): original copy
// from this project's own facts and its real alert-type dictionary —
// structure follows the reference early-warning site pattern (about+FAQ,
// glossary, press), text is entirely ours. No paid/data-product pages.
const crumbsHtml = (lang, items) => `<nav class="crumbs">${items.map(([t, h], i) => (i < items.length - 1 ? `<a href="${h}">${esc(t)}</a> › ` : esc(t))).join('')}</nav>`;

const GLOSS = {
  breaking: ['تطوّر مهم يُنشر فوراً بصيغة موجزة قبل اكتمال التفاصيل، ويُحدَّث عند ورودها.', 'An important development published immediately in brief form, before the full details are in, and updated as they arrive.'],
  political: ['قرارات وتصريحات ومواقف رسمية ذات صلة بالشأن السوري.', 'Official decisions, statements and positions related to Syrian affairs.'],
  uav: ['رصد تحليق أو نشاط طائرة مسيّرة فوق منطقة ما، دون إعلان استهداف.', 'A drone sighted or active over an area, with no strike reported.'],
  uav_strike: ['ضربة أو استهداف مباشر نفّذته طائرة مسيّرة.', 'A direct strike carried out by a drone.'],
  targeted_strike: ['ضربة محدّدة ضد هدف بعينه: شخص أو موقع أو آلية.', 'A specific strike against a particular target: a person, a site or a vehicle.'],
  airstrike: ['قصف نفّذه طيران حربي على هدف ما.', 'A strike carried out by military aircraft.'],
  warplane: ['رصد تحليق طائرات حربية في الأجواء، دون إعلان قصف.', 'Military jets observed flying overhead, with no strike reported.'],
  helicopter: ['رصد تحليق مروحيات عسكرية.', 'Military helicopters observed in flight.'],
  air_movement: ['حركة طيران عامة ملحوظة في الأجواء.', 'Notable general air traffic observed in the skies.'],
  signal_sweep: ['نشاط رصد أو مسح أو تشويش إشاري ملحوظ في منطقة ما.', 'Observed signal monitoring, sweeping or jamming activity in an area.'],
  civil_plane: ['حادث أو حدث يخص طيراناً مدنياً، كهبوط اضطراري.', 'An incident involving civil aviation, such as an emergency landing.'],
  missile: ['إطلاق صواريخ أو قذائف صاروخية أو سقوطها أو اعتراضها.', 'The launch, fall or interception of missiles or rockets.'],
  artillery: ['قصف بالمدفعية أو قذائف الهاون أو راجمات الصواريخ.', 'Shelling with artillery, mortar rounds or rocket launchers.'],
  explosion: ['وقوع انفجار في مكان ما، أياً كان سببه المعلن.', 'An explosion occurring at a location, whatever its reported cause.'],
  detonation: ['تفجير متعمّد لعبوة أو هدف أو مبنى.', 'The deliberate detonation of a device, a target or a building.'],
  attack: ['هجوم مسلّح أو اعتداء مباشر على هدف أو أشخاص.', 'An armed attack or a direct assault on a target or on people.'],
  clashes: ['تبادل إطلاق نار أو مواجهة بين طرفين مسلّحين.', 'An exchange of fire or a confrontation between two armed sides.'],
  assassination: ['قتل مستهدَف لشخص بعينه أو محاولة اغتياله.', 'The targeted killing, or attempted killing, of a specific person.'],
  shooting: ['سماع إطلاق نار أو رصده، دون اشتباك مؤكد بين طرفين.', 'Shots heard or observed, without a confirmed two-sided clash.'],
  military_incursion: ['دخول قوات أو آليات عسكرية إلى منطقة ما على الأرض.', 'The ground entry of troops or military vehicles into an area.'],
  patrol: ['مرور دورية عسكرية أو أمنية في منطقة ما أو انتشارها فيها.', 'A military or security patrol moving through, or deployed in, an area.'],
  border: ['حدث عند الحدود أو المعابر: إغلاق أو ازدحام أو تطوّر أمني.', 'An event at a border or a crossing: a closure, congestion or a security development.'],
  kidnapping: ['خطف شخص أو مجموعة، أو تحرير مختطفين.', 'The abduction of a person or a group, or the release of abductees.'],
  arrest: ['توقيف أشخاص من جهة أمنية في منطقة ما.', 'The detention of people by a security body in an area.'],
  smuggling_weapons: ['ضبط محاولة تهريب أسلحة أو ذخيرة أو رصدها.', 'An intercepted or reported attempt to smuggle weapons or ammunition.'],
  smuggling_drugs: ['ضبط محاولة تهريب مواد مخدّرة أو رصدها.', 'An intercepted or reported attempt to smuggle narcotics.'],
  smuggling_explosives: ['ضبط محاولة تهريب مواد متفجرة أو رصدها.', 'An intercepted or reported attempt to smuggle explosive materials.'],
  accident: ['حادث مروري: تصادم أو انقلاب أو دهس.', 'A road accident: a collision, a rollover or a run-over.'],
  fire: ['اندلاع حريق في مبنى أو سوق أو أراضٍ أو محاصيل.', 'A fire breaking out in a building, a market, land or crops.'],
  protest: ['تجمّع أو مسيرة شعبية في الشارع.', 'A public gathering or a march.'],
  protest_action: ['وقفة أو فعالية احتجاجية محدودة.', 'A smaller protest action or stand.'],
  brawl: ['شجار أو عراك بين أشخاص.', 'A fight or a scuffle between people.'],
  death: ['إعلان وفاة أو العثور على جثة، دون سببٍ حادثٍ محدّد.', 'A reported death or a body found, with no specific incident as its cause.'],
  martyrdom: ['إعلان استشهاد شخص في سياق الأحداث الجارية.', 'A reported martyrdom in the context of the ongoing events.'],
  civil: ['تنبيه يخصّ المدنيين والخدمات العامة، دون طابع عسكري مباشر.', 'An alert concerning civilians and public services, with no direct military character.'],
  quake: ['هزّة أرضية مسجّلة أو محسوسة في المنطقة.', 'A recorded or felt earthquake in the area.'],
  weather: ['تحذير من أحوال جوية قاسية: عواصف أو سيول أو ثلوج ونحوها.', 'A warning of severe weather: storms, floods, snow and the like.'],
};
const GLOSS_GROUPS = [
  { ar: 'الطيران والرصد', en: 'Aviation & observation', keys: ['uav', 'uav_strike', 'warplane', 'helicopter', 'air_movement', 'signal_sweep', 'civil_plane'] },
  { ar: 'القصف والضربات', en: 'Strikes & fire', keys: ['airstrike', 'missile', 'artillery', 'explosion', 'detonation', 'targeted_strike'] },
  { ar: 'أحداث أمنية', en: 'Security incidents', keys: ['breaking', 'attack', 'clashes', 'assassination', 'shooting', 'military_incursion', 'patrol', 'border', 'kidnapping', 'arrest', 'smuggling_weapons', 'smuggling_drugs', 'smuggling_explosives'] },
  { ar: 'مجتمع وحوادث', en: 'Society & accidents', keys: ['accident', 'fire', 'protest', 'protest_action', 'brawl', 'death', 'martyrdom', 'civil', 'political'] },
  { ar: 'طبيعة وطقس', en: 'Nature & weather', keys: ['quake', 'weather'] },
];

function glossaryPage(lang) {
  const en = lang === 'en';
  const site = SITE();
  const path = `/${lang}/glossary/`;
  const title = en ? 'Alert types glossary — what each alert on the map means | Red Alert Syria' : 'مصطلحات التنبيهات — شو يعني كل نوع تنبيه على الخريطة؟ | الإنذار الأحمر سوريا';
  const desc = en ? 'Plain-language explanations of every alert type used by Red Alert Syria: drones, warplanes, airstrikes, shelling, explosions, clashes, earthquakes and more.' : 'شرح مبسّط لكل أنواع التنبيهات يلي بيستخدمها الإنذار الأحمر سوريا: مسيّرات، طيران حربي، غارات، قصف، انفجارات، اشتباكات، زلازل وغيرها.';
  const groups = GLOSS_GROUPS.map((g) => `<h2>${esc(en ? g.en : g.ar)}</h2>${g.keys.map((k) => { const t = ALERT_TYPES[k]; const gl = GLOSS[k]; if (!t || !gl) return ''; return `<div class="term" style="--c:${typeColor(k)}"><b>${esc(typeLabel(k, lang))}</b><p>${esc(en ? gl[1] : gl[0])}</p></div>`; }).join('')}`).join('');
  const body = `${crumbsHtml(lang, [[en ? 'Live map' : 'الخريطة المباشرة', `/${lang}/`], [en ? 'Glossary' : 'المصطلحات', path]])}
<h1>${en ? 'What does each alert type mean?' : 'شو يعني كل نوع تنبيه؟'}</h1>
<p class="lead">${en ? 'Every alert on the map and in the channels carries one of these types. Here is what each one means, in plain language — the same definitions our newsroom works by.' : 'كل تنبيه على الخريطة وبالقنوات بيحمل واحد من هالأنواع. هي شو بيعني كل نوع بلغة بسيطة — نفس التعريفات يلي بتشتغل عليها غرفة أخبارنا.'}</p>
<div class="cta"><a class="btn red" href="/${lang}/">${en ? 'Open the live map' : 'افتح الخريطة المباشرة'}</a><a class="btn" href="/${lang}/about/">${en ? 'About the project' : 'عن المشروع'}</a></div>
${groups}`;
  const jsonld = [{ '@context': 'https://schema.org', '@graph': [ORG(), { '@type': 'WebPage', '@id': site + path, url: site + path, name: title, description: desc, inLanguage: lang, isPartOf: { '@type': 'WebSite', url: `${site}/${lang}/`, name: 'Red Alert Syria' }, publisher: { '@id': `${site}/#org` } }] }];
  return shell({ lang, title, desc, path, alt: `/${en ? 'ar' : 'en'}/glossary/`, ogImage: `${site}/og/site-${lang}.png`, jsonld, body });
}

const FAQ = [
  { q: ['كيف تصلني التنبيهات فوراً؟', 'How do I get alerts instantly?'],
    a: ['اشترك بقناة تيليغرام أو قناة واتساب، أو فعّل إشعارات المتصفح من الخريطة المباشرة. لا تحتاج أي تسجيل أو حساب.', 'Join the Telegram channel or the WhatsApp channel, or enable browser notifications on the live map. No registration or account is needed.'] },
  { q: ['من أين تأتي الأخبار؟', 'Where does the news come from?'],
    a: ['من بلاغات الجمهور عبر بوت البلاغات، ومن رصد قنوات ومصادر الأخبار السورية. كل تنبيه يراجعه فريق التحرير قبل نشره، ويُذكر مصدره معه.', 'From public reports sent through the reporting bot, and from monitoring Syrian news channels and sources. Every alert is reviewed by the editorial team before it is published, and its source is cited with it.'] },
  { q: ['ما الفرق بين «مؤكد» و«أولي»؟', 'What is the difference between “confirmed” and “preliminary”?'],
    a: ['«مؤكد» يعني أن الخبر تحقق من أكثر من مصدر أو من مصدر مباشر موثوق. «أولي» يعني أن الخبر وارد من مصدر واحد وما زال بانتظار التأكيد، ويُحدَّث فور توفر معلومات أدق.', '“Confirmed” means the report was verified by more than one source, or by one direct trusted source. “Preliminary” means it arrived from a single source and is still awaiting confirmation; it is updated as soon as firmer information arrives.'] },
  { q: ['هل الخدمة مجانية؟', 'Is the service free?'],
    a: ['نعم، مجانية بالكامل: بلا اشتراك وبلا إعلانات وبلا تسجيل.', 'Yes, completely free: no subscription, no ads and no registration.'] },
  { q: ['هل تغطّون محافظتي؟', 'Do you cover my governorate?'],
    a: ['نعم، التغطية تشمل كل المحافظات السورية. صفحة كل محافظة ومدينة رئيسية تعرض آخر تنبيهاتها لحظة بلحظة.', 'Yes, coverage spans every Syrian governorate. Each governorate and main town has its own page with its latest alerts, moment by moment.'] },
  { q: ['كيف أبلّغ عن حدث؟', 'How do I report an event?'],
    a: ['عبر بوت البلاغات على تيليغرام. بلاغك يصل فريق التحرير للتحقق منه قبل أي نشر.', 'Through the reporting bot on Telegram. Your report reaches the editorial team, which verifies it before anything is published.'] },
  { q: ['ماذا لو تبيّن أن خبراً غير دقيق؟', 'What happens if a report turns out to be inaccurate?'],
    a: ['يُحدَّث التنبيه ويُصحَّح في مكانه على الخريطة والقناة عند توفر معلومات أدق، فلا يبقى الخطأ متداولاً بصيغته الأولى.', 'The alert is updated and corrected in place, on the map and in the channel, as soon as firmer information is available, so the first version does not keep circulating.'] },
];

function aboutPage(lang) {
  const en = lang === 'en';
  const site = SITE();
  const path = `/${lang}/about/`;
  const title = en ? 'About Red Alert Syria — what it is, how we verify, and FAQ' : 'عن الإنذار الأحمر سوريا — شو هو المشروع، كيف منتحقق، وأسئلة شائعة';
  const desc = en ? 'Red Alert Syria is a free live map and alert service covering every Syrian governorate: how it works, how reports are verified (confirmed vs preliminary), and who runs it.' : 'الإنذار الأحمر سوريا خدمة خريطة وتنبيهات حية مجانية بتغطي كل المحافظات السورية: كيف بتشتغل، وكيف بيتحقق من الأخبار (مؤكد وأولي)، ومين بيديرها.';
  const faqHtml = FAQ.map((f) => `<p><b>${esc(en ? f.q[1] : f.q[0])}</b><br>${esc(en ? f.a[1] : f.a[0])}</p>`).join('');
  const body = `${crumbsHtml(lang, [[en ? 'Live map' : 'الخريطة المباشرة', `/${lang}/`], [en ? 'About' : 'عن المشروع', path]])}
<h1>${en ? 'About Red Alert Syria' : 'عن الإنذار الأحمر سوريا'}</h1>
<p class="lead">${en ? 'A free early-warning service for Syria: a live map and instant alerts for security and field developments across every Syrian governorate, around the clock.' : 'خدمة إنذار مبكر مجانية لسوريا: خريطة مباشرة وتنبيهات فورية للتطورات الأمنية والميدانية بكل المحافظات السورية، على مدار الساعة.'}</p>
<div class="cta"><a class="btn red" href="/${lang}/">${en ? 'Open the live map' : 'افتح الخريطة المباشرة'}</a>
<a class="btn tg" href="${CHANNEL_URL}" target="_blank" rel="noopener">${en ? 'Telegram channel' : 'قناة تيليغرام'}</a>
<a class="btn" href="${WA_CHANNEL_URL}" target="_blank" rel="noopener">${en ? 'WhatsApp channel' : 'قناة واتساب'}</a>
<a class="btn" href="${REPORT_URL}" target="_blank" rel="noopener">${en ? 'Report an event' : 'بلّغ عن حدث'}</a></div>
<h2>${en ? 'What is the project?' : 'شو هو المشروع؟'}</h2>
<p>${en ? 'Red Alert Syria brings the events that matter to people in Syria into one place: a live map that updates by itself, a Telegram channel and a WhatsApp channel. It tracks drones, warplanes, shelling, explosions, clashes, road accidents, fires and earthquakes — and the everyday developments around them — in every Syrian governorate, in Arabic and English.' : 'الإنذار الأحمر سوريا بيجمع الأحداث يلي بتهمّ الناس بسوريا بمكان واحد: خريطة مباشرة بتتحدّث لحالها، وقناة تيليغرام وقناة واتساب. بيرصد المسيّرات والطيران الحربي والقصف والانفجارات والاشتباكات وحوادث السير والحرائق والزلازل — والتطورات اليومية حولها — بكل المحافظات السورية، بالعربية والإنجليزية.'}</p>
<h2>${en ? 'How we work: sources and verification' : 'كيف منشتغل: المصادر والتحقق'}</h2>
<div class="faq">
<p><b>${en ? 'Two doors for every report.' : 'لكل خبر بابان.'}</b> ${en ? 'Reports reach us from the public through the reporting bot, and from continuous monitoring of Syrian news channels and sources.' : 'الأخبار بتوصلنا من الجمهور عبر بوت البلاغات، ومن رصد مستمر لقنوات ومصادر الأخبار السورية.'}</p>
<p><b>${en ? 'Nothing is published unverified.' : 'ما بينتشر شي بلا تحقق.'}</b> ${en ? 'The editorial team reviews every alert before publication. When verification is still under way, the alert is labelled “preliminary”; once it is established by more than one source or a direct trusted source, it is labelled “confirmed”.' : 'فريق التحرير بيراجع كل تنبيه قبل النشر. وإذا كان التحقق لسه جاري، بيحمل التنبيه وسم «أولي»؛ ولما يثبت بأكتر من مصدر أو بمصدر مباشر موثوق، بيصير «مؤكد».'}</p>
<p><b>${en ? 'Sources are cited, corrections are in place.' : 'المصدر مذكور، والتصحيح بمحله.'}</b> ${en ? 'Every alert names its source. If firmer information arrives, the alert is updated and corrected where it stands — on the map and in the channel — rather than left to circulate in its first form.' : 'كل تنبيه بيذكر مصدره. وإذا وصلت معلومات أدق، بيتم تحديث التنبيه وتصحيحه بمكانه — على الخريطة وبالقناة — بدل ما يضل متداول بصيغته الأولى.'}</p>
</div>
<h2>${en ? 'Why is it free?' : 'ليش مجاني؟'}</h2>
<p>${en ? 'Because a warning that arrives late, or sits behind a paywall, does not protect anyone. The service is completely free: no subscription, no ads and no registration — open the map or join a channel and the alerts reach you.' : 'لأن التحذير يلي بيوصل متأخر، أو يلي ورا جدار دفع، ما بيحمي حدا. الخدمة مجانية بالكامل: بلا اشتراك وبلا إعلانات وبلا تسجيل — افتح الخريطة أو اشترك بقناة وبيوصلك التنبيه.'}</p>
<h2>${en ? 'Who runs it?' : 'مين بيدير المشروع؟'}</h2>
<p>${en ? 'Red Alert Syria is an independent Syrian media project, founded and run by its owner together with a small editorial team working around the clock. It has no affiliation with any official body, and its only commitment is to the accuracy of what it publishes.' : 'الإنذار الأحمر سوريا مشروع إعلامي سوري مستقل، أسّسه ويديره صاحبه مع فريق تحرير صغير بيشتغل على مدار الساعة. ما إلو تبعية لأي جهة رسمية، والتزامه الوحيد هو دقة يلي بينشره.'}</p>
<h2>${en ? 'Frequently asked questions' : 'الأسئلة الشائعة'}</h2>
<div class="faq">${faqHtml}</div>`;
  const jsonld = [{ '@context': 'https://schema.org', '@graph': [ORG(),
    { '@type': 'AboutPage', '@id': site + path, url: site + path, name: title, description: desc, inLanguage: lang, isPartOf: { '@type': 'WebSite', url: `${site}/${lang}/`, name: 'Red Alert Syria' }, publisher: { '@id': `${site}/#org` } },
    { '@type': 'FAQPage', mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: en ? f.q[1] : f.q[0], acceptedAnswer: { '@type': 'Answer', text: en ? f.a[1] : f.a[0] } })) }] }];
  return shell({ lang, title, desc, path, alt: `/${en ? 'ar' : 'en'}/about/`, ogImage: `${site}/og/site-${lang}.png`, jsonld, body });
}

function pressPage(lang) {
  const en = lang === 'en';
  const site = SITE();
  const path = `/${lang}/press/`;
  const title = en ? 'For journalists — fact sheet, assets and press contact | Red Alert Syria' : 'للصحفيين — بطاقة وقائع وأصول للتنزيل وتواصل | الإنذار الأحمر سوريا';
  const desc = en ? 'The Red Alert Syria fact sheet for media: what it is, its coverage of all Syrian governorates, its alert types, downloadable logos and share images, and how to reach the team.' : 'بطاقة وقائع الإنذار الأحمر سوريا للإعلام: شو هو المشروع، وتغطيته لكل المحافظات السورية، وأنواع تنبيهاته، وشعارات وصور قابلة للتنزيل، وكيف تتواصلوا مع الفريق.';
  const typeCount = Object.keys(ALERT_TYPES).length;
  const govCount = AREAS.filter((a) => a.kind === 'gov').length;
  const fact = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const facts = [
    fact(en ? 'Name' : 'الاسم', en ? 'Red Alert Syria (الإنذار الأحمر سوريا)' : 'الإنذار الأحمر سوريا (Red Alert Syria)'),
    fact(en ? 'What it is' : 'شو هو', en ? 'A live alert map with Telegram and WhatsApp channels' : 'خريطة تنبيهات مباشرة مع قناتي تيليغرام وواتساب'),
    fact(en ? 'Coverage' : 'التغطية', en ? `All ${govCount} Syrian governorates` : `كل المحافظات السورية (${govCount} محافظة)`),
    fact(en ? 'Alert types' : 'أنواع التنبيهات', en ? `${typeCount} types — see the <a href="/en/glossary/">glossary</a>` : `${typeCount} نوعاً — راجع <a href="/ar/glossary/">المصطلحات</a>`),
    fact(en ? 'Languages' : 'اللغات', en ? 'Arabic and English' : 'العربية والإنجليزية'),
    fact(en ? 'Price' : 'السعر', en ? 'Completely free' : 'مجاني بالكامل'),
    fact(en ? 'Ads' : 'الإعلانات', en ? 'None' : 'لا إعلانات'),
    fact(en ? 'Registration' : 'التسجيل', en ? 'Not required' : 'غير مطلوب'),
    fact(en ? 'Updates' : 'التحديث', en ? 'Around the clock, as events are verified' : 'على مدار الساعة، عند التحقق من الأحداث'),
  ].join('');
  const dl = (href, label, note) => `<a class="btn" href="${href}" download>${esc(label)}</a>`;
  const body = `${crumbsHtml(lang, [[en ? 'Live map' : 'الخريطة المباشرة', `/${lang}/`], [en ? 'For journalists' : 'للصحفيين', path]])}
<h1>${en ? 'For journalists' : 'للصحفيين'}</h1>
<p class="lead">${en ? 'Everything a newsroom needs about Red Alert Syria in one page: the fact sheet, downloadable brand assets, and how to reach us.' : 'كل شي بيحتاجه الصحفي عن الإنذار الأحمر سوريا بصفحة واحدة: بطاقة الوقائع، والأصول القابلة للتنزيل، وكيف تتواصلوا معنا.'}</p>
<h2>${en ? 'Fact sheet' : 'بطاقة وقائع'}</h2>
<table class="facts">${facts}</table>
<h2>${en ? 'Downloadable assets' : 'أصول قابلة للتنزيل'}</h2>
<div class="cta">${dl('/img/icon.svg', en ? 'Logo (SVG)' : 'الشعار (SVG)', '')}${dl('/img/logo-wordmark.svg', en ? 'Wordmark (SVG)' : 'الشعار الكتابي (SVG)', '')}${dl('/img/icon-512.png', en ? 'App icon 512px (PNG)' : 'أيقونة التطبيق ٥١٢ (PNG)', '')}${dl('/img/icon-192.png', en ? 'App icon 192px (PNG)' : 'أيقونة التطبيق ١٩٢ (PNG)', '')}${dl(`/og/site-${lang}.png`, en ? 'Share image (PNG)' : 'صورة المشاركة (PNG)', '')}</div>
<h2>${en ? 'Using our material' : 'استخدام موادنا'}</h2>
<p>${en ? 'Journalists may quote the map and the alerts with attribution to “Red Alert Syria” and a link to the live map or the Telegram channel. Times shown are Damascus time, and every alert cites its source.' : 'فين الصحفيين يقتبسوا من الخريطة والتنبيهات مع الإشارة إلى «الإنذار الأحمر سوريا» وربط الخريطة المباشرة أو قناة تيليغرام. الأوقات المعروضة بتوقيت دمشق، وكل تنبيه بيذكر مصدره.'}</p>
<h2>${en ? 'Press contact' : 'تواصل للصحافة'}</h2>
<p>${en ? 'The project’s working contact channel is the reporting bot on Telegram — press inquiries sent there reach the editorial team directly. You can also follow and message via the Telegram channel.' : 'قناة التواصل العاملة للمشروع هي بوت البلاغات على تيليغرام — الاستفسارات الصحفية المرسلة هناك بتوصل فريق التحرير مباشرة. وفينكم تتابعوا وتتواصلوا عبر قناة تيليغرام كمان.'}</p>
<div class="cta"><a class="btn tg" href="${REPORT_URL}" target="_blank" rel="noopener">${en ? 'Contact via the reporting bot' : 'تواصل عبر بوت البلاغات'}</a>
<a class="btn" href="${CHANNEL_URL}" target="_blank" rel="noopener">${en ? 'Telegram channel' : 'قناة تيليغرام'}</a>
<a class="btn" href="/${lang}/about/">${en ? 'About the project' : 'عن المشروع'}</a></div>`;
  const jsonld = [{ '@context': 'https://schema.org', '@graph': [ORG(), { '@type': 'WebPage', '@id': site + path, url: site + path, name: title, description: desc, inLanguage: lang, isPartOf: { '@type': 'WebSite', url: `${site}/${lang}/`, name: 'Red Alert Syria' }, publisher: { '@id': `${site}/#org` } }] }];
  return shell({ lang, title, desc, path, alt: `/${en ? 'ar' : 'en'}/press/`, ogImage: `${site}/og/site-${lang}.png`, jsonld, body });
}

// ------------------------------------------------------------------ sitemap / robots
function sitemapXml() {
  const site = SITE();
  const now = new Date().toISOString();
  const url = (p, alt, lastmod, freq, pri) => `<url><loc>${site}${p}</loc>${alt ? `<xhtml:link rel="alternate" hreflang="${p.startsWith('/ar') ? 'ar' : 'en'}" href="${site}${p}"/><xhtml:link rel="alternate" hreflang="${alt.startsWith('/ar') ? 'ar' : 'en'}" href="${site}${alt}"/>` : ''}<lastmod>${lastmod}</lastmod><changefreq>${freq}</changefreq><priority>${pri}</priority></url>`;
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'];
  for (const l of ['ar', 'en']) out.push(url(`/${l}/`, `/${l === 'ar' ? 'en' : 'ar'}/`, now, 'always', '1.0'));
  for (const l of ['ar', 'en']) out.push(url(`/${l}/areas/`, `/${l === 'ar' ? 'en' : 'ar'}/areas/`, now, 'daily', '0.8'));
  for (const pg of ['about', 'glossary', 'press']) for (const l of ['ar', 'en']) out.push(url(`/${l}/${pg}/`, `/${l === 'ar' ? 'en' : 'ar'}/${pg}/`, now, 'monthly', '0.6'));
  for (const a of AREAS) {
    const ev = areaEvents(a, 30);
    const lm = ev[0] ? new Date(ev[0].ts).toISOString() : new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    for (const l of ['ar', 'en']) out.push(url(`/${l}/area/${a.slug}/`, `/${l === 'ar' ? 'en' : 'ar'}/area/${a.slug}/`, lm, 'hourly', a.kind === 'gov' ? '0.9' : '0.7'));
  }
  out.push('</urlset>');
  return out.join('\n');
}
const robotsTxt = () => `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE()}/sitemap.xml\n`;

// ------------------------------------------------------------------ routes
export function mountSeo(app, { limiter } = {}) {
  const lim = limiter ? [limiter] : [];
  const html = (res, body, maxAge = 120) => { res.setHeader('Cache-Control', `public, max-age=${maxAge}`); res.type('html').send(body); };
  const png = (res, buf, maxAge = 600) => { res.setHeader('Cache-Control', `public, max-age=${maxAge}`); res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); res.type('png').send(buf); };

  app.get('/robots.txt', (req, res) => res.type('text/plain').send(robotsTxt()));
  app.get('/sitemap.xml', (req, res) => { res.setHeader('Cache-Control', 'public, max-age=600'); res.type('application/xml').send(sitemapXml()); });
  // Google Search Console "HTML file" verification (env GOOGLE_VERIFY_FILE=google1234abcd.html)
  app.get('/:f', (req, res, next) => {
    const f = process.env.GOOGLE_VERIFY_FILE;
    if (f && req.params.f === f) return res.type('text/html').send(`google-site-verification: ${f}`);
    next();
  });
  const slash = (req, res, next) => (req.path.endsWith('/') ? next() : res.redirect(301, req.path + '/'));
  for (const pg of ['about', 'glossary', 'press']) {
    app.get([`/ar/${pg}`, `/en/${pg}`], slash);
    app.get([`/ar/${pg}/`, `/en/${pg}/`], ...lim, (req, res) => {
      const lang = req.path.startsWith('/en') ? 'en' : 'ar';
      html(res, pg === 'about' ? aboutPage(lang) : pg === 'glossary' ? glossaryPage(lang) : pressPage(lang), 600);
    });
  }
  app.get(['/ar/areas', '/en/areas'], slash);
  app.get(['/ar/areas/', '/en/areas/'], ...lim, (req, res) => html(res, hubPage(req.path.startsWith('/en') ? 'en' : 'ar'), 600));
  app.get(['/ar/area/:slug', '/en/area/:slug'], slash);
  app.get(['/ar/area/:slug/', '/en/area/:slug/'], ...lim, (req, res) => {
    const area = BY_SLUG.get(String(req.params.slug).toLowerCase());
    if (!area) return res.status(404).type('text').send('Not found');
    html(res, areaPage(area, req.path.startsWith('/en') ? 'en' : 'ar'));
  });
  app.get(['/ar/a/:id', '/en/a/:id'], ...lim, (req, res) => {
    const lang = req.path.startsWith('/en') ? 'en' : 'ar';
    const id = String(req.params.id).slice(0, 80);
    const target = `/${lang}/#${encodeURIComponent(id)}`;
    if (!BOT_UA.test(String(req.headers['user-agent'] || ''))) return res.redirect(302, target);
    const page = alertSharePage(id, lang);
    if (!page) return res.redirect(302, `/${lang}/`);
    html(res, page, 300);
  });
  app.get('/og/site-:lang.png', ...lim, (req, res) => png(res, siteOgPng(req.params.lang === 'en' ? 'en' : 'ar'), 86400));
  app.get('/og/area/:file', ...lim, (req, res) => {
    const m = String(req.params.file).match(/^([a-z0-9-]+)-(ar|en)\.png$/);
    const area = m && BY_SLUG.get(m[1]);
    if (!area) return res.status(404).end();
    try { png(res, areaOgPng(area, m[2])); } catch (e) { console.error('[seo] og area', e.message); res.redirect(302, '/img/og.png'); }
  });
  app.get('/og/a/:file', ...lim, async (req, res) => {
    const m = String(req.params.file).match(/^(.+)-(ar|en)\.png$/);
    const a = m && store.getAlert(m[1]);
    if (!a) return res.redirect(302, `/og/site-${m?.[2] || 'ar'}.png`);
    try { png(res, await cached(`alert:${a.id}:${m[2]}:${alertLastUpdate(a)}`, 24 * 3600_000, () => renderAlertPng(a, { lang: m[2], timeoutMs: 5000 })), 3600); } catch (e) { console.error('[seo] og alert', e.message); res.redirect(302, `/og/site-${m[2]}.png`); }
  });
}
export const _test = { AREAS, BY_SLUG, areaPage, hubPage, aboutPage, glossaryPage, pressPage, alertInfo, alertLastUpdate, alertSharePage, sitemapXml, robotsTxt, areaOgPng, siteOgPng, summary };
