import { InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { store } from './store.js';
import {
  ARMY_CATEGORIES, armyMonitorSources, normalizeArmyTelegramUsername, addManualArmySource,
  updateManualArmySource, removeManualArmySource, armyState, publicArmy, createPendingArmyItem,
  decideArmyItem, updateArmyItem, deleteArmyItem, setArmyChannel, clearArmyChannel,
  normalizeArmyChannelLink,
} from './army.js';

const MAX_TEXT = 3600;
const PAGE_SIZE = 8;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clean = (s, max = MAX_TEXT) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const idOf = (ctx) => String(ctx.from?.id || '');
const isEnglish = (ctx, h) => h.langOf(ctx) === 'en';
const say = (ctx, h, ar, en) => isEnglish(ctx, h) ? en : ar;
const state = () => armyState();
const persist = ({ broadcast = false } = {}) => {
  store.persist();
  if (broadcast) store.emit('army', publicArmy());
};
const secureUrl = (raw) => {
  try { const u = new URL(String(raw || '').trim()); return u.protocol === 'https:' && !u.username && !u.password && !u.port ? u.href : ''; }
  catch { return ''; }
};
async function answer(ctx, text = '') {
  try { await ctx.answerCallbackQuery(text ? { text: String(text).slice(0, 190) } : undefined); } catch { /* stale callback */ }
}
async function deleteInput(ctx) { if (ctx.message?.message_id) try { await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id); } catch { /* best effort */ } }
function menuText(ctx, h) {
  const j = state();
  const last = armyMonitorSources(j).map((s) => j.sources[s.u]?.lastCheck).filter(Boolean).map((x) => Date.parse(x)).filter(Number.isFinite);
  const lastAt = last.length ? new Date(Math.max(...last)).toLocaleString(isEnglish(ctx, h) ? 'en-GB' : 'ar-SY', { timeZone: 'Asia/Damascus' }) : say(ctx, h, 'لم يبدأ بعد', 'not checked yet');
  return say(ctx, h,
    `<b>🏛 الجيش السوري — لوحة الإدارة</b>\n\nبانتظار المراجعة: <b>${Object.keys(j.pending).length}</b> · منشور بالموقع/الخريطة: <b>${Object.keys(j.published).length}</b>\nرصد المصادر: <b>${j.monitorOn ? 'يعمل كل 15 دقيقة' : 'متوقف'}</b> · آخر تحقق: ${esc(lastAt)}\n\nكل خبر يحتاج موافقتك قبل أن يظهر في قسم الجيش السوري بالموقع/الخريطة. لا يُنشر في قناة الأخبار أو قنوات تيليغرام/واتساب. روابط المتابعة العامة منفصلة عن مصادر الرصد الداخلية.`,
    `<b>🏛 Syrian Army — Admin</b>\n\nAwaiting review: <b>${Object.keys(j.pending).length}</b> · On website/map: <b>${Object.keys(j.published).length}</b>\nSource monitoring: <b>${j.monitorOn ? 'on, every 15 minutes' : 'paused'}</b> · Last check: ${esc(lastAt)}\n\nEvery item requires your approval before appearing in the Syrian Army section of the website/map. Nothing is posted to the news channel or Telegram/WhatsApp channels. Public follow links stay separate from internal monitoring inputs.`);
}
function menuKeyboard(ctx, h) {
  const en = isEnglish(ctx, h); const j = state();
  return new InlineKeyboard()
    .text(en ? '➕ Add official update' : '➕ إضافة تحديث رسمي', 'army:add')
    .text(en ? `📥 Pending (${Object.keys(j.pending).length})` : `📥 بانتظار المراجعة (${Object.keys(j.pending).length})`, 'army:list:pending').row()
    .text(en ? `🗺 Published (${Object.keys(j.published).length})` : `🗺 المنشورة (${Object.keys(j.published).length})`, 'army:list:published').row()
    .text(j.monitorOn ? (en ? '⏸ Pause monitoring' : '⏸ إيقاف الرصد') : (en ? '▶️ Start monitoring' : '▶️ تشغيل الرصد'), 'army:monitor')
    .text(en ? '🔗 Configure channels' : '🔗 إعداد قنوات المتابعة', 'army:channels').row()
    .text(en ? '📡 Monitoring sources' : '📡 مصادر الرصد', 'army:sources').row()
    .text(en ? '↩️ Main menu' : '↩️ القائمة الرئيسية', 'home');
}
async function showMenu(ctx, h) { return h.show(ctx, menuText(ctx, h), menuKeyboard(ctx, h)); }
function categoryKeyboard(ctx, h, action, id = '') {
  const en = isEnglish(ctx, h); const kb = new InlineKeyboard();
  for (const [key, cat] of Object.entries(ARMY_CATEGORIES)) {
    const label = `${cat.icon} ${en ? cat.en : cat.ar}`.slice(0, 55);
    kb.text(label, action === 'add' ? `army:add-category:${key}` : `army:category:${id}:${key}`).row();
  }
  kb.text(en ? '✖️ Cancel' : '✖️ إلغاء', action === 'add' ? 'army:cancel' : `army:item:${id}`);
  return kb;
}
function itemTitle(item, en) { const cat = ARMY_CATEGORIES[item.category] || ARMY_CATEGORIES.army; return `${cat.icon} ${en ? cat.en : cat.ar}`; }
function itemScreenText(ctx, h, item) {
  const en = isEnglish(ctx, h); const cat = ARMY_CATEGORIES[item.category] || ARMY_CATEGORIES.army;
  const status = item.status === 'approved' ? (en ? '✅ Approved — website/map only' : '✅ معتمد — الموقع/الخريطة فقط') : (en ? '⏳ Waiting for owner approval' : '⏳ بانتظار موافقة المالك');
  const original = item.sourceUrl ? `<a href="${esc(item.sourceUrl)}">${en ? (item.kind === 'media_source' ? 'Open original media report' : 'Open original official source') : (item.kind === 'media_source' ? 'فتح الخبر الإعلامي الأصلي' : 'فتح المصدر الرسمي الأصلي')}</a>` : '';
  const links = (item.links || []).map((u, i) => `<a href="${esc(u)}">${en ? `Link ${i + 1}` : `رابط ${i + 1}`}</a>`).join(' · ');
  const fullText = String(item.text || ''); const excerpt = fullText.slice(0, 2200);
  return [`<b>${itemTitle(item, en)}</b>`, `<i>${status}</i>`, `${en ? 'Source' : 'المصدر'}: ${esc(item.sourceName || '—')}${original ? ` · ${original}` : ''}`, '', `<b>${esc(item.title)}</b>`, esc(excerpt) + (fullText.length > excerpt.length ? '…' : ''), links ? `\n${en ? 'Links from source post' : 'روابط وردت في المنشور'}: ${links}` : '', '', `<i>${en ? 'This item is not public before approval. Approved items appear only in the website/map section; they are never sent to the news channel or configured social channels.' : 'لن يظهر هذا الخبر قبل الموافقة. بعد الاعتماد يظهر في قسم الموقع/الخريطة فقط، ولا يُرسل إلى قناة الأخبار أو قنوات التواصل المُعدّة.'}</i>`].filter(Boolean).join('\n');
}
function itemKeyboard(ctx, h, item) {
  const en = isEnglish(ctx, h); const kb = new InlineKeyboard();
  if (item.status !== 'approved') kb.text(en ? '✅ Approve for website/map only' : '✅ اعتماد للموقع/الخريطة فقط', `army:approve:${item.id}`).row();
  kb.text(en ? '✏️ Edit title' : '✏️ تعديل العنوان', `army:edit:title:${item.id}`)
    .text(en ? '✏️ Edit details' : '✏️ تعديل التفاصيل', `army:edit:text:${item.id}`).row()
    .text(en ? '🏷 Change category' : '🏷 تغيير الفئة', `army:edit-category:${item.id}`).row();
  if (item.status !== 'approved') kb.text(en ? '🚫 Ignore' : '🚫 تجاهل', `army:ignore:${item.id}`);
  kb.text(en ? '🗑 Delete' : '🗑 حذف', `army:delete:${item.id}`).row()
    .text(en ? '↩️ Control panel' : '↩️ لوحة الإدارة', 'army:menu');
  return kb;
}
function sortedItems(which) {
  const rows = Object.values(which === 'published' ? state().published : state().pending);
  return rows.filter((x) => x && !state().deleted[x.id]).sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
}
function listText(ctx, h, which, page) {
  const en = isEnglish(ctx, h); const rows = sortedItems(which); const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const p = Math.max(0, Math.min(pages - 1, Number(page) || 0));
  const heading = which === 'published' ? (en ? '🗺 Approved items on the website/map' : '🗺 الأخبار المعتمدة على الموقع/الخريطة') : (en ? '📥 Waiting for your approval' : '📥 أخبار بانتظار موافقتك');
  const chunk = rows.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
  return { rows, pages, page: p, text: `<b>${heading}</b>\n\n${chunk.length ? chunk.map((x, i) => `${p * PAGE_SIZE + i + 1}. ${esc(x.title)} — ${esc(ARMY_CATEGORIES[x.category]?.ar || '')}`).join('\n') : (en ? 'No items.' : 'لا توجد أخبار في هذه القائمة.')}` };
}
function listKeyboard(ctx, h, which, page = 0) {
  const en = isEnglish(ctx, h); const { rows, pages, page: p } = listText(ctx, h, which, page); const kb = new InlineKeyboard();
  rows.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE).forEach((item) => kb.text(`${item.status === 'approved' ? '🗺' : '📨'} ${item.title}`.slice(0, 55), `army:item:${item.id}`).row());
  if (pages > 1) {
    if (p > 0) kb.text(en ? '‹ Previous' : '‹ السابق', `army:list:${which}:${p - 1}`);
    kb.text(en ? `${p + 1}/${pages}` : `${p + 1}/${pages}`, 'army:noop');
    if (p + 1 < pages) kb.text(en ? 'Next ›' : 'التالي ›', `army:list:${which}:${p + 1}`);
    kb.row();
  }
  return kb.text(en ? '↩️ Control panel' : '↩️ لوحة الإدارة', 'army:menu');
}
function sourceScreen(ctx, h) {
  const en = isEnglish(ctx, h); const j = state();
  const sources = armyMonitorSources(j);
  const links = sources.map((s) => {
    const status = j.sources[s.u] || {};
    const checked = status.lastCheck ? new Date(status.lastCheck).toLocaleString(en ? 'en-GB' : 'ar-SY', { timeZone: 'Asia/Damascus' }) : (en ? 'not checked yet' : 'لم يبدأ بعد');
    const sourceType = s.manual ? (en ? `manual ${s.type === 'media' ? 'media' : 'official'} source` : `يدوي · ${s.type === 'media' ? 'إعلامي' : 'رسمي'}`) : s.type === 'media' ? (en ? 'media signal — internal only' : 'إشارة إعلامية — داخلية') : (en ? 'official source' : 'مصدر رسمي');
    return `• <a href="${s.url}">${esc(s.name)}</a> (${sourceType}) — ${en ? 'last checked' : 'آخر تحقق'}: ${esc(checked)}${status.lastError ? ` · ⚠️ ${esc(status.lastError)}` : ''}`;
  }).join('\n');
  const text = en
    ? `<b>📡 Internal monitoring sources</b>\n\nOfficial and manually added public Telegram channels are checked every 15 minutes. Relevant new posts are queued for your review; old posts are skipped on first check. Manual sources stay off the public map source list and follow links.\n\n${links}\n\nNothing is published automatically.`
    : `<b>📡 مصادر الرصد الداخلية</b>\n\nيراقب البوت القنوات الرسمية والعامة التي تضيفها يدوياً كل 15 دقيقة. تُحوّل المنشورات الجديدة المطابقة إلى مراجعتك، ويُتجاوز الأرشيف عند أول تحقق. المصادر اليدوية لا تظهر في قائمة الخريطة أو أزرار المتابعة العامة.\n\n${links}\n\nلا يوجد نشر تلقائي.`;
  const keyboard = new InlineKeyboard();
  for (const source of Object.values(j.manualSources || {})) keyboard.text(`✏️ ${source.name}`.slice(0, 45), `army:source:manage:${source.u}`).row();
  keyboard.text(en ? '➕ Add manual source' : '➕ إضافة مصدر يدوي', 'army:source:add').row();
  keyboard.text(j.monitorOn ? (en ? '⏸ Pause monitoring' : '⏸ إيقاف الرصد') : (en ? '▶️ Start monitoring' : '▶️ تشغيل الرصد'), 'army:monitor').row();
  keyboard.text(en ? '↩️ Control panel' : '↩️ لوحة الإدارة', 'army:menu');
  return { text, keyboard };
}

function sourceManageScreen(ctx, h, username) {
  const en = isEnglish(ctx, h); const source = state().manualSources?.[username];
  if (!source) return null;
  const type = source.type === 'media' ? (en ? 'media signal' : 'إعلامي') : (en ? 'official' : 'رسمي');
  const text = say(ctx, h, `<b>إدارة المصدر اليدوي</b>\n\n${esc(source.name)}\n<a href="${esc(source.url)}">${esc(source.url)}</a>\nالتصنيف: ${type}\n\nالمصدر داخلي للرصد فقط، ولا يظهر في قائمة المصادر العامة أو المتابعة.`, `<b>Manage manual source</b>\n\n${esc(source.name)}\n<a href="${esc(source.url)}">${esc(source.url)}</a>\nType: ${type}\n\nThis is an internal monitoring input, not a public map source or follow link.`);
  const keyboard = new InlineKeyboard()
    .text(en ? '✏️ Edit name' : '✏️ تعديل الاسم', `army:source:edit-name:${username}`).row()
    .text(en ? '✏️ Edit channel' : '✏️ تعديل القناة', `army:source:edit-channel:${username}`).row()
    .text(en ? `Set as ${source.type === 'media' ? 'official' : 'media'}` : `تحويل إلى ${source.type === 'media' ? 'رسمي' : 'إعلامي'}`, `army:source:set-type:${source.type === 'media' ? 'official' : 'media'}:${username}`).row()
    .text(en ? '🗑 Delete source' : '🗑 حذف المصدر', `army:source:delete:${username}`).row()
    .text(en ? '↩️ Sources' : '↩️ المصادر', 'army:sources');
  return { text, keyboard };
}
function channelScreen(ctx, h) {
  const en = isEnglish(ctx, h); const c = state().channels;
  const text = en
    ? `<b>🔗 Follow-channel links</b>\n\nTelegram: ${c.tg ? `<a href="${esc(c.tg)}">configured</a>` : 'not configured'}\nWhatsApp: ${c.wa ? `<a href="${esc(c.wa)}">configured</a>` : 'not configured'}\n\nThese are optional links shown to visitors as follow buttons. The system does not publish or send content to them.`
    : `<b>🔗 روابط قنوات المتابعة</b>\n\nتيليغرام: ${c.tg ? `<a href="${esc(c.tg)}">مُعدّ</a>` : 'غير مُعدّ'}\nواتساب: ${c.wa ? `<a href="${esc(c.wa)}">مُعدّ</a>` : 'غير مُعدّ'}\n\nهذه روابط اختيارية تظهر للزوار كأزرار متابعة فقط؛ النظام لا ينشر ولا يرسل محتوى إليها.`;
  const kb = new InlineKeyboard()
    .text(en ? '✏️ Set Telegram' : '✏️ إضافة/تعديل تيليغرام', 'army:channel:edit:tg')
    .text(en ? '✏️ Set WhatsApp' : '✏️ إضافة/تعديل واتساب', 'army:channel:edit:wa').row();
  if (c.tg) kb.text(en ? 'Remove Telegram' : 'إزالة تيليغرام', 'army:channel:clear:tg');
  if (c.wa) kb.text(en ? 'Remove WhatsApp' : 'إزالة واتساب', 'army:channel:clear:wa');
  if (c.tg || c.wa) kb.row();
  return { text, keyboard: kb.text(en ? '↩️ Control panel' : '↩️ لوحة الإدارة', 'army:menu') };
}
function startDraft(ctx, h, draft, text, keyboard) {
  draft.createdAt ||= Date.now(); draft.updatedAt = Date.now();
  state().adminDrafts[idOf(ctx)] = draft; persist();
  return h.show(ctx, text, keyboard);
}
function cancelKeyboard(ctx, h) { return new InlineKeyboard().text(say(ctx, h, '✖️ إلغاء', '✖️ Cancel'), 'army:cancel'); }

export function registerArmyAdminTools(bot, h) {
  const ownerOnly = (ctx, fn) => h.owner(ctx) ? fn() : answer(ctx);

  bot.command('army', (ctx) => ownerOnly(ctx, () => showMenu(ctx, h)));
  bot.callbackQuery('army:menu', (ctx) => ownerOnly(ctx, async () => { await answer(ctx); return showMenu(ctx, h); }));
  bot.callbackQuery('army:noop', (ctx) => ownerOnly(ctx, () => answer(ctx)));
  bot.callbackQuery('army:add', (ctx) => ownerOnly(ctx, async () => {
    await answer(ctx);
    return startDraft(ctx, h, { mode: 'create', step: 'category', createdAt: Date.now() }, say(ctx, h, '<b>اختر فئة التحديث</b>\n\nسيظل الخبر خاصاً حتى تعتمد نشره.', '<b>Choose the update category</b>\n\nThe item remains private until you approve it.'), categoryKeyboard(ctx, h, 'add'));
  }));
  bot.callbackQuery(/^army:add-category:([a-z]+)$/, (ctx) => ownerOnly(ctx, async () => {
    const cat = ctx.match[1]; const d = state().adminDrafts[idOf(ctx)];
    if (!d || d.mode !== 'create' || !Object.hasOwn(ARMY_CATEGORIES, cat)) return answer(ctx);
    d.category = cat; d.step = 'title'; d.updatedAt = Date.now(); persist(); await answer(ctx);
    return h.show(ctx, say(ctx, h, '<b>أرسل عنوان الخبر</b> (3 أحرف على الأقل).', '<b>Send the update title</b> (at least 3 characters).'), cancelKeyboard(ctx, h));
  }));
  bot.callbackQuery('army:cancel', (ctx) => ownerOnly(ctx, async () => {
    const draft = state().adminDrafts[idOf(ctx)]; delete state().adminDrafts[idOf(ctx)]; persist(); await answer(ctx, say(ctx, h, 'تم إلغاء العملية.', 'Cancelled.'));
    if (draft?.mode === 'add_monitor_source' || draft?.mode === 'edit_monitor_source') { const screen = sourceScreen(ctx, h); return h.show(ctx, screen.text, screen.keyboard); }
    return showMenu(ctx, h);
  }));
  bot.callbackQuery(/^army:list:(pending|published)(?::(\d+))?$/, (ctx) => ownerOnly(ctx, async () => {
    const which = ctx.match[1]; const page = Number(ctx.match[2]) || 0; const result = listText(ctx, h, which, page);
    await answer(ctx); return h.show(ctx, result.text, listKeyboard(ctx, h, which, page));
  }));
  bot.callbackQuery(/^army:item:([a-f0-9]{14})$/, (ctx) => ownerOnly(ctx, async () => {
    const id = ctx.match[1]; const item = state().pending[id] || state().published[id]; await answer(ctx);
    if (!item || state().deleted[id]) return showMenu(ctx, h);
    return h.show(ctx, itemScreenText(ctx, h, item), itemKeyboard(ctx, h, item));
  }));
  bot.callbackQuery(/^army:approve:([a-f0-9]{14})$/, (ctx) => ownerOnly(ctx, async () => {
    const id = ctx.match[1]; const result = decideArmyItem(id, 'approve', state(), ctx.from.id); await answer(ctx, result.ok ? say(ctx, h, 'اعتمد الخبر للموقع/الخريطة فقط', 'Approved for website/map only') : say(ctx, h, 'لم يعد الخبر بانتظار المراجعة', 'Item is no longer pending'));
    if (result.ok) persist({ broadcast: true });
    return h.show(ctx, result.ok ? itemScreenText(ctx, h, result.item) : say(ctx, h, '<b>لم يتم النشر</b> — راجع قائمة المعلّق.', '<b>Not published</b> — check the pending list.'), result.ok ? itemKeyboard(ctx, h, result.item) : menuKeyboard(ctx, h));
  }));
  bot.callbackQuery(/^army:ignore:([a-f0-9]{14})$/, (ctx) => ownerOnly(ctx, async () => {
    const id = ctx.match[1]; const result = decideArmyItem(id, 'ignore', state(), ctx.from.id); await answer(ctx, result.ok ? say(ctx, h, 'تم تجاهل الخبر', 'Item ignored') : say(ctx, h, 'لم يعد الخبر معلّقاً', 'Item is no longer pending'));
    if (result.ok) persist();
    return h.show(ctx, say(ctx, h, result.ok ? '🚫 تم تجاهل الخبر، ولن يظهر للعامة.' : 'لم يتم العثور على الخبر.', result.ok ? '🚫 Ignored; it will not be public.' : 'Item not found.'), menuKeyboard(ctx, h));
  }));
  bot.callbackQuery(/^army:edit:(title|text):([a-f0-9]{14})$/, (ctx) => ownerOnly(ctx, async () => {
    const [, field, id] = ctx.match; const item = state().pending[id] || state().published[id]; await answer(ctx);
    if (!item || state().deleted[id]) return showMenu(ctx, h);
    const draft = { mode: 'edit_item', field, itemId: id, createdAt: Date.now() };
    const prompt = field === 'title'
      ? say(ctx, h, `<b>أرسل العنوان الجديد</b>\nالحالي: ${esc(item.title)}`, `<b>Send the new title</b>\nCurrent: ${esc(item.title)}`)
      : say(ctx, h, '<b>أرسل النص الكامل الجديد</b> (10–3600 حرفاً). تأكد من بقاء رابط المصدر الرسمي صحيحاً.', '<b>Send the full revised text</b> (10–3600 characters). Keep the official source attribution accurate.');
    return startDraft(ctx, h, draft, prompt, cancelKeyboard(ctx, h));
  }));
  bot.callbackQuery(/^army:edit-category:([a-f0-9]{14})$/, (ctx) => ownerOnly(ctx, async () => {
    const id = ctx.match[1]; await answer(ctx);
    if (!state().pending[id] && !state().published[id]) return showMenu(ctx, h);
    return h.show(ctx, say(ctx, h, '<b>اختر الفئة الجديدة</b>', '<b>Choose the new category</b>'), categoryKeyboard(ctx, h, 'edit', id));
  }));
  bot.callbackQuery(/^army:category:([a-f0-9]{14}):([a-z]+)$/, (ctx) => ownerOnly(ctx, async () => {
    const [, id, category] = ctx.match; const item = state().pending[id] || state().published[id];
    if (!item || !Object.hasOwn(ARMY_CATEGORIES, category)) return answer(ctx);
    const result = updateArmyItem(id, { category }, state(), ctx.from.id); await answer(ctx, result.ok ? say(ctx, h, 'تم تحديث الفئة', 'Category updated') : say(ctx, h, 'تعذّر التحديث', 'Could not update'));
    if (result.ok) persist({ broadcast: result.item.status === 'approved' });
    return h.show(ctx, itemScreenText(ctx, h, result.item || item), itemKeyboard(ctx, h, result.item || item));
  }));
  bot.callbackQuery(/^army:delete:([a-f0-9]{14})$/, (ctx) => ownerOnly(ctx, async () => {
    const id = ctx.match[1]; const item = state().pending[id] || state().published[id]; await answer(ctx);
    if (!item || state().deleted[id]) return showMenu(ctx, h);
    const text = say(ctx, h, `<b>تأكيد حذف الخبر؟</b>\n\n«${esc(item.title)}»\n\nسيُزال من الموقع/الخريطة ولن تستعيده نسخة احتياطية قديمة.`, `<b>Confirm deletion?</b>\n\n“${esc(item.title)}”\n\nIt will be removed from the website/map and cannot be restored by an older backup.`);
    return h.show(ctx, text, new InlineKeyboard().text(say(ctx, h, '🗑 نعم، احذف', '🗑 Yes, delete'), `army:delete-yes:${id}`).row().text(say(ctx, h, '↩️ إلغاء', '↩️ Cancel'), `army:item:${id}`));
  }));
  bot.callbackQuery(/^army:delete-yes:([a-f0-9]{14})$/, (ctx) => ownerOnly(ctx, async () => {
    const id = ctx.match[1]; const result = deleteArmyItem(id, state(), ctx.from.id); await answer(ctx, result.ok ? say(ctx, h, 'تم الحذف', 'Deleted') : say(ctx, h, 'الخبر غير موجود', 'Item not found'));
    if (result.ok) persist({ broadcast: true });
    return h.show(ctx, say(ctx, h, result.ok ? '🗑 حُذف الخبر من قسم الجيش السوري في الموقع/الخريطة.' : 'لم يتم العثور على الخبر.', result.ok ? '🗑 Removed from the Syrian Army section on the website/map.' : 'Item not found.'), menuKeyboard(ctx, h));
  }));
  bot.callbackQuery('army:monitor', (ctx) => ownerOnly(ctx, async () => {
    const j = state(); j.monitorOn = !j.monitorOn; j.monitorUpdatedAt = Date.now(); persist(); await answer(ctx, j.monitorOn ? say(ctx, h, 'تم تشغيل الرصد', 'Monitoring enabled') : say(ctx, h, 'تم إيقاف الرصد', 'Monitoring paused')); return showMenu(ctx, h);
  }));
  bot.callbackQuery('army:sources', (ctx) => ownerOnly(ctx, async () => { const screen = sourceScreen(ctx, h); await answer(ctx); return h.show(ctx, screen.text, screen.keyboard); }));
  bot.callbackQuery('army:source:add', (ctx) => ownerOnly(ctx, async () => {
    await answer(ctx);
    return startDraft(ctx, h, { mode: 'add_monitor_source', step: 'username', createdAt: Date.now() }, say(ctx, h, '<b>أرسل اسم مستخدم قناة تيليغرام عامة أو رابطها</b> (مثال: @channelname أو https://t.me/channelname). لا تدعم القنوات الخاصة أو روابط الدعوة.', '<b>Send a public Telegram channel username or link</b> (e.g. @channelname or https://t.me/channelname). Private channels and invite links are not supported.'), cancelKeyboard(ctx, h));
  }));
  bot.callbackQuery(/^army:source:manage:([A-Za-z][A-Za-z0-9_]{4,31})$/, (ctx) => ownerOnly(ctx, async () => {
    const screen = sourceManageScreen(ctx, h, ctx.match[1]); await answer(ctx);
    return screen ? h.show(ctx, screen.text, screen.keyboard) : showMenu(ctx, h);
  }));
  bot.callbackQuery(/^army:source:edit-name:([A-Za-z][A-Za-z0-9_]{4,31})$/, (ctx) => ownerOnly(ctx, async () => {
    const username = ctx.match[1]; const source = state().manualSources[username]; await answer(ctx);
    if (!source) return showMenu(ctx, h);
    return startDraft(ctx, h, { mode: 'edit_monitor_source', field: 'name', sourceUsername: username, createdAt: Date.now() }, say(ctx, h, `<b>أرسل الاسم المعروض للمصدر</b>\nالحالي: ${esc(source.name)}`, `<b>Send a display name for the source</b>\nCurrent: ${esc(source.name)}`), cancelKeyboard(ctx, h));
  }));
  bot.callbackQuery(/^army:source:edit-channel:([A-Za-z][A-Za-z0-9_]{4,31})$/, (ctx) => ownerOnly(ctx, async () => {
    const username = ctx.match[1]; const source = state().manualSources[username]; await answer(ctx);
    if (!source) return showMenu(ctx, h);
    return startDraft(ctx, h, { mode: 'edit_monitor_source', field: 'username', sourceUsername: username, createdAt: Date.now() }, say(ctx, h, '<b>أرسل اسم المستخدم أو الرابط الجديد للقناة العامة</b>. سيبدأ الرصد من أحدث منشور عند أول تحقق، دون استيراد الأرشيف.', '<b>Send the new public channel username or link</b>. The first check starts at the latest post without importing history.'), cancelKeyboard(ctx, h));
  }));
  bot.callbackQuery(/^army:source:set-type:(official|media):([A-Za-z][A-Za-z0-9_]{4,31})$/, (ctx) => ownerOnly(ctx, async () => {
    const [, type, username] = ctx.match; const result = updateManualArmySource(username, { type }, state()); await answer(ctx, result.ok ? say(ctx, h, 'تم تحديث تصنيف المصدر.', 'Source type updated.') : say(ctx, h, 'تعذر تحديث المصدر.', 'Could not update source.'));
    if (result.ok) persist();
    const screen = sourceManageScreen(ctx, h, username); return screen ? h.show(ctx, screen.text, screen.keyboard) : showMenu(ctx, h);
  }));
  bot.callbackQuery(/^army:source:delete:([A-Za-z][A-Za-z0-9_]{4,31})$/, (ctx) => ownerOnly(ctx, async () => {
    const username = ctx.match[1]; const source = state().manualSources[username]; await answer(ctx);
    if (!source) return showMenu(ctx, h);
    return h.show(ctx, say(ctx, h, `<b>تأكيد حذف مصدر الرصد؟</b>\n\n${esc(source.name)} (@${esc(username)})\n\nسيتوقف رصد القناة. لا تُحذف الأخبار التي سبق أن أُرسلت للمراجعة.`, `<b>Delete this monitoring source?</b>\n\n${esc(source.name)} (@${esc(username)})\n\nMonitoring will stop. Items already sent for review will not be deleted.`), new InlineKeyboard().text(say(ctx, h, '🗑 نعم، احذف المصدر', '🗑 Yes, delete source'), `army:source:delete-yes:${username}`).row().text(say(ctx, h, 'إلغاء', 'Cancel'), `army:source:manage:${username}`));
  }));
  bot.callbackQuery(/^army:source:delete-yes:([A-Za-z][A-Za-z0-9_]{4,31})$/, (ctx) => ownerOnly(ctx, async () => {
    const result = removeManualArmySource(ctx.match[1], state()); await answer(ctx, result.ok ? say(ctx, h, 'حُذف المصدر وتوقف رصده.', 'Source deleted and monitoring stopped.') : say(ctx, h, 'المصدر غير موجود.', 'Source not found.'));
    if (result.ok) persist();
    const screen = sourceScreen(ctx, h); return h.show(ctx, screen.text, screen.keyboard);
  }));
  bot.callbackQuery(/^army:source:add-type:(official|media)$/, (ctx) => ownerOnly(ctx, async () => {
    const match = ctx.match;
    const draft = state().adminDrafts[idOf(ctx)];
    if (!draft || draft.mode !== 'add_monitor_source' || draft.step !== 'type') return answer(ctx);
    const result = addManualArmySource({ username: draft.username, name: draft.name, type: match[1] }, state());
    if (!result.ok) {
      if (result.error === 'duplicate') {
        delete draft.username; delete draft.name; draft.step = 'username'; draft.updatedAt = Date.now(); persist();
        await answer(ctx, say(ctx, h, 'هذا المصدر موجود مسبقاً؛ أرسل معرف قناة أخرى.', 'This source already exists; send a different channel username.'));
        return h.show(ctx, say(ctx, h, '<b>أرسل اسم مستخدم قناة تيليغرام عامة أو رابطها</b> (مثال: @channelname أو https://t.me/channelname).', '<b>Send a public Telegram channel username or link</b> (e.g. @channelname or https://t.me/channelname).'), cancelKeyboard(ctx, h));
      }
      await answer(ctx, say(ctx, h, 'تعذر إضافة المصدر.', 'Could not add source.'));
      const message = result.error === 'duplicate' ? say(ctx, h, 'هذا المصدر موجود مسبقاً.', 'This source already exists.') : result.error === 'limit' ? say(ctx, h, 'بلغت الحد الأقصى (10 مصادر يدوية).', 'The limit of 10 manual sources has been reached.') : say(ctx, h, 'تعذر التحقق من بيانات المصدر.', 'Could not validate source details.');
      return h.show(ctx, message, cancelKeyboard(ctx, h));
    }
    delete state().adminDrafts[idOf(ctx)]; persist(); await answer(ctx, say(ctx, h, 'أُضيف المصدر؛ يبدأ الرصد بعد أول تحقق.', 'Source added; monitoring starts after its first baseline check.'));
    const screen = sourceScreen(ctx, h); return h.show(ctx, screen.text, screen.keyboard);
  }));
  bot.callbackQuery('army:channels', (ctx) => ownerOnly(ctx, async () => { const screen = channelScreen(ctx, h); await answer(ctx); return h.show(ctx, screen.text, screen.keyboard); }));
  bot.callbackQuery(/^army:channel:edit:(tg|wa)$/, (ctx) => ownerOnly(ctx, async () => {
    const kind = ctx.match[1]; await answer(ctx);
    const draft = { mode: 'army_channel', kind, createdAt: Date.now() };
    const prompt = kind === 'tg'
      ? say(ctx, h, '<b>أرسل رابط قناة تيليغرام</b> بصيغة https://t.me/اسم_القناة. لن يتم النشر إلى القناة.', '<b>Send a Telegram channel link</b> in https://t.me/channel_name format. Nothing will be posted there.')
      : say(ctx, h, '<b>أرسل رابط قناة واتساب</b> بصيغة https://whatsapp.com/channel/… أو رابط دعوة قناة/مجموعة. لن يتم النشر إليها.', '<b>Send a WhatsApp channel link</b> (whatsapp.com/channel/…) or invite link. Nothing will be posted there.');
    return startDraft(ctx, h, draft, prompt, cancelKeyboard(ctx, h));
  }));
  bot.callbackQuery(/^army:channel:clear:(tg|wa)$/, (ctx) => ownerOnly(ctx, async () => {
    const kind = ctx.match[1]; await answer(ctx);
    return h.show(ctx, say(ctx, h, `تأكيد إزالة رابط ${kind === 'tg' ? 'تيليغرام' : 'واتساب'} من قسم الجيش السوري؟`, `Confirm removing the ${kind === 'tg' ? 'Telegram' : 'WhatsApp'} link from the Syrian Army section?`), new InlineKeyboard().text(say(ctx, h, 'نعم، أزل الرابط', 'Yes, remove link'), `army:channel:clear-yes:${kind}`).row().text(say(ctx, h, 'إلغاء', 'Cancel'), 'army:channels'));
  }));
  bot.callbackQuery(/^army:channel:clear-yes:(tg|wa)$/, (ctx) => ownerOnly(ctx, async () => {
    const kind = ctx.match[1]; clearArmyChannel(kind, state()); persist({ broadcast: true }); await answer(ctx, say(ctx, h, 'أُزيل الرابط', 'Link removed')); const screen = channelScreen(ctx, h); return h.show(ctx, screen.text, screen.keyboard);
  }));

  bot.on('message:text', async (ctx, next) => {
    if (!h.owner(ctx) || ctx.chat?.type !== 'private') return next();
    const uid = idOf(ctx); const draft = state().adminDrafts[uid];
    if (!draft) return next();
    if (Date.now() - Number(draft.updatedAt || draft.createdAt || 0) > 6 * 3600_000) { delete state().adminDrafts[uid]; persist(); return next(); }
    const raw = String(ctx.message.text || '').trim();
    if (!raw || raw.startsWith('/')) return next();
    await deleteInput(ctx);
    if (draft.mode === 'add_monitor_source' && draft.step === 'username') {
      const username = normalizeArmyTelegramUsername(raw);
      if (!username) return h.show(ctx, say(ctx, h, 'اسم/رابط غير صالح. أرسل معرف قناة عامة من 5 إلى 32 حرفاً أو رابط https://t.me/اسم_القناة.', 'Invalid username/link. Send a public channel username (5–32 characters) or https://t.me/channel_name.'), cancelKeyboard(ctx, h));
      draft.username = username; draft.step = 'name'; draft.updatedAt = Date.now(); persist();
      return h.show(ctx, say(ctx, h, '<b>أرسل اسماً واضحاً للمصدر</b> (حرفان على الأقل).', '<b>Send a clear display name</b> (at least 2 characters).'), cancelKeyboard(ctx, h));
    }
    if (draft.mode === 'add_monitor_source' && draft.step === 'name') {
      const name = clean(raw, 70);
      if (name.length < 2) return h.show(ctx, say(ctx, h, 'الاسم قصير؛ أرسل حرفين على الأقل.', 'Name too short; send at least 2 characters.'), cancelKeyboard(ctx, h));
      draft.name = name; draft.step = 'type'; draft.updatedAt = Date.now(); persist();
      const keyboard = new InlineKeyboard().text(say(ctx, h, 'مصدر رسمي', 'Official source'), 'army:source:add-type:official').text(say(ctx, h, 'إشارة إعلامية', 'Media signal'), 'army:source:add-type:media').row().text(say(ctx, h, 'إلغاء', 'Cancel'), 'army:cancel');
      return h.show(ctx, say(ctx, h, '<b>اختر تصنيف المصدر</b>؛ التصنيف الإعلامي لا يعني تأكيداً رسمياً.', '<b>Choose a source type</b>; media does not mean official confirmation.'), keyboard);
    }
    if (draft.mode === 'edit_monitor_source') {
      const patch = draft.field === 'name' ? { name: clean(raw, 70) } : { username: normalizeArmyTelegramUsername(raw) };
      if (draft.field === 'name' && patch.name.length < 2) return h.show(ctx, say(ctx, h, 'الاسم قصير؛ أرسل حرفين على الأقل.', 'Name too short; send at least 2 characters.'), cancelKeyboard(ctx, h));
      if (draft.field === 'username' && !patch.username) return h.show(ctx, say(ctx, h, 'رابط/معرف غير صالح. استخدم قناة عامة على t.me.', 'Invalid username/link. Use a public t.me channel.'), cancelKeyboard(ctx, h));
      const result = updateManualArmySource(draft.sourceUsername, patch, state());
      if (!result.ok) return h.show(ctx, say(ctx, h, result.error === 'duplicate' ? 'المصدر موجود مسبقاً.' : 'تعذّر تعديل المصدر؛ تحقق من البيانات.', result.error === 'duplicate' ? 'Source already exists.' : 'Could not update source; check the input.'), cancelKeyboard(ctx, h));
      delete state().adminDrafts[uid]; persist();
      const screen = sourceManageScreen(ctx, h, result.source.u) || sourceScreen(ctx, h);
      return h.show(ctx, screen.text, screen.keyboard);
    }
    if (draft.mode === 'create' && draft.step === 'title') {
      const title = clean(raw, 120);
      if (title.length < 3) return h.show(ctx, say(ctx, h, 'أرسل عنواناً من 3 أحرف على الأقل.', 'Send a title of at least 3 characters.'), cancelKeyboard(ctx, h));
      draft.title = title; draft.step = 'text'; draft.updatedAt = Date.now(); persist();
      return h.show(ctx, say(ctx, h, '<b>أرسل نص الخبر الرسمي</b> (10–3600 حرفاً). لا تضف رقماً أو معلومة غير موجودة في المصدر.', '<b>Send the official announcement text</b> (10–3600 characters). Do not add figures or claims absent from the source.'), cancelKeyboard(ctx, h));
    }
    if (draft.mode === 'create' && draft.step === 'text') {
      const text = String(raw).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, MAX_TEXT);
      if (text.length < 10) return h.show(ctx, say(ctx, h, 'أرسل نصاً من 10 أحرف على الأقل.', 'Send at least 10 characters.'), cancelKeyboard(ctx, h));
      draft.text = text; draft.step = 'source'; draft.updatedAt = Date.now(); persist();
      return h.show(ctx, say(ctx, h, '<b>أرسل رابط المنشور أو المصدر الرسمي (HTTPS)</b>. لا يُعتمد الخبر دون مصدر يمكن فتحه والتحقق منه.', '<b>Send the official post/source URL (HTTPS)</b>. The item cannot be approved without a verifiable source.'), cancelKeyboard(ctx, h));
    }
    if (draft.mode === 'create' && draft.step === 'source') {
      const sourceUrl = secureUrl(raw);
      if (!sourceUrl) return h.show(ctx, say(ctx, h, 'الرابط غير صالح. استخدم رابط HTTPS رسمي للمنشور أو المصدر.', 'Invalid URL. Use an official HTTPS post/source link.'), cancelKeyboard(ctx, h));
      const made = createPendingArmyItem({ kind: 'manual', sourceKey: `manual:${uid}:${Date.now()}`, category: draft.category, title: draft.title, text: draft.text, sourceName: 'إضافة الإدارة', sourceUrl, links: (draft.text.match(/https:\/\/[^\s<>()[\]{}]+/gi) || []) }, state());
      delete state().adminDrafts[uid];
      if (!made.item) { persist(); return h.show(ctx, say(ctx, h, 'تعذر إنشاء مسودة؛ تحقق من النص أو أن الخبر مكرر.', 'Could not create draft; check the text or whether it is a duplicate.'), menuKeyboard(ctx, h)); }
      persist();
      return h.show(ctx, itemScreenText(ctx, h, made.item), itemKeyboard(ctx, h, made.item));
    }
    if (draft.mode === 'edit_item') {
      const patch = draft.field === 'title' ? { title: clean(raw, 120) } : { text: String(raw).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, MAX_TEXT) };
      const result = updateArmyItem(draft.itemId, patch, state(), ctx.from.id); delete state().adminDrafts[uid];
      if (!result.ok) { persist(); return h.show(ctx, say(ctx, h, 'تعذّر التعديل: تحقق من طول النص وأنه ليس مكرراً.', 'Could not save the edit: check its length and make sure it is not a duplicate.'), menuKeyboard(ctx, h)); }
      persist({ broadcast: result.item.status === 'approved' });
      return h.show(ctx, itemScreenText(ctx, h, result.item), itemKeyboard(ctx, h, result.item));
    }
    if (draft.mode === 'army_channel') {
      const kind = draft.kind; const result = setArmyChannel(kind, raw, state());
      if (!result.ok) {
        return h.show(ctx, say(ctx, h, kind === 'tg' ? 'الرابط غير صالح. أدخل رابط قناة عامة بصيغة https://t.me/اسم_القناة.' : 'الرابط غير صالح. أدخل رابط قناة واتساب رسمياً.', kind === 'tg' ? 'Invalid link. Enter a public channel link like https://t.me/channel_name.' : 'Invalid link. Enter a valid WhatsApp channel link.'), cancelKeyboard(ctx, h));
      }
      delete state().adminDrafts[uid]; persist({ broadcast: true });
      const screen = channelScreen(ctx, h);
      return h.show(ctx, screen.text, screen.keyboard);
    }
    return next();
  });
}

export const _test = { menuText, menuKeyboard, categoryKeyboard, itemScreenText, itemKeyboard, listText, listKeyboard, sourceScreen, sourceManageScreen, channelScreen, secureUrl };
