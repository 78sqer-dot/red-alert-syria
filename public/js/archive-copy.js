export async function copyArchiveUrl(value, {
  navigatorObject = globalThis.navigator,
  documentObject = globalThis.document,
  windowObject = documentObject?.defaultView || globalThis,
  selectionTarget = null,
} = {}) {
  const text = String(value ?? '');
  if (!text) return 'unavailable';

  try {
    if (typeof navigatorObject?.clipboard?.writeText === 'function') {
      await navigatorObject.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    // Continue with the synchronous browser fallback while the click is active.
  }

  let field;
  try {
    if (documentObject?.body && typeof documentObject.execCommand === 'function') {
      field = documentObject.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.setAttribute('aria-hidden', 'true');
      Object.assign(field.style, {
        position: 'fixed',
        left: '-9999px',
        top: '0',
        opacity: '0',
        fontSize: '16px',
        pointerEvents: 'none',
      });
      documentObject.body.append(field);
      try {
        field.focus({ preventScroll: true });
      } catch {
        field.focus();
      }
      field.select();
      field.setSelectionRange(0, text.length);
      if (documentObject.execCommand('copy')) return 'copied';
    }
  } catch {
    // The visible, selectable link remains available below.
  } finally {
    field?.remove();
  }

  try {
    if (selectionTarget && typeof documentObject?.createRange === 'function') {
      const selection = windowObject?.getSelection?.();
      if (selection) {
        const range = documentObject.createRange();
        range.selectNodeContents(selectionTarget);
        selection.removeAllRanges();
        selection.addRange(range);
        return 'select';
      }
    }
  } catch {
    // The link still supports the browser's native long-press text selection.
  }

  return 'manual';
}
