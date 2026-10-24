// Owner-only "📞 Contact links" screen of the publishing bot: WhatsApp channel, contact phone number
// (WhatsApp chat and/or call) and a Telegram support username. Shown on the WEBSITE only; every
// change reaches open pages instantly (SSE 'contacts' event) and survives restarts (store + backup).
import { InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { store } from './store.js';

const PEND_MS = 10 * 60_000;
const pend = new Map(); // owner id -> { k: 'wa'|'phone'|'tg', exp }
export const _ctPendForTest = pend;
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ---------------------------------------------------------------- validation (exported for tests)
export function parseWa(input) {
  const t = String(input || '').trim().replace(/[?#].*$/, '');
  const m = t.match(/^(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9]{10,40})\/?$/i);
  if (m) return { ok: true, value: `https://whatsapp.com/channel/${m[1]}` };
  if (/chat\.whatsapp\.com|wa\.me|api\.whatsapp\.com/i.test(t)) return { ok: false, err: 'notChannel' };
  return { ok: false, err: 'bad' };
}
export function parsePhone(input) {
  let t = String(input || '').trim();
  const link = t.match(/^(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?\+?(\d{8,15})/i);
  if (link) t = '+' + link[1];
  t = t.replace(/^tel:/i, '').replace(/[\s\-.()\u200e\u200f\u202a-\u202e]/g, '');
  t = t.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  if (t.startsWith('00')) t = '+' + t.slice(2);
  if (/^\+[1-9]\d{7,14}$/.test(t)) return { ok: true, value: t };
  if (/^0\d{6,12}$/.test(t)) return { ok: false, err: 'local' };
  if (/^[1-9]\d{10,14}$/.test(t)) return { ok: true, value: '+' + t }; // full international number without "+"
  return { ok: false, err: 'bad' };
}
export function parseTg(input) {
  const t = String(input || '').trim().replace(/[?#].*$/, '');
  const m = t.match(/^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/|@)?([A-Za-z][A-Za-z0-9_]{4,31})\/?$/i);
  if (m && !/__/.test(m[1]) && !m[1].endsWith('_')) return { ok: true, value: m[1] };
  return { ok: false, err: 'bad' };
}
const pretty = (p) => { // +963 933 123 456 (readable, LTR)
  const d = p.slice(1);
  const cc = d.startsWith('1') || d.startsWith('7') ? d.slice(0, 1) : d.slice(0, 3);
  const rest = d.slice(cc.length).replace(/(\d{3})(?=\d{3,})/g, '$1 ');
  return `+${cc} ${rest}`;
};

export function registerContactTools(bot, h) {
  const en = (ctx) => h.langOf(ctx) === 'en';
  const t = (ctx, ar, e) => (en(ctx) ? e : ar);
  const MODE = { both: ['💬 واتساب + 📞 اتصال', '💬 WhatsApp + 📞 Call'], wa: ['💬 واتساب فقط', '💬 WhatsApp only'], tel: ['📞 اتصال فقط', '📞 Call only'] };

  const text = (ctx) => {
    const c = store.contacts;
    const e = en(ctx);
    const none = e ? '— not set' : '— غير مضاف';
    const mode = MODE[c.phoneMode || 'both'][e ? 1 : 0];
    return (e
      ? '📞 <b>Contact links on the website</b>\n\nThese icons appear on the <b>website only</b> (header, menu and the “About” sheet) — not under channel posts. An icon stays hidden until you set it, and every change shows on open pages instantly.\n\n'
      : '📞 <b>روابط التواصل في الموقع</b>\n\nتظهر هذه الأيقونات في <b>الموقع فقط</b> (الشريط العلوي والقائمة ونافذة «حول الخريطة») وليس تحت منشورات القناة. تبقى الأيقونة مخفية حتى تضيف قيمتها، وأي تعديل يظهر فوراً عند الزوار.\n\n')
      + `🟢 <b>${e ? 'WhatsApp channel' : 'قناة واتساب'}:</b> ${c.wa ? esc(c.wa) : none}\n`
      + `📱 <b>${e ? 'Contact number' : 'رقم التواصل'}:</b> ${c.phone ? `<code>${pretty(c.phone)}</code> · ${mode}` : none}\n`
      + `✈️ <b>${e ? 'Telegram support' : 'دعم تيليغرام'}:</b> ${c.tg ? '@' + esc(c.tg) : none}`;
  };
  const kb = (ctx) => {
    const c = store.contacts;
    const k = new InlineKeyboard();
    k.text(c.wa ? t(ctx, '🟢 تعديل قناة واتساب', '🟢 Change WhatsApp channel') : t(ctx, '🟢 إضافة قناة واتساب', '🟢 Add WhatsApp channel'), 'ct:set:wa');
    if (c.wa) k.text(t(ctx, '🗑 حذف', '🗑 Remove'), 'ct:rm:wa');
    k.row();
    k.text(c.phone ? t(ctx, '📱 تعديل الرقم', '📱 Change number') : t(ctx, '📱 إضافة رقم تواصل', '📱 Add contact number'), 'ct:set:phone');
    if (c.phone) k.text(t(ctx, '🗑 حذف', '🗑 Remove'), 'ct:rm:phone');
    k.row();
    if (c.phone) {
      const cur = c.phoneMode || 'both';
      for (const m of ['both', 'wa', 'tel']) k.text(`${cur === m ? '✅ ' : ''}${MODE[m][en(ctx) ? 1 : 0]}`, `ct:mode:${m}`);
      k.row();
    }
    k.text(c.tg ? t(ctx, '✈️ تعديل دعم تيليغرام', '✈️ Change Telegram support') : t(ctx, '✈️ إضافة دعم تيليغرام', '✈️ Add Telegram support'), 'ct:set:tg');
    if (c.tg) k.text(t(ctx, '🗑 حذف', '🗑 Remove'), 'ct:rm:tg');
    k.row();
    if (config.publicUrl && (c.wa || c.phone || c.tg)) k.url(t(ctx, '🌐 معاينة في الموقع', '🌐 Preview on the website'), `${config.publicUrl.replace(/\/$/, '')}/${en(ctx) ? 'en' : 'ar'}/`).row();
    return k.text(h.L(ctx).btnHome, 'home');
  };
  const showContacts = (ctx, fresh = false) => (fresh
    ? ctx.reply(text(ctx), { parse_mode: 'HTML', reply_markup: kb(ctx), link_preview_options: { is_disabled: true } })
    : h.show(ctx, text(ctx), kb(ctx)));
  const PROMPT = {
    wa: ['🟢 <b>قناة واتساب</b>\n\nأرسل رابط قناتك على واتساب، مثل:\n<code>https://whatsapp.com/channel/0029Va…</code>\n\nتجده في واتساب: القناة ← ⋮ ← <b>مشاركة القناة</b> ← نسخ الرابط.',
      '🟢 <b>WhatsApp channel</b>\n\nSend your WhatsApp channel link, e.g.:\n<code>https://whatsapp.com/channel/0029Va…</code>\n\nIn WhatsApp: your channel → ⋮ → <b>Share channel</b> → copy link.'],
    phone: ['📱 <b>رقم التواصل</b>\n\nأرسل الرقم <b>بالصيغة الدولية مع رمز الدولة</b>، مثل:\n<code>+963 933 123 456</code> أو <code>00963933123456</code>\n\nيظهر في الموقع كزر «مراسلة واتساب» و/أو «اتصال» (تختار ذلك بعد الحفظ).',
      '📱 <b>Contact number</b>\n\nSend the number in <b>international format with the country code</b>, e.g.:\n<code>+963 933 123 456</code> or <code>00963933123456</code>\n\nThe site shows it as “WhatsApp chat” and/or “Call” (you choose after saving).'],
    tg: ['✈️ <b>دعم تيليغرام</b>\n\nأرسل اسم المستخدم للحساب الذي يستقبل رسائل الزوار، مثل <code>@username</code> أو <code>t.me/username</code>.',
      '✈️ <b>Telegram support</b>\n\nSend the username of the account that receives visitors’ messages, e.g. <code>@username</code> or <code>t.me/username</code>.'],
  };
  const ERR = {
    wa: { notChannel: ['⚠️ هذا رابط محادثة أو مجموعة وليس قناة. أرسل رابط القناة الذي يبدأ بـ whatsapp.com/channel/', '⚠️ That is a chat or group link, not a channel. Send the channel link starting with whatsapp.com/channel/'],
      bad: ['⚠️ الرابط غير صحيح. مثال: https://whatsapp.com/channel/0029Va…', '⚠️ Invalid link. Example: https://whatsapp.com/channel/0029Va…'] },
    phone: { local: ['⚠️ أضف رمز الدولة: مثلاً بدل 0933123456 اكتب ‎+963933123456', '⚠️ Add the country code: e.g. instead of 0933123456 send +963933123456'],
      bad: ['⚠️ الرقم غير صحيح. مثال: ‎+963 933 123 456', '⚠️ Invalid number. Example: +963 933 123 456'] },
    tg: { bad: ['⚠️ اسم المستخدم غير صحيح. مثال: @Red_Alert_Syria_Support (5 أحرف على الأقل، حروف إنجليزية وأرقام و _)', '⚠️ Invalid username. Example: @Red_Alert_Syria_Support (5+ chars: letters, digits, _)'] },
  };
  const PARSE = { wa: parseWa, phone: parsePhone, tg: parseTg };
  const SAVED = { wa: ['✅ تم حفظ قناة واتساب — ظهرت الآن في الموقع.', '✅ WhatsApp channel saved — it is now on the website.'],
    phone: ['✅ تم حفظ الرقم — ظهر الآن في الموقع.', '✅ Number saved — it is now on the website.'],
    tg: ['✅ تم حفظ حساب الدعم — ظهر الآن في الموقع.', '✅ Support account saved — it is now on the website.'] };

  // any other button cancels a pending input
  bot.on('callback_query:data', async (ctx, next) => {
    if (!/^ct(:|$)/.test(ctx.callbackQuery.data)) pend.delete(ctx.from.id);
    return next();
  });
  bot.on('message', async (ctx, next) => {
    const p = pend.get(ctx.from?.id);
    if (!p) return next();
    if (!h.owner(ctx) || Date.now() > p.exp) { pend.delete(ctx.from.id); return next(); }
    const txt = ctx.message.text || ctx.message.caption || '';
    if (txt.startsWith('/')) { pend.delete(ctx.from.id); return next(); }
    const e = en(ctx) ? 1 : 0;
    const r = PARSE[p.k](txt || (ctx.message.contact?.phone_number ? '+' + String(ctx.message.contact.phone_number).replace(/^\+/, '') : ''));
    if (!r.ok) return ctx.reply(ERR[p.k][r.err]?.[e] || ERR[p.k].bad[e]); // plain notice: the prompt stays
    pend.delete(ctx.from.id);
    store.setContacts({ [p.k]: r.value });
    await showContacts(ctx, true);
    return h.sendTransient(ctx.api, ctx.chat.id, SAVED[p.k][e]);
  });

  bot.callbackQuery('ct', async (ctx) => { await ctx.answerCallbackQuery(); pend.delete(ctx.from.id); if (h.owner(ctx)) await showContacts(ctx); });
  bot.command('contacts', async (ctx) => (h.owner(ctx) ? showContacts(ctx, true) : ctx.reply(h.L(ctx).onlyOwner)));
  bot.callbackQuery(/^ct:set:(wa|phone|tg)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!h.owner(ctx)) return;
    const k = ctx.match[1];
    pend.set(ctx.from.id, { k, exp: Date.now() + PEND_MS });
    await h.show(ctx, PROMPT[k][en(ctx) ? 1 : 0], new InlineKeyboard().text(t(ctx, '↩️ رجوع', '↩️ Back'), 'ct'));
  });
  bot.callbackQuery(/^ct:rm:(wa|phone|tg)$/, async (ctx) => {
    if (!h.owner(ctx)) return ctx.answerCallbackQuery();
    store.setContacts({ [ctx.match[1]]: null });
    await ctx.answerCallbackQuery(t(ctx, 'تم الحذف من الموقع', 'Removed from the website'));
    await showContacts(ctx);
  });
  bot.callbackQuery(/^ct:mode:(both|wa|tel)$/, async (ctx) => {
    if (!h.owner(ctx)) return ctx.answerCallbackQuery();
    if (store.contacts.phone) store.setContacts({ phoneMode: ctx.match[1] });
    await ctx.answerCallbackQuery('✅');
    await showContacts(ctx);
  });
}
