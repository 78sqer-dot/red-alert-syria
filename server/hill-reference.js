import {fixedGeographicReferenceRepair} from './geographic-reference.js';
import {RIMAT_HAZIM_REFERENCE} from './village-reference.js';
// Verified hill reference, never a troop coordinate or a danger area.
export const TELL_AHMAR_REFERENCE = Object.freeze({
  type:'military_incursion',draftId:'598e59c9f1',featureKind:'hill',sourceHash:'de04fac42ecd9ce11b0ebad62e23a47077f5700f9c89c89ab7620f46be901b7b',
  key:'wikimapia:27429295', alertId:'c9550bfd-ae4f-4a6f-938d-90a3e4c80740', postId:1495,
  name_ar:'تل أحمر', name_en:'Tell Ahmar',
  latitude:33.2136111111,longitude:35.8811111111,
  evidence:['http://wikimapia.org/27429295/ar/تل-عين-النورية-تل-احمر','https://golan-media.com/2026/09/14716/'],
  title:'توغل إسرائيلي في تل أحمر قرب عين النورية',
  title_en:'Reported Israeli incursion at Tell Ahmar near Ein Al-Nuriyah',
  body:"وردت تقارير عن توغل قوات إسرائيلية في تل أحمر قرب قرية عين النورية بريف القنيطرة الشمالي. ويشير التحديد على الخريطة إلى موقع التل بصورة تقريبية، وليس إلى موقع القوات بدقة، ولا يدل على نطاق خطر.",
});
export function hillReferenceRepair(a, correction, sourceDraft) {
  if(correction?.geographic_reference===undefined) return null;
  const f=correction.geographic_reference===TELL_AHMAR_REFERENCE.key?TELL_AHMAR_REFERENCE:correction.geographic_reference===RIMAT_HAZIM_REFERENCE.key?RIMAT_HAZIM_REFERENCE:null;
  return fixedGeographicReferenceRepair(a,correction,sourceDraft,f);
}
