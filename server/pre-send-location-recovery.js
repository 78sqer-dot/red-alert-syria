// A location guard rejected the attempt before publishInput, so no send began.
// Only the exact current claim may be released; uncertain/in-flight work cannot.
export async function releasePreSendLocationClaim({draft, error, persist, flush, restore, now=Date.now}) {
  if (error?.name !== 'MissingCardLocationError' || draft?.status !== 'publishing'
    || draft.nativeReview?.result !== 'claimed' || draft.alertId || draft.postId
    || draft.operatorReview) return {skipped:true};
  draft.status='pending';
  draft.nativeReview={at:now(),result:'pre-send-location-rejected'};
  draft.editorialHold=true;
  draft.editorialHoldReason=error.code === 'location-text-conflict' ? error.code : 'missing-location';
  draft.editorialHoldAt=now();
  persist();
  let durable=false;try{durable=!!await flush();}catch{}
  if(!durable)return {ok:false,state:'hold-backup-unverified'};
  // Do not restore actionable review controls if a newer action won the await.
  if(draft.status!=='pending'||draft.nativeReview?.result!=='pre-send-location-rejected'||draft.alertId||draft.postId)return {ok:false,state:'revision-conflict'};
  try{await restore();return {ok:true,state:'held-review-restored'};}
  catch{return {ok:false,state:'review-ui-unverified'};}
}
