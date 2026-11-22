import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'ras-approved-no-pin-'));
process.env.TELEGRAM_BACKUP='false';process.env.BOT_TOKEN='123456:LOCAL_TEST';
process.env.CHANNEL_ID='@local_mock';process.env.PUBLIC_URL='https://example.invalid';
const {store}=await import('../server/store.js');await store.init(null);
const {repairNewsAlert}=await import('../server/bot.js');
const {approvedPublicCorrection}=await import('../server/approved-public-correction.js');
const {locationFrom}=await import('../server/places.js');
const title='توضيح بيانات منشورة ، سوريا';
const body='هذا توضيح بشأن بيانات منشورة، وليس حادثة ميدانية جديدة. تبقى التفاصيل منسوبة إلى التقارير.';
const correction={approved_copy:true,title,body,description:'',description_en:'',clear_location:true};
function reset(){
  store.backup=null;store._backupWritesPaused=false;
  const place=locationFrom({placeId:170654});
  const a={id:'synthetic-no-pin',source:'news',type:'political',title:'عنوان قديم ، دمشق',title_en:'Old Damascus heading',body:'رحبت الوزارة بمشروع قرار أممي.',description:'ملخص قديم',description_en:'Old summary',channel_message_id:9991,channel_media:'photo',channel_format:3,is_active:true,timestamp:'2026-11-22T16:14:00.000Z',expires_at:'2026-11-23T16:14:00.000Z',author:{id:123,name:'mock'},scope:'place',place,location:{latitude:place.latitude,longitude:place.longitude},extra:[place],areas:['دمشق'],zones:[{lat:place.latitude,lon:place.longitude,km:4.5}],meta:{political:{category:'decision',sources:[{name:'synthetic institution',url:'https://example.invalid/report'}]}}};
  store.state.alerts=[a];store.state.news={drafts:{audit:{id:'audit',alertId:a.id,status:'published',editorialHold:true,sourceText:a.body}}};
  return a;
}
test('approved no-pin dry run clears all geometry/labels and retains the exact title/body',async()=>{
  const a=reset(),before=JSON.stringify(store.state);
  const p=await repairNewsAlert(null,a.id,correction,{dryRun:true,expectedPostId:9991});
  assert.equal(JSON.stringify(store.state),before);
  assert.equal(p.candidate.title,title);assert.equal(p.candidate.title_en,title);assert.equal(p.candidate.body,body);
  assert.equal(p.candidate.scope,'country');assert.equal(p.candidate.location,null);assert.equal(p.candidate.zones,undefined);assert.equal(p.candidate.more,undefined);
  assert.equal(p.candidate.place.name_ar,'سوريا');assert.equal(p.candidate.place.governorate_ar,undefined);assert.equal(p.candidate.place.district_ar,undefined);assert.deepEqual(p.candidate.areas,['سوريا']);
  assert.equal(p.candidate.description,undefined);assert.equal(p.candidate.description_en,undefined);assert.ok(p.caption.includes(title));assert.ok(p.caption.includes(body));
});
test('a named unlocated area stays text-only without borrowing governorate coordinates',async()=>{
  const a=reset();const p=await repairNewsAlert(null,a.id,{...correction,place_name_ar:'قرية غير محددة',gov_code:'13'},{dryRun:true});
  assert.equal(p.candidate.title,title);assert.equal(p.candidate.place.name_ar,'قرية غير محددة');assert.equal(p.candidate.place.governorate,undefined);assert.equal(p.candidate.location,null);assert.equal(p.candidate.zones,undefined);
});
test('no-pin geometry requires a per-record approved-copy request',async()=>{
  const a=reset(),before=JSON.stringify(a);
  await assert.rejects(repairNewsAlert(null,a.id,{clear_location:true},{dryRun:true}),/approved-no-location-only/);
  assert.equal(JSON.stringify(a),before);
});
test('legacy named-place correction cannot overwrite an explicit approved title',async()=>{
  const a=reset();const p=await repairNewsAlert(null,a.id,{...correction,clear_location:false,place_name_ar:'منطقة مذكورة',gov_code:'13'},{dryRun:true});
  assert.equal(p.candidate.title,title);assert.equal(p.candidate.title_en,title);assert.ok(p.caption.includes(title));
});
test('same-post photo replacement preserves publication audit and never reopens the source draft',async()=>{
  const a=reset(),before=structuredClone(a),draft=structuredClone(store.state.news.drafts.audit),p=await repairNewsAlert(null,a.id,correction,{dryRun:true});
  const calls=[];const api={editMessageMedia:async(...args)=>{calls.push(args);return{message_id:9991}}};
  const r=await repairNewsAlert(api,a.id,correction,{expectedRevision:p.revision,expectedPostId:9991,refreshPhoto:true,renderSnapshot:async candidate=>{assert.equal(candidate.location,null);assert.deepEqual(candidate.extra,[]);assert.deepEqual(candidate.zones,[]);assert.equal(candidate.place.governorate,undefined);return Buffer.from('mock no-pin preview')}});
  assert.equal(r.ok,true);assert.equal(r.photoRefreshed,true);assert.equal(calls.length,1);assert.equal(calls[0][1],9991);
  const after=store.getAlert(a.id);assert.ok(approvedPublicCorrection(after));assert.deepEqual(after.meta.political,before.meta.political);
  for(const key of ['id','timestamp','expires_at','source','author','channel_message_id','channel_media','type','is_active'])assert.deepEqual(after[key],before[key]);
  assert.deepEqual(store.state.news.drafts.audit,draft);
});
test('an exact long correction heading fits beside the existing logo without truncation',async()=>{
  const {alertImageSvg,illustrationTextWidth,svgToPng}=await import('../server/alert-image.js');
  const a=reset(),longTitle='بيان توضيحي بشأن تقارير متعددة عن حادثة معلنة في المصادر الإخبارية';
  const payload={...correction,title:longTitle};
  const p=await repairNewsAlert(null,a.id,payload,{dryRun:true});
  const tile=svgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="white"/></svg>',256);
  let svg='';const priorFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>tile});
  try {
    await repairNewsAlert({editMessageMedia:async()=>({message_id:9991})},a.id,payload,{expectedRevision:p.revision,refreshPhoto:true,renderSnapshot:async candidate=>{svg=await alertImageSvg(candidate,{lang:'ar'});return Buffer.from('mock fitted header')}});
  } finally { globalThis.fetch=priorFetch; }
  const size=Number(svg.match(/<text x="988" y="74"[^>]*font-size="([0-9]+)"/)?.[1]);
  assert.ok(size>=20&&size<44);assert.ok(illustrationTextWidth(longTitle,size,800)<=804);assert.ok(svg.includes(longTitle));
});
test.after(async()=>{store.backup=null;await new Promise(r=>setTimeout(r,350));fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
