import fs from'node:fs';import crypto from'node:crypto';import{isDeepStrictEqual as eq}from'node:util';import{publicAlert}from'./store.js';import{approvedCorrectionFingerprint}from'./approved-public-correction.js';
export const KEY1665='location-copy-1665-2026-11-28';
export const M1665=JSON.parse(fs.readFileSync(new URL('../data/repairs/1665-correction.json',import.meta.url)));
const read=s=>({alert:s.getAlert(M1665.id),cache:s.state.news?.alerts?.find(a=>a.id===M1665.id)});
export function candidate1665(s,now=Date.now()){const x=read(s),a=x.alert;if(!eq(x,M1665.before)||!a.is_active||Date.parse(a.expires_at)<=now||a.channel_message_id!==1665)return null;return x;}
// Only called by the explicit authenticated single-session coordinator, never startup.
export async function run1665({store,readActual,readChannel,editExisting,backupEnabled,now=Date.now}){
 const M=M1665;if(!store.backup||!backupEnabled||store._backupWritesPaused)return{state:'not-ready'};const prior=store.state.maint?.[KEY1665];if(prior)return{state:prior.state,skipped:true};
 let channel;try{channel=await readChannel();}catch{return{state:'channel-unverified'}}if(String(channel?.id)!==M.beforeMessage.chatId)return{state:'channel-mismatch'};
 const fresh=async()=>{try{const r=await readActual();return Number.isFinite(r.started)&&r.started<=r.checkedAt&&r.checkedAt<=now()&&now()-r.checkedAt<15000&&eq(r.message,M.beforeMessage);}catch{return false}};
 let x=candidate1665(store,now());if(!x||!await fresh())return{state:'revision-or-message-conflict'};
 const png=fs.readFileSync(new URL('../data/repairs/1665-no-pin.png',import.meta.url));if(crypto.createHash('sha256').update(png).digest('hex')!==M.imageHash)return{state:'image-mismatch'};
 const durable=async()=>{store.persist();store._backupPending=true;try{return !!await store.flushBackup(true)}catch{return false}};
 const marker={state:'claimed',at:new Date(now()).toISOString(),post:1665,approvalReference:M.approvalReference};(store.state.maint||={})[KEY1665]=marker;if(!await durable())return{state:'claim-backup-unverified',needsInspection:true};
 if(!candidate1665(store,now())||!await fresh()||!candidate1665(store,now())){marker.state='pre-edit-conflict';await durable();return{state:marker.state,needsInspection:true}};
 let result;try{result=await editExisting({chat_id:M.beforeMessage.chatId,message_id:1665,png,caption:M.caption,reply_markup:M.reply_markup})}catch{marker.state='edit-uncertain';await durable();return{state:marker.state,needsInspection:true}};
 if(result?.message_id!==1665||String(result.chat?.id)!==M.beforeMessage.chatId||result.date!==M.beforeMessage.date||!result.photo?.length||result.caption!==M.caption||!eq(result.reply_markup,M.reply_markup)){marker.state='edit-response-unverified';await durable();return{state:marker.state,needsInspection:true}};
 if(!candidate1665(store,now())){marker.state='post-edit-conflict';await durable();return{state:marker.state,needsInspection:true}};
 const a=x.alert;Object.assign(a,structuredClone(M.patch));a.meta={...a.meta,sourceConflictReview:structuredClone(M.audit),correction1665:{approvalReference:M.approvalReference,prior:structuredClone(M.before.alert)}};a.history.push({at:new Date(now()).toISOString(),kind:'updated',title:a.title,description:a.description,is_active:a.is_active});a.meta.approvedPublicCorrection={version:1,fingerprint:approvedCorrectionFingerprint(a),approvalReference:M.approvalReference};
 Object.assign(x.cache,{headline:[a.title,a.description].join(' '),where:'الربيعة بريف حماة',geo:{pts:[],dists:[],govs:['حماه'],coarse:true,none:true}});
 const log=store.state.log?.find(l=>l.id===a.id);if(log){for(const k of['p','d','pa','pe'])delete log[k];Object.assign(log,{g:'10',ga:'حماة',ge:'Hama'})}
 marker.state='done';marker.done=new Date(now()).toISOString();if(!await durable()){marker.state='final-backup-unverified';store.persist();return{state:marker.state,needsInspection:true}}store.emit('maintenance-update',publicAlert(a));return{ok:true,state:'done',post:1665,id:a.id};
}
