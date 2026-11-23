import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';
process.env.DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/ras-incursion-');process.env.TELEGRAM_BACKUP='false';
const {sameIncident,_test,newsState}=await import('../server/news-monitor.js');
const geo=(lat=32.77,lon=35.79)=>({pts:[{lat,lon}],precisePts:[{lat,lon}],dists:['درعا'],govs:['درعا'],none:false,coarse:false});
const event=(text,g=geo())=>({type:'military_incursion',ts:1000,headline:text,sourceText:text,geo:g});
test('same district does not combine WadiSihan3 vehicles/fire with7 vehicle route toward Maariya',()=>{
 const a=event('توغلت قوة إسرائيلية مؤلفة من ثلاث سيارات في وادي سيحان بريف درعا الغربي بالتزامن مع إطلاق نار وقنابل مضيئة.',geo(32.8,35.8));
 const b=event('توغلت قوة إسرائيلية مؤلفة من سبع سيارات قادمة من ثكنة الجزيرة باتجاه معرية بريف درعا الغربي.',geo(32.77,35.79));assert.equal(sameIncident(a,b),false);
});
test('matching count/district alone does not establish event identity; unknown precise geography stays separate',()=>{
 const a=event('دخول قوة إسرائيلية مؤلفة من سبع سيارات إلى درعا',geo(32.77,35.79));const b=event(a.headline,geo(32.85,35.9));assert.equal(sameIncident(a,b),false);b.geo={pts:[],dists:['درعا'],govs:['درعا'],none:false,coarse:true};assert.equal(sameIncident(a,b),false);
});
test('same precise place and strongly matching report can cluster, conflicting count or action cannot',()=>{
 const a=event('توغلت قوة إسرائيلية مؤلفة من سبع سيارات في معرية بريف درعا الغربي');const b=event(a.headline);assert.equal(sameIncident(a,b),true);b.sourceText=b.headline.replace('سبع','ثلاث');assert.equal(sameIncident(a,b),false);b.sourceText=a.headline+' باتجاه الوادي';a.sourceText=a.headline+' بالتزامن مع إطلاق نار';assert.equal(sameIncident(a,b),false);
});
test('accepted incursion merge preserves original primary/extra geography and records incoming provenance',async()=>{
 const n=newsState();n.editorialMode='reviewed';const loc={scope:'place',place_id:1,latitude:32.77,longitude:35.79,name_ar:'الموقع الأصلي'};const d={id:'synthetic',type:'military_incursion',status:'pending',srcs:[{u:'first'}],loc,extra:[],cards:[],created:Date.now(),editorialHold:true,editorialHoldReason:'operator-review-hold'};n.drafts={synthetic:d};_test.R.H=null;const before=structuredClone(loc);await _test.mergeInto(d,{src:{u:'second',name:'fixture'},url:'https://example.org/report',text:'Synthetic matching incursion',ts:Date.now()},[{scope:'place',place_id:2,latitude:32.771,longitude:35.791,name_ar:'سياق آخر'}]);assert.deepEqual(d.loc,before);assert.deepEqual(d.extra,[]);assert.equal(d.mergeEvidence[0].sourceUrl,'https://example.org/report');assert.equal(d.editorialHold,true);
});

const fireText = 'توغلت قوة إسرائيلية مؤلفة من ثلاث سيارات في وادي سيحان بريف درعا الغربي بالتزامن مع إطلاق نار وقنابل مضيئة.';
const routeText = 'توغلت قوة إسرائيلية مؤلفة من سبع سيارات في وادي سيحان بريف درعا الغربي باتجاه معرية.';
const place = { scope: 'place', latitude: 32.77, longitude: 35.79 };
function echoSetup(text=fireText) { newsState().echoLog=[{id:'older-synthetic',type:'military_incursion',ts:Date.now(),text,geo:geo()}]; }
test('echo and final-publication guards reject conflicting incursion count/action even at same point',()=>{
 echoSetup();const d={...event(routeText),sourceText:routeText,loc:place,extra:[]};
 assert.equal(_test.selfEchoOf(d,routeText),null);
 assert.equal(_test.finalPublishDuplicate(d,{headline:routeText,body:routeText}),null);
});
test('landed cleanup does not mark/delete distinct incursion post',async()=>{
 echoSetup();const d={...event(routeText),id:'new-draft',status:'published',sourceText:routeText,loc:place,extra:[]};
 const result=await _test.autoDeleteLandedDuplicate(d,{headline:routeText,body:routeText},'new-alert');
 assert.equal(result,null);assert.equal(d.status,'published');assert.equal(d.duplicateOf,undefined);
});
test('same precise incursion remains recognized by echo/final guards, old coarse echo stays uncertain',()=>{
 echoSetup();const d={...event(fireText),sourceText:fireText,loc:place,extra:[]};
 assert.equal(_test.selfEchoOf(d,fireText)?.id,'older-synthetic');
 assert.equal(_test.finalPublishDuplicate(d,{headline:fireText,body:fireText})?.id,'older-synthetic');
 delete newsState().echoLog[0].geo.precisePts;
 assert.equal(_test.selfEchoOf(d,fireText),null);assert.equal(_test.finalPublishDuplicate(d,{headline:fireText,body:fireText}),null);
});
test('incursion source merge retains auto-audit hold for semantic review',async()=>{
 const d={id:'audit-fixture',type:'military_incursion',status:'pending',srcs:[{u:'first'}],loc:place,extra:[],cards:[],created:Date.now(),editorialHold:true,editorialHoldReason:'auto-audit-failed',editorialHoldAt:123};
 newsState().drafts={ [d.id]:d };await _test.mergeInto(d,{src:{u:'new',name:'fixture'},url:'https://example.org/second',text:fireText,ts:Date.now()},[place]);
 assert.equal(d.editorialHold,true);assert.equal(d.editorialHoldReason,'auto-audit-failed');assert.equal(d.editorialHoldAt,123);
});
