import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';
process.env.DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/ras-owner-review-');process.env.BOT_TOKEN='12345:mock';process.env.OWNER_IDS='123';process.env.TELEGRAM_BACKUP='false';
const {store}=await import('../server/store.js');const m=await import('../server/news-monitor.js');const{locationFrom}=await import('../server/places.js');
const ctx={from:{id:123},chat:{id:123,type:'private'}};let calls=0;
function setup(){store.backup=null;store.state.alerts=[];store.state.gone={};const n=m.newsState();n.stats={};n.alerts=[];n.echoLog=[];n.drafts={a:{id:'a',status:'pending',type:'explosion',headline:'انفجار في محجة',body:'انفجار عبوة ناسفة في بلدة محجة أدى إلى إصابة شاب.',sourceText:'انفجار عبوة ناسفة في بلدة محجة أدى إلى إصابة شاب.',sourceTextVersion:2,loc:locationFrom({placeId:167501}),extra:[],srcs:[{u:'synthetic',name:'اختبار',url:'https://t.me/synthetic/1',local:false}],editorialHold:true,operatorReview:{result:'held'},created:Date.now(),ts:Date.now(),cards:[]}};calls=0;m._test.R.H={apis:()=>({admin:{}}),publishDraft:async()=>{calls++;return{id:'synthetic',channel_message_id:10}}};const d=n.drafts.a;return{...m.toBotDraft(m._test.sourceFirstCandidate(d),{preservePublishedCopy:true}),ownerNewsReview:{id:'a',owner:123,revision:m.operatorNewsReview('a').revision}};}
test('configured private owner publishes reviewed held source exactly once through durable transaction',async()=>{const p=setup(),r=await m.ownerReviewNewsPreview(ctx,p);assert.equal(r.result.status,'published');assert.equal(calls,1);await assert.rejects(()=>m.ownerReviewNewsPreview(ctx,p));assert.equal(calls,1);assert.equal(m.newsState().drafts.a.ownerReviewAudit.by,123);});
test('nonowner/group/stale/uncertain/local-source/private body cannot bypass',async()=>{for(const c of [{from:{id:124},chat:{id:124,type:'private'}},{from:{id:123},chat:{id:-1,type:'group'}}]){const p=setup();await assert.rejects(()=>m.ownerReviewNewsPreview(c,p));assert.equal(calls,0);}for(const change of [d=>d.sourceText+='changed',d=>d.operatorReview.result='uncertain',d=>d.status='published',d=>d.nativeReview={result:'claimed'}]){const p=setup();change(m.newsState().drafts.a);await assert.rejects(()=>m.ownerReviewNewsPreview(ctx,p));assert.equal(calls,0);}const p=setup();p.body='invented';const r=await m.ownerReviewNewsPreview(ctx,p);assert.ok(r.preview);assert.notEqual(r.preview.body,'invented');assert.equal(calls,0);});
test('source-preserving type/location correction requires refreshed canonical preview before final decision',async()=>{const p=setup();p.headline='edited';const r=await m.ownerReviewNewsPreview(ctx,p);assert.ok(r.preview);assert.equal(calls,0);assert.equal((await m.ownerReviewNewsPreview(ctx,r.preview)).result.status,'published');assert.equal(calls,1);});
test('native edit uses existing preview while direct publish hold and ordinary staff hold remain',()=>{const s=fs.readFileSync(new URL('../server/news-monitor.js',import.meta.url),'utf8');assert.ok(s.includes("act === 'e' && privateOwner(ctx)"));assert.ok(s.includes("if ((act === 'p' || act === 'e') && (d.editorialHold"));const b=fs.readFileSync(new URL('../server/bot.js',import.meta.url),'utf8');assert.ok(b.indexOf('if(d.ownerNewsReview)')<b.indexOf("if (d.type === 'breaking' && !d.text) return askLocation(ctx, d);",b.indexOf("bot.callbackQuery('publish',")));});

test('single local source and durability failure never send, duplicate never sends',async()=>{
 let p=setup();m.newsState().drafts.a.srcs[0].local=true;p.ownerNewsReview.revision=m.operatorNewsReview('a').revision;await assert.rejects(()=>m.ownerReviewNewsPreview(ctx,p),/independent-source/);assert.equal(calls,0);
 p=setup();const old=store.flushBackup;store.backup={};store.flushBackup=async()=>false;try{await assert.rejects(()=>m.ownerReviewNewsPreview(ctx,p),/durable-claim/);assert.equal(calls,0);}finally{store.backup=null;store.flushBackup=old;}
});

test('actual native callback permits type-conflict correction preview and retains pending hold',async()=>{
 const handlers=[],bot={callbackQuery:(p,f)=>handlers.push([p,f]),command:()=>{},on:()=>{}};let loaded;
 m.registerNewsTools(bot,{owner:()=>true,langOf:()=> 'ar',loadDraft:async(c,p)=>{loaded=p},apis:()=>({admin:{}})});
 setup();const d=m.newsState().drafts.a;d.type='airstrike';d.sourceText='تحذير من اضطراب بحري وأمواج مرتفعة قبالة سواحل اللاذقية وطرطوس.';d.body=d.sourceText;d.headline=d.sourceText;d.loc=locationFrom({});
 // Country weather source remains source-preserving. If another factual gate rejects,
 // this test must use a source that otherwise passes instead of ignoring that gate.
 d.loc={...locationFrom({}),name_ar:'سوريا'};d.sourceText+=' في سوريا';d.body=d.sourceText;
 const h=handlers.find(([p])=>p instanceof RegExp&&p.source==='^nw:(p|x|t|b|e):(\\w+)$')?.[1];assert.ok(h);
 const c={...ctx,match:['nw:e:a','e','a'],callbackQuery:{message:{chat:{id:123},message_id:1}},answerCallbackQuery:async()=>{},api:{},editMessageReplyMarkup:async()=>{}};
 await h(c);assert.ok(loaded?.ownerNewsReview);assert.equal(d.status,'pending');assert.equal(calls,0);
});
test('owner review intercepts road before all publish dispatch variants',()=>{const b=fs.readFileSync(new URL('../server/bot.js',import.meta.url),'utf8');const c=b.slice(b.indexOf("bot.callbackQuery('publish',"),b.indexOf("bot.callbackQuery('submit',"));assert.ok(c.indexOf('if(d.ownerNewsReview)')<c.indexOf("d.type === 'road'"));assert.ok(b.includes("!d.ownerNewsReview && d.type === 'road'"));});

test('actual final publish callback cannot route mutated road draft around monitored review',async()=>{
 const vm=await import('node:vm');const p=setup();p.type='road';let handler,roadCalls=0,manualCalls=0,blocked=0;
 const src=fs.readFileSync(new URL('../server/bot.js',import.meta.url),'utf8');const code=src.slice(src.indexOf("bot.callbackQuery('publish',"),src.indexOf("bot.callbackQuery('submit',"));
 vm.runInNewContext(code,{bot:{callbackQuery:(_,f)=>{handler=f}},needDraft:f=>f,staff:()=>true,ownerReviewNewsPreview:m.ownerReviewNewsPreview,publishRoadDraft:async()=>roadCalls++,publishDraft:async()=>manualCalls++,langOf:()=> 'en',sessions:new Map(),sk:()=> 'test',show:async()=>{},showPreview:async()=>{},L:()=>({}),InlineKeyboard:class{},config:{},APIS:{}});
 await handler({...ctx,answerCallbackQuery:async()=>blocked++},p);assert.equal(roadCalls,0);assert.equal(manualCalls,0);assert.equal(calls,0);assert.equal(blocked,1);
});
