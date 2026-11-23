import {getPlace,normalizeArabic} from './places.js';
const containsPlaceName=(quote,name)=>(' '+normalizeArabic(quote).replace(/[^\p{L}\p{N}]+/gu,' ').trim()+' ').includes(' '+normalizeArabic(name).replace(/[^\p{L}\p{N}]+/gu,' ').trim()+' ');
export function resolveReviewedLocality(input,{sourceText,evidenceUrls}={}){
 if(input==null)return null;
 if(!input||Object.keys(input).some(k=>!['place_id','evidence_urls','source_place_quote'].includes(k))||!Number.isInteger(input.place_id)||!Array.isArray(input.evidence_urls)||!input.evidence_urls.length||input.evidence_urls.length>4||input.evidence_urls.some(u=>{try{return !['https:','http:'].includes(new URL(u).protocol)}catch{return true}})||typeof input.source_place_quote!=='string'||input.source_place_quote.length<2||!String(sourceText||'').includes(input.source_place_quote)||!input.evidence_urls.some(u=>(evidenceUrls||[]).includes(u)))throw Error('invalid-reviewed-locality-evidence');
 const p=getPlace(input.place_id);
 if(!p||p.region||p.rank>5||!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||![p.ar,...(p.alt||[])].some(n=>containsPlaceName(input.source_place_quote,n)))throw Error('invalid-reviewed-locality-place');
 return{kind:'locality_reference',placeId:p.id,name_ar:p.ar,name_en:p.en,latitude:p.lat,longitude:p.lon,zoom:12,label_ar:'مرجع جغرافي: '+p.ar,label_en:'Geographic reference: '+p.en,note_ar:'مرجع للبلدة أو القرية فقط، لا موقع الحادث الدقيق. دون نطاق خطر',note_en:'Locality reference only, not the precise incident location. No danger radius.',evidence:[...input.evidence_urls],sourcePlaceQuote:input.source_place_quote};
}
export function validatedManifestLocality(m){
 const ref=m?.localityReference;if(!ref)return null;
 const p=getPlace(ref.placeId);
 if(ref.kind!=='locality_reference'||!p||p.region||p.rank>5||p.lat!==ref.latitude||p.lon!==ref.longitude||p.ar!==ref.name_ar||ref.label_ar!=='مرجع جغرافي: '+p.ar)return null;
 return ref;
}
