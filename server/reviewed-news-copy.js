import crypto from 'node:crypto';
export const reviewedCopyHash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Release-reviewed source/copy manifests only. Request bodies cannot add entries.
export const REVIEWED_NEWS_COPIES = Object.freeze({
  "816c5721fc": {
    "type": "political",
    "title": "تقرير عن تعميم مؤرخ في 17 تشرين الثاني لصرف رواتب موظفي المصارف العامة عبر حساباتهم",
    "title_en": "Report on November 17 circular allowing public-bank staff salaries through bank accounts",
    "body": "أورد تقرير اقتصادي منشور اليوم أن وزارة المالية وافقت، في تعميم مؤرخ في 17 تشرين الثاني 2026، على صرف الرواتب الشهرية للعاملين لدى المصارف العامة عبر حساباتهم الموطّنة فيها، بدلاً من تحويلها عبر تطبيق شام كاش.\n\nويخص التعميم موظفي المصارف العامة الستة المذكورة فيه، وليس جميع العاملين في الدولة. وتشمل وسائل استلام الرواتب الصرافات الآلية ونقاط البيع ومنافذ المصارف. هذا عرض لتعميم سابق، وليس إعلاناً عن قرار جديد صدر اليوم.",
    "location": "سوريا",
    "sourceBinding": "5cb983d76f720aed4d42764d4f66baac68f66b0318e1a6ca79ff2e3a46458142",
    "publicSourcesHash": "7111def3dd9317b0d0bedfba346f15aabf5de307bb9699efc7a8edd399f993eb",
    "approvalReference": "wamid.HBgLOTYxODE5OTQ4OTMVAgASGCBBQ0FDRDM0NTNDMjMwRjkwRTFENjhBMzg3Nzk4RkVCNQA=",
    "singleSourceAcknowledgement": false,
    "verification": "source-attributed-not-independently-verified",
    "sourceNote": "Both full texts read. Economic report explicitly dates circular November17, number756/2. Original ministry circular not independently recovered. Accurate generic report attribution, no named outlet public copy. No new-rule urgency. Exact November17 circular date retained. Public-bank employees only, not whole state workforce. Source report, not independent government rule verification.",
    "imageContext": {
        "latitude": 34.85,
        "longitude": 38.6,
        "zoom": 5,
        "label_ar": "سياق: سوريا",
        "label_en": "Context: Syria",
        "note_ar": "تقرير عن تعميم 17 تشرين الثاني، لا قرار جديد اليوم",
        "note_en": "Report on a November17 circular, not a new decision today.",
        "evidence": [
            "https://t.me/ShaamNetwork/108702?embed=1&mode=tme",
            "https://aliqtisadiya.com/banking-finance/banking/bank-salary-localization-reshapes-liquidity-and-intermediary-role/"
        ]
    }
},
  "be70c52d5c": {
    "type": "political",
    "title": "مصدر صحفي: واشنطن تبحث تدريب قوات سورية على إزالة الألغام",
    "title_en": "Report: US discussing demining training for Syrian forces",
    "body": "نقل تقرير صحفي عن خمسة أشخاص مطلعين أن الولايات المتحدة تبحث مقترحاً لتدريب جنود سوريين على إزالة الألغام والتخلص الآمن من الذخائر، بمشاركة محتملة من نحو 15 دولة حليفة.\n\nلا يزال المقترح قيد النقاش ويواجه عقبات قانونية وتحفظات لدى بعض المسؤولين العسكريين السوريين. ولم تُتخذ قرارات نهائية بشأن هيكل المهمة ونطاقها، وفق متحدث باسم القيادة المركزية الأميركية. ولا يعني التقرير بدء برنامج التدريب أو إقرار عودة قوات أميركية إلى سوريا.",
    "location": "سوريا",
    "sourceBinding": "bee84bd01078de564f2eb9e251f10473744266d64d3782e57ea15d16ac68780b",
    "publicSourcesHash": "3a8bcc1ff18b968059c480aee27dcb3016d016ada652ee611bc5e2833a27a471",
    "approvalReference": "wamid.HBgLOTYxODE5OTQ4OTMVAgASGCBBQ0Q2QkI5Qzg0N0RBNzk2REMzNzUyRUM3QTdDNzM5OAA=",
    "singleSourceAcknowledgement": false,
    "verification": "source-attributed-not-independently-verified",
    "sourceNote": "Full Reuters wire inspected, one wire with syndications not independent corroboration. Five unnamed sources; proposed multinational demining training only, legal hurdles and reservations, no final decision or actual operation. November12 meeting is background, not new incident. Generic public attribution under owner preference. No wire photograph.",
    "imageContext": {
        "latitude": 34.85,
        "longitude": 38.6,
        "zoom": 5,
        "label_ar": "سياق: سوريا",
        "label_en": "Context: Syria",
        "note_ar": "مقترح قيد النقاش، لا بدء لتدريب أو عملية ميدانية",
        "note_en": "Proposal under discussion, not an underway training or field operation.",
        "evidence": [
            "https://www.al-monitor.com/originals/2026/11/exclusive-us-discussing-military-training-syrian-forces"
        ]
    }
},
  "7daae46d35": {
    "imageContext": {"latitude":33.16265,"longitude":36.0357,"zoom":13,"label_ar":"كفر ناسج–سبسبا","label_en":"Kafr Nasij-Sabsaba","note_ar":"سياق جغرافي فقط، موقع الدوي غير محدد على الطريق","note_en":"Geographic context only. Sound location on the road is unknown.","evidence":["https://ar.wikipedia.org/wiki/كفر_ناسج","http://www.fallingrain.net/world/SY/08/Sabsaba.html"]},
    "type": "breaking",
    "title": "سماع دوي على طريق كفرناسج–سبسبا بريف درعا",
    "title_en": "Local report of a boom on the Kafr Nasij-Sabsaba road",
    "body": "بحسب مصدر محلي، سُمع دوي على طريق كفرناسج–سبسبا بريف درعا. ولم نتحقق بشكل مستقل من سببه أو موقعه الدقيق.",
    "location": "طريق كفرناسج–سبسبا، ريف درعا",
    "sourceBinding": "b2ac9be1fa2d7f071d4bdf9684b906d444246a400e92cec8cb463ed8a21f8c14",
    "publicSourcesHash": "7b37cf2a946f4c57295c3b0e346c2fadfcaed279050784173caf4c278ffd0946",
    "approvalReference": "wamid.HBgLOTYxODE5OTQ4OTMVAgASGCBBQ0Q2QkI5Qzg0N0RBNzk2REMzNzUyRUM3QTdDNzM5OAA=",
    "singleSourceAcknowledgement": true,
    "verification": "source-attributed-not-independently-verified",
    "sourceNote": "Single local source. Heard sound only, not independently confirmed explosion/attack. No city-center pin and no danger ring. Needs source-bound attributed guard, not universal local-source bypass."
  },
  "91becc7c06": {
    "imageContext": {"latitude":33.62,"longitude":36.45,"zoom":10,"label_ar":"سياق: ريف دمشق","label_en":"Context: Rif Dimashq","note_ar":"خبر عن تحقيق، لا موقع حادث جديد","note_en":"Investigation report, not the location of a new incident."},
    "type": "political",
    "title": "مصدر بالداخلية يورد نتائج تحقيق مع أحمد طلال رسلان",
    "title_en": "Interior Ministry source reports investigation findings concerning Ahmad Talal Raslan",
    "body": "أورد مصدر في وزارة الداخلية نتائج تحقيق مع الملازم السابق أحمد طلال رسلان، تتضمن اتهامات بالمشاركة في زراعة ألغام وكمين العتيبة بريف دمشق. وهذه رواية المصدر عن التحقيق، ولم نتحقق بشكل مستقل من الاتهامات.",
    "location": "سوريا",
    "sourceBinding": "f1acfb143466e60202c1b9f8f1789ceaca580f179f88169eff1a08181cfb733e",
    "publicSourcesHash": "b5cb2cecb0e44d27d6f9a5dc4ffd1a4a372a5c3595900ca3634ac689ece7ea13",
    "approvalReference": "wamid.HBgLOTYxODE5OTQ4OTMVAgASGCBBQ0Q2QkI5Qzg0N0RBNzk2REMzNzUyRUM3QTdDNzM5OAA=",
    "singleSourceAcknowledgement": false,
    "verification": "source-attributed-not-independently-verified",
    "sourceNote": "Original read. Fresh report of investigation, not fresh mine incident. Do not assert guilt or confession as independent fact. Other three drafts relay same investigation and should not publish separately."
  },
  "4f2193d1a9": {
    "imageContext": {"latitude":34.94804,"longitude":36.71391,"zoom":12,"label_ar":"سياق: تومين","label_en":"Context: Tumin","note_ar":"سياق جغرافي: موطنه تومين، مكان الإفراج غير محدد","note_en":"Hometown context: Tumin. Release location is unknown.","evidence":["https://mapcarta.com/12671972"]},
    "type": "breaking",
    "title": "مصدر محلي: الإفراج عن كريم موسى النادر مساء 22 تشرين الثاني",
    "title_en": "Local source reports release of Karim Moussa Al-Nader on November 22",
    "body": "أفاد مصدر محلي بالإفراج عن كريم موسى النادر، من أبناء قرية تومين بريف حماة، مساء 22 تشرين الثاني 2026، بعد نحو 17 يوماً على اختطافه. ولم نتحقق بشكل مستقل من ملابسات الإفراج أو مكانه.",
    "location": "سوريا، مكان الإفراج غير محدد",
    "sourceBinding": "5eeece79b08a6ff319e4c17dd6cf6f7c742258115c86402e4d44563c76937f80",
    "publicSourcesHash": "7b89bf4512e423d65d8b0963f80950a3d0919bebd2c1717504d81fcb3c86b36d",
    "approvalReference": "wamid.HBgLOTYxODE5OTQ4OTMVAgASGCBBQ0Q2QkI5Qzg0N0RBNzk2REMzNzUyRUM3QTdDNzM5OAA=",
    "singleSourceAcknowledgement": true,
    "verification": "source-attributed-not-independently-verified",
    "sourceNote": "Current originalNov23 says todayNov22, explicit date retained without relative today. Tumin is hometown, not established release site. Do not assert ransom paid. Omit demanded100k and kidnappingNov5 as irrelevant background, not claim contradicted source."
  }
});
export function reviewedSourceBinding(d) {
  return reviewedCopyHash({id:d.id,sourceText:d.sourceText,srcs:d.srcs});
}
export function reviewedStateBinding(d) {
  return reviewedCopyHash({source:reviewedSourceBinding(d),type:d.type,headline:d.headline,body:d.body,loc:d.loc,extra:d.extra,politicalCategory:d.politicalCategory,hold:d.editorialHold,operator:d.operatorReview,native:d.nativeReview,undone:d.undone,duplicateOf:d.duplicateOf,alertId:d.alertId,postId:d.postId});
}
export function boundReviewedCopy(d) {
  const manifest=REVIEWED_NEWS_COPIES[d?.id],c=d?.reviewedCopy;
  return manifest && c?.version===1 && manifest.sourceBinding===reviewedSourceBinding(d) && c.copyHash===reviewedCopyHash(manifest) && c.binding===reviewedStateBinding(d)
    && d.type===manifest.type && d.headline===manifest.title && d.body===manifest.body && d.loc?.scope==='country' && d.loc?.name_ar===manifest.location && d.loc.latitude==null && d.loc.longitude==null && d.extra?.length===0 ? manifest : null;
}
export function reviewedAlertCopy(a) {
  const proof=a?.meta?.reviewedNewsCopy,manifest=REVIEWED_NEWS_COPIES[proof?.draftId];
  return manifest && a.source==='news' && proof.version===1 && proof.copyHash===reviewedCopyHash(manifest) && a.meta.dedupKey===`news:${proof.draftId}`
    && a.location===null && a.scope==='country' && a.location_display==null && (a.zones==null || (Array.isArray(a.zones)&&a.zones.length===0)) && Array.isArray(a.areas) && a.areas.length===0
    && a.type===manifest.type && a.title===manifest.title && a.title_en===manifest.title_en && a.description===manifest.title && a.body===manifest.body && a.place?.scope==='country' && a.place.name_ar===manifest.location && a.place.latitude==null && a.place.longitude==null && Array.isArray(a.extra) && a.extra.length===0
    && reviewedCopyHash(a.meta.newsSources||a.meta.political?.sources)===manifest.publicSourcesHash ? manifest : null;
}
