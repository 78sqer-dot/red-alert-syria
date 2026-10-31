// Track private-chat messages for safe, targeted cleanup when the user opens the menu.
// Only old bot messages are removed; user messages and explicitly kept cards stay untouched.
// Plain notices without buttons ("✅ done", "⚠️ wrong format") do not count as a new screen, so a
// prompt stays visible while the user retries.
// Kept: messages sent with `_keep: true` (pending report cards, relay conversation, the pinned
// backup), and the user's relay messages (ctx.ras.keepInput). Telegram only lets bots delete
// messages younger than 48 h: older bot messages are blanked by editing them instead.
import { AsyncLocalStorage } from 'node:async_hooks';
import { store } from './store.js';

const als = new AsyncLocalStorage();
const MAX_PER_CHAT = 80;
const DELETE_WINDOW = 47.5 * 3600_000;
const SEND = new Set(['sendMessage', 'sendPhoto', 'sendDocument', 'sendVideo', 'sendAnimation', 'sendVoice',
  'sendAudio', 'sendSticker', 'sendVideoNote', 'sendMediaGroup', 'copyMessage', 'sendLocation', 'sendContact']);
const EDIT = new Set(['editMessageText', 'editMessageCaption', 'editMessageMedia', 'editMessageReplyMarkup']);
const MEDIA = new Set(['sendPhoto', 'sendDocument', 'sendVideo', 'sendAnimation', 'sendVoice', 'sendAudio', 'sendMediaGroup', 'copyMessage']);
let seq = Date.now(); // monotonic order of sends/edits across all chats
const next = () => ++seq;

const privId = (chat) => (typeof chat === 'number' && chat > 0 ? chat : (/^\d+$/.test(String(chat ?? '')) ? Number(chat) : null));
function bucket(role, chat, create = true) {
  const ui = store.state.ui || (store.state.ui = {});
  const k = `${role}:${chat}`;
  if (!ui[k] && create) ui[k] = [];
  return ui[k];
}
let saveT = null;
function save() { // local file now; included in the next Telegram backup (and the one taken on shutdown)
  if (saveT) return;
  saveT = setTimeout(() => { saveT = null; store.persist({ backupSoon: false }); }, 1500);
  if (saveT.unref) saveT.unref();
}
function add(role, chat, item) {
  const list = bucket(role, chat);
  if (list.some((x) => x.id === item.id)) return;
  list.push(item);
  if (list.length > MAX_PER_CHAT) list.splice(0, list.length - MAX_PER_CHAT); // forgotten, never wrong-deleted
  save();
}
function touch(role, chat, id) {
  const list = bucket(role, chat, false);
  const it = list && list.find((x) => x.id === id);
  if (it) { it.s = next(); it.c = 1; save(); }
}
function forget(role, chat, ids) {
  const list = bucket(role, chat, false);
  if (!list) return;
  const set = new Set(ids);
  const before = list.length;
  for (let i = list.length - 1; i >= 0; i--) if (set.has(list[i].id)) list.splice(i, 1);
  if (!list.length) delete store.state.ui[`${role}:${chat}`];
  if (list.length !== before) save();
}
const isScreen = (method, p) => {
  if (MEDIA.has(method)) return true;
  if (method !== 'sendMessage') return false;
  const rm = p?.reply_markup;
  return !!(rm && ((rm.inline_keyboard && rm.inline_keyboard.length) || rm.keyboard));
};

/** Install on a bot's Api (both bots, and any bot swapped in later). */
export function installTracker(api, role) {
  api.config.use(async (prev, method, payload, signal) => {
    let keep = false;
    if (payload && payload._keep) { keep = true; payload = { ...payload }; delete payload._keep; }
    const res = await prev(method, payload, signal);
    try {
      if (!res || res.ok === false) return res;
      const chat = privId(payload?.chat_id);
      if (chat == null) return res;
      const cur = als.getStore();
      const here = cur && cur.role === role && cur.chat === chat;
      if (SEND.has(method)) {
        const r = res.result;
        const ids = Array.isArray(r) ? r.map((m) => m.message_id) : (r && r.message_id ? [r.message_id] : []);
        const now = Date.now();
        const scr = isScreen(method, payload);
        for (const id of ids) add(role, chat, { id, t: now, s: next(), m: MEDIA.has(method) ? 1 : 0, ...(scr ? { c: 1 } : {}), ...(keep ? { k: keep === true ? 'r' : keep } : {}) });
        if (here && !keep && scr) cur.screen = true;
      } else if (EDIT.has(method) && payload.message_id) {
        touch(role, chat, payload.message_id);
        if (here) cur.screen = true;
      } else if (method === 'deleteMessage') {
        forget(role, chat, [payload.message_id]);
      } else if (method === 'deleteMessages') {
        forget(role, chat, payload.message_ids || []);
      }
    } catch { /* tracking must never break a send */ }
    return res;
  });
}

/** Mark an already-sent message as kept (or no longer kept). */
export function setKeep(role, chat, id, keep = true) {
  const list = bucket(role, chat, false);
  const it = list && list.find((x) => x.id === id);
  if (it) { if (keep) it.k = 1; else delete it.k; save(); }
}

async function sweep(api, role, chat, before, softOnly = false, include = () => true) {
  const list = bucket(role, chat, false);
  if (!list) return 0;
  const old = list.filter((x) => x.s < before && !x.k && (!softOnly || x.u || !x.c) && include(x));
  if (!old.length) return 0;
  const now = Date.now();
  const fresh = old.filter((x) => now - x.t < DELETE_WINDOW).map((x) => x.id);
  const stale = old.filter((x) => now - x.t >= DELETE_WINDOW);
  const done = new Set();
  for (let i = 0; i < fresh.length; i += 100) {
    const part = fresh.slice(i, i + 100);
    try { await api.deleteMessages(chat, part); part.forEach((id) => done.add(id)); } catch {
      for (const id of part) { try { await api.deleteMessage(chat, id); } catch { /* gone already / too old */ } done.add(id); }
    }
  }
  for (const x of stale) { // older than 48 h: Telegram refuses deletion — blank it instead
    try { await api.deleteMessage(chat, x.id); } catch {
      if (!x.u) {
        try {
          if (x.m) await api.editMessageCaption(chat, x.id, { caption: '▫️', reply_markup: { inline_keyboard: [] } });
          else await api.editMessageText(chat, x.id, '▫️', { reply_markup: { inline_keyboard: [] } });
        } catch { /* ignore */ }
      }
    }
    done.add(x.id);
  }
  forget(role, chat, [...done]);
  return done.size;
}

/** Remove prior non-kept bot messages in private chats, preserving the current and pinned messages. */
export async function cleanMenuMessages(api, role, chat, preserveId = null) {
  const id = privId(chat);
  if (id == null || typeof api?.getChat !== 'function') return 0;
  let pinnedId = null;
  try { pinnedId = Number((await api.getChat(id))?.pinned_message?.message_id) || null; }
  catch { return 0; } // fail closed: never delete screens if we cannot check the pinned message
  return sweep(api, role, id, Infinity, false, (x) => !x.u && x.id !== preserveId && x.id !== pinnedId);
}

/** Middleware: wraps every update of a private chat. */
export function cleanChat(role) {
  return async (ctx, nextMw) => {
    const chat = ctx.chat?.type === 'private' ? ctx.chat.id : null;
    if (chat == null) return nextMw();
    const st = { role, chat, start: next(), screen: false };
    try {
      await als.run(st, () => nextMw());
    } finally {
      try {
        const msg = ctx.message;
        // Ordinary navigation is untouched; menu handlers explicitly clean only old bot screens.
        if (msg && !ctx.ras?.keepInput) add(role, chat, { id: msg.message_id, t: (msg.date || 0) * 1000 || Date.now(), s: st.start - 0.5, u: 1 });
      } catch (e) { console.warn('[ui] clean failed', e.description || e.message); }
    }
  };
}

/** Delete everything tracked in a chat right now (e.g. after a hand-over). */
export async function wipeChat(api, role, chat) {
  return sweep(api, role, chat, Infinity);
}
export const _test = { als, bucket };
