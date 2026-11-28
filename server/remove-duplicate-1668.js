import fs from 'node:fs';
import {isDeepStrictEqual as eq} from 'node:util';
export const M=JSON.parse(fs.readFileSync(new URL('../data/repairs/1668-duplicate.json',import.meta.url)));
export const KEY='duplicate-1668-2026-11-28';
let busy=false;
// Explicit authenticated invocation only. Original owner instruction: WhatsApp
// Nov23 18:42:33, message reference retained in the durable marker.
export async function removeDuplicate1668({store,api,channel,backupEnabled}){
 if(busy)return{state:'busy'};busy=true;
 try{
  if(!store.backup||!backupEnabled||store._backupWritesPaused||!store._sweepsStarted)return{state:'not-ready'};
  const old=store.state.maint?.[KEY];if(old?.state==='done')return{state:'done',skipped:true};
  const durable=async()=>{store.persist();store._backupPending=true;return !!await store.flushBackup(true)};
  const canonical=store.getAlert(M.canonical.id),a=store.getAlert(M.alert.id),d=store.state.news?.drafts?.[M.draft.id];
  if(!eq(canonical,M.canonical)||!d||d.alertId!==M.alert.id||d.postId!==1668||(!old&&!eq(a,M.alert))||(old&&a&&!eq(a,M.alert)))return{state:'revision-conflict'};
  const chat=await api.getChat(channel);if(String(chat.id)!=='-1004387100492')return{state:'channel-conflict'};
  const marker=old||{state:'claimed',at:new Date().toISOString(),post:1668,id:M.alert.id,duplicateOf:M.canonical.id,authority:'wamid.HBgLOTYxODE5OTQ4OTMVAgASGCBBQzQ1QUY1QTZFMkJBMkM3N0JFOENDRjc0QzAwMzAwNQA='};
  (store.state.maint||={})[KEY]=marker;
  d.status='duplicate';d.duplicateOf=M.canonical.id;d.duplicateMarkedAt=Date.now();d.dayAutoAt=null;d.editorialHold=true;d.editorialHoldReason='confirmed-duplicate-1668';
  if(!await durable())return{state:'claim-backup-unverified'};
  try{if(await api.deleteMessage(chat.id,1668)!==true)return{state:'delete-unverified'};}catch(e){if(!/message to delete not found/i.test(String(e.description||e.message||'')))return{state:'delete-unverified'};}
  if(!eq(store.getAlert(M.canonical.id),M.canonical))return{state:'canonical-conflict'};
  if(store.getAlert(M.alert.id))store.deleteAlert(M.alert.id);
  marker.state='done';marker.done=new Date().toISOString();
  if(!await durable()){marker.state='final-backup-unverified';store.persist();return{state:marker.state};}
  return{ok:true,state:'done',post:1668,id:M.alert.id,canonicalUnchanged:true};
 }finally{busy=false;}
}
