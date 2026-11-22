// Private, bounded project-editor coordination. Not part of the public API.
export function configureCoordination(state, input, permittedIds, now = Date.now()) {
  const until = Date.parse(input?.until);
  if (!Number.isFinite(until) || until <= now || until > now + 7 * 86400000) throw Error('invalid coordination expiry');
  if (!Array.isArray(input?.chats) || input.chats.length < 1 || input.chats.length > 10) throw Error('invalid coordination chats');
  const allowed = new Set(permittedIds.map(Number));
  const chats = input.chats.map((chat) => {
    const chatId = Number(chat.chatId);
    const messageIds = [...new Set((chat.messageIds || []).map(Number))];
    if (!allowed.has(chatId) || messageIds.length < 1 || messageIds.length > 20 || messageIds.some((id) => !Number.isSafeInteger(id) || id < 1)) throw Error('unknown coordination route');
    return { chatId, messageIds };
  });
  if (new Set(chats.map((c) => c.chatId)).size !== chats.length) throw Error('duplicate coordination chat');
  const previous = state.news?.coordination?.replies || [];
  const coordination = { configuredAt: new Date(now).toISOString(), until: new Date(until).toISOString(), chats, replies: previous.filter((r) => chats.some((c) => c.chatId === r.chatId)).slice(-100) };
  (state.news ||= {}).coordination = coordination;
  return coordination;
}

export function captureCoordinationReply(state, message, now = Date.now()) {
  const cfg = state.news?.coordination;
  if (!cfg || !(Date.parse(cfg.until) > now) || message.chatId !== message.fromId) return null;
  const route = cfg.chats?.find((c) => c.chatId === message.chatId);
  const text = String(message.text || '').trim();
  if (!route || !text || text.startsWith('/')) return null;
  const threadMatch = route.messageIds.includes(message.replyTo);
  const editor = state.editors?.includes(message.fromId);
  // The owner's unrelated messages can contain settings or credentials.
  if (!threadMatch && (!editor || message.inDraft)) return null;
  const replies = cfg.replies ||= [];
  if (replies.some((r) => r.chatId === message.chatId && r.messageId === message.messageId)) return { duplicate: true, threadMatch };
  const safeText = text.replace(/\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g, '[redacted bot credential]');
  const reply = { chatId: message.chatId, messageId: message.messageId, replyTo: message.replyTo || null, at: new Date(now).toISOString(), text: safeText.slice(0, 5000), threadMatch };
  replies.push(reply);
  if (replies.length > 100) replies.splice(0, replies.length - 100);
  return reply;
}

export function mergeCoordination(local, remote) {
  if (!local && !remote) return undefined;
  const latest = !local ? remote : !remote ? local : Date.parse(remote.configuredAt || 0) > Date.parse(local.configuredAt || 0) ? remote : local;
  const routes = new Set((latest.chats || []).map((c) => c.chatId));
  const unique = new Map();
  for (const reply of [...(local?.replies || []), ...(remote?.replies || [])]) {
    if (routes.has(reply.chatId)) unique.set(`${reply.chatId}:${reply.messageId}`, reply);
  }
  return { ...latest, replies: [...unique.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-100) };
}
