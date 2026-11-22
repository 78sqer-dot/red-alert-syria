import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ras-reviewed-mode-'));
process.env.DATA_DIR=dir;process.env.TELEGRAM_BACKUP='false';process.env.BOT_TOKEN='12345:mock';
const {store}=await import('../server/store.js');await store.init(null);
const mon=await import('../server/news-monitor.js');const {locationFrom}=await import('../server/places.js');
const loc=locationFrom({placeId:167501});let calls=0;
function setup(){
 store.state.alerts=[];store.state.gone={};const n=mon.newsState();n.on=true;n.editorialMode='automatic';n.editorialModeAt=0;n.drafts={};n.alerts=[];n.echoLog=[];mon._test.R.autoPublishing=0;calls=0;
 mon._test.R.H={apis:()=>({admin:{}}),publishDraft:async()=>{calls++;return{id:'synthetic',channel_message_id:9};}};
 n.drafts.a={id:'a',status:'pending',type:'explosion',headline:'انفجار في محجة',body:'انفجار عبوة ناسفة في بلدة محجة أدى إلى إصابة شاب.',sourceText:'انفجار عبوة ناسفة في بلدة محجة أدى إلى إصابة شاب.',sourceTextVersion:2,loc,extra:[],srcs:[{u:'synthetic',name:'اختبار',url:'https://t.me/synthetic/1',local:false}],created:Date.now(),ts:Date.now(),cards:[],dayAutoAt:Date.now()-1000};return n;
}
test.after(async()=>{mon._test.R.H=null;await new Promise(r=>setTimeout(r,350));fs.rmSync(dir,{recursive:true,force:true});});
test('reviewed mode blocks both unattended paths, clears deadlines and keeps monitoring on',async()=>{
 const n=setup();await mon.setOperatorNewsMode('reviewed');assert.equal(n.on,true);assert.equal(n.drafts.a.dayAutoAt,null);
 assert.equal(await mon._test.nightPublish(n.drafts.a),false);await mon._test.dayAutoTick();assert.equal(calls,0);assert.equal(n.drafts.a.status,'pending');assert.equal(n.drafts.a.dayAutoAt,null);
 assert.match(mon._test.cardText(n.drafts.a,'en'),/Unattended news publishing is off/);
});
test('reviewed mode still allows one revision-checked reviewed publication through the same runtime',async()=>{
 setup();await mon.setOperatorNewsMode('reviewed');const r=mon.operatorNewsReview('a');const result=await mon.operateNewsDraft('a',{action:'publish',revision:r.revision});assert.equal(result.status,'published');assert.equal(calls,1);
});
test('mode change refuses an in-flight automatic publication and rejects invalid modes',async()=>{
 const n=setup();mon._test.R.autoPublishing=1;await assert.rejects(mon.setOperatorNewsMode('reviewed'),/in-flight/);assert.equal(n.editorialMode,'automatic');mon._test.R.autoPublishing=0;await assert.rejects(mon.setOperatorNewsMode('bad'),/invalid-editorial-mode/);
});
test('tiny status is stable on unchanged cycles and widens to IDs only on request',()=>{
 const n=setup();let a=mon.operatorNewsStatus();assert.equal(a.pending_count,1);assert.equal(a.actionable_count,1);assert.equal(a.items,undefined);assert.equal(a.revision,mon.operatorNewsStatus().revision);assert.ok(JSON.stringify(a).length<700);
 n.drafts.a.sourceText+=' تفاصيل';assert.notEqual(a.revision,mon.operatorNewsStatus().revision);n.drafts.a.editorialHold=true;a=mon.operatorNewsStatus(true);assert.equal(a.held_count,1);assert.equal(a.actionable_count,0);assert.equal(a.items[0].id,'a');n.drafts.a.status='publishing';assert.equal(mon.operatorNewsStatus().publishing_count,1);
});
test('newer backed-up editorial mode is restored without older mode rollback',()=>{
 const n=setup();mon.mergeNewsFromBackup({news:{editorialMode:'reviewed',editorialModeAt:10}});assert.equal(n.editorialMode,'reviewed');mon.mergeNewsFromBackup({news:{editorialMode:'automatic',editorialModeAt:9}});assert.equal(n.editorialMode,'reviewed');
});
function pair(){
 const n=setup();const d=n.drafts.a;d.status='published';d.alertId='canonical';d.postId=11;d.body='سماع دوي انفجار في محجة';d.sourceText=d.body;
 const a=store.addAlert({id:'canonical',type:'explosion',title:'انفجار في محجة',description:'تحديث منسوب إلى الوكالة عن انفجار داخل مستودع أسلحة.',body:'تحديث منسوب إلى الوكالة عن انفجار داخل مستودع أسلحة.',location:loc,source:'news',extra:[]});a.channel_message_id=11;
 n.drafts.b={...structuredClone(d),id:'b',alertId:'removed',postId:12,sourceText:'انفجار داخل مستودع أسلحة',srcs:[{u:'followup',name:'متابعة',url:'https://t.me/followup/2'}]};store.state.gone.removed=Date.now();
 n.alerts=[{id:'removed',ts:Date.now()}];n.echoLog=[{id:'removed',ts:Date.now(),text:'انفجار داخل مستودع أسلحة'}];
 return {n,a,request:{duplicateId:'b',revision:mon.operatorNewsReview('a').revision,duplicateRevision:mon.operatorNewsReview('b').revision,sourceUrl:'https://example.com/source'}};
}
test('ledger reconciliation requires an already corrected canonical and removed duplicate, never deletes or posts',async()=>{
 const {n,a,request}=pair();store.state.alerts.push({id:'removed'});await assert.rejects(mon.reconcilePublishedNewsDuplicate('a',request),/removal-not-verified/);store.state.alerts.pop();
 const result=await mon.reconcilePublishedNewsDuplicate('a',request);assert.equal(result.publicChanged,false);assert.equal(calls,0);assert.equal(n.drafts.b.status,'duplicate');assert.equal(n.drafts.b.alertId,a.id);assert.equal(n.drafts.b.postId,11);assert.equal(n.drafts.b.reconciliation.removedPostId,12);assert.equal(n.drafts.a.sourceText,'سماع دوي انفجار في محجة');assert.equal(n.drafts.a.publishedBody,a.body);assert.equal(a.meta.newsSources.length,3);assert.equal(n.alerts.some(x=>x.id==='removed'),false);assert.equal(n.echoLog.some(x=>x.id==='removed'),false);assert.ok(n.echoLog.some(x=>x.id==='canonical'&&x.text.includes('مستودع')));
 assert.equal(mon._test.knownEvents().filter(e=>e.alertId===a.id).length,1,'the reconciled alias cannot become a second event with its old geography');
 assert.equal(mon._test.knownEvents().some(e=>e.draftId==='b'),false);
 assert.equal((await mon.reconcilePublishedNewsDuplicate('a',request)).reused,true);assert.equal(n.drafts.a.editorialUpdates.length,1);
});
test('ledger refuses stale review and unsafe source URLs',async()=>{
 let p=pair();await assert.rejects(mon.reconcilePublishedNewsDuplicate('a',{...p.request,revision:'stale'}),/stale-review/);p=pair();await assert.rejects(mon.reconcilePublishedNewsDuplicate('a',{...p.request,sourceUrl:'javascript:bad'}),/source-url-required/);
});
