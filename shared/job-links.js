// Jobs-only URL policy. Never change the shared news/media URL policy here.
// HTTP is allowed only for the observed job.sy numeric vacancy-page route.
// Keep the original scheme. Do not invent an HTTPS upgrade.
export function normalizeJobApplicationLink(raw) {
  const value = String(raw || '').trim().replace(/&amp;/g, '&');
  if (!value || value.length > 2000 || /[\s<>"'\\\u0000-\u001f\u007f]/u.test(value)) return null;
  let url; try { url = new URL(value); } catch { return null; }
  if (!url.hostname || !/^[a-z0-9.-]+$/iu.test(url.hostname) || url.username || url.password) return null;
  if (url.protocol === 'https:') return value;
  if (url.protocol !== 'http:' || url.port || !['job.sy', 'www.job.sy'].includes(url.hostname.toLowerCase())) return null;
  if (url.pathname !== '/company/vacancy/view.php' || url.hash) return null;
  if ([...url.searchParams.keys()].length !== 1 || !/^\d+$/u.test(url.searchParams.get('id') || '')) return null;
  return value;
}
export function isJobAggregatorPromoLink(raw) {
  let url; try { url = new URL(String(raw || '')); } catch { return false; }
  return ['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(url.hostname.toLowerCase())
    && /^\/syrian_job+(?:\/|$)/iu.test(url.pathname);
}
export function jobApplicationLinks(...lists) {
  const out = [];
  for (const list of lists) for (const raw of Array.isArray(list) ? list : []) {
    const value = normalizeJobApplicationLink(raw);
    if (value && !isJobAggregatorPromoLink(value) && !out.includes(value)) out.push(value);
    if (out.length === 8) return out;
  }
  return out;
}
export function jobApplicationLinksFromText(text) {
  const candidates = (String(text || '').match(/https?:\/\/[^\s<>()[\]{}]+/giu) || [])
    .map(value => value.replace(/[),.;!?،]+$/gu, ''));
  return jobApplicationLinks(candidates);
}
