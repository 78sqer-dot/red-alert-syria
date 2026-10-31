// Red Alert Syria — front-end application
import { createServices, GOV_C } from './services.js?v=18';
import { ALERT_TYPES, ALERT_GROUPS, TYPE_KEYS, typeOf, HAZARD_EMOJI, alertEmoji, BORDER_REGIONS, FLIGHT_DIRECTIONS, FLIGHT_AIRCRAFT } from '/shared/types.js?v=17';
import * as maplibregl from '/vendor/maplibre-gl.mjs?v=6.16.0';
import { DICT } from './i18n.js';
import { matchesGovernorate } from './alert-region-filter.js';
import { icon } from './icons.js';
import { settings } from './settings.js?v=2';
import { playRingtone, unlockAudio, RINGTONES } from './sound.js';
import { AlertMap, typeIcon, glyphDisc } from './map.js?v=26';
import { initInstall, scheduleInstallCard, showInstallCard, installMode, promptInstall, onInstallChange, stepsHtml } from './install.js';

const LANG = document.documentElement.lang === 'en' ? 'en' : 'ar';
maplibregl.setWorkerUrl(new URL('/vendor/maplibre-gl-worker.mjs', location.origin).href);
window.maplibregl = maplibregl;
const T = DICT[LANG];
const TZ = 'Asia/Damascus';
const CHANNEL = 'https://t.me/Red_Alert_Syria';
// Telegram links: on Android (Chrome, Brave, Samsung… — also in "Desktop site" mode, whose user agent
// pretends to be a PC) a plain https://t.me link only opens the t.me web page inside the browser.
// So on Android we open the Telegram app directly with an intent:// link (falls back to t.me when
// Telegram is not installed); on iPhone tg:// with a t.me fallback; on computers the normal link.
const IS_ANDROID = /Android/i.test(navigator.userAgent) || /Android/i.test(navigator.userAgentData?.platform || '')
  || (/Linux/i.test(navigator.platform || navigator.userAgent) && !/CrOS/i.test(navigator.userAgent) && (navigator.maxTouchPoints || 0) > 0);
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints || 0) > 1);
function tgDeep(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (!/^(www\.)?(t\.me|telegram\.me)$/i.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] === 'share' && parts[1] === 'url') return `msg_url?url=${encodeURIComponent(u.searchParams.get('url') || '')}&text=${encodeURIComponent(u.searchParams.get('text') || '')}`;
  if (!parts[0] || !/^[A-Za-z0-9_]{4,}$/.test(parts[0])) return null;
  let q = `resolve?domain=${parts[0]}`;
  if (u.searchParams.get('start')) q += `&start=${encodeURIComponent(u.searchParams.get('start'))}`;
  if (parts[1] && /^\d+$/.test(parts[1])) q += `&post=${parts[1]}`;
  return q;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey) return;
  const q = (IS_ANDROID || IS_IOS) && tgDeep(a.href);
  if (!q) return;
  e.preventDefault();
  if (IS_ANDROID) {
    location.href = `intent://${q}#Intent;scheme=tg;S.browser_fallback_url=${encodeURIComponent(a.href)};end`;
  } else {
    const t0 = Date.now();
    location.href = `tg://${q}`;
    setTimeout(() => { if (!document.hidden && Date.now() - t0 < 2500) location.href = a.href; }, 1200);
  }
}, true);
let BOT = 'https://t.me/Rad_Alert_Syria1_bot';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uiz = () => window.__uiz || 1;
const viewW = () => (window.__viewW ? window.__viewW() : window.innerWidth / uiz());
const isMobile = () => viewW() < 768;
// In phone "desktop site" mode the browser still evaluates CSS media queries at ~980px, so re-evaluate
// every width-based @media rule against the real (zoomed) width.
const mediaOrig = new Map();
function syncMediaRules() {
  const w = viewW();
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) {
      if (!(r instanceof CSSMediaRule)) continue;
      if (!mediaOrig.has(r)) mediaOrig.set(r, r.media.mediaText);
      const txt = mediaOrig.get(r);
      if (!/(max|min)-width/.test(txt) || /prefers|hover|pointer/.test(txt)) continue;
      if (uiz() === 1 && !window.__dsm) { if (r.media.mediaText !== txt) r.media.mediaText = txt; continue; }
      const mx = /max-width:\s*(\d+)px/.exec(txt);
      const mn = /min-width:\s*(\d+)px/.exec(txt);
      const ok = (!mx || w <= +mx[1]) && (!mn || w >= +mn[1]);
      r.media.mediaText = ok ? 'all' : 'not all';
    }
  }
}
syncMediaRules();
window.addEventListener('resize', () => { if (window.__applyUiz) window.__applyUiz(); syncMediaRules(); });

// ------------------------------------------------------------------ state
const state = {
  alerts: new Map(),
  selectedId: null,
  view: 'list',
  conn: 'connecting',
  firstSnapshot: true,
  contacts: {},
  support: null,
};
let amap = null;
let svc = null; // 💱 ⚡ 🛣 🏥 public/js/services.js

// ------------------------------------------------------------------ formatting
const fmtDay = new Intl.DateTimeFormat(LANG === 'ar' ? 'ar-SY' : 'en-GB', { day: 'numeric', month: 'long', timeZone: TZ });
const fmtTime = new Intl.DateTimeFormat(LANG === 'ar' ? 'ar-SY' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ });
const fmtStatusClock = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ });
const fmtFull = new Intl.DateTimeFormat(LANG === 'ar' ? 'ar-SY' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ });
const fmtNum = (n, d = 5) => Number(n).toFixed(d);
function ago(ts) {
  const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
  if (s < 60) return T.ago.now;
  if (s < 3600) return `${Math.floor(s / 60)}${T.ago.m}`;
  if (s < 86400) return `${Math.floor(s / 3600)}${T.ago.h}`;
  return `${Math.floor(s / 86400)}${T.ago.d}`;
}
const timeLine = (ts) => `<b>${esc(ago(ts))}</b> · ${esc(fmtDay.format(new Date(ts)))} · ${esc(fmtTime.format(new Date(ts)))}`;
const typeName = (t) => (ALERT_TYPES[t] ? ALERT_TYPES[t][LANG] : t);
const titleOf = (a) => (LANG === 'en' && a.title_en ? a.title_en : a.title);
const descOf = (a) => (LANG === 'en' && a.description_en ? a.description_en : a.description) || '';
// Published alerts show no hashtags (the owner's choice); kept as an empty list for the card layout.
function tagsOf(a) {
  if (a) return [];
  const t = typeOf(a.type);
  const p = a.place || {};
  const areas = LANG === 'ar' ? a.areas || [] : [p.name_en, p.district_en, p.governorate_en].filter(Boolean);
  const uniq = [...new Set(areas.filter(Boolean))].slice(0, 3);
  return [LANG === 'ar' ? t.tag_ar : t.tag_en, ...uniq].map((x) => '#' + String(x).replace(/\s+/g, '_'));
}
const hasLoc = (a) => !!(a.location && Number.isFinite(a.location.latitude) && Number.isFinite(a.location.longitude));
function placeName(a) {
  if (!hasLoc(a) || a.scope === 'country') return T.noLocation;
  // several areas in one alert: list them all
  if (Array.isArray(a.more) && a.more.length) return [a.place || {}, ...a.more].map((x) => onePlace(x)).join(LANG === 'ar' ? ' · ' : ' · ');
  return onePlace(a.place || {});
}
function onePlace(p) {
  const n = LANG === 'ar' ? p.name_ar : p.name_en;
  const g = LANG === 'ar' ? p.governorate_ar : p.governorate_en;
  const d = LANG === 'ar' ? p.district_ar : p.district_en;
  const key = (x) => String(x || '').normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/^ال/, '').replace(/[\s\-'’.]/g, '').toLowerCase();
  const seen = new Set(); const out = [];
  for (const x of [n, d, g]) { const k = key(x); if (!x || seen.has(k)) continue; seen.add(k); out.push(x); }
  return out.join(LANG === 'ar' ? '، ' : ', ');
}
const isLive = (a) => a.is_active && (a.expires_at == null || Date.parse(a.expires_at) > Date.now());
// share links go through /<lang>/a/<id>: chat apps get a rich preview (the alert's map card), people land on the map
const shareUrl = (a) => `${location.origin}/${LANG}/a/${encodeURIComponent(a.id)}`;
const siteUrl = () => `${location.origin}/${LANG}/`;
const fbShare = (u) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`;
const shareText = (a) => `🔴 ${titleOf(a)}${descOf(a) ? '\n' + descOf(a) : ''}`;

// ------------------------------------------------------------------ alerts selection
function visibleAlerts() {
  const s = settings.get();
  const list = [...state.alerts.values()].map((a) => (isLive(a) ? a : { ...a, is_active: false }));
  return list
    .filter((a) => matchesGovernorate(a, s.governorate, GOV_C))
    .filter((a) => s.filter.includes(a.type))
    .filter((a) => a.is_active || s.showInactive)
    .sort((x, y) => (y.is_active - x.is_active) || (isNear(y) - isNear(x)) || Date.parse(y.timestamp) - Date.parse(x.timestamp));
}

// ------------------------------------------------------------------ static text & icons
function hydrateStatic() {
  $$('[data-icon]').forEach((el) => {
    if (!el.firstChild) el.innerHTML = icon(el.dataset.icon, 18);
  });
  $$('[data-t]').forEach((el) => {
    const v = T[el.dataset.t];
    if (typeof v === 'string') el.textContent = v;
  });
  const other = LANG === 'ar' ? 'en' : 'ar';
  const lb = $('#btnLang');
  lb.querySelector('.lbl').textContent = LANG === 'ar' ? 'EN' : 'ع';
  lb.href = `/${other}/` + location.hash;
  lb.addEventListener('click', (e) => {
    e.preventDefault();
    settings.set({ language: other });
    location.href = `/${other}/` + location.hash;
  });
  $('#btnTheme').title = T.darkMode;
  $('#btnReport').title = T.reportTitle;
  $('#btnWa').title = T.waChannel; $('#btnWa').setAttribute('aria-label', T.waChannel);
  $('#btnContact').title = T.contactUs; $('#btnContact').setAttribute('aria-label', T.contactUs);
  const refreshButton = $('#btnRefresh');
  refreshButton.title = T.refreshSite;
  refreshButton.setAttribute('aria-label', T.refreshSite);
  refreshButton.addEventListener('click', () => location.reload());
  $('#listFab').title = T.listToggle;
  $('#listFab').setAttribute('aria-label', T.listToggle);
  $('#zoomIn').title = T.zoomIn;
  $('#shareSite').title = T.shareMap;
  $('#shareSite').setAttribute('aria-label', T.shareMap);
  $('#zoomOut').title = T.zoomOut;
  $('#resetView').title = T.resetView;
  $('#locateMe').title = T.myLocation;
  $('#btnSettingsM').title = T.settings;
}

// ------------------------------------------------------------------ connection status
function setConn(s) {
  state.conn = s;
  const el = $('#status');
  el.dataset.state = s;
  el.querySelector('.lbl').textContent = T.status[s];
  updateConnAge();
}
function updateConnAge() {
  const el = $('#status');
  const age = el.querySelector('.status-age');
  if (state.conn !== 'live' || !state.lastBeat) {
    age.textContent = '';
    el.title = T.status[state.conn];
    return;
  }
  const last = new Date(state.lastBeat);
  age.textContent = fmtStatusClock.format(last);
  el.title = `${T.lastConnection}: ${fmtFull.format(last)}`;
}
setInterval(updateConnAge, 15_000);

// ------------------------------------------------------------------ list & detail
function badge(a, live = false) {
  const t = typeOf(a.type);
  return `<span class="badge${live ? ' live' : ''}" style="--c:${t.color}">${a.type === 'weather' && HAZARD_EMOJI[a.hazard] ? `<span class="bemo" aria-hidden="true">${HAZARD_EMOJI[a.hazard]}</span>` : icon(typeIcon(a.type), 13)}${esc(typeName(a.type))}</span>`;
}
function cardHtml(a, fresh) {
  const t = typeOf(a.type);
  const hasLoc = a.location && Number.isFinite(a.location.latitude);
  return `<article class="card${a.is_active ? '' : ' inactive'}${a.id === state.selectedId ? ' sel' : ''}${fresh ? ' fresh' : ''}${isNear(a) ? ' near' : ''}" data-id="${esc(a.id)}" style="--c:${t.color}" tabindex="0">
    <div class="card-top">${badge(a)}<span class="time">${timeLine(a.timestamp)}</span></div>
    <h3 class="card-title">${esc(titleOf(a))}</h3>
    ${distChip(a)}
    ${descOf(a) ? `<p class="card-desc">${esc(descOf(a))}</p>` : ''}
    <div class="card-foot"><div class="tags">${tagsOf(a).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
      <div class="card-actions">${hasLoc ? `<button class="ic-btn" data-act="map" title="${esc(T.showOnMap)}">${icon('map', 16)}</button>` : ''}<button class="ic-btn" data-act="share" title="${esc(T.share)}">${icon('share', 16)}</button></div>
    </div></article>`;
}
let freshIds = new Set();
function renderList() {
  const list = visibleAlerts();
  const n = list.filter((a) => a.is_active).length;
  const s = settings.get();
  $('#sbTitle').textContent = T.alertsCount(n);
  const nearN = list.filter(isNear).length;
  $('#sbSub').textContent = (s.showInactive ? T.withInactive : T.activeOnMap) + (nearN ? (LANG === 'ar' ? ` · ${nearN} قريب منك` : ` · ${nearN} near you`) : '');
  $('#fabCount').textContent = n;
  const box = $('#alertList');
  if (!list.length) {
    const filtered = (s.filter.length < TYPE_KEYS.length || (s.governorate !== 'all' && GOV_C[s.governorate])) && state.alerts.size;
    box.innerHTML = `<div class="empty"><div class="radar"></div><h3>${esc(filtered ? T.noMatch : T.noAlerts)}</h3><p>${esc(filtered ? '' : T.noAlertsSub)}</p>${filtered ? `<button class="btn-sm" data-act="clear-filter">${esc(T.clearFilter)}</button>` : ''}</div>`;
  } else {
    let html = '';
    let sepShown = false;
    for (const a of list) {
      if (!a.is_active && !sepShown) {
        html += `<div class="list-sep">${esc(T.ended)}</div>`;
        sepShown = true;
      }
      html += cardHtml(a, freshIds.has(a.id));
    }
    box.innerHTML = html;
  }
  freshIds = new Set();
  renderFilterBadge();
}

function detailHtml(a) {
  const t = typeOf(a.type);
  const live = a.is_active;
  const hasLoc = a.location && Number.isFinite(a.location.latitude);
  const rows = [
    [T.type, `${badge(a)}`],
    [T.location, esc(placeName(a))],
    ...(BORDER_REGIONS[a.border] ? [[LANG === 'ar' ? 'الحدود' : 'Border', esc(LANG === 'ar' ? BORDER_REGIONS[a.border].ar : BORDER_REGIONS[a.border].en)]] : []),
    ...(FLIGHT_AIRCRAFT[a.aircraft] ? [[LANG === 'ar' ? 'نوع الطائرة' : 'Aircraft type', esc(LANG === 'ar' ? FLIGHT_AIRCRAFT[a.aircraft].ar : FLIGHT_AIRCRAFT[a.aircraft].en)]] : []),
    ...(FLIGHT_DIRECTIONS[a.flight_direction] ? [[LANG === 'ar' ? 'اتجاه الطيران' : 'Flight direction', esc(LANG === 'ar' ? FLIGHT_DIRECTIONS[a.flight_direction].ar : FLIGHT_DIRECTIONS[a.flight_direction].en)]] : []),
    ...(alertDist(a) ? [[LANG === 'ar' ? 'المسافة عنك' : 'Distance from you', distChip(a)]] : []),
    [T.time, esc(fmtFull.format(new Date(a.timestamp)))],
    [a.source_info?.kind === 'provider' ? T.dataProvider : T.publisher, a.source_info?.url ? `<a href="${esc(a.source_info.url)}" target="_blank" rel="noopener noreferrer">${esc(a.source_info.name)}</a>` : esc(a.source_info?.name || 'Red Alert Syria')],
    live ? [T.expires, a.expires_at ? esc(fmtTime.format(new Date(a.expires_at))) : T.noExpiry] : [T.endedAt, esc(fmtFull.format(new Date(a.ended_at || a.expires_at || a.timestamp)))],
  ];
  return `<div class="d-card" style="--c:${t.color}">
      <div class="card-top">${badge(a, live)}<span class="time">${timeLine(a.timestamp)}</span></div>
      <h3 class="card-title">${esc(titleOf(a))}</h3>
      ${descOf(a) ? `<p class="card-desc">${esc(descOf(a))}</p>` : ''}
      <span class="pill-status${live ? '' : ' off'}">${esc(live ? T.active : T.ended)}</span>
    </div>
    <div class="d-card rows">${rows.map(([k, v]) => `<div class="row"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`).join('')}</div>
    <div class="disclaimer" role="note">${esc(T.verificationNotRecorded)}</div>
    ${hasLoc ? `<div class="sec-label">${esc(T.coordinates)}</div>
    <div class="coords"><div class="coord"><div class="k">${esc(T.lat)}</div><div class="v">${fmtNum(a.location.latitude)}° N</div></div><div class="coord"><div class="k">${esc(T.lng)}</div><div class="v">${fmtNum(a.location.longitude)}° E</div></div></div>` : ''}
    <button class="btn-dark" data-act="share-toggle">${icon('share', 18)}${esc(T.shareAlert)}</button>
    <div class="share-menu" id="shareMenu" hidden>
      <a class="wa" href="https://wa.me/?text=${encodeURIComponent(shareText(a) + '\n' + shareUrl(a))}" target="_blank" rel="noopener noreferrer">${icon('whatsapp', 17)}${esc(T.whatsapp)}</a>
      <a class="tg" href="https://t.me/share/url?url=${encodeURIComponent(shareUrl(a))}&text=${encodeURIComponent(shareText(a))}" target="_blank" rel="noopener noreferrer">${icon('telegram', 17)}${esc(T.telegram)}</a>
      <a class="fb" href="${fbShare(shareUrl(a))}" target="_blank" rel="noopener noreferrer">${icon('facebook', 17)}${esc(T.facebook)}</a>
      <button data-act="copy">${icon('copy', 17)}${esc(T.copyLink)}</button>
    </div>
    <div class="btn-row">
      ${hasLoc ? `<button class="btn-ghost" data-act="fly">${icon('mapPin', 16)}${esc(T.showOnMap)}</button>` : ''}
      ${a.telegram_url ? `<a class="btn-ghost" href="${esc(a.telegram_url)}" target="_blank" rel="noopener noreferrer">${icon('telegram', 16)}${esc(T.openTelegram)}</a>` : ''}
    </div>`;
}
function renderDetail() {
  const a = state.alerts.get(state.selectedId);
  if (!a) return showList();
  const shown = isLive(a) ? a : { ...a, is_active: false };
  $('#detailBody').innerHTML = detailHtml(shown);
  const list = visibleAlerts();
  const i = list.findIndex((x) => x.id === a.id);
  $('#dPrev').disabled = i <= 0;
  $('#dNext').disabled = i < 0 || i >= list.length - 1;
}
function showList() {
  state.view = 'list';
  $('#viewList').hidden = false;
  $('#viewDetail').hidden = true;
}
function showDetail() {
  state.view = 'detail';
  $('#viewList').hidden = true;
  $('#viewDetail').hidden = false;
  renderDetail();
}

// distance from the visitor's saved location (kept on the device only). An alert is "near" when the
// visitor is within NEAR_KM of any of its circles' edge (so a wide quake/weather zone counts as near).
const NEAR_KM = 25;
function alertDist(a) {
  if (!svc?.kmTo || !svc.hasMe?.() || a.scope === 'country') return null;
  const pts = Array.isArray(a.zones) && a.zones.length ? a.zones
    : hasLoc(a) ? [{ lat: a.location.latitude, lon: a.location.longitude, km: 0 }] : [];
  let best = null;
  for (const z of pts) {
    const d = svc.kmTo(z.lat, z.lon);
    if (d == null) continue;
    const edge = Math.max(0, d - (z.km || 0));
    if (!best || edge < best.edge || (edge === best.edge && d < best.d)) best = { d, edge };
  }
  if (best) best.near = best.edge <= NEAR_KM;
  return best;
}
const isNear = (a) => !!(isLive(a) && alertDist(a)?.near);
function distChip(a) {
  const r = alertDist(a);
  if (!r) return '';
  const inside = r.edge === 0 && r.d > 0.5;
  const txt = inside ? (LANG === 'ar' ? 'أنت ضمن المنطقة' : 'You are inside the area') : svc.fmtAway(r.d);
  return `<span class="dist-chip${r.near ? ' near' : ''}">${icon('locate', 12)}${esc(txt)}${r.near && !inside ? ` · ${esc(LANG === 'ar' ? 'قريب منك' : 'near you')}` : ''}</span>`;
}
function popupHtml(a) {
  const shown = isLive(a) ? a : { ...a, is_active: false };
  return `<div class="pp" dir="${LANG === 'ar' ? 'rtl' : 'ltr'}">
    <div class="pp-top">${badge(shown)}<span class="time">${timeLine(a.timestamp)}</span></div>
    <p class="pp-title">${esc(titleOf(a))}</p>
    ${distChip(a)}
    ${Array.isArray(a.more) && a.more.length ? `<p class="pp-areas">📍 ${esc([a.place || {}, ...a.more].map((x) => (LANG === 'ar' ? x.name_ar : x.name_en || x.name_ar)).filter(Boolean).join(LANG === 'ar' ? '، ' : ', '))}</p>` : ''}
    ${descOf(a) ? `<p class="pp-desc">${esc(descOf(a))}</p>` : ''}
    <div class="pp-foot"><button class="pp-more" data-pp="more" data-id="${esc(a.id)}">${esc(T.alertDetails)}</button>
    <a class="pp-share" href="https://wa.me/?text=${encodeURIComponent(shareText(a) + '\n' + shareUrl(a))}" target="_blank" rel="noopener noreferrer">${icon('whatsapp', 15)}${esc(T.share)}</a></div></div>`;
}

// ------------------------------------------------------------------ selection
function select(id, { fromMap = false, fly = true } = {}) {
  if (id && svc?.mode?.()) svc.exitMode(); // a news item was chosen: leave the services map mode
  if (!id) {
    state.selectedId = null;
    amap && amap.select(null);
    if (history.replaceState) history.replaceState(null, '', location.pathname);
    $$('.card.sel').forEach((c) => c.classList.remove('sel'));
    if (state.view === 'detail') showList();
    return;
  }
  const a = state.alerts.get(id);
  if (!a) return;
  state.selectedId = id;
  if (history.replaceState) history.replaceState(null, '', '#' + id);
  const shown = isLive(a) ? a : { ...a, is_active: false };
  amap && amap.select(shown, { fly: fly, popup: true });
  showDetail();
  if (isMobile()) setSheetOpen(false);
  else if ($('#app').classList.contains('sb-hidden') && !fromMap) {
    toggleSidebar(true);
  }
}
function step(dir) {
  const list = visibleAlerts();
  const i = list.findIndex((x) => x.id === state.selectedId);
  const n = list[i + dir];
  if (n) select(n.id);
}

// ------------------------------------------------------------------ ticker
let tickIdx = 0;
let tickTimer = null;
function tickerItems() {
  return [...state.alerts.values()].filter(isLive).sort((x, y) => Date.parse(y.timestamp) - Date.parse(x.timestamp)).slice(0, 6);
}
function renderTicker() {
  const items = tickerItems();
  const boxes = [$('#tickerInner'), $('#mTicker')];
  for (const box of boxes) {
    if (!items.length) {
      box.innerHTML = `<div class="tick on empty">${icon('radar', 15)}<span class="t-title">${esc(T.noAlerts)}</span></div>`;
      continue;
    }
    const a = items[tickIdx % items.length];
    const olds = [...box.querySelectorAll('.tick')];
    const el = document.createElement('div');
    el.className = 'tick';
    el.dataset.id = a.id;
    el.innerHTML = `${badge(a)}<span class="t-title">${esc(titleOf(a))}</span><span class="t-time">${esc(ago(a.timestamp))}</span>`;
    box.appendChild(el);
    if (document.hidden) {
      olds.forEach((o) => o.remove());
      el.classList.add('on');
    } else {
      void el.offsetWidth; // commit start state, then slide in
      el.classList.add('on');
      olds.forEach((o, k) => {
        if (k < olds.length - 1) return o.remove();
        o.classList.remove('on');
        o.classList.add('out');
        setTimeout(() => o.remove(), 500);
      });
    }
    $$('.tick.empty', box).forEach((e) => e.remove());
  }
}
function startTicker() {
  clearInterval(tickTimer);
  renderTicker();
  tickTimer = setInterval(() => {
    tickIdx++;
    renderTicker();
  }, 5000);
}

// ------------------------------------------------------------------ filter & layers panels
function renderFilterBadge() {
  const s = settings.get();
  const selectedGov = GOV_C[s.governorate] ? s.governorate : 'all';
  const activeFilters = Number(s.filter.length < TYPE_KEYS.length) + Number(selectedGov !== 'all');
  const b = $('#filterCount');
  b.hidden = activeFilters === 0;
  b.textContent = activeFilters;
}
function renderFilterPanel() {
  const s = settings.get();
  const selectedGov = GOV_C[s.governorate] ? s.governorate : 'all';
  const counts = {};
  for (const a of state.alerts.values()) {
    if (!isLive(a) || !matchesGovernorate(a, selectedGov, GOV_C)) continue;
    counts[a.type] = (counts[a.type] || 0) + 1;
  }
  const govOptions = Object.entries(GOV_C)
    .sort(([, a], [, b]) => (LANG === 'en' ? a[3] : a[2]).localeCompare(LANG === 'en' ? b[3] : b[2], LANG))
    .map(([code, gov]) => `<option value="${esc(code)}" ${selectedGov === code ? 'selected' : ''}>${esc(LANG === 'en' ? gov[3] : gov[2])}</option>`)
    .join('');
  const clearNeeded = s.filter.length !== TYPE_KEYS.length || selectedGov !== 'all';
  let html = `<div class="dd-head"><b>${esc(T.showOnly)}</b><button class="link-btn" data-f="clear" ${clearNeeded ? '' : 'disabled'}>${esc(T.clear)}</button></div>`;
  html += `<label class="filter-governorate" for="alertGovFilter"><span>${esc(T.filterGovernorate)}</span><select id="alertGovFilter" class="sel" data-region-filter aria-label="${esc(T.filterGovernorate)}"><option value="all" ${selectedGov === 'all' ? 'selected' : ''}>${esc(T.allGovs)}</option>${govOptions}</select></label>`;
  for (const [g, def] of Object.entries(ALERT_GROUPS)) {
    const on = def.types.filter((t) => s.filter.includes(t)).length;
    html += `<div class="grp"><label class="chk grp-h"><input type="checkbox" data-g="${g}" ${on === def.types.length ? 'checked' : ''} ${on > 0 && on < def.types.length ? 'data-ind="1"' : ''}/><span class="name">${esc(def[LANG])}</span></label>`;
    for (const t of def.types) {
      html += `<label class="chk sub"><input type="checkbox" data-t="${t}" ${s.filter.includes(t) ? 'checked' : ''}/><span class="sw" style="--c:${ALERT_TYPES[t].color}"></span><span class="name">${esc(typeName(t))}</span><span class="cnt">${counts[t] || 0}</span></label>`;
    }
    html += '</div>';
  }
  const p = $('#filterPanel');
  p.innerHTML = html;
  $$('input[data-ind]', p).forEach((i) => (i.indeterminate = true));
}
function renderLayersPanel() {
  const s = settings.get();
  const tg = (key, label, sub) => `<label class="tgl"><span class="txt">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><input class="switch" type="checkbox" data-l="${key}" ${s[key] ? 'checked' : ''}/></label>`;
  $('#layersPanel').innerHTML = `<div class="dd-sec">${esc(T.mapStyle)}</div>
    <label class="radio"><input type="radio" name="ml" value="standard" ${s.mapLayer === 'standard' ? 'checked' : ''}/><span class="thumb std"></span>${esc(T.standard)}</label>
    <label class="radio"><input type="radio" name="ml" value="satellite" ${s.mapLayer === 'satellite' ? 'checked' : ''}/><span class="thumb sat"></span>${esc(T.satellite)}</label>
    <div class="grp" style="margin-top:6px">${tg('map3d', T.terrain3d)}</div>
    <div class="dd-sec">${esc(T.extraLayers)}</div>
    ${tg('showGov', T.govBorders)}${tg('focusSyria', T.focusSyria)}${svc ? svc.layersHtml() : ''}`;
}
function closeDropdowns(except) {
  for (const [btn, panel] of [['#btnFilter', '#filterPanel'], ['#btnLayers', '#layersPanel']]) {
    if (panel === except) continue;
    $(panel).hidden = true;
    $(btn).setAttribute('aria-expanded', 'false');
  }
  if (!except) { const b = document.getElementById('ddBack'); if (b) b.hidden = true; }
}
// phones: the filter / layers panels open as a bottom sheet on top of everything (list sheet, pills),
// scrollable, full width; on wider screens they stay a dropdown under their button
const PHONE = { get matches() { return isMobile(); } };
const ddHome = new Map();
function placeDropdown(p, open) {
  if (!ddHome.has(p)) ddHome.set(p, p.parentElement);
  const sheet = open && PHONE.matches;
  let back = document.getElementById('ddBack');
  if (!back) {
    back = document.createElement('div'); back.id = 'ddBack'; back.className = 'sheet-backdrop dd-back'; back.hidden = true;
    back.addEventListener('click', (e) => { e.stopPropagation(); closeDropdowns(); });
    document.body.append(back);
  }
  if (sheet && p.parentElement !== document.body) document.body.append(p);
  if (!sheet && p.parentElement !== ddHome.get(p)) ddHome.get(p).append(p);
  p.classList.toggle('dd-sheet', sheet);
  back.hidden = !sheet;
  if (sheet) p.scrollTop = 0;
}
function toggleDropdown(btnSel, panelSel, render) {
  const p = $(panelSel);
  const open = p.hidden;
  closeDropdowns(panelSel);
  if (open) render();
  placeDropdown(p, open);
  p.hidden = !open;
  $(btnSel).setAttribute('aria-expanded', String(open));
}

// ------------------------------------------------------------------ settings drawer
// ------------------------------------------------------------------ contact links (set by the owner in the bot)
function contactRows() {
  const c = state.contacts || {};
  const num = c.phone ? `<span dir="ltr" class="mono">${esc(c.phone)}</span>` : '';
  const rows = [];
  if (c.wa) rows.push({ href: c.wa, cls: 'wa', ic: 'whatsapp', t: T.waChannel, d: esc(T.waChannelSub) });
  if (c.waChat) rows.push({ href: c.waChat, cls: 'wa', ic: 'whatsapp', t: T.waChat, d: num });
  if (c.tel) rows.push({ href: c.tel, cls: 'tel', ic: 'phone', t: T.callUs, d: num, self: true });
  if (c.tg) rows.push({ href: c.tg, cls: 'tgs', ic: 'headset', t: T.tgSupport, d: `<span dir="ltr">@${esc(c.tg.split('/').pop())}</span>` });
  return rows;
}
function contactListHtml() {
  return `<div class="ct-list">${contactRows().map((r) => `<a class="ct-row ${r.cls}" href="${esc(r.href)}" ${r.self ? '' : 'target="_blank" rel="noopener noreferrer"'}><span class="ct-ic">${icon(r.ic, 18)}</span><span class="ct-txt"><b>${esc(r.t)}</b><small>${r.d}</small></span></a>`).join('')}</div>`;
}
function showContactModal() {
  if (!contactRows().length) return;
  openModal(`<div class="page-modal ct-modal"><div class="eyebrow"><span class="line"></span>${esc(T.siteName)}</div><h2>${esc(T.contactUs)}</h2><p>${esc(T.contactSub)}</p>${contactListHtml()}<button class="btn-text" data-m="close">${esc(T.close)}</button></div>`);
}
function showSupportModal() {
  const s = state.support;
  if (!s?.enabled) return;
  const names = s.displayNames.length ? `<div class="support-names"><b>${esc(T.supportNames)}</b><div>${s.displayNames.map((name) => `<span>${esc(name)}</span>`).join('')}</div></div>` : '';
  openModal(`<div class="page-modal support-modal"><div class="eyebrow"><span class="line"></span>${icon('heart', 16)}${esc(T.supportTitle)}</div><p>${esc(T.supportTransfer)}</p><div class="support-wallet"><small>${esc(T.supportWallet)}</small><b>${esc(s.walletName)}</b><code dir="ltr">${esc(s.walletPhone)}</code></div><button class="btn-red" data-m="copySupport">${icon('copy', 17)}${esc(T.supportCopy)}</button><p class="fine">${esc(T.supportDisclosure)}</p>${names}<button class="btn-text" data-m="close">${esc(T.close)}</button></div>`);
}
function renderContacts() {
  const c = state.contacts || {};
  const wa = $('#btnWa');
  if (wa) { wa.hidden = !c.wa; if (c.wa) wa.href = c.wa; }
  const ct = $('#btnContact');
  if (ct) ct.hidden = !(c.waChat || c.tel || c.tg);
  if ($('#drawer')?.classList.contains('open')) renderDrawer();
  if ($('#aboutSheet')?.classList.contains('open')) renderAbout();
}
function setContacts(c) {
  state.contacts = c && typeof c === 'object' ? c : {};
  renderContacts();
}
function setSupport(s) {
  const phone = String(s?.walletPhone || '');
  state.support = s?.enabled === true && /^(?:\+[1-9]\d{7,14}|\d{6,18})$/.test(phone) && String(s.walletName || '').trim()
    ? { enabled: true, walletName: String(s.walletName).slice(0, 60), walletPhone: phone, displayNames: Array.isArray(s.displayNames) ? s.displayNames.filter((x) => typeof x === 'string').slice(0, 30) : [] }
    : null;
  if ($('#aboutSheet')?.classList.contains('open')) renderAbout();
}
function renderDrawer() {
  const s = settings.get();
  const n = s.notifications;
  const dark = document.documentElement.classList.contains('dark');
  const tg = (attr, on, label, sub) => `<label class="tgl"><span class="txt">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><input class="switch" type="checkbox" ${attr} ${on ? 'checked' : ''}/></label>`;
  let k = 0;
  const num = () => String(++k).padStart(2, '0');
  const im = installMode();
  const instSec = im ? `<section class="s-card" id="sInstall"><div class="s-head"><span class="s-num">${num()}</span><div><h3>${esc(T.instTitle)}</h3><p>${esc(im === 'ios' ? T.instIosIntro : T.instSub)}</p></div></div>
    ${im === 'prompt' ? `<button class="btn-red inst-go" data-s="install">${icon('download', 18)}${esc(T.instBtn)}</button>` : stepsHtml(im, { T, icon, esc })}
  </section>` : '';
  const cts = contactRows().length ? `<span class="field-label">${esc(T.contactUs)}</span>${contactListHtml()}` : '';
  $('#drawerBody').innerHTML = `
  <section class="s-card"><div class="s-head"><span class="s-num">${num()}</span><div><h3>${esc(T.appearance)}</h3><p>${esc(T.appearanceSub)}</p></div></div>
    <span class="field-label">${esc(T.language)}</span>
    <div class="seg"><button data-s="lang" data-v="ar" class="${LANG === 'ar' ? 'on' : ''}">العربية</button><button data-s="lang" data-v="en" class="${LANG === 'en' ? 'on' : ''}">English</button></div>
    <span class="field-label">${esc(T.theme)}</span>
    <div class="seg"><button data-s="theme" data-v="light" class="${!dark ? 'on' : ''}">${icon('sun', 16)}${esc(T.lightMode)}</button><button data-s="theme" data-v="dark" class="${dark ? 'on' : ''}">${icon('moon', 16)}${esc(T.darkMode)}</button></div>
    <div style="margin-top:10px">${tg('data-s="showInactive"', s.showInactive, T.showInactive, T.showInactiveSub)}</div>
  </section>
  <section class="s-card"><div class="s-head"><span class="s-num">${num()}</span><div><h3>${esc(T.notifications)}</h3><p>${esc(T.notificationsSub)}</p></div></div>
    ${tg('data-s="notif"', n.enabled, T.enableNotifications, T.enableNotificationsSub)}
    ${tg('data-s="vibration"', n.vibration, T.vibration, T.vibrationSub)}
    <span class="field-label">${esc(T.alertTypes)} — <span style="font-weight:500">${esc(T.alertTypesSub)}</span></span>
    <div class="types-grid">${TYPE_KEYS.map((t) => `<label class="chk"><input type="checkbox" data-nt="${t}" ${n.types.includes(t) ? 'checked' : ''}/><span class="sw" style="--c:${ALERT_TYPES[t].color}"></span><span class="name">${esc(typeName(t))}</span></label>`).join('')}</div>
  </section>
  ${instSec}
  <section class="s-card"><div class="s-head"><span class="s-num">${num()}</span><div><h3>${esc(T.sound)}</h3><p>${esc(T.soundSub)}</p></div></div>
    ${tg('data-s="sound"', n.sound, T.playSound)}
    <span class="field-label">${esc(T.ringtone)}</span>
    <div class="sel-wrap"><select class="sel" data-s="ringtone">${RINGTONES.map((r) => `<option value="${r}" ${n.ringtone === r ? 'selected' : ''}>${esc(T.ringtones[r])}</option>`).join('')}</select>
    <button class="btn-sm" data-s="test">${icon('play', 14)}${esc(T.test)}</button></div>
    <span class="field-label">${esc(T.volume)} <span class="mono">${Math.round(n.volume * 100)}%</span></span>
    <input class="range" type="range" min="0" max="1" step="0.05" value="${n.volume}" data-s="volume"/>
  </section>
  <section class="s-card"><div class="s-head"><span class="s-num">${num()}</span><div><h3>${esc(T.tour)}</h3><p>${esc(T.tourSub)}</p></div></div>
    <button class="btn-sm" data-s="tour">${icon('route', 15)}${esc(T.startTour)}</button>
  </section>
  <section class="s-card about-us"><div class="s-head"><span class="s-num">${num()}</span><div><h3>${esc(T.about)}</h3><p>${esc(T.aboutSub)}</p></div></div>
    <p>${esc(T.aboutText)}</p>
    <div class="about-links"><a class="btn-sm" href="${CHANNEL}" target="_blank" rel="noopener noreferrer">${icon('telegram', 15)}${esc(T.followTelegram)}</a><a class="btn-sm" href="${BOT}?start=report" target="_blank" rel="noopener noreferrer">${icon('alertO', 15)}${esc(T.reportTitle)}</a><a class="btn-sm" href="/${LANG}/areas/">${icon('mapPin', 15)}${esc(T.byArea)}</a></div>
    ${cts}
  </section>
  <div class="drawer-foot"><button class="link-btn" data-s="terms" style="color:inherit;text-decoration:underline">${esc(T.terms)}</button> · <button class="link-btn" data-s="privacy" style="color:inherit;text-decoration:underline">${esc(T.privacy)}</button><br/>© ${new Date().getFullYear()} Red Alert Syria — ${esc(T.madeFor)}</div>`;
}
function openDrawer() {
  renderDrawer();
  $('#drawerBackdrop').hidden = false;
  const d = $('#drawer');
  d.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => d.classList.add('open'));
}
function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#drawerBackdrop').hidden = true;
}

// ------------------------------------------------------------------ about sheet & modals
function renderAbout() {
  const legend = TYPE_KEYS.map((t) => `<div class="lg-item"><span class="lg-dot">${glyphDisc(t, 26, 14)}</span>${esc(typeName(t))}</div>`).join('');
  $('#aboutBody').innerHTML = `<div class="sheet-grab"></div>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-top:10px">
      <div><div class="eyebrow"><span class="line"></span>${esc(T.siteName)}</div><h2>${esc(T.aboutTitle)}</h2></div>
      <button class="sb-x lg" data-a="close">${icon('x', 18)}</button></div>
    <p>${esc(T.aboutText)}</p>
    <div class="sec-label">${esc(T.verificationPolicyTitle)}</div>
    <div class="disclaimer" role="note">${esc(T.verificationPolicy)}</div>
    <div class="sec-label">${esc(T.legend)}</div>
    <div class="legend">${legend}</div>
    <div class="disclaimer">${esc(T.disclaimer)}</div>
    ${state.support ? `<section class="support-card"><div class="support-card-head"><span class="support-icon">${icon('heart', 18)}</span><div><h3>${esc(T.supportTitle)}</h3><p>${esc(T.supportTransfer)}</p></div></div><button class="btn-red" data-a="support">${icon('heart', 16)}${esc(T.supportButton)}</button></section>` : ''}
    <div class="about-links" style="margin-bottom:14px"><a class="btn-sm" href="${CHANNEL}" target="_blank" rel="noopener noreferrer">${icon('telegram', 15)}${esc(T.followTelegram)}</a><a class="btn-sm" href="${BOT}?start=report" target="_blank" rel="noopener noreferrer">${icon('alertO', 15)}${esc(T.reportTitle)}</a><a class="btn-sm" href="/${LANG}/areas/">${icon('mapPin', 15)}${esc(T.byArea)}</a><button class="btn-sm" data-a="terms">${esc(T.terms)}</button><button class="btn-sm" data-a="privacy">${esc(T.privacy)}</button></div>
    ${contactRows().length ? `<div class="sec-label">${esc(T.contactUs)}</div>${contactListHtml()}` : ''}
    <div class="sec-label">${esc(T.sources)}</div>
    <p class="sources"><a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> · <a href="https://maplibre.org" target="_blank" rel="noopener">MapLibre</a> · <a href="https://www.geonames.org" target="_blank" rel="noopener">GeoNames (CC BY 4.0)</a> · <a href="https://www.geoboundaries.org" target="_blank" rel="noopener">geoBoundaries</a> · Esri World Imagery · Mapzen Terrain (AWS Open Data) · Tabler Icons</p>`;
}
function openAbout() {
  renderAbout();
  $('#aboutBackdrop').hidden = false;
  const s = $('#aboutSheet');
  s.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => s.classList.add('open'));
}
function closeAbout() {
  $('#aboutSheet').classList.remove('open');
  $('#aboutSheet').setAttribute('aria-hidden', 'true');
  $('#aboutBackdrop').hidden = true;
}
function openModal(html, onClose) {
  const b = $('#modalBackdrop');
  $('#modal').innerHTML = html;
  b.hidden = false;
  b._onClose = onClose;
}
function closeModal() {
  const b = $('#modalBackdrop');
  b.hidden = true;
  const fn = b._onClose;
  b._onClose = null;
  if (fn) fn();
}
function pageModal(title, text) {
  openModal(`<div class="page-modal"><h2>${esc(title)}</h2><p>${esc(text)}</p><p style="font-size:12.5px">${esc(T.disclaimer)}</p><button class="btn-red" data-m="close">${esc(T.close)}</button></div>`);
}
function showWelcome() {
  const f = (ic, t, d) => `<div class="feat"><span class="fi">${icon(ic, 20)}</span><div><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`;
  openModal(
    `<div class="welcome-hero"><img src="/img/logo-wordmark.svg" alt="Red Alert Syria" width="164" height="66"/><h2>${esc(T.siteName)}</h2><p>${esc(T.welcomeSub)} · ${esc(T.welcomeTag)}</p></div>
    <div class="welcome-body">${f('map', T.f1t, T.f1d)}${f('bell', T.f2t, T.f2d)}${f('telegram', T.f3t, T.f3d)}
      <button class="btn-red" data-m="start">${icon('bell', 18)}${esc(T.start)}</button>
      <button class="btn-text" data-m="skip">${esc(T.continueWithout)}</button>
      <p class="fine">${esc(T.disclaimer)}</p></div>`,
    () => {
      settings.set({ hasSeenWelcome: true });
      if (!settings.get().hasSeenTour) setTimeout(startTour, 400);
    },
  );
}

// ------------------------------------------------------------------ notifications
async function enableNotifications() {
  unlockAudio();
  settings.set({ notifications: { enabled: true } });
  if ('Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
  }
  if ('Notification' in window && Notification.permission === 'denied') toast(T.permissionDenied);
  else toast(T.notifEnabled);
}
function notify(a) {
  const s = settings.get();
  const n = s.notifications;
  const t = typeOf(a.type);
  if (s.filter.includes(a.type)) alertToast(a);
  if (a.type === 'breaking') showBreaking(a);
  if (!n.enabled || !n.types.includes(a.type)) return;
  if (n.sound) playRingtone(n.ringtone, n.volume);
  if (n.vibration && navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 500]);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const notif = new Notification(`${alertEmoji(a)} ${typeName(a.type)} — ${T.siteName}`, { body: titleOf(a) + (descOf(a) ? '\n' + descOf(a) : ''), icon: '/img/icon-192.png', badge: '/img/icon-192.png', tag: a.id, lang: LANG, dir: LANG === 'ar' ? 'rtl' : 'ltr' });
      notif.onclick = () => {
        window.focus();
        select(a.id);
        notif.close();
      };
    } catch { /* ignore */ }
  }
}
function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast simple';
  el.textContent = text;
  $('#toasts').prepend(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 320);
  }, 2600);
}
function alertToast(a) {
  const t = typeOf(a.type);
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.setProperty('--c', t.color);
  el.innerHTML = `<span class="ti">${glyphDisc(a.type, 34, 17)}</span><span class="tt"><small>${esc(T.newAlert)} · ${esc(typeName(a.type))}</small><b>${esc(titleOf(a))}</b></span>`;
  el.addEventListener('click', () => {
    select(a.id);
    el.remove();
  });
  const box = $('#toasts');
  box.prepend(el);
  while (box.children.length > 3) box.lastChild.remove();
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 320);
  }, 9000);
}
let breakingTimer = null;
function showBreaking(a) {
  const b = $('#breaking');
  $('#breakingText').textContent = descOf(a) || titleOf(a);
  $('#breakingText').dataset.id = a.id;
  b.hidden = false;
  b.style.animation = 'none';
  void b.offsetWidth;
  b.style.animation = '';
  clearTimeout(breakingTimer);
  breakingTimer = setTimeout(() => (b.hidden = true), 60_000);
}

// ------------------------------------------------------------------ tour
const TOUR_TARGETS = [null, '#status', '#btnFilter', '#btnLayers', '#sidebar', () => (isMobile() ? '#btnSettingsM' : '#btnSettings')];
let tourStep = 0;
function startTour() {
  closeDrawer();
  closeAbout();
  closeDropdowns();
  tourStep = 0;
  $('#tour').hidden = false;
  renderTour();
}
function endTour() {
  $('#tour').hidden = true;
  settings.set({ hasSeenTour: true });
  scheduleInstallCard(6000);
}
function renderTour() {
  const steps = T.tourSteps;
  const s = steps[tourStep];
  const card = $('#tourCard');
  const spot = $('#tourSpot');
  const last = tourStep === steps.length - 1;
  card.innerHTML = `<h4>${esc(s.t)}</h4><p>${esc(s.d)}</p><div class="tour-foot"><span class="tour-count">${tourStep + 1} / ${steps.length}</span><div class="tour-btns">${tourStep === 0 ? `<button data-tr="skip">${esc(T.skip)}</button>` : `<button data-tr="prev">${esc(T.prev)}</button>`}<button class="primary" data-tr="${last ? 'done' : 'next'}">${esc(last ? T.done : T.next)}</button></div></div>`;
  let sel = TOUR_TARGETS[tourStep];
  if (typeof sel === 'function') sel = sel();
  const target = sel && $(sel);
  const vw = viewW();
  const vh = window.innerHeight;
  const cw = Math.min(340, vw - 24);
  const ch = card.offsetHeight || 170;
  if (!target) {
    spot.className = 'tour-spot center';
    spot.style.cssText = '';
    card.style.left = `${(vw - cw) / 2}px`;
    card.style.top = `${(vh - ch) / 2}px`;
    return;
  }
  let r = target.getBoundingClientRect();
  if (sel === '#sidebar' && isMobile()) r = { left: r.left, top: r.top, width: r.width, height: Math.min(r.height, vh - r.top), right: r.right, bottom: Math.min(r.bottom, vh) };
  const pad = 6;
  spot.className = 'tour-spot';
  spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
  let top;
  let left;
  if (r.height > vh * 0.5) {
    // tall target (sidebar): put the card beside it
    top = Math.max(12, Math.min(vh - ch - 12, r.top + 40));
    left = r.left > vw / 2 ? r.left - cw - 16 : r.right + 16;
    if (left < 12 || left + cw > vw - 12) {
      left = (vw - cw) / 2;
      top = Math.max(12, r.top - ch - 16);
    }
  } else {
    top = r.bottom + 14;
    if (top + ch > vh - 12) top = r.top - ch - 14;
    left = r.left + r.width / 2 - cw / 2;
  }
  card.style.left = `${Math.max(12, Math.min(vw - cw - 12, left))}px`;
  card.style.top = `${Math.max(12, top)}px`;
}

// ------------------------------------------------------------------ sidebar / sheet
function toggleSidebar(show) {
  const app = $('#app');
  const hidden = show === undefined ? !app.classList.contains('sb-hidden') : !show;
  app.classList.toggle('sb-hidden', hidden);
  $('#listFab').hidden = !hidden;
  settings.set({ sidebarHidden: hidden });
  setTimeout(() => amap && amap.resize(), 320);
}
function placeListFab() {
  const fab = $('#listFab');
  const app = $('#app');
  if (isMobile()) {
    const topbar = $('#topbar');
    const rtl = getComputedStyle(topbar).direction === 'rtl';
    const atLeft = rtl ? topbar.lastElementChild === fab : topbar.firstElementChild === fab;
    if (fab.parentElement !== topbar || !atLeft) {
      if (rtl) topbar.append(fab);
      else topbar.prepend(fab);
    }
    fab.hidden = false;
    const open = app.classList.contains('sheet-open');
    $('#listBackdrop').hidden = !open;
    $('#sidebar').setAttribute('aria-hidden', String(!open));
    $('#sidebar').inert = !open;
  } else {
    const mapWrap = $('#mapWrap');
    if (fab.parentElement !== mapWrap) mapWrap.append(fab);
    fab.hidden = !app.classList.contains('sb-hidden');
    if (app.classList.contains('sheet-open')) setSheetOpen(false);
  }
}
function setSheetOpen(open) {
  $('#app').classList.toggle('sheet-open', open);
  $('#listFab').setAttribute('aria-expanded', String(open));
  $('#listBackdrop').hidden = !open;
  if (isMobile()) {
    $('#sidebar').setAttribute('aria-hidden', String(!open));
    $('#sidebar').inert = !open;
  }
  if (open) amap && amap.closePopup();
}
function setupSheet() {
  const app = $('#app');
  const toggle = () => setSheetOpen(!app.classList.contains('sheet-open'));
  $('#listBackdrop').addEventListener('click', () => setSheetOpen(false));
  $('#listFab').addEventListener('click', () => {
    if (isMobile()) toggle();
    else toggleSidebar(true);
  });
}

// ------------------------------------------------------------------ share
async function share(a) {
  const url = shareUrl(a);
  if (navigator.share) {
    try {
      await navigator.share({ title: titleOf(a), text: shareText(a), url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  copy(url);
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(T.copied);
}

// ------------------------------------------------------------------ events
function bindEvents() {
  $('#btnSettings').addEventListener('click', openDrawer);
  $('#btnSettingsM').addEventListener('click', openDrawer);
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerBackdrop').addEventListener('click', closeDrawer);
  $('#aboutPill').addEventListener('click', openAbout);
  $('#aboutBackdrop').addEventListener('click', closeAbout);
  $('#btnTheme').addEventListener('click', () => setTheme(!document.documentElement.classList.contains('dark')));
  $('#btnFilter').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown('#btnFilter', '#filterPanel', renderFilterPanel);
  });
  $('#btnLayers').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown('#btnLayers', '#layersPanel', renderLayersPanel);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dd, .dd-panel')) closeDropdowns();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#tour').hidden) return endTour();
    if (!$('#modalBackdrop').hidden) return closeModal();
    if ($('#drawer').classList.contains('open')) return closeDrawer();
    if (isMobile() && $('#app').classList.contains('sheet-open')) return setSheetOpen(false);
    if ($('#aboutSheet').classList.contains('open')) return closeAbout();
    if (svc && svc.isOpen()) return svc.close();
    closeDropdowns();
    if (state.selectedId) select(null);
  });

  // filter
  $('#filterPanel').addEventListener('change', (e) => {
    const s = settings.get();
    const i = e.target;
    if (i.dataset.regionFilter !== undefined) {
      settings.set({ governorate: i.value });
      renderFilterPanel();
      refresh();
      return;
    }
    let f = new Set(s.filter);
    if (i.dataset.g) {
      const types = ALERT_GROUPS[i.dataset.g].types;
      types.forEach((t) => (i.checked ? f.add(t) : f.delete(t)));
    } else if (i.dataset.t) {
      i.checked ? f.add(i.dataset.t) : f.delete(i.dataset.t);
    }
    settings.set({ filter: TYPE_KEYS.filter((t) => f.has(t)) });
    renderFilterPanel();
    refresh();
  });
  $('#filterPanel').addEventListener('click', (e) => {
    if (e.target.closest('[data-f="clear"]')) {
      settings.set({ filter: [...TYPE_KEYS], governorate: 'all' });
      renderFilterPanel();
      refresh();
    }
  });
  // layers
  $('#layersPanel').addEventListener('change', (e) => {
    const i = e.target;
    if (i.name === 'ml') {
      settings.set({ mapLayer: i.value });
      amap && amap.setOptions({ layer: i.value });
    } else if (i.dataset.sl) {
      svc && svc.toggleLayer(i.dataset.sl, i.checked);
    } else if (i.dataset.l) {
      settings.set({ [i.dataset.l]: i.checked });
      amap && amap.setOptions({ [i.dataset.l]: i.checked });
    }
  });

  // list
  $('#alertList').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="clear-filter"]')) {
      settings.set({ filter: [...TYPE_KEYS], governorate: 'all' });
      return refresh();
    }
    const card = e.target.closest('.card');
    if (!card) return;
    const a = state.alerts.get(card.dataset.id);
    if (!a) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'share') return share(a);
    if (act === 'map') {
      if (isMobile()) setSheetOpen(false);
      state.selectedId = a.id;
      amap && amap.select(isLive(a) ? a : { ...a, is_active: false });
      $$('.card.sel').forEach((c) => c.classList.remove('sel'));
      card.classList.add('sel');
      return;
    }
    select(a.id);
  });
  $('#alertList').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('card')) select(e.target.dataset.id);
  });
  $('#sbClose').addEventListener('click', (e) => {
    e.stopPropagation();
    if (isMobile()) setSheetOpen(false);
    else toggleSidebar(false);
  });
  $('#dClose').addEventListener('click', () => select(null));
  $('#dPrev').addEventListener('click', () => step(-1));
  $('#dNext').addEventListener('click', () => step(1));
  $('#detailBody').addEventListener('click', (e) => {
    const a = state.alerts.get(state.selectedId);
    if (!a) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'share-toggle') {
      if (navigator.share && isMobile()) return share(a);
      $('#shareMenu').hidden = !$('#shareMenu').hidden;
    } else if (act === 'copy') copy(shareUrl(a));
    else if (act === 'fly') {
      if (isMobile()) setSheetOpen(false);
      amap && amap.select(isLive(a) ? a : { ...a, is_active: false });
    }
  });
  // popups (rendered inside the map container)
  $('#map').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pp="more"]');
    if (b) {
      select(b.dataset.id, { fly: false });
      if (isMobile()) {
        setSheetOpen(true);
      }
    }
  });
  // ticker
  const tickClick = (e) => {
    const t = e.target.closest('.tick[data-id]');
    if (t) select(t.dataset.id);
  };
  $('#ticker').addEventListener('click', tickClick);
  $('#mTicker').addEventListener('click', tickClick);
  $('#breakingText').addEventListener('click', (e) => e.currentTarget.dataset.id && select(e.currentTarget.dataset.id));
  $('#breakingClose').addEventListener('click', () => ($('#breaking').hidden = true));

  // map controls
  // share the whole map (native share sheet on phones, small panel elsewhere)
  $('#shareSite').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (navigator.share && isMobile()) {
      try { await navigator.share({ title: T.siteName, text: T.shareMapText, url: siteUrl() }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    const box = $('#siteShare');
    if (!box.hidden) { box.hidden = true; return; }
    const u = siteUrl();
    box.innerHTML = `<div class="ss-head"><b>${esc(T.shareMap)}</b><span>${esc(T.shareMapSub)}</span></div>
      <div class="share-menu">
        <a class="wa" href="https://wa.me/?text=${encodeURIComponent(T.shareMapText + '\n' + u)}" target="_blank" rel="noopener noreferrer">${icon('whatsapp', 17)}${esc(T.whatsapp)}</a>
        <a class="tg" href="https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(T.shareMapText)}" target="_blank" rel="noopener noreferrer">${icon('telegram', 17)}${esc(T.telegram)}</a>
        <a class="fb" href="${fbShare(u)}" target="_blank" rel="noopener noreferrer">${icon('facebook', 17)}${esc(T.facebook)}</a>
        <button data-act="copy-site">${icon('copy', 17)}${esc(T.copyLink)}</button>
      </div>`;
    box.hidden = false;
  });
  $('#siteShare').addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('[data-act="copy-site"]')) copy(siteUrl());
    else if (e.target.closest('a')) setTimeout(() => { $('#siteShare').hidden = true; }, 300);
  });
  document.addEventListener('click', () => { const b = $('#siteShare'); if (b && !b.hidden) b.hidden = true; });
  $('#zoomIn').addEventListener('click', () => amap && amap.zoomIn());
  $('#zoomOut').addEventListener('click', () => amap && amap.zoomOut());
  $('#resetView').addEventListener('click', () => amap && amap.fitSyria());
  $('#btnSvc').addEventListener('click', (e) => { e.stopPropagation(); closeDropdowns(); svc && svc.open(); });
  $('#locateMe').addEventListener('click', () => {
    if (svc) return svc.locate();
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => amap && amap.showMe(p.coords.longitude, p.coords.latitude), () => {}, { enableHighAccuracy: true, timeout: 10000 });
  });

  // drawer
  const db = $('#drawerBody');
  db.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
    const k = b.dataset.s;
    if (k === 'lang' && b.dataset.v !== LANG) {
      settings.set({ language: b.dataset.v });
      location.href = `/${b.dataset.v}/` + location.hash;
    } else if (k === 'theme') {
      setTheme(b.dataset.v === 'dark');
      renderDrawer();
    } else if (k === 'test') {
      unlockAudio();
      const n = settings.get().notifications;
      playRingtone(n.ringtone, n.volume);
    } else if (k === 'tour') startTour();
    else if (k === 'install') {
      promptInstall().then((r) => { if (r === 'accepted') toast(T.instDone); renderDrawer(); });
    } else if (k === 'terms') pageModal(T.terms, T.termsText);
    else if (k === 'privacy') pageModal(T.privacy, T.privacyText);
  });
  db.addEventListener('change', async (e) => {
    const i = e.target;
    const k = i.dataset.s;
    if (k === 'notif') {
      if (i.checked) await enableNotifications();
      else settings.set({ notifications: { enabled: false } });
    } else if (k === 'sound') settings.set({ notifications: { sound: i.checked } });
    else if (k === 'vibration') settings.set({ notifications: { vibration: i.checked } });
    else if (k === 'ringtone') {
      settings.set({ notifications: { ringtone: i.value } });
      unlockAudio();
      playRingtone(i.value, settings.get().notifications.volume);
    } else if (k === 'volume') {
      settings.set({ notifications: { volume: Number(i.value) } });
      renderDrawer();
    } else if (k === 'showInactive') {
      settings.set({ showInactive: i.checked });
      refresh();
    } else if (i.dataset.nt) {
      const set = new Set(settings.get().notifications.types);
      i.checked ? set.add(i.dataset.nt) : set.delete(i.dataset.nt);
      settings.set({ notifications: { types: TYPE_KEYS.filter((t) => set.has(t)) } });
    }
  });
  db.addEventListener('input', (e) => {
    if (e.target.dataset.s === 'volume') {
      const lbl = e.target.previousElementSibling?.querySelector('.mono');
      if (lbl) lbl.textContent = Math.round(e.target.value * 100) + '%';
    }
  });

  $('#btnContact').addEventListener('click', showContactModal);
  // about sheet
  $('#aboutBody').addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') closeAbout();
    else if (a === 'support') showSupportModal();
    else if (a === 'terms') pageModal(T.terms, T.termsText);
    else if (a === 'privacy') pageModal(T.privacy, T.privacyText);
  });
  // modal
  $('#modalBackdrop').addEventListener('click', async (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m === 'start') {
      await enableNotifications();
      closeModal();
    } else if (m === 'copySupport') {
      const phone = state.support?.walletPhone;
      if (!phone) return;
      try { await navigator.clipboard.writeText(phone); toast(T.supportCopied); }
      catch { toast(T.supportCopyFail); }
    } else if (m === 'skip' || m === 'close') closeModal();
  });
  // tour
  $('#tourCard').addEventListener('click', (e) => {
    const a = e.target.closest('[data-tr]')?.dataset.tr;
    if (a === 'next') tourStep++;
    else if (a === 'prev') tourStep--;
    else if (a === 'skip' || a === 'done') return endTour();
    else return;
    renderTour();
  });
  window.addEventListener('resize', () => {
    placeListFab();
    if (!$('#tour').hidden) renderTour();
  });
  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (id && id !== state.selectedId && state.alerts.has(id)) select(id);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
    if (typeof settings.get().darkMode !== 'boolean') applyTheme(e.matches);
  });
}

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#131318' : '#ff3b4e';
  $('#btnTheme').title = dark ? T.lightMode : T.darkMode;
  amap && amap.setOptions({ dark });
}
function setTheme(dark) {
  settings.set({ darkMode: dark });
  applyTheme(dark);
}

// ------------------------------------------------------------------ data
function refresh() {
  renderList();
  if (state.view === 'detail') renderDetail();
  amap && amap.setAlerts(visibleAlerts(), state.selectedId);
}
function upsert(a, isNew) {
  state.alerts.set(a.id, a);
  if (isNew) freshIds.add(a.id);
}
let pollTimer = null;
function setHistoryHours(h) {
  h = Number(h);
  if (!Number.isFinite(h) || h <= 0) return;
  for (const k of ['withInactive', 'showInactiveSub']) if (typeof T[k] === 'string') T[k] = T[k].replace(/\d+/, String(h));
}
async function poll() {
  try {
    const r = await fetch('/api/alerts?include=inactive', { cache: 'no-store' });
    const j = await r.json();
    state.lastBeat = Date.now();
    setHistoryHours(j.history_hours);
    setSupport(j.support);
    const before = new Set(state.alerts.keys());
    state.alerts = new Map();
    for (const a of j.alerts) state.alerts.set(a.id, a);
    if (!state.firstSnapshot) for (const a of j.alerts) if (!before.has(a.id) && a.is_active) { freshIds.add(a.id); notify(a); }
    state.firstSnapshot = false;
    setConn('live');
    refresh();
  } catch {
    setConn('offline');
  }
}
function connect() {
  if (!('EventSource' in window)) {
    poll();
    pollTimer = setInterval(poll, 15000);
    return;
  }
  setConn('connecting');
  if (state.es) { try { state.es.close(); } catch { /* ignore */ } }
  const es = new EventSource('/api/stream');
  state.es = es;
  state.lastBeat = Date.now();
  let errors = 0;
  const beat = () => { state.lastBeat = Date.now(); if (state.conn !== 'live') setConn('live'); };
  es.addEventListener('open', () => {
    errors = 0;
    beat();
  });
  es.addEventListener('ping', beat);
  es.addEventListener('snapshot', (e) => {
    const j = JSON.parse(e.data);
    // a new version of the site was deployed while this page was open: reload to get it
    if (j.build) {
      if (state.build && state.build !== j.build) { location.reload(); return; }
      state.build = j.build;
    }
    setHistoryHours(j.history_hours);
    if (j.contacts) setContacts(j.contacts);
    setSupport(j.support);
    if (j.roads && svc) svc.setRoads(j.roads);
    if (j.borders && svc) svc.setBorders(j.borders);
    const before = new Set(state.alerts.keys());
    state.alerts = new Map();
    for (const a of j.alerts) state.alerts.set(a.id, a);
    if (!state.firstSnapshot) {
      for (const a of j.alerts) if (!before.has(a.id) && a.is_active) { freshIds.add(a.id); notify(a); }
    }
    const first = state.firstSnapshot;
    state.firstSnapshot = false;
    setConn('live');
    refresh();
    startTicker();
    if (first) {
      const id = location.hash.slice(1);
      if (id && state.alerts.has(id)) setTimeout(() => select(id), 600);
      else if (id) {
        fetch('/api/alerts/' + encodeURIComponent(id)).then((r) => (r.ok ? r.json() : null)).then((j2) => {
          if (j2 && j2.alert) {
            state.alerts.set(j2.alert.id, j2.alert);
            refresh();
            setTimeout(() => select(j2.alert.id), 600);
          }
        }).catch(() => {});
      }
    }
  });
  es.addEventListener('alert', (e) => {
    beat();
    const a = JSON.parse(e.data);
    const isNew = !state.alerts.has(a.id);
    upsert(a, isNew);
    refresh();
    if (isNew) {
      state.lastAlertAt = Date.now();
      tickIdx = 0;
      renderTicker();
      notify(a);
    }
  });
  es.addEventListener('roads', (e) => { beat(); try { svc && svc.setRoads(JSON.parse(e.data)); } catch { /* ignore */ } });
  es.addEventListener('power', (e) => { beat(); try { svc && svc.setPower(JSON.parse(e.data)); } catch { /* ignore */ } });
  es.addEventListener('borders', (e) => { beat(); try { svc && svc.setBorders(JSON.parse(e.data)); } catch { /* ignore */ } });
  es.addEventListener('contacts', (e) => { beat(); try { setContacts(JSON.parse(e.data)); } catch { /* ignore */ } });
  es.addEventListener('support', (e) => { beat(); try { setSupport(JSON.parse(e.data)); } catch { /* ignore */ } });
  es.addEventListener('update', (e) => {
    const a = JSON.parse(e.data);
    upsert(a, false);
    refresh();
  });
  es.addEventListener('remove', (e) => {
    const { id } = JSON.parse(e.data);
    state.alerts.delete(id);
    if (state.selectedId === id) select(null);
    refresh();
  });
  es.addEventListener('error', () => {
    if (state.es !== es) return;
    errors++;
    setConn(es.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
    if (es.readyState === EventSource.CLOSED || errors > 6) {
      es.close();
      setConn('offline');
      poll();
      setTimeout(() => { if (state.es === es) connect(); }, 8000);
    }
  });
}
// Keep the live status honest: the server sends a heartbeat every 25 s; if nothing arrives for
// 60 s (sleeping phone, network switch, proxy cut) reconnect right away.
function reconnectIfStale(maxAge) {
  if (!state.es) return;
  if (state.es.readyState === EventSource.CLOSED || Date.now() - (state.lastBeat || 0) > maxAge) connect();
}
setInterval(() => { if (!document.hidden) reconnectIfStale(60_000); }, 10_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { reconnectIfStale(35_000); tickIdx = 0; if (typeof renderTicker === 'function' && state.alerts) renderTicker(); } });
window.addEventListener('online', () => connect());
window.addEventListener('offline', () => setConn('offline'));

// ------------------------------------------------------------------ boot
async function boot() {
  hydrateStatic();
  const s = settings.get();
  if (typeof s.darkMode === 'boolean') applyTheme(s.darkMode);
  else applyTheme(document.documentElement.classList.contains('dark'));
  if (s.sidebarHidden && !isMobile()) {
    $('#app').classList.add('sb-hidden');
    $('#listFab').hidden = false;
  }
  placeListFab();
  bindEvents();
  setupSheet();
  renderList();
  startTicker();
  connect();
  fetch('/api/meta').then((r) => r.json()).then((m) => {
    if (m.bot) {
      BOT = m.bot;
      $('#btnReport').href = `${m.bot}?start=report`;
    }
  }).catch(() => {});
  initInstall({
    T, icon, esc, toast,
    isBusy: () => !$('#modalBackdrop').hidden || !$('#tour').hidden || $('#drawer').classList.contains('open')
      || $('#aboutSheet').classList.contains('open') || document.hidden || Date.now() - (state.lastAlertAt || 0) < 20_000,
  });
  onInstallChange(() => { if ($('#drawer').classList.contains('open')) renderDrawer(); });
  if (!s.hasSeenWelcome) showWelcome();
  else if (!s.hasSeenTour) setTimeout(startTour, 800);
  else scheduleInstallCard(8000);
  window.__rasInstall = { show: () => showInstallCard(true), mode: installMode };

  // wait for maplibre (deferred script)
  // MapLibre is imported as an ES module; expose that instance for map.js.
  window.maplibregl = maplibregl;
  amap = new AlertMap($('#map'), {
    lang: LANG,
    dark: document.documentElement.classList.contains('dark'),
    layer: s.mapLayer,
    map3d: s.map3d,
    showGov: s.showGov,
    focusSyria: s.focusSyria,
    onSelect: (id, o) => select(id, o),
    popupHtml,
  });
  try {
    await amap.init();
  } catch (e) {
    console.error('map init failed', e);
  }
  try {
    svc = createServices({ LANG, esc, icon, toast, openModal, closeModal, getMap: () => amap, botUrl: () => BOT });
    window.addEventListener('ras-me', () => { renderList(); if (state.selectedId) renderDetail(); });
    $('#btnSvcLbl').textContent = svc.L.services;
    svc.init();
    document.addEventListener('ras:me', () => { renderList(); if (state.view === 'detail') renderDetail(); });
  } catch (e) { console.error('services init failed', e); }
  amap.setAlerts(visibleAlerts(), state.selectedId);
  focusFromUrl();
  if (state.selectedId) {
    const a = state.alerts.get(state.selectedId);
    if (a) amap.select(isLive(a) ? a : { ...a, is_active: false });
  }
  // periodic refresh for relative times & client-side expiry
  setInterval(() => {
    renderList();
    if (state.view === 'detail') renderDetail();
    amap.setAlerts(visibleAlerts(), state.selectedId);
  }, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
// /ar/?at=32.62,36.10,9 -> open the map centred on that area (links from the "شو صاير بـ..." pages)
function focusFromUrl() {
  const at = new URLSearchParams(location.search).get('at');
  if (!at || location.hash.length > 1) return;
  const [lat, lon, z] = at.split(',').map(Number);
  if (!(lat > 32 && lat < 37.6 && lon > 35.5 && lon < 42.5)) return;
  const go = () => amap?.map?.flyTo({ center: [lon, lat], zoom: Math.min(13, Math.max(6, z || 10)), essential: true, duration: 1200 });
  if (amap?.map?.loaded?.()) setTimeout(go, 300);
  else amap?.map?.once?.('load', () => setTimeout(go, 300));
}
boot();
