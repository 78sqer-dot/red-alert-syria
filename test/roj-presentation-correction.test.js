import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {rojCorrectionCandidate} from '../server/roj-photo-correction.js';
import {isCheckpointReport,isMineDiscoveryReport,refineType,ruleClassify} from '../server/news-ai.js';
test('checkpoint establishment routes to checkpoint subtype, never ordinary patrol or violence',()=>{
 for(const text of ['الاحتلال الإسرائيلي ينصب حاجزا ويفتش المارة بريف القنيطرة','القوات الإسرائيلية تنصب حاجزاً مؤقتاً وتفتش المارة بريف القنيطرة']){
  assert.equal(isCheckpointReport(text),true);assert.equal(refineType('patrol',text),'military_incursion');assert.equal(ruleClassify(text)?.type,'military_incursion');
 }
 for(const text of ['دورية إسرائيلية في القنيطرة','هجوم على حاجز عسكري','استهداف حاجز ووقوع إصابات','القوات لم تنصب حاجزا في القنيطرة','إزالة حاجز عسكري'])assert.equal(isCheckpointReport(text),false);
});
test('exact camp correction fails closed for other posts and sources',()=>{
 const a={id:'3320c747-0028-45be-b13e-a3c81da25fbf',channel_message_id:1553,type:'attack',channel_media:'photo',place:{place_id:900000000053},description:'إصابة ثلاثة أشخاص بينهم امرأتان وطفل برصاص عناصر الحماية في مخيم روج بريف المالكية.',meta:{newsSources:[{url:'https://t.me/AbomosaabSharkea/183201'}]},extra:[{place_id:173530}]};
 assert.equal(rojCorrectionCandidate(a).place.short_ar,'مخيم الروج - الحسكة');assert.deepEqual(rojCorrectionCandidate(a).extra,[]);assert.equal(rojCorrectionCandidate({...a,channel_message_id:1554}),null);assert.equal(rojCorrectionCandidate({...a,meta:{}}),null);
});
test('popup photo action requires real media, place precedes quoted body, tools centered',()=>{
 const app=fs.readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8'),css=fs.readFileSync(new URL('../public/css/app.css',import.meta.url),'utf8');
 assert.match(app,/const illustrationFallback = false/);assert.match(app,/const mediaActions = mediaItems.length/);assert.match(app,/class="pp-areas"[\s\S]*?<blockquote class="pp-desc">/);assert.match(css,/map-control-actions \{ display: flex; justify-content: center/);
});

test('mine discovery is civil warning not an explosion, detonations stay explosions',()=>{
 const discovery='أهالي الشيوخ شرق حلب يعثرون على لغم أرضي أثناء تسوية طريق مدرسة الناصرية';
 assert.equal(isMineDiscoveryReport(discovery),true);assert.equal(refineType('explosion',discovery),'civil');assert.equal(ruleClassify(discovery)?.type,'civil');
 assert.equal(isMineDiscoveryReport('إصابة طفل جراء انفجار لغم في حلب'),false);assert.equal(refineType('explosion','إصابة طفل جراء انفجار لغم في حلب'),'explosion');
});

test('owner post repairs wait for durable handoff and do not broaden rule-derived refinement',()=>{
 const index=fs.readFileSync(new URL('../server/index.js',import.meta.url),'utf8'),monitor=fs.readFileSync(new URL('../server/news-monitor.js',import.meta.url),'utf8');
 assert.match(index,/if \(store._backupWritesPaused\) \{ setTimeout\(runOwnerPostCorrections, 5000\)/);
 assert.match(monitor,/if \(!r.rule \|\| isCheckpointReport\(it.text\) \|\| isMineDiscoveryReport\(it.text\)\)/);
});
