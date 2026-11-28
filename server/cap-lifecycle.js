// Exact CAP envelope reconciliation. No publication or network dependencies.
export const capKey = x => x && x.sender && x.identifier && Number.isFinite(Date.parse(x.sent))
 ? JSON.stringify([x.sender,x.identifier,new Date(x.sent).toISOString()]) : null;
export function reconcileCapMessages(messages,{now=Date.now(),suppressed:prior=[]}={}){
 const valid=messages.filter(x=>x.status==='Actual'&&x.scope==='Public'&&capKey(x)&&Date.parse(x.sent)<=now&&['Alert','Update','Cancel'].includes(x.msgType));
 const conflicts=new Set(), latest=new Map();for(const m of valid){const key=capKey(m),p=latest.get(key);if(p&&m.fetchedAt===p.fetchedAt&&m.documentHash!==p.documentHash){conflicts.add(key);continue;}if(!p||m.fetchedAt>p.fetchedAt){latest.set(key,m);conflicts.delete(key);}}
 const sorted=[...latest.values()].sort((a,b)=>Date.parse(a.sent)-Date.parse(b.sent)||capKey(a).localeCompare(capKey(b)));
 const suppressed=new Set(prior),invalidUpdates=new Set(),diagnostics=[...conflicts].map(key=>({key,reason:'conflicting-identity'}));
 for(const m of sorted){if(conflicts.has(capKey(m))||m.msgType==='Alert')continue;const refs=Array.isArray(m.references)?m.references:[];
  if(!refs.length||refs.some(ref=>!capKey(ref)||ref.sender!==m.sender||Date.parse(ref.sent)>=Date.parse(m.sent))){
   if(m.msgType==='Update')invalidUpdates.add(capKey(m));diagnostics.push({key:capKey(m),reason:refs.length?'invalid-reference':'missing-references'});continue;
  }
  for(const ref of refs)suppressed.add(capKey(ref));
 }
 return{active:sorted.filter(x=>!conflicts.has(capKey(x))&&x.msgType!=='Cancel'&&!invalidUpdates.has(capKey(x))&&!suppressed.has(capKey(x))),suppressed:[...suppressed],diagnostics};
}
