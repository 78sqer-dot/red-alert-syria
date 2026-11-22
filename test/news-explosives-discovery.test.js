import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ras-explosive-discovery-'));
process.env.DATA_DIR=dir;
process.env.TELEGRAM_BACKUP='false';
process.env.BOT_TOKEN='123456:LOCAL_TEST';
const {store}=await import('../server/store.js');
await store.init(null);
const {ruleClassify,refineType}=await import('../server/news-ai.js');
const {localityQualifierOnly}=await import('../server/places.js');
const {_test,operatorNewsReview}=await import('../server/news-monitor.js');
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/explosives-discovery-419.json',import.meta.url)));
test.after(async()=>{await new Promise(r=>setTimeout(r,350));fs.rmSync(dir,{recursive:true,force:true});});
test('419 actual source reports explosives discovery, not a blast',()=>{
 assert.equal(ruleClassify(fixture.sourceText).type,'civil');
 for(const type of ['civil','breaking','explosion'])assert.equal(refineType(type,fixture.sourceText),'civil',type);
});
test('finding and clearance do not assert a detonation; actual blasts remain explosions',()=>{
 for(const source of [
  'العثور على ألغام ومتفجرات داخل مدرسة في الحسكة.',
  'فرق الهندسة تزيل مخلفات الحرب والذخائر في حمص.',
  'اكتشاف مستودع لتصنيع الألغام في درعا.'
 ]){assert.equal(ruleClassify(source).type,'civil',source);assert.equal(refineType('explosion',source),'civil',source);}
 for(const source of [
  'انفجار لغم في ريف الحسكة أسفر عن إصابة مدني.',
  'العثور على عبوة ناسفة ثم انفجارها في حمص.',
  'تفجير مخلفات الحرب في حلب من قبل فرق الهندسة.'
 ]){assert.equal(ruleClassify(source).type,'explosion',source);assert.equal(refineType('explosion',source),'explosion',source);}
});
test('an explosives-smuggling interception stays its specific category',()=>{
 const source='إحباط محاولة تهريب متفجرات وضبط عبوات ناسفة في حمص.';
 assert.equal(ruleClassify(source).type,'smuggling_explosives');
 assert.equal(refineType('explosion',source),'smuggling_explosives');
});
test('multiword village and countryside/subdistrict qualifier establish only one incident place',()=>{
 assert.equal(localityQualifierOnly('تل تمر','تل مساس',fixture.sourceText),true);
 assert.equal(localityQualifierOnly('تل تمر','تل مساس','العثور على ألغام في قرية تل مساس بريف ناحية تل تمر.'),true);
 assert.equal(localityQualifierOnly('تل تمر','تل مساس','العثور على ألغام في قرية تل مساس في ريف ناحية تل تمر.'),true);
});
test('a separately reported incident in the parent town is never discarded',()=>{
 for(const source of [
  fixture.sourceText+'\nووقع حريق في تل تمر.',
  'وقع انفجار في تل تمر. والعثور على متفجرات في تل مساس بريف ناحية تل تمر.',
  'العثور على ألغام في تل مساس وقصف على تل تمر.'
 ])assert.equal(localityQualifierOnly('تل تمر','تل مساس',source),false,source);
});
test('source-first review blocks the unsupported explosion before creating a public candidate',()=>{
 assert.throws(()=>_test.sourceFirstCandidate(fixture),/explosion-not-reported/);
 const candidate={...fixture,type:'civil'};
 assert.throws(()=>_test.sourceFirstCandidate(candidate),/non-incident-location-qualifier/);
 const proper={...candidate,extra:[]};
 const c=_test.sourceFirstCandidate(proper);
 assert.equal(c.loc.name_ar,fixture.loc.name_ar);
 assert.deepEqual(c.extra,[]);
 assert.equal(_test.sourceFirstGate(proper,c).ok,true);
});
test('review exposes the blocker without changing held source or audit state',()=>{
 const d=structuredClone(fixture);
 d.operatorReview={revision:'prior-held-revision',at:1234,result:'held'};
 store.state.news||={};store.state.news.drafts={[d.id]:d};
 const before=JSON.stringify(d);
 const review=operatorNewsReview(d.id);
 assert.equal(review.issue,'explosion-not-reported');
 assert.equal(review.alertId,null);assert.equal(review.postId,null);
 assert.equal(JSON.stringify(d),before);
});
