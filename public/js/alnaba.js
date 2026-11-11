const page = document.documentElement.dataset.page || 'home';
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const UUID = /^[\w-]{36}$/;

for (const view of document.querySelectorAll('[data-view]')) view.hidden = view.dataset.view !== page;
for (const link of document.querySelectorAll('[data-nav]')) {
  const selected = link.dataset.nav === page;
  if (selected) link.setAttribute('aria-current', 'page');
}

function mediaUrl(item) {
  return item && UUID.test(String(item.id || '')) ? `/api/alnaba/media/${item.id}` : null;
}

function safeTelegramUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol !== 'https:' || !['t.me', 'telegram.me'].includes(url.hostname.toLowerCase())
      || url.username || url.password || url.port || url.search || url.hash) return null;
    const path = url.pathname.replace(/\/+$/, '');
    if (!/^\/(?:[A-Za-z][A-Za-z0-9_]{4,31}|\+[A-Za-z0-9_-]{8,128}|joinchat\/[A-Za-z0-9_-]{8,128})$/.test(path)) return null;
    return `https://t.me${path}`;
  } catch {
    return null;
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('ar-SY', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Damascus',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

function showToast(text) {
  const toast = $('#anToast');
  if (!toast) return;
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2200);
}

async function copyCurrentLink() {
  const url = new URL(location.pathname, location.origin).href;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
    else {
      const input = document.createElement('textarea');
      input.value = url;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.append(input);
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      if (!copied) throw new Error('copy failed');
    }
    showToast('تم نسخ الرابط');
  } catch {
    showToast('تعذّر نسخ الرابط؛ انسخه من شريط العنوان');
  }
}

for (const button of document.querySelectorAll('[data-copy-link]')) button.addEventListener('click', copyCurrentLink);

function renderPhoto(item) {
  const src = mediaUrl(item);
  if (!src || !String(item.mime_type || '').startsWith('image/')) return '';
  const title = esc(item.title || 'خبر مصوّر');
  const date = formatDate(item.published_at);
  return `<article class="an-story-card">
    <div class="an-story-frame">
      <div class="an-story-frame-label"><b>النبأ</b><span>أخبار مصوّرة</span></div>
      <div class="an-story-media"><img src="${src}" alt="${esc(`صورة: ${item.title || 'خبر مصوّر'}`)}" loading="lazy" decoding="async" /></div>
    </div>
    <div class="an-story-body">${date ? `<time datetime="${esc(item.published_at)}">${esc(date)}</time>` : ''}<h2>${title}</h2>${item.description ? `<p>${esc(item.description)}</p>` : ''}</div>
  </article>`;
}

function renderWeekly(item) {
  const src = mediaUrl(item);
  if (!src || item.mime_type !== 'application/pdf') return '';
  const previewId = `weekly-pdf-${item.id}`;
  const title = esc(item.title || 'الصحيفة الأسبوعية');
  const date = formatDate(item.published_at);
  const issue = Number.isSafeInteger(Number(item.issue_number)) && Number(item.issue_number) > 0
    ? `العدد ${new Intl.NumberFormat('ar-SY', { useGrouping: false }).format(Number(item.issue_number))}` : 'عدد أسبوعي';
  return `<article class="an-paper-card">
    <div class="an-paper-copy">
      <span class="an-paper-badge">النبأ · الصحيفة الأسبوعية · ${issue}</span>
      <h2>${title}</h2>
      ${item.description ? `<p>${esc(item.description)}</p>` : ''}
      <div class="an-paper-meta">${date ? `<time datetime="${esc(item.published_at)}">${esc(date)}</time>` : ''}<span>PDF</span></div>
      <div class="an-paper-actions">
        <a class="an-action-link" href="#${previewId}" aria-controls="${previewId}">عرض الصحيفة داخل الصفحة</a>
        <a class="an-action-link secondary" href="${src}" download>تنزيل PDF</a>
      </div>
    </div>
    <div class="an-pdf-frame" id="${previewId}" tabindex="-1"><iframe src="${src}#toolbar=1&navpanes=0" title="معاينة ${title}" loading="lazy"></iframe></div>
  </article>`;
}

function renderLibrary(item, section) {
  const src = mediaUrl(item);
  if (!src) return '';
  const mime = String(item.mime_type || '');
  const title = esc(item.title || 'محتوى النبأ');
  const date = formatDate(item.published_at);
  const description = item.description ? `<p>${esc(item.description)}</p>` : '';
  let media = '';
  if (mime.startsWith('audio/')) media = `<audio class="an-library-media" controls preload="none"><source src="${src}" type="${esc(mime)}" />متصفحك لا يدعم تشغيل الصوت.</audio>`;
  else if (mime.startsWith('video/')) media = `<video class="an-library-media" controls playsinline preload="metadata"><source src="${src}" type="${esc(mime)}" />متصفحك لا يدعم تشغيل الفيديو.</video>`;
  else if (mime.startsWith('image/')) media = `<img class="an-library-media" src="${src}" alt="${esc(`صورة: ${item.title || 'محتوى النبأ'}`)}" loading="lazy" decoding="async" />`;
  else if (mime === 'application/pdf') media = `<iframe class="an-library-pdf" src="${src}#toolbar=1&navpanes=0" title="معاينة ${title}" loading="lazy"></iframe>`;
  else return '';
  const actions = mime === 'application/pdf'
    ? `<div class="an-paper-actions"><a class="an-action-link" href="${src}" target="_blank" rel="noopener noreferrer">فتح الملف</a><a class="an-action-link secondary" href="${src}" download>تنزيل</a></div>`
    : '';
  const hasAudioPlayer = section === 'nasheed' && (mime.startsWith('audio/') || mime.startsWith('video/'));
  const player = hasAudioPlayer
    ? `<div class="an-nasheed-player" data-nasheed-player><div class="an-nasheed-wave" aria-hidden="true">${'<span class="an-nasheed-wave__bar"></span>'.repeat(15)}</div>${media}</div>`
    : media;
  return `<article class="an-library-card"><div class="an-library-copy"><h2>${title}</h2>${description}<div class="an-library-meta">${date ? `<time datetime="${esc(item.published_at)}">${esc(date)}</time>` : ''}<span>${esc(mime)}</span></div>${actions}</div>${player}</article>`;
}

function bindNasheedPlayback(root) {
  for (const player of root.querySelectorAll('[data-nasheed-player]')) {
    if (player.dataset.motionBound === 'true') continue;
    const media = player.querySelector('audio, video');
    if (!media) continue;
    player.dataset.motionBound = 'true';
    media.addEventListener('playing', () => player.classList.add('is-playing'));
    for (const eventName of ['pause', 'ended', 'waiting', 'stalled', 'emptied', 'error']) {
      media.addEventListener(eventName, () => player.classList.remove('is-playing'));
    }
  }
}

function renderArchive(item) {
  const href = safeTelegramUrl(item.url);
  if (!href) return '';
  const title = esc(item.title || 'رابط Telegram');
  const date = formatDate(item.published_at);
  return `<article class="an-archive-entry">
    <div class="an-archive-copy">
      <span class="an-archive-kicker">النبأ <span aria-hidden="true">/</span> الأرشيف</span>
      <h2>${title}</h2>
      ${date ? `<time datetime="${esc(item.published_at)}">أُضيف ${esc(date)}</time>` : ''}
    </div>
    <a class="an-action-link an-archive-open" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(`فتح ${item.title || 'رابط Telegram'} في Telegram`)}">
      <span>فتح في Telegram</span><span aria-hidden="true">↗</span>
    </a>
  </article>`;
}

const SECTION_VIEWS = {
  photos: { list: $('#photoGrid'), loading: $('#photoLoading'), empty: $('#photoEmpty'), error: $('#photoError'), more: $('#photoMore'), render: renderPhoto, limit: 30 },
  weekly: { list: $('#weeklyList'), loading: $('#weeklyLoading'), empty: $('#weeklyEmpty'), error: $('#weeklyError'), more: $('#weeklyMore'), render: renderWeekly, limit: 10 },
  nasheed: { list: $('#nasheedList'), loading: $('#nasheedLoading'), empty: $('#nasheedEmpty'), error: $('#nasheedError'), more: $('#nasheedMore'), render: renderLibrary, limit: 20 },
  archive: { list: $('#archiveList'), loading: $('#archiveLoading'), empty: $('#archiveEmpty'), error: $('#archiveError'), more: $('#archiveMore'), render: renderArchive, limit: 30 },
};

async function loadSection(section, reset = false) {
  const view = SECTION_VIEWS[section];
  if (!view?.list || !view.loading || !view.empty || !view.error) return;
  if (view.loading.dataset.busy === 'true') return;
  const offset = reset ? 0 : Number(view.list.dataset.offset || 0);
  view.loading.dataset.busy = 'true';
  if (reset) {
    view.list.innerHTML = '';
    view.list.dataset.offset = '0';
    view.empty.hidden = true;
    view.error.hidden = true;
    view.loading.hidden = false;
  }
  if (view.more) view.more.disabled = true;
  try {
    const params = new URLSearchParams({ section, limit: String(view.limit), offset: String(offset) });
    const response = await fetch(`/api/alnaba?${params}`, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      cache: section === 'photos' ? 'no-store' : 'default',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.section !== section || !Array.isArray(data.items)) throw new Error('Invalid response');
    const cards = data.items.map((item) => view.render(item, section)).filter(Boolean);
    view.list.insertAdjacentHTML('beforeend', cards.join(''));
    if (section === 'nasheed') bindNasheedPlayback(view.list);
    view.list.dataset.offset = String(offset + data.items.length);
    view.empty.hidden = view.list.childElementCount > 0;
    if (view.more) view.more.hidden = !data.has_more;
  } catch {
    view.error.hidden = false;
  } finally {
    view.loading.hidden = true;
    view.loading.dataset.busy = 'false';
    if (view.more) view.more.disabled = false;
  }
}

for (const [section, view] of Object.entries(SECTION_VIEWS)) {
  view.more?.addEventListener('click', () => loadSection(section));
}

if (SECTION_VIEWS[page]) loadSection(page, true);
