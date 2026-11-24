import {places,governorates,normalizeArabic as N} from './places.js';
import {isPersonNameOnly,isGenericPlaceWord} from './news-ai.js';
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const events=/(?:اندلاع|اندلع|اصيب|اصابه|مقتل|قتل|وفاه|توفي|مشاجره|اشتباك|انفجار|انفجارا|قصف|حريق|حادث|غرق|تحليق|توغل|استهداف|اعتقال|اختطاف|مظاهره|احتجاج|وقع|وقوع|انهار|انهيار|سقوط|سقط|احتراق|احترق|اشتعال|اشتعل|دوي|سمع|سمعت|اقتحام|اقتحم|انفجر|اصطدام|اصطدم|دهس|اطلاق|اطلق|اطلقت|قصف|افتتاح|افتتح|اقيم|عقد|انعقد|ووقع|واصيب|وغرق)/gu;
const negation=/(?:^|\s)و?(?:لم|لن|نفي|نفت|ينفي|لا صحه|دون)(?:\s+\S+){0,3}\s*$/u;
const denied=(text,event)=>negation.test(text.slice(Math.max(0,event.index-45),event.index));
const role=/(?:مشافي|مشفي|مستشفي|مشفا|للعلاج|للمعالجه|نقل|ونقل|اسعف|من اهالي|من ابناء|من سكان|من قاطني|من مدينه|من بلده|من قريه|مواليد|ينحدر من|مقيم|يقيم|مسقط راس|يعمل|عمله|مكان عمل|دوامه|يسكن|سكنه|سكنه|منزل عائلته|يدرس|دراسته|جامعته|مدرسته|تعلم|كان\s+\S+(?:\s+\S+){0,3}|مديريه|وزاره|مقر|مصدر|مراسل|متحدث)/gu;
function matches(source,name){
 const t=N(source),n=N(name),out=[];const rx=new RegExp('(^|\\s)((?:وب|بال|ب|ل)?'+esc(n)+')(?=\\s|$)','gu');
 for(const m of t.matchAll(rx)){
  const start=m.index+m[1].length,end=m.index+m[0].length,before=t.slice(0,start),after=t.slice(end);
  const attached=m[2]!==n;
  const loc=attached||/(?:^|\s)(?:في|قرب|داخل|وسط|شمال|جنوب|شرق|غرب|شرقي|غربي|سماء|بسماء|بريف|ريف|بمحافظه|محافظه|مدينه|بمدينه|بلده|ببلده|قريه|بقريه|حي|بحي|منطقه)\s*$/u.test(before);
  const dateline=start===0&&new RegExp('^\\s*'+esc(name)+'\\s*[:：،-]','u').test(source);
  if((!loc&&!dateline)||isPersonNameOnly(source,name))continue;
  if(dateline){
   // Dateline is context, never an incident-place substitute. Accept only a
   // complete bounded no-geography event description, not arbitrary prose
   // minus a blacklist of prepositions. Explicit locations resolve below.
   const localDescription=/^\s*(?:(?:اصابه|مقتل|وفاه)\s+(?:[0-9٠-٩]+\s+)?(?:اشخاص|شخص|طفل|اطفال|رجل|شاب)(?:\s+(?:في|جراء|اثر)\s+مشاجره(?:\s+جماعيه)?)?|(?:اندلاع|اندلع)\s+حريق(?:\s+في\s+(?:السوق|السكن الجامعي))?)\s*$/u;
   if(!localDescription.test(t.slice(end)))continue;
  }
  const priorEvents=[...before.matchAll(events)];let e=priorEvents.at(-1);
  // Sentence-initial locative inversion binds forward only with no person/role
  // between the place and event, not a reporter/residence subordinate phrase.
  const forward=!e&&!dateline&&/^(?:في|ب|داخل|قرب|وسط)(?:\s+(?:مدينه|بلده|قريه|محافظه|منطقه|ريف))?\s*$/u.test(before);
  if(forward){
   const next=[...after.matchAll(events)][0];
   if(!next||after.slice(0,next.index).trim()||denied(after,next))continue;
   e={index:end+next.index,0:next[0]};
  }
  if(!e&&!dateline)continue; // reporter city before the event cannot become incident location
  const eventStart=e?.index??0,eventEnd=e?e.index+e[0].length:0;
  const relation=before.slice(eventEnd);
  // Require a direct event-to-locative attachment. A subject/beneficiary
  // phrase between event and place has an unresolved grammatical role, even
  // when no occupation/residence keyword is known. Fail closed instead of
  // treating an arbitrary subject's city as the incident location.
  if(e&&!forward&&!/^(?:\s*(?:جماعيه|مروري|سير|كبير|عنيف|مسلح|مسلحه|قذيفه|قذائف|صاروخ|صواريخ|منزل|مبني|دوي))*\s*(?:في|بريف|ب|قرب|داخل|وسط|شمال|جنوب|شرق|غرب|شرقي|غربي|ريف|سماء)(?:\s|ال|$)/u.test(relation)&&relation.trim())continue;
  // A subordinate ongoing activity between event and place (works/studies/
  // lives/visits) is not incident-location evidence. Conservative for unknown verbs.
  if(/(?:^|\s)[يت]\p{L}{2,}(?=\s)/u.test(relation))continue;
  const roles=[...relation.matchAll(role)];
  if(roles.length){
   const hospitalOnly=roles.every(x=>/^(?:مشافي|مشفي|مستشفي|مشفا)$/u.test(x[0]));
   const hospitalEvent=e&&/(?:حريق|انفجار|قصف|استهداف|اقتحام)/u.test(e[0])&&hospitalOnly;
   if(!hospitalEvent)continue;
  }
  if(e&&denied(t,e))continue;
  if(/(?:لم يتحدد مكان|مجهول الموقع|مكان غير معروف)/u.test(relation+' '+after))continue;
  const rural=/(?:ريف|بريف|شمال|جنوب|شرق|غرب)(?:\s+(?:شرقي|غربي))?\s+(?:(?:مدينه|بلده|قريه|محافظه)\s+)?$/u.test(before);
  out.push({start,end,rural});
 }
 return out;
}
function reference(p,evidence,source,level){
 const gov=level==='governorate',region=!!p.region;
 const name=gov?'محافظة '+p.ar:p.ar;
 return {kind:'locality_reference',...(gov?{level,governorateCode:p.code}:{placeId:p.id,...(region?{level:'region'}:{})}),name_ar:p.ar,name_en:p.en,latitude:gov?p.lat:p.lat,longitude:p.lon,zoom:gov||region?9:12,label_ar:'موقع تقريبي: '+name,label_en:'Approximate location: '+p.en,note_ar:'موقع تقريبي للمدينة أو المنطقة، وليس موقع الحادث الدقيق. دون نطاق خطر',note_en:'Approximate city or area location, not the exact incident site. No danger radius.',evidence:evidence.slice(0,4),sourcePlaceQuote:source,approximate:true};
}
function sentenceLocality(source,evidence=[]){
 if(!source||!evidence.length)return null;
 if(/(?:لم يتحدد مكان|مجهول الموقع|مكان مجهول|مكان غير معروف|بلا موقع معروف|لم يرد اسم)/u.test(N(source)))return null;
 let hits=[];
 for(const p of places){
  if(p.rank>5||isGenericPlaceWord(p.ar))continue;
  for(const name of [p.ar,...(p.region?p.alt||[]:[])])for(const span of matches(source,name))hits.push({p,name,...span});
 }
 // Long region names own their complete span, not an embedded unrelated village/capital.
 hits=hits.filter(h=>!hits.some(x=>x!==h&&x.start<=h.start&&x.end>=h.end&&(x.end-x.start>h.end-h.start)));
 let govHits=governorates.flatMap(g=>matches(source,g.ar).map(span=>({g,...span})));
 govHits=govHits.filter(h=>!govHits.some(x=>x!==h&&x.start<=h.start&&x.end>=h.end&&x.end-x.start>h.end-h.start));
 const ruralGov=govHits.filter(h=>h.rural||h.g.ar.includes(' ')||new RegExp('(?:محافظه|بمحافظه)\\s+(?:ب)?'+esc(N(h.g.ar)),'u').test(N(source)));
 if(ruralGov.length){const ids=[...new Set(ruralGov.map(h=>h.g.code))];if(ids.length!==1)return null;const g=ruralGov[0].g;const finer=hits.filter(h=>h.p.gov===g.code&&(h.p.rank>2||h.p.region)&&!h.rural);if(finer.length===1)return reference(finer[0].p,evidence,source);return reference(g,evidence,source,'governorate');}
  const unique=new Map();for(const h of hits)if(!unique.has(h.p.id))unique.set(h.p.id,h);
 hits=[...unique.values()];
 const contextGovs=governorates.filter(g=>new RegExp('(?:محافظه|ريف|بريف)\\s+'+esc(N(g.ar))+'(?=\\s|$)','u').test(N(source)));
 if(contextGovs.length===1)hits=hits.filter(h=>h.p.gov===contextGovs[0].code);
 // A unique major city may outrank same-name hamlets; never rank-pick two villages.
 hits=hits.filter(h=>!hits.some(x=>x.p.id!==h.p.id&&N(x.p.ar)===N(h.p.ar)&&x.p.rank<=2&&h.p.rank>2));

 if(hits.length>1){const fine=hits.filter(h=>h.p.rank>2||h.p.region);if(fine.length===1&&hits.every(h=>h.p.gov===fine[0].p.gov))hits=fine;}
 if(hits.length===1&&!hits[0].rural)return reference(hits[0].p,evidence,source);
 if(!hits.length&&govHits.length===1)return reference(govHits[0].g,evidence,source,'governorate');
 return null;
}

// Each independently asserted event keeps its own outcome. Unresolved is not
// equivalent to a clause without an incident: it must block a misleading single pin.
function eventFrames(source){
 const clauses=String(source||'').split(/[.؟!؛،\n]|\s+ولكن\s+/u).filter(s=>s.trim());
 return clauses.flatMap(s=>s.split(/\s+(?=و(?:وقع|حدث|اندلع|انفجر|اصيب|أصيب|قتل|قُتل|غرق|انهار|افتتح|آخر|اخر)\s)/u)).map(text=>{
  const normalized=N(text),anchors=[...normalized.matchAll(events)];
  const positive=anchors.some(e=>!denied(normalized,e));
  const implicit=/(?:^|\s)و?(?:اخر|اخري)(?:\s|$)/u.test(normalized);
  return {text,incident:positive||implicit};
 });
}
export function sourceCardLocality(source,evidence=[]){
 const frames=eventFrames(source).filter(f=>f.incident);
 if(!frames.length)return null;
 const refs=frames.map(f=>sentenceLocality(f.text,evidence));
 if(refs.some(r=>!r))return null;
 const unique=new Map(refs.map(r=>[r.placeId||r.governorateCode,r]));
 return unique.size===1?[...unique.values()][0]:null;
}
