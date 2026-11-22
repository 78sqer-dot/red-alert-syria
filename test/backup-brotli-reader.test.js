import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,brotliCompressSync,constants as Z} from 'node:zlib';
import {InputFile} from 'grammy';
import {encodeBackup,decodeBackup,isBackupName,BACKUP_NAME,GZIP_BACKUP_NAME,LEGACY_BACKUP_NAME,BROTLI_BACKUP_NAME} from '../server/backup-codec.js';
import {createTransferCounters} from '../server/transfer-counters.js';

const MAGIC=Buffer.from('RASB2\r\n\x1a\n','ascii'),HEADER=MAGIC.length+4+32;
function framed(json){const raw=Buffer.from(json),head=Buffer.alloc(HEADER);MAGIC.copy(head);head.writeUInt32BE(raw.length,MAGIC.length);createHash('sha256').update(raw).digest().copy(head,MAGIC.length+4);return Buffer.concat([head,brotliCompressSync(raw,{params:{[Z.BROTLI_PARAM_QUALITY]:6,[Z.BROTLI_PARAM_MODE]:Z.BROTLI_MODE_TEXT,[Z.BROTLI_PARAM_SIZE_HINT]:raw.length}})]);}
const json=JSON.stringify({alerts:[{id:'fixture',body:'خبر اختبار فقط '.repeat(300)}],news:{drafts:{a:{status:'published',postId:42}},handled:{'fixture/42':2},last:{fixture:42}},jobs:{decisions:{fixture:{status:'ignored'}}},log:[{audit:'keep exact'}]});

test('active writer uses versioned Brotli and both older formats still restore',()=>{assert.equal(BACKUP_NAME,BROTLI_BACKUP_NAME);assert.deepEqual(encodeBackup(json),framed(json));assert.equal(decodeBackup(encodeBackup(json)),json);assert.equal(decodeBackup(gzipSync(Buffer.from(json),{level:6})),json);assert.equal(decodeBackup(Buffer.from(json)),json);});
test('versioned Brotli reader preserves every original JSON byte and all nested audits',()=>{assert.equal(decodeBackup(framed(json)),json);assert.deepEqual(JSON.parse(decodeBackup(framed(json))),JSON.parse(json));});
test('truncated, unsupported-version and unframed Brotli fail closed',()=>{const good=framed(json);for(const n of [0,4,8,HEADER-1,HEADER,good.length-1])assert.throws(()=>decodeBackup(good.subarray(0,n)));const version=Buffer.from(good);version[4]=0x33;assert.throws(()=>decodeBackup(version),/version|header/);assert.throws(()=>decodeBackup(good.subarray(HEADER)));});
test('declared raw lengths are bounded and must match decompressed output exactly',()=>{for(const length of [0,32*1024*1024+1,1,Buffer.byteLength(json)-1,Buffer.byteLength(json)+1]){const payload=framed(json);payload.writeUInt32BE(length,MAGIC.length);assert.throws(()=>decodeBackup(payload));}});
test('checksum rejects altered raw JSON even when Brotli and JSON remain valid',()=>{const good=framed(json),altered=framed(json.replace('keep exact','keep other'));good.subarray(MAGIC.length+4,HEADER).copy(altered,MAGIC.length+4);assert.throws(()=>decodeBackup(altered),/checksum|length/);const brokenHash=Buffer.from(good);brokenHash[MAGIC.length+4]^=1;assert.throws(()=>decodeBackup(brokenHash),/checksum/);});
test('trailing compressed-stream data is rejected rather than silently ignored',()=>{assert.throws(()=>decodeBackup(Buffer.concat([framed(json),Buffer.from('trailing fixture')])),/length/);assert.throws(()=>decodeBackup(Buffer.concat([framed(json),framed(json).subarray(HEADER)])),/length/);});
test('valid frames still require nonempty valid state JSON',()=>{for(const bad of ['',' ','null','{}','{"alerts":null}','not-json'])assert.throws(()=>decodeBackup(framed(bad)));});
test('accepted filenames stay exact and all backup codecs keep private aggregate classification',()=>{for(const name of [GZIP_BACKUP_NAME,LEGACY_BACKUP_NAME,BROTLI_BACKUP_NAME])assert.ok(isBackupName(name));for(const name of ['',undefined,null,42,'other.rasb',BROTLI_BACKUP_NAME+'.extra'])assert.equal(isBackupName(name),false);const counters=createTransferCounters(),payload=framed(json);counters.telegramAttempt('editMessageMedia',{media:{media:new InputFile(payload,BROTLI_BACKUP_NAME)}});const result=counters.snapshot();assert.equal(result.telegram.byCategory.backup.knownFileBytes,payload.length);assert.equal(result.telegram.byCategory.media.knownFileBytes,0);assert.ok(!JSON.stringify(result).includes(BROTLI_BACKUP_NAME));});

// Adapter fixtures never start a bot/poller and never use real account credentials.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ras-backup-reader-'));
process.env.DATA_DIR=dir;process.env.BOT_TOKEN='123456:LOCAL_READER_TEST';process.env.PRIMARY_OWNER_ID='1002';process.env.OWNER_IDS='1002';process.env.TELEGRAM_BACKUP='true';
const {telegramBackupAdapter}=await import('../server/bot.js');
const {store}=await import('../server/store.js');
const originalFetch=globalThis.fetch;let downloads=0,uploads=[];
const api={async getChat(){return{pinned_message:{message_id:101,document:{file_name:BROTLI_BACKUP_NAME,file_id:'fixture-file'}}};},async getFile(){return{file_path:'fixture/backup.rasb'};},async editMessageMedia(chat,id,media){uploads.push({chat,id,payload:media.media.fileData,name:media.media.filename});return{message_id:id};}};
globalThis.fetch=async()=>{downloads++;return new Response(framed(json));};
test('adapter restores new-format pinned file then writes the exact new format with a forced durability barrier',async()=>{const adapter=telegramBackupAdapter(api);assert.equal(await adapter.load(),json);assert.equal(downloads,1);await adapter.save(json,{force:true});assert.equal(uploads.length,1);assert.equal(uploads[0].id,101);assert.equal(uploads[0].name,BACKUP_NAME);assert.deepEqual(uploads[0].payload,encodeBackup(json));});
test('adapter refuses an unrelated pinned filename without downloading it',async()=>{const before=downloads,old=api.getChat;api.getChat=async()=>({pinned_message:{message_id:102,document:{file_name:'unrelated.rasb',file_id:'fixture'}}});try{assert.equal(await telegramBackupAdapter(api).load(),null);assert.equal(downloads,before);}finally{api.getChat=old;}});
test('adapter upgrades either legacy pin in place without a new backup message or weaker forced save',async()=>{const oldChat=api.getChat,oldFetch=globalThis.fetch;try{for(const name of [GZIP_BACKUP_NAME,LEGACY_BACKUP_NAME]){api.getChat=async()=>({pinned_message:{message_id:101,document:{file_name:name,file_id:'fixture-file'}}});globalThis.fetch=async()=>{downloads++;return new Response(name===GZIP_BACKUP_NAME?gzipSync(Buffer.from(json),{level:6}):Buffer.from(json));};const adapter=telegramBackupAdapter(api),before=uploads.length;assert.equal(await adapter.load(),json);await adapter.save(json,{force:true});assert.equal(uploads.length,before+1);const current=uploads.at(-1);assert.equal(current.id,101);assert.equal(current.name,BROTLI_BACKUP_NAME);assert.equal(decodeBackup(current.payload),json);}}finally{api.getChat=oldChat;globalThis.fetch=oldFetch;}});
after(()=>{globalThis.fetch=originalFetch;clearTimeout(store._backupTimer);clearTimeout(store._saveTimer);fs.rmSync(dir,{recursive:true,force:true});});
