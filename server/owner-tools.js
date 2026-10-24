// Owner-only tools of the private publishing bot:
//  • 👥 Editors: list / add (ID, forwarded message, @username, contact picker) / remove.
//  • 🔁 Project hand-over: change owner, publishing-bot token, report-bot token, channel; link Render so
//    the changes survive restarts; step-by-step guide for what can only be done by hand.
// Editors can never reach these screens: every handler checks h.owner(ctx).
import { Api, InlineKeyboard, Keyboard } from 'grammy';
import { config, envDefaults, applyProject } from './config.js';
import { store } from './store.js';
import { renderLinked, renderLink, renderSetEnv } from './render-sync.js';

const PEND_MS = 5 * 60_000;
const pend = new Map(); // owner id -> { k, exp, ... }
const TOKEN_RE = /^(\d{6,12}):[A-Za-z0-9_-]{30,}$/;
const REPO_URL = process.env.REPO_URL || 'https://github.com/78sqer-dot/red-alert-syria';
export const runtimeHooks = { reloadBots: null };
export const apiFactory = { make: (token) => new Api(token) }; // replaced in simulations

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const botIdOf = (token) => Number(String(token || '').split(':')[0]) || null;
const setPend = (id, k, extra = {}) => pend.set(id, { k, exp: Date.now() + PEND_MS, ...extra });
export const _pendForTest = pend;

function userLine(id, en) {
  const u = store.state.users[id];
  const name = u?.name ? esc(u.name) : (en ? 'User' : 'مستخدم');
  return `${name}${u?.username ? ' @' + esc(u.username) : ''} — <code>${id}</code>`;
}

// Resolve the person the owner points at: contact picker, forwarded message, numeric ID, @username / t.me link.
function resolveUser(msg) {
  const shared = msg.users_shared?.users?.[0] || (msg.users_shared?.user_ids ? { user_id: msg.users_shared.user_ids[0] } : null);
  if (shared?.user_id) {
    const id = Number(shared.user_id);
    if (shared.first_name || shared.username) {
      const rec = store.state.users[id] || {};
      store.state.users[id] = { ...rec, name: rec.name || [shared.first_name, shared.last_name].filter(Boolean).join(' '), username: rec.username || shared.username };
    }
    return { id };
  }
  const fo = msg.forward_origin;
  if (fo) {
    if (fo.type === 'user' && fo.sender_user) {
      if (fo.sender_user.is_bot) return { err: 'bot' };
      const u = fo.sender_user;
      const rec = store.state.users[u.id] || {};
      store.state.users[u.id] = { ...rec, name: rec.name || [u.first_name, u.last_name].filter(Boolean).join(' '), username: rec.username || u.username };
      return { id: Number(u.id) };
    }
    if (fo.type === 'hidden_user') return { err: 'hidden' };
    return { err: 'invalid' };
  }
  const txt = String(msg.text || '').trim();
  if (/^\d{5,15}$/.test(txt)) return { id: Number(txt) };
  const m = txt.match(/^(?:https?:\/\/)?(?:t\.me\/|@)?([A-Za-z][A-Za-z0-9_]{3,31})$/);
  if (m) {
    const want = m[1].toLowerCase();
    const hit = Object.entries(store.state.users).find(([, u]) => (u?.username || '').toLowerCase() === want);
    if (hit) return { id: Number(hit[0]) };
    return { err: 'username', username: m[1] };
  }
  return { err: 'invalid' };
}

function userInputHelp(en, botName) {
  return en
    ? `Send one of these:\n• Their <b>Telegram ID</b> (numbers). They get it by sending /id to @${esc(botName)}\n• <b>Forward</b> any message from them here\n• Their <b>@username</b> (works if they opened @${esc(botName)} before)\n• Or tap <b>👤 Pick a contact</b> below`
    : `أرسل واحداً مما يلي:\n• <b>معرّفه في تيليغرام (ID)</b> بالأرقام — يحصل عليه بإرسال /id إلى @${esc(botName)}\n• أو <b>أعِد توجيه</b> أي رسالة منه إلى هنا\n• أو <b>اسم المستخدم</b> مثل @username (إن كان قد فتح @${esc(botName)} من قبل)\n• أو اضغط زر <b>👤 اختيار جهة اتصال</b> بالأسفل`;
}
const pickerKb = (en, requestId) => new Keyboard()
  .requestUsers(en ? '👤 Pick a contact' : '👤 اختيار جهة اتصال', requestId, { user_is_bot: false, max_quantity: 1, request_name: true, request_username: true })
  .row().text(en ? '✖️ Cancel' : '✖️ إلغاء').resized().oneTime();
const isCancel = (t) => /^✖️\s*(إلغاء|Cancel)$/.test(String(t || '').trim());
const NOKB = { reply_markup: { remove_keyboard: true } };

function resolveErr(r, en) {
  if (r.err === 'hidden') return en
    ? '⚠️ Their privacy settings hide their ID in forwarded messages. Ask them to send /id to this bot and send me the number, or use 👤 Pick a contact.'
    : '⚠️ إعدادات الخصوصية عنده تخفي معرّفه عند إعادة التوجيه. اطلب منه إرسال /id إلى هذا البوت وأرسل لي الرقم، أو استخدم زر 👤 اختيار جهة اتصال.';
  if (r.err === 'username') return en
    ? `⚠️ I don't know @${esc(r.username)} yet. Ask them to open this bot and press Start once, then send the username again — or send their ID / use 👤 Pick a contact.`
    : `⚠️ لا أعرف @${esc(r.username)} بعد. اطلب منه فتح هذا البوت والضغط على Start مرة واحدة ثم أعد إرسال اسم المستخدم — أو أرسل معرّفه (ID) أو استخدم زر 👤 اختيار جهة اتصال.`;
  if (r.err === 'bot') return en ? '⚠️ That is a bot, not a person.' : '⚠️ هذا بوت وليس شخصاً.';
  return en ? '⚠️ I could not read a user from that. Send an ID, a forwarded message, a @username, or use 👤 Pick a contact.' : '⚠️ لم أتعرف على مستخدم من رسالتك. أرسل المعرّف (ID) أو رسالة معاد توجيهها أو @username أو استخدم زر 👤 اختيار جهة اتصال.';
}

export function registerOwnerTools(bot, h) {
  const en = (ctx) => h.langOf(ctx) === 'en';
  const t = (ctx, ar, e) => (en(ctx) ? e : ar);
  const adminApi = () => h.apis().admin || bot.api;
  const adminName = () => h.botInfo.admin || 'Red_Alert_Syria_bot';

  // ------------------------------------------------------------------ pending input router
  bot.on('callback_query:data', async (ctx, next) => {
    if (!/^(xf|ed)/.test(ctx.callbackQuery.data) && pend.has(ctx.from.id)) pend.delete(ctx.from.id);
    return next();
  });
  bot.on('message', async (ctx, next) => {
    const p = pend.get(ctx.from?.id);
    if (!p) return next();
    if (!h.owner(ctx) || Date.now() > p.exp) { pend.delete(ctx.from.id); return next(); }
    const txt = ctx.message.text || '';
    if (txt.startsWith('/')) { pend.delete(ctx.from.id); return next(); }
    if (isCancel(txt)) {
      pend.delete(ctx.from.id);
      await ctx.reply(t(ctx, 'تم الإلغاء.', 'Cancelled.'), NOKB);
      return p.k === 'ed' ? showEditors(ctx, true) : showTransfer(ctx, true);
    }
    const fn = INPUT[p.k];
    if (!fn) { pend.delete(ctx.from.id); return next(); }
    return fn(ctx, p);
  });

  // ================================================================== 👥 EDITORS
  const editorsText = (ctx) => {
    const e = en(ctx);
    const list = store.state.editors.map((id) => '• ' + userLine(id, e)).join('\n');
    return e
      ? `👥 <b>Editors (${store.state.editors.length})</b>\n\nEditors use this same panel to <b>publish alerts, end/extend/delete them, clear the map, and review and answer reports</b>.\nThey <b>cannot</b>: add or remove editors, hand over the project, change settings or auto-delete, or open statistics and their schedules.\n\n${list || '— no editors yet —'}`
      : `👥 <b>المشرفون (${store.state.editors.length})</b>\n\nيستخدم المشرف نفس هذه اللوحة: <b>نشر التنبيهات، إنهاؤها وتمديدها وحذفها، تنظيف الخريطة، ومراجعة البلاغات والرد عليها</b>.\n<b>لا يستطيع</b>: إضافة أو إزالة مشرفين، نقل المشروع، تغيير الإعدادات أو الحذف التلقائي، أو فتح الإحصاءات وجدولتها.\n\n${list || '— لا يوجد مشرفون بعد —'}`;
  };
  const editorsKb = (ctx) => {
    const kb = new InlineKeyboard().text(t(ctx, '➕ إضافة مشرف', '➕ Add editor'), 'ed:add').row();
    for (const id of store.state.editors.slice(0, 40)) {
      const u = store.state.users[id];
      const nm = (u?.name || (u?.username ? '@' + u.username : String(id))).slice(0, 24);
      kb.text(`🗑 ${nm}`, `ed:rm:${id}`).row();
    }
    return kb.text(h.L(ctx).btnHome, 'home');
  };
  async function showEditors(ctx, fresh = false) {
    if (fresh) return ctx.reply(editorsText(ctx), { parse_mode: 'HTML', reply_markup: editorsKb(ctx) });
    return h.show(ctx, editorsText(ctx), editorsKb(ctx));
  }
  bot.callbackQuery('editors', async (ctx) => { await ctx.answerCallbackQuery(); if (h.owner(ctx)) await showEditors(ctx); });
  bot.command('editors', async (ctx) => (h.owner(ctx) ? showEditors(ctx, true) : ctx.reply(h.L(ctx).onlyOwner)));
  bot.callbackQuery('ed:add', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!h.owner(ctx)) return;
    setPend(ctx.from.id, 'ed');
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await ctx.reply(`➕ <b>${t(ctx, 'إضافة مشرف', 'Add an editor')}</b>\n\n${userInputHelp(en(ctx), adminName())}`,
      { parse_mode: 'HTML', reply_markup: pickerKb(en(ctx), 1) });
  });
  bot.callbackQuery(/^ed:rm:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!h.owner(ctx)) return;
    const id = Number(ctx.match[1]);
    if (!store.isEditor(id)) return showEditors(ctx);
    await h.show(ctx, t(ctx, `🗑 إزالة هذا المشرف؟\n\n${userLine(id, false)}\n\nسيفقد صلاحية النشر فوراً.`, `🗑 Remove this editor?\n\n${userLine(id, true)}\n\nThey lose publishing access immediately.`),
      new InlineKeyboard().text(t(ctx, '✅ نعم، أزله', '✅ Yes, remove'), `ed:rmy:${id}`).text(t(ctx, '↩️ رجوع', '↩️ Back'), 'editors'));
  });
  bot.callbackQuery(/^ed:rmy:(\d+)$/, async (ctx) => {
    if (!h.owner(ctx)) return ctx.answerCallbackQuery();
    const id = Number(ctx.match[1]);
    store.removeEditor(id);
    h.dropSessions(id);
    await ctx.answerCallbackQuery(t(ctx, 'تمت الإزالة', 'Removed'));
    adminApi().sendMessage(id, store.userLang(id) === 'en' ? 'ℹ️ Your editor access to the Red Alert Syria publishing bot was removed.' : 'ℹ️ تمت إزالة صلاحية الإشراف الخاصة بك في بوت النشر Red Alert Syria.').catch(() => {});
    await showEditors(ctx);
  });

  const INPUT = {};
  INPUT.ed = async (ctx) => {
    const e = en(ctx);
    const r = resolveUser(ctx.message);
    if (r.err) return ctx.reply(resolveErr(r, e), { parse_mode: 'HTML' });
    if (h.isOwnerId(r.id)) return ctx.reply(t(ctx, '⚠️ هذا هو المالك، لديه كل الصلاحيات أصلاً.', '⚠️ That is the owner, who already has every permission.'));
    if (botIdOf(config.botToken) === r.id || botIdOf(config.reportBotToken) === r.id) return ctx.reply(resolveErr({ err: 'bot' }, e));
    pend.delete(ctx.from.id);
    if (store.isEditor(r.id)) {
      await ctx.reply(t(ctx, `ℹ️ ${userLine(r.id, false)} مشرف بالفعل.`, `ℹ️ ${userLine(r.id, true)} is already an editor.`), { parse_mode: 'HTML', ...NOKB });
      return showEditors(ctx, true);
    }
    if (store.state.editors.length >= 50) return ctx.reply(t(ctx, '⚠️ الحد الأقصى 50 مشرفاً.', '⚠️ Maximum 50 editors.'), NOKB);
    store.addEditor(r.id);
    const el = store.userLang(r.id) === 'en';
    let reached = true;
    try {
      await adminApi().sendMessage(r.id, el
        ? '✅ <b>You are now an editor of Red Alert Syria.</b>\nYou can publish and manage alerts and review reports from this bot. Press /start to open the panel.'
        : '✅ <b>تمت إضافتك مشرفاً في Red Alert Syria.</b>\nتستطيع من هذا البوت نشر التنبيهات وإدارتها ومراجعة البلاغات. اضغط /start لفتح اللوحة.', { parse_mode: 'HTML' });
    } catch { reached = false; }
    await ctx.reply(`✅ ${t(ctx, 'أُضيف المشرف', 'Editor added')}: ${userLine(r.id, e)}` + (reached ? '' : '\n\n' + t(ctx,
      `⚠️ لم أستطع مراسلته بعد لأنه لم يفتح البوت. الصلاحية مفعّلة؛ اطلب منه فتح @${esc(adminName())} والضغط على Start.`,
      `⚠️ I could not message them yet (they never opened the bot). Access is active; ask them to open @${esc(adminName())} and press Start.`)), { parse_mode: 'HTML', ...NOKB });
    return showEditors(ctx, true);
  };

  // ================================================================== 🔁 PROJECT HAND-OVER
  const differsFromEnv = () => Number(config.ownerIds[0]) !== Number(envDefaults.ownerIds[0]) || config.botToken !== envDefaults.botToken
    || config.reportBotToken !== envDefaults.reportBotToken || config.channel !== envDefaults.channel;
  const transferText = (ctx) => {
    const e = en(ctx);
    const own = config.ownerIds[0];
    const durable = renderLinked()
      ? t(ctx, '✅ مربوط — كل تغيير يُحفظ في Render تلقائياً', '✅ linked — every change is saved to Render automatically')
      : differsFromEnv()
        ? t(ctx, '⚠️ غير مربوط — بعض التغييرات مؤقتة حتى ربط Render', '⚠️ not linked — some changes are temporary until Render is linked')
        : t(ctx, 'غير مربوط (اختياري، موصى به قبل تغيير التوكنات)', 'not linked (optional, recommended before changing tokens)');
    return (e ? '🔁 <b>Project hand-over</b>\n\n' : '🔁 <b>نقل المشروع</b>\n\n')
      + `👑 ${t(ctx, 'المالك', 'Owner')}: ${own ? userLine(own, e) : '—'}\n`
      + `🤖 ${t(ctx, 'بوت النشر', 'Publishing bot')}: @${esc(h.botInfo.admin || '—')}\n`
      + `📨 ${t(ctx, 'بوت التبليغ', 'Report bot')}: ${h.botInfo.report ? '@' + esc(h.botInfo.report) : '—'}\n`
      + `📢 ${t(ctx, 'القناة', 'Channel')}: ${esc(config.channel)}\n`
      + `🔗 Render: ${durable}\n\n`
      + t(ctx,
        'من هنا تنقل لوحة التحكم لمالك جديد فوراً، وتغيّر توكن أي بوت أو القناة بدون تعديل الخادم. نقل ملكية القناة والبوتين في تيليغرام وGitHub وRender يتم يدوياً — اضغط «📋 دليل النقل» للخطوات.',
        'From here you hand the control panel to a new owner instantly and change either bot token or the channel without touching the server. Moving the Telegram channel/bots, GitHub and Render is done by hand — tap “📋 Hand-over guide” for the steps.');
  };
  const transferKb = (ctx) => new InlineKeyboard()
    .text(t(ctx, '👤 نقل الملكية لمالك جديد', '👤 Hand over to a new owner'), 'xf:own').row()
    .text(t(ctx, '🤖 توكن بوت النشر', '🤖 Publishing bot token'), 'xf:tok:admin').text(t(ctx, '📨 توكن بوت التبليغ', '📨 Report bot token'), 'xf:tok:report').row()
    .text(t(ctx, '📢 تغيير القناة', '📢 Change channel'), 'xf:ch').text(renderLinked() ? '🔗 Render ✅' : t(ctx, '🔗 ربط Render', '🔗 Link Render'), 'xf:rk').row()
    .text(t(ctx, '📋 دليل النقل خطوة بخطوة', '📋 Step-by-step hand-over guide'), 'xf:guide').row()
    .text(h.L(ctx).btnHome, 'home');
  async function showTransfer(ctx, fresh = false) {
    if (fresh) return ctx.reply(transferText(ctx), { parse_mode: 'HTML', reply_markup: transferKb(ctx), link_preview_options: { is_disabled: true } });
    return h.show(ctx, transferText(ctx), transferKb(ctx));
  }
  bot.callbackQuery('xf', async (ctx) => { await ctx.answerCallbackQuery(); if (h.owner(ctx)) { pend.delete(ctx.from.id); await showTransfer(ctx); } });
  bot.command('transfer', async (ctx) => (h.owner(ctx) ? showTransfer(ctx, true) : ctx.reply(h.L(ctx).onlyOwner)));
  const backKb = (ctx) => new InlineKeyboard().text(t(ctx, '✖️ إلغاء', '✖️ Cancel'), 'xf');

  // ---------------- 👤 new owner
  bot.callbackQuery('xf:own', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!h.owner(ctx)) return;
    setPend(ctx.from.id, 'own');
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await ctx.reply(`👤 <b>${t(ctx, 'نقل الملكية لمالك جديد', 'Hand over to a new owner')}</b>\n\n${t(ctx,
      'المالك الجديد يجب أن يفتح هذا البوت ويضغط Start أولاً.',
      'The new owner must open this bot and press Start first.')}\n\n${userInputHelp(en(ctx), adminName())}`,
    { parse_mode: 'HTML', reply_markup: pickerKb(en(ctx), 2) });
  });
  INPUT.own = async (ctx) => {
    const e = en(ctx);
    const r = resolveUser(ctx.message);
    if (r.err) return ctx.reply(resolveErr(r, e), { parse_mode: 'HTML' });
    if (h.isOwnerId(r.id)) return ctx.reply(t(ctx, '⚠️ أنت المالك الحالي بالفعل. أرسل معرّف المالك الجديد.', '⚠️ You are already the owner. Send the new owner’s ID.'));
    if (botIdOf(config.botToken) === r.id || botIdOf(config.reportBotToken) === r.id) return ctx.reply(resolveErr({ err: 'bot' }, e));
    try { await adminApi().sendChatAction(r.id, 'typing'); } catch {
      return ctx.reply(t(ctx,
        `⚠️ ${userLine(r.id, false)} لم يفتح البوت بعد. اطلب منه فتح @${esc(adminName())} والضغط على Start، ثم أرسل معرّفه مرة أخرى.`,
        `⚠️ ${userLine(r.id, true)} has not opened the bot yet. Ask them to open @${esc(adminName())} and press Start, then send their ID again.`), { parse_mode: 'HTML' });
    }
    setPend(ctx.from.id, 'own2', { id: r.id });
    await ctx.reply(t(ctx, '✔️ تم التعرف على المستخدم.', '✔️ User found.'), NOKB);
    await ctx.reply(t(ctx,
      `⚠️ <b>تأكيد نقل الملكية</b>\n\nالمالك الجديد: ${userLine(r.id, false)}\n\nبعد النقل يصبح هو <b>المالك الوحيد</b> (النقل، المشرفون، الإعدادات، الإحصاءات) وتفقد أنت صلاحيات المالك فوراً. الموقع والقناة والبوتان يستمرون بالعمل كما هم. لا يمكن التراجع إلا إذا أعاد هو الملكية إليك.\n\nهل تريد البقاء مشرفاً بعد النقل؟`,
      `⚠️ <b>Confirm the hand-over</b>\n\nNew owner: ${userLine(r.id, true)}\n\nAfter this they become the <b>only owner</b> (hand-over, editors, settings, statistics) and you lose owner rights immediately. The site, channel and both bots keep working. It can only be undone if they hand it back.\n\nDo you want to stay as an editor?`),
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard()
      .text(t(ctx, '✅ نقل وإبقائي مشرفاً', '✅ Hand over, keep me as editor'), 'xf:oy:k').row()
      .text(t(ctx, '✅ نقل وإزالتي تماماً', '✅ Hand over, remove me'), 'xf:oy:x').row()
      .text(t(ctx, '✖️ إلغاء', '✖️ Cancel'), 'xf') });
  };
  bot.callbackQuery(/^xf:oy:(k|x)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const p = pend.get(ctx.from.id);
    if (!h.owner(ctx)) return;
    if (!p || p.k !== 'own2' || Date.now() > p.exp) return showTransfer(ctx);
    const code = String(p.id).slice(-4);
    setPend(ctx.from.id, 'own3', { id: p.id, keep: ctx.match[1] === 'k', code });
    await h.show(ctx, t(ctx,
      `🔐 <b>التأكيد الأخير</b>\n\nللتأكيد اكتب حرفياً:\n<code>نقل ${code}</code>\n\n(آخر 4 أرقام من معرّف المالك الجديد). أي رسالة أخرى تلغي العملية. صالح لمدة 5 دقائق.`,
      `🔐 <b>Final confirmation</b>\n\nType exactly:\n<code>TRANSFER ${code}</code>\n\n(the last 4 digits of the new owner’s ID). Anything else cancels. Valid for 5 minutes.`), backKb(ctx));
  });
  INPUT.own2 = async (ctx) => ctx.reply(t(ctx, 'اختر أحد الزرين أعلاه للمتابعة أو اضغط إلغاء.', 'Choose one of the buttons above to continue, or Cancel.'));
  INPUT.own3 = async (ctx, p) => {
    pend.delete(ctx.from.id);
    const typed = String(ctx.message.text || '').trim().replace(/\s+/g, ' ');
    if (typed !== `نقل ${p.code}` && typed.toUpperCase() !== `TRANSFER ${p.code}`) {
      await ctx.reply(t(ctx, '✖️ النص غير مطابق — أُلغيت عملية النقل ولم يتغير شيء.', '✖️ Text did not match — the hand-over was cancelled, nothing changed.'));
      return showTransfer(ctx, true);
    }
    const prev = Number(config.ownerIds[0]);
    const next = Number(p.id);
    store.setProject({ ownerId: next, prevOwnerId: prev });
    applyProject(store.project);
    store.removeEditor(next);
    if (p.keep) store.addEditor(prev); else store.removeEditor(prev);
    h.dropSessions(prev);
    const env = renderLinked() ? await renderSetEnv({ OWNER_IDS: String(next) }) : null;
    store.persist();
    store.flushBackup().catch(() => {});
    console.log(`[owner] project handed over ${prev} -> ${next} (keep=${p.keep})`);
    const ne = store.userLang(next) === 'en';
    try {
      await adminApi().sendMessage(next, ne
        ? `👑 <b>You are now the owner of Red Alert Syria.</b>\n\nThe publishing panel, editors, statistics and the 🔁 Project hand-over screen are yours. Next steps (channel, bots in BotFather, GitHub, Render) are in “📋 Hand-over guide”.`
        : `👑 <b>أصبحت الآن مالك Red Alert Syria.</b>\n\nلوحة النشر والمشرفون والإحصاءات وشاشة «🔁 نقل المشروع» أصبحت لك. الخطوات التالية (القناة، البوتان في BotFather، GitHub، Render) موجودة في «📋 دليل النقل».`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text(ne ? '📋 Hand-over guide' : '📋 دليل النقل', 'xf:guide').row().text(ne ? '🏠 Main menu' : '🏠 القائمة الرئيسية', 'home') });
    } catch (e) { console.warn('[owner] could not notify new owner', e.description || e.message); }
    await ctx.reply(t(ctx,
      `✅ <b>تم نقل الملكية</b> إلى ${userLine(next, false)}.\n${p.keep ? 'بقيت مشرفاً وتستطيع النشر.' : 'لم تعد لديك صلاحيات في بوت النشر.'}\n\nما تبقى يدوياً: نقل ملكية القناة، ونقل البوتين من BotFather، والمستودع على GitHub، وخدمة Render — التفاصيل في الدليل.${env && !env.ok ? '\n\n⚠️ تعذّر تحديث Render الآن؛ المالك الجديد يستطيع إعادة الربط من «🔗 ربط Render».' : ''}`,
      `✅ <b>Hand-over done</b> to ${userLine(next, true)}.\n${p.keep ? 'You stay as an editor and can still publish.' : 'You no longer have access to the publishing bot.'}\n\nLeft to do by hand: channel ownership, both bots in BotFather, the GitHub repo and the Render service — see the guide.${env && !env.ok ? '\n\n⚠️ Could not update Render now; the new owner can re-link from “🔗 Link Render”.' : ''}`),
    { parse_mode: 'HTML', reply_markup: p.keep ? new InlineKeyboard().text('📋 ' + t(ctx, 'دليل النقل', 'Hand-over guide'), 'xf:guide:pub').row().text(h.L(ctx).btnHome, 'home') : new InlineKeyboard().text('📋 ' + t(ctx, 'دليل النقل', 'Hand-over guide'), 'xf:guide:pub') });
  };

  // ---------------- 🤖 / 📨 bot tokens
  bot.callbackQuery(/^xf:tok:(admin|report)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!h.owner(ctx)) return;
    const role = ctx.match[1];
    setPend(ctx.from.id, 'tok', { role });
    const warn = !renderLinked() && role === 'admin' ? '\n\n' + t(ctx,
      '⚠️ <b>Render غير مربوط:</b> بدون الربط سيعود الخادم إلى التوكن القديم عند أول إعادة تشغيل أو نشر. يُنصح بالضغط على «🔗 ربط Render» أولاً.',
      '⚠️ <b>Render is not linked:</b> without it the server goes back to the old token on the next restart or deploy. Tap “🔗 Link Render” first (recommended).') : '';
    await h.show(ctx, (role === 'admin'
      ? t(ctx, '🤖 <b>توكن بوت النشر</b>\n\nأرسل التوكن الجديد من @BotFather (مثل <code>123456:ABC…</code>). سأحذف رسالتك فوراً.\n\n• إن كان بوتاً جديداً: أضفه مشرفاً في القناة بصلاحية النشر والتعديل والحذف، وافتحه واضغط Start قبل إرسال التوكن.\n• إن عملت Revoke لنفس البوت: أرسل التوكن الجديد هنا مباشرة.',
        '🤖 <b>Publishing bot token</b>\n\nSend the new token from @BotFather (like <code>123456:ABC…</code>). I delete your message right away.\n\n• New bot: make it a channel admin with post/edit/delete rights, open it and press Start before sending the token.\n• Revoked token of the same bot: just send the new token here.')
      : t(ctx, '📨 <b>توكن بوت التبليغ</b>\n\nأرسل التوكن الجديد من @BotFather. سأحذف رسالتك فوراً. البلاغات الجديدة ستصل عبر البوت الجديد، وأزرار «أرسل بلاغاً» تتحدث تلقائياً.',
        '📨 <b>Report bot token</b>\n\nSend the new token from @BotFather. I delete your message right away. New reports will come through the new bot and the “Send a report” buttons update automatically.')) + warn,
    backKb(ctx));
  });
  // Validate a token for a role. Returns { ok, me, api } or { ok:false, msg }.
  async function checkToken(token, role, lang) {
    const e = lang === 'en';
    if (!TOKEN_RE.test(token)) return { ok: false, msg: e ? '⚠️ That does not look like a bot token (123456789:ABC…).' : '⚠️ هذا لا يشبه توكن بوت (123456789:ABC…).' };
    const api = apiFactory.make(token);
    let me;
    try { me = await api.getMe(); } catch { return { ok: false, msg: e ? '⚠️ Telegram rejected this token (wrong or revoked).' : '⚠️ رفض تيليغرام هذا التوكن (خاطئ أو ملغى).' }; }
    const otherToken = role === 'admin' ? config.reportBotToken : config.botToken;
    if (otherToken && botIdOf(otherToken) === me.id) return { ok: false, msg: e ? '⚠️ This is the other bot. The publishing bot and the report bot must be two different bots.' : '⚠️ هذا هو البوت الآخر. بوت النشر وبوت التبليغ يجب أن يكونا بوتين مختلفين.' };
    if (role === 'admin') {
      const owner = config.ownerIds[0];
      try { await api.sendChatAction(owner, 'typing'); } catch {
        return { ok: false, msg: e ? `⚠️ Open @${esc(me.username)} and press Start first (the owner must have started it), then send the token again.` : `⚠️ افتح @${esc(me.username)} واضغط Start أولاً (يجب أن يكون المالك قد بدأ المحادثة معه)، ثم أعد إرسال التوكن.` };
      }
      try {
        const cm = await api.getChatMember(config.channel, me.id);
        const ok = cm.status === 'administrator' && cm.can_post_messages !== false && cm.can_edit_messages !== false && cm.can_delete_messages !== false;
        if (!ok) throw new Error('rights');
      } catch {
        return { ok: false, msg: e ? `⚠️ @${esc(me.username)} is not an admin of ${esc(config.channel)} with post, edit and delete rights. Add it as admin, then send the token again.` : `⚠️ @${esc(me.username)} ليس مشرفاً في ${esc(config.channel)} بصلاحيات النشر والتعديل والحذف. أضفه مشرفاً ثم أعد إرسال التوكن.` };
      }
    }
    return { ok: true, me, api };
  }
  INPUT.tok = async (ctx, p) => {
    const token = String(ctx.message.text || '').trim();
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    const chk = await checkToken(token, p.role, h.langOf(ctx));
    if (!chk.ok) return ctx.reply(chk.msg, { parse_mode: 'HTML', reply_markup: backKb(ctx) });
    const cur = p.role === 'admin' ? config.botToken : config.reportBotToken;
    if (token === cur) { pend.delete(ctx.from.id); await ctx.reply(t(ctx, 'ℹ️ هذا هو التوكن المستخدم حالياً، لا تغيير.', 'ℹ️ That is the token already in use, nothing changed.')); return showTransfer(ctx, true); }
    setPend(ctx.from.id, 'tok2', { role: p.role, token, username: chk.me.username });
    await ctx.reply(t(ctx,
      `✔️ التوكن صالح: @${esc(chk.me.username)}\n\nتبديل ${p.role === 'admin' ? 'بوت النشر' : 'بوت التبليغ'} إليه الآن؟`,
      `✔️ Token is valid: @${esc(chk.me.username)}\n\nSwitch the ${p.role === 'admin' ? 'publishing bot' : 'report bot'} to it now?`),
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text(t(ctx, '✅ تبديل الآن', '✅ Switch now'), 'xf:toky').text(t(ctx, '✖️ إلغاء', '✖️ Cancel'), 'xf') });
  };
  INPUT.tok2 = INPUT.own2;
  bot.callbackQuery('xf:toky', async (ctx) => {
    const p = pend.get(ctx.from.id);
    if (!h.owner(ctx)) return ctx.answerCallbackQuery();
    if (!p || p.k !== 'tok2' || Date.now() > p.exp) { await ctx.answerCallbackQuery(); return showTransfer(ctx); }
    pend.delete(ctx.from.id);
    await ctx.answerCallbackQuery(t(ctx, 'جارٍ التبديل…', 'Switching…'));
    const r = await applyToken(p.role, p.token, p.username);
    const e = en(ctx);
    const txt = !r.ok
      ? (e ? `⚠️ Switch failed (${esc(r.reason)}). Nothing changed.` : `⚠️ فشل التبديل (${esc(r.reason)}). لم يتغير شيء.`)
      : p.role === 'admin'
        ? (e ? `✅ The publishing bot is now @${esc(p.username)}. Continue there — this chat is no longer the panel.` : `✅ أصبح بوت النشر الآن @${esc(p.username)}. تابع من هناك — هذه المحادثة لم تعد اللوحة.`)
        : (e ? `✅ The report bot is now @${esc(p.username)}.` : `✅ أصبح بوت التبليغ الآن @${esc(p.username)}.`);
    const extra = r.ok && r.env && !r.env.ok ? '\n\n' + t(ctx, '⚠️ تعذّر حفظه في Render الآن — أعد الربط من «🔗 ربط Render».', '⚠️ Could not save it to Render now — re-link from “🔗 Link Render”.') : '';
    try { await ctx.editMessageText(txt + extra, { parse_mode: 'HTML' }); } catch { /* old bot may be gone */ }
    if (r.ok && p.role === 'admin') {
      try { await adminApi().sendMessage(ctx.from.id, (e ? '✅ This is now the Red Alert Syria publishing bot.' : '✅ هذا الآن بوت النشر الخاص بـ Red Alert Syria.') + extra, { reply_markup: h.mainKeyboard(ctx) }); } catch { /* ignore */ }
    } else if (r.ok) await showTransfer(ctx, true);
  });
  async function applyToken(role, token, username) {
    const prevProject = { ...store.project };
    const patch = role === 'admin' ? { botToken: token } : { reportBotToken: token, reportBotUsername: username };
    store.setProject(patch);
    applyProject(store.project);
    try {
      await runtimeHooks.reloadBots?.([role]);
    } catch (e) {
      console.error('[owner] bot reload failed', e.message);
      store.state.settings.project = prevProject; store.persist();
      applyProject(store.project);
      try { await runtimeHooks.reloadBots?.([role]); } catch { /* ignore */ }
      return { ok: false, reason: e.description || e.message };
    }
    const env = renderLinked() ? await renderSetEnv(role === 'admin' ? { BOT_TOKEN: token } : { REPORT_BOT_TOKEN: token, REPORT_BOT_USERNAME: username }) : null;
    store.flushBackup().catch(() => {});
    if (role === 'report') h.resync?.();
    console.log(`[owner] ${role} bot switched to @${username}`);
    return { ok: true, env };
  }
  h.applyToken = applyToken; h.checkToken = checkToken;

  // ---------------- 📢 channel
  bot.callbackQuery('xf:ch', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!h.owner(ctx)) return;
    setPend(ctx.from.id, 'ch');
    await h.show(ctx, t(ctx,
      `📢 <b>تغيير القناة</b>\n\nالقناة الحالية: ${esc(config.channel)}\n\nأضف @${esc(adminName())} مشرفاً في القناة الجديدة بصلاحيات النشر والتعديل والحذف، ثم أرسل اسمها مثل <code>@MyChannel</code> أو رابطها <code>https://t.me/MyChannel</code>، أو أعِد توجيه أي منشور منها إلى هنا.`,
      `📢 <b>Change channel</b>\n\nCurrent channel: ${esc(config.channel)}\n\nMake @${esc(adminName())} an admin of the new channel with post, edit and delete rights, then send its name like <code>@MyChannel</code> or link <code>https://t.me/MyChannel</code>, or forward any post from it here.`), backKb(ctx));
  });
  INPUT.ch = async (ctx) => {
    const msg = ctx.message;
    let target = null;
    if (msg.forward_origin?.type === 'channel') target = msg.forward_origin.chat.id;
    else {
      const m = String(msg.text || '').trim().match(/^(?:https?:\/\/)?(?:t\.me\/|@)([A-Za-z][A-Za-z0-9_]{3,31})\/?$/);
      if (m) target = '@' + m[1];
      else if (/^-100\d{6,}$/.test(String(msg.text || '').trim())) target = Number(msg.text.trim());
    }
    if (!target) return ctx.reply(t(ctx, '⚠️ أرسل اسم القناة مثل @MyChannel أو رابطها أو أعِد توجيه منشور منها.', '⚠️ Send the channel like @MyChannel, its link, or forward a post from it.'), { reply_markup: backKb(ctx) });
    const api = adminApi();
    let chat;
    try { chat = await api.getChat(target); } catch { return ctx.reply(t(ctx, '⚠️ لم أجد هذه القناة، أو أن البوت ليس عضواً فيها.', '⚠️ Channel not found, or the bot is not a member.'), { reply_markup: backKb(ctx) }); }
    if (chat.type !== 'channel') return ctx.reply(t(ctx, '⚠️ هذه ليست قناة.', '⚠️ That is not a channel.'), { reply_markup: backKb(ctx) });
    try {
      const cm = await api.getChatMember(chat.id, botIdOf(config.botToken));
      if (!(cm.status === 'administrator' && cm.can_post_messages !== false && cm.can_edit_messages !== false && cm.can_delete_messages !== false)) throw new Error('rights');
    } catch {
      return ctx.reply(t(ctx, `⚠️ @${esc(adminName())} ليس مشرفاً في هذه القناة بصلاحيات النشر والتعديل والحذف.`, `⚠️ @${esc(adminName())} is not an admin there with post, edit and delete rights.`), { parse_mode: 'HTML', reply_markup: backKb(ctx) });
    }
    const channel = chat.username ? '@' + chat.username : String(chat.id);
    if (String(channel).toLowerCase() === String(config.channel).toLowerCase()) { pend.delete(ctx.from.id); await ctx.reply(t(ctx, 'ℹ️ هذه هي القناة الحالية.', 'ℹ️ That is the current channel.')); return showTransfer(ctx, true); }
    const url = chat.username ? `https://t.me/${chat.username}` : (chat.invite_link || config.channelUrl);
    setPend(ctx.from.id, 'ch2', { channel, url, title: chat.title });
    await ctx.reply(t(ctx,
      `✔️ القناة: <b>${esc(chat.title)}</b> (${esc(channel)})\n\nالنشر من الآن سيكون فيها. المنشورات القديمة تبقى في القناة السابقة ولن تُعدَّل بعد ذلك. متابعة؟`,
      `✔️ Channel: <b>${esc(chat.title)}</b> (${esc(channel)})\n\nFrom now on alerts are posted there. Old posts stay in the previous channel and won't be edited any more. Continue?`),
    { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text(t(ctx, '✅ تغيير القناة', '✅ Change channel'), 'xf:chy').text(t(ctx, '✖️ إلغاء', '✖️ Cancel'), 'xf') });
  };
  INPUT.ch2 = INPUT.own2;
  bot.callbackQuery('xf:chy', async (ctx) => {
    await ctx.answerCallbackQuery();
    const p = pend.get(ctx.from.id);
    if (!h.owner(ctx)) return;
    if (!p || p.k !== 'ch2' || Date.now() > p.exp) return showTransfer(ctx);
    pend.delete(ctx.from.id);
    store.setProject({ channel: p.channel, channelUrl: p.url });
    applyProject(store.project);
    for (const a of store.state.alerts) { if (a.channel_message_id) { delete a.channel_message_id; delete a.channel_media; } }
    store.persist();
    const env = renderLinked() ? await renderSetEnv({ CHANNEL_ID: p.channel, CHANNEL_URL: p.url }) : null;
    store.flushBackup().catch(() => {});
    console.log(`[owner] channel changed to ${p.channel}`);
    await h.show(ctx, t(ctx, `✅ أصبحت القناة الآن ${esc(p.channel)}.`, `✅ The channel is now ${esc(p.channel)}.`) + (env && !env.ok ? '\n\n⚠️ Render' : ''),
      new InlineKeyboard().text(t(ctx, '↩️ نقل المشروع', '↩️ Project hand-over'), 'xf').row().text(h.L(ctx).btnHome, 'home'));
  });

  // ---------------- 🔗 Render link
  bot.callbackQuery('xf:rk', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!h.owner(ctx)) return;
    setPend(ctx.from.id, 'rk');
    await h.show(ctx, t(ctx,
      `🔗 <b>ربط Render (حفظ دائم)</b>\n\n${renderLinked() ? '✅ مربوط حالياً. أرسل مفتاحاً جديداً فقط إن أردت استبداله.\n\n' : ''}الخادم المجاني على Render يمسح ملفاته عند كل إعادة تشغيل، لذلك أحفظ المالك والتوكنات والقناة في متغيرات Render نفسها.\n\n1) افتح dashboard.render.com ← صورة حسابك ← <b>Account Settings</b> ← <b>API Keys</b> ← <b>Create API Key</b>.\n2) انسخ المفتاح (يبدأ بـ <code>rnd_</code>) وأرسله هنا. سأحذف رسالتك فوراً ولن يُحفظ في النسخ الاحتياطية.`,
      `🔗 <b>Link Render (durable settings)</b>\n\n${renderLinked() ? '✅ Linked. Send a new key only to replace it.\n\n' : ''}The free Render server wipes its files on every restart, so I save owner, tokens and channel in Render's own environment variables.\n\n1) Open dashboard.render.com → your avatar → <b>Account Settings</b> → <b>API Keys</b> → <b>Create API Key</b>.\n2) Copy the key (starts with <code>rnd_</code>) and send it here. I delete your message at once; it is never stored in backups.`), backKb(ctx));
  });
  INPUT.rk = async (ctx) => {
    const key = String(ctx.message.text || '').trim();
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    const r = await renderLink(key);
    if (!r.ok) {
      const why = { format: t(ctx, 'هذا لا يشبه مفتاح Render (يبدأ بـ rnd_).', 'That does not look like a Render key (starts with rnd_).'),
        auth: t(ctx, 'Render رفض المفتاح أو لا يملك صلاحية على هذه الخدمة.', 'Render rejected the key or it has no access to this service.'),
        service: t(ctx, 'لم أجد هذه الخدمة في حساب Render صاحب المفتاح.', 'This service is not in the key owner’s Render account.'),
        network: t(ctx, 'تعذّر الاتصال بـ Render الآن، حاول بعد قليل.', 'Could not reach Render now, try again shortly.') }[r.reason] || r.reason;
      return ctx.reply('⚠️ ' + why, { reply_markup: backKb(ctx) });
    }
    pend.delete(ctx.from.id);
    const env = await renderSetEnv({
      OWNER_IDS: config.ownerIds.join(','), BOT_TOKEN: config.botToken, REPORT_BOT_TOKEN: config.reportBotToken,
      CHANNEL_ID: config.channel, CHANNEL_URL: config.channelUrl, REPORT_BOT_USERNAME: config.reportBotUsername,
    });
    await ctx.reply(env.ok
      ? t(ctx, `✅ تم ربط Render (${esc(r.name)}). المالك والتوكنات والقناة محفوظة الآن بشكل دائم، وأي تغيير لاحق يُحفظ تلقائياً.`, `✅ Render linked (${esc(r.name)}). Owner, tokens and channel are now saved permanently, and later changes are saved automatically.`)
      : t(ctx, '⚠️ تم الربط لكن تعذّر حفظ الإعدادات الآن؛ أعد المحاولة.', '⚠️ Linked, but saving the settings failed; try again.'), { parse_mode: 'HTML' });
    return showTransfer(ctx, true);
  };

  // ---------------- 📋 guide
  const guide = (e) => {
    const own = config.ownerIds[0];
    const site = config.publicUrl || 'https://red-alert-syria.onrender.com';
    const envList = `<code>BOT_TOKEN</code> = ${e ? 'publishing bot token' : 'توكن بوت النشر'}\n<code>REPORT_BOT_TOKEN</code> = ${e ? 'report bot token' : 'توكن بوت التبليغ'}\n<code>OWNER_IDS</code> = ${e ? 'new owner ID' : 'معرّف المالك الجديد'} (${e ? 'now' : 'الآن'}: <code>${own}</code>)\n<code>CHANNEL_ID</code> = <code>${esc(config.channel)}</code>\n<code>CHANNEL_URL</code> = <code>${esc(config.channelUrl)}</code>\n<code>REPORT_BOT_USERNAME</code> = <code>${esc(config.reportBotUsername)}</code>\n<code>NODE_VERSION</code> = <code>22</code>`;
    return e ? [
      `📋 <b>Hand-over guide (1/2)</b>\n\n<b>0) Before you start</b> — on both accounts turn on Two-Step Verification (Settings → Privacy and Security → Two-Step Verification). Telegram only allows moving a channel or a bot after 2-step verification has been on for about 7 days. The new owner opens @${esc(adminName())} and presses Start.\n\n<b>1) Control panel (instant, here)</b> — 🔁 Project hand-over → 👤 Hand over to a new owner. The site, channel and bots keep running.\n\n<b>2) Channel ${esc(config.channel)}</b> — in Telegram: channel → ✏️ Edit → Administrators → Add Admin → the new owner (all rights) → open their admin entry → <b>Transfer Channel Ownership</b> → enter your 2-step password. Keep @${esc(adminName())} as admin with post/edit/delete rights.\n\n<b>3) Both bots</b> — in @BotFather: /mybots → @${esc(adminName())} → <b>Transfer Ownership</b> → Choose recipient → confirm. Repeat for @${esc(h.botInfo.report || config.reportBotUsername)}. Tokens stay the same, so nothing breaks. If the new owner later presses Revoke in BotFather, he must immediately paste the new token in 🔁 → 🤖/📨 (if the publishing bot's token was revoked, send <code>/setadmintoken NEW_TOKEN</code> to the report bot instead).`,
      `📋 <b>Hand-over guide (2/2)</b>\n\n<b>4) GitHub</b> — ${esc(REPO_URL)} → Settings → General → Danger Zone → <b>Transfer ownership</b> → the buyer's GitHub username.\n\n<b>5) Render</b> — Render cannot move a service to another account (official FAQ). Two options:\n• <b>Simple:</b> keep it on the current Render account and invite the buyer: Workspace Settings → Members → Invite (Admin).\n• <b>Full move:</b> the buyer signs up on render.com → New → <b>Blueprint</b> (or Web Service) → picks the transferred repo (render.yaml sets build/start) and fills these variables:\n${envList}\nThe data (alerts, editors, statistics) comes back by itself from the backup pinned in the owner's chat with @${esc(adminName())}. When the new service works: open the old one → Settings → <b>Suspend</b> (two servers with the same bots fight over the webhook). If the address changed, update the URL in <code>.github/workflows/keep-alive.yml</code> (keep-awake pings).\n\n<b>6) Finally</b> — on the new service press 🔁 → 🔗 Link Render so later changes are saved permanently.\n\nSite now: ${esc(site)}`,
    ] : [
      `📋 <b>دليل نقل المشروع (1/2)</b>\n\n<b>0) قبل البدء</b> — فعّل «التحقق بخطوتين» على الحسابين (الإعدادات ← الخصوصية والأمان ← التحقق بخطوتين). تيليغرام لا يسمح بنقل قناة أو بوت إلا بعد مرور نحو 7 أيام على تفعيله. والمالك الجديد يفتح @${esc(adminName())} ويضغط Start.\n\n<b>1) لوحة التحكم (فوري، من هنا)</b> — 🔁 نقل المشروع ← 👤 نقل الملكية لمالك جديد. الموقع والقناة والبوتان يستمرون بالعمل.\n\n<b>2) القناة ${esc(config.channel)}</b> — في تيليغرام: القناة ← ✏️ تعديل ← المشرفون ← إضافة مشرف ← المالك الجديد (كل الصلاحيات) ← افتح صفحة صلاحياته ← <b>نقل ملكية القناة</b> ← أدخل كلمة مرور التحقق بخطوتين. أبقِ @${esc(adminName())} مشرفاً بصلاحيات النشر والتعديل والحذف.\n\n<b>3) البوتان</b> — في @BotFather: ‎/mybots ← @${esc(adminName())} ← <b>Transfer Ownership</b> ← Choose recipient ← تأكيد. كرر ذلك لـ @${esc(h.botInfo.report || config.reportBotUsername)}. التوكنات تبقى كما هي فلا يتعطل شيء. إن ضغط المالك الجديد لاحقاً Revoke في BotFather فعليه لصق التوكن الجديد فوراً من 🔁 ← 🤖/📨 (وإن أُلغي توكن بوت النشر نفسه، يرسل إلى بوت التبليغ: <code>/setadmintoken التوكن_الجديد</code>).`,
      `📋 <b>دليل نقل المشروع (2/2)</b>\n\n<b>4) GitHub</b> — ${esc(REPO_URL)} ← Settings ← General ← Danger Zone ← <b>Transfer ownership</b> ← اسم مستخدم المشتري على GitHub.\n\n<b>5) Render</b> — لا يسمح Render بنقل خدمة إلى حساب آخر (حسب أسئلته الرسمية). خياران:\n• <b>الأبسط:</b> تبقى الخدمة على حساب Render الحالي وتدعو المشتري: Workspace Settings ← Members ← Invite (Admin).\n• <b>نقل كامل:</b> المشتري ينشئ حساباً على render.com ← New ← <b>Blueprint</b> (أو Web Service) ← يختار المستودع المنقول (ملف render.yaml يضبط البناء والتشغيل) ويملأ هذه المتغيرات:\n${envList}\nالبيانات (التنبيهات، المشرفون، الإحصاءات) تعود وحدها من النسخة الاحتياطية المثبتة في محادثة المالك مع @${esc(adminName())}. بعد أن تعمل الخدمة الجديدة: افتح القديمة ← Settings ← <b>Suspend</b> (خادمان بنفس البوتين يتنازعان على الويبهوك). وإن تغيّر العنوان، حدّث الرابط في <code>.github/workflows/keep-alive.yml</code> (نبضات الإبقاء مستيقظاً).\n\n<b>6) أخيراً</b> — من الخدمة الجديدة اضغط 🔁 ← 🔗 ربط Render ليُحفظ أي تغيير لاحق بشكل دائم.\n\nالموقع الآن: ${esc(site)}`,
    ];
  };
  bot.callbackQuery(/^xf:guide(:pub)?$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    // the previous owner may still read the guide right after handing over (xf:guide:pub)
    if (!h.owner(ctx) && !(ctx.match[1] && Number(store.project.prevOwnerId) === ctx.from.id)) return;
    const [a, b] = guide(en(ctx));
    await ctx.reply(a, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    await ctx.reply(b, { parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      reply_markup: h.owner(ctx) ? new InlineKeyboard().text(t(ctx, '↩️ نقل المشروع', '↩️ Project hand-over'), 'xf').row().text(h.L(ctx).btnHome, 'home') : undefined });
  });
}

// Report bot: the owner can recover a revoked publishing-bot token from here (the publishing bot is dead then).
export function registerReportOwnerCommands(bot, h) {
  bot.command('setadmintoken', async (ctx) => {
    if (!h.isOwnerId(ctx.from?.id)) return; // silent for everyone else
    const token = String(ctx.match || '').trim();
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    const lang = store.userLang(ctx.from.id);
    if (!h.applyToken || !h.checkToken) return;
    const chk = await h.checkToken(token, 'admin', lang);
    if (!chk.ok) return ctx.reply(chk.msg, { parse_mode: 'HTML' });
    const r = await h.applyToken('admin', token, chk.me.username);
    await ctx.reply(r.ok
      ? (lang === 'en' ? `✅ Publishing bot switched to @${chk.me.username}.` : `✅ تم تبديل بوت النشر إلى @${chk.me.username}.`)
      : (lang === 'en' ? '⚠️ Switch failed, nothing changed.' : '⚠️ فشل التبديل، لم يتغير شيء.'));
  });
}
