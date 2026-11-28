import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {isPrimaryStatement, primarySourceType, ruleClassify, refineType, inferPoliticalCategory} from '../server/news-ai.js';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/statement-1658.json', import.meta.url)));
const source = fixture.draft.sourceText;
test('retrospective institutional statement wins over violence keywords, for either actor', () => {
  for (const text of [source, source.replaceAll('الحرس الوطني','وزارة الداخلية').replaceAll('حكومة دمشق','الحرس الوطني'), 'قيادة قوات الأمن تصدر بياناً تتهم فيه قوات أخرى باستهداف نقاط في السويداء']) {
    assert.equal(isPrimaryStatement(text), true);
    assert.equal(primarySourceType(text), 'political');
    assert.equal(refineType('clashes',text), 'political');
    assert.equal(ruleClassify(text)?.type,'political');
    assert.equal(inferPoliticalCategory(text),'statement');
  }
});
test('actual current violence and attributed operational reports keep their event type', () => {
  for (const text of ['اندلاع اشتباكات مسلحة في دمشق الآن', 'قيادة الحرس الوطني: اشتباكات متواصلة غربي السويداء', 'قيادة الحرس الوطني تصدر بيانا حول اندلاع اشتباكات غربي السويداء الآن', 'مصدر عسكري: غارة جوية على دمشق صباح اليوم']) {
    assert.equal(isPrimaryStatement(text),false);
    assert.notEqual(refineType('clashes',text),'political');
  }
});
test('commentary and weather statements are not newly promoted to political', () => {
  for (const text of ['تحليل سياسي حول الاشتباكات الأخيرة في السويداء', 'قيادة الحرس الوطني تصدر بيانا حول مستقبل سوريا', 'وزارة الطوارئ تصدر بيانا تحذر فيه من أمطار غزيرة في حمص يرجى الحذر']) assert.equal(isPrimaryStatement(text),false);
  assert.equal(ruleClassify('تحليل سياسي عن مستقبل سوريا'),null);
});
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'ras-primary-statement-'));
process.env.TELEGRAM_BACKUP='false';
process.env.BOT_TOKEN='test-only-not-a-real-token';
const {store}=await import('../server/store.js');await store.init(null);
const {newsState,nightEligible,daytimeAutoEligible,_test}=await import('../server/news-monitor.js');
test('actual ingestion keeps source unchanged and creates a held statement, never auto eligible',async()=>{
  const n=newsState();n.types.political=true;
  const item={i:0,text:source,src:{u:'fixture',name:'fixture',local:false},url:'https://example.invalid/statement',ts:Date.now()};
  await _test.handleResult(item,{event:true,type:'clashes',places:[{name:'السويداء',gov:'السويداء'}],headline:fixture.alert.description,new_incident:true},[],new Map());
  const d=Object.values(n.drafts).find(d=>d.srcs?.[0]?.url===item.url);
  assert.ok(d);assert.equal(d.type,'political');assert.equal(d.politicalCategory,'statement');
  assert.equal(d.editorialHold,true);assert.equal(d.editorialHoldReason,'primary-statement-review');
  assert.equal(d.sourceText,source.slice(0,1200));assert.equal(d.headline,fixture.alert.description);assert.equal(d.status,'pending');assert.equal(nightEligible(d),false);assert.equal(daytimeAutoEligible(d),false);
});
