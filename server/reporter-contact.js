import crypto from 'node:crypto';
import { store } from './store.js';
let sender = null;
export function configureReporterContact(fn) { sender = fn; }
const contacts = () => (store.state.reportContacts ||= {});
const revision = r => crypto.createHash('sha256').update(JSON.stringify([r.created, r.draft, r.reviewOperation || null])).digest('hex');
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
async function save() {
  store.persist();
  if (!store.backup || store._backupWritesPaused || !await store.flushBackup(true)) throw new Error('contact-backup-unverified-do-not-retry');
}
export function reporterContactReview(id) {
  const r = store.state.reports?.[id]; if (!r) return null;
  const c = contacts()[id];
  return { id, revision: revision(r), available: Boolean(sender && r.via === 'report' && r.from?.id && !store.isBanned(r.from.id)),
    identity: 'Red Alert Syria reporting bot', outbound: c?.outbound || [], replies: c?.replies || [], untrusted_reporter_content: true,
    media_note: 'Media attachments are not downloaded or authenticated by this interface. Inspect through the native mapped bot thread if necessary.' };
}
export async function sendReporterQuestion(id, request = {}) {
  const r = store.state.reports?.[id]; if (!r) throw new Error('unknown-or-handled-report');
  if (!store.backup || store._backupWritesPaused) throw new Error('durable-backup-unavailable-no-send');
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(request.key || '')) throw new Error('invalid-idempotency-key');
  const text = request.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('invalid-question-text');
  const all = contacts(), c = (all[id] ||= { reporter: r.from?.id, outbound: [], replies: [] });
  const prior = c.outbound.find(m => m.key === request.key);
  if (prior) {
    if (prior.digest !== digest(text)) throw new Error('idempotency-key-content-mismatch');
    return { ok: prior.status === 'sent', reused: true, id, status: prior.status };
  }
  if (!request.revision || request.revision !== revision(r)) throw new Error('stale-review');
  if (r.reviewOperation && r.reviewOperation.result !== 'held') throw new Error('report-already-claimed');
  if (!sender || r.via !== 'report' || !r.from?.id || store.isBanned(r.from.id)) throw new Error('reporter-route-unavailable');
  if (Object.entries(all).some(([other,x]) => other !== id && x.reporter === r.from.id && x.outbound.some(m => ['claimed','sent','uncertain','backup-unverified'].includes(m.status)) && store.state.reports?.[other])) throw new Error('another-active-report-conversation-use-native-thread');
  if (c.outbound.some(m => ['claimed','uncertain','backup-unverified'].includes(m.status))) throw new Error('previous-send-unresolved');
  if (c.outbound.length >= 5 || c.outbound.some(m => Date.now() - m.at < 60_000)) throw new Error('verification-question-limit');
  const intent = { key: request.key, digest: digest(text), text, at: Date.now(), status: 'claimed' };
  c.outbound.push(intent);
  try { await save(); } catch (e) { intent.status = 'backup-unverified'; store.persist(); throw e; }
  try {
    const message = await sender(r.from.id, text);
    if (!message?.message_id) throw new Error('no-message-receipt');
    intent.messageId = message.message_id; intent.status = 'sent';
    // The mapping stays inside the private state and is never supplied by the caller.
    store.openThread(r.from.id);
  } catch { intent.status = 'uncertain'; await save(); throw new Error('reporter-send-unverified-do-not-retry'); }
  try { await save(); } catch(e) { intent.status='backup-unverified'; store.persist(); throw e; }
  return { ok: true, id, status: 'sent' };
}
export async function captureReporterReply(message) {
  if (!message?.from?.id || message.chat?.type !== 'private' || message.from.is_bot || message.text?.startsWith('/')) return false;
  const uid = message.from.id, replyId = message.reply_to_message?.message_id;
  const candidates = Object.entries(contacts()).filter(([id,c]) => c.reporter === uid && store.state.reports?.[id] && c.outbound.some(m => ['sent','claimed','uncertain','backup-unverified'].includes(m.status)));
  const exact = replyId ? candidates.filter(([,c]) => c.outbound.some(m => m.messageId === replyId)) : [];
  const selected = exact.length === 1 ? exact : (!replyId && candidates.length === 1 ? candidates : []);
  if (selected.length !== 1) return false;
  const [id,c] = selected[0];
  if (c.replies.some(m => m.messageId === message.message_id)) { await save(); return true; }
  if (c.replies.length >= 50) return false;
  c.replies.push({ messageId: message.message_id, at: (message.date || Math.floor(Date.now()/1000))*1000,
    text: String(message.text || message.caption || '').slice(0,10000), hasMedia: Boolean(message.photo || message.video || message.document || message.voice || message.audio),
    hasLocation: Boolean(message.location), ...(message.location ? { location: { latitude: message.location.latitude, longitude: message.location.longitude } } : {}) });
  await save(); return true;
}
