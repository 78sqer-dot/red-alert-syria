import test from 'node:test';
import assert from 'node:assert/strict';
import {keywordTypes,hasExplicitDroneFlight,refineType,ruleClassify} from '../server/news-ai.js';
test('possessive Israeli drone sighting is not reclassified from UAV to protest',()=>{
 const text='مسيره لاسرائيل تم رصدها بريف دمشق محطة تشرين';assert.equal(hasExplicitDroneFlight(text),true);assert.ok(keywordTypes(text).includes('uav'));assert.equal(keywordTypes(text).includes('protest'),false);assert.equal(refineType('uav',text),'uav');assert.equal(refineType('protest',text),'uav');assert.equal(ruleClassify(text).type,'uav');
});
test('civilian solidarity/protest marches remain protests, including superficially similar sighting wording',()=>{
 for(const text of ['مسيرة تضامنية في دمشق','مسيرة احتجاجية سلمية في دمشق','مسيرة لإسرائيل تم رصدها في دمشق دعماً وتأييداً','مسيره لاسرائيل تم رصدها في دمشق ورفع المشاركون لافتات']){assert.equal(hasExplicitDroneFlight(text),false,text);assert.equal(refineType('protest',text),'protest',text);}
});
test('bare ambiguous march wording is not promoted to explicit drone flight',()=>{
 for(const text of ['مسيره في دمشق','مسيرة لإسرائيل في دمشق','لم يتم رصد مسيرة لإسرائيل بريف دمشق'])assert.equal(hasExplicitDroneFlight(text),false,text);
});
