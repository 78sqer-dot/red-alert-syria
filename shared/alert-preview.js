/** Full retained copy wins over title-like preview descriptions. */
export function alertPreviewText(alert, language = 'ar') {
  const a = alert || {};
  const candidates = language === 'en'
    ? [a.body_en, a.body, a.description_en, a.description]
    : [a.body, a.description, a.description_en];
  const title = String(language === 'en' ? a.title_en || a.title || '' : a.title || '').trim();
  return candidates.map((value) => String(value || '').trim()).find((value) => value && value !== title) || '';
}
