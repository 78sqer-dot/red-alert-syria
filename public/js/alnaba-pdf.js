const PDFJS_URL = '/vendor/pdfjs-legacy-4.10.38.min.mjs';
const PDFJS_WORKER_URL = '/vendor/pdfjs-legacy-worker-4.10.38.min.mjs';
const MAX_CANVAS_PIXELS = 6_000_000;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 4;
const PDF_FETCH_TIMEOUT = 120_000;
let pdfjsPromise;
let pdfjsImportAttempts = 0;

function loadPdfJs() {
  if (!pdfjsPromise) {
    // A failed module import is cached by the browser; a fresh URL makes retry useful.
    const url = pdfjsImportAttempts ? `${PDFJS_URL}?retry=${pdfjsImportAttempts}` : PDFJS_URL;
    pdfjsImportAttempts += 1;
    pdfjsPromise = import(url).then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return pdfjs;
    }).catch((error) => {
      pdfjsPromise = null;
      throw error;
    });
  }
  return pdfjsPromise;
}

function setStatus(reader, text) {
  const status = reader.querySelector('[data-pdf-status]');
  if (status) status.textContent = text;
}

function clearError(reader) {
  reader.classList.remove('has-error');
  const retry = reader.querySelector('[data-pdf-retry]');
  if (retry) retry.hidden = true;
}

function showError(reader, text) {
  reader.classList.remove('is-ready');
  reader.classList.add('has-error');
  setStatus(reader, text);
  const retry = reader.querySelector('[data-pdf-retry]');
  if (retry) retry.hidden = false;
}

function setControls(reader, state) {
  const pageLabel = reader.querySelector('[data-pdf-page]');
  const zoomLabel = reader.querySelector('[data-pdf-zoom]');
  const previous = reader.querySelector('[data-pdf-prev]');
  const next = reader.querySelector('[data-pdf-next]');
  const zoomIn = reader.querySelector('[data-pdf-zoom-in]');
  const zoomOut = reader.querySelector('[data-pdf-zoom-out]');
  if (pageLabel) pageLabel.textContent = state.pdf ? `الصفحة ${state.pageNumber} من ${state.pdf.numPages}` : 'معاينة الصحيفة';
  if (zoomLabel) zoomLabel.textContent = `${Math.round(state.zoom * 100)}٪`;
  if (previous) previous.disabled = !state.pdf || state.pageNumber <= 1 || state.rendering;
  if (next) next.disabled = !state.pdf || state.pageNumber >= state.pdf.numPages || state.rendering;
  if (zoomIn) zoomIn.disabled = !state.pdf || state.rendering || state.zoom >= MAX_ZOOM;
  if (zoomOut) zoomOut.disabled = !state.pdf || state.rendering || state.zoom <= MIN_ZOOM;
}

async function renderPage(reader, state) {
  if (!state.pdf || state.rendering) return;
  state.rendering = true;
  clearError(reader);
  reader.classList.remove('is-ready');
  setControls(reader, state);
  const canvas = reader.querySelector('[data-pdf-canvas]');
  const wrap = reader.querySelector('[data-pdf-canvas-wrap]');
  if (!canvas || !wrap) {
    state.rendering = false;
    showError(reader, 'تعذّر عرض الصفحة. حاول مجدداً أو نزّل ملف PDF.');
    setControls(reader, state);
    return;
  }
  try {
    const page = await state.pdf.getPage(state.pageNumber);
    const base = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(240, wrap.clientWidth - 20);
    const fitScale = Math.min(availableWidth / base.width, 1.6);
    const viewport = page.getViewport({ scale: fitScale * state.zoom });
    const requestedOutputScale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    const outputScale = Math.min(requestedOutputScale, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    canvas.style.width = `${Math.ceil(viewport.width)}px`;
    canvas.style.height = `${Math.ceil(viewport.height)}px`;
    canvas.setAttribute('aria-label', `الصفحة ${state.pageNumber} من الصحيفة`);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas unavailable');
    // PDF.js positions glyphs itself. Inheriting the RTL page's canvas direction
    // right-aligns each glyph and makes letters overlap on the rendered page.
    context.direction = 'ltr';
    context.textAlign = 'left';
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
      showError(reader, 'لم تكتمل معاينة الصفحة. حاول مجدداً أو نزّل ملف PDF.');
    }
  } finally {
    state.renderTask = null;
    state.rendering = false;
    if (state.needsResize) {
      state.needsResize = false;
      void renderPage(reader, state);
    } else {
      setControls(reader, state);
    }
  }
}

async function fetchPdfBytes(url, reader) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PDF_FETCH_TIMEOUT);
  try {
    const response = await fetch(url, { credentials: 'omit', cache: 'force-cache', signal: controller.signal, headers: { Accept: 'application/pdf' } });
    if (!response.ok) throw new Error(`PDF HTTP ${response.status}`);
    if (!response.body) return new Uint8Array(await response.arrayBuffer());
    const total = Number(response.headers.get('content-length')) || 0;
    const stream = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const part = await stream.read();
      if (part.done) break;
      chunks.push(part.value);
      loaded += part.value.byteLength;
      setStatus(reader, `جارٍ تحميل الصحيفة…${total ? ` ${Math.min(99, Math.round((loaded / total) * 100))}%` : ''}`);
    }
    const data = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return data;
  } finally { clearTimeout(timeout); }
}

async function openPdf(reader, state) {
  if (state.loading || state.pdf) return state.loading;
  state.loading = (async () => {
    clearError(reader);
    setStatus(reader, 'جارٍ تحميل الصحيفة للقراءة…');
    reader.classList.add('is-loading');
    setControls(reader, state);
    let loadingTask;
    try {
      const pdfjs = await loadPdfJs();
      const data = await fetchPdfBytes(reader.dataset.src, reader);
      loadingTask = pdfjs.getDocument({
        data,
        cMapUrl: '/vendor/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
        useWorkerFetch: true,
        isEvalSupported: false,
      });
      state.pdf = await loadingTask.promise;
      state.pageNumber = 1;
      await renderPage(reader, state);
    } catch (error) {
      console.warn('[alnaba] PDF preview unavailable:', error?.name || 'Error');
      if (loadingTask) void loadingTask.destroy().catch(() => {});
      showError(reader, 'تعذّر تحميل الصحيفة. حاول مجدداً أو نزّل ملف PDF.');
    } finally {
      reader.classList.remove('is-loading');
      state.loading = null;
      setControls(reader, state);
    }
  })();
  return state.loading;
}

function bindReader(reader) {
  if (reader.dataset.pdfBound === 'true') return;
  reader.dataset.pdfBound = 'true';
  const state = { pdf: null, loading: null, pageNumber: 1, zoom: 1, rendering: false, renderTask: null, resizeTimer: 0, lastWidth: reader.clientWidth, needsResize: false };
  setControls(reader, state);

  const openLink = reader.closest('.an-paper-card')?.querySelector('[data-pdf-open]');
  openLink?.addEventListener('click', () => {
    if (state.pdf && reader.classList.contains('has-error')) void renderPage(reader, state);
    else void openPdf(reader, state);
  });

  reader.addEventListener('click', async (event) => {
    const retry = event.target.closest?.('[data-pdf-retry]');
    if (retry && reader.contains(retry)) {
      if (state.pdf) await renderPage(reader, state);
      else await openPdf(reader, state);
      return;
    }
    const fullscreen = event.target.closest?.('[data-pdf-fullscreen]');
    if (fullscreen && reader.contains(fullscreen)) {
      if (!document.fullscreenElement) await reader.requestFullscreen?.();
      else await document.exitFullscreen?.();
      return;
    }
    const button = event.target.closest?.('button[data-pdf-action]');
    if (!button || !reader.contains(button) || button.disabled) return;
    await openPdf(reader, state);
    if (!state.pdf) return;
    if (button.hasAttribute('data-pdf-prev') && state.pageNumber > 1) state.pageNumber -= 1;
    else if (button.hasAttribute('data-pdf-next') && state.pageNumber < state.pdf.numPages) state.pageNumber += 1;
    else if (button.hasAttribute('data-pdf-zoom-in')) state.zoom = Math.min(MAX_ZOOM, Math.round((state.zoom + 0.5) * 100) / 100);
    else if (button.hasAttribute('data-pdf-zoom-out')) state.zoom = Math.max(MIN_ZOOM, Math.round((state.zoom - 0.5) * 100) / 100);
    else return;
    await renderPage(reader, state);
  });

  const resize = () => {
    // Canvas height changes during every render; only a width change affects fit-to-width.
    const width = reader.clientWidth;
    if (width === state.lastWidth) return;
    state.lastWidth = width;
    if (!state.pdf) return;
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(() => {
      if (state.rendering) state.needsResize = true;
      else void renderPage(reader, state);
    }, 160);
  };
  if ('ResizeObserver' in window) {
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(reader);
  } else window.addEventListener('resize', resize, { passive: true });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void openPdf(reader, state);
      }
    }, { rootMargin: '240px 0px' });
    observer.observe(reader);
  } else {
    void openPdf(reader, state);
  }
}

export function initializePdfReaders(root = document) {
  for (const reader of root.querySelectorAll('[data-pdf-reader]')) bindReader(reader);
}
