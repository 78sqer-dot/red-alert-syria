const PDFJS_URL = '/vendor/pdfjs-4.10.38.min.mjs';
const PDFJS_WORKER_URL = '/vendor/pdfjs-worker-4.10.38.min.mjs';
const MAX_CANVAS_PIXELS = 4_000_000;
let pdfjsPromise;

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_URL).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

function setStatus(reader, text) {
  const status = reader.querySelector('[data-pdf-status]');
  if (status) status.textContent = text;
}

function setControls(reader, state) {
  const pageLabel = reader.querySelector('[data-pdf-page]');
  const zoomLabel = reader.querySelector('[data-pdf-zoom]');
  const previous = reader.querySelector('[data-pdf-prev]');
  const next = reader.querySelector('[data-pdf-next]');
  if (pageLabel) pageLabel.textContent = state.pdf ? `الصفحة ${state.pageNumber} من ${state.pdf.numPages}` : 'معاينة الصحيفة';
  if (zoomLabel) zoomLabel.textContent = `${Math.round(state.zoom * 100)}٪`;
  if (previous) previous.disabled = !state.pdf || state.pageNumber <= 1 || state.rendering;
  if (next) next.disabled = !state.pdf || state.pageNumber >= state.pdf.numPages || state.rendering;
  for (const button of reader.querySelectorAll('[data-pdf-zoom-in], [data-pdf-zoom-out]')) button.disabled = !state.pdf || state.rendering;
}

async function renderPage(reader, state) {
  if (!state.pdf || state.rendering) return;
  state.rendering = true;
  setControls(reader, state);
  const canvas = reader.querySelector('[data-pdf-canvas]');
  const wrap = reader.querySelector('[data-pdf-canvas-wrap]');
  if (!canvas || !wrap) {
    state.rendering = false;
    return;
  }
  try {
    state.renderTask?.cancel();
    const page = await state.pdf.getPage(state.pageNumber);
    const base = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(240, wrap.clientWidth - 20);
    const fitScale = Math.min(availableWidth / base.width, 1.6);
    const scale = fitScale * state.zoom;
    const viewport = page.getViewport({ scale });
    const requestedOutputScale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    const outputScale = Math.min(requestedOutputScale, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    canvas.style.width = `${Math.ceil(viewport.width)}px`;
    canvas.style.height = `${Math.ceil(viewport.height)}px`;
    canvas.setAttribute('aria-label', `الصفحة ${state.pageNumber} من الصحيفة`);
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const task = page.render({
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
      background: '#ffffff',
    });
    state.renderTask = task;
    await task.promise;
    setStatus(reader, '');
    reader.classList.add('is-ready');
  } catch (error) {
    if (error?.name !== 'RenderingCancelledException') {
      console.warn('[alnaba] PDF page render failed:', error?.name || 'Error');
      setStatus(reader, 'لم تكتمل معاينة الصفحة. يمكنك فتح ملف PDF أو تنزيله من الأزرار أعلاه.');
    }
  } finally {
    state.renderTask = null;
    state.rendering = false;
    setControls(reader, state);
  }
}

async function openPdf(reader, state) {
  if (state.loading || state.pdf) return state.loading;
  state.loading = (async () => {
    setStatus(reader, 'جارٍ تحميل الصحيفة للقراءة…');
    reader.classList.add('is-loading');
    setControls(reader, state);
    try {
      const pdfjs = await loadPdfJs();
      const loadingTask = pdfjs.getDocument({
        url: reader.dataset.src,
        rangeChunkSize: 512 * 1024,
        cMapUrl: '/vendor/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
        useWorkerFetch: true,
        isEvalSupported: false,
      });
      state.pdf = await loadingTask.promise;
      state.pageNumber = 1;
      reader.classList.remove('is-loading');
      await renderPage(reader, state);
    } catch (error) {
      console.warn('[alnaba] PDF preview unavailable:', error?.name || 'Error');
      reader.classList.remove('is-loading');
      setStatus(reader, 'تعذّرت المعاينة داخل هذه الصفحة. جرّب «فتح PDF» أو «تنزيل PDF».');
      reader.classList.add('has-error');
    } finally {
      state.loading = null;
      setControls(reader, state);
    }
  })();
  return state.loading;
}

function bindReader(reader) {
  if (reader.dataset.pdfBound === 'true') return;
  reader.dataset.pdfBound = 'true';
  const state = { pdf: null, loading: null, pageNumber: 1, zoom: 1, rendering: false, renderTask: null, resizeTimer: 0 };
  setControls(reader, state);

  reader.addEventListener('click', async (event) => {
    const button = event.target.closest?.('button[data-pdf-action]');
    if (!button || !reader.contains(button) || button.disabled) return;
    await openPdf(reader, state);
    if (!state.pdf) return;
    if (button.hasAttribute('data-pdf-prev') && state.pageNumber > 1) state.pageNumber -= 1;
    else if (button.hasAttribute('data-pdf-next') && state.pageNumber < state.pdf.numPages) state.pageNumber += 1;
    else if (button.hasAttribute('data-pdf-zoom-in')) state.zoom = Math.min(2, Math.round((state.zoom + 0.2) * 100) / 100);
    else if (button.hasAttribute('data-pdf-zoom-out')) state.zoom = Math.max(0.6, Math.round((state.zoom - 0.2) * 100) / 100);
    else return;
    await renderPage(reader, state);
  });

  const resize = () => {
    if (!state.pdf) return;
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(() => renderPage(reader, state), 160);
  };
  if ('ResizeObserver' in window) {
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(reader);
  } else window.addEventListener('resize', resize, { passive: true });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        openPdf(reader, state);
      }
    }, { rootMargin: '240px 0px' });
    observer.observe(reader);
  } else {
    openPdf(reader, state);
  }
}

export function initializePdfReaders(root = document) {
  for (const reader of root.querySelectorAll('[data-pdf-reader]')) bindReader(reader);
}
