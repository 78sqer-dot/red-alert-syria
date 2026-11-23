import crypto from 'node:crypto';
// One requested report, not a standing local-source policy or a factual endorsement.
export const ATTRIBUTED_ITEM = Object.freeze({
  id: '0feed567df', type: 'brawl', sourceUrl: 'https://t.me/zainaldinmaham1/143513',
  sourceName: 'زينو ياسر محاميد', sourceHandle: 'zainaldinmaham1',
  sourceText: 'مقتل الشاب صطيف محمد الحمد وإصابة سليمان محمد الحمد، جراء مشاجرة بين عائلتين في منطقة معدان عتيق بريف الرقة',
  title: 'مصدر محلي: مقتل شاب وإصابة آخر بمشاجرة في معدان عتيق',
  title_en: 'Local source reports one death and one injury in a brawl in Maadan Atiq',
  body: 'أفادت قناة زينو ياسر محاميد بمقتل الشاب صطيف محمد الحمد وإصابة سليمان محمد الحمد جراء مشاجرة بين عائلتين في منطقة معدان عتيق بريف الرقة. ولم نتحقق بشكل مستقل من الحصيلة.',
  location: 'معدان عتيق بريف الرقة',
  approvalReference: 'wamid.HBgLOTYxODE5OTQ4OTMVAgASGCBBQ0RDOUMwOEEwNkE3QjdEMUM0Q0FFQjYzNUE0MzlENgA=',
});
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const attributedDraftBinding = d => hash({ id:d.id,type:d.type,sourceText:d.sourceText,srcs:d.srcs,headline:d.headline,body:d.body,loc:d.loc,extra:d.extra,editorialHold:d.editorialHold,operatorReview:d.operatorReview,nativeReview:d.nativeReview,undone:d.undone,duplicateOf:d.duplicateOf,postId:d.postId,alertId:d.alertId,approval:d.attributedReport?.approvalReference });
export function eligibleAttributedOriginal(d) {
  const x=ATTRIBUTED_ITEM,s=d?.srcs;
  return d?.id===x.id && d.type===x.type && d.sourceText===x.sourceText && s?.length===1 && s[0].u===x.sourceHandle && s[0].name===x.sourceName && s[0].url===x.sourceUrl && s[0].local===true;
}
export function boundAttributedReport(d) {
  const x=ATTRIBUTED_ITEM,c=d?.attributedReport;
  return eligibleAttributedOriginal(d) && c?.version===1 && c.approvalReference===x.approvalReference && c.binding===attributedDraftBinding(d)
    && d.headline===x.title && d.body===x.body && d.loc?.scope==='country' && d.loc.name_ar===x.location && d.loc.latitude==null && d.loc.longitude==null && d.extra?.length===0 ? x : null;
}
export function attributedPublicationProof() { return {version:1,copyHash:hash(ATTRIBUTED_ITEM)}; }
export const ATTRIBUTED_REVISED_BODY = 'بحسب مصدر محلي، قُتل الشاب صطيف محمد الحمد وأُصيب سليمان محمد الحمد جراء مشاجرة بين عائلتين في منطقة معدان عتيق بريف الرقة. ولم نتحقق بشكل مستقل من الحصيلة.';
export const ATTRIBUTED_CORRECTION_REFERENCE = 'wamid.HBgLOTYxODE5OTQ4OTMVAgASGCBBQzdFNTEwODMxQTQ3OUY2REI2NDBDRjQ2MUM5REI5MAA=';
const REVISED_ALERT_ID='cabea2c3-8b6b-4501-a9ae-e2a1118cf9b2';
export function attributedAlertCopy(a) {
  const p=a?.meta?.attributedReport,s=a?.meta?.newsSources;
  const revised=p?.version===2 && a.id===REVISED_ALERT_ID && a.channel_message_id===1494 && p.correctionReference===ATTRIBUTED_CORRECTION_REFERENCE && p.prior?.version===1 && p.prior.copyHash===hash(ATTRIBUTED_ITEM);
  const x=revised ? {...ATTRIBUTED_ITEM,body:ATTRIBUTED_REVISED_BODY} : ATTRIBUTED_ITEM;
  return a?.source==='news' && a.type===x.type && ((p?.version===1 && p.copyHash===hash(x)) || (revised && p.copyHash===hash(x))) && a.meta.dedupKey===`news:${x.id}`
    && a.title===x.title && a.body===x.body && a.description===x.title && a.place?.scope==='country' && a.place?.name_ar===x.location && a.place.latitude==null && a.place.longitude==null && !(a.extra||[]).length
    && s?.length===1 && s[0].url===x.sourceUrl && s[0].name===x.sourceName ? x : null;
}

/** Exact same-post wording revision; v1 remains valid for historical copies. */
export function revisedAttributedRepairMeta(a, correction) {
  if (!a.meta?.attributedReport) return null;
  if (!attributedAlertCopy(a) || a.meta.attributedReport.version!==1 || a.id!==REVISED_ALERT_ID || a.channel_message_id!==1494 || correction?.approved_copy!==true || correction.body!==ATTRIBUTED_REVISED_BODY || Object.keys(correction).some(k=>!['approved_copy','body'].includes(k))) throw new Error('unsupported-attributed-same-post-correction');
  const x={...ATTRIBUTED_ITEM,body:ATTRIBUTED_REVISED_BODY};
  return {...a.meta,attributedReport:{version:2,copyHash:hash(x),prior:structuredClone(a.meta.attributedReport),correctionReference:ATTRIBUTED_CORRECTION_REFERENCE},attributedWordingAudit:{at:new Date().toISOString(),priorBody:a.body,priorTitle:a.title,priorMeta:structuredClone(a.meta),post:1494,alertId:a.id,originalSourceUrl:ATTRIBUTED_ITEM.sourceUrl,correctionReference:ATTRIBUTED_CORRECTION_REFERENCE,independentlyVerified:false}};
}
