// Durable future-post relay. Ambiguous delivery is never automatically repeated.
export class RelayOutbox {
 constructor({state,save,send,clock=Date.now,ready=()=>true}){Object.assign(this,{state,save,send,clock,ready});this.running=false;}
 async enqueue({alertId,postId,text,subject,to,sender}){
  if(!alertId||!postId||!text||!to||!sender)throw Error('incomplete-relay-record');
  const key=alertId+':'+postId;
  if(this.state[key])return this.state[key];
  const row={key,alertId,postId,text,subject,to,sender,status:'pending',attempts:0,createdAt:this.clock(),nextAt:0};
  this.state[key]=row;
  if(!await this.save())throw Error('relay-backup-unverified');
  return row;
 }
 async drain({configured=true}={}){
  if(this.running||!this.ready())return;
  this.running=true;
  try{
   for(const row of Object.values(this.state)){
    if(!['pending','retry','blocked-config'].includes(row.status)||row.nextAt>this.clock())continue;
    if(!this.ready())break;
    if(!configured){if(row.status!=='blocked-config'){row.status='blocked-config';await this.save();}continue;}
    row.status='sending';row.attempts++;row.lastAttemptAt=this.clock();
    if(!await this.save()){row.status='pending';break;}
    if(!this.ready()){row.status='pending';break;}
    // Persist sending BEFORE network. A crash leaves uncertain, never automatic resend.
    try{
     const r=await this.send(row);
     if(r.accepted){row.status='accepted';row.providerId=r.id||null;}
     else if(r.status===429&&row.attempts<3){row.status='retry';row.nextAt=this.clock()+60_000*row.attempts;}
     else row.status=r.status>=500?'uncertain':'rejected';
     row.http=r.status;
    }catch{row.status='uncertain';}
    row.updatedAt=this.clock();await this.save();
   }
  }finally{this.running=false;}
 }
 recover(){for(const row of Object.values(this.state))if(row.status==='sending'){row.status='uncertain';row.updatedAt=this.clock();}}
}

export function mergeRelayRecords(local={},remote={}){
 const result={...local};
 const terminal=new Set(['accepted','uncertain','rejected']);
 for(const [key,row] of Object.entries(remote)){
  const cur=result[key];
  if(!cur||(row.status==='accepted'&&cur.status!=='accepted')||(!terminal.has(cur.status)&&terminal.has(row.status))||(!terminal.has(cur.status)&&!terminal.has(row.status)&&(row.updatedAt||row.lastAttemptAt||row.createdAt||0)>(cur.updatedAt||cur.lastAttemptAt||cur.createdAt||0)))result[key]=structuredClone(row);
  if(result[key]?.status==='sending')result[key]={...result[key],status:'uncertain'};
 }
 return result;
}
