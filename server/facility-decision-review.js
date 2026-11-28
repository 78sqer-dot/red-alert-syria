import {normalizeArabic} from './places.js';
const textOf=d=>[d?.sourceText,d?.meta?.sourceText,d?.body,d?.headline,d?.title,d?.description].filter(x=>typeof x==='string'&&x.trim());
// Exact known namesake ID only. Facility qualifier must remain in the same
// short clause as the name; no replacement facility coordinates inferred.
export function unsupportedFacilitySettlement(d){
 if(!d||typeof d!=='object')return false;
 const locs=[d.location||d.loc,...(d.extra||[])].filter(Boolean);
 if(!locs.some(l=>Number(l.place_id)===11554691))return false;
 const name='(?:ب?باب الهوي)';const facility='(?:(?:ال)?مدينه|(?:ال)?منطقه)';const industrial='(?:ال)?صناعيه?';const gap='(?:(?:جديده|في|ب|ل|من|عند|ضمن) ){0,3}';
 const patterns=[new RegExp(`${facility} ${gap}${name} ${industrial}`,'u'),new RegExp(`${facility} ${industrial} ${gap}${name}`,'u')];
 return textOf(d).some(text=>normalizeArabic(text).split(/[.،؛!?\n]/u).some(clause=>patterns.some(re=>re.test(clause))));
}
export function sourceSupportsDecision(text){
 const raw=String(text||'');
 if(/[؟?]/u.test(raw))return false;
 const source=normalizeArabic(raw);
 // Positive subject + direct act grammar. No arbitrary verb-to-decision gap.
 // Unknown officials/phrases deliberately remain for review.
 // Historical/critical framing is not evidence of a new decision, even in a noun-led headline.
 const historicalOrCritical=/(?:^|\s)(?:سابق|سابقا|السابق|قديم|القديم|الماضي|الماضيه|مضي|منذ|قبل|جدل|جدلا|الجدل|للجدل|مثير|اثار|يثير|انتقاد|انتقادات)(?:\s|$)/u;
 if(historicalOrCritical.test(source))return false;
 const subject='(?:الوزير|المحافظ|الرييس(?: احمد الشرع)?|الوزاره|الحكومه|مجلس الوزراء|المجلس|وزاره (?:الطاقه|الصناعه|الاقتصاد(?: والصناعه)?|التربيه|التعليم|الداخليه|الماليه|الصحه|الدفاع|العدل|النقل))';
 const decision='قرار(?:ا|ات)?';
 // Finite subject-led acts only, with a closed concrete measure tail.
 // Standalone issuance/taking nouns and unbounded issued-decision tails hold.
 const measure='(?:تعيين (?:وزير|مدير|محافظ جديد)|احداث غرفه(?: صناعه)?|تعليق (?:الدوام|العمل|المشروع)|رفع (?:الاسعار|الدعم)|خفض الاسعار|اغلاق المعبر)';
 const issued=new RegExp(`^\\s*(?:اصدر|اصدرت|اتخذ|اتخذت|اقر|اقرت) ${subject} ${decision}(?: ب(?:شان )?${measure})?\\s*$`,'u');
 const passive=new RegExp(`^\\s*صدر ${decision} ب${measure}\\s*$`,'u');
 const announced=new RegExp(`^\\s*(?:اعلن|اعلنت) ${subject} ${decision} ب(?:شان )?${measure}\\s*$`,'u');
 const decided=new RegExp(`^\\s*(?:(?:قرر|قررت) ${subject}|تقرر) ${measure}\\s*$`,'u');
 const unsupportedContext=/(?:^|\s)(?:لم|لن|لا|ما|نفي|نفت|ينفي|ينتقد|انتقد|هل|ينتظر|انتظار|يتجنب|مرتقب|محتمل|ربما)(?:\s|$)|[؟?]/u;
 return source.split(/[.،؛!\n]/u).some(clause=>!unsupportedContext.test(clause)&&(issued.test(clause)||passive.test(clause)||announced.test(clause)||decided.test(clause)));
}
export function unsupportedDecision(d){const evidence=textOf(d)[0]||'';return d?.type==='political'&&d.politicalCategory==='decision'&&!sourceSupportsDecision(evidence);}
export function choosePoliticalCategory(text,inferred,supplied){for(const category of [inferred,supplied]){if(category&&(category!=='decision'||sourceSupportsDecision(text)))return category;}return null;}
