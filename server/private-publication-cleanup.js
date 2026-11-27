import { config } from './config.js';
import { store, sanitizePublicationCleanup } from './store.js';
// Scoped deletion only. A missing pin check or unconfirmed deletion keeps the ID for retry.
export async function deletePrivatePublicationCard(api, chat, mid) {
  if (!api || !Number.isSafeInteger(Number(chat)) || Number(chat) <= 0 || !Number.isSafeInteger(Number(mid)) || Number(mid) <= 0) return false;
  try {
    const info = await api.getChat(Number(chat));
    if (!info || info.pinned_message?.message_id === Number(mid)) return false;
    return await api.deleteMessage(Number(chat), Number(mid)) === true;
  } catch (error) {
    return /message to delete not found|message not found/i.test(String(error.description || error.message || ''));
  }
}

export async function cleanOrQueuePrivatePublicationCard(api, chat, mid) {
  if (!Number.isSafeInteger(Number(chat)) || Number(chat) <= 0 || !Number.isSafeInteger(Number(mid)) || Number(mid) <= 0) return false;
  if (await deletePrivatePublicationCard(api, chat, mid)) return true;
  const queue = store.state.publicationCleanup ||= [];
  if (!queue.some((row) => row.chat === Number(chat) && row.mid === Number(mid))) queue.push({ chat: Number(chat), mid: Number(mid), at: Date.now() });
  store.persist({ backupSoon: true });
  return false;
}
export async function retryPrivatePublicationCleanup(api) {
  const queue = sanitizePublicationCleanup(store.state.publicationCleanup);
  const batch = queue.slice(0, 30), remaining = [];
  for (const row of batch) if (!await deletePrivatePublicationCard(api, row.chat, row.mid)) remaining.push(row);
  const attempted = new Set(batch.map((row) => `${row.chat}:${row.mid}`));
  // Untouched intents go first, so pinned/unavailable cards cannot starve the
  // tail. Read current state again to retain intents added while awaiting API.
  const untouched = sanitizePublicationCleanup(store.state.publicationCleanup)
    .filter((row) => !attempted.has(`${row.chat}:${row.mid}`));
  store.state.publicationCleanup = [...untouched, ...remaining];
  if (queue.length) store.persist({ backupSoon: true });
}

export async function finalizeConfirmedPrivatePublication(api, chat, mid, alert) {
  if (alert?.channel_delivery?.status !== 'confirmed' || !alert.channel_message_id) return { confirmed: false, alertId: alert?.id || null, mayResend: false };
  if (store.backup && config.telegramBackup && !await store.flushBackup(true)) return { confirmed: true, backupConfirmed: false, alertId: alert.id, mayResend: false };
  await cleanOrQueuePrivatePublicationCard(api, chat, mid);
  return { confirmed: true, backupConfirmed: true, alertId: alert.id, mayResend: false };
}
