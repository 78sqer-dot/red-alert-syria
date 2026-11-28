// Hard bounds cover response headers and streaming body, not only fetch().
export async function readBoundedCapText(response,{maxBytes,signal}={}){
 const length=Number(response.headers?.get('content-length'));if(length>maxBytes)throw Error('CAP response too large');
 if(!response.body?.getReader)throw Error('CAP response stream unavailable');
 const reader=response.body.getReader();const decoder=new TextDecoder();let size=0,text='';
 const abort=()=>{reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 try{for(;;){if(signal?.aborted)throw Error('CAP body timeout');const next=await reader.read();if(signal?.aborted)throw Error('CAP body timeout');if(next.done)break;size+=next.value.byteLength;if(size>maxBytes){await reader.cancel();throw Error('CAP response too large');}text+=decoder.decode(next.value,{stream:true});}return text+decoder.decode();}
 finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
}
export async function fetchBoundedCap(url,{headers,redirect='error',timeoutMs=12000,maxBytes=262144}={}){
 const controller=new AbortController();let timer;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('CAP request/body timeout'));},timeoutMs);});
 try{return await Promise.race([(async()=>{const response=await fetch(url,{headers,redirect,signal:controller.signal});if(response.status===304||[301,302,303,307,308].includes(response.status)||!response.ok){await response.body?.cancel();return{response,text:null};}const text=await readBoundedCapText(response,{maxBytes,signal:controller.signal});return{response,text};})(),deadline]);}
 finally{clearTimeout(timer);}
}
