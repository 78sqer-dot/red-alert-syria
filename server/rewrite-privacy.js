// Tier labels alone never establish provider privacy or owner permission.
// Real reports are held until a separately reviewed execution path exists.
export function rewritePrivacyDecision({dataClass='real-news',providerTier='unknown'}={}){
 if(dataClass==='synthetic-nonpersonal')return{allowed:true,reason:'synthetic-only',providerTier};
 return{allowed:false,reason:providerTier==='unpaid'?'unpaid-real-input-prohibited':providerTier==='paid'?'paid-scope-not-reviewed':'provider-tier-unverified',providerTier};
}
export function assertRewritePrivacy(options){const result=rewritePrivacyDecision(options);if(!result.allowed){const error=Error('Rewrite privacy routing blocked: '+result.reason);error.code='REWRITE_PRIVACY_BLOCKED';throw error;}return result;}
