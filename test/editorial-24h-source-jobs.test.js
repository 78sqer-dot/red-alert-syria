import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ras-next-'));
process.env.DATA_DIR=dir;process.env.TELEGRAM_BACKUP='false';process.env.BOT_TOKEN='123456:LOCAL_TEST';
const {store}=await import('../server/store.js');await store.init(null);
const {initialJobsState,createPendingJob,sourceJobEligibility,publishSourceJob,publicJobs}=await import('../server/jobs.js');
const {dayAutoDueAt,cleanupPublishedNotices}=await import('../server/news-monitor.js');
const now=Date.parse('2026-11-28T10:00:00Z');
const text='فرصة عمل محاسب في دمشق\nللتقديم أرسل السيرة الذاتية: https://example.org/apply\nآخر موعد: 2026-12-15';
const make=(body=text,j=initialJobsState())=>({j,job:createPendingJob({kind:'source',sourceKey:'source:'+body,text:body,sourceUrl:'https://t.me/syrian_jobb/100'},j,now).job});
test('qualified ordinary news has no clock gap at four Damascus boundaries',()=>{
 for(const time of ['04:59','05:00','18:59','19:00']){const at=Date.parse(`2026-11-28T${time}:00Z`);assert.equal(dayAutoDueAt({type:'attack',status:'pending',loc:{scope:'place',latitude:33.5,longitude:36.3},srcs:[{u:'main',local:false}]},at),at);}
});
test('source vacancy extracts supported workplace and future deadline, saves once without notices',async()=>{
 const {job,j}=make();const check=sourceJobEligibility(job,j,now);assert.equal(check.ok,true);assert.equal(check.applicationDeadline,'2026-12-15');assert.equal(await publishSourceJob(job,j,now),true);assert.equal(publicJobs(j,now).length,1);assert.equal(job.cards.length,0);assert.equal(await publishSourceJob(job,j,now),false);assert.equal(publicJobs(j,now).length,1);
});
test('fresh timestamp does not override expired, ambiguous or unsupported source claims',()=>{
 for(const body of [text.replace('2026-12-15','2026-11-25'),text.replace('2026-12-15','05/06/2027'),text.replace('في دمشق','عن بعد'),text.replace('في دمشق','في دمشق وحلب'),'متجر رقمي تخفيضات 75% وحزمة دورات فرصة ذهبية مطلوب اشتراك']){const {job,j}=make(body);assert.equal(sourceJobEligibility(job,j,now).ok,false,body);}
});
test('employer review is never source-auto-approved',async()=>{const j=initialJobsState();const job=createPendingJob({kind:'employer',sourceKey:'employer:1',text},j,now).job;assert.equal(await publishSourceJob(job,j,now),false);assert.equal(job.status,'pending');assert.equal(job.sourceReviewHold,undefined);});
test('application deadline expires on Syria day boundary without deleting saved record',async()=>{const {job,j}=make();await publishSourceJob(job,j,now);assert.equal(publicJobs(j,Date.parse('2026-12-15T20:59:59Z')).length,1);assert.equal(publicJobs(j,Date.parse('2026-12-15T21:00:00Z')).length,0);assert.ok(j.published[job.id]);});
test('private cleanup only removes recorded positive-chat success notices after proof',async()=>{
 const deleted=[];const api={getChat:async()=>({id:123}),deleteMessage:async(...args)=>{deleted.push(args);return true;}};
 const d={status:'published',postId:99,alertId:'alert1',notices:[[123,10],[-100987,99]]};
 assert.equal(await cleanupPublishedNotices(d,api),false);assert.deepEqual(deleted,[[123,10]]);assert.deepEqual(d.notices,[[-100987,99]]);
 for(const bad of [{status:'pending'},{postId:null},{editorialHold:true},{nativeReview:{result:'published-backup-unverified'}}]){const x={status:'published',postId:99,alertId:'a',notices:[[123,11]],...bad};await cleanupPublishedNotices(x,api);assert.deepEqual(x.notices,[[123,11]]);}
 assert.equal(deleted.length,1);
});
test.after(async()=>{await new Promise(r=>setTimeout(r,400));await fs.promises.rm(dir,{recursive:true,force:true});});

test('failed job backup recovers once and never exposes during deferred flush',async()=>{
 const {config}=await import('../server/config.js');const oldFlag=config.telegramBackup,oldBackup=store.backup,oldFlush=store.flushBackup;
 const {job,j}=make(text+'\nدوام كامل');let release;
 try{
  config.telegramBackup=true;store.backup={};store.flushBackup=async()=>false;
  assert.equal(await publishSourceJob(job,j,now),false);assert.equal(publicJobs(j,now).length,0);assert.equal(job.status,'approved');
  store.flushBackup=()=>new Promise(resolve=>{release=resolve;});const recovery=publishSourceJob(job,j,now);
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(publicJobs(j,now).length,0);release(true);assert.equal(await recovery,true);assert.equal(publicJobs(j,now).length,1);assert.equal(Object.keys(j.published).length,1);
 }finally{config.telegramBackup=oldFlag;store.backup=oldBackup;store.flushBackup=oldFlush;}
});
test('pinned notices, unknown pin state and false deletion results remain recorded',async()=>{
 const makeDraft=()=>({status:'published',postId:90,alertId:'a',notices:[[123,12]]});
 let deletes=0;const pinned=makeDraft();await cleanupPublishedNotices(pinned,{getChat:async()=>({pinned_message:{message_id:12}}),deleteMessage:async()=>{deletes++;return true;}});assert.equal(deletes,0);assert.equal(pinned.notices.length,1);
 const unknown=makeDraft();await cleanupPublishedNotices(unknown,{getChat:async()=>{throw Error('unavailable');},deleteMessage:async()=>{deletes++;return true;}});assert.equal(deletes,0);assert.equal(unknown.notices.length,1);
 const failed=makeDraft();await cleanupPublishedNotices(failed,{getChat:async()=>({}),deleteMessage:async()=>false});assert.equal(failed.notices.length,1);assert.equal(failed.successCleanupPending,true);
});
test('explicit closure and same-governorate multiple workplaces remain private',()=>{
 for(const body of [text+'\nالتقديم مغلق',text+'\nانتهت فترة التقديم',text.replace('آخر موعد: 2026-12-15','تاريخ انتهاء التقديم: 05/06/2027'),text.replace('في دمشق','في الميادين والباغوز دير الزور')]){const {job,j}=make(body);assert.equal(sourceJobEligibility(job,j,now).ok,false,body);}
});

test('approved no-deadline source job survives restart after thirty days',async()=>{
 const mod=await import('../server/jobs.js');const {job,j}=make(text.replace('\nآخر موعد: 2026-12-15','')+'\nراتب ثابت');assert.equal(await publishSourceJob(job,j,now),true);
 mod._test.resetSourceJobReady();const later=now+40*86400000;assert.equal(publicJobs(j,later).length,0);await mod.recoverSourceJobs(j,later);assert.equal(publicJobs(j,later).length,1);
});

test('job ready proof invalidates on replacement and in-place content changes',async()=>{
 const mod=await import('../server/jobs.js');const {job,j}=make(text+'\nاختبار نسخة');await publishSourceJob(job,j,now);assert.equal(publicJobs(j,now).length,1);
 job.title+=' معدّل';assert.equal(publicJobs(j,now).length,0);await mod.recoverSourceJobs(j,now);assert.equal(publicJobs(j,now).length,1);
 j.published[job.id]={...job};assert.equal(publicJobs(j,now).length,0);await mod.recoverSourceJobs(j,now);assert.equal(publicJobs(j,now).length,1);
});
test('generic confirmed callback cleanup queues failure and retries without touching pin',async()=>{
 const mod=await import('../server/private-publication-cleanup.js');store.state.publicationCleanup=[];let fail=true;const calls=[];
 const api={getChat:async()=>({}),deleteMessage:async(chat,mid)=>{calls.push([chat,mid]);return !fail;}};
 assert.equal(await mod.cleanOrQueuePrivatePublicationCard(api,123,71),false);assert.equal(store.state.publicationCleanup.length,1);
 fail=false;await mod.retryPrivatePublicationCleanup(api);assert.equal(store.state.publicationCleanup.length,0);assert.equal(calls.length,2);
 await mod.cleanOrQueuePrivatePublicationCard({getChat:async()=>({pinned_message:{message_id:72}})},123,72);assert.equal(store.state.publicationCleanup.length,1);
});

test('guarded news publication has one send under concurrent offers and restored state',async()=>{
 const { _test,newsState }=await import('../server/news-monitor.js');const old=_test.R.H;const n=newsState();let sends=0;
 const d={id:'race-next',type:'attack',status:'pending',headline:'وقع هجوم في مدينة دمشق مساء اليوم.',sourceText:'وقع هجوم في مدينة دمشق مساء اليوم.',loc:{scope:'place',name_ar:'دمشق',governorate_ar:'دمشق',latitude:33.5,longitude:36.3},srcs:[{u:'main-news',local:false}],created:Date.now(),ts:Date.now(),cards:[]};
 _test.R.H={apis:()=>({admin:{getChat:async()=>({}),deleteMessage:async()=>true}}),publishDraft:async()=>{sends++;await new Promise(r=>setTimeout(r,15));return {id:'race-alert',channel_message_id:700};}};
 n.drafts[d.id]=d;
 try{await Promise.all([_test.nightPublish(d),_test.nightPublish(d)]);assert.equal(sends,1);assert.equal(d.status,'published');const restored=structuredClone(d);assert.equal(await _test.nightPublish(restored),false);assert.equal(sends,1);
 }finally{_test.R.H=old;delete n.drafts[d.id];}
});
test('news review and media card cleanup retries failed IDs and preserves pins',async()=>{
 const {_test,newsState}=await import('../server/news-monitor.js');const old=_test.R.H;store.state.publicationCleanup=[];let fail=true;const calls=[];const d={id:'cleanup-next',status:'published',alertId:'a',postId:701,cards:[[123,80]],mediaCards:[[123,81]],notices:[]};
 _test.R.H={apis:()=>({admin:{getChat:async()=>({pinned_message:{message_id:81}}),deleteMessage:async(c,m)=>{calls.push(m);return !fail;}}}),publishDraft:async()=>{throw Error('must not send');}};newsState().drafts[d.id]=d;
 try{await _test.closeCards(d,null,true);assert.equal(d.cards.length,1);assert.equal(d.mediaCards.length,1);fail=false;await _test.dayAutoTick();assert.equal(d.cards.length,0);assert.equal(d.mediaCards.length,1);assert.deepEqual(calls,[80,80]);}finally{_test.R.H=old;delete newsState().drafts[d.id];}
});
test('private cross-source provenance is retained for a confirmed alert without public rewrite',async()=>{
 const {_test,newsState}=await import('../server/news-monitor.js');const n=newsState();const target={kind:'alert',status:'published',alertId:'prior-public',headline:'public unchanged'};
 for(const u of ['source-a','source-b','source-c']) _test.retainDuplicateProvenance(target,{src:{u},url:'https://example.org/'+u,ts:now});
 assert.equal(n.eventProvenance['prior-public'].duplicateSources.length,3);assert.equal(target.headline,'public unchanged');
});
test('generic confirmed publication backup failure keeps reconciliation ID and forbids resend',async()=>{
 const {config}=await import('../server/config.js');const mod=await import('../server/private-publication-cleanup.js');const oldFlag=config.telegramBackup,oldBackup=store.backup,oldFlush=store.flushBackup;let deleted=0;
 try{config.telegramBackup=true;store.backup={};store.flushBackup=async()=>false;
 const result=await mod.finalizeConfirmedPrivatePublication({deleteMessage:async()=>{deleted++;return true;}},123,90,{id:'confirmed-alert',channel_message_id:702,channel_delivery:{status:'confirmed'}});
 assert.deepEqual(result,{confirmed:true,backupConfirmed:false,alertId:'confirmed-alert',mayResend:false});assert.equal(deleted,0);
 }finally{config.telegramBackup=oldFlag;store.backup=oldBackup;store.flushBackup=oldFlush;}
});
test('approved source job retries private review cleanup after transient failure',async()=>{
 const mod=await import('../server/jobs.js');const {job,j}=make(text+'\nمع بطاقة');job.cards=[[123,91]];let fail=true;let deletes=0;
 mod._test.setAdminApi(()=>({getChat:async()=>({}),deleteMessage:async()=>{deletes++;return !fail;}}));
 try{await publishSourceJob(job,j,now);assert.equal(job.cards.length,1);fail=false;await mod.recoverSourceJobs(j,now);assert.equal(job.cards.length,0);assert.equal(deletes,2);assert.equal(publicJobs(j,now).length,1);}finally{mod._test.setAdminApi(null);}
});


test('private cleanup survives actual JSON restore, validates records and merges overlapping instances',async()=>{
 const mod=await import('../server/private-publication-cleanup.js');
 const prior=store.state,oldBackup=store.backup;const deleted=[];
 try{
  store.state={...prior,publicationCleanup:[]};
  await mod.cleanOrQueuePrivatePublicationCard({getChat:async()=>({}),deleteMessage:async()=>false},123,901);
  const serialized=JSON.stringify(store.state);
  store._apply(JSON.parse(serialized));
  assert.deepEqual(store.state.publicationCleanup,[{chat:123,mid:901,at:JSON.parse(serialized).publicationCleanup[0].at}]);
  const remote={...JSON.parse(serialized),publicationCleanup:[{chat:123,mid:901,at:1},{chat:'124',mid:'902',at:2},{chat:-100,mid:903},{chat:123,mid:0},{chat:true,mid:904},null]};
  store.backup={load:async()=>JSON.stringify(remote)};
  const merged=await store.mergeFromBackup();assert.equal(merged.changed,true);
  assert.deepEqual(store.state.publicationCleanup.map(r=>[r.chat,r.mid]),[[123,901],[124,902]]);
  store._apply(JSON.parse(JSON.stringify(store.state)));
  await mod.retryPrivatePublicationCleanup({getChat:async()=>({}),deleteMessage:async(c,m)=>{deleted.push([c,m]);return true;}});
  assert.deepEqual(deleted,[[123,901],[124,902]]);assert.deepEqual(store.state.publicationCleanup,[]);
  // An older overlapping snapshot may reintroduce a completed intent. It is
  // terminal on Telegram's not-found result and cannot publish anything.
  await store.mergeFromBackup();
  await mod.retryPrivatePublicationCleanup({getChat:async()=>({}),deleteMessage:async()=>{throw Error('message to delete not found');}});
  assert.deepEqual(store.state.publicationCleanup,[]);
  store._apply({...JSON.parse(serialized),publicationCleanup:remote.publicationCleanup});
  assert.deepEqual(store.state.publicationCleanup,[{chat:123,mid:901,at:1},{chat:124,mid:902,at:2}]);
 }finally{store.state=prior;store.backup=oldBackup;}
});
test('bounded cleanup rotates thirty pinned or failed cards so record thirty-one is retried',async()=>{
 const mod=await import('../server/private-publication-cleanup.js');const prior=store.state.publicationCleanup;
 try{
  for(const mode of ['pinned','unavailable','delete-failed']){
   store.state.publicationCleanup=Array.from({length:31},(_,i)=>({chat:123+i,mid:1,at:1}));let checks=0;const deleted=[];
   const api={getChat:async(c)=>{checks++;if(c<153&&mode==='unavailable')throw Error('unavailable');return c<153&&mode==='pinned'?{pinned_message:{message_id:1}}:{};},deleteMessage:async(c)=>{if(c<153)return false;deleted.push(c);return true;}};
   await mod.retryPrivatePublicationCleanup(api);assert.equal(checks,30);assert.deepEqual(deleted,[]);assert.equal(store.state.publicationCleanup[0].chat,153);
   await mod.retryPrivatePublicationCleanup(api);assert.equal(checks,60);assert.deepEqual(deleted,[153]);assert.equal(store.state.publicationCleanup.length,30);
   assert.equal(store.state.publicationCleanup.some(r=>r.chat===153),false);
  }
 }finally{store.state.publicationCleanup=prior;}
});
test('cleanup retains intents added while a bounded retry awaits Telegram',async()=>{
 const mod=await import('../server/private-publication-cleanup.js');const prior=store.state.publicationCleanup;
 try{
  store.state.publicationCleanup=[{chat:123,mid:1,at:1}];let release;
  const retry=mod.retryPrivatePublicationCleanup({getChat:async()=>({}),deleteMessage:()=>new Promise(resolve=>{release=resolve;})});
  await new Promise(resolve=>setTimeout(resolve,0));store.state.publicationCleanup.push({chat:123,mid:2,at:2});release(true);await retry;
  assert.deepEqual(store.state.publicationCleanup,[{chat:123,mid:2,at:2}]);
 }finally{store.state.publicationCleanup=prior;}
});
