import crypto from 'node:crypto';
import { config } from './config.js';
import { store } from './store.js';
import { damascusDate, isApplicationDeadlineExpired } from './application-deadline.js';
import { jobsState, decideJob, effectiveJobDeadline, closedJobApplication, isPublicJobEligible, normalizeJobLocation, publicJobs, closeJobReviewCards } from './jobs.js';

const ready = () => !store.backup || !store._backupWritesPaused;
const fail = (message) => { throw new Error(message); };
function revision(job, now) {
  return crypto.createHash('sha256').update(JSON.stringify({
    day: damascusDate(now), id: job.id, kind: job.kind, status: job.status, sourceKey: job.sourceKey,
    fingerprint: job.fingerprint, sourceName: job.sourceName, sourceUrl: job.sourceUrl,
    title: job.title, text: job.text, links: job.links, location: job.location,
    deadline: job.applicationDeadline, override: job.applicationDeadlineOverride, updatedAt: job.updatedAt, metadataRevision: job.metadataRevision, publicReviewHold: job.publicReviewHold,
  })).digest('hex');
}
function duplicateOf(job, j) {
  return Object.values(j.published).find((other) => other && other.id !== job.id && other.status === 'approved' && !j.deleted[other.id]
    && ((job.sourceKey && other.sourceKey === job.sourceKey) || (job.fingerprint && other.fingerprint === job.fingerprint)))?.id || null;
}
export function operatorJobsStatus(now = Date.now()) {
  const j = jobsState();
  const pending = Object.values(j.pending).filter((job) => job?.kind === 'source' && job.status === 'pending' && !j.deleted[job.id])
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const approved = Object.values(j.published).filter((job) => job?.status === 'approved' && !j.deleted[job.id]);
  return {
    decision_writes_ready: ready(), pending_count: pending.length,
    other_pending_count: Object.values(j.pending).filter((job) => job?.kind !== 'source').length,
    stored_approved_count: approved.length, eligible_approved_count: approved.filter((job) => isPublicJobEligible(job, j, now)).length,
    expired_approved_count: approved.filter((job) => isApplicationDeadlineExpired(effectiveJobDeadline(job), now)).length,
    closed_application_count: approved.filter(closedJobApplication).length,
    quarantined_approved_count: approved.filter(job => job.publicReviewHold?.active === true).length,
    public_feed_count: publicJobs(j, now).length,
    items: pending.map((job) => ({ id: job.id, revision: revision(job, now), title: job.title, createdAt: job.createdAt })),
  };
}
export function operatorJobReview(id, now = Date.now()) {
  if (!/^[a-f0-9]{14}$/u.test(String(id))) return null;
  const j = jobsState(), job = j.pending[id] || j.published[id], decision = j.decisions[id];
  if (!job && !decision) return null;
  if (!job) return { id, status: decision.action, revision: null, operation: decision.operatorReview || null, decision, metadata_reviews: j.metadataAudits[id] || [] };
  const deadline = effectiveJobDeadline(job), duplicate = duplicateOf(job, j), issues = [];
  if (job.kind !== 'source') issues.push('outside-monitored-job-scope');
  if (isApplicationDeadlineExpired(deadline, now)) issues.push('application-deadline-expired');
  if (closedJobApplication(job)) issues.push('application-link-closed');
  if (duplicate) issues.push('duplicate-listing');
  if (j.deleted[id]) issues.push('listing-deleted');
  return {
    id, status: job.status, revision: revision(job, now), kind: job.kind, createdAt: job.createdAt,
    warnings: deadline ? [] : ['deadline-not-established-from-source-or-explicitly-cleared'],
    source: { key: job.sourceKey, name: job.sourceName, url: job.sourceUrl },
    title: job.title, text: job.text, links: job.links || [],
    location: normalizeJobLocation(job.location, j) || null,
    application_deadline: deadline, deadline_override: job.applicationDeadlineOverride === true,
    issues, duplicateOf: duplicate, operation: decision?.operatorReview || null,
    metadata_revision: job.metadataRevision || null, metadata_reviews: j.metadataAudits[id] || [],
    public_quarantine: job.publicReviewHold || null,
    metadata_actions: job.kind === 'source' && ['pending', 'approved'].includes(job.status) && !j.deleted[id] && (!decision || decision.action === 'approved') ? ['revise_metadata'] : [],
    actions: job.kind === 'source' && job.status === 'pending' && !j.deleted[id]
      ? ['ignore', ...(!issues.length ? [normalizeJobLocation(job.location, j) ? 'approve' : 'approve_without_location'] : [])] : [],
  };
}

// This only changes the Jobs listing state. No news incident or public Telegram
// message is created. The already-running monitor owns the backing store and bot.
export async function operateJobDraft(id, request = {}, now = Date.now()) {
  if (!ready()) return fail('backup-recovery-in-progress-no-decision-written');
  if (!['approve', 'approve_without_location', 'ignore'].includes(request.action)) return fail('invalid-operation');
  if (!/^[a-f0-9]{14}$/u.test(String(id))) return fail('unknown-listing');
  if (store.backup && config.telegramBackup) {
    const merged = await store.mergeFromBackup();
    if (merged?.backupLoaded !== true) return fail('latest-backup-unverified-no-decision-written');
  }
  if (!ready()) return fail('backup-recovery-in-progress-no-decision-written');
  const j = jobsState(), prior = j.decisions[id]?.operatorReview;
  if (prior && prior.revision === request.revision && prior.action === request.action) {
    return { ok: !prior.result.endsWith('-backup-unverified'), reused: true, id, status: prior.result,
      visible: publicJobs(j, now).some((job) => job.id === id), telegram_publication: false };
  }
  const job = j.pending[id];
  if (!job) return fail(j.decisions[id] ? 'listing-already-handled' : 'unknown-listing');
  if (job.status !== 'pending' || j.deleted[id] || j.decisions[id]) return fail('listing-already-handled');
  if (job.kind !== 'source') return fail('outside-monitored-job-scope');
  if (!request.revision || request.revision !== revision(job, now)) return fail('stale-review');
  const review = operatorJobReview(id, now);
  if (request.action !== 'ignore' && review.issues.length) return fail(review.issues[0]);
  const result = decideJob(id, request.action, j, null, now);
  if (!result.ok) return fail(result.error || 'listing-already-handled');
  const operation = { revision: request.revision, action: request.action, at: now, result: result.job.status, by: 'delegated-listings-operator' };
  result.job.reviewedBy = { kind: 'delegated-listings-operator', at: now };
  j.decisions[id].operatorReview = operation;
  if (request.action === 'ignore') {
    // Approval rows already retain their full source audit in published[id].
    j.decisions[id].reviewedSource = { title: job.title, text: job.text, sourceKey: job.sourceKey, sourceUrl: job.sourceUrl, links: job.links || [] };
  }
  store.persist({ backupSoon: true });
  if (store.backup && !await store.flushBackup(true)) {
    operation.result += '-backup-unverified';
    store.persist({ backupSoon: true });
    return { ok: false, id, status: operation.result, telegram_publication: false };
  }
  store.emit('jobs', publicJobs(j, now));
  await closeJobReviewCards(result.job);
  return { ok: true, id, status: operation.result, visible: publicJobs(j, now).some((row) => row.id === id), telegram_publication: false };
}
