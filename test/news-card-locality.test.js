import fs from 'node:fs';import os from 'node:os';process.env.DATA_DIR=fs.mkdtempSync(os.tmpdir()+'/ras-card-locality-');process.env.TELEGRAM_BACKUP='false';
import test from 'node:test';import assert from 'node:assert/strict';
import {sourceCardLocality} from '../server/news-card-locality.js';import {governorates,capitalOf} from '../server/places.js';import {validatedManifestLocality} from '../server/reviewed-locality.js';
const evidence=['https://example.org/report'];
test('Hama university-housing incident is approximate Hama, no fabricated dormitory coordinate',()=>{const r=sourceCardLocality('حماة: إصابة 5 أشخاص جراء مشاجرة جماعية بالقرب من السكن الجامعي بمدينة حماة',evidence);assert.equal(r.name_ar,'حماة');assert.equal(r.placeId,170017);assert.equal(r.approximate,true);assert.match(r.label_ar,/موقع تقريبي/);assert.match(r.note_ar,/ليس موقع الحادث الدقيق/);assert.ok(validatedManifestLocality({localityReference:r}));});
test('all14governorates have usable approximate named-city or province reference',()=>{assert.equal(governorates.length,14);for(const g of governorates){const r=sourceCardLocality('وقع حادث في محافظة '+g.ar,evidence);assert.ok(r,g.ar);assert.ok(Number.isFinite(r.latitude));assert.ok(validatedManifestLocality({localityReference:r}),g.ar);}});
test('no treatment, origin, ministry-metonym, person name, ambiguous road or conflicting city marker',()=>{for(const source of ['توفي الطفل في أحد مشافي دمشق بعد غرقه في نهر الفرات.','نقل مصاب من أهالي حماة إلى مشفى دمشق للعلاج.','أعلنت دمشق توقيع اتفاق جديد.','توفي أحمد حماة بعد مرض.','مشاجرة في حلب وأخرى في حماة.','حادث على طريق دمشق درعا.','خبر عام بلا موقع معروف.'])assert.equal(sourceCardLocality(source,evidence),null,source);});
test('Rif Dimashq is not Damascus city; no unsupported evidence or coordinates',()=>{const r=sourceCardLocality('وقع حادث في محافظة ريف دمشق',evidence);assert.equal(r.name_ar,'ريف دمشق');assert.equal(r.level,'governorate');assert.equal(sourceCardLocality('حادث في مدينة حماة',[]),null);assert.equal(validatedManifestLocality({localityReference:{...r,latitude:r.latitude+1}}),null);});

test('reviewer regressions regions/rural/attached/dateline/roles/negation',()=>{
 const yes=[['انفجار في سهل الغاب','سهل الغاب'],['انفجار بريف دمشق','ريف دمشق'],['انفجار بريف حماة','حماة'],['حماة: إصابة 5 أشخاص في مشاجرة','حماة'],['انفجار بحماة','حماة'],['انفجار في ادلب','إدلب']];
 for(const [text,name]of yes)assert.equal(sourceCardLocality(text,evidence)?.name_ar,name,text);
 for(const text of ['وفاة رجل من أبناء تومين بريف حماة إثر حادث مجهول الموقع','أفاد مراسل في حماة بوفاة طفل إثر الغرق في نهر الفرات','نفت المصادر وقوع انفجار في حماة'])assert.equal(sourceCardLocality(text,evidence),null,text);
 for(const g of governorates)assert.ok(sourceCardLocality('انفجار ب'+g.ar,evidence),g.ar);
});

test('exact reviewer fixtures preserve region and area, decline nonincident source/origin and negative event',()=>{
 assert.equal(sourceCardLocality('وقع حادث في سهل الغاب.',evidence)?.placeId,990000003);
 for(const t of ['وقع حادث في ريف حلب الشمالي.','وقع حادث في ريف حماة.','وقع حادث شمال حماة.','وقع حادث شرق حماة.'])assert.equal(sourceCardLocality(t,evidence)?.level,'governorate');
 for(const t of ['أصيب شاب من أهالي قرية تومين بريف حماة في حادث لم يتحدد مكانه.','أعلن مصدر في مدينة حماة عن غرق طفل في الفرات.','لم يقع انفجار في مدينة حماة.'])assert.equal(sourceCardLocality(t,evidence),null,t);
 assert.equal(sourceCardLocality('حماة: اندلاع حريق في السوق.',evidence)?.name_ar,'حماة');
 assert.equal(sourceCardLocality('لم يقع انفجار في حماة. اندلع حريق في مدينة حلب.',evidence)?.name_ar,'حلب');
});

test('established manual point route preserves exact coordinates through input/store/public API without approximate replacement',async()=>{
 const {locationFrom}=await import('../server/places.js');const {buildAlertInput}=await import('../server/bot.js');const{store,publicAlert}=await import('../server/store.js');
 const point=locationFrom({lat:35.145,lon:36.78});assert.equal(point.scope,'point');
 const a=store.addAlert(buildAlertInput({type:'civil',location:point,headline:'بلاغ ميداني',text:'بلاغ ميداني',extra:[],mode:'publish'}, {id:1,name:'fixture'}));
 const p=publicAlert(a);assert.deepEqual(p.location,{latitude:35.145,longitude:36.78});assert.equal(p.scope,'point');assert.equal(p.geographic_reference,undefined);
});

test('V2 reviewer source-role and scoped-negation fixtures retain affirmative event markers',()=>{
 for(const t of ['أفاد مصدر باندلاع حريق في مدينة حماة.','وقع انفجار في مدينة حماة ولم يسجل وقوع إصابات.','اندلع حريق في مستشفى في مدينة حماة.'])assert.equal(sourceCardLocality(t,evidence)?.name_ar,'حماة',t);
 assert.equal(sourceCardLocality('قال مصدر إن انفجارا وقع في مدينة حلب.',evidence)?.name_ar,'حلب');
 assert.equal(sourceCardLocality('وقع حادث شمال مدينة حماة.',evidence)?.level,'governorate');
 assert.equal(sourceCardLocality('وقع حادث في سهل الغاب بريف حماة.',evidence)?.placeId,990000003);
});

test('same-name villages without governorate context never rank-pick an arbitrary identity',()=>{for(const name of ['أم الرمان','أم العظام'])assert.equal(sourceCardLocality('وقع حادث في قرية '+name,evidence),null,name);});

test('V3 reviewer multiple local event relations do not leak role or negation between places',()=>{
 for(const t of ['أفاد مصدر محلي في مدينة حماة بغرق طفل في الفرات.','قال مراسل صحفي في حماة إن طفلا غرق في الفرات.','اندلع حريق في مستشفى بمكان غير معروف ونقل مصاب إلى مستشفى في دمشق.','وقع حادث في مدينة حماة. ووقع آخر في قرية أم الرمان.'])assert.equal(sourceCardLocality(t,evidence),null,t);
 for(const t of ['وقع انفجار في حماة، ولم يقع حريق في حلب.','لم يقع حريق في حلب ولكن وقع انفجار في حماة.'])assert.equal(sourceCardLocality(t,evidence)?.name_ar,'حماة',t);
 assert.equal(sourceCardLocality('أصيب شاب من أهالي حماة في حادث في مدينة حلب.',evidence)?.name_ar,'حلب');
 assert.equal(sourceCardLocality('وقع حادث شمال شرقي مدينة حماة.',evidence)?.level,'governorate');
});

test('each independently asserted event must have its own resolved location',()=>{
 for(const text of ['حماة: نفى مراسل وقوع انفجار.','وقع حادث في حماة ووقع آخر في مكان مجهول.','وقع حادث في حماة. وفي موقع آخر وقع حريق.','وقع حادث في حماة. ووقع حادث في مكان مجهول.','وقع حادث في حماة. ووقع حادث في بلدة لم يرد اسمها.'])assert.equal(sourceCardLocality(text,evidence),null,text);
 assert.equal(sourceCardLocality('أصيب شاب من مدينة حماة في حادث في حلب.',evidence)?.name_ar,'حلب');
});

test('dateline and work-role are not substitute incident evidence',()=>{
 for(const text of ['دمشق: توفي طفل في أحد مشافي العاصمة بعد غرقه في نهر الفرات.','حماة: خبر عام بلا موقع معروف.','وقع حادث لشاب يعمل في حماة في مكان مجهول.','وقع حادث في حماة. ووقع حادث آخر في أم الرمان.'])assert.equal(sourceCardLocality(text,evidence),null,text);
});

test('residence, education and locative inversion bind their own role',()=>{
 for(const text of ['غرق شاب من سكان مدينة حماة في نهر الفرات.','غرق شاب كان يدرس في حماة في نهر الفرات.','غرق شاب يسكن في حماة في الفرات.','غرق شاب يتعلم في حماة في الفرات.','غرق شاب يعيش في حماة في نهر الفرات.','غرق شاب يزور أقاربه في حماة في نهر الفرات.'])assert.equal(sourceCardLocality(text,evidence),null,text);
 for(const text of ['في مدينة حماة وقع حادث سير.','سقوط قذيفة في مدينة حماة.','احتراق منزل في حماة.','سمع دوي في مدينة حماة.'])assert.equal(sourceCardLocality(text,evidence)?.name_ar,'حماة',text);
});

test('ambiguous subject/beneficiary-to-city attachments fail closed without role vocabulary',()=>{
 for(const text of ['وقع حادث لشاب موظف في حماة قرب نهر الفرات.','غرق شاب موظف في حماة في نهر الفرات.','وقع حادث لرجل متقاعد في حماة قرب نهر الفرات.','غرق طالب جامعي في حماة في نهر الفرات.','غرق شاب ضيف في حماة في الفرات.'])assert.equal(sourceCardLocality(text,evidence),null,text);
});

test('explicit unresolved incident geography always outranks dateline context',()=>{
 for(const text of ['دمشق: غرق شاب في نهر الفرات.','حماة: غرق شاب في نهر الفرات.','حماة: وقع حادث في قرية مجهولة.','حماة: وقع حادث قرب جبل الزاوية.'])assert.equal(sourceCardLocality(text,evidence),null,text);
 assert.equal(sourceCardLocality('حماة: اندلاع حريق في السوق.',evidence)?.name_ar,'حماة');
 assert.equal(sourceCardLocality('دمشق: وقع حادث في مدينة حماة.',evidence)?.name_ar,'حماة');
});

test('dateline inheritance is closed grammar, not an open preposition blacklist',()=>{
 for(const text of ['حماة: غرق شاب عند نهر الفرات.','حماة: غرق شاب على نهر الفرات.','حماة: غرق شاب بجوار نهر الفرات.','حماة: وقع حادث بمحاذاة نهر الفرات.','دمشق: غرق شاب على ضفاف نهر الفرات.'])assert.equal(sourceCardLocality(text,evidence),null,text);
});
