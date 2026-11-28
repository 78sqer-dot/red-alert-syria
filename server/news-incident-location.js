import {normalizeArabic as N,getGov} from './places.js';
const key=s=>N(s).replace(/(^| )ال/g,'$1');
const contains=(s,n)=>(' '+key(s)+' ').includes(' '+key(n)+' ');
// Positive qualification only: unfamiliar clauses stay unresolved for review.
const prose=s=>N(s).replace(/[،,:؛.\n]/gu,' ').replace(/\s+/gu,' ').trim();
const FIRE_PREFIXES=new Set(['حريق','حريق في','اندلاع حريق في منزل','اندلاع حريق في احد المنازل','اظهرت مقاطع فيديو اليوم اندلاع حريق في احد المنازل']);
const FIRE_CONTINUATIONS=new Set(['','وبينت المشاهد تصاعد الدخان','وتصاعد الدخان واعمده اللهب','وتمكنت الفرق من السيطره',
 'وبينت المشاهد تصاعد السنه اللهب واعمده الدخان وافادت مصادر محليه ان فرق الدفاع المدني توجهت للمكان وعملت علي تطويق النيران قبل تمدده الي باقي المنازل المجاوره ومحل تجاري اسفل منه قبل ان تتم السيطره عليه دون تسجيل اصابات']);
const safeUrbanFire=(text,match)=>FIRE_PREFIXES.has(prose(text.slice(0,match.index)))&&FIRE_CONTINUATIONS.has(prose(text.slice(match.index+match[0].length)));
// A singular named locality is not its district, a nearby city or two tokens of a compound name.
export function newsIncidentLocations(source,main,extra=[]) {
 const text=String(source||'');
 if(!text)return {location:main,extra};
 // A nearby coastal town is not an offshore earthquake epicentre.
 if (/(?:هز[ةه] ارضي[ةه]|زلزال)/u.test(N(text)) && /(?:في البحر|قباله الساحل)/u.test(N(text)) && /شمال (?:مدينه )?اللاذقيه/u.test(N(text)) && /(?:قرب|بالقرب من)\s+(?:منطقه\s+)?كسب/u.test(N(text))) {
  const label='البحر شمال اللاذقية قرب كسب';
  return {location:{scope:'governorate',name_ar:label,name_en:'Offshore north of Latakia near Kassab',short_ar:label,short_en:'Offshore north of Latakia near Kassab',governorate:'02',governorate_ar:'اللاذقية',governorate_en:'Latakia'},extra:[]};
 }

 // Explicit Hama-city neighbourhood is not the same-named Suqaylabiyah town.
 if (/(?:حي|منطقه) الشريعه (?:بمدينه|في مدينه) حماه/u.test(N(text))) {
  const label='حي الشريعة بمدينة حماة';
  return {location:{scope:'governorate',name_ar:label,name_en:'Al-Sharia neighborhood, Hama city',short_ar:label,short_en:'Al-Sharia neighborhood, Hama city',governorate:'10',governorate_ar:'حماة',governorate_en:'Hama'},extra:[]};
 }
 // Bind a known neighborhood only when its explicit city matches its governorate
 // capital and no separate framed incident follows. Never use this for residence.
 const urban=text.match(/(?:^|[\s،,:؛])(?:في\s+)?ب?حي\s+([\p{L}\s]{2,40}?)\s+في\s+مدينة\s+([\p{L}\s]{2,25}?)(?=[،,:؛.\n]|$)/u);
 if(urban && main?.scope==='place' && Number.isFinite(main.latitude) && Number.isFinite(main.longitude)
   && key(main.name_ar)===key('حي '+urban[1].trim())
   && key(urban[2].trim())===key(getGov(main.governorate)?.ar||'')
   && safeUrbanFire(text,urban) ) {
  return {location:{...main},extra:extra.filter(l=>contains(text,l.name_ar))};
 }
 const facility = text.match(/(?:^|[\s،,:؛])معبر\s+([\p{L}\s]{2,45}?)(?=\s+(?:الحدودي|بريف|في|بمحافظة)|[،,:؛.\n]|$)/u);
 const ruralName=String(main?.name_ar||'').replace(/^ريف\s+/,'');
 const rural = ruralName && new RegExp('(?:^| )ب?ريف (?:مدينه |بلده |قريه )?'+N(ruralName)+'(?: |$)').test(N(text));
 const matches=rural ? ['ريف '+ruralName] : facility ? ['معبر '+facility[1].trim()] : [...text.matchAll(/(?:^|[\s،,:؛])(?:[وفبلك]?(?:بلدة|قرية|قريتي|قريتين|بلدتي|بلدتين|مخيم|مدينة|منطقة|منطقه|حي))\s+["«]?([\p{L}\s]{2,65}?)(?=["»،,:؛.\n]|\s+(?:أسفر|وانفجار|بريف|ريف|في ريف|بمنطقة|بمنطقه|في منطقة|في منطقه|شرقي|غربي|شمالي|جنوبي|شرق|غرب|شمال|جنوب|التابعة|التابعه|بمحافظة|بمحافظه|في محافظة|في محافظه)|$)/gu)].filter(m=>{
  // A town frame nested in a countryside/administrative phrase is context,
  // not a second incident. Sentence-separated incidents remain independent.
  const prefix=N(text.slice(0,m.index).split(/[،,:؛.\n]/u).pop());
  const nestedArea=/^بمنطق[ةه] /u.test(m[0].trim()) && !/(?:^| )وانفجار (?:اخر|ثان)(?: |$)/u.test(prefix) && /(?:^| )(?:ب?قريه|ب?بلده) /.test(prefix);
  return !nestedArea && !/(?:^| )(?:ب?ريف|بمنطقه|في منطقه|لناحيه|ناحيه)$/.test(prefix);
 }).map(m=>m[1].trim());
 const names=[...new Set(matches.map(key))];
 const candidates=[main,...extra].filter(Boolean);
 // Preserve a supported multi-location report. If any framed name is unresolved,
 // retain all labels without borrowing an incidental candidate's coordinates.
 if(!names.length || (names.length>1 && names.every(n=>candidates.some(l=>key(l.name_ar)===n))))return {location:main,extra:extra.filter(l=>contains(text,l.name_ar)&&!new RegExp('(?:التابعه|اداريا|ناحيه)\\s+(?:لناحيه\\s+)?'+N(l.name_ar)).test(N(text)))};
 const label=matches.join(' / ');
 const exact=candidates.find(l=>key(l.name_ar)===key(label));
 if(exact)return {location:{...exact,short_ar:[exact.name_ar,exact.governorate_ar].filter((x,i,a)=>x&&a.indexOf(x)===i).join(' - '),short_en:[exact.name_en,exact.governorate_en].filter((x,i,a)=>x&&a.indexOf(x)===i).join(' - ')},extra:[]};
 // The named locality is missing in our gazetteer. Keep its name, never borrow a partial match's coordinates.
 const gov=getGov(main?.governorate)||null;
 const location={scope:'governorate',name_ar:label,name_en:label,governorate:gov?.code||main?.governorate,governorate_ar:gov?.ar||main?.governorate_ar,governorate_en:gov?.en||main?.governorate_en};
 location.short_ar=[label,location.governorate_ar].filter(Boolean).join(' - ');
 location.short_en=[label,location.governorate_en].filter(Boolean).join(' - ');
 return {location,extra:[]};
}
export function assertNewsLanguageCopy(copy){
 if(/[\p{Script=Arabic}][A-Za-z]{3,}|[A-Za-z]{3,}[\p{Script=Arabic}]/u.test(String(copy||'')))throw Error('Mixed-language generated news copy requires review');
}
