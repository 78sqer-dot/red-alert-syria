import fs from 'node:fs';import crypto from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
import {publicAlert} from './store.js';import{post1664CorrectionCandidate,post1664Revision,POST1664_ID}from'./post-1664-correction-candidate.js';
export const POST1664_KEY='facility-1664-2026-11-28';
const M=JSON.parse(fs.readFileSync(new URL('../data/repairs/1664-correction.json',import.meta.url)));
const read=store=>({alert:store.getAlert(POST1664_ID),draft:store.state.news?.drafts?.[M.draftId],cache:store.state.news?.alerts?.find(a=>a.id===POST1664_ID)});
export function post1664NeedsInspection(store,a){const m=store.state.maint?.[POST1664_KEY];return Boolean(m&&m.state!=='done'&&a?.id===POST1664_ID&&a.channel_message_id===1664);}
// Review-only export: no timer, startup call or automatic retry. The caller must
// separately establish owner authority and genuinely fresh actual-message and
// protected-state checks before adopting this reviewed single attempt.
export async function runPost1664Correction({store,editExisting,readActual,readChannel,backupEnabled=false,now=Date.now}){
 if(!store.backup||!backupEnabled||store._backupWritesPaused||typeof readActual!=='function'||typeof readChannel!=='function')return{skipped:true,reason:'not-ready'};
 let channel;try{channel=await readChannel();}catch{return{skipped:true,reason:'channel-unverified'};}if(String(channel?.id)!==M.chat_id)return{skipped:true,reason:'channel-mismatch'};
 const actualMatches=async()=>{try{const r=await readActual();return r&&Number.isFinite(r.started)&&r.started<=r.checkedAt&&Number.isFinite(r.checkedAt)&&r.checkedAt<=now()&&now()-r.checkedAt<=15000&&isDeepStrictEqual(r.message,M.beforeMessage);}catch{return false;}};
 const prior=store.state.maint?.[POST1664_KEY];if(prior)return{skipped:true,state:prior.state,needsInspection:prior.state!=='done'};
 const before=read(store),after=post1664CorrectionCandidate(before,now());if(!after)return{skipped:true,reason:'exact-revision-guard'};
 const png=fs.readFileSync(new URL('../data/repairs/1664-no-pin.png',import.meta.url));if(crypto.createHash('sha256').update(png).digest('hex')!==M.imageHash)return{skipped:true,reason:'image-hash'};
 const expectedLog={id:POST1664_ID,ty:'political',ts:'2026-11-28T12:00:07.215Z',g:'12',ga:'إدلب',ge:'Idlib',src:'news',p:11554691,d:'169022',pa:'باب الهوى',pe:'Bab al Hawa',m:1664};
 if(!isDeepStrictEqual(store.state.log?.find(x=>x.id===POST1664_ID),expectedLog))return{skipped:true,reason:'exact-log-guard'};
 if(!await actualMatches())return{skipped:true,reason:'actual-message-unverified'};
 const baseline=post1664Revision(before);const durable=async()=>{store.persist();store._backupPending=true;try{return store.backup?!!await store.flushBackup(true):false;}catch{return false;}};
 const marker={state:'claimed',at:new Date(now()).toISOString(),post:1664,expected:baseline,image:M.imageHash};(store.state.maint||={})[POST1664_KEY]=marker;
 if(!await durable())return{ok:false,state:'claim-backup-unverified',needsInspection:true};
 if(!isDeepStrictEqual(store.state.log?.find(x=>x.id===POST1664_ID),expectedLog)||post1664Revision(read(store))!==baseline||!post1664CorrectionCandidate(read(store),now())){marker.state='revision-conflict';await durable();return{ok:false,state:marker.state,needsInspection:true};}
 if(!store.backup||!backupEnabled||store._backupWritesPaused||!await actualMatches()){marker.state='actual-message-conflict';await durable();return{ok:false,state:marker.state,needsInspection:true};}
 let result;try{result=await editExisting({chat_id:M.chat_id,message_id:1664,png,caption:M.caption,caption_entities:structuredClone(M.caption_entities),reply_markup:structuredClone(M.reply_markup)});}catch{marker.state='edit-uncertain';await durable();return{ok:false,state:marker.state,needsInspection:true};}
 if(!result||result.message_id!==1664||String(result.chat?.id)!==M.chat_id||result.date!==M.message_date||!result.photo?.length||result.caption!==M.caption||!isDeepStrictEqual(result.caption_entities||[],M.caption_entities)||!isDeepStrictEqual(result.reply_markup,M.reply_markup)){marker.state='edit-response-unverified';await durable();return{ok:false,state:marker.state,needsInspection:true};}
 if(!isDeepStrictEqual(store.state.log?.find(x=>x.id===POST1664_ID),expectedLog)||post1664Revision(read(store))!==baseline){marker.state='post-edit-revision-conflict';await durable();return{ok:false,state:marker.state,needsInspection:true};}
 // Synchronous exact state replacement, durable claim protects crash windows.
 // Never call updateAlert/_history/emit update/refresh/push or regenerate copy.
 Object.assign(before.alert,after.alert);Object.assign(before.draft,after.draft);Object.assign(before.cache,after.cache);
 const log=store.state.log?.find(x=>x.id===POST1664_ID);if(log){delete log.p;delete log.d;delete log.pa;delete log.pe;}
 marker.state='done';marker.done=new Date(now()).toISOString();marker.message_id=1664;
 if(!await durable()){marker.state='final-backup-unverified';store.persist();return{ok:false,state:marker.state,needsInspection:true};}
 store.emit('maintenance-update',publicAlert(before.alert));return{ok:true,state:'done',post:1664,id:POST1664_ID};
}
