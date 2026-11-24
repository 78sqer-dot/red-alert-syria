import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
process.env.DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/ras-churn-');
process.env.BOT_TOKEN='123:SYNTHETIC';
process.env.TELEGRAM_BACKUP='true';
const {store}=await import('../server/store.js');
const {armyPollSaveOptions}=await import('../server/army.js');
const {mergeNewsFromBackup}=await import('../server/news-monitor.js');
const originalPersist=store.persist;
function fixture(remote){
 store.state={alerts:[],reports:{},reportsDone:{},gone:{},reportContacts:{},reportsAudit:{},relay:{},threads:{},log:[],news:{drafts:{},last:{},seen:{},handled:{},alerts:[]}};
 store.mergeHooks=[];
 let saves=0;
 store.persist=()=>{saves++;};
 store.backup={load:async()=>JSON.stringify(remote??store.state)};
 // Normalize migration/default fields before measuring merge-only work.
 mergeNewsFromBackup({news:{drafts:{}}});saves=0;
 return ()=>saves;
}
test('twenty byte-identical remote merges queue no full backup',async()=>{
 const saves=fixture();
 for(let i=0;i<20;i++)assert.equal((await store.mergeFromBackup()).changed,false);
 assert.equal(saves(),0);
});
test('decision-only merge queues durability even without a new alert/report',async()=>{
 const saves=fixture({alerts:[],news:{drafts:{d:{id:'d',status:'ignored',nativeReview:{at:5,result:'ignored'}}}}});
 store.state.news.drafts.d={id:'d',status:'pending'};store.mergeHooks=[mergeNewsFromBackup];
 const r=await store.mergeFromBackup();assert.equal(r.reports,0);assert.equal(r.alerts,0);assert.equal(r.changed,true);assert.equal(saves(),1);assert.equal(store.state.news.drafts.d.status,'ignored');
 assert.equal((await store.mergeFromBackup()).changed,false);assert.equal(saves(),1);
});
test('newer report audit and contact-only changes still queue remote durability',async()=>{
 const saves=fixture({alerts:[],reportsAudit:{r:{at:5,result:'ignored'}},reportContacts:{r:{private:true}}});
 assert.equal((await store.mergeFromBackup()).changed,true);assert.equal(saves(),1);assert.equal(store.state.reportsAudit.r.result,'ignored');
});
test('older pending state cannot reopen a published decision or trigger a needless save',async()=>{
 const saves=fixture({alerts:[],news:{drafts:{d:{id:'d',status:'pending'}}}});store.state.news.drafts.d={id:'d',status:'published',alertId:'proof'};store.mergeHooks=[mergeNewsFromBackup];
 assert.equal((await store.mergeFromBackup()).changed,false);assert.equal(saves(),0);assert.equal(store.state.news.drafts.d.status,'published');
});
test('error-only army checks are lazy, new items and baselines are prompt',()=>{
 assert.deepEqual(armyPollSaveOptions({errors:['fixture']}),{backupSoon:false});
 assert.deepEqual(armyPollSaveOptions({errors:['fixture'],newItems:1}),{backupSoon:true});
 assert.deepEqual(armyPollSaveOptions({baseline:true}),{backupSoon:true});
});
test('lazy error metadata is included when a forced decision barrier runs',async()=>{
 store.persist=originalPersist;store.state={alerts:[],fixture:{error:'synthetic'}};store._backupPending=false;store._backupLazy=false;store._backupWritesPaused=false;
 const saved=[];store.backup={save:async(body,options)=>saved.push({body:JSON.parse(body),force:options.force})};
 store.persist(armyPollSaveOptions({errors:['fixture']}));assert.equal(store._backupPending,false);assert.equal(store._backupLazy,true);assert.equal(await store.flushBackup(true),true);assert.equal(saved.length,1);assert.equal(saved[0].force,true);assert.equal(saved[0].body.fixture.error,'synthetic');
});
after(()=>{clearTimeout(store._backupTimer);clearTimeout(store._saveTimer);store.persist=originalPersist;store.backup=null;fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
