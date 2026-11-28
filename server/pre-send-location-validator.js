import {ensureDraftCardLocation,ensureBuiltAlertLocation} from './publish-location-guard.js';
// Read-only validator. Both stages operate solely on a caller-owned clone.
export function preSendLocationRejection(draft,{convert,build}){
  const converted=convert(structuredClone(draft));
  const first=ensureDraftCardLocation(converted);
  if(first.action==='held')return first.reason;
  const input=build(converted,{id:8270709633,via:'news'});
  const final=ensureBuiltAlertLocation(input,converted);
  return final.action==='held'?final.reason:null;
}
