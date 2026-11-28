import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.TELEGRAM_BACKUP='false';
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'approved-channel-'));
const {setSourceNames}=await import('../server/clean-text.js');
setSourceNames(['الإخبارية السورية']);
const {channelPost,refreshChannelPost}=await import('../server/bot.js');
const {approvedCorrectionFingerprint}=await import('../server/approved-public-correction.js');
const M=JSON.parse(fs.readFileSync(new URL('../data/repairs/1665-correction.json',import.meta.url)));
function fixture(){const a={...structuredClone(M.before.alert),...structuredClone(M.patch)};a.meta.approvedPublicCorrection={version:1,fingerprint:approvedCorrectionFingerprint(a),approvalReference:M.approvalReference};return a;}
const plain=s=>s.replace(/<[^>]+>/g,'');
test('approved corrected title and full attribution survive active and expired captions without state mutation',async()=>{
 for(const ended of [false,true]){const a=fixture();a.is_active=!ended;if(ended)a.ended_at=a.expires_at;const before=structuredClone(a);let edits=[];
 await refreshChannelPost({editMessageCaption:async(...args)=>{edits.push(args);}},a,ended);
 assert.equal(edits.length,1);assert.equal(edits[0][1],1665);const caption=plain(edits[0][2].caption);
 assert.ok(caption.includes(M.patch.title));assert.ok(caption.includes(M.patch.description));assert.equal(caption.includes('انتهى :'),ended);assert.deepEqual(a,before);
 }
});
test('changed approved fields fail closed instead of silently sanitizing or losing location',()=>{for(const key of ['description','title','place']){const a=fixture();a[key]=key==='place'?{scope:'country',name_ar:'changed'}:a[key]+'changed';assert.throws(()=>channelPost(a,{ended:true}),/invalid-approved-channel-correction/);}});
test('overlong approved caption is not silently trimmed or rendered through unapproved copy',async()=>{const a=fixture();a.description+='x'.repeat(1500);a.meta.approvedPublicCorrection.fingerprint=approvedCorrectionFingerprint(a);let edits=0;await refreshChannelPost({editMessageCaption:async()=>{edits++;}},a,true);assert.equal(edits,0);});
test('ordinary news still uses private-source cleaning and normal locality formatting',()=>{const a=fixture();delete a.meta.approvedPublicCorrection;const text=plain(channelPost(a));assert.ok(!text.includes('الإخبارية السورية'));assert.ok(!text.includes(M.patch.title));});
