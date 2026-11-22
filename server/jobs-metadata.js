import crypto from 'node:crypto';
import {config} from './config.js';
import {store} from './store.js';
import {jobsState, effectiveJobDeadline, publicJobs} from './jobs.js';
import {operatorJobReview} from './jobs-operator.js';
import {normalizeApplicationDeadline} from './application-deadline.js';
import {jobApplicationLinks, jobApplicationLinksFromText, normalizeJobApplicationLink} from '../shared/job-links.js';
const fail=message=>{throw new Error(message)};
const ready=()=>!store.backup||!store._backupWritesPaused;
function normalizedRequest(input) {
  if (!input || typeof input!=='object' || Array.isArray(input)) return fail('invalid-metadata-request');
  if (Object.keys(input).some(key=>!['revision','links','application_deadline','public_quarantine','evidence','reason'].includes(key))) return fail('invalid-metadata-field');
  if (!/^[a-f0-9]{64}$/u.test(String(input.revision||''))) return fail('stale-review');
  if (typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500||/[\u0000-\u001f\u007f]/u.test(input.reason)) return fail('metadata-reason-required');
  const hasLinks=input.links!==undefined,hasDeadline=input.application_deadline!==undefined,hasQuarantine=input.public_quarantine!==undefined;
  if (!hasLinks&&!hasDeadline&&!hasQuarantine) return fail('empty-metadata-patch');
  const out={revision:input.revision,reason:input.reason.trim()};
  if (hasQuarantine) {if(typeof input.public_quarantine!=='boolean')return fail('invalid-public-quarantine');out.public_quarantine=input.public_quarantine;}
  if (hasLinks) {
    if (!Array.isArray(input.links)||input.links.length<1||input.links.length>8||input.links.some(link=>typeof link!=='string')) return fail('invalid-application-links');
    const normalized=input.links.map(normalizeJobApplicationLink),links=jobApplicationLinks(input.links);
    if (normalized.some(link=>!link)||links.length!==input.links.length) return fail('invalid-application-links');
    out.links=links;
  }
  if (hasDeadline) {
    const value=normalizeApplicationDeadline(input.application_deadline);
    if (!value) return fail('valid-application-deadline-required');
    out.application_deadline=value;
  }
  if (!Array.isArray(input.evidence)||!input.evidence.length||input.evidence.length>8) return fail('metadata-evidence-required');
  out.evidence=input.evidence.map(e=>{
    if (!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).some(key=>!['url','checked_at','application_deadline'].includes(key))) return fail('invalid-metadata-evidence');
    const url=normalizeJobApplicationLink(e.url),timestamp=Date.parse(e.checked_at);
    if (!url||typeof e.checked_at!=='string'||!/(?:Z|[+-]\d\d:\d\d)$/u.test(e.checked_at)||!Number.isFinite(timestamp)) return fail('invalid-metadata-evidence');
    const row={url,checked_at:new Date(timestamp).toISOString()};
    if (e.application_deadline!==undefined) { const d=normalizeApplicationDeadline(e.application_deadline);if(!d)return fail('invalid-evidence-deadline');row.application_deadline=d; }
    return row;
  });
  if (new Set(out.evidence.map(e=>e.url)).size!==out.evidence.length) return fail('duplicate-metadata-evidence');
  return out;
}

// Monitored listings only. Metadata/quarantine never approves, deletes, resets
// a terminal decision, changes source text/location, or creates a Telegram post.
export async function reviseJobMetadata(id,input={},now=Date.now()) {
  if (!ready()) return fail('backup-recovery-in-progress-no-metadata-written');
  if (!/^[a-f0-9]{14}$/u.test(String(id))) return fail('unknown-listing');
  const request=normalizedRequest(input),operationId=crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
  if (store.backup&&config.telegramBackup) {
    const merged=await store.mergeFromBackup();
    if (merged?.backupLoaded!==true) return fail('latest-backup-unverified-no-metadata-written');
  }
  if (!ready()) return fail('backup-recovery-in-progress-no-metadata-written');
  const j=jobsState(),prior=(j.metadataAudits[id]||[]).find(event=>event.id===operationId);
  if (prior) return {ok:prior.result==='metadata-saved',reused:true,id,status:prior.result,operation_id:operationId,telegram_publication:false,public_change:prior.public_change===true};
  const job=j.pending[id]||j.published[id];
  if (!job||!['pending','approved'].includes(job.status)||j.deleted[id]||(j.decisions[id]&&j.decisions[id].action!=='approved')) return fail('listing-not-repairable');
  if (request.public_quarantine!==undefined&&job.status!=='approved')return fail('quarantine-requires-approved-listing');
  if (request.public_quarantine===false&&job.publicReviewHold?.active!==true)return fail('listing-not-quarantined');
  if (job.kind!=='source') return fail('outside-monitored-job-scope');
  if (operatorJobReview(id,now)?.revision!==request.revision) return fail('stale-review');
  const candidates=new Set([job.sourceUrl,...(job.links||[]),...jobApplicationLinksFromText(job.text)].map(normalizeJobApplicationLink).filter(Boolean));
  for (const e of request.evidence) {
    if (!candidates.has(e.url)) return fail('evidence-not-in-current-source');
    const checked=Date.parse(e.checked_at);
    if (checked>now+300000||checked<now-86400000) return fail('metadata-evidence-not-fresh');
  }
  if (request.links?.some(link=>!candidates.has(link)||!request.evidence.some(e=>e.url===link))) return fail('application-link-evidence-required');
  if (request.application_deadline&&!request.evidence.some(e=>e.application_deadline===request.application_deadline)) return fail('deadline-evidence-required');
  if (request.application_deadline&&request.evidence.some(e=>e.application_deadline&&e.application_deadline!==request.application_deadline))return fail('conflicting-deadline-evidence');
  const currentDeadline=effectiveJobDeadline(job);
  if(request.application_deadline&&currentDeadline&&currentDeadline!==request.application_deadline)return fail('known-deadline-conflict');
  const publicBefore=JSON.stringify(publicJobs(j,now).find(row=>row.id===id)||null);
  const before={links:[...(job.links||[])],stored_deadline:job.applicationDeadline||null,effective_deadline:effectiveJobDeadline(job),deadline_override:job.applicationDeadlineOverride===true,metadata_revision:job.metadataRevision||null,public_quarantine:job.publicReviewHold||null};
  if (request.links) job.links=[...request.links];
  if (request.application_deadline) {job.applicationDeadline=request.application_deadline;job.applicationDeadlineOverride=true;}
  else job.applicationDeadlineOverride??=false; // A links-only edit must not clear an inferred date.
  if(request.public_quarantine!==undefined)job.publicReviewHold={active:request.public_quarantine,at:now,reason:request.reason,operation_id:operationId};
  job.metadataRevision=operationId;job.updatedAt=Math.max(now,Number(job.updatedAt||0)+1);
  const publicChange=publicBefore!==JSON.stringify(publicJobs(j,now).find(row=>row.id===id)||null);
  const audit={id:operationId,at:now,by:'delegated-listings-operator',request_revision:request.revision,source:{key:job.sourceKey,url:job.sourceUrl,fingerprint:job.fingerprint,text_sha256:crypto.createHash('sha256').update(job.text).digest('hex')},before,after:{links:[...(job.links||[])],stored_deadline:job.applicationDeadline||null,effective_deadline:effectiveJobDeadline(job),deadline_override:job.applicationDeadlineOverride===true,public_quarantine:job.publicReviewHold||null},reason:request.reason,evidence:request.evidence,public_change:publicChange,result:'metadata-saved'};
  (j.metadataAudits[id]||=[]).push(audit);
  store.persist({backupSoon:true});
  if (store.backup&&!await store.flushBackup(true)) {
    audit.result='metadata-backup-unverified';store.persist({backupSoon:true});
    return {ok:false,id,status:audit.result,operation_id:operationId,telegram_publication:false,public_change:publicChange};
  }
  if(publicChange)store.emit('jobs',publicJobs(j,now));
  return {ok:true,id,status:audit.result,operation_id:operationId,revision:operatorJobReview(id,now).revision,telegram_publication:false,public_change:publicChange};
}
