import { config, DEFAULT_PUBLIC_URL } from './config.js';

export const alertSharePath = (id, lang = 'ar') => `/${lang === 'en' ? 'en' : 'ar'}/a/${encodeURIComponent(id)}`;
export function alertShareUrl(id, lang = 'ar', base = config.publicUrl || process.env.PUBLIC_URL || DEFAULT_PUBLIC_URL) {
  if (typeof id !== 'string' || !id) return null;
  try {
    const site = new URL(base);
    if (!['https:', 'http:'].includes(site.protocol) || site.username || site.password || site.search || site.hash || !/^\/*$/.test(site.pathname)) return null;
    return site.origin + alertSharePath(id, lang);
  } catch { return null; }
}
