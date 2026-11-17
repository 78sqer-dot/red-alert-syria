// «المباشر» (Live) — website-only: a slim moving news ticker under the topbar
// (Syria headlines first, then world, from major Arabic channels) and a popup
// sheet with three tabs: 📰 news · 🛰 OSINT · 📊 global markets. Data comes
// from GET /api/live (server-cached). Additive like services.js: if it fails,
// the alert map is untouched.
export function createLive({ LANG, esc }) {
  const L = LANG === 'en' ? {
    live: 'Live', news: 'News', osint: 'OSINT', markets: 'Markets',
    syria: 'Syria', world: 'World', sheetSub: 'Headlines from major Arabic channels, open-source intelligence posts, and global markets — updated every few minutes.',
    empty: 'Nothing available right now; try again shortly.', osintTag: 'OSINT',
    source: 'Source', openOriginal: 'Original post', dayChange: 'day',
    updated: 'Updated', close: 'Close', agoMin: (n) => `${n}m ago`, agoHr: (n) => `${n}h ago`, now: 'now',
  } : {
    live: 'المباشر', news: 'الأخبار', osint: 'الاستخبارات المفتوحة', markets: 'الأسواق',
    syria: 'سوريا', world: 'العالم', sheetSub: 'عناوين من كبرى القنوات العربية، ومنشورات استخبارات مفتوحة المصدر، والأسواق العالمية — تُحدّث كل بضع دقائق.',
    empty: 'لا شيء متاح حالياً؛ جرّب بعد قليل.', osintTag: 'OSINT',
    source: 'المصدر', openOriginal: 'المنشور الأصلي', dayChange: 'يومي',
    updated: 'آخر تحديث', close: 'إغلاق', agoMin: (n) => `قبل ${n} د`, agoHr: (n) => `قبل ${n} س`, now: 'الآن',
  };
  let data = null;
  let tab = 'news';
  let sheet, back, body, strip, refreshTimer = null;

  const ago = (ts) => {
    if (!ts) return '';
    const min = Math.max(0, Math.round((Date.now() - ts) / 60_000));
    if (min < 1) return L.now;
    if (min < 60) return L.agoMin(min);
    return L.agoHr(Math.round(min / 60));
  };
  const fmtPrice = (v) => (v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v >= 10 ? v.toFixed(2) : v.toFixed(3));

  async function load() {
    try {
      const r = await fetch('/api/live', { headers: { Accept: 'application/json' } });
      if (r.ok) { data = await r.json(); renderStrip(); if (sheet?.classList.contains('open')) renderSheet(); }
    } catch { /* keep whatever we have */ }
  }

  // ------------------------------------------------------------ ticker strip
  function renderStrip() {
    if (!strip || strip.hidden) return;
    const items = [...(data?.news?.syria || []), ...(data?.news?.world || [])].slice(0, 25);
    const track = strip.querySelector('.live-track');
    if (!items.length) { track.innerHTML = `<span class="live-tick live-empty">${esc(L.empty)}</span>`; return; }
    const html = items.map((it, i) => `<span class="live-tick" data-open="${i}"><b class="live-src">${esc(it.source)}</b>${esc(it.title)}</span><span class="live-dot">•</span>`).join('');
    // two copies side by side make the -50% marquee loop seamless
    track.innerHTML = `<div class="live-run">${html}</div><div class="live-run" aria-hidden="true">${html}</div>`;
    const secs = Math.max(30, items.length * 6);
    track.style.animationDuration = `${secs}s`;
  }
  function buildStrip() {
    if (localStorage.getItem('ras-live-off') === '1') return;
    strip = document.createElement('div');
    strip.className = 'live-strip';
    strip.innerHTML = `<button type="button" class="live-chip" data-act="open">📡 ${esc(L.live)}</button>`
      + `<div class="live-marquee"><div class="live-track"></div></div>`
      + `<button type="button" class="live-x" data-act="off" aria-label="${esc(L.close)}">✕</button>`;
    const topbar = document.getElementById('topbar');
    if (topbar?.parentElement) topbar.parentElement.insertBefore(strip, topbar.nextSibling);
    else document.body.prepend(strip);
    strip.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'off') { localStorage.setItem('ras-live-off', '1'); strip.remove(); strip = null; return; }
      open();
    });
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
      const t = e.target.closest('[data-tab]');
      if (t) { tab = t.dataset.tab; renderSheet(); return; }
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
    const html = sec(L.syria, data?.news?.syria || []) + sec(L.world, data?.news?.world || []);
    return html || `<p class="live-none">${esc(L.empty)}</p>`;
  }
  function osintHtml() {
    const items = data?.osint || [];
    if (!items.length) return `<p class="live-none">${esc(L.empty)}</p>`;
    return items.map((it) => `
      <article class="live-card">
        <div class="live-card-h"><span class="live-badge">${esc(it.source)}</span><span class="live-tag">${esc(L.osintTag)}</span><span class="live-time">${esc(ago(it.ts))}</span></div>
        <p class="live-text">${esc(it.text)}</p>
        <a class="live-orig" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(L.openOriginal)} ↗</a>
      </article>`).join('');
  }
  function marketsHtml() {
    const items = data?.markets || [];
    if (!items.length) return `<p class="live-none">${esc(L.empty)}</p>`;
    return `<div class="live-grid">${items.map((m) => {
      const up = m.changePct >= 0;
      return `<div class="live-quote">
        <div class="live-q-name">${esc(LANG === 'en' ? m.en : m.ar)}</div>
        <div class="live-q-price">${esc(fmtPrice(m.price))}</div>
        <div class="live-q-chg ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${esc(Math.abs(m.changePct).toFixed(2))}% <span class="live-q-day">${esc(L.dayChange)}</span></div>
      </div>`;
    }).join('')}</div>`;
  }
  function renderSheet() {
    if (!body) return;
    const tabBtn = (k, label) => `<button type="button" class="live-tab${tab === k ? ' on' : ''}" data-tab="${k}">${esc(label)}</button>`;
    body.innerHTML = `
      <div class="live-head"><h2>📡 ${esc(L.live)}</h2><button type="button" class="live-close" data-close aria-label="${esc(L.close)}">✕</button></div>
      <p class="live-sub">${esc(L.sheetSub)}</p>
      <div class="live-tabs">${tabBtn('news', '📰 ' + L.news)}${tabBtn('osint', '🛰 ' + L.osint)}${tabBtn('markets', '📊 ' + L.markets)}</div>
      <div class="live-pane">${tab === 'news' ? newsHtml() : tab === 'osint' ? osintHtml() : marketsHtml()}</div>
      ${data?.server_time ? `<p class="live-foot">${esc(L.updated)}: ${esc(new Date(data.server_time).toLocaleTimeString(LANG === 'en' ? 'en-GB' : 'ar-SY'))}</p>` : ''}`;
  }
  function open() {
    buildSheet();
    renderSheet();
    back.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
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
