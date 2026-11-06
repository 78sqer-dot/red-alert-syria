import crypto from 'node:crypto';
import { InlineKeyboard } from 'grammy';
import { store } from './store.js';
import {
  addCustomArea, addCustomGovernorate, createPendingJob, decideJob, deleteJobListing,
  jobsState, locationForDistrict, locationForGovernorate, locationForPlace,
  publicJobs, updatePublishedJob,
} from './jobs.js';
import { districts, districtsOf, getDist, getGov, governorates, placesOf } from './places.js';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const LIMIT = 3600;
const PAGE_SIZE = 8;
const clean = (value, max = LIMIT) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
function urls(text) {
  const found = [];
  for (const raw of String(text || '').match(/https:\/\/\S+/gi) || []) {
    const candidate = raw.replace(/[),.;!?]+$/g, '');
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' && url.hostname && !url.username && !url.password && !found.includes(url.href)) found.push(url.href);
    } catch { /* ignore malformed links */ }
    if (found.length >= 8) break;
  }
  return found;
}
const en = (ctx, h) => h.langOf(ctx) === 'en';
const say = (ctx, h, ar, english) => en(ctx, h) ? english : ar;
const save = ({ broadcast = false } = {}) => {
  store.persist();
  if (broadcast) store.emit('jobs', publicJobs());
};
const uidOf = (ctx) => String(ctx.from?.id || '');
const govByCode = (code, j) => getGov(String(code)) || j.customGovernorates.find((row) => row.code === String(code)) || null;
const adById = (id, j) => j.published[id] || j.pending[id] || null;
const locText = (location, english = false) => location ? (english ? location.label_en : location.label_ar) : '—';
const activeItems = (j) => [
  ...Object.values(j.published || {}).filter((row) => row && !j.deleted?.[row.id]).map((row) => ({ ...row, _status: 'approved' })),
  ...Object.values(j.pending || {}).filter((row) => row && !j.deleted?.[row.id]).map((row) => ({ ...row, _status: 'pending' })),
].sort((a, b) => Number(b.publishedAt || b.createdAt || 0) - Number(a.publishedAt || a.createdAt || 0));

function panelText(ctx, h) {
  const j = jobsState(); const english = en(ctx, h);
  return english
    ? `<b>💼 Job listings control panel</b>\n\nApproved on the website: <b>${Object.keys(j.published).length}</b> · Waiting for review: <b>${Object.keys(j.pending).length}</b>\nCustom governorates: <b>${j.customGovernorates.length}</b> · Custom areas: <b>${j.customAreas.length}</b>\n\nListings are shown in the website Jobs section only. They are never sent to the Telegram news channel. An owner confirmation is required before a new listing is approved or a listing is deleted.`
    : `<b>💼 لوحة إدارة إعلانات الوظائف</b>\n\nالمعتمدة على الموقع: <b>${Object.keys(j.published).length}</b> · بانتظار المراجعة: <b>${Object.keys(j.pending).length}</b>\nمحافظات مضافة: <b>${j.customGovernorates.length}</b> · مناطق مضافة: <b>${j.customAreas.length}</b>\n\nالإعلانات تظهر في قسم الوظائف بالموقع فقط، ولا تُنشر في قناة الأخبار. يلزم تأكيد المالك قبل اعتماد إعلان جديد أو حذف إعلان.`;
}
function panelKeyboard(ctx, h) {
  const english = en(ctx, h);
  return new InlineKeyboard()
    .text(english ? '➕ Add listing' : '➕ إضافة إعلان', 'j:admin:add')
    .text(english ? '📋 Manage listings' : '📋 إدارة الإعلانات', 'j:admin:list:0').row()
    .text(english ? '📍 Manage governorates and areas' : '📍 إدارة المحافظات والمناطق', 'j:admin:locations').row()
    .text(english ? '🔄 Refresh' : '🔄 تحديث', 'j:admin')
    .text(english ? '↩️ Jobs monitor' : '↩️ رصد الوظائف', 'j:menu').row()
    .text(english ? '↩️ Main menu' : '↩️ القائمة الرئيسية', 'home');
}
async function showPanel(ctx, h) { return h.show(ctx, panelText(ctx, h), panelKeyboard(ctx, h)); }
async function answer(ctx, text = '') { try { await ctx.answerCallbackQuery(text ? { text: String(text).slice(0, 190) } : undefined); } catch { /* stale callbacks should not break the action */ } }
async function inputDelete(ctx) { try { await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id); } catch { /* ignore */ } }
async function clearPrompt(ctx, draft) {
  if (draft?.promptId) try { await ctx.api.deleteMessage(ctx.chat.id, draft.promptId); } catch { /* prompt may already be gone */ }
  if (draft) draft.promptId = null;
}
function storeDraft(uid, draft) {
  draft.updatedAt = Date.now();
  jobsState().adminDrafts[uid] = draft;
  save();
}
function removeDraft(uid) { delete jobsState().adminDrafts[uid]; save(); }
async function showDraftScreen(ctx, h, draft, text, keyboard) {
  const oldId = Number(draft.promptId) || null;
  if (ctx.callbackQuery?.message) {
    draft.promptId = ctx.callbackQuery.message.message_id;
    storeDraft(uidOf(ctx), draft);
    return h.show(ctx, text, keyboard);
  }
  if (oldId) try { await ctx.api.deleteMessage(ctx.chat.id, oldId); } catch { /* prior prompt may be gone */ }
  const sent = await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard, link_preview_options: { is_disabled: true } });
  draft.promptId = sent.message_id;
  storeDraft(uidOf(ctx), draft);
  return sent;
}
function cancelKeyboard(ctx, h, callback = 'j:admin:cancel-draft') {
  return new InlineKeyboard().text(say(ctx, h, '✖️ إلغاء', '✖️ Cancel'), callback);
}
function locationPickerKeyboard(j, english) {
  const kb = new InlineKeyboard();
  const govs = [...governorates, ...j.customGovernorates];
  govs.forEach((gov, i) => {
    const custom = !getGov(gov.code);
    kb.text(`${custom ? '✳️ ' : ''}${english ? gov.en || gov.ar : gov.ar}`.slice(0, 54), `j:adminloc:g:${gov.code}`);
    if (i % 2 === 1 || i === govs.length - 1) kb.row();
  });
  kb.text(english ? '✖️ Cancel' : '✖️ إلغاء', 'j:admin:cancel-draft');
  return kb;
}
function governorateSelectorKeyboard(j, english) {
  const kb = new InlineKeyboard();
  const govs = [...governorates, ...j.customGovernorates];
  govs.forEach((gov, i) => {
    const custom = !getGov(gov.code);
    kb.text(`${custom ? '✳️ ' : ''}${english ? gov.en || gov.ar : gov.ar}`.slice(0, 54), `j:admin:locations-gov:${gov.code}`);
    if (i % 2 === 1 || i === govs.length - 1) kb.row();
  });
  kb.text(english ? '✖️ Cancel' : '✖️ إلغاء', 'j:admin:cancel-draft');
  return kb;
}
function locationsForGovernorate(j, govCode, english) {
  const kb = new InlineKeyboard();
  const gov = govByCode(govCode, j);
  if (!gov) return kb.text(english ? '↩️ Governorates' : '↩️ المحافظات', 'j:adminloc:gov');
  const canonical = districtsOf(gov.code);
  const custom = j.customAreas.filter((row) => row.governorate_code === gov.code);
  const total = canonical.length + custom.length;
  kb.text(english ? '📍 Whole governorate' : '📍 المحافظة كلها', `j:adminloc:whole:${gov.code}`).row();
  [...canonical, ...custom].forEach((area, i) => {
    const isCustom = !districts.some((row) => row.code === area.code);
    kb.text(`${isCustom ? '✳️ ' : ''}${english ? area.en || area.ar : area.ar}`.slice(0, 54), `${isCustom ? 'j:adminloc:area:' : 'j:adminloc:d:'}${area.code}`);
    if (i % 2 === 1 || i === total - 1) kb.row();
  });
  kb.text(english ? '↩️ Governorates' : '↩️ المحافظات', 'j:adminloc:gov').row()
    .text(english ? '✖️ Cancel' : '✖️ إلغاء', 'j:admin:cancel-draft');
  return kb;
}
function locationPlacesKeyboard(j, english, govCode, districtCode, page = 0) {
  const rows = placesOf(String(districtCode));
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const current = Math.max(0, Math.min(pages - 1, Number(page) || 0));
  const kb = new InlineKeyboard();
  const district = getDist(districtCode);
  kb.text(english ? '📍 Whole area' : '📍 المنطقة كلها', `j:adminloc:wholearea:${districtCode}`).row();
  const list = rows.slice(current * 20, (current + 1) * 20);
  list.forEach((place, i) => {
    kb.text((english ? place.en || place.ar : place.ar).slice(0, 54), `j:adminloc:place:${place.id}`);
    if (i % 2 === 1 || i === list.length - 1) kb.row();
  });
  if (pages > 1) {
    if (current > 0) kb.text(english ? '‹ Previous' : '‹ السابق', `j:adminloc:page:${districtCode}:${current - 1}`);
    kb.text(english ? `Page ${current + 1}/${pages}` : `صفحة ${current + 1}/${pages}`, 'j:adminloc:noop');
    if (current + 1 < pages) kb.text(english ? 'Next ›' : 'التالي ›', `j:adminloc:page:${districtCode}:${current + 1}`);
    kb.row();
  }
  kb.text(english ? '↩️ Areas' : '↩️ المناطق', `j:adminloc:g:${govCode}`).row()
    .text(english ? '✖️ Cancel' : '✖️ إلغاء', 'j:admin:cancel-draft');
  return { kb, district };
}
function draftPreview(ctx, h, draft) {
  const english = en(ctx, h);
  const text = english
    ? `<b>Review the new job listing</b>\n\n<b>${esc(draft.title)}</b>\n📍 ${esc(locText(draft.location, true))}\n\n${esc(draft.text)}\n\nAfter you confirm, it appears on the website Jobs page only; nothing is posted to the news channel.`
    : `<b>معاينة إعلان الوظيفة</b>\n\n<b>${esc(draft.title)}</b>\n📍 ${esc(locText(draft.location))}\n\n${esc(draft.text)}\n\nبعد تأكيدك سيظهر الإعلان في قسم الوظائف بالموقع فقط؛ لن يُنشر في قناة الأخبار.`;
  const keyboard = new InlineKeyboard()
    .text(english ? '✅ Approve for website only' : '✅ اعتماد للموقع فقط', 'j:admin:publish')
    .text(english ? '📍 Change location' : '📍 تغيير الموقع', 'j:adminloc:gov').row()
    .text(english ? '✏️ Change details' : '✏️ تعديل التفاصيل', 'j:admin:details').row()
    .text(english ? '✖️ Cancel' : '✖️ إلغاء', 'j:admin:cancel-draft');
  return { text, keyboard };
}
async function showDraft(ctx, h, draft) {
  if (draft.step === 'location') {
    return showDraftScreen(ctx, h, draft,
      say(ctx, h, '<b>اختر محافظة الإعلان</b>\n\nتُعرض المحافظات والمناطق المضافة يدوياً بعلامة ✳️.', '<b>Choose the listing governorate</b>\n\nCustom entries are marked ✳️.'),
      locationPickerKeyboard(jobsState(), en(ctx, h)));
  }
  if (draft.step === 'choose_area') {
    const gov = govByCode(draft.governorateCode, jobsState());
    return showDraftScreen(ctx, h, draft,
      say(ctx, h, `<b>اختر منطقة في ${esc(gov?.ar || '')}</b>، أو استخدم المحافظة كاملة.`, `<b>Choose an area in ${esc(gov?.en || gov?.ar || '')}</b>, or select the whole governorate.`),
      locationsForGovernorate(jobsState(), draft.governorateCode, en(ctx, h)));
  }
  if (draft.step === 'choose_place') {
    const { kb, district } = locationPlacesKeyboard(jobsState(), en(ctx, h), draft.governorateCode, draft.districtCode, draft.page || 0);
    return showDraftScreen(ctx, h, draft,
      say(ctx, h, `<b>اختر بلدة أو مدينة في ${esc(district?.ar || '')}</b>، أو اختر المنطقة كلها.`, `<b>Choose a town or city in ${esc(district?.en || district?.ar || '')}</b>, or select the whole area.`), kb);
  }
  const preview = draftPreview(ctx, h, draft);
  return showDraftScreen(ctx, h, draft, preview.text, preview.keyboard);
}
function locationListText(ctx, h) {
  const j = jobsState(); const english = en(ctx, h);
  const customGovs = j.customGovernorates.map((gov) => {
    const areas = j.customAreas.filter((row) => row.governorate_code === gov.code);
    return `✳️ <b>${esc(english ? gov.en || gov.ar : gov.ar)}</b>${areas.length ? ` — ${areas.map((x) => esc(english ? x.en || x.ar : x.ar)).join('، ')}` : ''}`;
  });
  const areasByGov = new Map();
  for (const area of j.customAreas) {
    if (j.customGovernorates.some((gov) => gov.code === area.governorate_code)) continue;
    const gov = getGov(area.governorate_code);
    const list = areasByGov.get(area.governorate_code) || [];
    list.push(english ? area.en || area.ar : area.ar); areasByGov.set(area.governorate_code, list);
    if (!gov) continue;
  }
  const canonicalExtra = [...areasByGov.entries()].map(([code, areas]) => `• <b>${esc(english ? getGov(code)?.en : getGov(code)?.ar)}</b>: ${areas.map(esc).join('، ')}`);
  const rows = [...customGovs, ...canonicalExtra];
  return english
    ? `<b>📍 Custom governorates and areas</b>\n\nThese additions are used for job listing location labels only; they do not change map geography.\n\n${rows.length ? rows.join('\n') : 'No custom locations yet.'}`
    : `<b>📍 المحافظات والمناطق المضافة</b>\n\nتُستخدم الإضافات لتحديد موقع إعلان الوظيفة فقط، ولا تغيّر بيانات جغرافيا الخريطة.\n\n${rows.length ? rows.join('\n') : 'لا توجد مواقع مضافة بعد.'}`;
}
function locationManageKeyboard(ctx, h) {
  const english = en(ctx, h);
  return new InlineKeyboard()
    .text(english ? '➕ Add governorate' : '➕ إضافة محافظة', 'j:admin:location:add-gov')
    .text(english ? '➕ Add area' : '➕ إضافة منطقة', 'j:admin:location:add-area').row()
    .text(english ? '↩️ Control panel' : '↩️ لوحة الإدارة', 'j:admin');
}
function formatNameInput(ctx, h, label) {
  return say(ctx, h,
    `${label}\n\nأرسل الاسم بالعربية، ويمكنك إضافة الاسم الإنكليزي بعد الفاصل |\nمثال: ريف درعا | Daraa Countryside`,
    `${label}\n\nSend the Arabic name; optionally add English after |\nExample: ريف درعا | Daraa Countryside`);
}
function parseNamePair(text) {
  const [ar, ...rest] = String(text || '').split('|');
  return { ar: clean(ar, 100), en: clean(rest.join('|'), 100) };
}

export function registerJobsAdminTools(bot, h) {
  const ownerOnly = (ctx, fn) => h.owner(ctx) ? fn() : answer(ctx);

  bot.callbackQuery('j:admin', (ctx) => ownerOnly(ctx, async () => { await answer(ctx); await showPanel(ctx, h); }));
  bot.callbackQuery('j:admin:noop', (ctx) => ownerOnly(ctx, () => answer(ctx)));
  bot.callbackQuery('j:adminloc:noop', (ctx) => ownerOnly(ctx, () => answer(ctx)));
  bot.callbackQuery('j:admin:locations', (ctx) => ownerOnly(ctx, async () => {
    await answer(ctx); await h.show(ctx, locationListText(ctx, h), locationManageKeyboard(ctx, h));
  }));
  bot.callbackQuery('j:admin:location:add-gov', (ctx) => ownerOnly(ctx, async () => {
    await answer(ctx); const draft = { mode: 'add_governorate', step: 'name', createdAt: Date.now() }; storeDraft(uidOf(ctx), draft);
    await showDraftScreen(ctx, h, draft, formatNameInput(ctx, h, say(ctx, h, '➕ اسم المحافظة الجديدة', '➕ New governorate name')), cancelKeyboard(ctx, h, 'j:admin:cancel-draft'));
  }));
  bot.callbackQuery('j:admin:location:add-area', (ctx) => ownerOnly(ctx, async () => {
    await answer(ctx); const draft = { mode: 'select_area_governorate', step: 'governorate', createdAt: Date.now() }; storeDraft(uidOf(ctx), draft);
    const keyboard = governorateSelectorKeyboard(jobsState(), en(ctx, h));
    await showDraftScreen(ctx, h, draft, say(ctx, h, '<b>اختر المحافظة التي تضاف إليها المنطقة</b>', '<b>Choose the governorate that will contain the new area</b>'), keyboard);
  }));
  bot.callbackQuery(/^j:admin:locations-gov:([A-Za-z0-9_-]+)$/, (ctx) => ownerOnly(ctx, async () => {
    const code = ctx.match[1]; const draft = jobsState().adminDrafts[uidOf(ctx)];
    if (!draft || draft.mode !== 'select_area_governorate') return answer(ctx);
    const gov = govByCode(code, jobsState()); if (!gov) return answer(ctx, say(ctx, h, 'المحافظة غير موجودة', 'Governorate not found'));
    await answer(ctx); const nextDraft = { ...draft, mode: 'add_area', step: 'name', governorateCode: code };
    storeDraft(uidOf(ctx), nextDraft);
    await showDraftScreen(ctx, h, nextDraft, formatNameInput(ctx, h, say(ctx, h, `➕ اسم المنطقة ضمن ${gov.ar}`, `➕ New area in ${gov.en || gov.ar}`)), cancelKeyboard(ctx, h, 'j:admin:cancel-draft'));
  }));

  bot.callbackQuery('j:admin:add', (ctx) => ownerOnly(ctx, async () => {
    await answer(ctx);
    const draft = { mode: 'create', step: 'title', title: '', text: '', location: null, createdAt: Date.now() };
    storeDraft(uidOf(ctx), draft);
    await showDraftScreen(ctx, h, draft,
      say(ctx, h, '<b>➕ إضافة إعلان وظيفة</b>\n\nأرسل المسمّى الوظيفي وعنوان الإعلان (حتى 120 حرفاً).', '<b>➕ Add a job listing</b>\n\nSend the job title (up to 120 characters).'),
      cancelKeyboard(ctx, h));
  }));
  bot.callbackQuery('j:admin:details', (ctx) => ownerOnly(ctx, async () => {
    const draft = jobsState().adminDrafts[uidOf(ctx)];
    if (!draft || draft.mode !== 'create') return answer(ctx);
    await answer(ctx); draft.step = 'text'; storeDraft(uidOf(ctx), draft);
    await showDraftScreen(ctx, h, draft,
      say(ctx, h, '<b>تفاصيل الإعلان</b>\n\nأرسل وصفاً يتضمن جهة العمل إن عُرفت، المهام والشروط وطريقة التقديم. أضف روابط HTTPS إن وجدت.', '<b>Listing details</b>\n\nSend the description, employer if known, duties, requirements and how to apply. Include HTTPS links if available.'), cancelKeyboard(ctx, h));
  }));
  bot.callbackQuery('j:admin:publish', (ctx) => ownerOnly(ctx, async () => {
    const j = jobsState(); const uid = uidOf(ctx); const draft = j.adminDrafts[uid];
    if (!draft || draft.mode !== 'create' || draft.step !== 'preview' || !draft.title || !draft.text || !draft.location) return answer(ctx, say(ctx, h, 'أكمل بيانات الإعلان والموقع أولاً', 'Complete the listing and location first'));
    const sourceKey = `manual:${uid}:${crypto.randomUUID()}`;
    const created = createPendingJob({ kind: 'manual', sourceKey, title: draft.title, text: draft.text, links: urls(draft.text), sourceName: say(ctx, h, 'إضافة الإدارة', 'Admin listing'), location: draft.location }, j);
    if (!created.job) return answer(ctx, created.duplicate ? say(ctx, h, 'يوجد إعلان مطابق بالفعل', 'A matching listing already exists') : say(ctx, h, 'تعذّر إنشاء الإعلان', 'Could not create listing'));
    const result = decideJob(created.job.id, 'approve', j, ctx.from.id);
    if (!result.ok) { delete j.pending[created.job.id]; delete j.seen[sourceKey]; delete j.fingerprints[created.job.fingerprint]; save(); return answer(ctx, say(ctx, h, 'تعذّر اعتماد الموقع المحدد', 'The selected location could not be approved')); }
    delete j.adminDrafts[uid];
    save({ broadcast: true });
    await answer(ctx, say(ctx, h, 'اعتمد الإعلان للموقع فقط', 'Approved for the website only'));
    await h.show(ctx, say(ctx, h, `✅ <b>تم اعتماد «${esc(result.job.title)}»</b> في قسم الوظائف بالموقع فقط.\nلم يُنشر في قناة الأخبار.`, `✅ <b>${esc(result.job.title)} is approved</b> in the website Jobs section only.\nIt was not posted to the news channel.`), new InlineKeyboard().text(say(ctx, h, '📋 إدارة الإعلانات', '📋 Manage listings'), 'j:admin:list:0').row().text(say(ctx, h, '↩️ لوحة الإدارة', '↩️ Control panel'), 'j:admin'));
  }));
  bot.callbackQuery('j:admin:cancel-draft', (ctx) => ownerOnly(ctx, async () => {
    const uid = uidOf(ctx); const draft = jobsState().adminDrafts[uid];
    if (draft?.promptId) try { await ctx.api.deleteMessage(ctx.chat.id, draft.promptId); } catch { /* ignore */ }
    removeDraft(uid); await answer(ctx, say(ctx, h, 'تم الإلغاء', 'Cancelled'));
    await showPanel(ctx, h);
  }));

  bot.callbackQuery(/^j:admin:list:(\d+)$/, (ctx) => ownerOnly(ctx, async () => {
    const page = Number(ctx.match[1]) || 0; const rows = activeItems(jobsState()); const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const current = Math.min(Math.max(0, page), pages - 1); const english = en(ctx, h);
    const lines = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((row, i) => `${current * PAGE_SIZE + i + 1}. ${row._status === 'approved' ? '✅' : '🕓'} <b>${esc(row.title)}</b> · ${esc(locText(row.location, english))}`).join('\n');
    const kb = new InlineKeyboard();
    rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).forEach((row) => kb.text(`${row._status === 'approved' ? '✅' : '🕓'} ${row.title}`.slice(0, 55), `j:admin:view:${row.id}`).row());
    if (current > 0) kb.text(english ? '‹ Previous' : '‹ السابق', `j:admin:list:${current - 1}`);
    kb.text(english ? `${current + 1}/${pages}` : `${current + 1}/${pages}`, 'j:admin:noop');
    if (current + 1 < pages) kb.text(english ? 'Next ›' : 'التالي ›', `j:admin:list:${current + 1}`);
    kb.row().text(english ? '➕ Add listing' : '➕ إضافة إعلان', 'j:admin:add').row()
      .text(english ? '↩️ Control panel' : '↩️ لوحة الإدارة', 'j:admin');
    await answer(ctx);
    const text = rows.length ? `${english ? '<b>Job listings</b>' : '<b>إعلانات الوظائف</b>'}\n\n${lines}` : say(ctx, h, '<b>لا توجد إعلانات حالياً.</b>', '<b>No listings yet.</b>');
    await h.show(ctx, text, kb);
  }));
  bot.callbackQuery(/^j:admin:view:([a-f0-9]{14})$/, (ctx) => ownerOnly(ctx, async () => {
    const row = adById(ctx.match[1], jobsState()); if (!row) { await answer(ctx); return showPanel(ctx, h); }
    const english = en(ctx, h); const approved = !!jobsState().published[row.id];
    const text = english
      ? `<b>${approved ? '✅ Approved listing' : '🕓 Pending listing'}</b>\n\n<b>${esc(row.title)}</b>\n📍 ${esc(locText(row.location, true))}\n\n${esc(row.text)}${row.links?.length ? `\n\nLinks: ${row.links.map((u) => `<a href="${esc(u)}">open</a>`).join(' · ')}` : ''}`
      : `<b>${approved ? '✅ إعلان معتمد' : '🕓 إعلان بانتظار المراجعة'}</b>\n\n<b>${esc(row.title)}</b>\n📍 ${esc(locText(row.location))}\n\n${esc(row.text)}${row.links?.length ? `\n\nروابط: ${row.links.map((u) => `<a href="${esc(u)}">فتح</a>`).join(' · ')}` : ''}`;
    const kb = new InlineKeyboard();
    if (approved) kb.text(say(ctx, h, '✏️ تعديل العنوان', '✏️ Edit title'), `j:admin:edit:title:${row.id}`).row()
      .text(say(ctx, h, '✏️ تعديل التفاصيل', '✏️ Edit details'), `j:admin:edit:text:${row.id}`).row()
      .text(say(ctx, h, '📍 تعديل الموقع', '📍 Edit location'), `j:admin:edit:location:${row.id}`).row();
    kb.text(say(ctx, h, '🗑 حذف الإعلان', '🗑 Delete listing'), `j:admin:delete:${row.id}`).row()
      .text(say(ctx, h, '↩️ الإعلانات', '↩️ Listings'), 'j:admin:list:0');
    await answer(ctx); await h.show(ctx, text, kb);
  }));
  bot.callbackQuery(/^j:admin:delete:([a-f0-9]{14})$/, (ctx) => ownerOnly(ctx, async () => {
    const id = ctx.match[1]; const row = adById(id, jobsState()); await answer(ctx);
    if (!row) return showPanel(ctx, h);
    const text = say(ctx, h, `<b>تأكيد حذف الإعلان؟</b>\n\n«${esc(row.title)}»\n\nسيُزال فوراً من الموقع ولن يعود عند استعادة نسخة احتياطية.`, `<b>Confirm listing deletion?</b>\n\n“${esc(row.title)}”\n\nIt will be removed from the website and will not return from an old backup.`);
    await h.show(ctx, text, new InlineKeyboard().text(say(ctx, h, '🗑 نعم، احذف الإعلان', '🗑 Yes, delete listing'), `j:admin:delete-yes:${id}`).row().text(say(ctx, h, '↩️ إلغاء', '↩️ Cancel'), `j:admin:view:${id}`));
  }));
  bot.callbackQuery(/^j:admin:delete-yes:([a-f0-9]{14})$/, (ctx) => ownerOnly(ctx, async () => {
    const id = ctx.match[1]; const result = deleteJobListing(id, jobsState(), ctx.from.id);
    await answer(ctx, result.ok ? say(ctx, h, 'حُذف الإعلان', 'Listing deleted') : say(ctx, h, 'الإعلان غير موجود', 'Listing not found'));
    if (result.ok) save({ broadcast: true });
    if (result.ok) await Promise.allSettled((result.job.cards || []).map(([chat, messageId]) => ctx.api.deleteMessage(Number(chat), Number(messageId))));
    await h.show(ctx, result.ok ? say(ctx, h, '🗑 تم حذف الإعلان من قسم الوظائف في الموقع.', '🗑 The listing was deleted from the website Jobs section.') : say(ctx, h, 'لم يتم العثور على الإعلان.', 'Listing not found.'), new InlineKeyboard().text(say(ctx, h, '📋 إدارة الإعلانات', '📋 Manage listings'), 'j:admin:list:0').row().text(say(ctx, h, '↩️ لوحة الإدارة', '↩️ Control panel'), 'j:admin'));
  }));

  bot.callbackQuery(/^j:admin:edit:(title|text|location):([a-f0-9]{14})$/, (ctx) => ownerOnly(ctx, async () => {
    const [, field, id] = ctx.match; const row = jobsState().published[id];
    if (!row) return answer(ctx, say(ctx, h, 'الإعلان المعتمد غير موجود', 'Approved listing not found'));
    await answer(ctx);
    const draft = { mode: 'edit_listing', field, jobId: id, step: field, createdAt: Date.now(), location: row.location };
    storeDraft(uidOf(ctx), draft);
    if (field === 'location') return showDraft(ctx, h, { ...draft, step: 'location' });
    const prompt = field === 'title'
      ? say(ctx, h, `<b>أرسل العنوان الجديد</b>\nالحالي: ${esc(row.title)}`, `<b>Send the new title</b>\nCurrent: ${esc(row.title)}`)
      : say(ctx, h, '<b>أرسل التفاصيل الجديدة</b> (10–3600 حرفاً).', '<b>Send the revised details</b> (10–3600 characters).');
    await showDraftScreen(ctx, h, draft, prompt, cancelKeyboard(ctx, h, `j:admin:cancel-edit:${id}`));
  }));
  bot.callbackQuery(/^j:admin:cancel-edit:([a-f0-9]{14})$/, (ctx) => ownerOnly(ctx, async () => {
    removeDraft(uidOf(ctx)); await answer(ctx, say(ctx, h, 'تم الإلغاء', 'Cancelled'));
    const id = ctx.match[1]; await h.show(ctx, say(ctx, h, 'تم إلغاء التعديل.', 'Edit cancelled.'), new InlineKeyboard().text(say(ctx, h, '↩️ رجوع للإعلان', '↩️ Back to listing'), `j:admin:view:${id}`));
  }));

  bot.callbackQuery(/^j:adminloc:(.*)$/, (ctx) => ownerOnly(ctx, async () => {
    const uid = uidOf(ctx); const draft = jobsState().adminDrafts[uid];
    if (!draft || !['create', 'edit_listing'].includes(draft.mode)) return answer(ctx);
    const [op, a, b] = String(ctx.match[1] || '').split(':'); const english = en(ctx, h); const j = jobsState();
    if (op === 'gov') {
      draft.step = 'location'; draft.governorateCode = null; await answer(ctx);
      return showDraft(ctx, h, draft);
    }
    if (op === 'g') {
      const gov = govByCode(a, j); if (!gov) return answer(ctx, say(ctx, h, 'المحافظة غير موجودة', 'Governorate not found'));
      draft.governorateCode = gov.code;
      const areas = [...districtsOf(gov.code), ...j.customAreas.filter((area) => area.governorate_code === gov.code)];
      if (!areas.length) {
        draft.location = locationForGovernorate(gov.code, j);
        draft.step = draft.mode === 'create' ? 'preview' : 'location';
        if (draft.mode === 'edit_listing') {
          const res = updatePublishedJob(draft.jobId, { location: draft.location }, j, ctx.from.id);
          if (res.ok) { removeDraft(uid); save({ broadcast: true }); await answer(ctx, say(ctx, h, 'تم تحديث الموقع', 'Location updated')); return h.show(ctx, say(ctx, h, `تم تحديث الموقع إلى ${esc(res.job.location.label_ar)}.`, `Location updated to ${esc(res.job.location.label_en)}.`), new InlineKeyboard().text(say(ctx, h, '↩️ رجوع للإعلان', '↩️ Back to listing'), `j:admin:view:${draft.jobId}`)); }
        }
        await answer(ctx); return showDraft(ctx, h, draft);
      }
      draft.step = 'choose_area'; storeDraft(uid, draft); await answer(ctx);
      return showDraft(ctx, h, draft);
    }
    if (op === 'whole' || op === 'wholearea') {
      const location = op === 'whole' ? locationForGovernorate(a, j) : locationForDistrict(a, j);
      if (!location) return answer(ctx, say(ctx, h, 'الموقع غير موجود', 'Location not found'));
      if (op === 'whole' && draft.governorateCode && String(a) !== String(draft.governorateCode)) return answer(ctx, say(ctx, h, 'اختر المحافظة المحددة أولاً', 'Select the chosen governorate first'));
      if (op === 'wholearea' && draft.governorateCode && String(location.governorate_code) !== String(draft.governorateCode)) return answer(ctx, say(ctx, h, 'المنطقة لا تتبع المحافظة المحددة', 'Area does not match the selected governorate'));
      if (draft.mode === 'edit_listing') {
        const res = updatePublishedJob(draft.jobId, { location }, j, ctx.from.id);
        if (!res.ok) return answer(ctx, say(ctx, h, 'تعذّر تحديث الموقع', 'Could not update location'));
        removeDraft(uid); save({ broadcast: true }); await answer(ctx, say(ctx, h, 'تم تحديث الموقع', 'Location updated'));
        return h.show(ctx, say(ctx, h, `تم تحديث الموقع إلى ${esc(location.label_ar)}.`, `Location updated to ${esc(location.label_en)}.`), new InlineKeyboard().text(say(ctx, h, '↩️ رجوع للإعلان', '↩️ Back to listing'), `j:admin:view:${draft.jobId}`));
      }
      draft.location = location; draft.step = 'preview'; storeDraft(uid, draft); await answer(ctx); return showDraft(ctx, h, draft);
    }
    if (op === 'd') {
      const dist = getDist(a);
      if (!dist || String(dist.gov) !== String(draft.governorateCode)) return answer(ctx, say(ctx, h, 'المنطقة لا تتبع المحافظة المحددة', 'Area does not match the selected governorate'));
      draft.districtCode = dist.code; draft.step = 'choose_place'; draft.page = 0; storeDraft(uid, draft); await answer(ctx); return showDraft(ctx, h, draft);
    }
    if (op === 'area') {
      const area = j.customAreas.find((row) => row.code === a);
      if (!area || String(area.governorate_code) !== String(draft.governorateCode)) return answer(ctx, say(ctx, h, 'المنطقة لا تتبع المحافظة المحددة', 'Area does not match the selected governorate'));
      const location = locationForDistrict(area.code, j);
      if (draft.mode === 'edit_listing') {
        const res = updatePublishedJob(draft.jobId, { location }, j, ctx.from.id);
        if (!res.ok) return answer(ctx, say(ctx, h, 'تعذّر تحديث الموقع', 'Could not update location'));
        removeDraft(uid); save({ broadcast: true }); await answer(ctx, say(ctx, h, 'تم تحديث الموقع', 'Location updated'));
        return h.show(ctx, say(ctx, h, `تم تحديث الموقع إلى ${esc(location.label_ar)}.`, `Location updated to ${esc(location.label_en)}.`), new InlineKeyboard().text(say(ctx, h, '↩️ رجوع للإعلان', '↩️ Back to listing'), `j:admin:view:${draft.jobId}`));
      }
      draft.location = location; draft.step = 'preview'; storeDraft(uid, draft); await answer(ctx); return showDraft(ctx, h, draft);
    }
    if (op === 'page') {
      if (String(a) !== String(draft.districtCode)) return answer(ctx, say(ctx, h, 'المنطقة غير مطابقة للاختيار', 'District does not match'));
      draft.page = Number(b) || 0; await answer(ctx); return showDraft(ctx, h, draft);
    }
    if (op === 'place') {
      const placeId = Number(a); const place = locationForPlace(placeId, draft.governorateCode);
      if (!place || String(place.place_id) !== String(placeId) || String(place.district_code) !== String(draft.districtCode)) return answer(ctx, say(ctx, h, 'البلدة غير مطابقة للاختيار', 'Town does not match'));
      if (draft.mode === 'edit_listing') {
        const res = updatePublishedJob(draft.jobId, { location: place }, j, ctx.from.id);
        if (!res.ok) return answer(ctx, say(ctx, h, 'تعذّر تحديث الموقع', 'Could not update location'));
        removeDraft(uid); save({ broadcast: true }); await answer(ctx, say(ctx, h, 'تم تحديث الموقع', 'Location updated'));
        return h.show(ctx, say(ctx, h, `تم تحديث الموقع إلى ${esc(place.label_ar)}.`, `Location updated to ${esc(place.label_en)}.`), new InlineKeyboard().text(say(ctx, h, '↩️ رجوع للإعلان', '↩️ Back to listing'), `j:admin:view:${draft.jobId}`));
      }
      draft.location = place; draft.step = 'preview'; storeDraft(uid, draft); await answer(ctx); return showDraft(ctx, h, draft);
    }
    if (op === 'noop') return answer(ctx);
    return answer(ctx);
  }));

  bot.on('message:text', async (ctx, next) => {
    if (!h.owner(ctx) || ctx.chat?.type !== 'private') return next();
    const uid = uidOf(ctx); const draft = jobsState().adminDrafts[uid];
    if (!draft || Date.now() - Number(draft.updatedAt || draft.createdAt || 0) > 6 * 3600_000) {
      if (draft) removeDraft(uid);
      return next();
    }
    const raw = String(ctx.message.text || '').trim();
    if (!raw || raw.startsWith('/')) return next();
    await inputDelete(ctx);
    const j = jobsState();
    if (draft.mode === 'create' && draft.step === 'title') {
      const title = clean(raw, 120);
      if (title.length < 3) return showDraftScreen(ctx, h, draft, say(ctx, h, 'أرسل عنواناً من 3 أحرف على الأقل.', 'Send a title of at least 3 characters.'), cancelKeyboard(ctx, h));
      draft.title = title; draft.step = 'text'; storeDraft(uid, draft);
      return showDraftScreen(ctx, h, draft, say(ctx, h, '<b>أرسل تفاصيل الإعلان</b>\n\nاذكر المهام والشروط وطريقة التقديم، وأضف رابط HTTPS إذا كان متوفراً.', '<b>Send the listing details</b>\n\nInclude duties, requirements and how to apply; add an HTTPS link if available.'), cancelKeyboard(ctx, h));
    }
    if (draft.mode === 'create' && draft.step === 'text') {
      const text = String(raw).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, LIMIT);
      if (text.length < 35) return showDraftScreen(ctx, h, draft, say(ctx, h, 'أضف تفاصيل أكثر (35 حرفاً على الأقل).', 'Please add more detail (at least 35 characters).'), cancelKeyboard(ctx, h));
      draft.text = text; draft.step = draft.location ? 'preview' : 'location'; storeDraft(uid, draft); return showDraft(ctx, h, draft);
    }
    if (draft.mode === 'add_governorate' && draft.step === 'name') {
      const result = addCustomGovernorate(parseNamePair(raw), j);
      if (!result.ok) {
        const message = result.error === 'duplicate' ? say(ctx, h, 'هذه المحافظة موجودة مسبقاً.', 'That governorate already exists.') : say(ctx, h, 'أرسل اسماً عربياً صالحاً للمحافظة.', 'Send a valid governorate name.');
        return showDraftScreen(ctx, h, draft, message, cancelKeyboard(ctx, h, 'j:admin:cancel-draft'));
      }
      await clearPrompt(ctx, draft);
      delete j.adminDrafts[uid]; save();
      return h.show(ctx, say(ctx, h, `✅ أُضيفت المحافظة «${esc(result.row.ar)}». يمكنك الآن استخدامها في موقع الإعلان أو إضافة منطقة لها.`, `✅ Added governorate “${esc(result.row.en || result.row.ar)}”. It can now be selected for a listing or have an area added.`), new InlineKeyboard().text(say(ctx, h, '➕ إضافة منطقة', '➕ Add an area'), 'j:admin:location:add-area').row().text(say(ctx, h, '📍 إدارة المواقع', '📍 Manage locations'), 'j:admin:locations'));
    }
    if (draft.mode === 'add_area' && draft.step === 'name') {
      const result = addCustomArea(draft.governorateCode, parseNamePair(raw), j);
      if (!result.ok) {
        const message = result.error === 'duplicate' ? say(ctx, h, 'هذه المنطقة موجودة مسبقاً ضمن المحافظة.', 'That area already exists in this governorate.') : say(ctx, h, 'أرسل اسماً عربياً صالحاً للمنطقة.', 'Send a valid area name.');
        return showDraftScreen(ctx, h, draft, message, cancelKeyboard(ctx, h, 'j:admin:cancel-draft'));
      }
      await clearPrompt(ctx, draft);
      delete j.adminDrafts[uid]; save();
      return h.show(ctx, say(ctx, h, `✅ أُضيفت المنطقة «${esc(result.row.ar)}».`, `✅ Added area “${esc(result.row.en || result.row.ar)}”.`), new InlineKeyboard().text(say(ctx, h, '➕ إضافة منطقة أخرى', '➕ Add another area'), 'j:admin:location:add-area').row().text(say(ctx, h, '📍 إدارة المواقع', '📍 Manage locations'), 'j:admin:locations'));
    }
    if (draft.mode === 'edit_listing') {
      const patch = draft.field === 'title' ? { title: clean(raw, 120) } : { text: String(raw).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, LIMIT), links: urls(raw) };
      if (draft.field === 'title' && patch.title.length < 3) return showDraftScreen(ctx, h, draft, say(ctx, h, 'أرسل عنواناً من 3 أحرف على الأقل.', 'Send a title of at least 3 characters.'), cancelKeyboard(ctx, h, `j:admin:cancel-edit:${draft.jobId}`));
      if (draft.field === 'text' && patch.text.length < 10) return showDraftScreen(ctx, h, draft, say(ctx, h, 'التفاصيل قصيرة جداً؛ أرسل 10 أحرف على الأقل.', 'Details are too short; send at least 10 characters.'), cancelKeyboard(ctx, h, `j:admin:cancel-edit:${draft.jobId}`));
      const result = updatePublishedJob(draft.jobId, patch, j, ctx.from.id);
      if (!result.ok) return showDraftScreen(ctx, h, draft, say(ctx, h, 'تعذّر حفظ التعديل.', 'Could not save the edit.'), cancelKeyboard(ctx, h, `j:admin:cancel-edit:${draft.jobId}`));
      await clearPrompt(ctx, draft);
      delete j.adminDrafts[uid]; save({ broadcast: true });
      return h.show(ctx, say(ctx, h, `✅ حُفظ التعديل على «${esc(result.job.title)}».`, `✅ Changes saved for “${esc(result.job.title)}”.`), new InlineKeyboard().text(say(ctx, h, '↩️ رجوع للإعلان', '↩️ Back to listing'), `j:admin:view:${draft.jobId}`).row().text(say(ctx, h, '📋 الإعلانات', '📋 Listings'), 'j:admin:list:0'));
    }
    return next();
  });
}
