import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import express from 'express';
process.env.DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/ras-share-url-');
process.env.TELEGRAM_BACKUP='false';process.env.BOT_TOKEN='123456:SYNTHETIC';process.env.PUBLIC_URL='https://example.org/';
const {store}=await import('../server/store.js');await store.init(null);
const mon=await import('../server/news-monitor.js');
const {alertShareUrl}=await import('../server/alert-share-url.js');
const {locationFrom}=await import('../server/places.js');
const loc=locationFrom({placeId:167501});
const {mountNewsReviewRoutes}=await import('../server/news-review-routes.js');
const { _test:seo }=await import('../server/seo.js');
let sends=0;
function setup(){store.backup=null;store._backupWritesPaused=false;store.state.alerts=[];store.state.gone={};const n=mon.newsState();n.editorialMode='reviewed';n.echoLog=[];n.alerts=[];n.drafts={sample:{id:'sample',status:'pending',type:'explosion',headline:'انفجار في محجة',body:'انفجار عبوة ناسفة في بلدة محجة أدى إلى إصابة شاب.',sourceText:'انفجار عبوة ناسفة في بلدة محجة أدى إلى إصابة شاب.',sourceTextVersion:2,loc,extra:[],srcs:[{u:'synthetic',name:'fixture',url:'https://example.org/report',local:false}],created:Date.now(),ts:Date.now(),cards:[]}};sends=0;mon._test.R.H={apis:()=>({admin:{}}),publishDraft:async()=>{sends++;const a=store.addAlert({type:'explosion',title:'انفجار في محجة',description:'انفجار في محجة',body:n.drafts.sample.body,location:loc,source:'news'});a.channel_message_id=91;return a;}};return{action:'publish',revision:mon.operatorNewsReview('sample').revision};}
test('URL constructor validates trusted base and encodes ID without accepting source-chosen host',()=>{
 assert.equal(alertShareUrl('a/b?x#y','ar','https://example.org///'),'https://example.org/ar/a/a%2Fb%3Fx%23y');
 assert.equal(alertShareUrl('id','en','https://example.org'),'https://example.org/en/a/id');
 for(const base of ['javascript:alert(1)','https://u:p@example.org','https://example.org/path','https://example.org?x=1','bad'])assert.equal(alertShareUrl('id','ar',base),null);
});
test('mounted guarded publish returns stored confirmed URL, replay reuses it and SEO canonical matches',async()=>{
 const req=setup();const app=express();mountNewsReviewRoutes(app,{adminKeyOk:r=>r.headers['x-admin-key']==='fixture',apiLimiter:(_r,_s,next)=>next()});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const u=`http://127.0.0.1:${server.address().port}/api/admin/news/sample/review`;const post=()=>fetch(u,{method:'POST',headers:{'content-type':'application/json','x-admin-key':'fixture'},body:JSON.stringify(req)});const response=await post();assert.equal(response.status,200);const result=await response.json();assert.equal(result.share_url,alertShareUrl(result.alertId));const page=seo.alertSharePage(result.alertId,'ar');assert.ok(page.includes(`<link rel="canonical" href="${result.share_url}">`));assert.ok(page.includes(`<meta property="og:url" content="${result.share_url}">`));const repeat=await(await post()).json();assert.equal(repeat.share_url,result.share_url);assert.equal(sends,1);
 for(const mutate of [a=>a.channel_message_id=92,a=>store.state.gone[a.id]=Date.now(),()=>store.state.alerts=[]]){const original=structuredClone(store.state.alerts);store.state.gone={};if(original[0])mutate(store.state.alerts[0]);else mutate({id:result.alertId});assert.equal((await mon.operateNewsDraft('sample',req)).share_url,undefined);store.state.alerts=original;}
 }finally{await new Promise(r=>server.close(r));}
});
test('nonconfirmed outcome branches never expose share_url',async()=>{
 let req=setup();assert.equal((await mon.operateNewsDraft('sample',{...req,action:'hold'})).share_url,undefined);
 req=setup();const d=mon.newsState().drafts.sample;mon.newsState().echoLog=[{id:'prior',ts:Date.now(),type:d.type,text:d.sourceText,geo:mon._test.geoOf([loc])}];req.revision=mon.operatorNewsReview('sample').revision;assert.equal((await mon.operateNewsDraft('sample',req)).share_url,undefined);
 req=setup();mon._test.R.H.publishDraft=async()=>({id:'missing-alert',channel_message_id:91});assert.equal((await mon.operateNewsDraft('sample',req)).share_url,undefined);
 req=setup();mon._test.R.H.publishDraft=async()=>({id:'map-only'});assert.equal((await mon.operateNewsDraft('sample',req)).share_url,undefined);
 req=setup();const publisher=mon._test.R.H.publishDraft;mon._test.R.H.publishDraft=async(...args)=>{const a=await publisher(...args);store.backup={};store.flushBackup=async()=>false;return a;};const flush=store.flushBackup;try{assert.equal((await mon.operateNewsDraft('sample',req)).share_url,undefined);}finally{store.flushBackup=flush;store.backup=null;}
 req=setup();mon._test.R.H.publishDraft=async()=>{throw Error('synthetic uncertainty');};await assert.rejects(()=>mon.operateNewsDraft('sample',req),/unverified/);
});
test.after(()=>{mon._test.R.H=null;});
