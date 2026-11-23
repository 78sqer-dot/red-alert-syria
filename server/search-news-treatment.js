import { isSearchOnlySecurityReport, refineType } from './news-ai.js';
// Standing owner-approved treatment for future military/security search-only news.
// Explicit entry or any violence/detention keeps its specific review path.
export function searchNewsTreatment(source, location) {
  if (typeof source !== 'string' || !isSearchOnlySecurityReport(source) || refineType('attack', source) !== 'breaking') return null;
  const homes = /منازل|منزل|بيوت|بيتا|homes|houses/iu.test(source);
  const named = location?.scope === 'place' && Number.isFinite(location.latitude) && Number.isFinite(location.longitude);
  const action = homes ? 'حملة تفتيش لمنازل' : 'حملة تفتيش';
  const actionEn = homes ? 'House-search campaign' : 'Search campaign';
  return { title: action + (named ? ` في ${location.name_ar}` : ''),
    title_en: actionEn + (named ? ` in ${location.name_en || location.name_ar}` : ''),
    ...(named ? { location_display: 'approximate_point' } : {}) };
}
