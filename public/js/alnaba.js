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
    <div class="an-story-body">${date ? `<time datetime="${esc(item.published_at)}">${esc(date)}</time>` : ''}<h2>${title}</h2></div>
  </article>`;
}

function renderWeekly(item) {
  const src = mediaUrl(item);
  if (!src || item.mime_type !== 'application/pdf') return '';
  const title = esc(item.title || 'الصحيفة الأسبوعية');
  const date = formatDate(item.published_at);
  return `<article class="an-paper-card">
    <div class="an-paper-copy">
      <span class="an-paper-badge">النبأ · الصحيفة الأسبوعية</span>
      <h2>${title}</h2>
      <div class="an-paper-meta">${date ? `<time datetime="${esc(item.published_at)}">${esc(date)}</time>` : ''}<span>PDF</span></div>
      <div class="an-paper-actions">
        <a class="an-action-link" href="${src}" target="_blank" rel="noopener noreferrer">فتح الصحيفة</a>
        <a class="an-action-link secondary" href="${src}" download>تنزيل PDF</a>
      </div>
    </div>
    <div class="an-pdf-frame"><iframe src="${src}#toolbar=1&navpanes=0" title="معاينة ${title}" loading="lazy"></iframe></div>
  </article>`;
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

async function loadSection(section) {
  const sections = {
    photos: { list: $('#photoGrid'), loading: $('#photoLoading'), empty: $('#photoEmpty'), error: $('#photoError'), render: renderPhoto },
    weekly: { list: $('#weeklyList'), loading: $('#weeklyLoading'), empty: $('#weeklyEmpty'), error: $('#weeklyError'), render: renderWeekly },
    archive: { list: $('#archiveList'), loading: $('#archiveLoading'), empty: $('#archiveEmpty'), error: $('#archiveError'), render: renderArchive },
  };
  const view = sections[section];
  if (!view?.list || !view.loading || !view.empty || !view.error) return;
  try {
    const response = await fetch(`/api/alnaba?section=${section}`, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      cache: 'default',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.section !== section || !Array.isArray(data.items)) throw new Error('Invalid response');
    const cards = data.items.map(view.render).filter(Boolean);
    view.list.innerHTML = cards.join('');
    view.empty.hidden = cards.length > 0;
  } catch {
    view.error.hidden = false;
  } finally {
    view.loading.hidden = true;
  }
}

if (page === 'photos' || page === 'weekly' || page === 'archive') loadSection(page);
