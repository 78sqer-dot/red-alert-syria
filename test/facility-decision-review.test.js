import test from 'node:test';import assert from 'node:assert/strict';import{unsupportedFacilitySettlement,sourceSupportsDecision,choosePoliticalCategory,unsupportedDecision}from'../server/facility-decision-review.js';import{ensureDraftCardLocation,ensureBuiltAlertLocation}from'../server/publish-location-guard.js';
const source='وزير الصناعة ومحافظ إدلب يضعان حجر الأساس لمشروع توسعة مدينة باب الهوى الصناعية.';
const loc={scope:'place',place_id:11554691,latitude:35.82503,longitude:36.28424};
test('known facility collision holds political selected settlement and final built input',()=>{const d={type:'political',sourceText:source,location:loc};assert.equal(unsupportedFacilitySettlement(d),true);assert.deepEqual(ensureDraftCardLocation(d),{action:'held',reason:'facility-settlement-conflict'});assert.equal(ensureBuiltAlertLocation({type:'political',location:loc,meta:{sourceText:source}}).action,'held');});
test('country politics remain pin-optional and unrelated place news unaffected',()=>{assert.equal(ensureDraftCardLocation({type:'political',sourceText:source,location:{scope:'country'}}).action,'exempt');assert.equal(ensureDraftCardLocation({type:'political',sourceText:'زيارة باب الهوى',location:loc}).action,'exempt');assert.equal(ensureDraftCardLocation({type:'political',sourceText:'بيان سياسي'}).action,'exempt');});
test('decision supplied without source act remains unresolved',()=>{assert.equal(choosePoliticalCategory(source,null,'decision'),null);assert.equal(choosePoliticalCategory(source,'decision',null),null);assert.equal(choosePoliticalCategory('اجتماع رسمي','meeting','decision'),'meeting');});
test('explicit decision acts stay supported, ceremony stays unsupported',()=>{for(const s of ['أصدر الوزير قراراً بإحداث غرفة صناعة','أصدرت وزارة الصناعة قراراً','قررت الحكومة تعليق المشروع'])assert.equal(sourceSupportsDecision(s),true,s);for(const s of [source,'بموجب قرار جديد','حفل وضع حجر الأساس','نقاش حول قرار سابق'])assert.equal(sourceSupportsDecision(s),false,s);});

// Independent reviewer regression cases, run as assertions.
test('independent category/facility regression probes',()=>{const ed=ensureDraftCardLocation,eb=ensureBuiltAlertLocation,sup=sourceSupportsDecision,ud=unsupportedDecision,ch=choosePoliticalCategory;const t=(name,got,want)=>assert.equal(got,want,name);
const reviewLoc={scope:'place',place_id:11554691,latitude:35.82503,longitude:36.28424};
// Facility/settlement: must hold
for(const s of ['مدينة باب الهوى الصناعية','المنطقة الصناعية في باب الهوى','المدينة الصناعية بباب الهوى','منطقة باب الهوى الصناعي'])
  t('facility draft held: '+s,ed({type:'political',sourceText:s,location:reviewLoc}).action,'held');
t('facility headline-only held',ed({type:'political',headline:'توسعة مدينة باب الهوى الصناعية',location:reviewLoc}).action,'held');
t('facility body-only held',ed({type:'political',body:'مدينة باب الهوى الصناعية',location:reviewLoc}).action,'held');
t('facility built held',eb({type:'political',location:reviewLoc,title:'x',description:'',meta:{sourceText:'مدينة باب الهوى الصناعية'}},{}).action,'held');
// Must stay exempt
t('country exempt',ed({type:'political',sourceText:'مدينة باب الهوى الصناعية',location:{scope:'country'}}).action,'exempt');
t('no pin exempt',ed({type:'political',sourceText:'بيان سياسي'}).action,'exempt');
t('plain Bab al-Hawa visit exempt',ed({type:'political',sourceText:'زيارة باب الهوى',location:reviewLoc}).action,'exempt');
// Decision support: should be true
for(const s of ['أقر مجلس الوزراء قرارا','أعلنت الوزارة قراراً بتعليق الدوام','قررت وزارة الطاقة رفع الأسعار','تقرر إغلاق المعبر','أصدرت وزارة الصناعة قرارا'])
  t('decision supported: '+s,sup(s),true);
// Decision support: should be false (ceremony / mentions other decision)
for(const s of ['وزير الصناعة ومحافظ إدلب يضعان حجر الأساس لمشروع توسعة مدينة باب الهوى الصناعية','أصدر الوزير بيانا حول قرار سابق','أصدر المحافظ تصريحا يرفض قرار المحكمة','أصدرت الوزارة بيانا ينتقد قرارا أمريكيا'])
  t('decision NOT supported: '+s,sup(s),false);
// Category fallback must not be lost
t('fallback meeting kept (inferred decision unsupported)',ch('اجتماع رسمي','decision','meeting'),'meeting');
t('fallback meeting kept 2',ch('حفل حجر الاساس','decision','meeting'),'meeting');
t('supported decision kept',ch('أصدر الوزير قرارا بإحداث غرفة','decision',null),'decision');
// Absent source: fall back to headline/body, hold if no evidence
t('no source, headline supports -> not blocked',ud({type:'political',politicalCategory:'decision',headline:'أصدر الوزير قرارا بإحداث غرفة صناعة'}),false);
t('no source, body supports -> not blocked',ud({type:'political',politicalCategory:'decision',body:'قرار وزاري بإحداث غرفة'}),true);
t('no source, no evidence -> blocked/held',ud({type:'political',politicalCategory:'decision',headline:'حفل حجر الأساس'}),true);
t('non-political decision field ignored',ud({type:'patrol',politicalCategory:'decision',sourceText:'x'}),false);

});

test('review v2 concrete wrong-classification bypasses are held',()=>{for(const x of ['أقر الوزير بأن المشروع تأخر عن قرار سابق','أقر الوزير بوجود قرار سابق','اعترف الوزير بأن القرار تأخر','قرر الوزير','قرر الوزير زيارة المشروع','أعلن الوزير أن القرار سيصدر لاحقا','أعلنت الوزارة أن قرارا سابقا ألغي'])assert.equal(sourceSupportsDecision(x),false,x);for(const x of ['أصدرت الوزارة قرارا بشأن رفع الأسعار','أصدر الرئيس أحمد الشرع قرارا بتعيين وزير','أعلنت وزارة الطاقة قرارا بخفض الأسعار','قررت الحكومة رفع الدعم','أقر مجلس الوزراء قرارا بإحداث غرفة'])assert.equal(sourceSupportsDecision(x),true,x);assert.equal(unsupportedFacilitySettlement({sourceText:'افتتاح مدينة الصناعية في حلب وزيارة باب الهوى',location:{place_id:11554691}}),false);});

test('v3 structural non-act regressions require direct subject and act',()=>{for(const t of ['أقر الوزير أن المشروع تأخر عن قرار','أقر الوزير أن المشروع تأخر عن قرار الحكومة','أعلن الوزير أن المشروع ينتظر قرارا','اعلن الوزير ان المشروع ينتظر قرارا من الحكومة','أعلن الوزير تأجيل حفل بانتظار قرار','أصدر الوزير توضيحا عن قرار','قرر الوزير','قرر الوزير زيارة المشروع','قرر الوزير وضع حجر الأساس','قرر الوزير حضور حفل تنفيذ المشروع','ناقش الوزير قرارا','أعلنت الوزارة أن قرارا ألغي','أصدر الوزير كلمة بمناسبة قرار','صدر عن الوزير تعليق على قرار','أقر الوزير بالخطأ في قرار','أعلنت الوزارة موعد صدور قرار'])assert.equal(sourceSupportsDecision(t),false,t);for(const t of ['أصدرت الوزارة قرارا بشأن رفع الأسعار','أصدر الرئيس أحمد الشرع قرارا بتعيين وزير','أعلنت وزارة الطاقة قرارا بخفض الأسعار','قررت الحكومة رفع الدعم','أقر مجلس الوزراء قرارا بإحداث غرفة','قرر مجلس الوزراء تعليق الدوام'])assert.equal(sourceSupportsDecision(t),true,t);});

test('polarity question pending critique and generic execution stay held',()=>{for(const s of ['ينتظر المجلس اصدار قرار','يتجنب الوزير اتخاذ قرار','نفى الوزير صدور قرار','لم يصدر قرار','لم تصدر الوزارة قرارا','ينتقد الوزير قرار تعيين','انتقد الوزير قرار تعيين المحافظ','لا يوجد قرار وزاري','هل صدر قرار؟','الوزير لم يتخذ قرار تعليق','تقرر تنفيذ زيارة','نفت الحكومة اصدار قرار','لم يصدر قرار بالتعيين','أعلن الوزير قرارا','ربما صدر قرار','قرار وزاري محتمل'])assert.equal(sourceSupportsDecision(s),false,s);for(const s of ['أصدر الوزير قرارا','أصدرت وزارة الصحة قرارا بتعيين مدير','أصدر الرئيس أحمد الشرع قرارا بتعيين وزير','قررت الحكومة تعليق الدوام','أعلنت الوزارة قرارا بتعليق العمل'])assert.equal(sourceSupportsDecision(s),true,s);});

test('decision mention inside another act does not establish a decision',()=>{for(const s of ['رفض الوزير قرار تعيين المحافظ','أصدر الوزير بيانا حول قرار تعيين المحافظ','أثار قرار تعيين المحافظ جدلا','احتجاجا على قرار تعيين المحافظ','تعليقا على قرار تعيين المحافظ','يعارض الوزير قرار تعيين','وضع الوزير حجر الأساس وسط جدل حول قرار تعيين','انتقادات لقرار تعيين المحافظ','وزير الصناعة ومحافظ إدلب يضعان حجر الأساس بعد قرار تعيين المحافظ','بموجب قرار تعيين المحافظ يضع الوزير حجر الأساس','الوزير قال إن صدر قرار تعيين','احتجاجا على ما تقرر تعليق الدوام'])assert.equal(sourceSupportsDecision(s),false,s);for(const s of ['أصدر الوزير قرارا بتعيين وزير','قررت الحكومة تعليق الدوام'])assert.equal(sourceSupportsDecision(s),true,s);});

test('noun-led old or critical decisions are not newly issued acts',()=>{for(const s of ['قرار تعيين محافظ أثار جدلا','قرار وزاري سابق','قرار تعيين صدر الشهر الماضي','قرار تعيين صدر منذ شهر','قرار تعيين محافظ، أثار جدلا','قرار وزاري قديم','قرار تعيين صدر قبل شهر','قرار تعيين المحافظ يثير جدلا','قرار تعيين المحافظ يثير الجدل'])assert.equal(sourceSupportsDecision(s),false,s);for(const s of ['صدر قرار بتعيين محافظ جديد'])assert.equal(sourceSupportsDecision(s),true,s);});

test('noun-only framing is conservatively held regardless of trailing narrative',()=>{for(const s of ['قرار وزاري بإحداث غرفة صناعة','قرار تعيين محافظ','قرار وزاري بإحداث غرفة','قرار تعيين محافظ جديد','قرار تعيين محافظ جديد لإدلب','قرار تعيين المحافظ الذي صدر في آب','قرار تعيين المحافظ كان مفاجئا','قرار تعيين المحافظ لاقى اعتراضا','قرار تعيين المحافظ الذي اتخذ في 2024','وضع حجر الأساس. قرار تعيين المحافظ موضع نقاش'])assert.equal(sourceSupportsDecision(s),false,s);});

test('standalone issuance and unbounded act tails held',()=>{for(const s of ['صدر قرار تعيين محافظ','صدر قرار تعيين المحافظ كان مفاجئا','صدر قرار تعيين المحافظ لاقى اعتراضا','صدر قرار تعيين المحافظ في آب','اتخاذ قرار تعيين المحافظ كان خطأ','اصدار قرار بتعيين محافظ','أصدر الوزير قرارا بتعيين محافظ كان مفاجئا','قرر الوزير تعليق الدوام الذي اتخذ في 2024'])assert.equal(sourceSupportsDecision(s),false,s);});

test('raw question punctuation holds direct act sentences before normalization',()=>{for(const s of ['أصدر الوزير قرارا؟','أصدر الوزير قرارا?','صدر قرار بتعيين محافظ جديد؟','قررت الحكومة رفع الدعم؟','أعلنت وزارة الطاقة قرارا بخفض الأسعار?'])assert.equal(sourceSupportsDecision(s),false,s);});
