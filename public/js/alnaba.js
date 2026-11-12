import { normalizeTelegramPublicUrl } from '/shared/telegram-links.js?v=2';
import { copyArchiveUrl } from '/js/archive-copy.js?v=1';

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
        <a class="an-action-link secondary" href="${src}" target="_blank" rel="noopener noreferrer">فتح PDF</a>
        <a class="an-action-link secondary" href="${src}" download>تنزيل PDF</a>
      </div>
    </div>
    <div class="an-pdf-reader" id="${previewId}" data-pdf-reader data-src="${src}" role="region" aria-label="قارئ ${title}" tabindex="-1">
      <div class="an-pdf-toolbar" role="group" aria-label="أدوات قراءة الصحيفة">
        <button class="an-pdf-control" type="button" data-pdf-action data-pdf-prev disabled>السابق</button>
        <span class="an-pdf-page" data-pdf-page aria-live="polite">معاينة الصحيفة</span>
        <button class="an-pdf-control" type="button" data-pdf-action data-pdf-next disabled>التالي</button>
        <span class="an-pdf-zoom-label" data-pdf-zoom>١٠٠٪</span>
        <button class="an-pdf-control an-pdf-zoom" type="button" data-pdf-action data-pdf-zoom-out disabled aria-label="تصغير">−</button>
        <button class="an-pdf-control an-pdf-zoom" type="button" data-pdf-action data-pdf-zoom-in disabled aria-label="تكبير">+</button>
      </div>
      <div class="an-pdf-status" data-pdf-status role="status">جارٍ تهيئة معاينة الصحيفة…</div>
      <div class="an-pdf-canvas-wrap" data-pdf-canvas-wrap><canvas data-pdf-canvas></canvas></div>
    </div>
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
  const url = String(item.url || '');
  if (!normalizeTelegramPublicUrl(url)) return '';
  const safeUrl = esc(url);
  const title = esc(item.title || 'رابط Telegram');
  const date = formatDate(item.published_at);
  return `<article class="an-archive-entry">
    <div class="an-archive-copy">
      <span class="an-archive-kicker">النبأ <span aria-hidden="true">/</span> الأرشيف</span>
      <h2>${title}</h2>
      ${date ? `<time datetime="${esc(item.published_at)}">أُضيف ${esc(date)}</time>` : ''}
      <a class="an-archive-url" href="${safeUrl}" dir="ltr" aria-label="${esc(`الرابط المباشر: ${url}`)}">${safeUrl}</a>
    </div>
    <div class="an-archive-actions">
      <button class="an-copy-button an-archive-copy-button" type="button" data-copy-archive-link="${safeUrl}" aria-label="${esc(`نسخ رابط ${item.title || 'Telegram'}`)}">نسخ الرابط</button>
      <a class="an-action-link an-archive-open" href="${safeUrl}" rel="noopener noreferrer" aria-label="${esc(`فتح صفحة Telegram: ${item.title || 'رابط Telegram'}`)}">
        <span>فتح صفحة Telegram</span><span aria-hidden="true">↗</span>
      </a>
    </div>
  </article>`;
}

const SECTION_VIEWS = {
  photos: { list: $('#photoGrid'), loading: $('#photoLoading'), empty: $('#photoEmpty'), error: $('#photoError'), more: $('#photoMore'), render: renderPhoto, limit: 30 },
  weekly: { list: $('#weeklyList'), loading: $('#weeklyLoading'), empty: $('#weeklyEmpty'), error: $('#weeklyError'), more: $('#weeklyMore'), render: renderWeekly, limit: 10 },
  nasheed: { list: $('#nasheedList'), loading: $('#nasheedLoading'), empty: $('#nasheedEmpty'), error: $('#nasheedError'), more: $('#nasheedMore'), render: renderLibrary, limit: 20 },
  archive: { list: $('#archiveList'), loading: $('#archiveLoading'), empty: $('#archiveEmpty'), error: $('#archiveError'), more: $('#archiveMore'), render: renderArchive, limit: 30 },
};

const archiveList = $('#archiveList');
archiveList?.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-copy-archive-link]');
  if (!button || !archiveList.contains(button)) return;
  const link = button.closest('.an-archive-entry')?.querySelector('.an-archive-url');
  const url = button.dataset.copyArchiveLink || link?.textContent?.trim();
  if (!url || !link) return;
  button.disabled = true;
  copyArchiveUrl(url, { selectionTarget: link })
    .then((result) => showToast(result === 'copied'
      ? 'تم نسخ الرابط'
      : 'تعذّر النسخ تلقائياً؛ اضغط مطولاً على الرابط الظاهر واختر «نسخ».'))
    .catch(() => showToast('تعذّر النسخ تلقائياً؛ اضغط مطولاً على الرابط الظاهر واختر «نسخ».'))
    .finally(() => { button.disabled = false; });
});

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
    if (section === 'weekly' && cards.length) {
      try {
        const { initializePdfReaders } = await import('/js/alnaba-pdf.js?v=1');
        initializePdfReaders(view.list);
      } catch {
        for (const status of view.list.querySelectorAll('[data-pdf-status]')) {
          status.textContent = 'تعذّرت تهيئة المعاينة. يمكنك فتح ملف PDF أو تنزيله من الأزرار أعلاه.';
        }
      }
    }
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
