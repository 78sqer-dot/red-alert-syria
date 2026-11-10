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

async function loadSection(section) {
  const photos = section === 'photos';
  const list = photos ? $('#photoGrid') : $('#weeklyList');
  const loading = photos ? $('#photoLoading') : $('#weeklyLoading');
  const empty = photos ? $('#photoEmpty') : $('#weeklyEmpty');
  const error = photos ? $('#photoError') : $('#weeklyError');
  if (!list || !loading || !empty || !error) return;
  try {
    const response = await fetch(`/api/alnaba?section=${section}`, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      cache: 'default',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.section !== section || !Array.isArray(data.items)) throw new Error('Invalid response');
    const cards = data.items.map(photos ? renderPhoto : renderWeekly).filter(Boolean);
    list.innerHTML = cards.join('');
    empty.hidden = cards.length > 0;
  } catch {
    error.hidden = false;
  } finally {
    loading.hidden = true;
  }
}

if (page === 'photos' || page === 'weekly') loadSection(page);
