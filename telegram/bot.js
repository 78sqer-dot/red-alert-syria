/* ═══════════════════════════════════════════════════════════════════
   الإنذار الأحمر سوريا — بوت Node.js (بديل عن Cloudflare Worker)
   يعمل ٢٤/٧ على: Railway / Render / Fly.io / أي VPS
   بدون أي مكتبات خارجية — يتطلّب Node.js 18 أو أحدث
   التعليمات الكاملة في ملف DEPLOY.md (القسم 4-ب)

   متغيرات البيئة المطلوبة:
   BOT_TOKEN   توكن البوت من @BotFather
   CHANNEL_ID  @Red_Alert_Syria أو -1003979061470 (مضبوط افتراضياً)
   ADMIN_IDS   123456789,987654321 (اتركه فارغاً = الجميع ينشر مباشرة)
   PORT        منفذ الخادم (افتراضي 8080)
   SITE_URL    رابط موقعك (اختياري)
   ═══════════════════════════════════════════════════════════════════ */

const http = require('http');
const fs = require('fs');

const BOT_TOKEN   = process.env.BOT_TOKEN   || '';
const CHANNEL_ID  = process.env.CHANNEL_ID  || '-1003979061470';   /* @Red_Alert_Syria */
const ADMIN_IDS   = (process.env.ADMIN_IDS  || '8270709633').split(',').map(s => s.trim()).filter(Boolean);   /* @Sqer78 */
const PORT        = +(process.env.PORT || 8080);
const SITE_URL    = process.env.SITE_URL    || '';
const ALERTS_FILE = process.env.ALERTS_FILE || 'alerts.json';

if (!BOT_TOKEN){
  console.error('⛔️ عيّن BOT_TOKEN أولاً (من @BotFather) — راجع DEPLOY.md');
  process.exit(1);
}

/* ---------- البيانات (نفس أسماء خريطة الموقع) ---------- */
const TYPES = {
  strike:   { ar:'غارة جوية',   min:7,  emoji:'💥' },
  drone:    { ar:'مسيّرة',      min:8,  emoji:'🛩️' },
  warplane: { ar:'طيران حربي',  min:8,  emoji:'✈️' },
  heli:     { ar:'مروحية',      min:8,  emoji:'🚁' },
  artillery:{ ar:'قصف مدفعي',   min:8,  emoji:'🎯' },
  missile:  { ar:'صواريخ',      min:7,  emoji:'🚀' },
  clashes:  { ar:'اشتباكات',    min:10, emoji:'⚔️' },
  evac:     { ar:'إنذار إخلاء', min:45, emoji:'🏃' },
  road:     { ar:'قطع طريق',    min:40, emoji:'🚧' },
  quake:    { ar:'زلزال',       min:25, emoji:'🌍' },
};
const GOVS = {"دمشق":["دمشق"],"ريف دمشق":["دوما","حرستا","الزبداني","قطنا","النبك","يبرود","الكسوة","صيدنايا","معضمية الشام"],"حلب":["حلب","الباب","عفرين","أعزاز","منبج","جرابلس","السفيرة","عين العرب","صوران","دير حافر"],"إدلب":["إدلب","معرة النعمان","خان شيخون","جسر الشغور","أريحا"],"حمص":["حمص","تدمر","الرستن","القصير"],"حماة":["حماة","سلمية","مصياف","محردة","السقيلبية"],"اللاذقية":["اللاذقية","جبلة","الحفة","القرداحة","كسب"],"طرطوس":["طرطوس","بانياس","صافيتا","دريكيش","الشيخ بدر"],"دير الزور":["دير الزور","الميادين","البوكمال","القورية"],"الرقة":["الرقة","الطبقة","تل أبيض"],"الحسكة":["الحسكة","القامشلي","رأس العين","المالكية","الشدادي"],"درعا":["درعا","إزرع","الصنمين","طفس","نوى","الشيخ مسكين"],"السويداء":["السويداء","شهبا","صلخد"],"القنيطرة":["القنيطرة","بقعاتا","خان أرنبة"]};

const WELCOME = `🚨 أهلاً بك في بوت الإبلاغ — الإنذار الأحمر سوريا

للإبلاغ عن حدث أرسل /report ثم:
١) اختر المحافظة  ٢) اختر المدينة  ٣) اختر نوع الحدث

أو اكتبه نصاً: غارة جوية - حلب - حي الفرقان
⚠️ البلاغ الكاذب يعرّض الناس للخطر — بلّغ بمسؤولية.`;

/* ---------- الحالة في الذاكرة ---------- */
let alerts = [];
try { alerts = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf-8')); } catch (e) {}
const states = new Map();      /* chatId -> {gov, city} */
const pendings = new Map();   /* pid -> alert */
const rateLimit = new Map();  /* userId -> ts */

const isAdmin = id => ADMIN_IDS.length === 0 || ADMIN_IDS.includes(String(id));
const kb = rows => JSON.stringify({ inline_keyboard: rows });
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function tg(method, body){
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}
function persist(){
  try { fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts)); } catch (e) {}
}

/* ---------- النشر ---------- */
async function publish(a){
  const t = TYPES[a.type] || TYPES.clashes;
  if (alerts.some(x => x.type === a.type && x.city === a.city && Date.now() - x.ts < 90000)) return null;

  a.id = Date.now(); a.ts = a.id; a.until = a.id + t.min * 60000; a.ended = false;
  alerts.unshift(a);
  if (alerts.length > 150) alerts.length = 150;
  persist();

  const time = new Date(a.id).toLocaleTimeString('ar-EG', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Damascus' });
  try {
    await tg('sendMessage', {
      chat_id: CHANNEL_ID,
      text: `🚨 ${t.emoji} ${t.ar}\n📍 ${a.city} — محافظة ${a.gov}${a.area ? `\n🏘️ ${a.area}` : ''}\n🕒 ${time}${SITE_URL ? `\n🗺️ ${SITE_URL}` : ''}`,
    });
  } catch (e) { console.error('channel send:', e.message); }
  console.log(`✅ نُشر: ${t.ar} — ${a.city} (${a.gov})`);
  return a;
}

/* ---------- تحليل بلاغ نصي ---------- */
function parseReport(text){
  const parts = text.split(/\s*[-؛;\n،]\s*/).map(s => s.trim()).filter(Boolean);
  let type = null, city = null, gov = null, area = null;
  for (const p of parts){
    if (!type) for (const k in TYPES) if (p.includes(TYPES[k].ar) || p.includes(k)) { type = k; break; }
    if (!city){
      for (const g in GOVS) for (const c of GOVS[g])
        if (p === c || p.includes(c) || c.includes(p)){ city = c; gov = g; break; }
      if (!city) for (const g in GOVS) if (p === g || p.includes(g)) { gov = g; city = GOVS[g][0]; break; }
    }
  }
  if (city && !type) type = 'clashes';
  if (type && city){
    const used = new Set([TYPES[type].ar, city, gov]);
    area = parts.find(p => ![...used].some(u => p.includes(u))) || null;
    return { type, city, gov, area };
  }
  return null;
}

/* ---------- التدفق ---------- */
const govRows  = () => chunk(Object.keys(GOVS), 2).map(r => r.map(g => ({ text: g, callback_data: 'g|' + g })));
const cityRows = gov => chunk(GOVS[gov] || [], 2).map(r => r.map(c => ({ text: c, callback_data: 'c|' + c })));
const typeRows = () => chunk(Object.entries(TYPES), 2).map(r => r.map(([k, v]) => ({ text: v.emoji + ' ' + v.ar, callback_data: 't|' + k })));

async function submitReport(userId, chatId, rep){
  const a = { ...rep, reporterChat: chatId };
  if (isAdmin(userId)){
    const pub = await publish(a);
    return tg('sendMessage', { chat_id: chatId, text: pub ? `✅ تم النشر: ${TYPES[rep.type].ar} — ${rep.city} (${rep.gov})` : '⏭️ تنبيه مماثل نُشر قبل قليل — تم التجاهل.' });
  }
  const pid = Date.now() + '_' + userId;
  pendings.set(pid, a);
  const t = TYPES[rep.type];
  const rows = [[
    { text: '✅ اعتماد ونشر', callback_data: 'y|' + pid },
    { text: '❌ رفض',         callback_data: 'n|' + pid },
  ]];
  for (const adm of ADMIN_IDS)
    await tg('sendMessage', { chat_id: adm, text: `🔔 بلاغ جديد بانتظار المراجعة\n${t.emoji} ${t.ar} — ${rep.city} (${rep.gov})${rep.area ? '\n🏘️ ' + rep.area : ''}\nمن: ${chatId}`, reply_markup: kb(rows) }).catch(() => {});
  return tg('sendMessage', { chat_id: chatId, text: '📨 تم إرسال بلاغك إلى فريق المراجعة. شكراً لك!' });
}

async function handleUpdate(upd){
  if (upd.message && upd.message.text){
    const chatId = upd.message.chat.id, userId = upd.message.from.id, text = upd.message.text.trim();
    if (text.startsWith('/start')) return tg('sendMessage', { chat_id: chatId, text: WELCOME });
    if (text.startsWith('/report') || text === 'بلاغ'){
      const last = rateLimit.get(userId) || 0;
      if (Date.now() - last < 45000) return tg('sendMessage', { chat_id: chatId, text: '⏳ انتظر قليلاً قبل إرسال بلاغ جديد.' });
      return tg('sendMessage', { chat_id: chatId, text: '📍 اختر المحافظة:', reply_markup: kb(govRows()) });
    }
    const rep = parseReport(text);
    if (rep){
      rateLimit.set(userId, Date.now());
      return submitReport(userId, chatId, rep);
    }
    return tg('sendMessage', { chat_id: chatId, text: 'لم أفهم البلاغ 🤔\nأرسل /report أو اكتبه نصاً:\nغارة جوية - حلب - حي الفرقان' });
  }

  if (upd.callback_query){
    const cb = upd.callback_query, data = cb.data || '';
    const chatId = cb.message.chat.id, userId = cb.from.id;
    const [act, val] = data.split('|');
    tg('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
    if (act === 'g'){ states.set(chatId, { gov: val }); return tg('sendMessage', { chat_id: chatId, text: `🏘️ اختر المدينة أو البلدة في ${val}:`, reply_markup: kb(cityRows(val)) }); }
    if (act === 'c'){ const st = states.get(chatId) || {}; st.city = val; states.set(chatId, st); return tg('sendMessage', { chat_id: chatId, text: '⚠️ اختر نوع الحدث:', reply_markup: kb(typeRows()) }); }
    if (act === 't'){
      const st = states.get(chatId) || {};
      states.delete(chatId);
      if (!st.gov) return tg('sendMessage', { chat_id: chatId, text: '📍 اختر المحافظة:', reply_markup: kb(govRows()) });
      return submitReport(userId, chatId, { type: val, city: st.city || GOVS[st.gov][0], gov: st.gov, area: null });
    }
    if (act === 'y' || act === 'n'){
      if (!isAdmin(userId)) return tg('sendMessage', { chat_id: chatId, text: '⛔️ هذا الخيار للمشرفين فقط.' });
      const a = pendings.get(val);
      pendings.delete(val);
      if (!a) return tg('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: '⌛️ انتهت صلاحية هذا البلاغ.' });
      if (act === 'n'){
        await tg('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: `❌ مرفوض: ${TYPES[a.type].ar} — ${a.city}` });
        if (a.reporterChat) tg('sendMessage', { chat_id: a.reporterChat, text: 'تمت مراجعة بلاغك ولم يُعتمد. شكراً لمساهمتك.' }).catch(() => {});
        return;
      }
      const pub = await publish(a);
      await tg('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: pub ? `✅ تم النشر: ${TYPES[a.type].ar} — ${a.city} (${a.gov})` : '⏭️ تنبيه مماثل نُشر قبل قليل — تم التجاهل.' });
      if (pub && a.reporterChat) tg('sendMessage', { chat_id: a.reporterChat, text: `✅ تم اعتماد بلاغك ونشره: ${TYPES[a.type].ar} — ${a.city}` }).catch(() => {});
      return;
    }
  }
}

/* ---------- الاستطلاع الطويل لتليغرام ---------- */
let offset = 0;
async function pollLoop(){
  for (;;){
    try {
      const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?timeout=25&offset=${offset}`);
      const j = await r.json();
      if (j.ok){
        if (j.result.length){
          offset = j.result[j.result.length - 1].update_id + 1;
          for (const upd of j.result) await handleUpdate(upd).catch(e => console.error('update:', e.message));
        }
      } else {
        console.error('telegram:', j.description || 'خطأ غير معروف', '— إعادة المحاولة بعد 5 ثوان');
        await new Promise(res => setTimeout(res, 5000));
      }
    } catch (e) {
      console.error('poll:', e.message, '— إعادة المحاولة بعد 5 ثوان');
      await new Promise(res => setTimeout(res, 5000));
    }
  }
}

/* ---------- خادم HTTP للموقع ---------- */
http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (req.method === 'OPTIONS'){ res.writeHead(204, cors); return res.end(); }
  if (req.url.startsWith('/alerts')){
    const cutoff = Date.now() - 12 * 3600000;   /* آخر ١٢ ساعة فقط */
    res.writeHead(200, cors);
    return res.end(JSON.stringify({ ok: true, updated: Date.now(), alerts: alerts.filter(a => a.ts >= cutoff) }));
  }
  if (req.url === '/health'){ res.writeHead(200, cors); return res.end('{"ok":true}'); }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Red Alert Syria bot ✅ — GET /alerts');
}).listen(PORT, () => console.log(`🟢 الخادم جاهز على المنفذ ${PORT} — الموقع يجلب من /alerts`));

pollLoop();
console.log('🤖 البوت يعمل الآن (استطلاع تليغرام)...');
