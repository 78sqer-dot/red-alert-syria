// News monitor self-test: real channel pages + real Gemini, FAKE Telegram API (nothing is sent anywhere).
//   GEMINI_API_KEY=... node scripts/news-selftest.mjs
process.env.DATA_DIR = '/tmp/news-e2e-data';
process.env.TELEGRAM_BACKUP = 'false';
process.env.NEWS_MAX_AGE_MIN = process.env.NEWS_MAX_AGE_MIN || '720';
process.env.NEWS_AI_MIN_GAP_MS = '0';
process.env.OWNER_IDS = '8270709633';
const fs = await import('node:fs');
fs.rmSync('/tmp/news-e2e-data', { recursive: true, force: true }); fs.mkdirSync('/tmp/news-e2e-data', { recursive: true });
const { createBot } = await import('../server/bot.js');
const { store } = await import('../server/store.js');
const M = await import('../server/news-monitor.js');
const sent = [];
let mid = 1000;
const bot = createBot({ role: 'admin', token: '123456:FAKE_TOKEN_FOR_LOCAL_TEST' });
bot.botInfo = { id: 123456, is_bot: true, first_name: 'Red Alert Syria', username: 'Red_Alert_Syria_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false };
bot.api.config.use(async (prev, method, payload) => {
  sent.push({ method, payload });
  const chat = { id: payload.chat_id, type: 'private' };
  if (['sendMessage', 'sendPhoto'].includes(method)) return { ok: true, result: { message_id: ++mid, date: 0, chat, text: payload.text || payload.caption } };
  if (method === 'editMessageText') return { ok: true, result: { message_id: payload.message_id, date: 0, chat, text: payload.text } };
  return { ok: true, result: true };
});
await bot.init?.().catch(() => {});
const n = M.newsState();
console.log('sources:', n.sources.map((s) => s.u).join(', '));
// baseline then replay the last 6 posts of each channel
await M._test.pollOnce();
for (const u of Object.keys(n.last)) n.last[u] = n.last[u] - 6;
const t0 = Date.now();
await M._test.pollOnce();
while (M._test.R.queue.length) { await M._test.processQueue(); }
console.log(`round 1 done in ${Date.now() - t0} ms`);
const cards = () => sent.filter((s) => s.method === 'sendMessage' && /رصد إخباري/.test(s.payload.text || ''));
const drafts = Object.values(n.drafts);
console.log(`drafts: ${drafts.length}, cards sent: ${cards().length}, channel posts: ${sent.filter((s) => String(s.payload.chat_id).startsWith('@')).length}`);
for (const d of drafts) console.log(` - ${d.id} ${d.type} @ ${d.loc?.name_ar} +${d.extra.length} | ${d.headline} | ${d.srcs.map((s) => s.u).join(',')}`);
console.log('\nDECISIONS:'); for (const l of M._test.R.log) console.log(` ${l.src.padEnd(15)} ${l.decision.padEnd(40)} ${l.text.slice(0, 60).replace(/\n/g, ' ')}`);
fs.writeFileSync('/tmp/news-card.txt', (cards()[0] || {}).payload?.text || '');
// replay again: nothing new may arrive
const before = drafts.length; M._test.R.log.length = 0;
for (const u of Object.keys(n.last)) n.last[u] = n.last[u] - 6;
await M._test.pollOnce();
while (M._test.R.queue.length) { await M._test.processQueue(); }
console.log(`\nround 2 (same posts again): drafts ${before} -> ${Object.values(n.drafts).length}`);
// callbacks
const upd = (data, msgId) => ({ update_id: Math.floor(Math.random() * 1e9), callback_query: { id: String(Math.random()), from: { id: 8270709633, is_bot: false, first_name: 'Sqer', language_code: 'ar' }, chat_instance: '1', data, message: { message_id: msgId, date: 0, chat: { id: 8270709633, type: 'private' }, text: 'x' } } });
const [d1, d2] = Object.values(n.drafts).filter((d) => d.status === 'pending');
if (d1) {
  const c = d1.cards[0];
  await bot.handleUpdate(upd(`nw:t:${d1.id}`, c[1]));
  await bot.handleUpdate(upd(`nw:s:${d1.id}:breaking`, c[1]));
  console.log('type changed ->', n.drafts[d1.id].type);
  sent.length = 0;
  await bot.handleUpdate(upd(`nw:p:${d1.id}`, c[1]));
  console.log('publish ->', n.drafts[d1.id].status, 'alert', n.drafts[d1.id].alertId, '| calls:', sent.map((s) => `${s.method}:${s.payload.chat_id}`).join(' '));
  sent.length = 0;
  await bot.handleUpdate(upd(`nw:p:${d1.id}`, c[1]));
  console.log('2nd publish tap -> calls:', sent.map((s) => s.method).join(' '), '| alerts in store:', store.state.alerts.length);
}
if (d2) { await bot.handleUpdate(upd(`nw:x:${d2.id}`, d2.cards[0][1])); console.log('ignore ->', n.drafts[d2.id].status); }
const d3 = Object.values(n.drafts).find((d) => d.status === 'pending' && !d.test);
if (d3) { sent.length = 0; await bot.handleUpdate(upd(`nw:e:${d3.id}`, d3.cards[0][1])); console.log('edit ->', n.drafts[d3.id].status, '| preview:', (sent.find((s) => s.method === 'editMessageText' || s.method === 'sendMessage')?.payload.text || '').slice(0, 300).replace(/\n/g, ' / ')); }
const msg = (text) => ({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 5000 + Math.floor(Math.random() * 1000), date: Math.floor(Date.now() / 1000), chat: { id: 8270709633, type: 'private' }, from: { id: 8270709633, is_bot: false, first_name: 'Sqer' }, text } });
await bot.handleUpdate(upd('nws:sa', 1)); sent.length = 0; await bot.handleUpdate(msg('https://t.me/SANAnews'));
console.log('add source ->', n.sources.map((s) => s.u).join(','), '|', sent.map((s) => (s.payload.text || '').slice(0, 120)).join(' || '));
await bot.handleUpdate(upd('nws:sa', 1)); sent.length = 0; await bot.handleUpdate(msg('@zz_not_a_real_channel_123'));
console.log('bad source ->', sent.map((s) => (s.payload.text || '').slice(0, 120)).join(' || '));
await bot.handleUpdate(upd('nws:sdy:SANAnews', 1)); console.log('after delete:', n.sources.length);
sent.length = 0;
await bot.handleUpdate(upd('nws', 1)); await bot.handleUpdate(upd('nws:src', 1)); await bot.handleUpdate(upd('nws:off', 1)); await bot.handleUpdate(upd('nws:on', 1)); await bot.handleUpdate(upd('nws:ty', 1)); await bot.handleUpdate(upd('nws:tt:protest', 1));
console.log('settings ok; protest on =', n.types.protest, '| monitor on =', n.on);
const scr = sent.filter((s) => s.method === 'editMessageText' || s.method === 'sendMessage').map((s) => s.payload.text);
fs.writeFileSync('/tmp/news-screens.txt', scr.join('\n\n=========\n\n'));
sent.length = 0;
const r = await M.sendTestDraft(8270709633);
console.log('test draft', r, sent[0]?.payload?.text?.split('\n')[0]);
process.exit(0);
