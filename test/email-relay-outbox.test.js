import test from 'node:test';import assert from 'node:assert/strict';import {RelayOutbox,mergeRelayRecords} from '../server/relay-outbox.js';
const item={alertId:'future-fixture',postId:9001,text:'canonical test fixture',subject:'fixture',to:'relay@example.invalid',sender:'sender@example.invalid'};
function setup(send=async()=>({accepted:true,status:201,id:'provider-fixture'})){let saves=0,now=100000;const state={};return{state,get saves(){return saves},setnow(v){now=v},q:new RelayOutbox({state,save:async()=>{saves++;return true},send,clock:()=>now})};}
test('no historical scan or outbound effects without explicit new enqueue',async()=>{let sends=0;let f=setup(async()=>{sends++});await f.q.drain();assert.equal(sends,0);});
test('duplicate new alert/post key sends once with canonical frozen copy',async()=>{let sends=0;let f=setup(async r=>{sends++;assert.equal(r.text,item.text);assert.equal(r.status,'sending');return{accepted:true,status:201,id:'ok'}});await f.q.enqueue(item);await f.q.enqueue({...item,text:'must not replace'});await f.q.drain();await f.q.drain();assert.equal(sends,1);assert.equal(f.state['future-fixture:9001'].status,'accepted');assert.ok(f.saves>=3);});
test('missing configuration is observable and sends nothing',async()=>{let sends=0;let f=setup(async()=>sends++);await f.q.enqueue(item);await f.q.drain({configured:false});assert.equal(sends,0);assert.equal(Object.values(f.state)[0].status,'blocked-config');});
test('ambiguous timeout never automatically resends',async()=>{let sends=0;let f=setup(async()=>{sends++;throw Error('timeout')});await f.q.enqueue(item);await f.q.drain();await f.q.drain();assert.equal(sends,1);assert.equal(Object.values(f.state)[0].status,'uncertain');});
test('definitive rate limit has bounded delayed retry',async()=>{let sends=0;let f=setup(async()=>{sends++;return{accepted:false,status:429}});await f.q.enqueue(item);await f.q.drain();await f.q.drain();assert.equal(sends,1);f.setnow(200000);await f.q.drain();f.setnow(400000);await f.q.drain();assert.equal(sends,3);assert.equal(Object.values(f.state)[0].status,'rejected');});
test('crashed sending state recovers uncertain, not duplicate',async()=>{let f=setup();await f.q.enqueue(item);Object.values(f.state)[0].status='sending';f.q.recover();assert.equal(Object.values(f.state)[0].status,'uncertain');});
test('durability failure blocks network',async()=>{let sends=0;let state={};let q=new RelayOutbox({state,save:async()=>false,send:async()=>sends++});await assert.rejects(q.enqueue(item),/backup/);await q.drain();assert.equal(sends,0);});

test('handoff retains accepted/uncertain terminal states and does not replay',()=>{
 const a={x:{status:'pending',createdAt:1},y:{status:'accepted',createdAt:1}};
 const b={x:{status:'accepted',createdAt:1},y:{status:'pending',createdAt:2},z:{status:'uncertain',createdAt:3}};
 const m=mergeRelayRecords(a,b);assert.equal(m.x.status,'accepted');assert.equal(m.y.status,'accepted');assert.equal(m.z.status,'uncertain');
});
