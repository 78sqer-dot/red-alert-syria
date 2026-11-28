import crypto from 'node:crypto';
export const STALE_REVIEW_KEY='pre-send-review-controls-2026-11-28';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const STALE_REVIEW_TARGETS=[
  {
    "id": "dd4d1b6d08",
    "chat": 8270709633,
    "mid": 13062,
    "hash": "1ade0954e7420585ec675b9af0323d3404a0bb48afd573430d2362cd42301950"
  },
  {
    "id": "9733cb49c9",
    "chat": 8270709633,
    "mid": 13064,
    "hash": "9f3ede7b5405f26b1aa6c3c86d909f4b21723e1d579bf1e3d4655685593c302f"
  },
  {
    "id": "bd22f3326c",
    "chat": 8270709633,
    "mid": 13070,
    "hash": "7d99247673a9a53f5e4da0c0eb9ecdc2a7c582a00abe4884327ad8f4e994902c"
  }
];
export async function repairStalePreSendReview({store,validatePreSend,editExisting,backupEnabled=false,now=Date.now}){
  if(!backupEnabled||!store.backup||store._backupWritesPaused)return [{skipped:true,reason:'durable-production-backup-not-ready'}];
  const results=[];
  for(const target of STALE_REVIEW_TARGETS){
    const key=STALE_REVIEW_KEY+':'+target.id;
    if(store.state.maint?.[key]){results.push({id:target.id,skipped:true,state:store.state.maint[key].state});continue;}
    const d=store.state.news?.drafts?.[target.id];
    if(!d||hash(d)!==target.hash||d.status!=='pending'||d.nativeReview||d.operatorReview||d.alertId||d.postId||!d.cards?.some(([c,m])=>c===target.chat&&m===target.mid)){
      results.push({id:target.id,skipped:true,reason:'exact-pending-revision-guard'});continue;
    }
    const rejected=await validatePreSend(structuredClone(d));
    if(rejected!=='missing-location'||hash(d)!==target.hash){results.push({id:target.id,skipped:true,reason:'pre-send-proof-missing'});continue;}
    const marker={state:'claimed',at:now(),chat:target.chat,mid:target.mid};(store.state.maint||={})[key]=marker;
    const durable=async()=>{store.persist();store._backupPending=true;try{return !!await store.flushBackup(true);}catch{return false;}};
    if(!store.backup||!await durable()){results.push({id:target.id,ok:false,state:'claim-backup-unverified'});continue;}
    if(hash(d)!==target.hash){marker.state='revision-conflict';await durable();results.push({id:target.id,ok:false,state:marker.state});continue;}
    d.editorialHold=true;d.editorialHoldReason='missing-location';d.editorialHoldAt=now();
    // Never reconstruct a publishing claim or pretend a historical send was checked.
    // Current pending/no-claim state + exact deterministic pre-send failure only.
    marker.state='hold-recorded';
    const expected=hash(d);
    if(!await durable()){results.push({id:target.id,ok:false,state:'hold-backup-unverified'});continue;}
    try{
      if(d.status!=='pending'||d.nativeReview||d.alertId||d.postId||hash(d)!==expected)throw Error('revision conflict');
      await editExisting(target.chat,target.mid,structuredClone(d));
    }catch{marker.state='private-ui-uncertain';await durable();results.push({id:target.id,ok:false,state:marker.state});continue;}
    marker.state='done';marker.done=now();const saved=await durable();results.push({id:target.id,ok:saved,state:saved?'done':'final-backup-unverified'});
  }
  return results;
}
