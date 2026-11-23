import {RelayOutbox,mergeRelayRecords} from './relay-outbox.js';
import {store} from './store.js';
const destination=()=>process.env.ALERT_EMAIL_TO||'c2yqj2@mail.instinct.com';
const sender='88sqer@gmail.com';
// Only alerts created after this repair was requested. Old channel recoveries never replay.
export const FUTURE_FROM=Date.parse('2026-11-23T21:47:19+02:00');
let queue=null,timer=null,formatText=null;
(store.mergeHooks ||= []).push(remote=>{
 const target=records();const merged=mergeRelayRecords(target,remote.maint?.emailRelay||{});
 Object.assign(target,merged);
});
function records(){store.state.maint ||= {};return store.state.maint.emailRelay ||= {};}
async function save(){
 store.persist();store._writeLocal();
 return store.backup ? await store.flushBackup(true) : false;
}
function getQueue(){
 const state=records();
 if(!queue||queue.state!==state)queue=new RelayOutbox({state,save,ready:()=>!store._backupWritesPaused&&!!store.backup,send:async row=>{
  const r=await fetch('https://api.brevo.com/v3/smtp/email',{
   method:'POST',headers:{'api-key':process.env.BREVO_API_KEY,'content-type':'application/json',accept:'application/json'},
   body:JSON.stringify({sender:{name:'Red Alert Syria',email:row.sender},to:[{email:row.to}],subject:row.subject,textContent:row.text}),
   signal:AbortSignal.timeout(15000),
  });
  let id=null;try{id=(await r.json()).messageId||null;}catch{}
  console.log('[email-relay] outcome',row.alertId,row.postId,r.status,r.ok?'accepted':'not-accepted');
  return{accepted:r.ok,status:r.status,id};
 }});
 return queue;
}
export async function enqueuePublishedRelay(alert,text){
 if(!alert?.channel_message_id||Date.parse(alert.timestamp)<FUTURE_FROM||!Number.isFinite(Date.parse(alert.timestamp)))return;
 const q=getQueue();
 await q.enqueue({alertId:alert.id,postId:alert.channel_message_id,text,subject:'🔴 '+(alert.title||'تنبيه عاجل'),to:destination(),sender});
 await q.drain({configured:!!process.env.BREVO_API_KEY?.trim()});
}
let reconciling=false;
export async function reconcilePublishedRelays(format){
 if(reconciling||store._backupWritesPaused||!store.backup)return;
 reconciling=true;
 try{
  for(const alert of store.state.alerts||[]){
   if(alert.channel_message_id&&Date.parse(alert.timestamp)>=FUTURE_FROM&&!records()[alert.id+':'+alert.channel_message_id]){
    await getQueue().enqueue({alertId:alert.id,postId:alert.channel_message_id,text:format(alert),subject:'🔴 '+(alert.title||'تنبيه عاجل'),to:destination(),sender});
   }
  }
  await getQueue().drain({configured:!!process.env.BREVO_API_KEY?.trim()});
 }finally{reconciling=false;}
}
export function startEmailRelay(format){
 formatText=format;

 if(timer)return;
 const q=getQueue();q.recover();
 // Only explicitly enqueued future posts. Never scan old alerts for replay.
 const run=()=>reconcilePublishedRelays(formatText);
 const tick=()=>run().catch(e=>console.warn('[email-relay] drain failed',e.message));
 timer=setInterval(tick,15000);timer.unref();tick();
}
export function stopEmailRelay(){clearInterval(timer);timer=null;}
export function emailRelayStatus(){
 const counts={};for(const r of Object.values(records()))counts[r.status]=(counts[r.status]||0)+1;
 return{configured:!!process.env.BREVO_API_KEY?.trim(),destinationMatchesExistingRoute:destination()==='c2yqj2@mail.instinct.com',counts,
 recent:Object.values(records()).slice(-10).map(({alertId,postId,status,attempts,http,createdAt,updatedAt,providerId})=>({alertId,postId,status,attempts,http,createdAt,updatedAt,providerAccepted:!!providerId}))};
}
