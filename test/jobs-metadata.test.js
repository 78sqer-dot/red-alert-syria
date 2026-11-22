import test from 'node:test';
import assert from 'node:assert/strict';
import {config} from '../server/config.js';
import {store} from '../server/store.js';
import {initialJobsState,createPendingJob,decideJob,publicJobs,effectiveJobDeadline,mergeJobsFromBackup,deleteJobListing} from '../server/jobs.js';
import {operatorJobReview,operateJobDraft} from '../server/jobs-operator.js';
import {reviseJobMetadata} from '../server/jobs-metadata.js';
const NOW=Date.parse('2026-11-22T18:00:00Z');
const LINK='http://www.job.sy/company/vacancy/view.php?id=52346';
async function fixture(run,{pending=false,text=`فرصة عمل محاسب في دمشق\nالتقديم عبر ${LINK}`}={}){
 const old={jobs:store.state.jobs,backup:store.backup,paused:store._backupWritesPaused,persist:store.persist,flush:store.flushBackup,merge:store.mergeFromBackup,emit:store.emit,enabled:config.telegramBackup};
 const j=initialJobsState(),{job}=createPendingJob({kind:'source',sourceKey:'metadata:test:1',sourceUrl:'https://t.me/test_jobs/1',text},j,NOW-1000);job.links=['https://t.me/Syrian_jobbb'];
 if(!pending)decideJob(job.id,'approve_without_location',j,123,NOW-500);
 store.state.jobs=j;store.backup=null;store._backupWritesPaused=false;store.persist=()=>{};store.flushBackup=async()=>true;store.mergeFromBackup=async()=>({backupLoaded:true});config.telegramBackup=true;const events=[];store.emit=(...x)=>events.push(x);
 const request=(patch={links:[LINK]})=>({revision:operatorJobReview(job.id,NOW).revision,reason:'Verified source metadata repair',evidence:[{url:LINK,checked_at:new Date(NOW).toISOString()}],...patch});
 try{await run({j,job,request,events});}finally{store.state.jobs=old.jobs;store.backup=old.backup;store._backupWritesPaused=old.paused;store.persist=old.persist;store.flushBackup=old.flush;store.mergeFromBackup=old.merge;store.emit=old.emit;config.telegramBackup=old.enabled;}
}
test('audited approved metadata repair preserves terminal approval/source/text/location and never publishes Telegram',()=>fixture(async({j,job,request,events})=>{
 const before={decision:JSON.stringify(j.decisions[job.id]),text:job.text,title:job.title,publishedAt:job.publishedAt,decidedBy:job.decidedBy,news:JSON.stringify(store.state.news)};
 const r=await reviseJobMetadata(job.id,request(),NOW);assert.equal(r.ok,true);assert.equal(r.telegram_publication,false);assert.equal(r.public_change,true);assert.deepEqual(job.links,[LINK]);assert.equal(job.status,'approved');assert.equal(JSON.stringify(j.decisions[job.id]),before.decision);assert.equal(job.text,before.text);assert.equal(job.title,before.title);assert.equal(job.publishedAt,before.publishedAt);assert.equal(job.decidedBy,before.decidedBy);assert.equal(job.location,null);assert.equal(JSON.stringify(store.state.news),before.news);assert.equal(j.metadataAudits[job.id].length,1);assert.equal(j.metadataAudits[job.id][0].source.text_sha256.length,64);assert.equal(events.length,1);
}));
test('pending repair stays pending and invalidates an earlier approval revision',()=>fixture(async({j,job,request,events})=>{
 const old=operatorJobReview(job.id,NOW).revision;await reviseJobMetadata(job.id,request(),NOW);assert.equal(job.status,'pending');assert.equal(Object.keys(j.published).length,0);assert.equal(events.length,0);await assert.rejects(operateJobDraft(job.id,{action:'approve_without_location',revision:old},NOW),/stale-review/);
},{pending:true}));
test('links-only repair retains inferred source deadline instead of clearing it via updatedAt',()=>fixture(async({job,request})=>{
 assert.equal(effectiveJobDeadline(job),'2026-12-20');await reviseJobMetadata(job.id,request(),NOW);assert.equal(job.applicationDeadlineOverride,false);assert.equal(effectiveJobDeadline(job),'2026-12-20');
},{text:`فرصة عمل محاسب\n${LINK}\nآخر موعد للتقديم: 2026/12/20`}));
test('reviewed deadline requires matching source evidence and explicit valid date, never null clearing',()=>fixture(async({job,request})=>{
 await assert.rejects(reviseJobMetadata(job.id,request({application_deadline:null}),NOW),/valid-application-deadline/);
 await assert.rejects(reviseJobMetadata(job.id,request({application_deadline:'2026-12-20'}),NOW),/deadline-evidence/);
 const req=request({application_deadline:'2026-12-20',evidence:[{url:LINK,checked_at:new Date(NOW).toISOString(),application_deadline:'2026-12-20'}]});await reviseJobMetadata(job.id,req,NOW);assert.equal(job.applicationDeadline,'2026-12-20');assert.equal(job.applicationDeadlineOverride,true);
}));
test('conflicting deadline evidence and changing a known source deadline are held for separate review',()=>fixture(async({job,request})=>{
 const req=request({application_deadline:'2026-12-21',evidence:[{url:LINK,checked_at:new Date(NOW).toISOString(),application_deadline:'2026-12-21'}]});await assert.rejects(reviseJobMetadata(job.id,req,NOW),/known-deadline-conflict/);
 const conflict=request({application_deadline:'2026-12-20',evidence:[{url:LINK,checked_at:new Date(NOW).toISOString(),application_deadline:'2026-12-20'},{url:job.sourceUrl,checked_at:new Date(NOW).toISOString(),application_deadline:'2026-12-21'}]});await assert.rejects(reviseJobMetadata(job.id,conflict,NOW),/conflicting-deadline-evidence/);
},{text:`فرصة عمل\n${LINK}\nآخر موعد للتقديم: 2026/12/20`}));
test('exact normalized retries do not repeat metadata writes or backup calls',()=>fixture(async({j,job,request})=>{
 let flushes=0;store.backup={};store.flushBackup=async(force)=>{assert.equal(force,true);flushes++;return true;};const req=request();const one=await reviseJobMetadata(job.id,req,NOW),two=await reviseJobMetadata(job.id,req,NOW+1000);assert.equal(one.ok,true);assert.equal(two.reused,true);assert.equal(two.ok,true);assert.equal(flushes,1);assert.equal(j.metadataAudits[job.id].length,1);
}));
test('failed forced durability is explicit and exact retry cannot replay or falsely confirm it',()=>fixture(async({j,job,request,events})=>{
 store.backup={};store.flushBackup=async()=>false;const req=request();const one=await reviseJobMetadata(job.id,req,NOW),two=await reviseJobMetadata(job.id,req,NOW+1000);assert.equal(one.ok,false);assert.equal(one.status,'metadata-backup-unverified');assert.equal(one.public_change,true);assert.equal(two.ok,false);assert.equal(two.reused,true);assert.equal(j.metadataAudits[job.id].length,1);assert.equal(events.length,0);
}));
test('backup readiness and latest-merge checks precede any metadata mutation',()=>fixture(async({job,request})=>{
 const req=request(),before=JSON.stringify(job);store.backup={};store._backupWritesPaused=true;await assert.rejects(reviseJobMetadata(job.id,req,NOW),/backup-recovery-in-progress/);store._backupWritesPaused=false;store.mergeFromBackup=async()=>({backupLoaded:false});await assert.rejects(reviseJobMetadata(job.id,req,NOW),/latest-backup-unverified/);assert.equal(JSON.stringify(job),before);
}));
test('newer terminal deletion merged before a request wins and cannot be reset',()=>fixture(async({j,job,request})=>{
 const req=request();store.backup={};store.mergeFromBackup=async()=>{deleteJobListing(job.id,j,7,NOW);return{backupLoaded:true};};await assert.rejects(reviseJobMetadata(job.id,req,NOW),/listing-not-repairable/);assert.equal(j.decisions[job.id].action,'deleted');
}));
test('new/HTTPS-upgraded/aggregator destinations and unrelated evidence are not invented',()=>fixture(async({job,request})=>{
 await assert.rejects(reviseJobMetadata(job.id,request({links:[LINK.replace('http:','https:')]}),NOW),/application-link-evidence/);
 await assert.rejects(reviseJobMetadata(job.id,request({links:['https://t.me/Syrian_jobbb']}),NOW),/invalid-application-links/);
 await assert.rejects(reviseJobMetadata(job.id,request({links:[LINK],evidence:[{url:'https://example.org/unrelated',checked_at:new Date(NOW).toISOString()}]}),NOW),/evidence-not-in-current-source/);
}));
test('stale/future evidence, stale review and unexpected fields cannot mutate metadata',()=>fixture(async({job,request})=>{
 const before=JSON.stringify(job);for(const checked_at of [new Date(NOW-86400001).toISOString(),new Date(NOW+300001).toISOString()])await assert.rejects(reviseJobMetadata(job.id,request({links:[LINK],evidence:[{url:LINK,checked_at}]}),NOW),/metadata-evidence-not-fresh/);
 await assert.rejects(reviseJobMetadata(job.id,request({links:[LINK],revision:'a'.repeat(64)}),NOW),/stale-review/);await assert.rejects(reviseJobMetadata(job.id,request({links:[LINK],title:'Unapproved text change'}),NOW),/invalid-metadata-field/);assert.equal(JSON.stringify(job),before);
}));
test('per-listing quarantine is reversible with fresh revision and preserves terminal approvals/audits across restore',()=>fixture(async({j,job,request})=>{
 const decision=JSON.stringify(j.decisions[job.id]);await reviseJobMetadata(job.id,request({public_quarantine:true,evidence:[{url:job.sourceUrl,checked_at:new Date(NOW).toISOString()}]}),NOW);assert.equal(publicJobs(j,NOW).length,0);assert.equal(job.status,'approved');assert.equal(JSON.stringify(j.decisions[job.id]),decision);const restored=initialJobsState();mergeJobsFromBackup({jobs:JSON.parse(JSON.stringify(j))},restored);assert.equal(restored.published[job.id].publicReviewHold.active,true);assert.equal(publicJobs(restored,NOW).length,0);assert.equal(restored.metadataAudits[job.id].length,1);
 await reviseJobMetadata(job.id,request({public_quarantine:false,evidence:[{url:job.sourceUrl,checked_at:new Date(NOW).toISOString()}]}),NOW+1000);assert.equal(publicJobs(j,NOW).length,1);assert.equal(job.publicReviewHold.active,false);assert.equal(j.metadataAudits[job.id].length,2);mergeJobsFromBackup({jobs:JSON.parse(JSON.stringify(j))},restored);assert.equal(restored.published[job.id].publicReviewHold.active,false);assert.equal(JSON.stringify(j.decisions[job.id]),decision);
}));
test('stale quarantine snapshots cannot undo a newer release, and ignored/deleted rows stay terminal',()=>fixture(async({j,job,request})=>{
 await reviseJobMetadata(job.id,request({public_quarantine:true}),NOW);const stale=JSON.parse(JSON.stringify(j));await reviseJobMetadata(job.id,request({public_quarantine:false}),NOW+1);mergeJobsFromBackup({jobs:stale},j);assert.equal(job.publicReviewHold.active,false);assert.equal(j.published[job.id].publicReviewHold.active,false);deleteJobListing(job.id,j,123,NOW+2);mergeJobsFromBackup({jobs:stale},j);assert.equal(j.published[job.id],undefined);assert.equal(j.decisions[job.id].action,'deleted');assert.equal(j.metadataAudits[job.id].length,2);
}));
test('metadata audit survives ignoring a repaired pending listing and metadata cannot revive it',()=>fixture(async({j,job,request})=>{
 await reviseJobMetadata(job.id,request(),NOW);const next=request();decideJob(job.id,'ignore',j,7,NOW+1);await assert.rejects(reviseJobMetadata(job.id,next,NOW+2),/listing-not-repairable/);const restored=initialJobsState();mergeJobsFromBackup({jobs:JSON.parse(JSON.stringify(j))},restored);assert.equal(restored.metadataAudits[job.id].length,1);assert.equal(restored.decisions[job.id].action,'ignored');assert.equal(restored.pending[job.id],undefined);
},{pending:true}));
test('newer audited pending metadata merges but cannot defeat terminal ignore',()=>fixture(async({j,job,request})=>{
 const old=JSON.parse(JSON.stringify(j));await reviseJobMetadata(job.id,request(),NOW);const repaired=JSON.parse(JSON.stringify(j));mergeJobsFromBackup({jobs:repaired},old);assert.deepEqual(old.pending[job.id].links,[LINK]);assert.equal(old.metadataAudits[job.id].length,1);decideJob(job.id,'ignore',old,7,NOW+1);mergeJobsFromBackup({jobs:repaired},old);assert.equal(old.pending[job.id],undefined);assert.equal(old.decisions[job.id].action,'ignored');
},{pending:true}));
