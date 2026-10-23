// Simulates Telegram updates against the bot with a mocked API (no real messages are sent).
process.env.BOT_TOKEN = '123456:TEST';
process.env.OWNER_IDS = '8270709633';
process.env.CHANNEL = '@Red_Alert_Syria';
process.env.DATA_DIR = '/tmp/ras-sim';
process.env.TELEGRAM_BACKUP = '0';
const { store } = await import('../server/store.js');
await store.init(null);
const { createBot } = await import('../server/bot.js');
const bot = createBot();
bot.botInfo = { id: 1, is_bot: true, first_name: 'RAS', username: 'Red_Alert_Syria_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false };
const log = [];
let mid = 100;
bot.api.config.use(async (prev, method, payload) => {
  log.push({ method, payload });
  if (method === 'sendMessage' || method === 'sendPhoto') return { ok: true, result: { message_id: ++mid, chat: { id: payload.chat_id, type: 'private' }, date: 0, text: payload.text } };
  if (method === 'editMessageText') return { ok: true, result: { message_id: payload.message_id, chat: { id: payload.chat_id }, date: 0, text: payload.text } };
  return { ok: true, result: true };
});
let uid = 1;
const user = (id, name = 'Sqer') => ({ id, is_bot: false, first_name: name, language_code: 'ar' });
const msg = (from, text) => bot.handleUpdate({ update_id: uid++, message: { message_id: ++mid, date: Math.floor(Date.now() / 1000), chat: { id: from.id, type: 'private' }, from, text, ...(text.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}) } });
const cb = (from, data) => bot.handleUpdate({ update_id: uid++, callback_query: { id: String(uid), from, chat_instance: '1', data, message: { message_id: mid, date: 0, chat: { id: from.id, type: 'private' }, from: bot.botInfo, text: 'x' } } });
const last = () => { const l = [...log].reverse().find((x) => /sendMessage|editMessageText/.test(x.method)); return l; };
const btns = (l) => (l.payload.reply_markup?.inline_keyboard || []).flat().map((b) => `${b.text}=>${b.callback_data || b.url}`);
const show = (title) => { const l = last(); console.log(`\n=== ${title} [${l.method}]\n${l.payload.text}\n  buttons: ${btns(l).slice(0, 18).join(' | ')}${btns(l).length > 18 ? ` ... (+${btns(l).length - 18})` : ''}`); };
const owner = user(8270709633);
await msg(owner, '/start'); show('owner /start');
await cb(owner, 't:uav'); show('uav → choose governorate');
const govBtn = btns(last()).find((b) => b.startsWith('درعا') || b.includes('درعا'));
await cb(owner, govBtn.split('=>')[1]); show('gov chosen → districts');
const distBtn = btns(last()).find((b) => b.includes('=>d:'));
await cb(owner, distBtn.split('=>')[1]); show('district → places');
const placeBtn = btns(last()).find((b) => b.includes('=>p:'));
await cb(owner, placeBtn.split('=>')[1]); show('place chosen → details');
await msg(owner, 'مسيّرة تحلق على علو منخفض'); show('details typed → preview');
await cb(owner, 'publish'); show('published');
const ch = log.filter((x) => x.payload.chat_id === '@Red_Alert_Syria');
console.log('\n=== channel post:', ch.length, ch[0]?.method, '\n' + ch[0]?.payload.text, '\n  buttons:', btns(ch[0]).join(' | '));
// breaking
await cb(owner, 't:breaking'); show('breaking → ask text');
await msg(owner, 'انفجار قوي يهز العاصمة دمشق'); show('breaking text → location');
await msg(owner, 'دمشق'); show('typed place search');
const sb = btns(last()).find((b) => /=>p:|=>wg:/.test(b));
if (sb) { await cb(owner, sb.split('=>')[1]); show('search result chosen'); }
const lp = last(); if (/publish/.test(btns(lp).join())) { await cb(owner, 'publish'); show('breaking published'); } else { await cb(owner, 'skip'); show('skip'); await cb(owner, 'publish'); show('breaking published'); }
// public user report
const pub = user(555, 'Ali');
await msg(pub, '/start'); show('public /start');
await cb(pub, 't:artillery'); show('public artillery');
await msg(pub, 'حلب'); show('public search');
const pb = btns(last()).find((b) => /=>p:|=>wg:/.test(b)); await cb(pub, pb.split('=>')[1]); show('public chose');
await cb(pub, 'skip'); show('public preview');
await cb(pub, 'submit'); show('public submitted');
const rv = [...log].reverse().find((x) => x.method === 'sendMessage' && x.payload.chat_id === 8270709633);
console.log('\n=== review msg to owner:\n' + rv.payload.text + '\n  ' + btns(rv).join(' | '));
await cb(owner, btns(rv)[0].split('=>')[1]); show('owner approved');
await msg(owner, '/active'); show('/active');
await cb(owner, 'lang'); show('lang toggled');
console.log('\nstore active:', store.activeAlerts().map((a) => `${a.type}:${a.title}`));
const errs = log.filter((x) => x.method === 'sendMessage' && /error|خطأ/i.test(x.payload.text || ''));
console.log('error msgs:', errs.length);
process.exit(0);
