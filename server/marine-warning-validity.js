import crypto from 'node:crypto';
export const MARINE_VALIDITY=Object.freeze({alertId:'c2f35414-0ff3-4990-8192-e35a5bf7bf3f',postId:1502,draftId:'113b4b49b6',sourceUrl:'https://t.me/SyriaDefence/64639',sourceHash:'a2c21a838ebb04ab2788a198b3656c819f22937825a1e6ea77e9e32408408195',capUrl:'https://climweb.med.gov.sy/api/cap/09d851ec-2259-4fdc-ab11-71ee273baee5.xml',onset:'2026-11-24T14:00:00.000Z',expires:'2026-11-26T14:00:00.000Z'});
export function marineValidityRepair(a,c,d,options){
 if(c?.official_validity===undefined)return null;
 const f=MARINE_VALIDITY,v=c.official_validity;
 if(!options.expectedRevision||options.expectedPostId!==f.postId)throw Error('marine-validity-exact-revision-post-required');
 if(a.id!==f.alertId||a.channel_message_id!==f.postId||a.source!=='news'||d?.id!==f.draftId||d.alertId!==a.id||d.postId!==f.postId||d.status!=='published'||!d.srcs?.some(s=>s.url===f.sourceUrl)||crypto.createHash('sha256').update(d.sourceText||'').digest('hex')!==f.sourceHash||c.approved_copy!==true||c.type!=='weather'||c.clear_location!==true||v?.cap_url!==f.capUrl||v?.onset!==f.onset||v?.expires!==f.expires||Object.keys(v).sort().join(',')!=='cap_url,expires,onset')throw Error('unsupported-marine-validity-no-write');
 return {valid_from:f.onset,expires_at:f.expires,meta:{...(a.meta||{}),officialWarningValidity:{version:1,capUrl:f.capUrl,sourceUrl:f.sourceUrl,sourceHash:f.sourceHash,onset:f.onset,expires:f.expires},marineValidityAudit:{at:new Date().toISOString(),prior:{valid_from:a.valid_from??null,expires_at:a.expires_at},nativeReview:structuredClone(d.nativeReview||null)}}};
}
