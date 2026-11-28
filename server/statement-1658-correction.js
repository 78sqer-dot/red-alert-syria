import { publishedRepairRevision } from './approved-public-correction.js';
export const STATEMENT_1658_ID = '124cf7d4-0dc6-4f04-9940-01cd45c3b7f9';
export const STATEMENT_1658_KEY = 'statement-1658-2026-11-28';
const EXPECTED = 'c9123ece3badfdedab2f4f16ea02db7e1444c19686d459ff2240da8ce3b0ace0';
export function statement1658Candidate(a, d) {
  if (!a || a.id !== STATEMENT_1658_ID || a.channel_message_id !== 1658 || publishedRepairRevision(a) !== EXPECTED
    || a.channel_delivery?.status !== 'confirmed' || a.channel_media !== 'photo'
    || d?.id !== '167d753de7' || d.status !== 'published' || d.alertId !== a.id || d.postId !== 1658
    || d.sourceText !== a.meta?.sourceText || !d.srcs?.some(s => s.url === 'https://t.me/HawarNews/86522')) return null;
  return { ...a, type: 'political', title: 'تصريح — السويداء', title_en: 'Statement — As-Suwayda',
    meta: { ...a.meta, political: { category: 'statement', sources: a.meta.newsSources } } };
}
// One exact existing post, with a durable claim before the sole media edit.
// An interrupted/uncertain edit must be inspected, never automatically repeated.
export async function runStatement1658Correction({ store, editExisting }) {
  const prior = store.state.maint?.[STATEMENT_1658_KEY];
  if (prior) return { skipped: true, state: prior.state };
  const a = store.getAlert(STATEMENT_1658_ID), d = store.state.news?.drafts?.['167d753de7'];
  const b = statement1658Candidate(a, d);
  if (!b) return { skipped: true, reason: 'exact-revision-guard' };
  const durable = async () => { store.persist(); store._backupPending = true; return store.backup ? await store.flushBackup(true) : false; };
  const marker = { state: 'claimed', at: new Date().toISOString(), post: 1658, expected: EXPECTED };
  (store.state.maint ||= {})[STATEMENT_1658_KEY] = marker;
  if (!await durable()) return { ok: false, state: 'claim-backup-unverified' };
  // Recheck after awaiting backup so a concurrent change cannot be overwritten.
  if (!statement1658Candidate(store.getAlert(STATEMENT_1658_ID), store.state.news?.drafts?.['167d753de7'])) {
    marker.state = 'revision-conflict'; await durable(); return { ok: false, state: marker.state };
  }
  try { await editExisting(b); }
  catch { marker.state = 'edit-uncertain'; await durable(); return { ok: false, state: marker.state }; }
  store.updateAlert(a.id, { type: b.type, title: b.title, title_en: b.title_en, meta: b.meta });
  store._logPatch(a.id, { ty: 'political' });
  d.type = 'political'; d.politicalCategory = 'statement'; d.politicalNeedsCategory = false;
  const cached = store.state.news?.alerts?.find(x => x.id === a.id);
  if (cached) { cached.type = 'political'; cached.politicalCategory = 'statement'; cached.headline = [b.title, b.description].filter(Boolean).join(' '); }
  marker.state = 'done'; marker.done = new Date().toISOString();
  if (!await durable()) return { ok: false, state: 'final-backup-unverified', post: 1658 };
  return { ok: true, state: 'done', post: 1658, id: a.id };
}
