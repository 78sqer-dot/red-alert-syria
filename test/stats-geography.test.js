import test from 'node:test';import assert from 'node:assert/strict';
process.env.BOT_TOKEN='123:SYNTHETIC';process.env.TELEGRAM_BACKUP='false';
const{store}=await import('../server/store.js');const{collectStats}=await import('../server/stats-image.js');
test('unknown governorate is separate and never competes with real governorates',()=>{
 store.state={alerts:[],log:[{id:'a',ty:'breaking',ts:'2026-11-24T19:00:00Z',g:null},{id:'b',ty:'political',ts:'2026-11-24T19:01:00Z',g:'13',ga:'دمشق',ge:'Damascus'},{id:'c',ty:'breaking',ts:'2026-11-24T19:02:00Z',g:null}]};
 const s=collectStats('day',Date.parse('2026-11-24T20:00:00Z'));assert.equal(s.total,3);assert.equal(s.unassignedGov,2);assert.deepEqual(s.byGov,[{ar:'دمشق',en:'Damascus',n:1}]);assert.equal(s.byType.breaking,2);assert.equal(s.to-s.from,86400000);
});
test('offshore Kassab earthquake never borrows the nearby town point',async()=>{const{newsIncidentLocations}=await import('../server/news-incident-location.js');const r=newsIncidentLocations('تسجيل هزة أرضية بقوة 2.7 في البحر شمال اللاذقية قرب منطقة كسب',{name_ar:'كسب',latitude:35.92639,longitude:35.9897,scope:'place'},[]);assert.equal(r.location.latitude,undefined);assert.equal(r.location.scope,'governorate');assert.equal(r.location.name_ar,'البحر شمال اللاذقية قرب كسب');assert.deepEqual(r.extra,[]);});

test('Shariah Hama-city neighborhood cannot resolve to Suqaylabiyah town',async()=>{const{newsIncidentLocations}=await import('../server/news-incident-location.js');const r=newsIncidentLocations('أصوات إطلاق النار في منطقة الشريعة بمدينة حماة أثناء محاولة توقيف مطلوب',{name_ar:'الشريعة',district_ar:'السقيلبية',latitude:35.44492,longitude:36.351,scope:'place'},[]);assert.equal(r.location.latitude,undefined);assert.equal(r.location.district,undefined);assert.equal(r.location.name_ar,'حي الشريعة بمدينة حماة');assert.deepEqual(r.extra,[]);});
