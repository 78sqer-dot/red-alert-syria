import crypto from 'node:crypto';
import { store } from './store.js';
let hooks = {};
export function configureReportOperator(next) { hooks = next; }
const revision = (r) => crypto.createHash('sha256').update(JSON.stringify([r.created, r.draft, r.verification || null, r.reviewOperation || null])).digest('hex');
const state = () => { store.state.reports ||= {}; store.state.reportsAudit ||= {}; return store.state; };
export function operatorReportsStatus() {
  const s = state();
  return { ready: Boolean(hooks.publish && hooks.ready?.()), pending_count: Object.values(s.reports).filter(r => !r.reviewOperation || r.reviewOperation.result === 'held').length,
    unresolved_count: Object.values(s.reports).filter(r => r.reviewOperation && !['held'].includes(r.reviewOperation.result)).length + Object.values(s.reportsAudit).filter(a => ['native-claimed', 'native-edit-staged', 'uncertain', 'map-only', 'terminal-backup-unverified'].includes(a.result)).length,
    ids: Object.keys(s.reports), unresolved_ids: Object.entries(s.reportsAudit).filter(([,a]) => ['native-claimed', 'native-edit-staged', 'uncertain', 'map-only', 'terminal-backup-unverified'].includes(a.result)).map(([id])=>id), handled_count: Object.keys(s.reportsDone || {}).length,
    contact: { route: 'native-admin-bot-reply-on-mapped-review-card', identity: 'Red Alert Syria reporting bot', universal_reachability: false, api_sending_enabled: false } };
}
export function operatorReportReview(id) {
  const s = state(), r = s.reports[id];
  if (!r) return s.reportsAudit[id] ? { id, status: 'handled', outcome: { result: s.reportsAudit[id].result, at: s.reportsAudit[id].at, alertId: s.reportsAudit[id].alertId || null, postId: s.reportsAudit[id].postId || null, draft: s.reportsAudit[id].draft || null } } : null;
  return { id, status: r.reviewOperation?.result || 'pending', revision: revision(r), created: r.created,
    draft: r.draft, verification: r.verification || null, operation: r.reviewOperation || null,
    reporter: { personal_identifiers_redacted: true, review_cards: (r.messages || []).length, bot_route_recorded: Boolean(r.via) },
    actions: r.reviewOperation && r.reviewOperation.result !== 'held' ? [] : ['hold', 'reject', 'publish'] };
}
async function durable() {
  store.persist();
  if (!store.backup || store._backupWritesPaused || !await store.flushBackup(true)) throw new Error('durable-backup-unavailable-no-send');
}
export async function operateReport(id, request = {}) {
  const s = state(), prior = s.reportsAudit[id];
  if (prior && request.revision && prior.revision === request.revision) return { ok: prior.result === 'published' || prior.result === 'rejected', reused: true, id, ...prior };
  const r = s.reports[id];
  if (!r) throw new Error('unknown-or-handled-report');
  if (store._backupWritesPaused || !store.backup) throw new Error('durable-backup-unavailable-no-send');
  if (r.reviewOperation && r.reviewOperation.result !== 'held') throw new Error('report-claimed-or-outcome-unresolved');
  if (!request.revision || request.revision !== revision(r)) throw new Error('stale-review');
  if (!['hold', 'reject', 'publish'].includes(request.action)) throw new Error('invalid-operation');
  const evidence = request.evidence;
  if (request.action === 'publish' && (!evidence || typeof evidence !== 'object' || evidence.checked !== true || typeof evidence.summary !== 'string' || !evidence.summary.trim() || evidence.summary.length > 2000 || !Array.isArray(evidence.sources) || !evidence.sources.length || evidence.sources.length > 10 || evidence.sources.some(u => typeof u !== 'string' || !/^https:\/\//.test(u) || u.length > 2000))) throw new Error('independent-verification-evidence-required');
  if (request.action === 'publish' && (!hooks.publish || !hooks.ready?.())) throw new Error('publisher-not-ready');
  const op = { revision: request.revision, at: Date.now(), actor: 'delegated-report-editor', result: request.action === 'hold' ? 'held' : 'claimed', action: request.action, ...(request.action === 'publish' ? { evidence } : {}) };
  r.reviewOperation = op;
  try { await durable(); } catch (e) { op.result = 'claim-backup-unverified'; store.persist(); throw e; }
  if (request.action === 'hold') return { ok: true, id, status: 'held', revision: revision(r) };
  if (request.action === 'publish') {
    let alert;
    try { alert = await hooks.publish(r); } catch { op.result = 'uncertain'; await durable(); throw new Error('publication-unverified-do-not-retry'); }
    if (!alert?.id) { op.result = 'uncertain'; await durable(); throw new Error('publication-unverified-do-not-retry'); }
    op.alertId = alert.id; op.postId = alert.channel_message_id || null;
    op.result = op.postId ? 'published' : 'map-only';
  } else op.result = 'rejected';
  s.reportsAudit[id] = { ...op }; (s.reportsDone ||= {})[id] = Date.now(); delete s.reports[id];
  try { await durable(); } catch { s.reportsAudit[id].result = 'terminal-backup-unverified'; store.persist(); throw new Error('terminal-backup-unverified-do-not-retry'); }
  await hooks.close?.(r).catch(() => {});
  return { ok: op.result !== 'map-only', id, status: op.result, alertId: op.alertId || null, postId: op.postId || null };
}
