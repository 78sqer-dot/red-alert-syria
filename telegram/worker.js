/* ═══════════════════════════════════════════════════════════════════
   الإنذار الأحمر سوريا — الخادم الخلفي (Cloudflare Worker)
   بوت تليغرام + نشر إلى القناة + واجهة API للموقع — يعمل ٢٤/٧ مجاناً
   التعليمات الكاملة خطوة بخطوة في ملف DEPLOY.md
   ═══════════════════════════════════════════════════════════════════

   المتغيرات المطلوبة (Worker → Settings → Variables):
   ┌──────────────────┬────────────────────────────────────────────────┐
   │ BOT_TOKEN        │ توكن البوت من @BotFather            (Secret)   │
   │ CHANNEL_ID       │ @Red_Alert_Syria أو -1003979061470 (مضبوط       │
   │                  │ افتراضياً — يمكن تغييره من المتغيرات)           │
   │ ADMIN_IDS        │ 123456789,987654321 (معرّفات المشرفين الرقمية)  │
   │ WEBHOOK_SECRET   │ كلمة سر عشوائية طويلة لرابط الويبهوك           │
   │ SITE_URL         │ رابط موقعك (اختياري — يُضاف لنهاية رسائل القناة) │
   │ CHANNEL_AS_SOURCE│ 1 = تحويل منشورات القناة إلى تنبيهات (اختياري)  │
   └──────────────────┴────────────────────────────────────────────────┘
   + ربط KV Namespace باسم المتغيّر: ALERTS_KV
*/

/* قناة النشر — الإنذار الأحمر سوريا (مضبوطة افتراضياً، تُتجاوز بمتغير CHANNEL_ID) */
const CHANNEL_FALLBACK = '-1003979061470';   /* @Red_Alert_Syria */

/* ---------- أنواع التنبيهات (نفس مفاتيح الموقع) ---------- */
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

/* ---------- المحافظات ومدنها (نفس أسماء خريطة الموقع حرفياً) ---------- */
const GOVS = {"دمشق":["دمشق"],"ريف دمشق":["دوما","حرستا","الزبداني","قطنا","النبك","يبرود","الكسوة","صيدنايا","معضمية الشام"],"حلب":["حلب","الباب","عفرين","أعزاز","منبج","جرابلس","السفيرة","عين العرب","صوران","دير حافر"],"إدلب":["إدلب","معرة النعمان","خان شيخون","جسر الشغور","أريحا"],"حمص":["حمص","تدمر","الرستن","القصير"],"حماة":["حماة","سلمية","مصياف","محردة","السقيلبية"],"اللاذقية":["اللاذقية","جبلة","الحفة","القرداحة","كسب"],"طرطوس":["طرطوس","بانياس","صافيتا","دريكيش","الشيخ بدر"],"دير الزور":["دير الزور","الميادين","البوكمال","القورية"],"الرقة":["الرقة","الطبقة","تل أبيض"],"الحسكة":["الحسكة","القامشلي","رأس العين","المالكية","الشدادي"],"درعا":["درعا","إزرع","الصنمين","طفس","نوى","الشيخ مسكين"],"السويداء":["السويداء","شهبا","صلخد"],"القنيطرة":["القنيطرة","بقعاتا","خان أرنبة"]};

const WELCOME = `🚨 أهلاً بك في بوت الإبلاغ — الإنذار الأحمر سوريا

للإبلاغ عن حدث أرسل /report ثم:
١) اختر المحافظة
٢) اختر المدينة أو البلدة
٣) اختر نوع الحدث

يمكنك أيضاً كتابة البلاغ نصاً مباشرة بهذا الشكل:
غارة جوية - حلب - حي الفرقان

📌 سيُنشر البلاغ بعد المراجعة على القناة وعلى الخريطة المباشرة.
⚠️ البلاغ الكاذب يعرّض الناس للخطر — بلّغ بمسؤولية.`;

/* ---------- أدوات عامة ---------- */
const HEADERS = {
  'Content-Type':'application/json; charset=utf-8',
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
  'Cache-Control':'no-store',
};
const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: HEADERS });
const kb    = rows => JSON.stringify({ inline_keyboard: rows });
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const admins = env => (env.ADMIN_IDS || '8270709633').split(',').map(s => s.trim()).filter(Boolean);
const isAdmin = (env, id) => admins(env).length === 0 || admins(env).includes(String(id));

async function tg(env, method, body){
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}

/* ---------- تخزين (KV) مع كاش ٥ ثوان لتقليل القراءات ---------- */
let CACHE = { at: 0, alerts: [] };
async function getAlerts(env){
  if (Date.now() - CACHE.at > 5000){
    const raw = await env.ALERTS_KV.get('alerts');
    CACHE = { at: Date.now(), alerts: raw ? JSON.parse(raw) : [] };
  }
  return CACHE.alerts;
}
async function saveAlerts(env, arr){
  CACHE = { at: Date.now(), alerts: arr };
  await env.ALERTS_KV.put('alerts', JSON.stringify(arr), { expirationTtl: 86400 });
}

/* ---------- النشر ---------- */
async function publish(env, a){
  const t = TYPES[a.type] || TYPES.clashes;
  /* منع التكرار: نفس النوع والمدينة خلال ٩٠ ثانية */
  const recent = await getAlerts(env);
  if (recent.some(x => x.type === a.type && x.city === a.city && Date.now() - x.ts < 90000)) return null;

  a.id    = Date.now();
  a.ts    = a.id;
  a.until = a.id + t.min * 60000;
  a.ended = false;

  const arr = await getAlerts(env);
  arr.unshift(a);
  if (arr.length > 150) arr.length = 150;
  await saveAlerts(env, arr);

  const time = new Date(a.id).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Damascus' });
  const site = env.SITE_URL ? `\n🗺️ الخريطة المباشرة: ${env.SITE_URL}` : '';
  try {
    await tg(env, 'sendMessage', {
      chat_id: env.CHANNEL_ID || CHANNEL_FALLBACK,
      text: `🚨 ${t.emoji} ${t.ar}\n📍 ${a.city} — محافظة ${a.gov}${a.area ? `\n🏘️ ${a.area}` : ''}\n🕒 ${time}${site}`,
    });
  } catch (e) { /* القناة قد تكون معطلة — التنبيه يبقى مخزناً للموقع */ }
  return a;
}

/* ---------- تحليل بلاغ نصي: "غارة جوية - حلب - حي الفرقان" ---------- */
function parseReport(text){
  const parts = text.split(/\s*[-؛;\n،]\s*/).map(s => s.trim()).filter(Boolean);
  let type = null, city = null, gov = null, area = null;
  for (const p of parts){
    if (!type) for (const k in TYPES) if (p.includes(TYPES[k].ar) || p.includes(k)) { type = k; break; }
    if (!city){
      for (const g in GOVS) for (const c of GOVS[g]){
        if (p === c || p.includes(c) || c.includes(p)){ city = c; gov = g; break; }
      }
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

/* ---------- تدفق الأزرار ---------- */
const govRows  = () => chunk(Object.keys(GOVS), 2).map(r => r.map(g => ({ text: g, callback_data: 'g|' + g })));
const cityRows = gov => chunk(GOVS[gov] || [], 2).map(r => r.map(c => ({ text: c, callback_data: 'c|' + c })));
const typeRows = () => chunk(Object.entries(TYPES), 2).map(r => r.map(([k, v]) => ({ text: v.emoji + ' ' + v.ar, callback_data: 't|' + k })));

async function askGov(env, chatId){
  await tg(env, 'sendMessage', { chat_id: chatId, text: '📍 اختر المحافظة:', reply_markup: kb(govRows()) });
}
async function askCity(env, chatId, gov){
  await tg(env, 'sendMessage', { chat_id: chatId, text: `🏘️ اختر المدينة أو البلدة في ${gov}:`, reply_markup: kb(cityRows(gov)) });
}
async function askType(env, chatId){
  await tg(env, 'sendMessage', { chat_id: chatId, text: '⚠️ اختر نوع الحدث:', reply_markup: kb(typeRows()) });
}

/* ---------- معالجة تحديثات تليغرام ---------- */
async function handleUpdate(upd, env){
  /* رسائل خاصة إلى البوت */
  if (upd.message && upd.message.text){
    const chatId = upd.message.chat.id;
    const userId = upd.message.from.id;
    const text   = upd.message.text.trim();

    if (text.startsWith('/start')) return tg(env, 'sendMessage', { chat_id: chatId, text: WELCOME });

    if (text.startsWith('/report') || text === 'بلاغ'){
      const rl = await env.ALERTS_KV.get('rl:' + userId);
      if (rl) return tg(env, 'sendMessage', { chat_id: chatId, text: '⏳ انتظر قليلاً قبل إرسال بلاغ جديد.' });
      return askGov(env, chatId);
    }

    /* بلاغ نصي حر */
    const rep = parseReport(text);
    if (rep){
      await env.ALERTS_KV.put('rl:' + userId, '1', { expirationTtl: 45 });
      return submitReport(env, userId, chatId, rep);
    }
    return tg(env, 'sendMessage', { chat_id: chatId, text: 'لم أفهم البلاغ 🤔\nأرسل /report للاختيار من القوائم، أو اكتبه نصاً:\nغارة جوية - حلب - حي الفرقان' });
  }

  /* أزرار الرد (الاختيارات) */
  if (upd.callback_query){
    const cb      = upd.callback_query;
    const data    = cb.data || '';
    const chatId  = cb.message.chat.id;
    const userId  = cb.from.id;
    const [act, val] = data.split('|');
    await tg(env, 'answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});

    if (act === 'g'){
      await env.ALERTS_KV.put('st:' + chatId, JSON.stringify({ gov: val }), { expirationTtl: 600 });
      return askCity(env, chatId, val);
    }
    if (act === 'c'){
      const st = JSON.parse((await env.ALERTS_KV.get('st:' + chatId)) || '{}');
      st.city = val;
      await env.ALERTS_KV.put('st:' + chatId, JSON.stringify(st), { expirationTtl: 600 });
      return askType(env, chatId);
    }
    if (act === 't'){
      const st = JSON.parse((await env.ALERTS_KV.get('st:' + chatId)) || '{}');
      await env.ALERTS_KV.delete('st:' + chatId);
      if (!st.gov) return askGov(env, chatId);
      return submitReport(env, userId, chatId, { type: val, city: st.city || GOVS[st.gov][0], gov: st.gov, area: null });
    }
    /* موافقة/رفض المشرفين */
    if (act === 'y' || act === 'n'){
      if (!isAdmin(env, userId)) return tg(env, 'sendMessage', { chat_id: chatId, text: '⛔️ هذا الخيار للمشرفين فقط.' });
      const raw = await env.ALERTS_KV.get('pd:' + val);
      await env.ALERTS_KV.delete('pd:' + val);
      if (!raw) return tg(env, 'editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: '⌛️ انتهت صلاحية هذا البلاغ.' });
      const a = JSON.parse(raw);
      if (act === 'n'){
        await tg(env, 'editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: `❌ مرفوض: ${TYPES[a.type].ar} — ${a.city}` });
        if (a.reporterChat) await tg(env, 'sendMessage', { chat_id: a.reporterChat, text: 'تمت مراجعة بلاغك ولم يُعتمد. شكراً لمساهمتك.' }).catch(() => {});
        return;
      }
      const pub = await publish(env, a);
      const res = pub ? `✅ تم النشر: ${TYPES[a.type].ar} — ${a.city} (${a.gov})` : '⏭️ تنبيه مماثل نُشر قبل قليل — تم التجاهل.';
      await tg(env, 'editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: res });
      if (pub && a.reporterChat) await tg(env, 'sendMessage', { chat_id: a.reporterChat, text: `✅ تم اعتماد بلاغك ونشره: ${TYPES[a.type].ar} — ${a.city}` }).catch(() => {});
      return;
    }
  }

  /* منشورات القناة كمصدر تنبيهات (اختياري) */
  if (upd.channel_post && upd.channel_post.text && env.CHANNEL_AS_SOURCE === '1'){
    const post = upd.channel_post;
    if (post.from && post.from.is_bot) return;          /* تجنّب أي حلقة */
    const rep = parseReport(post.text);
    if (rep) await publish(env, rep);                    /* يُخزَّن للموقع دون إعادة النشر للقناة */
    return;
  }
}

/* إرسال البلاغ: نشر فوري للمشرفين، أو مراجعة لغيرهم */
async function submitReport(env, userId, chatId, rep){
  const a = { type: rep.type, city: rep.city, gov: rep.gov, area: rep.area, reporterChat: chatId };
  if (isAdmin(env, userId)){
    const pub = await publish(env, a);
    return tg(env, 'sendMessage', {
      chat_id: chatId,
      text: pub ? `✅ تم النشر: ${TYPES[rep.type].ar} — ${rep.city} (${rep.gov})`
                : '⏭️ تنبيه مماثل نُشر قبل قليل — تم التجاهل.',
    });
  }
  const pid = Date.now() + '_' + userId;
  await env.ALERTS_KV.put('pd:' + pid, JSON.stringify(a), { expirationTtl: 3600 });
  const t = TYPES[rep.type];
  const rows = [[
    { text: '✅ اعتماد ونشر', callback_data: 'y|' + pid },
    { text: '❌ رفض',         callback_data: 'n|' + pid },
  ]];
  for (const adm of admins(env)){
    await tg(env, 'sendMessage', {
      chat_id: adm,
      text: `🔔 بلاغ جديد بانتظار المراجعة\n${t.emoji} ${t.ar} — ${rep.city} (${rep.gov})${rep.area ? '\n🏘️ ' + rep.area : ''}\nمن: ${chatId}`,
      reply_markup: kb(rows),
    }).catch(() => {});
  }
  return tg(env, 'sendMessage', { chat_id: chatId, text: '📨 تم إرسال بلاغك إلى فريق المراجعة. شكراً لك!' });
}

/* ═══════════════ الخادم ═══════════════ */
export default {
  async fetch(request, env){
    const url  = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });

    try {
      /* واجهة التنبيهات للموقع */
      if (path === '/alerts'){
        const alerts = await getAlerts(env);
        return J({ ok: true, updated: Date.now(), alerts });
      }

      /* تفعيل الويبهوك — افتح هذا الرابط مرة واحدة بعد النشر */
      if (path === '/setup'){
        if (url.searchParams.get('key') !== env.WEBHOOK_SECRET)
          return J({ ok: false, error: 'مفتاح خاطئ — أضف ?key=WEBHOOK_SECRET' }, 403);
        const r = await tg(env, 'setWebhook', {
          url: `https://${url.host}/webhook/${env.WEBHOOK_SECRET}`,
          allowed_updates: ['message', 'callback_query', 'channel_post'],
        });
        return J({ ok: r.ok, result: r.result, hint: 'إن نجح — البوت جاهز الآن، جرّب /report' });
      }

      /* استقبال تحديثات تليغرام */
      if (path === '/webhook/' + env.WEBHOOK_SECRET){
        const upd = await request.json();
        await handleUpdate(upd, env);
        return J({ ok: true });
      }

      if (path === '/'){
        return new Response('Red Alert Syria backend ✅ — GET /alerts', {
          headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }

      return J({ ok: false, error: 'not found' }, 404);
    } catch (e) {
      return J({ ok: false, error: String(e) }, 500);
    }
  },
};
