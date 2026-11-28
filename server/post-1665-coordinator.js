import express from 'express';
import crypto from 'node:crypto';
// Temporary explicit coordinator for one exact correction. No startup attempt.
// Existing news auth is checked by mount. State mutation stays in live process.
export function post1665Coordinator({run,ready,finished,now=Date.now}){
 let session=null;
 const timeoutMs=45000;
 const stop=()=>{if(session?.wait){clearTimeout(session.wait.timer);session.wait.reject(Error('challenge closed'));session.wait=null;}if(session)session.cancelled=true;};
 const status=()=>session?{id:session.id,state:session.state,...(session.wait?{challenge:session.wait.nonce,issuedAt:session.wait.issuedAt,expiresAt:session.wait.issuedAt+timeoutMs}:{}),...(session.result?{result:session.result}:{})}:{state:'idle'};
 const readActual=()=>new Promise((resolve,reject)=>{if(!session||session.cancelled)return reject(Error('cancelled'));const issuedAt=now(),nonce=crypto.randomBytes(24).toString('hex');const timer=setTimeout(()=>{stop();},timeoutMs);timer.unref?.();session.wait={nonce,issuedAt,resolve,reject,timer};session.state='awaiting-fresh-message';});
 return{
  status,
  start(){if(finished()||!ready())return{state:'not-ready'};if(session)return status();session={id:crypto.randomUUID(),state:'starting',cancelled:false};Promise.resolve().then(()=>run(readActual)).then(result=>{session.result=result;session.state='closed';},()=>{session.result={ok:false,state:'coordinator-failed',needsInspection:true};session.state='closed';}).finally(()=>{if(session.wait){clearTimeout(session.wait.timer);session.wait=null;}});return status();},
  answer(body){const w=session?.wait;if(!w||session.cancelled||body?.id!==session.id||body?.challenge!==w.nonce||now()>w.issuedAt+timeoutMs||!Number.isFinite(body.started)||body.started<w.issuedAt||body.started>body.checkedAt||!Number.isFinite(body.checkedAt)||body.checkedAt<w.issuedAt||body.checkedAt>now()||now()-body.checkedAt>15000)return{state:'rejected'};clearTimeout(w.timer);session.wait=null;session.state='checking';w.resolve({started:body.started,checkedAt:body.checkedAt,message:body.message});return{state:'accepted'};},
  cancel(){stop();return{state:'cancelled'};}
 };
}
export function mountPost1665Correction(app,{auth,run,ready,finished,limiter=(req,res,next)=>next()}){
 const c=post1665Coordinator({run,ready,finished});
 const guard=(req,res,next)=>{res.setHeader('Cache-Control','no-store');if(!auth(req))return res.status(404).end();req.once('aborted',()=>c.cancel());next();};
 app.post('/api/correction1665/start',limiter,guard,(req,res)=>finished()?res.status(410).json({state:'disabled'}):res.json(c.start()));
 app.get('/api/correction1665/status',limiter,guard,(req,res)=>res.json(c.status()));
 app.post('/api/correction1665/answer',limiter,guard,express.json({limit:'16kb'}),(req,res)=>finished()?res.status(410).json({state:'disabled'}):res.json(c.answer(req.body)));
 app.post('/api/correction1665/cancel',limiter,guard,(req,res)=>res.json(c.cancel()));
 return c;
}
