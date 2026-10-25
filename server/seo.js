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
const SITE = () => (config.publicUrl || process.env.PUBLIC_URL || 'https://red-alert-syria.onrender.com').replace(/\/+$/, '');
const CHANNEL_URL = 'https://t.me/Red_Alert_Syria';
const REPORT_URL = 'https://t.me/Rad_Alert_Syria1_bot?start=report';
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
footer{max-width:880px;margin:auto;padding:16px;color:var(--mut);font-size:12.5px;border-top:1px solid var(--bd)}`;

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
    ? `الإنذار الأحمر سوريا — خريطة مباشرة مجانية للتنبيهات في سوريا. الأوقات بتوقيت دمشق. تابعنا على <a href="${CHANNEL_URL}">تيليغرام @Red_Alert_Syria</a> · <a href="/ar/areas/">كل المناطق</a> · <a href="/ar/">الخريطة المباشرة</a>`
    : `Red Alert Syria — free live map of alerts across Syria. Times are Damascus time. Follow on <a href="${CHANNEL_URL}">Telegram @Red_Alert_Syria</a> · <a href="/en/areas/">All areas</a> · <a href="/en/">Live map</a>`}</footer>
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
  const shareText = en ? `🔴 Live alerts in ${name}, Syria — Red Alert Syria` : `🔴 شو صاير ${withBi(name)} هلق؟ تنبيهات ${name} المباشرة على خريطة الإنذار الأحمر سوريا`;
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
<div class="hub">${blocks}</div>`;
  const site = SITE();
  const jsonld = [{ '@context': 'https://schema.org', '@graph': [ORG(), { '@type': 'CollectionPage', url: site + path, name: title, description: desc, inLanguage: lang },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: en ? 'Live map' : 'الخريطة المباشرة', item: `${site}/${lang}/` }, { '@type': 'ListItem', position: 2, name: en ? 'Areas' : 'المناطق', item: site + path }] }] }];
  return shell({ lang, title, desc, path, alt: `/${en ? 'ar' : 'en'}/areas/`, ogImage: `${site}/og/site-${lang}.png`, jsonld, body });
}

// ------------------------------------------------------------------ alert share page
const BOT_UA = /bot|crawl|spider|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|twitter|linkedin|skype|vkshare|pinterest|embedly|quora|outbrain|viber|snapchat|signal|preview|google|bing|yandex|applebot|iframely/i;
function alertInfo(id) {
  const a = store.getAlert(id);
  if (a) {
    const p = a.place || {};
    return { a, ty: a.type, ts: Date.parse(a.timestamp), pa: p.scope === 'governorate' ? p.governorate_ar : (p.name_ar || p.governorate_ar), pe: p.scope === 'governorate' ? p.governorate_en : (p.name_en || p.governorate_en), ga: p.governorate_ar, ge: p.governorate_en, desc: a.description || '', desc_en: a.description_en || '' };
  }
  const e = (store.state.log || []).findLast?.((x) => x.id === id) || [...(store.state.log || [])].reverse().find((x) => x.id === id);
  if (e) return { ty: e.ty, ts: Date.parse(e.ts), pa: e.pa || e.ga, pe: e.pe || e.ge, ga: e.ga, ge: e.ge, desc: '', m: e.m };
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
  const title = `🔴 ${typeLabel(info.ty, lang)}${placeLine ? ` — ${placeLine}` : ''} | ${en ? 'Red Alert Syria' : 'الإنذار الأحمر سوريا'}`;
  const when = fmtWhen(info.ts, lang);
  const dtx = (en && info.desc_en) || info.desc;
  const desc = `${dtx ? dtx.slice(0, 160) + ' · ' : ''}${when} (${en ? 'Damascus time' : 'بتوقيت دمشق'}). ${en ? 'Live map of alerts across Syria — follow t.me/Red_Alert_Syria' : 'خريطة سوريا المباشرة للتنبيهات — تابعنا t.me/Red_Alert_Syria'}`;
  const og = info.a ? `${site}/og/a/${encodeURIComponent(id)}-${lang}.png` : `${site}/og/site-${lang}.png`;
  const body = `<h1>${esc(typeLabel(info.ty, lang))}${placeLine ? ` — ${esc(placeLine)}` : ''}</h1><p class="lead">${esc(when)}</p>
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

// ------------------------------------------------------------------ sitemap / robots
function sitemapXml() {
  const site = SITE();
  const now = new Date().toISOString();
  const url = (p, alt, lastmod, freq, pri) => `<url><loc>${site}${p}</loc>${alt ? `<xhtml:link rel="alternate" hreflang="${p.startsWith('/ar') ? 'ar' : 'en'}" href="${site}${p}"/><xhtml:link rel="alternate" hreflang="${alt.startsWith('/ar') ? 'ar' : 'en'}" href="${site}${alt}"/>` : ''}<lastmod>${lastmod}</lastmod><changefreq>${freq}</changefreq><priority>${pri}</priority></url>`;
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'];
  for (const l of ['ar', 'en']) out.push(url(`/${l}/`, `/${l === 'ar' ? 'en' : 'ar'}/`, now, 'always', '1.0'));
  for (const l of ['ar', 'en']) out.push(url(`/${l}/areas/`, `/${l === 'ar' ? 'en' : 'ar'}/areas/`, now, 'daily', '0.8'));
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
    try { png(res, await cached(`alert:${a.id}:${m[2]}`, 24 * 3600_000, () => renderAlertPng(a, { lang: m[2], timeoutMs: 5000 })), 3600); } catch (e) { console.error('[seo] og alert', e.message); res.redirect(302, `/og/site-${m[2]}.png`); }
  });
}
export const _test = { AREAS, BY_SLUG, areaPage, hubPage, alertSharePage, sitemapXml, robotsTxt, areaOgPng, siteOgPng, summary };
