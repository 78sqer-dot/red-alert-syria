// "Install the app" (PWA) invitation, modelled on redalert.com.lb's installApp texts.
// - Android / desktop Chromium (Chrome, Brave, Edge…): one-tap install via the captured beforeinstallprompt.
// - iPhone / iPad: Share → Add to Home Screen steps (Safari has no install API).
// - Android without the install event (e.g. Firefox): browser-menu hint.
// Never shown inside the installed app, to crawlers, or inside in-app browsers; "Later" / ✕ snooze it for days.
const KEY = 'ras-install';
const DAY = 86_400_000;
const SNOOZE_LATER = 7 * DAY;
const SNOOZE_CLOSE = 3 * DAY;
const SNOOZE_NATIVE_NO = 14 * DAY;
const STOP_AFTER = 4; // after 4 dismissals, wait 60 days
const BOT_UA = /bot|crawler|spider|crawling|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandex|facebookexternalhit|embedly|quora link preview|outbrain|pinterest|slackbot|whatsapp|telegrambot|w3c_validator|lighthouse|headless/i;
const INAPP_UA = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|musical_ly|; wv\)|GSA\//i;

const st = { deferred: window.__bip || null, installed: false };
const listeners = new Set();
const changed = () => listeners.forEach((f) => { try { f(); } catch { /* ignore */ } });
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); st.deferred = e; window.__bip = e; changed(); });
window.addEventListener('ras-bip', () => { if (window.__bip) { st.deferred = window.__bip; changed(); } });
window.addEventListener('appinstalled', () => { st.installed = true; st.deferred = null; save({ installed: Date.now() }); hideCard(); changed(); });

function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function save(patch) { try { localStorage.setItem(KEY, JSON.stringify({ ...load(), ...patch })); } catch { /* ignore */ } }

export function platform() {
  const ua = navigator.userAgent || '';
  const ios = /iphone|ipod|ipad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/macintosh|windows|linux|cros/i.test(ua)) return 'desktop';
  return 'other';
}
export function isStandalone() {
  return !!(window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: minimal-ui)').matches || matchMedia('(display-mode: fullscreen)').matches))
    || navigator.standalone === true || document.referrer.startsWith('android-app://');
}
/** what install UI this device can show: 'prompt' | 'ios' | 'android-menu' | null */
export function installMode() {
  const ua = navigator.userAgent || '';
  if (st.installed || isStandalone() || BOT_UA.test(ua)) return null;
  const p = platform();
  if (st.deferred && (p === 'android' || p === 'desktop' || p === 'other')) return 'prompt';
  if (INAPP_UA.test(ua)) return null;
  if (p === 'ios') return 'ios';
  if (p === 'android') return 'android-menu';
  return null;
}
export function onInstallChange(fn) { listeners.add(fn); }
export async function promptInstall() {
  const e = st.deferred;
  if (!e) return 'unavailable';
  try {
    await e.prompt();
    const r = await e.userChoice;
    st.deferred = null; window.__bip = null;
    changed();
    return r.outcome; // 'accepted' | 'dismissed'
  } catch { return 'unavailable'; }
}

// ------------------------------------------------------------------ popup card
let ctx = null; // { T, icon, esc, toast, isBusy }
let card = null;
function hideCard() {
  if (!card) return;
  const c = card; card = null;
  c.classList.remove('show');
  setTimeout(() => c.remove(), 260);
}
function snooze(ms) {
  const s = load();
  const n = (s.dismissed || 0) + 1;
  save({ until: Date.now() + (n >= STOP_AFTER ? 60 * DAY : ms), dismissed: n });
  hideCard();
}
function snoozed() { const s = load(); return !!(s.installed && isStandalone()) || (s.until && Date.now() < s.until); }

export function stepsHtml(mode, { T, icon, esc }) {
  if (mode === 'ios') {
    return `<div class="inst-steps">
      <div class="inst-step"><span class="si blue">${icon('share', 18)}</span><div><b>${esc(T.instIosShareT)}</b><span>${esc(T.instIosShareD)}</span></div></div>
      <div class="inst-step"><span class="si red">${icon('squarePlus', 18)}</span><div><b>${esc(T.instIosAddT)}</b><span>${esc(T.instIosAddD)}</span></div></div></div>`;
  }
  if (mode === 'android-menu') return `<p class="inst-hint">${esc(T.instAndroidNoPrompt)}</p>`;
  return '';
}
export function showInstallCard(force = false) {
  if (!ctx || card) return false;
  const mode = installMode();
  if (!mode || (!force && snoozed())) return false;
  const { T, icon, esc } = ctx;
  card = document.createElement('div');
  card.className = 'inst-card';
  card.id = 'instCard';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', T.instTitle);
  const btn = mode === 'prompt'
    ? `<button class="btn-red inst-go" data-i="go">${icon('download', 18)}${esc(T.instBtn)}</button><button class="btn-text" data-i="later">${esc(T.instLater)}</button>`
    : `<button class="btn-red inst-go" data-i="later">${esc(T.instGotIt)}</button>`;
  card.innerHTML = `<button class="inst-x" data-i="close" aria-label="close">${icon('x', 16)}</button>
    <div class="inst-head"><img src="/img/icon-192.png" alt="" width="46" height="46"/><div><span class="inst-eyebrow">${esc(T.instEyebrow)}</span><h4>${esc(T.instTitle)}</h4></div></div>
    <p class="inst-sub">${esc(mode === 'ios' ? T.instIosIntro : T.instSub)}</p>${stepsHtml(mode, ctx)}
    <div class="inst-btns">${btn}</div>`;
  card.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const a = b.dataset.i;
    if (a === 'close') return snooze(SNOOZE_CLOSE);
    if (a === 'later') return snooze(SNOOZE_LATER);
    if (a === 'go') {
      const r = await promptInstall();
      if (r === 'accepted') { save({ installed: Date.now() }); hideCard(); ctx.toast(T.instDone); }
      else if (r === 'dismissed') snooze(SNOOZE_NATIVE_NO);
      else hideCard();
    }
  });
  (document.getElementById('app') || document.body).appendChild(card);
  requestAnimationFrame(() => requestAnimationFrame(() => card && card.classList.add('show')));
  save({ shown: (load().shown || 0) + 1, lastShown: Date.now() });
  return true;
}

let timer = 0;
/** Ask to show the card after `delay` ms, waiting while the welcome/tour/other windows are open. */
export function scheduleInstallCard(delay = 8000) {
  if (!ctx) return;
  clearTimeout(timer);
  let tries = 0;
  const attempt = () => {
    if (card || snoozed()) return;
    const mode = installMode();
    // Chromium fires beforeinstallprompt a little after load: give it time before falling back to the menu hint
    if (!mode || (mode === 'android-menu' && tries < 3)) { if (++tries <= 6) timer = setTimeout(attempt, 4000); return; }
    if (ctx.isBusy()) { if (++tries <= 40) timer = setTimeout(attempt, 5000); return; }
    showInstallCard();
  };
  timer = setTimeout(attempt, delay);
}
export function initInstall(c) {
  ctx = c;
  onInstallChange(() => { if (card && !installMode()) hideCard(); });
}
export const _installState = st;
