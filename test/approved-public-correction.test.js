import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'ras-approved-repair-'));
process.env.TELEGRAM_BACKUP='false';process.env.BOT_TOKEN='123456:LOCAL_TEST';
process.env.CHANNEL_ID='@local_mock';process.env.PUBLIC_URL='https://example.invalid';
const {store,publicAlert}=await import('../server/store.js');await store.init(null);
const {repairNewsAlert,channelPost}=await import('../server/bot.js');
const {approvedPublicCorrection,publishedRepairRevision}=await import('../server/approved-public-correction.js');
const {eventVisual}=await import('../shared/types.js');
const {typeIcon}=await import('../public/js/type-icons.js');
const {markerSvg}=await import('../server/alert-image.js');
const {EXTRA_SVG}=await import('../public/js/target-svgs.js');
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/explosives-discovery-419.json',import.meta.url)));
const title='ألغام ومخلفات حرب — تل مساس';
const body='نقلت شبكة شام الإخبارية عن مصادر محلية العثور على ألغام في مدرسة تل مساس.\n\nتصحيح: لا يذكر الخبر وقوع انفجار.';
const correction={approved_copy:true,caution_visual:true,type:'civil',title,body,description:'',description_en:'',clear_extra:true};
function reset(){
 store.backup=null;store._backupWritesPaused=false;store._backupPending=false;
 const a={id:'local-repair-fixture',type:'explosion',title:'انفجار — تل مساس ومنطقة أخرى',title_en:'Explosion',description:'انفجار',body:fixture.sourceText,description_en:'Explosion',source:'news',channel_format:3,channel_message_id:1469,channel_media:'photo',is_active:true,timestamp:'2026-11-22T14:41:00.000Z',expires_at:'2026-11-23T14:41:00.000Z',place:structuredClone(fixture.loc),location:{latitude:fixture.loc.latitude,longitude:fixture.loc.longitude},extra:structuredClone(fixture.extra),meta:{newsSources:[{name:'شبكة شام الإخبارية',u:'ShaamNetwork',url:'https://t.me/ShaamNetwork/108628'}]}};
 store.state.alerts=[a];store.state.news={drafts:{[fixture.id]:{...fixture,alertId:a.id}}};return a;
}
async function preview(a){return repairNewsAlert(null,a.id,correction,{dryRun:true,expectedPostId:1469});}
test('dry run preserves stored state and offers exact approved copy without disclosing private source lists',async()=>{
 const a=reset(),before=JSON.stringify(a),p=await preview(a);
 assert.equal(JSON.stringify(a),before);assert.equal(p.candidate.title,title);assert.equal(p.candidate.body,body);assert.equal(p.candidate.type,'civil');assert.equal(p.candidate.caution_visual,true);assert.equal(p.candidate.marker_glyph,'urgent_warning');assert.equal(p.candidate.zones.length,1);assert.equal(p.candidate.description_en,undefined);assert.equal(p.candidate.title_en,title);assert.equal(p.candidate.meta,undefined);assert.ok(p.caption.includes(body));assert.ok(p.caption.replace(/<[^>]+>/g,'').length<=1024);
});
test('stale revision and wrong post stop all writes; approved execution requires a revision',async()=>{
 const a=reset(),p=await preview(a),before=JSON.stringify(a);
 await assert.rejects(repairNewsAlert(null,a.id,correction,{expectedRevision:'stale'}),/stale-repair/);
 await assert.rejects(repairNewsAlert(null,a.id,correction,{expectedRevision:p.revision,expectedPostId:999}),/post-changed/);
 await assert.rejects(repairNewsAlert(null,a.id,correction),/revision-required/);assert.equal(JSON.stringify(a),before);
});
test('repair edits one existing photo, retains source audit/times/identity and binds approved fields',async()=>{
 const a=reset(),before=structuredClone(a),p=await preview(a),calls=[];
 const api={editMessageMedia:async(...args)=>{calls.push(args);return{message_id:1469};}};
 const result=await repairNewsAlert(api,a.id,correction,{expectedRevision:p.revision,expectedPostId:1469,refreshPhoto:true,renderSnapshot:async candidate=>{assert.equal(candidate.type,'civil');assert.equal(candidate.extra.length,0);assert.equal(candidate.title,title);return Buffer.from('mock map image');}});
 assert.equal(result.ok,true);assert.equal(result.photoRefreshed,true);assert.equal(calls.length,1);assert.equal(calls[0][1],1469);assert.equal(calls[0][2].type,'photo');assert.ok(calls[0][2].caption.includes(body));
 const b=store.getAlert(a.id);assert.deepEqual(b.meta.newsSources,before.meta.newsSources);for(const key of ['id','timestamp','expires_at','channel_message_id','location','place'])assert.deepEqual(b[key],before[key]);assert.ok(approvedPublicCorrection(b));assert.equal(publicAlert(b).body,body);assert.ok(channelPost(b).includes(body));
 const changed=structuredClone(b);changed.body+=' تغيير غير معتمد';assert.equal(approvedPublicCorrection(changed),null);assert.ok(!publicAlert(changed).body.includes('شبكة شام الإخبارية'));assert.ok(!channelPost(changed).includes('شبكة شام الإخبارية'));
});
test('a render-time concurrent edit aborts before replacement or map mutation',async()=>{
 const a=reset(),p=await preview(a);let edits=0;
 await assert.rejects(repairNewsAlert({editMessageMedia:async()=>edits++},a.id,correction,{expectedRevision:p.revision,refreshPhoto:true,renderSnapshot:async()=>{a.description='تعديل يدوي متزامن';return Buffer.from('mock');}}),/stale-repair-after-preview/);assert.equal(edits,0);assert.equal(a.type,'explosion');
});
test('backup recovery stops the correction; a failed durable write never edits Telegram',async()=>{
 const a=reset(),p=await preview(a);let edits=0;store._backupWritesPaused=true;
 await assert.rejects(repairNewsAlert(null,a.id,correction,{expectedRevision:p.revision}),/backup-recovery/);
 store._backupWritesPaused=false;store.backup={save:async()=>{throw Error('mock backup failure');}};store._backupPending=true;
 await assert.rejects(repairNewsAlert({editMessageMedia:async()=>edits++},a.id,correction,{expectedRevision:p.revision,refreshPhoto:true,renderSnapshot:async()=>Buffer.from('mock')}),/backup-unverified-no-channel-edit/);assert.equal(edits,0);store.backup=null;
});
test('Telegram failure is explicit partial state, not false success or a new post',async()=>{
 const a=reset(),p=await preview(a);let edits=0;
 const result=await repairNewsAlert({editMessageMedia:async()=>{edits++;throw Error('mock Telegram failure');}},a.id,correction,{expectedRevision:p.revision,refreshPhoto:true,renderSnapshot:async()=>Buffer.from('mock')});
 assert.equal(edits,1);assert.equal(result.ok,false);assert.equal(result.status,'map-updated-channel-unverified');assert.equal(store.getAlert(a.id).body,body);
});
test('an existing source attachment cannot be replaced by the generated-map repair',async()=>{
 const a=reset();a.media={type:'photo',bot_role:'admin',file_id:'mock_photo',file_unique_id:'mock_unique',mime_type:'image/jpeg',file_size:200};const p=await preview(a),before=publishedRepairRevision(a);
 await assert.rejects(repairNewsAlert({},a.id,correction,{expectedRevision:p.revision,refreshPhoto:true}),/existing-generated-photo-required/);assert.equal(publishedRepairRevision(a),before);
});
test('caution styling is per record and retains ordinary civil and all other palettes',()=>{
 assert.equal(eventVisual('civil').color,'#15803d');assert.equal(typeIcon('civil'),'shield');
 const caution={type:'civil',caution_visual:true};assert.equal(eventVisual('civil',caution).color,'#b45309');assert.equal(typeIcon('civil',caution),'alert');
 assert.equal(eventVisual('explosion',caution),eventVisual('explosion'));
 const marker=markerSvg('civil',100,100,1,'urgent_warning',caution);assert.ok(marker.includes('#b45309'));assert.ok(marker.includes(EXTRA_SVG.urgent_warning));assert.ok(!marker.includes(EXTRA_SVG.civil_shield));
});
test.after(async()=>{store.backup=null;await new Promise(r=>setTimeout(r,350));fs.rmSync(process.env.DATA_DIR,{recursive:true,force:true});});
