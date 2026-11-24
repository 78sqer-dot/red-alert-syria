import test from 'node:test';import assert from 'node:assert/strict';
import {newsIncidentLocations,assertNewsLanguageCopy} from '../server/news-incident-location.js';
import {locationFrom} from '../server/places.js';
const haw=locationFrom({placeId:43748615949}),saalu=locationFrom({placeId:20005188}),hor=locationFrom({placeId:169476}),suq=locationFrom({placeId:163921});
test('one compound locality never splits into distant token matches',()=>{
 const r=newsIncidentLocations('فقد شاب حياته متأثراً بإصابته بانفجار قنبلة في بلدة حويجة سعلو بريف دير الزور الشرقي.',haw,[saalu]);
 assert.equal(r.location.name_ar,'حويجة سعلو');assert.equal(r.location.latitude,undefined);assert.deepEqual(r.extra,[]);
});
test('administrative district never adds a second incident circle',()=>{
 const r=newsIncidentLocations('اعتقال شبان في قرية "حورات عمورين"، التابعة إدارياً لناحية السقيلبية بريف حماة.',hor,[suq]);
 assert.equal(r.location.place_id,169476);assert.deepEqual(r.extra,[]);
});
test('unknown village preserves name without borrowing nearby city pin',()=>{
 const r=newsIncidentLocations('انفجار لغم بجرار في قرية الجهبل شرقي عين عيسى بريف الرقة الشمالي.',locationFrom({placeId:172134}),[]);
 assert.equal(r.location.name_ar,'الجهبل');assert.equal(r.location.latitude,undefined);assert.equal(r.location.short_ar,'الجهبل - الرقة');
});
test('explicit separate named incidents are not indiscriminately collapsed',()=>{
 const r=newsIncidentLocations('انفجار في بلدة سعلو، وانفجار آخر في قرية الحويجة.',saalu,[haw]);assert.equal(r.extra.length,1);
});
test('attached foreign generation artifact cannot publish',()=>{
 assert.throws(()=>assertNewsLanguageCopy('في أرضAGRICULTURAL في قرية'),/Mixed-language/);assert.doesNotThrow(()=>assertNewsLanguageCopy('أرض زراعية قرب M4'));
});

test('named area west of another locality is one incident, not a second anchor site',()=>{
 const maakar=locationFrom({placeId:31000001}),sayda=locationFrom({placeId:10312031});
 const source='لليوم الثلاثين على التوالي... مشاهد توثق تنفيذ قوات الاحتلال الإسرائيلي عمليات حفر وتجريف في منطقة المعكر، غربي صيدا الحانوت بريف القنيطرة';
 const r=newsIncidentLocations(source,maakar,[sayda]);assert.equal(r.location.place_id,31000001);assert.deepEqual(r.extra,[]);assert.equal(r.location.short_ar,'المعكر - القنيطرة');
});

test('border crossing name never borrows the town centre or danger radius',()=>{
 const town=locationFrom({placeId:383661});
 const r=newsIncidentLocations('اعتقال الإعلامي أثناء دخوله الأراضي السورية عبر معبر اليعربية الحدودي بريف الحسكة.',town,[]);
 assert.equal(r.location.name_ar,'معبر اليعربية');assert.equal(r.location.latitude,undefined);assert.equal(r.location.short_ar,'معبر اليعربية - الحسكة');assert.deepEqual(r.extra,[]);
});

test('countryside of a named city never uses its city-center incident pin',()=>{
 const town=locationFrom({placeId:168325});
 for(const source of ['فرق الهندسة تفجر مخلفات الحرب في ريف مدينة خان شيخون بمحافظة إدلب.','تفجير مخلفات حرب بريف خان شيخون بريف إدلب.']){
  const r=newsIncidentLocations(source,town,[]);assert.equal(r.location.name_ar,'ريف خان شيخون');assert.equal(r.location.latitude,undefined);assert.equal(r.location.short_ar,'ريف خان شيخون - إدلب');
 }
});
