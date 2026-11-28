import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapLabelExpression } from '../public/js/map-labels.js';
function evaluate(x,p) {
 if (!Array.isArray(x)) return x;
 const [op,...a]=x;if(op==='literal')return a[0];const v=a.map(y=>evaluate(y,p));
 if(op==='in')return v[1].includes(v[0]);
 if(op==='get')return p[v[0]];
 if(op==='coalesce')return v.find(z=>z!==undefined&&z!==null);
 if(op==='slice')return v[0].slice(v[1],v[2]);
 if(op==='==')return v[0]===v[1];
 if(op==='all')return v.every(Boolean);
 if(op==='case')return v[0]?v[1]:v[2];
 throw Error(op);
}
test('Arabic state labels remove only the governorate prefix, not other geographic names',()=>{
 for(const name of ['حلب','حمص','درعا','دمشق','ريف دمشق','إدلب','اللاذقية','طرطوس','حماة','الرقة','دير الزور','الحسكة','السويداء','القنيطرة'])assert.equal(evaluate(mapLabelExpression('ar'),{class:'state','name:ar':'محافظة '+name}),name);
 for(const cls of ['city','town','village','country','water'])assert.equal(evaluate(mapLabelExpression('ar'),{class:cls,'name:ar':'محافظة حمص'}),'محافظة حمص');
 assert.equal(evaluate(mapLabelExpression('ar'),{class:'state','name:ar':'ريف دمشق'}),'ريف دمشق');
 assert.equal(evaluate(mapLabelExpression('ar'),{class:'state','name:ar':'محافظة أسوان'}),'محافظة أسوان');
 assert.equal(evaluate(mapLabelExpression('en'),{class:'state','name:en':'Homs Governorate'}),'Homs Governorate');
});
test('live status dot and badge cannot flex-shrink away on compact headers',()=>{
 const css=fs.readFileSync(new URL('../public/css/app.css',import.meta.url),'utf8');
 assert.match(css,/\.status\s*\{[^}]*flex-shrink:\s*0/);
 assert.match(css,/\.status \.dot\s*\{[^}]*flex:\s*0 0 8px/);
 assert.match(css,/\.status\[data-state='live'\] \.dot::after\s*\{[^}]*animation:\s*ping 2s/);
});
