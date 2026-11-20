// «المباشر» (Live) — website-only: a slim moving news ticker under the topbar
// (Syria headlines first, then world, from major Arabic channels) and a popup
// sheet with the news only — Syria section first, then World — whose list
// auto-scrolls vertically, Crucix-style. The ONE «مباشر» control is the topbar
// status chip (wired in app.js to open('world')); the strip's label is a plain
// caption, not a button (owner, 2026-11-17: three look-alike controls were
// unified into one). (Owner simplification, 2026-11-17: the OSINT and Markets
// tabs were removed entirely.) Data comes from GET /api/live (server-cached).
// Additive like services.js: if it fails, the alert map is untouched.
export function createLive({ LANG, esc }) {
  const L = LANG === 'en' ? {
    live: 'Live', news: 'News',
    syria: 'Syria', world: 'World', sheetSub: 'Headlines from major Arabic channels — Syria first, then the world — updated every few minutes.',
    empty: 'Nothing available right now; try again shortly.',
    updated: 'Updated', close: 'Close', agoMin: (n) => `${n}m ago`, agoHr: (n) => `${n}h ago`, now: 'now',
  } : {
    live: 'المباشر', news: 'الأخبار',
    syria: 'سوريا', world: 'العالم', sheetSub: 'عناوين من كبرى القنوات العربية — سوريا أولاً ثم العالم — تُحدّث كل بضع دقائق.',
    empty: 'لا شيء متاح حالياً؛ جرّب بعد قليل.',
    updated: 'آخر تحديث', close: 'إغلاق', agoMin: (n) => `قبل ${n} د`, agoHr: (n) => `قبل ${n} س`, now: 'الآن',
  };
  let data = null;
  let newsFocus = 'syria'; // which news section renders first in the sheet
  let sheet, back, body, strip, refreshTimer = null;

  // Storage can throw in in-app webviews (Telegram) with storage disabled —
  // an unguarded getItem once killed init() there and the strip never showed.
  const storeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const storeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* no storage: ignore */ } };

  const ago = (ts) => {
    if (!ts) return '';
    const min = Math.max(0, Math.round((Date.now() - ts) / 60_000));
    if (min < 1) return L.now;
    if (min < 60) return L.agoMin(min);
    return L.agoHr(Math.round(min / 60));
  };
  async function load() {
    try {
      const r = await fetch('/api/live', { headers: { Accept: 'application/json' } });
      if (r.ok) { data = await r.json(); renderStrip(); if (sheet?.classList.contains('open')) renderSheet(); }
    } catch { /* keep whatever we have */ }
  }

  // ------------------------------------------------------------ ticker strip
  // The marquee is a pure CSS-keyframes loop (translateX -50% → 0, so the
  // headlines flow rightward — direction reversed at the owner's request,
  // 2026-11-17) over a track of exactly two identical halves. The track node is REBUILT on every
  // render so the animation restarts cleanly with fresh content — patching
  // innerHTML on the old node could leave a stale/paused animation in
  // webviews, which is how the strip came to look frozen. Each half repeats
  // the headline run until it is at least as wide as the marquee itself, so
  // there is always a full screen of headlines in flight, and the duration
  // comes from the measured width (constant ~55px/s at any viewport).
  function renderStrip() {
    if (!strip) return;
    const marquee = strip.querySelector('.live-marquee');
    if (!marquee) return;
    const items = [...(data?.news?.syria || []), ...(data?.news?.world || [])].slice(0, 25);
    const track = document.createElement('div');
    track.className = 'live-track';
    const old = marquee.querySelector('.live-track');
    if (old) old.replaceWith(track); else marquee.appendChild(track);
    if (!items.length) {
      track.classList.add('still');
      track.innerHTML = `<span class="live-tick live-empty">${esc(L.empty)}</span>`;
      return;
    }
    const html = items.map((it, i) => `<span class="live-tick" data-open="${i}"><b class="live-src">${esc(it.source)}</b>${esc(it.title)}</span><span class="live-dot">•</span>`).join('');
    const half = document.createElement('div');
    half.className = 'live-half';
    const run = document.createElement('div');
    run.className = 'live-run';
    run.innerHTML = html;
    half.appendChild(run);
    track.appendChild(half);
    let guard = 0;
    while (half.scrollWidth < marquee.clientWidth && guard++ < 5) half.appendChild(run.cloneNode(true));
    const half2 = half.cloneNode(true);
    half2.setAttribute('aria-hidden', 'true');
    track.appendChild(half2);
    track.style.animationDuration = `${Math.max(12, half.scrollWidth / 45)}s`; // owner 20:10: calm readable pace
  }
  function buildStrip() {
    if (storeGet('ras-live-off') === '1') return;
    strip = document.createElement('div');
    strip.className = 'live-strip';
    strip.innerHTML = `<span class="live-chip" aria-hidden="true">📡 ${esc(L.live)}</span>`
      + `<div class="live-marquee"><div class="live-track"></div></div>`
      + `<button type="button" class="live-x" data-act="off" aria-label="${esc(L.close)}">✕</button>`;
    const topbar = document.getElementById('topbar');
    if (topbar?.parentElement) topbar.parentElement.insertBefore(strip, topbar.nextSibling);
    else document.body.prepend(strip);
    strip.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'off') { storeSet('ras-live-off', '1'); strip.remove(); strip = null; return; }
      open();
    });
    // a touch holds the marquee; it resumes shortly after release
    const marquee = strip.querySelector('.live-marquee');
    let resumeT = null;
    marquee.addEventListener('pointerdown', () => { marquee.classList.add('paused'); clearTimeout(resumeT); });
    const resume = () => { clearTimeout(resumeT); resumeT = setTimeout(() => marquee.classList.remove('paused'), 900); };
    marquee.addEventListener('pointerup', resume);
    marquee.addEventListener('pointercancel', resume);
    renderStrip();
  }

  // ------------------------------------------------------------ sheet
  function buildSheet() {
    if (sheet) return;
    back = document.createElement('div'); back.className = 'sheet-backdrop'; back.hidden = true;
    sheet = document.createElement('section'); sheet.className = 'about-sheet live-sheet'; sheet.id = 'liveSheet'; sheet.setAttribute('aria-hidden', 'true');
    sheet.innerHTML = '<div class="about-inner" id="liveBody"></div>';
    document.body.append(back, sheet);
    body = sheet.querySelector('#liveBody');
    back.addEventListener('click', close);
    sheet.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) close();
    });
  }
  function newsHtml() {
    const sec = (title, items) => items.length ? `<h3 class="live-sec">${esc(title)}</h3>` + items.map((it) => `
      <a class="live-item" href="${esc(it.url)}" target="_blank" rel="noopener">
        <span class="live-badge">${esc(it.source)}</span>
        <span class="live-title">${esc(it.title)}</span>
        <span class="live-time">${esc(ago(it.ts))}</span>
      </a>`).join('') : '';
    // opened from the topbar «مباشر» chip, the World section leads; from the
    // ticker strip, Syria leads as before
    const syriaSec = sec(L.syria, data?.news?.syria || []);
    const worldSec = sec(L.world, data?.news?.world || []);
    const html = newsFocus === 'world' ? worldSec + syriaSec : syriaSec + worldSec;
    return html || `<p class="live-none">${esc(L.empty)}</p>`;
  }
  function renderSheet() {
    if (!body) return;
    // one view only: the news list inside the vertical auto-scroller
    const pane = `<div class="live-scroll"><div class="live-vtrack"><div class="live-set">${newsHtml()}</div></div></div>`;
    body.innerHTML = `
      <div class="live-head"><h2>📡 ${esc(L.live)}</h2><button type="button" class="live-close" data-close aria-label="${esc(L.close)}">✕</button></div>
      <p class="live-sub">${esc(L.sheetSub)}</p>
      <div class="live-pane">${pane}</div>
      ${data?.server_time ? `<p class="live-foot">${esc(L.updated)}: ${esc(new Date(data.server_time).toLocaleTimeString(LANG === 'en' ? 'en-GB' : 'ar-SY'))}</p>` : ''}`;
    setupScroller();
  }
  // Crucix-style vertical auto-scroll: once the sheet is laid out, if one set
  // of items is taller than the viewport it is duplicated once and the track
  // loops translateY(0 → -50%) at ~30px/s (≈ one news row every ~2s). A list
  // that fits stays static. Hover pauses via CSS; touch/drag pauses here and
  // resumes ~1.2s after release. The CSS kills the animation whenever the
  // sheet is closed, and prefers-reduced-motion disables it entirely.
  function setupScroller() {
    const sc = body?.querySelector('.live-scroll');
    if (!sc || sc.dataset.wired) return;
    sc.dataset.wired = '1';
    let resumeT = null;
    sc.addEventListener('pointerdown', () => { sc.classList.add('paused'); clearTimeout(resumeT); });
    const resume = () => { clearTimeout(resumeT); resumeT = setTimeout(() => sc.classList.remove('paused'), 1200); };
    sc.addEventListener('pointerup', resume);
    sc.addEventListener('pointercancel', resume);
    requestAnimationFrame(() => {
      const track = sc.querySelector('.live-vtrack');
      const set = track?.querySelector('.live-set');
      if (!track || !set || !sheet?.classList.contains('open')) return;
      const setH = set.offsetHeight;
      if (!setH || setH <= sc.clientHeight + 4) return; // fits the viewport: no scroll
      const copy = set.cloneNode(true);
      copy.setAttribute('aria-hidden', 'true');
      track.appendChild(copy);
      track.style.animationDuration = `${Math.min(240, Math.max(12, setH / 30))}s`;
      track.classList.add('anim');
    });
  }
  function open(view) {
    buildSheet();
    if (view === 'world') { newsFocus = 'world'; }
    back.hidden = false;
    // registered before renderSheet() so the scroller's own rAF (which checks
    // for .open) runs after the class lands
    requestAnimationFrame(() => sheet.classList.add('open'));
    renderSheet();
    sheet.setAttribute('aria-hidden', 'false');
    load();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(load, 3 * 60_000);
  }
  function close() {
    if (!sheet) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    back.hidden = true;
    clearInterval(refreshTimer);
  }

  function init() {
    buildStrip();
    load();
    setInterval(load, 5 * 60_000);
  }
  return { init, open };
}
