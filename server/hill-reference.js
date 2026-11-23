// Verified hill reference, never a troop coordinate or a danger area.
export const TELL_AHMAR_REFERENCE = Object.freeze({
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
  const f=TELL_AHMAR_REFERENCE;
  if(a.id!==f.alertId || a.channel_message_id!==f.postId || a.type!=='military_incursion' || a.source!=='news' || sourceDraft?.id!=='598e59c9f1' || sourceDraft.alertId!==a.id || sourceDraft.status!=='published' || sourceDraft.postId!==1495 || sourceDraft.sourceText!=='مراسلنا: الاحتلال الإسرائيلي يتوغل في تل أحمر قرب قرية عين النورية بريف القنيطرة الشمالي' || !sourceDraft.srcs?.some(s=>s.url==='https://t.me/TelevisionSyria/98722') || correction.geographic_reference!==f.key || correction.approved_copy!==true || correction.title!==f.title || correction.title_en!==f.title_en || correction.body!==f.body || correction.description!==f.title || correction.description_en!==f.title_en || Object.keys(correction).some(k=>!['geographic_reference','approved_copy','title','title_en','body','description','description_en'].includes(k))) throw new Error('unapproved-geographic-reference-repair');
  return {place:{scope:'place',name_ar:f.name_ar,name_en:f.name_en,latitude:f.latitude,longitude:f.longitude},location:{latitude:f.latitude,longitude:f.longitude},scope:'place',extra:[],areas:[f.name_ar],zones:[],location_display:'geographic_reference',meta:{...a.meta,channelTitle:f.title,geographicReferenceAudit:{at:new Date().toISOString(),featureKey:f.key,evidence:f.evidence,priorPlace:structuredClone(a.place),priorLocation:structuredClone(a.location),priorDisplay:a.location_display||null,priorBody:a.body,priorTitle:a.title,geographicReferenceOnly:true,troopPositionVerified:false}}};
}
