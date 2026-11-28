import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {alertZones,selectedAlertZones,mentionedGovernorates,capitalOf} from '../server/places.js';
const {alert}=JSON.parse(fs.readFileSync(new URL('./fixtures/statement-1658.json',import.meta.url)));
const near=(z,p)=>Math.abs(z.lat-p.lat)<0.01&&Math.abs(z.lon-p.lon)<0.01;
const dam=capitalOf('13');
test('inferred government labels in either language add no Damascus circle and mutate no data',()=>{
 const before=structuredClone(alert);assert.equal(alertZones(alert).length,1);assert.deepEqual(alert,before);
 for(const description of ['قوات حكومة دمشق تستهدف نقاطا غربي السويداء','اتهامات لحكومة دمشق حول أحداث السويداء','Damascus government forces accused of attacks in As-Suwayda','government of Damascus forces accused of attacks in As-Suwayda'])assert.equal(alertZones({...alert,description,description_en:''}).length,1);
 assert.ok(mentionedGovernorates(alert.description).some(g=>g.code==='13'),'generic mention API unchanged');
});
test('a separate real Damascus occurrence survives label exclusion, in either order',()=>{
 for(const description of ['قوات حكومة دمشق تتحدث عن السويداء. اندلاع اشتباكات في مدينة دمشق','اشتباكات في دمشق والسويداء بحسب حكومة دمشق','Damascus government forces report attacks in Damascus and As-Suwayda']) {
 const z=alertZones({...alert,description,description_en:''});assert.equal(z.length,2);assert.ok(z.some(z=>near(z,dam)));
 }
});
test('explicit extra Damascus, institutions as event sites, rural names and explicit radii remain',()=>{
 const extra=[{latitude:dam.lat,longitude:dam.lon,governorate:'13',rank:1}];
 assert.equal(alertZones({...alert,extra}).length,2);
 assert.equal(selectedAlertZones({...alert,type:'political',extra}).length,2);
 for(const description of ['انفجار قرب مجلس مدينة دمشق','حريق في مقر حكومة دمشق','Attack on Damascus government headquarters','حريق في مقر حكومة دمشق في مدينة دمشق'])assert.equal(alertZones({...alert,description,description_en:''}).length,2);
 assert.deepEqual(mentionedGovernorates('خبر في ريف دمشق ومدينة دمشق',{inferred:true}).map(g=>g.code),['08','13']);
 const radius=alertZones({...alert,type:'weather',place:{...alert.place,zone_km:30}});assert.equal(radius.length,1);assert.equal(radius[0].km,30);
});
