// Published alert text (map + channel + share pages) carries no hashtags, links, @handles
// or source credits ("الجزيرة سوريا", "#متداول", "(المصدر: سانا)").
// The sources stay visible only in the owner's private draft card.

const MEDIA = [
  'قناة الجزيرة سوريا', 'الجزيرة سوريا', 'الجزيرة مباشر', 'قناة الجزيرة', 'الجزيرة',
  'العربية سوريا', 'قناة العربية', 'العربية الحدث', 'العربية',
  'العربي سوريا', 'التلفزيون العربي', 'قناة العربي', 'العربي الجديد', 'العربي',
  'تلفزيون سوريا', 'سوريا تلفزيون', 'تلفزيون سوريا مباشر',
  'الإخبارية السورية', 'قناة الإخبارية', 'الإخبارية', 'الاخبارية السورية', 'الاخبارية',
  'وكالة سانا', 'سانا', 'وكالة الأنباء السورية',
  'حلب اليوم', 'شبكة المحرر', 'المحرر', 'عنب بلدي', 'السورية نت', 'الحدث سوريا',
  'Al Jazeera', 'Al Arabiya', 'Al Araby', 'Syria TV', 'SANA', 'Halab Today',
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let extraNames = [];
/** Monitored source names (from the news monitor) are treated as media names too. */
export function setSourceNames(names) {
  extraNames = [...new Set((names || []).map((x) => String(x || '').trim()).filter((x) => x.length >= 3 && x.length <= 40))];
}
function mediaRe() {
  const all = [...new Set([...extraNames, ...MEDIA])].sort((a, b) => b.length - a.length).map(esc);
  return `(?:قناة\\s+|موقع\\s+|شبكة\\s+|وكالة\\s+|مراسل(?:ة)?\\s+)?(?:${all.join('|')})`;
}
const CREDIT = '(?:المصدر|مصدر|نقلاً\\s+عن|نقلا\\s+عن|نقلاً|نقلا|عبر|وفق|وفقاً\\s+لـ?|وفقا\\s+لـ?|حسب|بحسب|عن|via|source)';

export function cleanAlertText(raw) {
  if (!raw) return raw;
  let s = String(raw);
  const M = mediaRe();
  s = s.replace(/https?:\/\/\S+|www\.\S+|t\.me\/\S+/gi, ' ');
  s = s.replace(/(^|[\s(])@[A-Za-z0-9_]{4,}/g, '$1');
  s = s.replace(/#(?:متداول|عاجل|خاص|حصري|سوريا_الآن|سوريا_الان)(?![\p{L}\p{N}_])/gu, ' ');
  s = s.replace(/(^|\s)(?:متداول|عاجل)\s*[|:：]\s*/gu, '$1');
  s = s.replace(/#([\p{L}\p{N}_]+)/gu, (_, w) => w.replace(/_/g, ' '));
  // "(المصدر: الجزيرة سوريا)", "المصدر: سانا", "نقلاً عن العربية"
  s = s.replace(new RegExp(`[(\\[]\\s*(?:${CREDIT}\\s*[:：]?\\s*)?${M}\\s*[)\\]]`, 'giu'), ' ');
  s = s.replace(new RegExp(`(?:^|[\\s،,|•\\-–—])${CREDIT}\\s*[:：]?\\s*${M}(?=$|[\\s.،,:؛!؟)|])`, 'gimu'), ' ');
  s = s.replace(new RegExp(`(?:^|\\n)\\s*(?:المصدر|مصدر|source)\\s*[:：][^\\n]*`, 'giu'), '\n');
  // "الإخبارية: الاحتلال…", "مراسل الجزيرة: …", "سانا عن مدير…"
  s = s.replace(new RegExp(`(^|\\n)\\s*${M}\\s*[:：|\\-–—]\\s*`, 'giu'), '$1');
  s = s.replace(new RegExp(`(^|\\n)\\s*${M}\\s+عن\\s+`, 'giu'), '$1');
  // trailing "… | الجزيرة سوريا" / "— العربية" / a line that is only a media name
  s = s.replace(new RegExp(`\\s*[|•\\-–—]\\s*${M}\\s*$`, 'gimu'), '');
  s = s.replace(new RegExp(`(^|\\n)\\s*${M}\\s*(?=\\n|$)`, 'giu'), '$1');
  s = s.replace(/[(\[]\s*[)\]]/g, ' ');
  s = s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  s = s.replace(/\s+([.،,:؛!؟])/g, '$1').replace(/^[\s|•\-–—:،,]+|[\s|•\-–—:،,]+$/g, '');
  return s.trim();
}
