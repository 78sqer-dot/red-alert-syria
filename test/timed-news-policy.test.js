import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';
process.env.DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/ras-timed-');process.env.BOT_TOKEN='123456:SYNTHETIC';process.env.TELEGRAM_BACKUP='false';process.env.OWNER_IDS='8270709633';
const {store}=await import('../server/store.js');await store.init(null);const mon=await import('../server/news-monitor.js');const {buildAlertInput,createBot}=await import('../server/bot.js');const {timedNewsWindow,timedNewsDue}=await import('../server/timed-news-policy.js');const {boundReviewedCopy}=await import('../server/reviewed-news-copy.js');
let sends=0;const flush=store.flushBackup;
function setup({due=true,old=false}={}){store.backup={};store._backupWritesPaused=false;store.flushBackup=async()=>true;store.state.alerts=[];store.state.gone={};const n=mon.newsState();n.on=true;n.editorialMode='reviewed';n.editorialModeAt=10;n.timedPolicy={enabled:true,effectiveAt:Date.now()-10000};n.drafts={};n.alerts=[];n.echoLog=[];const now=Date.now();const d={id:'future',status:'pending',type:'military_incursion',headline:'توغل عسكري في عابدين',body:'دخلت قوة عسكرية إلى عابدين وفتشت منازل.',sourceText:'دخلت قوة عسكرية إلى عابدين وفتشت منازل.',sourceTextVersion:2,loc:{scope:'place',name_ar:'عابدين',latitude:32.77,longitude:35.82},extra:[],srcs:[{u:'synthetic',name:'fixture',url:'https://example.org/report',ts:now}],created:old?now-20000:now,ts:now,cards:[],timedNews:{policyAt:n.timedPolicy.effectiveAt,cardAt:now-1000,dueAt:due?now-1:now+120000,window:'night',state:'waiting'}};n.drafts[d.id]=d;sends=0;mon._test.R.rewriteImpl=async()=> 'دخلت قوة عسكرية إلى عابدين وفتشت منازل.';mon._test.R.H={apis:()=>({admin:{}}),publishDraft:async(_,p)=>{sends++;const a=store.addAlert(buildAlertInput(p,null));a.channel_message_id=200;return a;}};return d;}
test('Damascus day/night boundaries, daytime120s and nighttime0s deadlines',()=>{for(const [iso,window,delay]of [['2026-11-24T04:59:59Z','night',0],['2026-11-24T05:00:00Z','day',120000],['2026-11-24T18:59:59Z','day',120000],['2026-11-24T19:00:00Z','night',0]]){const t=Date.parse(iso);assert.equal(timedNewsWindow(t),window);assert.equal(timedNewsDue(t)-t,delay);}});
test('server owned timer publishes professional attributed country copy with no incident pin; replay cannot resend',async()=>{const d=setup();await mon._test.timedNewsTick();assert.equal(sends,1);assert.equal(d.status,'published');assert.equal(store.state.alerts[0].location,null);assert.equal(store.state.alerts[0].scope,'country');assert.match(store.state.alerts[0].body,/بحسب تقرير/);assert.match(store.state.alerts[0].body,/لم نتحقق/);assert.match(store.state.alerts[0].body,/اشتركوا/);await mon._test.timedNewsTick();assert.equal(sends,1);});
test('day deadline no early send; no historical or unenrolled pending burst; reject/owner claim terminal wins',async()=>{for(const change of [d=>d.status='ignored',d=>d.nativeReview={result:'claimed'},d=>delete d.timedNews,d=>d.created-=20000]){const d=setup();change(d);await mon._test.timedNewsTick();assert.equal(sends,0);}setup({due:false});await mon._test.timedNewsTick();assert.equal(sends,0);});
test('owner rejection or source revision change during async preparation prevents stale publication',async()=>{
 for(const change of [d=>d.status='ignored',d=>d.nativeReview={result:'claimed'},d=>d.sourceText+=' تغيير']){const d=setup();const pending=mon._test.prepareTimedProfessional(d);change(d);await assert.rejects(()=>pending);assert.equal(sends,0);assert.equal(d.reviewedCopy,undefined);}
});
test('no rewrite provider call or quota is needed for faithful professional framing',async()=>{
 setup();mon._test.R.rewriteImpl=async()=>{throw Error('must not call provider');};await mon._test.timedNewsTick();assert.equal(sends,1);
});
test('ambiguous publication stays claimed uncertain, never blindly retries',async()=>{const d=setup();mon._test.R.H.publishDraft=async()=>{sends++;throw Error('synthetic timeout');};await mon._test.timedNewsTick();assert.equal(d.status,'publishing');assert.equal(d.operatorReview.result,'uncertain');await mon._test.timedNewsTick();assert.equal(sends,1);});
test('durable claim failure sends nothing; owner private note can only become factual from source on explicit native preparation',async()=>{let d=setup();store.flushBackup=async()=>false;await mon._test.timedNewsTick();assert.equal(sends,0);d=setup();d.editorialHold=true;d.editorialHoldReason='owner-private-editorial-note';d.privateEditorial={opinion:'رأي خاص'};d.aiRewritePreview={mode:'opinion',applied:true,text:'رأي خاص'};await mon._test.prepareTimedProfessional(d,{native:true});assert.ok(boundReviewedCopy(d));assert.equal(d.privateEditorial,undefined);assert.ok(d.reviewedCopyAudit.prior.privateEditorial);assert.doesNotMatch(d.body,/رأي خاص/);});
test('policy activation is explicit future-only and needs ready durable backup/provider',async()=>{setup();mon.newsState().timedPolicy=null;mon._test.R.rewriteImpl=null;const p=await mon.setTimedNewsPolicy(true);assert.equal(p.enabled,true);assert.equal(p.timezone,'Asia/Damascus');assert.equal(p.dayDelaySeconds,120);assert.equal(p.nightDelaySeconds,0);});
test('actual native Publish removes private-note blocking through factual bridge; Ignore during async rewrite wins',async()=>{
 const bot=createBot();bot.botInfo={id:1,is_bot:true,first_name:'Fixture',username:'FixtureBot'};bot.api.config.use(async()=>({ok:true,result:true}));let seq=1;
 const tap=async(data)=>bot.handleUpdate({update_id:seq++,callback_query:{id:'fixture-'+seq,from:{id:8270709633,is_bot:false,first_name:'Fixture'},chat_instance:'fixture',data,message:{message_id:7,date:0,chat:{id:8270709633,type:'private'},text:'Fixture'}}});
 let d=setup();d.editorialHold=true;d.editorialHoldReason='owner-private-editorial-note';d.privateEditorial={opinion:'private note'};await tap('nw:p:future');assert.equal(sends,1);assert.equal(d.status,'published');
 d=setup();d.status='ignored';await tap('nw:p:future');assert.equal(d.status,'ignored');assert.equal(sends,0);
});
test('actual provider tense regression and qualified legal claims retain all source assertions in faithful attributed fallback',async()=>{
 for(const [source,output]of [
 ['أعلنت بلدية محلية في سوريا فتح مكتبة عامة جديدة تضم 300 كتاب. ولم تعلن البلدية موعد بدء استقبال الزوار.','افتتحت بلدية محلية في سوريا مكتبة عامة جديدة تضم 300 كتاب، دون تحديد موعد استقبال الزوار.'],
 ['ذكرت تقارير صدور حكم بالإعدام، لكنه قابل للطعن ولم ينفذ الحكم. واختلفت المصادر في العدد بين سبع وعشر سيارات.','نُفذ الإعدام ودخلت سبع سيارات.'],
 ['تعتزم البلدية فتح الطريق غداً ولم يبدأ العمل بعد. ونفت جهة رسمية إغلاقه.','فتحت البلدية الطريق.']]){
 const d=setup();d.sourceText=source;mon._test.R.rewriteImpl=async()=>output;await mon._test.timedNewsTick();assert.equal(sends,1);assert.ok(store.state.alerts[0].body.includes(source));assert.equal(d.reviewedCopyAudit.review.copyMode,'faithful-source-attributed-framing');assert.ok(!store.state.alerts[0].body.includes(output));
 }
});
test('monitor stop prevents automatic publishing and private owner holds require explicit native tap',async()=>{
 let d=setup();mon.newsState().on=false;await mon._test.timedNewsTick();assert.equal(sends,0);
 d=setup();d.editorialHold=true;d.editorialHoldReason='owner-private-editorial-note';d.privateEditorial={opinion:'private note'};await mon._test.timedNewsTick();assert.equal(sends,0);assert.ok(d.privateEditorial);assert.equal(d.status,'pending');
});
test('independent exact-source original military incident cannot republish as breaking',async()=>{
 const d=setup();const prior=store.addAlert({type:'military_incursion',title:d.headline,description:d.sourceText,body:d.sourceText,location:{latitude:32.77,longitude:35.82},place:d.loc,source:'news'});prior.channel_message_id=199;mon._test.rememberAlert(prior);await mon._test.timedNewsTick();assert.equal(sends,0);
});
test('stop or disable at durable preparation and claim boundaries prevents send',async()=>{
 for(const at of [1,2])for(const native of [false,true]){const d=setup();let calls=0;store.flushBackup=async()=>{if(++calls===at){if(native)mon.newsState().timedPolicy.enabled=false;else mon.newsState().on=false;}return true;};if(native){await mon._test.prepareTimedProfessional(d,{native:true});await assert.rejects(()=>mon._test.publishTimedProfessional(d));}else await mon._test.timedNewsTick();assert.equal(sends,0);}
});
test('professional cleanup removes outlet identity, feed footer and promo while preserving speakers and denials',()=>{
 const f=mon._test.professionalFactualText;
 const source='أفاد مراسل الجزيرة بأن مصادر محلية نفت وقوع انفجار ولم يتسن التحقق.';
 const result=f(source,[]);assert.doesNotMatch(result,/الجزيرة/);assert.match(result,/مصادر محلية نفت وقوع انفجار/);assert.match(result,/لم يتسن التحقق/);
 const court=f('أعلنت الهيئة الوطنية صدور حكم قابل للطعن ولم ينفذ الحكم.\nS.N.N | شبكة شام',['شبكة شام']);assert.doesNotMatch(court,/S\.N|\|/);assert.match(court,/أعلنت الهيئة الوطنية/);assert.match(court,/قابل للطعن ولم ينفذ الحكم/);
 const raid=f('قوات الاحتلال الإسرائيلي تتحرك بسبع آليات في القرية التفاصيل',[]);assert.doesNotMatch(raid,/الاحتلال|التفاصيل/);assert.match(raid,/قوات إسرائيلية تتحرك بسبع آليات/);
});
test('claim status changed while durable write awaits prevents wire send',async()=>{const d=setup();let calls=0;store.flushBackup=async()=>{if(++calls===2)d.status='ignored';return true;};await mon._test.timedNewsTick();assert.equal(sends,0);});
test.after(()=>{store.backup=null;store.flushBackup=flush;mon._test.R.H=null;mon._test.R.rewriteImpl=null;});
