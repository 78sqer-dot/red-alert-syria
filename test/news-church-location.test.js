import test from 'node:test';
import assert from 'node:assert/strict';
import { churchBuildingOnly, scanTextPlaces } from '../server/news-ai.js';
import { _test } from '../server/news-monitor.js';
import { locationFrom } from '../server/places.js';
const source = 'قائد الأمن الداخلي في محافظة حمص: تعرض كنيسة سيدة السلام في حي بستان الديوان بالمدينة لسرقة مبالغ ومقتنيات. وصلت الفرق إلى القبض على عدد من أفراد المجموعة بينهم حارس الكنيسة ويجري التحقيق معهم.';
test('church noun and church employee are not Al Kunaysah village',()=>{
 assert.equal(churchBuildingOnly('الكنيسة',source),true);
 assert.equal(churchBuildingOnly('كنيسة','حريق في كنيسة سيدة السلام في حمص'),true);
 assert.equal(scanTextPlaces(source,'11').includes(167777),false);
 const locs=_test.buildLocations({places:[{name:'الكنيسة',gov:'حمص'}]},{text:source,src:{name:'الإخبارية السورية'}});
 assert.equal(locs.some(x=>x.place_id===167777),false);
});
test('explicit Al Kunaysah village and real church incident remain distinguishable',()=>{
 const village='اندلع حريق في قرية الكنيسة بريف حمص الغربي';
 assert.equal(churchBuildingOnly('الكنيسة',village),false);
 assert.ok(scanTextPlaces(village,'11').includes(167777));
 assert.equal(churchBuildingOnly('حمص','حريق في كنيسة بحمص'),false);
});
test('stored held church false pin is blocked at source-first publication gate',()=>{
 assert.throws(()=>_test.sourceFirstCandidate({type:'arrest',sourceText:source,sourceTextVersion:2,loc:locationFrom({placeId:167777}),extra:[]}),/church-building-not-village/);
});
