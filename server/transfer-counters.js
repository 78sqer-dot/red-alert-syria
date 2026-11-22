import { InputFile } from 'grammy';
import { BACKUP_NAME, LEGACY_BACKUP_NAME } from './backup-codec.js';

const HTTP_CATEGORIES=['html','scripts','styles','fonts','images','api','stream','media','other'];
const TELEGRAM_CATEGORIES=['backup','media','other'];
const newHttp=()=>({requests:0,completed:0,bodyBytes:0});
const newTelegram=()=>({attempts:0,estimatedNonFileJsonBytes:0,knownFileBytes:0,unknownInputFiles:0,unmeasuredPayloads:0});
function httpCategory(path){
  if(path==='/api/stream')return 'stream';
  if(/^\/api\/alerts\/[^/]+\/media$/u.test(path))return 'media';
  if(path.startsWith('/api/'))return 'api';
  if(/\.(?:m?js)$/iu.test(path))return 'scripts';
  if(/\.css$/iu.test(path))return 'styles';
  if(/\.(?:woff2?|ttf|otf)$/iu.test(path))return 'fonts';
  if(/\.(?:png|jpe?g|webp|svg|gif|ico)$/iu.test(path))return 'images';
  if(path==='/'||/^\/(?:ar|en)(?:\/|$)/u.test(path)||/\.html$/iu.test(path))return 'html';
  return 'other';
}
function chunkBytes(chunk,encoding){
  if(chunk==null)return 0;
  if(typeof chunk==='string')return Buffer.byteLength(chunk,typeof encoding==='string'?encoding:'utf8');
  return ArrayBuffer.isView(chunk)?chunk.byteLength:0;
}
function measureTelegramPayload(payload){
  const seen=new WeakSet();let nodes=0,knownFileBytes=0,unknownInputFiles=0,unmeasuredPayloads=0,backup=false,hasFile=false;
  const visit=(v,depth=0)=>{
    if(++nodes>20000||depth>32){unmeasuredPayloads=1;return 0;}
    if(v===null)return 4;
    if(typeof v==='string')return Buffer.byteLength(JSON.stringify(v));
    if(typeof v==='number'||typeof v==='boolean')return Buffer.byteLength(JSON.stringify(v));
    if(typeof v!=='object')return 0;
    if(seen.has(v)){unmeasuredPayloads=1;return 0;}seen.add(v);
    if(v instanceof InputFile){
      hasFile=true;
      const filename=Object.getOwnPropertyDescriptor(v,'filename')?.value;
      const data=Object.getOwnPropertyDescriptor(v,'fileData')?.value;
      if(filename===BACKUP_NAME||filename===LEGACY_BACKUP_NAME)backup=true;
      if(ArrayBuffer.isView(data))knownFileBytes+=data.byteLength;
      else unknownInputFiles++;
      return 6; // Placeholder estimate only. Multipart framing is not measured.
    }
    if(ArrayBuffer.isView(v)){unmeasuredPayloads=1;return 0;}
    if(Array.isArray(v)){
      if(v.length>20000-nodes){unmeasuredPayloads=1;return 0;}
      let size=2+Math.max(0,v.length-1);
      for(let i=0;i<v.length;i++){
        const d=Object.getOwnPropertyDescriptor(v,String(i));
        if(!d){size+=4;continue;}
        if(!Object.hasOwn(d,'value')){unmeasuredPayloads=1;size+=4;continue;}
        size+=d.value===undefined||typeof d.value==='function'||typeof d.value==='symbol'?4:visit(d.value,depth+1);
      }
      return size;
    }
    let size=2,fields=0;
    for(const key of Object.keys(v)){
      const d=Object.getOwnPropertyDescriptor(v,key);
      if(!d||!Object.hasOwn(d,'value')){unmeasuredPayloads=1;continue;}
      if(d.value===undefined||typeof d.value==='function'||typeof d.value==='symbol')continue;
      size+=(fields++?1:0)+Buffer.byteLength(JSON.stringify(key))+1+visit(d.value,depth+1);
    }
    return size;
  };
  const estimatedNonFileJsonBytes=visit(payload);
  return{category:backup?'backup':hasFile?'media':'other',estimatedNonFileJsonBytes,knownFileBytes,unknownInputFiles,unmeasuredPayloads};
}
export function createTransferCounters(){
  const state={since:new Date().toISOString(),http:{...newHttp(),byCategory:Object.fromEntries(HTTP_CATEGORIES.map(k=>[k,newHttp()]))},telegram:{...newTelegram(),byCategory:Object.fromEntries(TELEGRAM_CATEGORIES.map(k=>[k,newTelegram()]))}};
  const middleware=(req,res,next)=>{
    let category='other';try{category=httpCategory(String(req.path||''));}catch{/* Metrics must not block a request. */}
    const group=state.http.byCategory[category];state.http.requests++;group.requests++;
    const add=(bytes)=>{if(req.method==='HEAD'||res.statusCode<200||res.statusCode===204||res.statusCode===304)return;state.http.bodyBytes+=bytes;group.bodyBytes+=bytes;};
    const write=res.write,end=res.end;let ending=false;
    res.write=function(chunk,encoding){const result=Reflect.apply(write,this,arguments);if(!ending)add(chunkBytes(chunk,encoding));return result;};
    res.end=function(chunk,encoding){const old=ending;ending=true;let result;try{result=Reflect.apply(end,this,arguments);}finally{ending=old;}if(!old)add(chunkBytes(chunk,encoding));return result;};
    res.once('finish',()=>{state.http.completed++;group.completed++;});
    next();
  };
  const telegramAttempt=(_method,payload)=>{
    try{
      const m=measureTelegramPayload(payload),group=state.telegram.byCategory[m.category];
      state.telegram.attempts++;group.attempts++;
      for(const key of ['estimatedNonFileJsonBytes','knownFileBytes','unknownInputFiles','unmeasuredPayloads']){state.telegram[key]+=m[key];group[key]+=m[key];}
    }catch{state.telegram.attempts++;state.telegram.unmeasuredPayloads++;}
  };
  const snapshot=()=>structuredClone({...state,coverage:{http:'Response body bytes handed to Node after compression; headers, transport and delivery acknowledgements excluded.',telegram:'Attempted known in-memory file bytes plus estimated non-file JSON; retries count again, unknown file streams/paths remain unmeasured.',privacy:'Fixed aggregate categories only. No message text, recipient IDs, filenames, raw URLs, headers or secrets are retained.'}});
  const mountPrivateStatus=(app,isAdmin,limiter)=>app.get('/api/admin/transfer-status',...(limiter?[limiter]:[]),(req,res)=>{if(!isAdmin(req))return res.status(404).end();res.setHeader('Cache-Control','no-store');return res.json(snapshot());});
  return{middleware,telegramAttempt,snapshot,mountPrivateStatus};
}
export const transferCounters=createTransferCounters();
