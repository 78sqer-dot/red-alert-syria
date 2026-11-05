// Turns news posts into alert candidates: a cheap keyword pre-filter (no AI cost for weather/sports/
// politics unless enabled by keywords), then one Gemini call per batch that says, for every post, whether it reports a NEW concrete
// event inside Syria, its type, the place(s) and a short neutral headline, and whether it is the same
// incident as an event we already know (published, pending, ignored). Places are then matched to the
// bot's own places database, so a draft always points at a real place of the map.
import { ALERT_TYPES, POLITICAL_CATEGORIES } from '../shared/types.js';
import { governorates, districts, searchPlaces, normalizeArabic, getGov, getDist, places } from './places.js';

export const NEWS_TYPES = ['breaking', 'political', 'smuggling_weapons', 'smuggling_drugs', 'smuggling_explosives', 'uav', 'uav_strike', 'warplane', 'helicopter', 'patrol', 'airstrike', 'missile', 'attack', 'clashes', 'assassination', 'artillery', 'explosion', 'civil', 'accident', 'protest', 'fire', 'civil_plane', 'arrest', 'death', 'martyrdom', 'brawl', 'shooting', 'weather'];
const N = normalizeArabic;
const stripAl = (w) => (w.startsWith('ال') && w.length > 3 ? w.slice(2) : w);

// ---------------------------------------------------------------- keyword pre-filter
const KW = {
  uav: ['مسيره', 'مسيرات', 'المسيره', 'درون', 'طائره مسيره', 'طائرات مسيره', 'انتحاريه'],
  uav_strike: ['استهداف بمسيره', 'استهداف بطائره مسيره', 'استهداف مسيره', 'استهدفتها مسيره', 'مسيره استهدفت', 'طائره مسيره استهدفت', 'غاره بمسيره', 'غاره بطائره مسيره', 'قصف بمسيره', 'ضربه بمسيره', 'ضربات بمسيره', 'drone strike', 'uav strike'],
  warplane: ['طيران حربي', 'الطيران الحربي', 'طائرات حربيه', 'طائره حربيه', 'الطيران الاسرائيلي', 'تحليق طيران حربي', 'تحليق طائره حربيه'],
  patrol: ['دوريه عسكريه', 'دوريات عسكريه', 'دوريه اسرائيليه', 'دوريات اسرائيليه', 'دوريه للجيش', 'دوريات للجيش', 'دوريه امنيه', 'دوريات امنيه', 'military patrol', 'military patrols', 'patrols'],
  airstrike: ['غاره', 'غارات', 'غاره جويه', 'غارات جويه', 'قصف جوي', 'قصف بالطيران الحربي', 'قصف بالطيران', 'استهداف جوي', 'هجوم جوي', 'airstrike', 'air strike'],
  helicopter: ['طيران مروحي', 'الطيران المروحي', 'تحليق مروحي', 'تحليق طيران مروحي', 'مروحيه عسكريه', 'مروحيات عسكريه', 'مروحيه', 'مروحيات', 'helicopter', 'helicopters'],
  missile: ['صاروخ', 'صواريخ', 'صاروخي', 'صاروخيه', 'قذيفه صاروخيه'],
  clashes: ['اشتباك', 'اشتباكات', 'اشتباك مسلح', 'اشتباكات مسلحة', 'مواجهات مسلحة', 'مواجهة مسلحة', 'تبادل إطلاق النار', 'تبادل إطلاق نار', 'armed clashes', 'armed clash', 'clashes', 'clash', 'exchange of fire'],
  attack: ['هجوم', 'اعتداء', 'استهداف', 'استهدف', 'اطلاق نار', 'اطلاق النار', 'رصاص', 'مسلحين', 'مسلحون', 'مسلح', 'كمين', 'مقتل', 'استشهاد', 'قتلى', 'قتيل', 'جرحى', 'اصابه', 'اصابات', 'توغل', 'اقتحام', 'حاجز', 'خطف', 'اختطاف', 'جريمه'],
  assassination: ['اغتيال', 'اغتيالات', 'اغتيل', 'اغتالت', 'محاوله اغتيال', 'عمليه اغتيال', 'assassination', 'assassinated'],
  explosion: ['انفجار', 'انفجارات', 'تفجير', 'تفجيرات', 'عبوه ناسفه', 'عبوه', 'لغم', 'الغام', 'مخلفات الحرب', 'مخلفات حرب', 'مخلفات حربيه', 'ذخائر', 'مفخخه', 'انتحاري', 'قنبله', 'دوي'],
  artillery: ['قصف', 'مدفعي', 'مدفعيه', 'قذائف', 'قذيفه', 'هاون'],
  accident: ['حادث سير', 'حوادث سير', 'حادث السير', 'حوادث السير', 'حادث', 'حوادث', 'حادث مرور', 'دراجه ناريه', 'انقلاب', 'تصادم', 'اصطدام', 'دهس', 'حادث مروري', 'تدهور سياره', 'تدهور شاحنه'],
  fire: ['حريق', 'حرائق', 'اندلاع', 'النيران', 'اشتعال', 'اخماد'],
  protest: ['مظاهره', 'مظاهرات', 'وقفه احتجاجيه', 'احتجاج', 'احتجاجات', 'اعتصام', 'تظاهر', 'يتظاهرون', 'تخرج تضامنا', 'مسيره شعبيه', 'مسيرات شعبيه', 'مسيره احتجاجيه', 'مسيرات احتجاجيه', 'مسيره غضب', 'مسيرات غضب', 'مسيره تضامنيه', 'مسيرات تضامنيه'],
  civil_plane: ['طائره مدنيه', 'هبوط اضطراري', 'طائره ركاب', 'رحله جويه', 'هبوط في مطار'],
  arrest: ['اعتقال', 'اعتقالات', 'اعتقل', 'اعتقلت', 'اعتقاله', 'توقيف', 'توقيفات', 'احتجاز', 'احتجز', 'داهمت قوات الامن'],
  martyrdom: ['استشهاد', 'استشهد', 'استشهدت', 'شهيد', 'شهيده', 'شهداء'],
  death: ['وفاه', 'توفي', 'توفيت', 'وفاته', 'وفاتها', 'انتشال جثه', 'العثور علي جثه', 'عثر علي جثه'],
  brawl: ['مشاجره', 'مشاجرات', 'شجار', 'شجارات', 'عراك', 'عراك بالايدي', 'تضارب', 'تبادل الضرب'],
  shooting: ['اطلاق نار', 'اطلاق النار', 'اطلاق رصاص', 'اصوات اطلاق نار', 'سماع اطلاق نار', 'طلقات ناريه'],
  weather: ['تحذير جوي', 'تنبيه جوي', 'اضطراب جوي', 'امطار غزيره', 'عواصف رعديه', 'هطولات مطريه', 'موجه حر', 'عاصفه ترابيه'],
  breaking: ['توغل', 'توغلت', 'توغلات', 'اقتحام', 'اقتحمت', 'حاجز تفتيش', 'مداهمه', 'حمله امنيه', 'حظر تجول', 'اختطاف', 'خطف', 'اشتباكات', 'استنفار', 'دوي',
    // foreign (mostly Israeli) army ground activity in the south: incursions, patrols, bulldozing, berms, new positions
    'الاحتلال', 'قوات الاحتلال', 'جيش الاحتلال', 'الجيش الإسرائيلي', 'القوات الإسرائيلية', 'قوة إسرائيلية', 'دورية إسرائيلية', 'آليات إسرائيلية', 'آليات عسكرية', 'دبابات', 'ميركافا',
    'جرافات', 'جرافة', 'أعمال حفر', 'أعمال الحفر', 'عمليات الحفر', 'حفر خندق', 'خنادق', 'ساتر ترابي', 'سواتر', 'تجريف', 'جرف', 'تحصينات', 'نقطة عسكرية', 'قاعدة عسكرية', 'تمركز', 'نصب حاجز', 'حاجزا', 'رتل', 'تعزيزات عسكرية', 'انتشار عسكري', 'تفجير منزل', 'نسف'],
  civil: ['انهيار', 'غرق', 'فيضان', 'سيول', 'زلزال', 'هزه ارضيه', 'الدفاع المدني', 'انقاذ', 'تسمم', 'عاصفه', 'عواصف رعديه', 'عاصفه رعديه', 'اضطراب جوي', 'هطولات غزيره', 'امطار غزيره', 'وزاره الطوارئ'],
  // Deliberately narrow event cues; broad politics/opinion vocabulary is not enough on its own.
  political: ['تصريح رسمي', 'بيان رسمي', 'موقف رسمي', 'اعلان رسمي', 'اعلانا رسميا', 'اعلان حكومي', 'اعلان حكومه', 'بيان حكومي', 'اعلان صادر عن جهه رسميه', 'بيان صادر عن جهه رسميه', 'جهة رسمية سورية', 'جهات رسمية سورية', 'مصدر رسمي سوري', 'مصادر رسمية سورية', 'تعميم', 'قال الرئيس', 'قال وزير', 'اعلن الرئيس', 'اعلنت الرئاسه', 'قرار حكومي', 'قرار رئاسي', 'قرار وزاري', 'تعيين', 'عينت الحكومه', 'مفاوضات', 'مباحثات', 'اتفاق', 'اتفاقيه', 'توقيع', 'دعم حكومي', 'دعم سوريا', 'تعاون عسكري', 'التعاون العسكري', 'التقي الرئيس', 'اجتمع الرئيس', 'لقاء رسمي', 'زياره رسميه', 'انتخابات سوريا', 'الانتخابات السوريه', 'انتخابات رئاسيه', 'syrian statement', 'syrian government decision', 'syria negotiations', 'syria election'],
};
const KW_N = Object.fromEntries(Object.entries(KW).map(([k, a]) => [k, a.map(N)]));
const has = (nt, w) => nt.includes(w);
const SMUGGLING_CUES = ['تهريب', 'مهرب', 'تهرب'].map(N);
const SMUGGLING_GOODS = [
  ['smuggling_weapons', ['سلاح', 'اسلحه', 'بندقيه', 'مسدس', 'ذخيره', 'ذخائر'].map(N)],
  ['smuggling_drugs', ['مخدر', 'كبتاغون', 'حشيش', 'هيروين', 'كوكايين', 'قنب', 'حبوب مخدره'].map(N)],
  ['smuggling_explosives', ['متفجر', 'مواد ناسفه', 'عبوه ناسفه', 'عبوات ناسفه', 'صواعق'].map(N)],
];
const ACTUAL_EXPLOSION_CUES = ['انفجار', 'انفجارات', 'انفجر', 'انفجرت', 'تفجير', 'تفجيرات', 'explosion', 'exploded', 'detonated'].map(N);
const hasActualExplosion = (text) => { const nt = N(String(text || '')); return ACTUAL_EXPLOSION_CUES.some((w) => nt.includes(w)); };
function detectedSmugglingType(text) {
  const nt = N(String(text || ''));
  if (!SMUGGLING_CUES.some((w) => nt.includes(w))) return null;
  const matches = SMUGGLING_GOODS.filter(([, words]) => words.some((w) => nt.includes(w))).map(([type]) => type);
  return matches.length === 1 ? matches[0] : null; // do not guess when a report names several contraband classes
}
/** which types' keywords appear in the (normalized) text */
export function keywordTypes(text) {
  const nt = ' ' + N(text) + ' ';
  // words split by a space to dodge filters ("انفج ار", "لغ م"): long keywords are also looked for without spaces
  const tight = nt.replace(/\s+/g, '');
  const protestMarch = /(?:مسيره|مسيرات) (?:شعبيه|احتجاجيه|تضامنيه|سلميه|حاشده|غضب)/.test(nt);
  const found = Object.keys(KW_N).filter((k) => !(k === 'uav' && protestMarch) && KW_N[k].some((w) => has(nt, w) || (w.replace(/\s+/g, '').length >= 5 && tight.includes(w.replace(/\s+/g, '')))));
  const smuggling = detectedSmugglingType(text);
  return smuggling && !found.includes(smuggling) ? [...found, smuggling] : found;
}
const POLITICAL_CATEGORY_CUES = [
  ['military_cooperation', ['تعاون عسكري', 'التعاون العسكري', 'اتفاق دفاعي']],
  ['election', ['انتخابات', 'انتخاب رئيس', 'انتخاب مجلس', 'الانتخابات']],
  ['appointment', ['تعيين', 'تعيينات', 'عين وزير', 'تعيين وزير', 'تكليف محافظ', 'تسمية وزير']],
  ['visit', ['زيارة رسمية', 'زيارة إلى', 'زار وزير', 'يزور وزير', 'وصل وزير إلى']],
  ['meeting', ['لقاء رسمي', 'اجتماع رسمي', 'اجتمع مع', 'التقى مع', 'استقبل وفدا']],
  ['negotiation', ['مفاوضات', 'مباحثات', 'جولة تفاوض', 'استئناف التفاوض']],
  ['signing', ['توقيع اتفاق', 'توقيع اتفاقية', 'توقيع مذكرة', 'وقع اتفاق', 'وقعت اتفاق', 'جرى توقيع']],
  ['treaty', ['اتفاقية', 'معاهدة']],
  ['agreement', ['اتفاق', 'اتفاقا', 'اتفاق بين']],
  ['circular', ['تعميم', 'توجيه عام', 'منشور رسمي']],
  ['decision', ['قرار', 'قررت الحكومة', 'أصدر قرارا', 'صدور قرار']],
  ['support', ['دعم حكومي', 'دعم مالي', 'دعم سياسي', 'دعم عسكري', 'تقديم الدعم']],
  ['government_announcement', ['إعلان حكومي', 'أعلنت الحكومة', 'أعلنت وزارة', 'إعلان وزارة']],
  ['official_announcement', ['إعلان رسمي', 'أعلن رسميا', 'بيان رسمي']],
  ['official_entity', ['جهة رسمية', 'مصدر رسمي', 'وزارة المالية', 'وزارة الداخلية', 'رئاسة الجمهورية']],
  ['statement', ['صرح', 'تصريح', 'قال الرئيس', 'قال الوزير', 'أفاد الوزير']],
  ['position', ['موقف رسمي', 'موقف الحكومة', 'أكدت الحكومة موقف', 'رفضت الحكومة']],
];
/** Infer a narrow political category from source wording; null leaves the supplied category for review. */
export function inferPoliticalCategory(text) {
  const source = N(String(text || ''));
  for (const [category, cues] of POLITICAL_CATEGORY_CUES) {
    if (cues.some((cue) => source.includes(N(cue)))) return category;
  }
  return null;
}
export function hasNonWeatherSignal(text) {
  const kt = keywordTypes(text);
  const nt = N(String(text || ''));
  const weatherHazards = new Set(['سيول', 'فيضان']);
  return kt.some((k) => !['weather', 'civil'].includes(k)) || NON_WEATHER_CIVIL_WORDS.some((w) => !weatherHazards.has(w) && nt.includes(w));
}
const WEATHER_HAZARD_WORDS = {
  dust: ['غبار', 'عاصفه ترابيه', 'عواصف ترابيه', 'اتربه مثاره'],
  snow: ['ثلوج', 'تساقط الثلوج', 'تساقط الثلج'],
  frost: ['صقيع', 'انجماد', 'تجمد'],
  heat: ['موجه حر', 'موجه الحر', 'ارتفاع درجات الحراره', 'حراره مرتفعه'],
  storm: ['عواصف رعديه', 'عاصفه رعديه', 'عواصف', 'رعديه', 'برق ورعد'],
  wind: ['رياح', 'هبات رياح', 'سرعه الرياح'],
  rain: ['امطار', 'هطولات مطريه', 'هطولات غزيره', 'امطار غزيره'],
};
const WEATHER_OFFICIAL = ['تحذير جوي', 'تنبيه جوي', 'انذار جوي', 'لجنه الاستجابه الطارئه', 'الارصاد الجويه', 'هيئه الارصاد', 'تتاثر المحافظه', 'اضطراب جوي عالي الشده', 'وزاره الطوارئ'];
const WEATHER_ACTION = ['يرجي', 'تجنب', 'اخذ الحيطه', 'الحذر', 'تحذير', 'تحذر', 'تنبيه', 'ضروره', 'علي المواطنين', 'الابتعاد', 'الاستعداد'];
const ROUTINE_WEATHER_WORDS = ['الطقس', 'توقعات الطقس', 'النشرة الجوية', 'حالة الجو', 'درجات الحرارة', 'الاحوال الجوية', 'weather forecast', 'daily forecast'].map(N);
const NON_WEATHER_CIVIL_WORDS = ['انهيار', 'غرق', 'فيضان', 'سيول', 'زلزال', 'هزة ارضية', 'الدفاع المدني', 'انقاذ', 'تسمم', 'اختناق', 'صعق كهربائي'].map(N);
/** Only explicit, actionable warnings (not ordinary forecasts) get the weather alert type. */
export function weatherWarningInfo(text) {
  const nt = N(String(text || ''));
  const hazard = Object.entries(WEATHER_HAZARD_WORDS).find(([, words]) => words.some((w) => nt.includes(N(w))))?.[0];
  if (!hazard) return null;
  const official = WEATHER_OFFICIAL.some((w) => nt.includes(N(w)));
  const actionable = WEATHER_ACTION.some((w) => nt.includes(N(w)));
  const severe = ['اضطراب جوي عالي الشده', 'امطار غزيره جدا', 'رياح شديده جدا', 'عواصف عنيفه'].some((w) => nt.includes(N(w)));
  if (!official || (!actionable && !severe)) return null;
  return { hazard };
}
// obviously not an event on the ground
const NOISE = ['اسعار', 'سعر صرف', 'الذهب', 'مباراه', 'المنتخب', 'كاس العالم', 'الدوري', 'الطقس', 'الارصاد', 'درجات الحراره', 'موجز اخبار', 'برنامج', 'الحلقه', 'لقاء خاص', 'مقابله', 'التقويم', 'تهنئه', 'ذكري', 'الذكري', 'امتحانات', 'مسابقه', 'المعرض', 'مؤتمر صحفي'].map(N);
const SY_WORDS = ['سوريا', 'سوريه', 'السوري', 'السوريه', 'سوري', 'دمشق', 'الجولان'].map(N);
// big Syrian place names (governorates, districts, rank<=2 places): a post from a general channel must name one
const BIG = new Set([...governorates.map((g) => N(g.ar)), ...districts.map((d) => N(d.ar)), ...places.filter((p) => p.rank <= 2).map((p) => N(p.ar))]
  .flatMap((n) => [n, stripAl(n)]).filter((n) => n.length >= 4 && !['المركز', 'مركز'].includes(n)));
for (const g of governorates) BIG.add(N(g.ar)); // short ones too: حلب، حمص
export function mentionsSyria(text) {
  const words = N(text).split(' ');
  const pre = (w) => [w, w.replace(/^[وبلف]/, ''), w.replace(/^(وب|وال|بال|لل|فال)/, 'ال')];
  const set = new Set(words.flatMap(pre).flatMap((w) => [w, stripAl(w)]));
  if (SY_WORDS.some((w) => set.has(w) || N(text).includes(w))) return true;
  for (let i = 0; i < words.length; i++) {
    for (const n of [words[i], words[i] + ' ' + (words[i + 1] || '')]) {
      for (const v of pre(n)) if (BIG.has(v) || BIG.has(stripAl(v))) return true;
    }
  }
  return false;
}
/** decide whether a post is worth a look by the AI at all */
export function prefilter(text, { general = false, breaking = false } = {}) {
  const t = String(text || '');
  if (t.replace(/\s/g, '').length < 25) return { ok: false, why: 'short' };
  const kt = keywordTypes(t);
  const nt = N(t);
  // Apply the Syria-only source gate before the weather shortcut: an official foreign warning is still foreign.
  if (general && !mentionsSyria(t)) return { ok: false, why: 'not-syria' };
  // Political posts are especially prone to foreign-news bleed; require an explicit Syrian reference.
  if (kt.includes('political') && !mentionsSyria(t)) return { ok: false, why: 'not-syria' };
  const weather = weatherWarningInfo(t);
  if (weather && !hasNonWeatherSignal(t)) return { ok: true, kt: [...new Set([...kt, 'weather'])], weather };
  const independentIncident = kt.some((k) => k !== 'weather' && k !== 'civil') || NON_WEATHER_CIVIL_WORDS.some((w) => nt.includes(w));
  if ((kt.includes('weather') || ROUTINE_WEATHER_WORDS.some((w) => nt.includes(w))) && !independentIncident) return { ok: false, why: 'routine-weather' };
  const noisy = NOISE.some((w) => nt.includes(w));
  if (!kt.length && !breaking) return { ok: false, why: 'no-keywords' };
  if (noisy && kt.length <= 1 && !breaking) return { ok: false, why: 'noise' };
  return { ok: true, kt };
}

// ---------------------------------------------------------------- places
const GOV_ALIASES = { [N('الشام')]: '', [N('العاصمه')]: '' };
const govByName = new Map();
for (const g of governorates) { govByName.set(N(g.ar), g.code); govByName.set(stripAl(N(g.ar)), g.code); }
/** "درعا" / "ريف درعا الشرقي" / "محافظة ريف دمشق" -> governorate code */
export function govCodeOf(name) {
  let n = N(name).replace(/^محافظه /, '').trim();
  if (!n || GOV_ALIASES[n] === '') return null;
  if (govByName.has(n)) return govByName.get(n);
  n = n.replace(/ (الشرقي|الغربي|الشمالي|الجنوبي|الشمالي الشرقي|الشمالي الغربي|الجنوبي الشرقي|الجنوبي الغربي|الاوسط)$/, '');
  if (govByName.has(n)) return govByName.get(n);
  if (n.startsWith('ريف ')) { const r = n.slice(4); if (govByName.has(r)) return govByName.get(r); }
  return null;
}
const PREFIX = /^(محافظه|مدينه|بلده|قريه|حي|منطقه|ناحيه|مزرعه|مخيم|جسر|طريق|اوتوستراد|اوتستراد|ساحه|سوق|محيط|قرب|بالقرب من|مدخل|اطراف|شرق|غرب|شمال|جنوب|شرقي|غربي|شمالي|جنوبي|وسط)\s+/;
function exactHits(name, govCode) {
  const q = N(name);
  if (q.length < 2) return [];
  const qs = stripAl(q);
  return searchPlaces(name, 40).filter((p) => !p.scope && (!govCode || p.gov === govCode)
    && [p.ar, ...(p.alt || [])].some((x) => { const n = N(x); return n === q || stripAl(n) === qs || n.replace(/\s/g, '') === q.replace(/\s/g, ''); }));
}
/**
 * One AI place -> a location of the map: { kind: 'place'|'district'|'governorate', placeId|distCode|govCode }.
 * Only exact name matches (inside the stated governorate when there is one): never a guess.
 */
export function resolvePlace({ name, gov } = {}) {
  const g = gov ? govCodeOf(gov) : null;
  const raw = String(name || '').trim();
  if (!raw) return g ? { kind: 'governorate', govCode: g } : null;
  const asGov = govCodeOf(raw);
  if (asGov && (!g || g === asGov)) {
    // "درعا" can be the city or the governorate: the city when name and governorate are the same word
    // (AI: {name:"درعا", gov:"درعا"}); "ريف درعا الشرقي" / "ريف دمشق" stay the governorate
    const city = N(raw) === N(getGov(asGov).ar) ? exactHits(raw, asGov).sort((a, b) => a.rank - b.rank)[0] : null;
    if (g && city && city.rank <= 2) return { kind: 'place', placeId: city.id };
    return { kind: 'governorate', govCode: asGov };
  }
  const tries = [raw];
  let s = N(raw);
  for (let i = 0; i < 3 && PREFIX.test(s); i++) { s = s.replace(PREFIX, ''); tries.push(s); }
  for (const t of tries) {
    const dist = districts.find((d) => (!g || d.gov === g) && [N(d.ar), stripAl(N(d.ar))].includes(stripAl(N(t))) && places.some((p) => p.dist === d.code));
    const hits = exactHits(t, g);
    if (hits.length) {
      const govs = new Set(hits.map((p) => p.gov));
      if (!g && govs.size > 1) continue; // same name in several governorates and none given: don't guess
      hits.sort((a, b) => a.rank - b.rank);
      return { kind: 'place', placeId: hits[0].id };
    }
    if (dist) return { kind: 'district', distCode: dist.code };
  }
  return g ? { kind: 'governorate', govCode: g } : null;
}
// generic words that are also village names somewhere: never matched from free text
const GENERIC = new Set(['الشرقي', 'الغربي', 'الشمالي', 'الجنوبي', 'المدينه', 'البلده', 'القريه', 'الطريق', 'المركز', 'الحاجز', 'السوق', 'المشفي', 'المستشفي', 'الجسر', 'الدوار', 'المنطقه', 'الريف', 'الحدود', 'الاحد', 'الاثنين', 'الثلاثاء', 'الاربعاء', 'الخميس', 'الجمعه', 'السبت', 'اليوم', 'مساء', 'صباح', 'عنصر', 'عناصر', 'الامن', 'قوات', 'الجيش', 'الاحتلال', 'مسلحين', 'مدنيين', 'اصابه', 'مقتل', 'حادث', 'سير', 'هجوم', 'قصف', 'انفجار'].map(N));
/** exact names of villages/towns of one governorate that appear as words in the text (most specific first) */
export function scanTextPlaces(text, govCode, max = 3) {
  if (!govCode) return [];
  const words = N(text).split(' ');
  const out = [];
  for (let i = 0; i < words.length && out.length < max; i++) {
    for (const len of [3, 2, 1]) {
      const raw = words.slice(i, i + len).join(' ');
      // as written first ("بلودان"), then without a joined prefix ("بدرعا" -> "درعا", "والصنمين" -> "الصنمين")
      const variants = [...new Set([raw, raw.replace(/^(وب|وال|بال|لل|فال)/, 'ال'), raw.replace(/^[وبل](?=\S{3})/, '')])];
      let hits = [];
      for (const cand of variants) {
        if (cand.length < 4 || GENERIC.has(cand) || GENERIC.has(stripAl(cand)) || govCodeOf(cand)) continue;
        hits = exactHits(cand, govCode);
        if (hits.length) break;
      }
      if (!hits.length) continue;
      if (!out.includes(hits[0].id)) out.push(hits[0].id);
      i += len - 1; break;
    }
  }
  return out;
}
/** a place name must really be in the post (no hallucinated places) */
export function nameInText(name, text) {
  const n = N(String(name || '')).replace(PREFIX, '').trim();
  if (!n) return false;
  const wanted = n.split(/\s+/).filter(Boolean);
  const words = N(String(text || '')).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const variants = (word, first) => {
    const out = new Set([word, stripAl(word)]);
    if (first) {
      const unprefixed = word.replace(/^(وال|بال|لل|فال|كال|و|ف|ب|ل|ك)/, '');
      out.add(unprefixed); out.add(stripAl(unprefixed));
    }
    return out;
  };
  return words.some((_, start) => wanted.every((part, offset) => {
    const actual = words[start + offset];
    return Boolean(actual) && [...variants(actual, offset === 0)].some((v) => v === part || v === stripAl(part));
  }));
}

// ---------------------------------------------------------------- Gemini
const TYPE_HELP = `- uav: drone (مسيّرة) flight, sighting or surveillance over a Syrian area; NOT a direct strike
- uav_strike: direct targeting or strike by an unmanned drone (استهداف/غارة/قصف بمسيّرة), distinct from routine drone activity
- warplane: military jet/warplane overflight or presence (طيران حربي، تحليق طائرة حربية); NOT a strike and NOT helicopter activity
- airstrike: a reported completed/ongoing strike by military aircraft (غارة جوية، غارات، قصف جوي); do not use for a mere overflight or for a drone strike
- helicopter: helicopter activity / overflight (طيران مروحي، تحليق مروحية، مروحيات); use this separate type when a helicopter is explicitly named, but use attack/artillery/explosion if it reports a strike or attack
- missile: missiles/rockets launched at, falling on or intercepted over a Syrian area
- assassination: an explicitly reported completed or attempted targeted killing / assassination (اغتيال), including by gunfire; keep distinct from a generic attack
- clashes: an explicit armed clash or exchange of fire between opposing groups/forces (اشتباكات مسلحة، مواجهات مسلحة، تبادل إطلاق النار); distinct from a one-sided attack or gunfire with no opposing sides
- patrol: a specifically reported military/security patrol at a Syrian place (دورية عسكرية، دورية إسرائيلية); use only for patrol presence, not a raid, shooting, or armed clash. This category always waits for human review. Keep singular/plural based on the source wording.
- attack: a non-assassination armed attack by people: shooting / gunfire at a named target or checkpoint, stabbing, armed robbery, armed kidnapping, a military incursion/raid by a foreign army into a Syrian village (e.g. Israeli forces storming/raiding a village, searching homes, arresting or shooting at people, blowing up a house); do not use for an armed clash between opposing sides
- artillery: artillery / mortar / rocket-launcher shelling (قصف مدفعي، قذائف هاون)
- smuggling_weapons: a specific, recent attempted or completed illicit transfer/interception of weapons or ammunition inside Syria; require an explicit smuggling/trafficking cue and a named Syrian place
- smuggling_drugs: a specific, recent attempted or completed illicit transfer/interception of narcotics inside Syria; require an explicit smuggling/trafficking cue and a named Syrian place
- smuggling_explosives: a specific, recent attempted or completed illicit transfer/interception of explosives inside Syria; require an explicit smuggling/trafficking cue and a named Syrian place. Do not confuse a smuggling report with an explosion event
- accident: traffic accident (حادث سير، انقلاب، تصادم، دهس)
- fire: fire (حريق) of a building, forest, crops, market…
- protest: demonstration, protest, sit-in or a public/solidarity march (مظاهرة، وقفة احتجاجية، مسيرة شعبية/احتجاجية); never confuse a public march (مسيرة) with a drone (مسيّرة)
- civil_plane: civil aircraft incident (emergency landing, crash)
- arrest: a newly reported, concrete arrest/detention/raid of a named person or group at a named Syrian place; NOT an arrest of perpetrators as follow-up to an earlier attack, routine court proceedings, or generic security claims
- death: a recent confirmed death or body found when the cause is natural, accidental or unknown; when the cause is a specific incident, choose that incident type instead
- martyrdom: explicitly reported martyrdom/death with no more specific known cause; not an obituary, condolence, anniversary or an old casualty update
- brawl: a physical civilian fight without firearms or other armed-attack indicators (مشاجرة، شجار، عراك بالأيدي); use attack/shooting when weapons, a target or an armed clash are reported
- shooting: a concrete report of gunfire without a named target, injury or armed attack; if someone/place is targeted or harmed, use attack/assassination instead
- weather: ONLY an explicit, actionable official severe-weather warning/advisory for a named Syrian place, with a hazard and safety guidance (تحذير/تنبيه جوي رسمي مع مكان وتعليمات). NOT routine forecasts. Choose weather over civil/electricity when the post warns about dangerous storms, heavy rain, snow, wind, heat, frost or dust.
- explosion: ANY explosion or blast (انفجار، تفجير، دوي انفجار): landmine (لغم), war remnants / unexploded ordnance (مخلفات حرب، ذخائر), IED / explosive device (عبوة ناسفة), car bomb (سيارة مفخخة), suicide bomber, gas cylinder / fuel tank / ammunition depot blowing up, controlled detonation of ordnance, a loud explosion heard, blowing up a house
- civil: ONLY when no other type fits: building collapse, drowning, flood, electrocution, poisoning, a body found without a known cause, a person found hanged, a missing person found dead
- breaking: another urgent, major security or humanitarian event in Syria that people need to know right now and that has none of the types above (e.g. curfew, road closed for security, major security operation starting, foreign forces setting up a checkpoint inside Syria). Israeli army ground activity inside Syria WITHOUT a raid or shooting IS an event of this type when no specific patrol is reported: vehicles/tanks advancing near or into an area, bulldozing land or uprooting trees, digging trenches, building earth berms (سواتر ترابية) or fortifications, resuming excavation, setting up a new position — mostly in Quneitra / Daraa countryside / Mount Hermon (جبل الشيخ). It counts even when it is an ongoing or resumed activity, as long as the post reports it now.`;
export function buildPrompt(items, known, nowIso) {
  const sys = `You are the news desk of "Red Alert Syria", a live alert map of Syria. You read short posts from Syrian news channels and decide which ones should become a map alert.
For EACH post return one object. Rules:
1. For non-political alerts, event=true ONLY if the post reports a concrete incident that is happening now or happened in the last hours INSIDE Syria, at a nameable place. Exception: an explicit, actionable official severe-weather warning for a named Syrian place is a weather event. For political alerts, event=true ONLY for a specific, recent Syrian-affairs development in one of the allowed political categories in rule 3; a precise location is NOT required. event=false for general political speech, opinion, analysis, commentary, interviews, vague/rumoured claims, and foreign news (Lebanon, Iraq, Israel, Palestine, Yemen, Saudi Arabia, Iran, Turkey… even if it mentions Syrians), as well as routine weather forecasts, reports/documentaries, anniversaries, statistics, aid deliveries, returns of displaced people, routine arrests or trials as such, and condemnations. Israeli army activity INSIDE Syrian territory (Quneitra, Daraa, Rif Dimashq, the separation line with the occupied Golan, Mount Hermon) is inside Syria. Reports that only summarise many past violations (monthly counts, statistics) are not events.
1b. Only Syrian PUBLIC affairs. event=false for personal or social posts: opinions, commentary, rants, poems/quotes, greetings and congratulations, religious or good-morning posts, condolences/obituaries without an incident, personal appeals ("ياريت تنشرلي"), missing-person or lost-item notices, complaints about services (potholes, garbage, electricity, water, prices), ads, promotions, courses, job offers, polls, donation/aid requests, giveaways, channel announcements, and posts that only promote a channel or a video.
1c. Posts whose source line says [LOCAL] come from local/activist channels: be stricter — for non-political alerts, event=true only for a concrete, specific incident report with a named place. A specific, attributable Syrian political development may qualify without a precise place, but not on a rumour or vague claim. event=false for rumours ("أنباء عن", "يُقال", "معلومات غير مؤكدة"), accusations or incitement without a concrete incident, and old footage.
2. Follow-ups are NOT new events: casualty updates ("ارتفاع حصيلة"), someone dying of wounds from an earlier incident, "the perpetrators were arrested", the hospital receiving the wounded of an incident already reported, a reporter's details/video of an incident already reported, re-posts, "again/مجدداً" reports of the same ongoing incident. For those: event=true, new_incident=false and same_as = the known event id (E…) or earlier post (P…) it follows up. Use new_incident=false only for a follow-up of an incident in KNOWN EVENTS / an earlier post, or a clear aftermath (casualty update, funeral, arrest of perpetrators) of an earlier incident; an activity that starts again after a pause ("يستأنف … بعد توقف") is a NEW incident. If a post is the same incident as a known event or an earlier post in this batch (same kind of incident, same area, close in time — even if described with different nearby village names, e.g. "حاجز مفرق خربا" = "قرب بلدة معربة" = "بصرى الشام" for one checkpoint attack in eastern Daraa countryside), set same_as to it.
3. type: the most specific of:
${TYPE_HELP}
Use type=political ONLY for a concrete, recent Syrian public-affairs development. Choose exactly one source-supported category: agreement, signing, treaty, circular, support, military_cooperation, statement, position, decision, appointment, official_announcement, government_announcement, official_entity, negotiation, meeting, visit, or election. Use signing only when the source reports an act of signing; use treaty for an agreement/document called an اتفاقية or معاهدة without a signing event. Distinguish appointment from decision, meeting from visit, and a direct statement from an official position. These categories are not a catch-all for routine public-service notices: weather warnings remain weather, and service complaints are not political. If no category is clearly supported by the source, set type=political and political_category="none" so it is held for human review. For every non-political type set political_category="none". Never infer or invent a place for political news; places may be empty or contain only a place explicitly stated. Do not promote generic speeches, commentary, analysis, rumours, or foreign politics to political events.
Pick the type of the core incident; it must be the most specific one. An explosion of any kind = explosion (never civil or attack), even when it hurts civilians. Any fire = fire (never civil), a road/vehicle crash = accident, a demonstration or public march = protest, a civil aircraft incident = civil_plane. Use civil only when none of these fits and use breaking only when no specific type fits. Do not classify a protest march as a drone. A standalone sound/report of gunfire with no target or victim = shooting; gunfire against a person, place or checkpoint = attack (or assassination when explicitly targeted killing). A non-armed physical quarrel = brawl. A new specific detention can be arrest; arrest of earlier incident perpetrators is a follow-up, not a new event. Use death/martyrdom only when no specific incident cause is reported. For the three smuggling types, require an explicit current smuggling/trafficking report, not mere possession, arrest, a weapons cache, or an explosion. Israeli army shelling = artillery; a completed air strike = airstrike; report only the presence or overflight of a military aircraft as warplane.
4. places: where it happened, most specific first, max 4 — list every named village/town of the incident in the post (e.g. both villages of a road "طريق عين البيضة - جباتا الخشب"). name = the Arabic place name exactly as a Syrian would write it (town/village/neighbourhood; without words like "بلدة/مدينة/قرية/ريف/حي"), gov = its Syrian governorate in Arabic (one of: دمشق، ريف دمشق، حلب، حمص، حماة، اللاذقية، طرطوس، إدلب، درعا، السويداء، القنيطرة، دير الزور، الرقة، الحسكة). For a road between two cities ("أوتوستراد دمشق درعا") give the nearest named place in the post (e.g. "خبب") or the governorate. If only the governorate is known, give name = the governorate.
5. headline: rewrite the news as ONE clean, neutral Arabic news sentence (max 140 characters) saying what happened and where — only the news itself. Never include: the channel/source/reporter name ("مراسل …", "أفاد مراسلنا", "درعا 24", "الجزيرة"…), calls to follow/subscribe/click, links, @usernames, hashtags, emojis, "متداول", greetings, or the poster's opinion.
Return a JSON array, one object per post, same order.`;
  const lines = [];
  lines.push(`Now (Damascus): ${nowIso}`);
  lines.push('', 'KNOWN EVENTS (already published, waiting for review, or dismissed):');
  if (!known.length) lines.push('(none)');
  for (const k of known) lines.push(`${k.id} | ${k.type} | ${k.where} | ${k.ago} | ${k.headline}`);
  lines.push('', 'POSTS:');
  for (const it of items) lines.push(`P${it.i} | ${it.source}${it.local ? ' [LOCAL]' : ''} | ${it.ago}\n${it.text.slice(0, 900)}\n---`);
  return { sys, user: lines.join('\n') };
}
export const AI_RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      i: { type: 'INTEGER' },
      event: { type: 'BOOLEAN' },
      type: { type: 'STRING', enum: [...NEWS_TYPES, 'none'] },
      political_category: { type: 'STRING', enum: [...Object.keys(POLITICAL_CATEGORIES), 'none'] },
      new_incident: { type: 'BOOLEAN' },
      same_as: { type: 'STRING', nullable: true },
      places: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, gov: { type: 'STRING' } }, required: ['name'] } },
      headline: { type: 'STRING' },
    },
    required: ['i', 'event', 'type', 'political_category', 'new_incident', 'places', 'headline'],
  },
};
export const aiStats = { calls: 0, fails: 0, lastError: '', lastModel: '', day: '', today: 0 };
export async function callGemini({ sys, user }, { key, models, timeoutMs = 40_000, fetchImpl = fetch } = {}) {
  if (!key) throw new Error('no GEMINI_API_KEY');
  let lastErr;
  for (const m of models) {
    try {
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: AI_RESPONSE_SCHEMA },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${m}: HTTP ${res.status} ${(j.error?.message || '').slice(0, 120)}`);
      const txt = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      const arr = JSON.parse(txt);
      if (!Array.isArray(arr)) throw new Error(`${m}: not an array`);
      aiStats.calls++; aiStats.lastModel = m;
      return arr;
    } catch (e) {
      lastErr = e; aiStats.fails++; aiStats.lastError = String(e.message || e).replace(/key=[^&\s]+/g, 'key=…').slice(0, 200);
    }
  }
  throw lastErr || new Error('AI failed');
}

// ---------------------------------------------------------------- rule-based fallback (AI unavailable)
const RULE_ORDER = ['uav_strike', 'airstrike', 'missile', 'artillery', 'explosion', 'smuggling_explosives', 'smuggling_weapons', 'smuggling_drugs', 'assassination', 'clashes', 'accident', 'fire', 'protest', 'civil_plane', 'arrest', 'brawl', 'shooting', 'martyrdom', 'death', 'helicopter', 'uav', 'warplane', 'attack', 'patrol', 'political', 'civil'];
const FOLLOW_UP = ['ارتفاع حصيله', 'ارتفاع عدد', 'القبض على منفذي', 'اعتقال منفذي', 'اعتقال مرتكبي', 'القبض علي مرتكبي', 'قبضنا علي منفذي', 'القت القبض علي منفذي', 'منفذي الهجوم', 'تفاصيل الحادث', 'ينقل', 'نتابع وصول', 'وصول اكثر من', 'وصول جثث'].map(N);
const ISRAELI_FORCE_WORDS = ['قوات الاحتلال', 'جيش الاحتلال', 'الجيش الاسرائيلي', 'القوات الاسرائيليه', 'دوريه اسرائيليه', 'آليات اسرائيليه', 'الاحتلال الاسرائيلي'].map(N);
const ISRAELI_GROUND_WORDS = ['توغل', 'توغلت', 'توغلات', 'اقتحام', 'اقتحمت', 'جرافات', 'جرافه', 'اعمال حفر', 'حفر خندق', 'تجريف', 'تحصينات', 'نقطه عسكريه', 'قاعده عسكريه', 'تمركز', 'نصب حاجز', 'ساتر ترابي', 'سواتر', 'رتل', 'تعزيزات عسكريه', 'انتشار عسكري'].map(N);
const ARMED_VIOLENCE_WORDS = ['قصف', 'غاره', 'اطلاق نار', 'اطلاق النار', 'اشتباك', 'اشتباكات', 'اصيب', 'اصابه', 'مقتل', 'استهداف', 'استهدف', 'انفجار', 'صاروخ', 'قذائف', 'هاون', 'كمين'].map(N);
const nonviolentIsraeliGroundActivity = (text) => {
  const nt = N(text);
  return ISRAELI_FORCE_WORDS.some((w) => nt.includes(w))
    && ISRAELI_GROUND_WORDS.some((w) => nt.includes(w))
    && !ARMED_VIOLENCE_WORDS.some((w) => nt.includes(w));
};
export function ruleClassify(text, { breaking = false } = {}) {
  const nt = N(text);
  const weather = weatherWarningInfo(text);
  if (weather && !hasNonWeatherSignal(text)) {
    const found = [];
    for (const g of governorates) if (nt.includes(N(g.ar)) || nt.includes(N(g.en)) || (g.alt || []).some((a) => nt.includes(N(a)))) found.push({ name: g.ar, gov: g.ar });
    return found.length ? { event: true, type: 'weather', new_incident: true, same_as: null, places: found.slice(0, 4), headline: 'تحذير جوي: ' + String(text).split('\n')[0].slice(0, 120), hazard: weather.hazard, rule: true } : null;
  }
  if (FOLLOW_UP.some((w) => nt.includes(w))) return null;
  if (!mentionsSyria(text)) return null;
  const kt = keywordTypes(text);
  const specificOther = kt.some((k) => !['attack', 'breaking', 'civil', 'weather'].includes(k));
  let type = nonviolentIsraeliGroundActivity(text) && !specificOther ? 'breaking' : RULE_ORDER.find((k) => kt.includes(k));
  const smuggling = detectedSmugglingType(text);
  if (smuggling && !hasActualExplosion(text)) type = smuggling; // ammunition/contraband keywords can overlap the generic explosion list
  if (type === 'helicopter' && HELI_ATTACK_W.some((w) => nt.includes(w))) type = 'attack';
  if (type === 'brawl' && (kt.includes('shooting') || kt.includes('attack'))) type = 'attack';
  if (type === 'shooting' && ['استهداف', 'استهدف', 'على حاجز', 'على شخص', 'على مدني', 'اصيب', 'اصابه', 'جرح', 'مقتل', 'كمين', 'هجوم', 'اشتباك', 'مسلحين', 'مسلحون'].some((w) => nt.includes(N(w)))) type = 'attack';
  if (type === 'civil_plane' && !nt.includes(N('طائره'))) type = kt.find((k) => k !== 'civil_plane' && RULE_ORDER.includes(k));
  if (!type && breaking) type = 'breaking';
  if (!type) return null;
  // places: governorate / district / place names that appear as words in the text
  const words = nt.split(' ');
  const found = [];
  for (let i = 0; i < words.length && found.length < 3; i++) {
    for (const len of [3, 2, 1]) {
      const cand = words.slice(i, i + len).join(' ').replace(/^[وبل](?=ال)/, '').replace(/^[وبل](?=[^ا\s].{2,})/u, '');
      if (cand.length < 3) continue;
      const hits = exactHits(cand, null);
      const g = govCodeOf(cand);
      if (g && len <= 2) { found.push({ name: cand, gov: getGov(g).ar }); i += len - 1; break; }
      if (hits.length && new Set(hits.map((p) => p.gov)).size === 1 && hits[0].rank <= 4 && cand.length >= 4) { found.push({ name: cand, gov: getGov(hits[0].gov).ar }); i += len - 1; break; }
    }
  }
  if (!found.length && type !== 'political') return null;
  const first = text.split('\n').find((l) => l.trim().length > 15) || text;
  return { event: true, type, new_incident: true, same_as: null, places: found, headline: first.replace(/[•:]+\s*$/, '').trim().slice(0, 140), rule: true };
}
export { getGov, getDist };

// ---------------------------------------------------------------- type safety net
// The AI sometimes falls back to the generic "civil" (or "attack") although the post names a more
// specific type. Correct it from the post text so every draft gets its own button.
const RX = (a) => a.map(N);
const EXPL_W = RX(['انفجار', 'انفجارات', 'تفجير', 'تفجيرات', 'عبوه ناسفه', 'لغم', 'الغام', 'مخلفات حرب', 'مخلفات الحرب', 'مخلفات حربيه', 'مفخخه', 'انتحاري', 'قنبله']);
const GUN_W = RX(['اطلاق نار', 'اطلاق النار', 'اطلاق الرصاص', 'رصاص', 'اشتباك', 'اشتباكات', 'طعن', 'مسلحين', 'مسلحون', 'مسلح']);
const CLASH_W = RX(['اشتباك', 'اشتباكات', 'اشتباك مسلح', 'اشتباكات مسلحه', 'مواجهات مسلحه', 'مواجهه مسلحه', 'تبادل اطلاق النار', 'تبادل اطلاق نار', 'armed clashes', 'armed clash', 'clashes', 'clash', 'exchange of fire']);
const FIRE_W = RX(['حريق', 'حرائق', 'احتراق', 'اشتعال', 'اشتعلت', 'التهمت النيران', 'النيران']);
const ACC_W = RX(['حادث سير', 'حوادث سير', 'حادث مروري', 'انقلاب سياره', 'انقلاب حافله', 'تصادم', 'دهس']);
const PROT_W = RX(['مظاهره', 'مظاهرات', 'وقفه احتجاجيه', 'اعتصام', 'احتجاج', 'مسيره شعبيه', 'مسيرات شعبيه', 'مسيره احتجاجيه', 'مسيرات احتجاجيه', 'مسيره غضب', 'مسيرات غضب', 'مسيره تضامنيه', 'مسيرات تضامنيه']);
const ARREST_W = RX(['اعتقال', 'اعتقالات', 'اعتقل', 'اعتقلت', 'توقيف', 'احتجاز', 'احتجز']);
const BRAWL_W = RX(['مشاجره', 'مشاجرات', 'شجار', 'شجارات', 'عراك', 'عراك بالايدي', 'تضارب', 'تبادل الضرب']);
const SHOOT_W = RX(['اطلاق نار', 'اطلاق النار', 'اطلاق رصاص', 'اصوات اطلاق نار', 'سماع اطلاق نار', 'طلقات ناريه']);
const MARTYR_W = RX(['استشهاد', 'استشهد', 'استشهدت', 'شهيد', 'شهيده', 'شهداء']);
const DEATH_W = RX(['وفاه', 'توفي', 'توفيت', 'وفاته', 'وفاتها', 'انتشال جثه', 'العثور علي جثه', 'عثر علي جثه']);
const SHOOT_TARGET_W = RX(['استهداف', 'استهدف', 'اطلاق النار علي', 'اطلاق رصاص علي', 'اصيب', 'اصابه', 'جرح', 'قتل', 'مقتل', 'كمين', 'هجوم', 'اشتباك', 'مسلحين', 'مسلحون']);
const AIRSTRIKE_W = RX(['غاره جويه', 'غارات جويه', 'غاره', 'غارات', 'قصف جوي', 'قصف بالطيران الحربي', 'قصف بالطيران', 'استهداف جوي', 'هجوم جوي', 'airstrike', 'air strike']);
const UAV_STRIKE_W = RX(['استهداف بمسيره', 'استهداف بطائره مسيره', 'استهداف مسيره', 'استهدفتها مسيره', 'مسيره استهدفت', 'طائره مسيره استهدفت', 'غاره بمسيره', 'غاره بطائره مسيره', 'قصف بمسيره', 'ضربه بمسيره', 'ضربات بمسيره']);
const HELI_W = RX(['طيران مروحي', 'الطيران المروحي', 'تحليق مروحي', 'تحليق طيران مروحي', 'مروحيه عسكريه', 'مروحيات عسكريه', 'مروحيه', 'مروحيات', 'helicopter', 'helicopters']);
const HELI_ATTACK_W = RX(['غاره', 'غارات', 'قصف', 'هجوم', 'استهداف', 'اشتباك', 'اطلاق نار', 'اطلاق النار', 'انفجار', 'صاروخ', 'قذائف']);
const PATROL_W = RX(['دوريه عسكريه', 'دوريات عسكريه', 'دوريه اسرائيليه', 'دوريات اسرائيليه', 'دوريه للجيش', 'دوريات للجيش', 'دوريه امنيه', 'دوريات امنيه', 'military patrol', 'military patrols', 'patrols']);
export function refineType(type, text) {
  // The classifier sometimes puts only its selected button name in the generated
  // headline. Treat that standalone label as metadata, not as evidence from the source.
  const lines = String(text || '').split('\n');
  const info = ALERT_TYPES[type] || {};
  const labels = [info.button_ar, info.ar, info.tag_ar, info.button_en, info.en, info.tag_en].filter(Boolean).map(N);
  const firstLabel = (lines[0] || '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '').trim();
  const evidenceText = labels.includes(N(firstLabel)) ? lines.slice(1).join('\n') : String(text || '');
  const nt = ' ' + N(evidenceText) + ' ';
  const any = (ws) => ws.some((w) => nt.includes(' ' + N(w) + ' ') || nt.includes(N(w)));
  if (any(PATROL_W) && ['breaking', 'civil', 'none'].includes(type) && !any([...CLASH_W, ...GUN_W, ...EXPL_W, ...AIRSTRIKE_W, ...UAV_STRIKE_W])) return 'patrol';
  if (any(CLASH_W) && ['attack', 'brawl', 'shooting', 'breaking', 'civil', 'weather', 'none', 'uav', 'warplane', 'helicopter'].includes(type)) return 'clashes';
  const smuggling = detectedSmugglingType(evidenceText);
  if (smuggling && !hasActualExplosion(evidenceText) && ['breaking', 'civil', 'arrest', 'explosion', 'none'].includes(type)) return smuggling;
  if (any(UAV_STRIKE_W) && ['warplane', 'helicopter', 'civil', 'breaking', 'weather', 'none', 'attack', 'airstrike', 'uav'].includes(type)) return 'uav_strike';
  const kt = keywordTypes(evidenceText);
  const politicalOnly = kt.includes('political') && !kt.some((k) => !['political', 'breaking', 'civil', 'weather'].includes(k));
  if (politicalOnly && ['breaking', 'civil', 'attack', 'weather', 'none'].includes(type)) return 'political';
  if (any(AIRSTRIKE_W) && ['warplane', 'helicopter', 'civil', 'breaking', 'weather', 'none', 'attack'].includes(type)) return 'airstrike';
  if (any(HELI_W)) {
    if (any(HELI_ATTACK_W) && ['warplane', 'helicopter', 'uav', 'civil', 'breaking', 'weather', 'none'].includes(type)) return 'attack';
    if (['warplane', 'helicopter', 'uav', 'civil', 'breaking', 'weather', 'none', 'attack'].includes(type)) return 'helicopter';
  }
  if (nonviolentIsraeliGroundActivity(evidenceText) && ['attack', 'civil', 'breaking'].includes(type)) return 'breaking';
  const weather = weatherWarningInfo(evidenceText);
  if (weather && !hasNonWeatherSignal(evidenceText)) return 'weather';
  // Recover explicit specific event types when Gemini has fallen back to civil/breaking/attack.
  if (['civil', 'breaking', 'attack', 'uav', 'warplane', 'weather', 'none'].includes(type)) {
    const specific = [
      ['explosion', EXPL_W],
      ['civil_plane', RX(['هبوط اضطراري', 'طائره مدنيه', 'طائره ركاب', 'تحطم طائره مدنيه'])],
      ['accident', ACC_W],
      ['protest', PROT_W],
      ['uav_strike', UAV_STRIKE_W],
      ['airstrike', AIRSTRIKE_W],
      ['assassination', RX(['اغتيال', 'اغتيالات', 'اغتيل', 'اغتالت', 'محاوله اغتيال', 'عمليه اغتيال', 'assassination', 'assassinated'])],
      ['clashes', CLASH_W],
      ['arrest', ARREST_W],
      ['brawl', BRAWL_W],
      ['shooting', SHOOT_W],
      ['martyrdom', MARTYR_W],
      ['death', DEATH_W],
      ['uav', RX(['طائره مسيره', 'طائرات مسيره', 'الطيران المسير', 'طيران مسير', 'درون', 'مسيره', 'مسيرات', 'المسيره', 'مسيره انتحاريه'])],
      ['helicopter', HELI_W],
      ['warplane', RX(['طيران حربي', 'الطيران الحربي', 'طائرات حربيه', 'طائره حربيه'])],
      ['missile', RX(['صاروخ', 'صواريخ', 'قذيفه صاروخيه'])],
      ['artillery', RX(['قصف مدفعي', 'قذائف مدفعيه', 'قذائف هاون', 'قصف بالهاون', 'مدفعيه'])],
      ['fire', FIRE_W],
      ['attack', RX(['اطلاق نار', 'اطلاق النار', 'اطلاق الرصاص', 'استهداف مسلح', 'كمين مسلح'])],
      ['breaking', RX(['حظر تجول', 'اغلاق طريق امني', 'عمليه امنيه واسعه', 'اقامه حاجز عسكري'])],
    ];
    for (const [k, ws] of specific) {
      if (!any(ws)) continue;
      if (k === 'arrest' && FOLLOW_UP.some((w) => nt.includes(N(w)))) continue;
      if (k === 'brawl' && any(GUN_W)) continue;
      if (k === 'shooting' && any(SHOOT_TARGET_W)) continue;
      if (k === 'martyrdom' && any([...EXPL_W, ...ACC_W, ...SHOOT_TARGET_W, ...RX(['قصف مدفعي', 'قصف جوي', 'صاروخ', 'صواريخ'])])) continue;
      if (k === 'death' && any(MARTYR_W)) continue;
      return k;
    }
  }
  if (type === 'attack' && any(EXPL_W) && !any(GUN_W)) return 'explosion';
  return type;
}
