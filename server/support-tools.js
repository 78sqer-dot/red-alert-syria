// Owner-only controls for the optional public wallet-support section.
// Wallet settings stay in the private persisted store; public data is exposed only while enabled.
import { randomUUID } from 'node:crypto';
import { InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { store } from './store.js';
import { cleanSupportLabel, parseWalletPhone } from './support-config.js';

const PEND_MS = 10 * 60_000;
const pending = new Map();
const esc = (s) => String(s ?? '').replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' })[c]);
const isCancel = (s) => /^✖️\s*(إلغاء|Cancel)$/i.test(String(s || '').trim());

export function registerSupportTools(bot, h) {
  const en = (ctx) => h.langOf(ctx) === 'en';
  const t = (ctx, ar, english) => en(ctx) ? english : ar;

  const screenText = (ctx) => {
    const s = store.support;
    return (en(ctx)
      ? '💝 <b>Optional website support</b>\n\nThe feature starts <b>off</b>. Your wallet details remain private until you deliberately enable the section. Visitors transfer directly from a wallet app they choose; this website does not receive or process money and charges no fee.\n\n'
      : '💝 <b>الدعم الاختياري في الموقع</b>\n\nالميزة <b>متوقفة افتراضياً</b>. تبقى بيانات المحفظة خاصة إلى أن تفعّل القسم بنفسك. يحوّل الزائر مباشرةً من تطبيق المحفظة الذي يختاره؛ الموقع لا يستقبل الأموال ولا يعالج المدفوعات ولا يفرض رسوماً.\n\n')
      + `${t(ctx, 'الحالة', 'Status')}: <b>${s.enabled ? t(ctx, 'مفعّل', 'On') : t(ctx, 'متوقف', 'Off')}</b>\n`
      + `${t(ctx, 'اسم المحفظة', 'Wallet name')}: ${s.walletName ? esc(s.walletName) : t(ctx, 'غير مضاف', 'not set')}\n`
      + `${t(ctx, 'رقم الاستلام', 'Receiving number')}: ${s.walletPhone ? `<code>${esc(s.walletPhone)}</code>` : t(ctx, 'غير مضاف', 'not set')}\n`
      + `${t(ctx, 'أسماء العرض المنشورة', 'Public display names')}: ${s.displayNames.length}\n\n`
      + t(ctx,
        'إذا أردت نشر اسم داعم، أضف اسم العرض المختار فقط بعد أن تتحقق بنفسك من وصول التحويل وتحصل على موافقة صريحة. لا تحفظ إيصالاً أو رقم المرسل أو قيمة التحويل هنا؛ الاسم سيصبح ظاهراً للعامة ويمكن حذفه لاحقاً.',
        'To publish a supporter display name, add only the chosen display label after you manually verify the transfer and receive explicit consent. Do not save a receipt, sender number or transfer amount here; the label becomes public and can be removed later.');
  };
  const screenKb = (ctx) => {
    const s = store.support;
    const kb = new InlineKeyboard()
      .text(s.enabled ? t(ctx, '⏸ إيقاف في الموقع', '⏸ Turn off on website') : t(ctx, '✅ تفعيل في الموقع', '✅ Enable on website'), 'sp:toggle').row()
      .text(s.walletName ? t(ctx, '✏️ تغيير اسم المحفظة', '✏️ Change wallet name') : t(ctx, '🏷 إضافة اسم المحفظة', '🏷 Set wallet name'), 'sp:set:name').row()
      .text(s.walletPhone ? t(ctx, '✏️ تغيير رقم الاستلام', '✏️ Change receiving number') : t(ctx, '📱 إضافة رقم الاستلام', '📱 Set receiving number'), 'sp:set:phone');
    if (s.walletName || s.walletPhone) kb.text(t(ctx, '🗑 حذف بيانات المحفظة', '🗑 Remove wallet details'), 'sp:rm:wallet');
    kb.row().text(t(ctx, '⭐ إدارة أسماء العرض', '⭐ Manage display names'), 'sp:names').row();
    if (config.publicUrl && s.enabled) kb.url(t(ctx, '🌐 معاينة الموقع', '🌐 Preview website'), `${config.publicUrl.replace(/\/$/, '')}/${en(ctx) ? 'en' : 'ar'}/`).row();
    return kb.text(h.L(ctx).btnHome, 'home');
  };
  const showSupport = (ctx, fresh = false) => fresh
    ? ctx.reply(screenText(ctx), { parse_mode: 'HTML', reply_markup: screenKb(ctx), link_preview_options: { is_disabled: true } })
    : h.show(ctx, screenText(ctx), screenKb(ctx));

  const namesText = (ctx) => {
    const names = store.support.displayNames;
    return (en(ctx)
      ? `⭐ <b>Public supporter display names (${names.length})</b>\n\nOnly chosen display labels are stored. Add a name only after manually confirming receipt and getting explicit consent. No sender details, receipt or amount are stored.`
      : `⭐ <b>أسماء عرض الداعمين (${names.length})</b>\n\nنحفظ أسماء العرض المختارة فقط. أضف اسماً بعد تأكيد الاستلام يدوياً وأخذ موافقة صريحة. لا نحفظ بيانات المرسل أو الإيصال أو قيمة التحويل.`)
      + (names.length ? '\n\n' + names.map((x) => `• ${esc(x.name)}`).join('\n') : `\n\n${t(ctx, 'لا توجد أسماء منشورة.', 'No names published.')}`);
  };
  const namesKb = (ctx) => {
    const kb = new InlineKeyboard().text(t(ctx, '➕ إضافة اسم بعد التحقق والموافقة', '➕ Add name after verification and consent'), 'sp:name:add').row();
    for (const item of store.support.displayNames) kb.text(`🗑 ${item.name.slice(0, 34)}`, `sp:name:rm:${item.id}`).row();
    return kb.text(t(ctx, '↩️ رجوع', '↩️ Back'), 'sp');
  };
  const showNames = (ctx, fresh = false) => fresh
    ? ctx.reply(namesText(ctx), { parse_mode: 'HTML', reply_markup: namesKb(ctx) })
    : h.show(ctx, namesText(ctx), namesKb(ctx));

  // Keep a typed display label pending only in memory until the owner explicitly confirms.
  bot.on('callback_query:data', async (ctx, next) => {
    if (ctx.callbackQuery.data !== 'sp:name:confirm') pending.delete(ctx.from.id);
    return next();
  });
  bot.on('message', async (ctx, next) => {
    const p = pending.get(ctx.from?.id);
    if (!p) return next();
    if (!h.owner(ctx) || Date.now() > p.exp) { pending.delete(ctx.from.id); return next(); }
    const txt = String(ctx.message.text || ctx.message.caption || '').trim();
    if (txt.startsWith('/')) { pending.delete(ctx.from.id); return next(); }
    if (isCancel(txt)) { pending.delete(ctx.from.id); await ctx.reply(t(ctx, 'تم الإلغاء.', 'Cancelled.')); return showSupport(ctx, true); }
    if (p.k === 'name' || p.k === 'phone') {
      if (p.k === 'name') {
        const value = cleanSupportLabel(txt, 60);
        if (!value) return ctx.reply(t(ctx, 'أرسل اسماً قصيراً صالحاً للمحفظة.', 'Send a short, valid wallet name.'));
        store.setSupport({ walletName: value });
        pending.delete(ctx.from.id);
        await showSupport(ctx, true);
        return ctx.reply(t(ctx, '✅ حُفظ اسم المحفظة في الإعدادات الخاصة.', '✅ Wallet name saved in private settings.'));
      }
      const parsed = parseWalletPhone(txt);
      if (!parsed.ok) return ctx.reply(t(ctx, '⚠️ أرسل رقم المحفظة بالتنسيق المحلي أو الدولي الذي يستخدمه مزوّد محفظتك. لا تضف الرقم إلا عندما تختاره بنفسك.', '⚠️ Send the wallet number in the local or international format used by your wallet provider. Add a number only when you choose it yourself.'));
      store.setSupport({ walletPhone: parsed.value });
      pending.delete(ctx.from.id);
      await showSupport(ctx, true);
      return ctx.reply(t(ctx, '✅ حُفظ رقم المحفظة في الإعدادات الخاصة، ولم يظهر على الموقع ما لم تفعّل الميزة.', '✅ Wallet number saved privately; it is not shown on the website unless you enable the feature.'));
    }
    if (p.k === 'displayName') {
      const value = cleanSupportLabel(txt, 48);
      if (!value) return ctx.reply(t(ctx, 'أرسل اسم العرض الذي اختاره الداعم.', 'Send the display label chosen by the supporter.'));
      if (store.support.displayNames.some((x) => x.name.toLocaleLowerCase() === value.toLocaleLowerCase())) {
        pending.delete(ctx.from.id);
        return ctx.reply(t(ctx, 'هذا الاسم منشور بالفعل.', 'That name is already published.'));
      }
      if (store.support.displayNames.length >= 30) { pending.delete(ctx.from.id); return ctx.reply(t(ctx, 'وصلت إلى الحد الأقصى لأسماء العرض.', 'The display-name limit has been reached.')); }
      pending.set(ctx.from.id, { k: 'confirmName', name: value, exp: Date.now() + PEND_MS });
      const kb = new InlineKeyboard().text(t(ctx, '✅ تحققت من الاستلام ولدي موافقة صريحة — انشر الاسم', '✅ Receipt verified and explicit consent obtained — publish name'), 'sp:name:confirm').row().text(t(ctx, '↩️ إلغاء', '↩️ Cancel'), 'sp:names');
      return h.show(ctx, t(ctx,
        `قبل النشر: هل تحققت يدوياً من وصول التحويل، وحصلت على موافقة صريحة لاستخدام اسم العرض هذا علناً؟ لن يُحفظ إلا الاسم المختار.\n\n<b>${esc(value)}</b>`,
        `Before publishing: have you manually verified the transfer and obtained explicit consent to show this display name publicly? Only the chosen label will be saved.\n\n<b>${esc(value)}</b>`), kb);
    }
    return next();
  });

  bot.callbackQuery('sp', async (ctx) => { await ctx.answerCallbackQuery(); if (h.owner(ctx)) await showSupport(ctx); });
  bot.command('support', async (ctx) => h.owner(ctx) ? showSupport(ctx, true) : ctx.reply(h.L(ctx).onlyOwner));
  bot.callbackQuery('sp:toggle', async (ctx) => {
    if (!h.owner(ctx)) return ctx.answerCallbackQuery();
    const ok = store.setSupport({ enabled: !store.support.enabled });
    if (!ok) {
      await ctx.answerCallbackQuery({ text: t(ctx, 'أضف اسم المحفظة ورقمها أولاً.', 'Set the wallet name and number first.') });
      return showSupport(ctx);
    }
    await ctx.answerCallbackQuery(t(ctx, store.support.enabled ? 'تم التفعيل' : 'تم الإيقاف', store.support.enabled ? 'Enabled' : 'Disabled'));
    await showSupport(ctx);
  });
  bot.callbackQuery(/^sp:set:(name|phone)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!h.owner(ctx)) return;
    const kind = ctx.match[1];
    pending.set(ctx.from.id, { k: kind, exp: Date.now() + PEND_MS });
    await h.show(ctx, kind === 'name'
      ? t(ctx, '🏷 <b>اسم المحفظة</b>\n\nأرسل الاسم الذي تريد عرضه للزوار، مثل اسم المحفظة أو الجهة المستلمة. لن يظهر قبل تفعيل الميزة.', '🏷 <b>Wallet name</b>\n\nSend the wallet or recipient label visitors should see. It stays hidden until you enable the feature.')
      : t(ctx, '📱 <b>رقم محفظة الاستلام</b>\n\nأرسل الرقم الذي اخترته أنت بالتنسيق المحلي أو الدولي الذي يستخدمه مزوّد محفظتك. سيُحفظ في الإعدادات الخاصة ولن يُعرض إلا بعد تفعيل الميزة.', '📱 <b>Receiving wallet number</b>\n\nSend the number you chose in the local or international format used by your wallet provider. It is saved privately and shown only after you enable the feature.'),
      new InlineKeyboard().text(t(ctx, '↩️ رجوع', '↩️ Back'), 'sp'));
  });
  bot.callbackQuery('sp:rm:wallet', async (ctx) => {
    if (!h.owner(ctx)) return ctx.answerCallbackQuery();
    store.setSupport({ enabled: false, walletName: '', walletPhone: '' });
    await ctx.answerCallbackQuery(t(ctx, 'حُذفت بيانات المحفظة وأُوقفت الميزة', 'Wallet details removed; feature disabled'));
    await showSupport(ctx);
  });
  bot.callbackQuery('sp:names', async (ctx) => { await ctx.answerCallbackQuery(); if (h.owner(ctx)) await showNames(ctx); });
  bot.callbackQuery('sp:name:add', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!h.owner(ctx)) return;
    pending.set(ctx.from.id, { k: 'displayName', exp: Date.now() + PEND_MS });
    await h.show(ctx, t(ctx,
      'أرسل اسم العرض الذي اختاره الداعم (حتى 48 حرفاً). أضفه فقط بعد تحققك من وصول التحويل وموافقته الصريحة على النشر. لا ترسل أو تحفظ رقم المرسل أو الإيصال أو مبلغ التحويل.',
      'Send the supporter-chosen display label (up to 48 characters). Add it only after you verify receipt and obtain explicit consent to publish it. Do not send or save a sender number, receipt or transfer amount.'),
      new InlineKeyboard().text(t(ctx, '↩️ إلغاء', '↩️ Cancel'), 'sp:names'));
  });
  bot.callbackQuery('sp:name:confirm', async (ctx) => {
    if (!h.owner(ctx)) return ctx.answerCallbackQuery();
    const p = pending.get(ctx.from.id);
    if (!p || p.k !== 'confirmName' || Date.now() > p.exp) {
      pending.delete(ctx.from.id);
      await ctx.answerCallbackQuery(t(ctx, 'انتهت مهلة التأكيد؛ أعد المحاولة.', 'Confirmation expired; try again.'));
      return showNames(ctx);
    }
    const name = cleanSupportLabel(p.name, 48);
    pending.delete(ctx.from.id);
    if (!name || store.support.displayNames.length >= 30) {
      await ctx.answerCallbackQuery(t(ctx, 'تعذّر إضافة الاسم.', 'Could not add the name.'));
      return showNames(ctx);
    }
    store.setSupport({ displayNames: [...store.support.displayNames, { id: randomUUID(), name }] });
    await ctx.answerCallbackQuery(t(ctx, 'نُشر اسم العرض فقط', 'Display label published'));
    await showNames(ctx);
  });
  bot.callbackQuery(/^sp:name:rm:([A-Za-z0-9_-]{1,36})$/, async (ctx) => {
    if (!h.owner(ctx)) return ctx.answerCallbackQuery();
    const id = ctx.match[1];
    store.setSupport({ displayNames: store.support.displayNames.filter((x) => x.id !== id) });
    await ctx.answerCallbackQuery(t(ctx, 'حُذف الاسم', 'Name removed'));
    await showNames(ctx);
  });
}
