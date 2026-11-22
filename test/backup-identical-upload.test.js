import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated API fixtures only. Never create/start a bot or use production tokens.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ras-backup-dedupe-'));
process.env.DATA_DIR=dir;
process.env.BOT_TOKEN='123456:LOCAL_TEST';
process.env.PRIMARY_OWNER_ID='1002';
process.env.OWNER_IDS='1002';
process.env.TELEGRAM_BACKUP='true';
const {config,envDefaults}=await import('../server/config.js');
const {telegramBackupAdapter}=await import('../server/bot.js');
const {backupTransfer,decodeBackup,encodeBackup,BACKUP_NAME}=await import('../server/backup-codec.js');
const {store}=await import('../server/store.js');
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('network forbidden in backup dedupe fixture');};
const json=JSON.stringify({alerts:[{id:'synthetic',body:'خبر تجريبي '.repeat(400)}],news:{drafts:{},last:{fixture:7}}});
function fixture(){
 config.ownerIds=[1002];config.botToken=envDefaults.botToken;
 const calls=[];let next=1;let editFailure=null,pinFailure=false;
 const api={
  async sendDocument(chat,file){calls.push({kind:'send',chat,bytes:file.fileData});return{message_id:next++};},
  async editMessageMedia(chat,id,media){calls.push({kind:'edit',chat,id,bytes:media.media.fileData});if(editFailure){const e=editFailure;editFailure=null;throw e;}return{message_id:id};},
  async pinChatMessage(chat,id){calls.push({kind:'pin',chat,id});if(pinFailure)throw new Error('fixture pin failure');},
  async deleteMessage(chat,id){calls.push({kind:'delete',chat,id});},
 };
 const adapter=telegramBackupAdapter(api);
 return{adapter,api,calls,setEditFailure:e=>editFailure=e,setPinFailure:v=>pinFailure=v,uploads:()=>calls.filter(c=>c.kind==='send'||c.kind==='edit')};
}

test('routine identical backups skip upload only after a confirmed pin',async()=>{
 const f=fixture(),saves=backupTransfer.saves,skips=backupTransfer.skippedIdenticalSaves,uploaded=backupTransfer.uploadedBytes,avoided=backupTransfer.avoidedIdenticalPayloadBytes;
 await f.adapter.save(json);
 for(let i=0;i<20;i++)await f.adapter.save(json);
 assert.equal(f.uploads().length,1);assert.equal(f.calls.filter(c=>c.kind==='pin').length,1);
 assert.equal(backupTransfer.saves-saves,1);assert.equal(backupTransfer.skippedIdenticalSaves-skips,20);
 assert.equal(backupTransfer.uploadedBytes-uploaded,f.uploads()[0].bytes.length);
 assert.equal(backupTransfer.avoidedIdenticalPayloadBytes-avoided,20*f.uploads()[0].bytes.length);
 assert.equal(decodeBackup(f.uploads()[0].bytes),json,'the saved state is exact');
});
test('forced identical saves still cross the remote durability barrier',async()=>{
 const f=fixture();await f.adapter.save(json);await f.adapter.save(json,{force:true});
 assert.deepEqual(f.uploads().map(c=>c.kind),['send','edit']);
 await f.adapter.save(json);assert.equal(f.uploads().length,2);
});
test('any changed checkpoint or decision uploads promptly',async()=>{
 const f=fixture();await f.adapter.save(json);const changed=JSON.parse(json);changed.news.last.fixture=8;changed.news.drafts.fixture={status:'published',postId:99};const updated=JSON.stringify(changed);
 await f.adapter.save(updated);await f.adapter.save(updated);
 assert.equal(f.uploads().length,2);assert.equal(decodeBackup(f.uploads()[1].bytes),updated);
});
test('an uncertain failed edit is not cached and the same changed state is retried',async()=>{
 const f=fixture();await f.adapter.save(json);const changed=JSON.stringify({...JSON.parse(json),fixture:'changed'});
 f.setEditFailure(new Error('fixture network uncertainty'));
 await assert.rejects(f.adapter.save(changed),/network uncertainty/);
 await f.adapter.save(changed);assert.equal(f.uploads().length,3);
 await f.adapter.save(changed);assert.equal(f.uploads().length,3);
 assert.equal(f.calls.filter(c=>c.kind==='send').length,1,'uncertain edit never falls back to a duplicate document');
});
test('a failed pin never authorizes identical-save suppression',async()=>{
 const f=fixture();f.setPinFailure(true);await assert.rejects(f.adapter.save(json),/pin failure/);
 f.setPinFailure(false);await f.adapter.save(json);assert.equal(f.uploads().length,2);
 await f.adapter.save(json);assert.equal(f.uploads().length,2);
});
test('owner and bot destinations cannot reuse each other\'s confirmation',async()=>{
 const f=fixture();await f.adapter.save(json);
 config.botToken='654321:LOCAL_TEST_OTHER';config.ownerIds=[1003];await f.adapter.save(json);await f.adapter.save(json);
 assert.equal(f.uploads().length,2);assert.deepEqual(f.uploads().map(c=>c.chat),[1002,1003]);
 config.ownerIds=[1002];await f.adapter.save(json);assert.equal(f.uploads().length,3,'same chat with a different bot is a new destination');
});
test('migration mirror copies remain separate, sanitized, and forceable',async()=>{
 const f=fixture();config.ownerIds=[1003];
 const withProject=JSON.stringify({...JSON.parse(json),settings:{project:{botToken:'synthetic-private-token',reportBotToken:'synthetic-private-report',ownerId:1003}}});
 await f.adapter.save(withProject);assert.equal(f.uploads().length,2);
 const primary=JSON.parse(decodeBackup(f.uploads()[0].bytes)),mirror=JSON.parse(decodeBackup(f.uploads()[1].bytes));
 assert.equal(primary.settings.project.botToken,'synthetic-private-token');assert.equal(mirror.settings.project.botToken,undefined);assert.equal(mirror.settings.project.reportBotToken,undefined);
 await f.adapter.save(withProject);assert.equal(f.uploads().length,2);
 await f.adapter.save(withProject,{force:true});assert.equal(f.uploads().length,4);
 assert.deepEqual(f.uploads().map(c=>c.chat),[1003,1002,1003,1002]);
});
test('a new adapter instance does not infer confirmation from another instance',async()=>{
 const a=fixture();await a.adapter.save(json);const b=fixture();await b.adapter.save(json);assert.equal(b.uploads().length,1);
});
test('reading or failing to read a pinned snapshot invalidates prior skip confirmation',async()=>{
 const f=fixture();await f.adapter.save(json);const guardedFetch=globalThis.fetch;
 f.api.getChat=async()=>({pinned_message:{message_id:1,document:{file_name:BACKUP_NAME,file_id:'fixture'}}});
 f.api.getFile=async()=>({file_path:'synthetic-remote.gz'});
 globalThis.fetch=async()=>new Response(encodeBackup(JSON.stringify({alerts:[],fixture:'different remote snapshot'})));
 try{await f.adapter.load();await f.adapter.save(json);assert.equal(f.uploads().length,2);f.api.getChat=async()=>{throw new Error('fixture load failed');};await assert.rejects(f.adapter.load(),/load failed/);await f.adapter.save(json);assert.equal(f.uploads().length,3);}
 finally{globalThis.fetch=guardedFetch;}
});
test('a concurrent read cannot bind an old-message upload to a different pinned message',async()=>{
 const f=fixture();await f.adapter.save(json);const changed=JSON.stringify({...JSON.parse(json),fixture:'changed'}),guardedFetch=globalThis.fetch;
 let release;const gate=new Promise(resolve=>release=resolve),originalEdit=f.api.editMessageMedia;
 f.api.editMessageMedia=async(...args)=>{await gate;return originalEdit(...args);};
 const flight=f.adapter.save(changed);
 f.api.getChat=async()=>({pinned_message:{message_id:99,document:{file_name:BACKUP_NAME,file_id:'fixture'}}});f.api.getFile=async()=>({file_path:'synthetic-remote.gz'});globalThis.fetch=async()=>new Response(encodeBackup(json));
 try{await f.adapter.load();release();await flight;f.api.editMessageMedia=originalEdit;await f.adapter.save(changed);assert.equal(f.uploads().length,3);assert.deepEqual(f.uploads().slice(1).map(c=>c.id),[1,99]);}
 finally{release();globalThis.fetch=guardedFetch;}
});
test('store passes force through to the adapter without weakening serialized saves',async()=>{
 const old={backup:store.backup,state:store.state,pending:store._backupPending,lazy:store._backupLazy,paused:store._backupWritesPaused};
 const calls=[];store.state={alerts:[],fixture:'store-force'};store.backup={async save(body,options){calls.push({body,options});}};store._backupWritesPaused=false;
 try{store.persist();assert.equal(await store.flushBackup(),true);store.persist();assert.equal(await store.flushBackup(true),true);assert.deepEqual(calls.map(c=>c.options.force),[false,true]);}
 finally{clearTimeout(store._backupTimer);clearTimeout(store._saveTimer);store.backup=old.backup;store.state=old.state;store._backupPending=old.pending;store._backupLazy=old.lazy;store._backupWritesPaused=old.paused;}
});
after(()=>{globalThis.fetch=originalFetch;clearTimeout(store._backupTimer);clearTimeout(store._saveTimer);fs.rmSync(dir,{recursive:true,force:true});});
