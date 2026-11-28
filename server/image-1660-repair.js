import fs from 'node:fs';import crypto from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
export const IMAGE1660_KEY='image-1660-2026-11-28';
const M=JSON.parse(fs.readFileSync(new URL('../data/repairs/image-1660.json',import.meta.url)));
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function image1660NeedsInspection(store,alert) {
 const marker=store.state.maint?.[IMAGE1660_KEY];
 return Boolean(marker&&marker.state!=='done'&&alert?.id===M.id&&alert.channel_message_id===1660);
}
export function image1660Candidate(store,now=Date.now()) {
 const a=store.getAlert(M.id),d=store.state.news?.drafts?.[M.draftId];
 return Boolean(a&&d&&hash(a)===M.alertHash&&hash(d)===M.draftHash&&a.is_active&&Date.parse(a.expires_at)>now&&a.channel_media==='text'&&a.channel_message_id===1660&&d.status==='published'&&d.postId===1660&&store.state.maint?.['context-1660-2026-11-28']?.state==='done');
}
export async function runImage1660Repair({store,editExisting,now=Date.now}) {
 const prior=store.state.maint?.[IMAGE1660_KEY];if(prior)return {skipped:true,state:prior.state,needsInspection:prior.state!=='done'};
 if(!image1660Candidate(store,now()))return {skipped:true,reason:'exact-revision-guard'};
 const png=fs.readFileSync(new URL('../data/repairs/1660-one-village.png',import.meta.url));
 if(crypto.createHash('sha256').update(png).digest('hex')!==M.imageHash)return {skipped:true,reason:'image-hash'};
 const durable=async()=>{store.persist();store._backupPending=true;try{return store.backup?!!await store.flushBackup(true):false;}catch{return false;}};
 const marker={state:'claimed',at:new Date(now()).toISOString(),post:1660,expected:M.alertHash,image:M.imageHash};(store.state.maint||={})[IMAGE1660_KEY]=marker;
 if(!await durable())return {ok:false,state:'claim-backup-unverified',needsInspection:true};
 if(!image1660Candidate(store,now())){marker.state='revision-conflict';await durable();return {ok:false,state:marker.state,needsInspection:true};}
 let result;try{result=await editExisting({chat_id:M.chat_id,message_id:1660,png,caption:M.caption,caption_entities:structuredClone(M.caption_entities),reply_markup:structuredClone(M.reply_markup)});}catch{marker.state='edit-uncertain';await durable();return {ok:false,state:marker.state,needsInspection:true};}
 const expectedEntities=M.caption_entities;
 if(!result||result.message_id!==1660||String(result.chat?.id)!==M.chat_id||!result.photo?.length||result.caption!==M.caption||!isDeepStrictEqual(result.caption_entities||[],expectedEntities)||!isDeepStrictEqual(result.reply_markup,M.reply_markup)){
  marker.state='edit-response-unverified';await durable();return {ok:false,state:marker.state,needsInspection:true};
 }
 const a=store.getAlert(M.id);
 if(!a||hash(a)!==M.alertHash){marker.state='post-edit-revision-conflict';await durable();return {ok:false,state:marker.state,needsInspection:true};}
 // Transport metadata only. No ordinary alert update event, push or history edit.
 a.channel_media='photo';marker.state='done';marker.done=new Date(now()).toISOString();marker.message_id=1660;
 if(!await durable())return {ok:false,state:'final-backup-unverified',needsInspection:true};
 return {ok:true,state:'done',post:1660,id:M.id};
}
