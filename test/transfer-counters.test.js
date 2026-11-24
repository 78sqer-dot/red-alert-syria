import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import express from 'express';
import compression from 'compression';
import { InputFile } from 'grammy';
import { createTransferCounters,transferCounters } from '../server/transfer-counters.js';
import { BACKUP_NAME } from '../server/backup-codec.js';
import { installResilience,NET } from '../server/tg-net.js';

async function withServer(app,run){const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{return await run(server.address().port);}finally{await new Promise(resolve=>server.close(resolve));}}
function get(port,path,headers={}){return new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port,path,headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));}).on('error',reject);});}

test('HTTP middleware counts compressed response bodies rather than uncompressed source bytes',async()=>{
 const c=createTransferCounters(),app=express(),body='خبر تجريبي للقياس فقط '.repeat(500);app.use(c.middleware);app.use(compression({threshold:0}));app.get('/api/fixture',(_req,res)=>res.type('text/plain').send(body));
 await withServer(app,async port=>{const r=await get(port,'/api/fixture',{'accept-encoding':'gzip'});assert.equal(r.headers['content-encoding'],'gzip');const s=c.snapshot();assert.equal(s.http.bodyBytes,r.body.length);assert.equal(s.http.byCategory.api.bodyBytes,r.body.length);assert.ok(s.http.bodyBytes<Buffer.byteLength(body)/4);assert.equal(s.http.completed,1);});
});
test('stream chunks count while connection is open and do not change write/end behavior',()=>{
 const c=createTransferCounters(),res=new EventEmitter();let ended=false;
 res.write=()=>false;res.end=function(chunk){if(chunk)this.write(chunk);ended=true;this.emit('finish');return this;};
 let next=false;c.middleware({path:'/api/stream'},res,()=>next=true);assert.ok(next);assert.equal(res.write('data: خبر\n\n'),false);assert.equal(c.snapshot().http.byCategory.stream.bodyBytes,Buffer.byteLength('data: خبر\n\n'));assert.equal(res.end('last'),res);assert.ok(ended);assert.equal(c.snapshot().http.bodyBytes,Buffer.byteLength('data: خبر\n\nlast'),'end must not double-count an internal write');assert.equal(c.snapshot().http.completed,1);
});
test('HEAD and no-body response statuses do not count discarded body arguments',()=>{
 const c=createTransferCounters();for(const [method,statusCode] of [['HEAD',200],['GET',204],['GET',304]]){const r=new EventEmitter();r.statusCode=statusCode;r.write=()=>true;r.end=()=>r;c.middleware({path:'/api/fixture',method},r,()=>{});r.end('discarded fixture');}assert.equal(c.snapshot().http.bodyBytes,0);
});
test('private status needs the existing admin check and limiter',async()=>{
 const c=createTransferCounters(),app=express();let checks=0;app.use(c.middleware);c.mountPrivateStatus(app,req=>req.headers['x-admin-key']==='synthetic-admin',(req,_res,next)=>{checks++;next();});
 await withServer(app,async port=>{assert.equal((await get(port,'/api/admin/transfer-status')).status,404);const good=await get(port,'/api/admin/transfer-status',{'x-admin-key':'synthetic-admin'});assert.equal(good.status,200);assert.equal(good.headers['cache-control'],'no-store');const result=JSON.parse(good.body);assert.equal(typeof result.since,'string');assert.ok(result.coverage.http.includes('after compression'));assert.equal(checks,2);});
});
test('known uploaded files are separated from backup files without retaining names or content',()=>{
 const c=createTransferCounters();c.telegramAttempt('sendDocument',{chat_id:'PRIVATE_RECIPIENT_MARKER',document:new InputFile(Buffer.alloc(500),BACKUP_NAME),caption:'PRIVATE_TEXT_MARKER'});c.telegramAttempt('sendPhoto',{chat_id:12,photo:new InputFile(Buffer.alloc(1234),'private-photo-marker.jpg')});
 const s=c.snapshot();assert.equal(s.telegram.byCategory.backup.knownFileBytes,500);assert.equal(s.telegram.byCategory.media.knownFileBytes,1234);assert.equal(s.telegram.knownFileBytes,1734);assert.equal(s.telegram.attempts,2);assert.ok(s.telegram.estimatedNonFileJsonBytes>0);for(const marker of ['PRIVATE_RECIPIENT_MARKER','PRIVATE_TEXT_MARKER','private-photo-marker',BACKUP_NAME])assert.ok(!JSON.stringify(s).includes(marker));
});
test('unknown file streams/paths are explicitly unmeasured and are never opened',()=>{
 const c=createTransferCounters();c.telegramAttempt('sendDocument',{document:new InputFile('/synthetic-missing-private-file.pdf')});const s=c.snapshot();assert.equal(s.telegram.unknownInputFiles,1);assert.equal(s.telegram.knownFileBytes,0);assert.ok(!JSON.stringify(s).includes('/synthetic-missing'));
});
test('payload inspection does not call getters and handles cycles without changing input',()=>{
 const c=createTransferCounters();let called=0;const payload={text:'fixture'};Object.defineProperty(payload,'secretGetter',{enumerable:true,get(){called++;throw new Error('must not run');}});const array=[];Object.defineProperty(array,'0',{enumerable:true,get(){called++;throw new Error('array getter must not run');}});payload.media=array;payload.self=payload;c.telegramAttempt('sendMessage',payload);assert.equal(called,0);assert.equal(payload.self,payload);assert.equal(c.snapshot().telegram.unmeasuredPayloads,1);
});
test('HTTP categories are bounded and never retain raw request paths or queries',()=>{
 const c=createTransferCounters();for(const path of ['/tg/PRIVATE_WEBHOOK_MARKER','/ar/','/app.js','/fonts/a.woff2','/api/alerts/private-id/media']){const r=new EventEmitter();r.write=()=>true;r.end=()=>r;c.middleware({path},r,()=>{});r.end('x');}const serialized=JSON.stringify(c.snapshot());assert.ok(!serialized.includes('PRIVATE_WEBHOOK_MARKER'));assert.ok(!serialized.includes('private-id'));assert.equal(Object.keys(c.snapshot().http.byCategory).length,9);
});
test('Telegram retries count attempted payloads separately and keep retry policy unchanged',async()=>{
 const old={...NET},start=transferCounters.snapshot().telegram.attempts;let transform,calls=0;installResilience({config:{use(fn){transform=fn;}}},'fixture');NET.attempts=2;NET.backoff=[0];NET.maxTotalMs=10000;
 try{const result=await transform(async()=>++calls===1?{ok:false,error_code:500,description:'fixture'}:{ok:true,result:true},'editMessageText',{chat_id:1,text:'fixture'});assert.ok(result.ok);assert.equal(calls,2);assert.equal(transferCounters.snapshot().telegram.attempts-start,2);}finally{Object.assign(NET,old);}
});
test('long-poll requests are measured without receiving a new deadline or retries',async()=>{
 const start=transferCounters.snapshot().telegram.attempts;let transform;installResilience({config:{use(fn){transform=fn;}}});const signal=new AbortController().signal;let received;await transform(async(_method,_payload,s)=>{received=s;return{ok:true};},'getUpdates',{timeout:50},signal);assert.equal(received,signal);assert.equal(transferCounters.snapshot().telegram.attempts-start,1);
});
