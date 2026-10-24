// Resilient Telegram API calls (both bots).
//
// grammY waits up to 500 s for a single API call by default. When Telegram's Bot API is slow or
// answers 502/504 for a few minutes (seen on 25 Oct 2026, 00:15–00:20 Damascus time), every
// reply hung silently: the owner pressed /start and got nothing, with no error in the logs.
//
// This transformer (installed closest to the network) gives every call a short deadline and
// retries transient failures with a small backoff, so a reply arrives as soon as Telegram
// recovers instead of being lost:
//  • 429 Too Many Requests → wait retry_after (≤ 30 s) and retry.
//  • network errors / timeouts / 500–504 → retry, except when a retry could duplicate something
//    public or permanent: sends to the channel (or any non-private chat) and document uploads
//    (the pinned backup) are NOT re-sent after an ambiguous failure — Telegram sometimes
//    delivers a message even though it answered 504. Duplicate menus in a private chat are
//    harmless (the clean-chat layer removes old screens).
//  • answerCallbackQuery is never retried (a tap expires after ~15 s anyway).
const UPLOAD = new Set(['sendPhoto', 'sendDocument', 'sendVideo', 'sendAnimation', 'sendAudio', 'sendVoice',
  'sendMediaGroup', 'editMessageMedia', 'sendVideoNote', 'sendSticker']);
const SEND = /^(send|copyMessage|forwardMessage)/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isPrivate = (chat) => (typeof chat === 'number' ? chat > 0 : /^\d+$/.test(String(chat ?? '')));
const TRANSIENT = new Set([500, 502, 503, 504]);

// callMs/uploadMs: deadline of one attempt when a retry is safe. oneShotMs: calls that are never re-sent
// after an ambiguous failure (channel posts, backup upload) keep a long deadline, so a slow-but-successful
// post is not reported as failed (which would make an editor publish it twice).
export const NET = { callMs: 15_000, uploadMs: 45_000, oneShotMs: 120_000, callbackMs: 8_000, attempts: 4, backoff: [1000, 2500, 5000], maxTotalMs: 75_000 };

function ambiguousRetryAllowed(method, payload) {
  if (method === 'answerCallbackQuery') return false;
  if (method === 'sendDocument' || method === 'sendMediaGroup') return false; // backup / albums: no duplicates
  if (SEND.test(method)) return isPrivate(payload?.chat_id); // channel posts are never re-sent blindly
  return true; // edits, deletes, pins, getters: retrying is safe
}

export function installResilience(api, label = 'bot') {
  api.config.use(async (prev, method, payload, signal) => {
    if (method === 'getUpdates') return prev(method, payload, signal); // long polling has its own timeout
    const started = Date.now();
    const retryable = ambiguousRetryAllowed(method, payload);
    const limit = method === 'answerCallbackQuery' ? NET.callbackMs : !retryable ? NET.oneShotMs : UPLOAD.has(method) ? NET.uploadMs : NET.callMs;
    for (let attempt = 1; ; attempt++) {
      const left = retryable ? NET.maxTotalMs - (Date.now() - started) : limit;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), Math.max(3000, Math.min(limit, left)));
      if (timer.unref) timer.unref();
      const onOuter = () => ctl.abort();
      if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onOuter, { once: true }); }
      let res; let err;
      try { res = await prev(method, payload, ctl.signal); } catch (e) { err = e; } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onOuter);
      }
      if (signal?.aborted) { if (err) throw err; return res; } // caller cancelled (e.g. polling stop)
      const code = res && res.ok === false ? res.error_code : null;
      const last = attempt >= NET.attempts || Date.now() - started > NET.maxTotalMs - 2000;
      if (!err && code !== 429 && !TRANSIENT.has(code)) return res; // success or a real API error
      if (code === 429) {
        const wait = Math.min(30, Number(res.parameters?.retry_after) || 3) * 1000;
        if (last || Date.now() - started + wait > NET.maxTotalMs) return res;
        console.warn(`[${label}] ${method}: 429, retrying in ${wait / 1000}s`);
        await sleep(wait);
        continue;
      }
      // network error / timeout / 5xx: the call may or may not have reached Telegram
      const why = err ? (err.message || String(err)).slice(0, 120) : `${code} ${res.description || ''}`;
      if (last || !retryable) {
        console.warn(`[${label}] ${method} failed after ${attempt} attempt(s), ${Date.now() - started} ms: ${why}`);
        if (err) throw err;
        return res;
      }
      console.warn(`[${label}] ${method} attempt ${attempt} failed (${why}), retrying`);
      await sleep(NET.backoff[Math.min(attempt - 1, NET.backoff.length - 1)]);
    }
  });
}
