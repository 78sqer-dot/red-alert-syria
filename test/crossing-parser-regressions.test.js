import test from 'node:test';
import assert from 'node:assert/strict';
import {matchBorderNews,onBorderNews,publicBorders} from '../server/borders.js';
import {store} from '../server/store.js';

test('single current unscoped crossing suggestions remain supported',()=>{
 for(const [text,st] of [['معبر نصيب مغلق','closed'],['معبر نصيب مفتوح','open'],['إعادة فتح معبر نصيب','open'],['معبر نصيب ازدحام شديد','busy'],['إغلاق معبر نصيب','closed']]) assert.deepEqual(matchBorderNews(text),{id:'nasib',st});
 assert.equal(matchBorderNews('مصادرة بضائع في معبر نصيب'),null);
 assert.equal(matchBorderNews('معبر نصيبان مغلق'),null);
});
test('unrelated closed-door sentence cannot override crossing status',()=>{
 assert.deepEqual(matchBorderNews('معبر نصيب مفتوح. اجتماع خلف أبواب مغلقة'),{id:'nasib',st:'open'});
 assert.deepEqual(matchBorderNews('اجتماع خلف أبواب مغلقة؛ معبر نصيب مفتوح'),{id:'nasib',st:'open'});
 assert.equal(matchBorderNews('معبر نصيب واجتماع خلف أبواب مغلقة'),null);
 assert.equal(matchBorderNews('معبر نصيب مفتوح واجتماع خلف أبواب مغلقة'),null);
});
test('negated, planned, historical and conditional reports have no suggestion',()=>{
 for(const text of ['معبر نصيب ليس مغلقاً','معبر نصيب غير مغلق','لا إغلاق في معبر نصيب','نفت الإدارة إغلاق معبر نصيب','سيتم إغلاق معبر نصيب غداً','سيفتح معبر نصيب','معبر نصيب مغلق اعتباراً من الأحد','معبر نصيب مغلق. سيتم فتحه غداً','إذا أغلق معبر نصيب','معبر نصيب مغلق أمس']) assert.equal(matchBorderNews(text),null,text);
});
test('multiple crossings and conflicting statuses decline rather than mix clauses',()=>{
 for(const text of ['معبر نصيب مفتوح ومعبر البوكمال مغلق','معبر نصيب مفتوح. معبر البوكمال مغلق','معبر نصيب ومعبر البوكمال مفتوح','معبر نصيب مفتوح والقائم مغلق','معبر نصيب مفتوح ومغلق','معبر نصيب مفتوح؛ معبر نصيب مغلق','معبر نصيب مفتوح مع ازدحام']) assert.equal(matchBorderNews(text),null,text);
});
test('unsupported direction/passenger/freight scope never becomes an unconditional status',()=>{
 for(const text of ['معبر نصيب للمسافرين فقط','معبر نصيب مفتوح للشاحنات فقط','معبر نصيب مغلق أمام الشاحنات','معبر نصيب مغلق للبضائع','معبر نصيب مفتوح باتجاه واحد','معبر نصيب مفتوح للمغادرين فقط','معبر نصيب مفتوح للقادمين فقط','معبر نصيب مفتوح باستثناء الركاب','معبر نصيب مفتوح جزئياً','معبر نصيب مفتوح جزئي','معبر نصيب مفتوح ونفي الإغلاق','معبر نصيب مفتوح للصادرات فقط','معبر نصيب مفتوح من الساعة 8 حتى الساعة 10','معبر نصيب مفتوح. للشاحنات فقط']) assert.equal(matchBorderNews(text),null,text);
});
test('accepted suggestion remains owner-reviewed and rejected report changes no public state',()=>{
 const state=store.state,persist=store.persist;
 try{
  store.state={svc:{borders:{nasib:{st:'closed',ts:Date.now(),note:'existing'}}}};store.persist=()=>{};
  const before=publicBorders();
  assert.equal(onBorderNews({text:'معبر نصيب مفتوح',src:{name:'fixture'}}),true);
  assert.equal(store.state.svc.borderSugg.length,1);
  assert.deepEqual(publicBorders(),before);
  assert.equal(store.state.svc.borderSugg[0].text,'معبر نصيب مفتوح');
  assert.equal(onBorderNews({text:'معبر نصيب مفتوح للشاحنات فقط'}),false);
  assert.equal(store.state.svc.borderSugg.length,1);assert.deepEqual(publicBorders(),before);
 }finally{store.state=state;store.persist=persist;}
});
