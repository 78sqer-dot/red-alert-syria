// Generic alert text strips promotional tags and outlet credits. Factual news copy
// should use cleanAttributedNewsText so attribution to a speaker/institution survives.

const MEDIA = [
  'قناة الجزيرة سوريا', 'الجزيرة سوريا', 'الجزيرة مباشر', 'قناة الجزيرة', 'الجزيرة',
  'العربية سوريا', 'قناة العربية', 'العربية الحدث', 'العربية',
  'العربي سوريا', 'التلفزيون العربي', 'قناة العربي', 'العربي الجديد', 'العربي',
  'تلفزيون سوريا', 'سوريا تلفزيون', 'تلفزيون سوريا مباشر',
  'الإخبارية السورية', 'قناة الإخبارية', 'الإخبارية', 'الاخبارية السورية', 'الاخبارية',
  'وكالة سانا', 'سانا', 'وكالة الأنباء السورية',
  'حلب اليوم', 'شبكة المحرر', 'المحرر', 'عنب بلدي', 'السورية نت', 'الحدث سوريا', 'سوريا الآن', 'سوريا الان', 'Syria Now',
  'Al Jazeera', 'Al Arabiya', 'Al Araby', 'Syria TV', 'SANA', 'Halab Today',
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Raw links never belong in public copy: full URLs, bare domains with or
// without a path (sana.sy/…), and the orphaned ".tld/path" remnant left when
// an outlet name is stripped from inside a bare URL — that remnant used to
// stay glued to the previous word (e.g. "الاقتصادي.sy/syria-and-the-world/…").
export function stripRawUrls(s) {
  return String(s)
    .replace(/https?:\/\/\S+|www\.\S+|t\.me\/\S+/gi, ' ')
    .replace(/(^|[\s(])[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:sy|com|net|org|info|news|tv|me|io|co|gov|edu)(?:\/\S*)?/giu, '$1 ')
    .replace(/\.(?:sy|com|net|org|info|news|tv|me|io)\/\S+/gi, '');
}
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
  s = stripRawUrls(s);
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

const SPEAKER_INSTITUTION = /(?:الدفاع المدني|وزارة|رئاسة|الشرطة|البلدية|محافظة|مجلس|مديرية|قيادة|الجيش|إدارة|مكتب|المركز|المستشفى|الهلال الأحمر|الأمن|الحكومة|civil defense|ministry|police|municipal|municipality|government|presidency|army|council|directorate|hospital|red crescent)/iu;
const MEDIA_IDENTITY_TERMS = /(?:قناة|مراسل|مصادر?|شبكة|وكالة|صحيفة|منصة|التلفزيون|تلفزيون|الإخبارية|الاخبارية|الرصد|أخبار|الاخبار|news|media|agency|press|channel|reporter|journal|\btv\b)/iu;
const isInstitutionSpeakerName = (name) => {
  const speaker = String(name).replace(/^مصادر\s+/iu, '');
  return SPEAKER_INSTITUTION.test(speaker) && !MEDIA_IDENTITY_TERMS.test(speaker);
};
const PRIVATE_EDITORIAL_LABEL = /(?:رأي\s*\/\s*تحليل|رأي|تحليل|opinion\s*\/\s*analysis|محاكاة\s+(?:سياسية\s+)?ساخرة(?:\s+خيالية)?(?:\s*[\[(]\s*(?:ليست\s+خبراً|not\s+news)\s*[\])])?|fictional\s+political\s+satire)\s*[:：—-]/iu;
const EDITORIAL_DIAGNOSTIC = /EDITORIAL_REVIEW_REQUIRED|REVIEW_REQUIRED|لا\s+تقدم\s+المادة\s+وقائع\s+موثقة\s+كافية|insufficient\s+(?:verified\s+)?facts\s+for\s+(?:a\s+)?policy\s+criticism/iu;

/** Private opinion/satire and internal review diagnostics are never public news copy. */
export function isPrivateEditorialCopy(raw) {
  const text = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return Boolean(text && (PRIVATE_EDITORIAL_LABEL.test(text) || EDITORIAL_DIAGNOSTIC.test(text)));
}

/** Explicit owner-approved editorial copy is public only with its matching leading label and without diagnostics. */
export function isPublicEditorialCopy(raw, mode) {
  const text = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!text || EDITORIAL_DIAGNOSTIC.test(text)) return false;
  const prefix = mode === 'opinion'
    ? /^(?:رأي\s*\/\s*تحليل|رأي|تحليل|opinion\s*\/\s*analysis)\s*[:：—-]/iu
    : mode === 'satire'
      ? /^(?:محاكاة\s+(?:سياسية\s+)?ساخرة\s+خيالية(?:\s*[\[(]\s*(?:ليست\s+خبراً|not\s+news)\s*[\])])?|fictional\s+political\s+satire)\s*[:：—-]/iu
      : null;
  return Boolean(prefix?.test(text));
}

/** Remove media-outlet/reporting credits from public copy without stripping attributed speakers or institutions. */
export function cleanPublicNewsAttribution(raw, privateNames = []) {
  if (!raw) return raw;
  let text = stripRawUrls(String(raw));
  const tidyNames = (values) => [...new Set(values.map((value) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((name) => name.length >= 3 && name.length <= 80))].sort((a, b) => b.length - a.length);
  const mediaNames = tidyNames(MEDIA);
  const privateSourceNames = tidyNames([...extraNames, ...(Array.isArray(privateNames) ? privateNames : [])]);
  const role = '(?:مراسل(?:ة)?|مصادر?|مصدر|وسائل(?:\\s+الإعلام)?|قناة|موقع|شبكة|وكالة|صحيفة|منصة)';
  const verb = '(?:أفاد(?:ت)?|قال(?:ت)?|ذكر(?:ت)?|نقل(?:ت)?|أوضح(?:ت)?|كشف(?:ت)?|أكد(?:ت)?|أشار(?:ت)?)';
  if (mediaNames.length) {
    const outlet = `(?:${mediaNames.map(esc).join('|')})`;
    const attributedLead = new RegExp(`(^|[\\s،,;|•—–])(?:(?:${verb})\\s+)?(?:${role}\\s+)?(?:قناة\\s+|موقع\\s+|شبكة\\s+|وكالة\\s+)?${outlet}\\s*(?:بأن|أن|[:：|]|—|–)\\s*`, 'gimu');
    text = text.replace(attributedLead, '$1');
    const mediaRole = new RegExp(`(^|[\\s،,;|•—–])${role}\\s+(?:قناة\\s+|موقع\\s+|شبكة\\s+|وكالة\\s+)?${outlet}(?=\\s|$|[:：،,])`, 'gimu');
    text = text.replace(mediaRole, '$1');
    const outletLink = new RegExp(`\\s+(?:لـ?|إلى|عن|من|عبر|على|في)\\s*(?:قناة\\s+|موقع\\s+|شبكة\\s+|وكالة\\s+)?${outlet}(?=\\s|$|[،,.;:؛!?؟])`, 'giu');
    text = text.replace(outletLink, ' ');
    text = text.replace(new RegExp(`(^|\\n)\\s*${outlet}\\s*(?=\\n|$)`, 'giu'), '$1');
  }
  const removablePrivateSourceNames = privateSourceNames.filter((name) => !isInstitutionSpeakerName(name));
  if (removablePrivateSourceNames.length) {
    const outlet = `(?:${removablePrivateSourceNames.map(esc).join('|')})`;
    const sourceLead = new RegExp(`(^|[\\s،,;|•—–(])(?:(?:${verb})\\s+)?${role}\\s+(?:قناة\\s+|موقع\\s+|شبكة\\s+|وكالة\\s+)?${outlet}(?=$|[\\s:：،,.;])`, 'gimu');
    text = text.replace(sourceLead, '$1');
    text = text.replace(new RegExp(`(^|\\n)\\s*${outlet}\\s*[:：|—–-]\\s*`, 'gimu'), '$1');
    const sourceLink = new RegExp(`\\s+(?:لـ?|إلى|عن|من|عبر|على|في)\\s*(?:قناة\\s+|موقع\\s+|شبكة\\s+|وكالة\\s+)?${outlet}(?=\\s|$|[،,.;:؛!?؟])`, 'giu');
    text = text.replace(sourceLink, ' ');
    const sourceAttribution = new RegExp(`(^|[\\s،,;|•—–(])${verb}\\s+(?:قناة\\s+|موقع\\s+|شبكة\\s+|وكالة\\s+)?${outlet}(?=\\s*(?:بأن|أن|إن|[:：|]))`, 'gimu');
    text = text.replace(sourceAttribution, '$1');
  }
  text = cleanAttributedNewsText(text, [...(Array.isArray(privateNames) ? privateNames : []), ...MEDIA]);
  if (privateSourceNames.some((name) => !isInstitutionSpeakerName(name) && String(raw).includes(name))) {
    text = text.replace(new RegExp(`(^|\\n)([\\s•\\-–—]*)${verb}\\s*[:：]\\s*`, 'gimu'), '$1$2');
  }
  return String(text || '').replace(/^[\s،,;|•—–:-]+|[\s،,;|•—–:-]+$/g, '').replace(/\s+/g, ' ').trim();
}

/** Sanitize public news copy while preserving story attribution and removing private feed identities. */
export function cleanAttributedNewsText(raw, privateNames = []) {
  if (!raw) return raw;
  let s = String(raw)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/#([\p{L}\p{N}_]+)/gu, (_, word) => word.replace(/_/g, ' '));
  s = stripRawUrls(s)
    .replace(/(^|[\s(])@[A-Za-z0-9_]{4,}/g, '$1');
  const names = [...new Set([
    ...extraNames,
    ...(Array.isArray(privateNames) ? privateNames : []),
  ].map((value) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((name) => name.length >= 3 && name.length <= 80))].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const privateName = new RegExp(`(?<![\\p{L}\\p{N}_])${esc(name)}(?![\\p{L}\\p{N}_])`, 'giu');
    const speech = '(?:قال(?:ت)?|أفاد(?:ت)?|ذكر(?:ت)?|أوضح(?:ت)?|أكد(?:ت)?|صرح(?:ت)?|أعلن(?:ت)?|نقل(?:ت)?)';
    const attribution = new RegExp(`(?:${speech}|مصادر?|المصدر)\\s+$`, 'iu');
    s = s.replace(privateName, (match, offset, fullText) => {
      const before = fullText.slice(0, offset);
      const after = fullText.slice(offset + match.length);
      const completeInstitutionSource = /^مصادر\s+/iu.test(name) && !before.trim();
      return isInstitutionSpeakerName(name)
        && (completeInstitutionSource || attribution.test(before))
        && /^\s*(?:[:：،;]|بأن|أن|إن)/iu.test(after) ? match : ' ';
    });
  }
  s = s.replace(/(^|\n)\s*(?:المصدر|مصدر|source)\s*[:：]\s*(?=\n|$)/giu, '$1')
    .replace(/(^|\n)\s*[:：|•\-–—]+\s*/gmu, '$1');
  s = s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  s = s.replace(/\s+([.،,:؛!؟])/g, '$1').trim();
  return s;
}
