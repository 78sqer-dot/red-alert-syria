// READ ONLY. Pinned current Telegram Web A build. No cached-message fallback.
const mod=await import('/a/assets/InputText-BNmmusFw.js');
if(typeof mod.Pd!=='function')throw Error('client read capability changed');
const chat=await new Promise((resolve,reject)=>{const r=indexedDB.open('tt-data');r.onerror=()=>reject(Error('chat lookup failed'));r.onsuccess=()=>{const d=r.result;const q=d.transaction('store').objectStore('store').get('tt-global-state');q.onsuccess=()=>{const v=typeof q.result==='string'?JSON.parse(q.result):q.result;resolve(v.chats.byId['-1004387100492']);d.close()}}});
if(!chat||chat.id!=='-1004387100492')throw Error('channel absent');
const started=Date.now();
// Pd is current build's exported callApi. fetchMessage invokes
// channels.GetMessages and returns the network response, not stored content.
const result=await mod.Pd('fetchMessage',{chat,messageId:1664});
const m=result?.message;
if(!m||m.id!==1664||m.chatId!=='-1004387100492')throw Error('fresh message absent');
return{started,checkedAt:Date.now(),method:'channels.GetMessages',message:{id:m.id,chatId:m.chatId,date:m.date,isEdited:m.isEdited,text:m.text||m.content?.text,photo:!!m.content?.photo,photoIdentity:m.content?.photo?{id:m.content.photo.id,date:m.content.photo.date,sizes:m.content.photo.sizes,thumbnail:m.content.photo.thumbnail}:null,inlineButtons:m.inlineButtons}};
