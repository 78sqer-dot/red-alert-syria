import test from 'node:test';
import assert from 'node:assert/strict';
import { salaryNewsKind, inferArmyCategory, initialArmyState, createPendingArmyItem, decideArmyItem, publicArmy, updateArmyItem } from '../server/army.js';
import { administrativePlaceOnly, scanTextPlaces, isPersonNameOnly } from '../server/news-ai.js';
import { _test as news } from '../server/news-monitor.js';
import { publicBorders, CROSSINGS } from '../server/borders.js';
import { store } from '../server/store.js';

test('personnel affiliation is not a salary announcement; real public pay announcements survive',()=>{
 for(const text of ['عناصر من مرتبات وزارة الداخلية أمام المحكمة العسكرية.', 'قرار محكمة الجنايات بحق عنصر من مرتبات الشرطة.', 'محاكمة ضباط من مرتبات الجيش.']) {
  assert.equal(salaryNewsKind(text),false,text); assert.equal(inferArmyCategory(text),null,text);
 }
 for(const text of ['زيادة مرتبات عناصر الشرطة بنسبة عشرة بالمئة.', 'صرف رواتب أفراد الجيش لشهر تشرين الثاني.', 'رفع المرتبات لعناصر الأمن العام.', 'رواتب أفراد الشرطة الشهرية.']) assert.equal(salaryNewsKind(text),true,text);
});
test('unsuitable legacy Army approval remains raw and reversible but is absent publicly',()=>{
 const j=initialArmyState(); const item={id:'legacy',status:'approved',category:'police_salary',title:'قضية قضائية',text:'محاكمة عنصر من مرتبات الشرطة أمام المحكمة العسكرية.',links:[]};
 j.published.legacy=item;j.decisions.legacy={decision:'approve',by:1};const before=JSON.stringify(j);
 assert.equal(publicArmy(j).items.length,0);assert.equal(JSON.stringify(j),before);
});
test('Army generated and edited titles end at a word boundary with a visible truncation mark',()=>{
 const j=initialArmyState(),text='إعلان رسمي عن رواتب أفراد الجيش '+('تفاصيل الإعلان الرسمي '.repeat(12));
 const {item}=createPendingArmyItem({sourceKey:'title-regression',text,kind:'official_source',sourceName:'اختبار',sourceUrl:'https://t.me/test_official/1'},j);
 assert.ok(item);assert.ok(item.title.length<=120);assert.ok(item.title.endsWith('…'));assert.ok(text.startsWith(item.title.slice(0,-1)));
 assert.equal(updateArmyItem(item.id,{title:text},j).ok,true);assert.ok(item.title.endsWith('…'));
});
test('governorate administration is not Al Muhafazah neighbourhood, explicit neighbourhood survives',()=>{
 const text='بلدية محافظة حماة تعلن عن إجراءات إدارية جديدة.';
 assert.equal(administrativePlaceOnly('المحافظة',text),true);
 assert.equal(administrativePlaceOnly('المحافظة','حادث في حي المحافظة بحلب'),false);
 const locs=news.buildLocations({places:[{name:'المحافظة',gov:'حماة'}]},{text});
 assert.ok(!locs.some(l=>l.name_ar==='المحافظة'));
});
test('canonical place-like personal names cannot provide incident pins',()=>{
 const text='وفاة الشاب محمد الشيخ في مدينة حماة.';
 assert.equal(isPersonNameOnly(text,'الشيخ'),true);
 const locs=news.buildLocations({places:[{name:'الشيخ',gov:'حماة'}]},{text});
 assert.ok(!locs.some(l=>l.name_ar==='الشيخ'));
});
test('border freshness rejects missing/future timestamps and retains last dated stale observation',()=>{
 const previous=store.state.svc; const now=Date.parse('2026-11-22T20:00:00Z'),id=CROSSINGS[0].id;
 try{
  store.state.svc={borders:{[id]:{st:'open',ts:now-73*3600000,note:'old'}}};
  let row=publicBorders(now).find(b=>b.id===id);assert.equal(row.status,'unknown');assert.equal(row.ts,now-73*3600000);assert.equal(row.stale,true);assert.equal(row.note,'');
  store.state.svc.borders[id]={st:'open',ts:now+60000};row=publicBorders(now).find(b=>b.id===id);assert.equal(row.status,'unknown');assert.equal(row.ts,null);
  store.state.svc.borders[id]={st:'open',ts:now-60000};assert.equal(publicBorders(now).find(b=>b.id===id).status,'open');
 }finally{store.state.svc=previous;}
});
