import { Bot, InlineKeyboard, InputFile, InputMediaBuilder, GrammyError, HttpError } from 'grammy';
import { config, isOwner } from './config.js';
import { store, publicAlert } from './store.js';
import { ALERT_TYPES, TYPE_KEYS, typeOf } from '../shared/types.js';
import { T, TITLES, fmtDur } from './bot-texts.js';
import { governorates, getGov, getDist, districtsOf, placesOf, searchPlaces, locationFrom, insideSyriaBox } from './places.js';

const PAGE = 18;
const DURATIONS = [15, 30, 60, 90, 120, 180, 360, 720];
const REPORT_COOLDOWN_MS = 2 * 60_000;

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clean = (s, max = 900) => String(s || '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const hashTag = (s) => '#' + String(s || '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');

const sessions = new Map(); // userId -> draft
const reports = new Map(); // reportId -> { draft, from, messages: [[chatId, msgId]] }
const lastReport = new Map();

const isStaff = (id) => isOwner(id) || store.isEditor(id);
const L = (ctx) => T[store.userLang(ctx.from?.id)] || T.ar;
const langOf = (ctx) => store.userLang(ctx.from?.id) === 'en' ? 'en' : 'ar';
const typeLabel = (key, lang) => `${typeOf(key).emoji} ${lang === 'en' ? typeOf(key).en : typeOf(key).ar}`;
const mapUrl = (id, lang = 'ar') => (config.publicUrl ? `${config.publicUrl}/${lang}/${id ? '#' + id : ''}` : '');

function locName(loc, lang) {
  if (!loc) return '—';
  const n = lang === 'en' ? loc.name_en : loc.name_ar;
  const parts = [n];
  const d = lang === 'en' ? loc.district_en : loc.district_ar;
  const g = lang === 'en' ? loc.governorate_en : loc.governorate_ar;
  if (loc.scope === 'place' || loc.scope === 'point') {
    if (d && d !== n) parts.push(d);
    if (g && g !== d) parts.push(g);
  } else if (loc.scope === 'district' && g && g !== n) parts.push(g);
  return parts.filter(Boolean).join('، ');
}

// ---------------------------------------------------------------- formatting

const fmtTime = (iso, lang) =>
  new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-SY', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'long' }).format(new Date(iso));

export function channelPost(alert, { ended = false } = {}) {
  const t = typeOf(alert.type);
  const p = alert.place || {};
  const lines = [];
  lines.push(`${t.emoji} <b>${esc(alert.title)}</b>`);
  if (alert.type === 'breaking' && alert.description) {
    lines.push('', esc(alert.description));
    if (p.scope && p.scope !== 'country') lines.push('', `📍 ${esc(locName(p, 'ar'))}`);
  } else {
    lines.push(`📍 ${esc(locName(p, 'ar'))}`);
    if (alert.description) lines.push('', `📝 ${esc(alert.description)}`);
  }
  lines.push('', `🕒 ${esc(fmtTime(alert.timestamp, 'ar'))}`);
  const tags = [hashTag(t.tag_ar), ...(alert.areas || []).slice(0, 3).map(hashTag)];
  lines.push(tags.join(' '));
  if (ended) lines.push('', `✅ <b>انتهى التنبيه</b> — ${esc(fmtTime(alert.ended_at || new Date().toISOString(), 'ar'))}`);
  const url = mapUrl(alert.id);
  if (url) lines.push('', `🗺 <a href="${esc(url)}">الخريطة المباشرة</a> · <a href="${esc(config.channelUrl)}">Red Alert Syria</a>`);
  return lines.join('\n');
}

function draftSummary(d, lang) {
  const l = T[lang];
  const loc = d.location;
  const lines = [`<b>${esc(typeLabel(d.type, lang))}</b>`];
  if (d.type === 'breaking') lines.push('', esc(d.text || ''));
  lines.push('', `📍 <b>${l.locLabel}:</b> ${esc(loc ? locName(loc, lang) : (lang === 'en' ? 'Syria' : 'سوريا'))}`);
  if (d.type !== 'breaking' && d.details) lines.push(`📝 <b>${l.detailsLabel}:</b> ${esc(d.details)}`);
  lines.push(`⏱ <b>${l.durLabel}:</b> ${fmtDur(d.ttlMin, lang)}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- keyboards

function mainKeyboard(ctx) {
  const l = L(ctx);
  const lang = langOf(ctx);
  const b = (k) => (lang === 'en' ? ALERT_TYPES[k].button_en : ALERT_TYPES[k].button_ar);
  const e = (k) => ALERT_TYPES[k].emoji;
  const kb = new InlineKeyboard()
    .text(`${e('breaking')} ${b('breaking')}`, 't:breaking').row()
    .text(`${e('uav')} ${b('uav')}`, 't:uav').text(`${e('warplane')} ${b('warplane')}`, 't:warplane').row()
    .text(`${e('artillery')} ${b('artillery')}`, 't:artillery').text(`${e('attack')} ${b('attack')}`, 't:attack').row()
    .text(`${e('civil')} ${b('civil')}`, 't:civil').text(`${e('missile')} ${b('missile')}`, 't:missile').row();
  if (isStaff(ctx.from.id)) kb.text(l.btnActive, 'active').text(l.btnLang, 'lang').row();
  else kb.text(l.btnLang, 'lang').row();
  if (isOwner(ctx.from.id)) kb.text(l.btnEditors, 'editors').text(l.btnStats, 'stats').row();
  if (config.publicUrl) kb.url(l.btnMap, mapUrl('', lang));
  kb.url(l.btnChannel, config.channelUrl);
  return kb;
}

function govKeyboard(ctx, d) {
  const l = L(ctx);
  const lang = langOf(ctx);
  const kb = new InlineKeyboard();
  governorates.forEach((g, i) => {
    kb.text(lang === 'en' ? g.en : g.ar, 'g:' + g.code);
    if (i % 3 === 2) kb.row();
  });
  kb.row();
  if (d.type === 'breaking') kb.text(l.btnNoLocation, 'noloc').row();
  kb.text(l.btnCancel, 'cancel');
  return kb;
}

function distKeyboard(ctx, gov) {
  const l = L(ctx);
  const lang = langOf(ctx);
  const g = getGov(gov);
  const kb = new InlineKeyboard().text(l.btnWholeGov(lang === 'en' ? g.en : g.ar), 'wg:' + gov).row();
  districtsOf(gov).forEach((d, i) => {
    kb.text(lang === 'en' ? d.en : d.ar, 'd:' + d.code);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text(l.btnBack, 'back:gov').text(l.btnCancel, 'cancel');
  return kb;
}

function placeKeyboard(ctx, dist, page) {
  const l = L(ctx);
  const lang = langOf(ctx);
  const d = getDist(dist);
  const all = placesOf(dist);
  const pages = Math.max(1, Math.ceil(all.length / PAGE));
  page = Math.min(Math.max(0, page), pages - 1);
  const kb = new InlineKeyboard().text(l.btnWholeDist(lang === 'en' ? d.en : d.ar), 'wd:' + dist).row();
  all.slice(page * PAGE, page * PAGE + PAGE).forEach((p, i) => {
    kb.text((lang === 'en' ? p.en : p.ar).slice(0, 28), 'p:' + p.id);
    if (i % 3 === 2) kb.row();
  });
  kb.row();
  if (pages > 1) {
    if (page > 0) kb.text(l.btnPrev, `pg:${dist}:${page - 1}`);
    if (page < pages - 1) kb.text(l.btnNext, `pg:${dist}:${page + 1}`);
    kb.row();
  }
  kb.text(l.btnBack, 'back:dist').text(l.btnCancel, 'cancel');
  return { kb, page: page + 1, pages };
}

function previewKeyboard(ctx, d) {
  const l = L(ctx);
  const kb = new InlineKeyboard();
  if (d.mode === 'report') kb.text(l.btnSubmit, 'submit').row();
  else kb.text(l.btnPublish, 'publish').row();
  kb.text(l.btnDuration(d.ttlMin), 'dur').row();
  kb.text(l.btnEditDetails, 'editdetails').text(l.btnChangeLoc, 'back:gov').row();
  kb.text(l.btnCancel, 'cancel');
  return kb;
}

// ---------------------------------------------------------------- helpers

async function show(ctx, text, keyboard) {
  const opts = { parse_mode: 'HTML', reply_markup: keyboard, link_preview_options: { is_disabled: true } };
  const d = sessions.get(ctx.from.id);
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, opts);
      return;
    } catch (e) {
      if (String(e?.description || e).includes('message is not modified')) return;
    }
  }
  const m = await ctx.reply(text, opts);
  if (d) d.msgId = m.message_id;
}

function newDraft(ctx, type) {
  const d = {
    type,
    mode: isStaff(ctx.from.id) ? 'publish' : 'report',
    step: type === 'breaking' ? 'text' : 'gov',
    ttlMin: typeOf(type).ttlMin,
    location: null,
    details: '',
    text: '',
    created: Date.now(),
  };
  sessions.set(ctx.from.id, d);
  return d;
}

const getDraft = (ctx) => {
  const d = sessions.get(ctx.from.id);
  if (d && Date.now() - d.created > 6 * 3600_000) { sessions.delete(ctx.from.id); return null; }
  return d;
};

async function askLocation(ctx, d) {
  d.step = 'gov';
  await show(ctx, L(ctx).askGov(`<b>${esc(typeLabel(d.type, langOf(ctx)))}</b>`), govKeyboard(ctx, d));
}

async function afterLocation(ctx, d) {
  if (d.type === 'breaking' || d.details) return showPreview(ctx, d);
  d.step = 'details';
  const kb = new InlineKeyboard().text(L(ctx).btnSkip, 'skip').row().text(L(ctx).btnBack, 'back:gov').text(L(ctx).btnCancel, 'cancel');
  await show(ctx, L(ctx).askDetails(`<b>${esc(typeLabel(d.type, langOf(ctx)))}</b>`, esc(locName(d.location, langOf(ctx)))), kb);
}

async function showPreview(ctx, d) {
  d.step = 'preview';
  const l = L(ctx);
  await show(ctx, `${d.mode === 'report' ? l.previewReport : l.preview}\n\n${draftSummary(d, langOf(ctx))}`, previewKeyboard(ctx, d));
}

function buildAlertInput(d, author) {
  const titles = TITLES[d.type];
  const loc = d.location || locationFrom({});
  const named = loc.scope !== 'country';
  const areas = [];
  if (named) {
    if (loc.name_ar) areas.push(loc.name_ar);
    if (loc.district_ar && loc.district_ar !== loc.name_ar) areas.push(loc.district_ar);
    if (loc.governorate_ar && !areas.includes(loc.governorate_ar)) areas.push(loc.governorate_ar);
  }
  return {
    type: d.type,
    title: named ? `${titles.ar} — ${loc.name_ar}` : titles.ar,
    title_en: named ? `${titles.en} — ${loc.name_en}` : titles.en,
    description: d.type === 'breaking' ? d.text : d.details,
    location: loc,
    areas,
    ttlMin: d.ttlMin,
    source: 'telegram',
    author,
  };
}

export async function publishDraft(api, d, author) {
  const alert = store.addAlert(buildAlertInput(d, author));
  try {
    const url = mapUrl(alert.id);
    const m = await api.sendMessage(config.channel, channelPost(alert), { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(url ? { reply_markup: new InlineKeyboard().url('🗺 عرض على الخريطة المباشرة', url) } : {}) });
    store.updateAlert(alert.id, { channel_message_id: m.message_id });
  } catch (e) {
    console.error('[bot] channel post failed:', e.description || e.message);
  }
  return store.getAlert(alert.id);
}

function resultKeyboard(ctx, alert) {
  const l = L(ctx);
  const kb = new InlineKeyboard();
  if (config.publicUrl) kb.url(l.btnOpenMap, mapUrl(alert.id, langOf(ctx)));
  const pa = publicAlert(alert);
  if (pa.telegram_url) kb.url(l.btnOpenPost, pa.telegram_url);
  kb.row().text(l.btnEnd, 'end:' + alert.id).text(l.btnExtend, 'ext:' + alert.id).row().text(l.btnDelete, 'del:' + alert.id).row().text(l.btnHome, 'home');
  return kb;
}

async function refreshChannelPost(api, alert, ended) {
  if (!alert?.channel_message_id) return;
  try {
    const url = mapUrl(alert.id);
    await api.editMessageText(config.channel, alert.channel_message_id, channelPost(alert, { ended }), { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(url ? { reply_markup: new InlineKeyboard().url('🗺 عرض على الخريطة المباشرة', url) } : {}) });
  } catch (e) {
    if (!String(e.description || '').includes('not modified')) console.error('[bot] edit channel failed:', e.description || e.message);
  }
}

function who(u) {
  const name = esc([u.first_name, u.last_name].filter(Boolean).join(' ') || 'user');
  return `<a href="tg://user?id=${u.id}">${name}</a>${u.username ? ' @' + esc(u.username) : ''} (<code>${u.id}</code>)`;
}

// ---------------------------------------------------------------- bot

export function createBot() {
  if (!config.botToken) return null;
  const bot = new Bot(config.botToken);

  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') return; // only private chats
    if (ctx.from) store.touchUser(ctx.from);
    await next();
  });

  const home = async (ctx) => {
    sessions.delete(ctx.from.id);
    const l = L(ctx);
    const name = esc(ctx.from.first_name || '');
    const text = isStaff(ctx.from.id) ? `${l.welcomeAdmin(name)}\n\n${l.mainMenu}` : `${l.welcomePublic(name)}\n\n${l.publicMenu}`;
    await show(ctx, text, mainKeyboard(ctx));
  };

  bot.command(['start', 'menu'], async (ctx) => {
    if (ctx.callbackQuery) return home(ctx);
    sessions.delete(ctx.from.id);
    const l = L(ctx);
    const name = esc(ctx.from.first_name || '');
    const text = isStaff(ctx.from.id) ? `${l.welcomeAdmin(name)}\n\n${l.mainMenu}` : `${l.welcomePublic(name)}\n\n${l.publicMenu}`;
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainKeyboard(ctx), link_preview_options: { is_disabled: true } });
  });
  bot.command('help', (ctx) => ctx.reply(L(ctx).help, { parse_mode: 'HTML' }));
  bot.command('id', (ctx) => ctx.reply(L(ctx).yourId(ctx.from.id), { parse_mode: 'HTML' }));
  bot.command('lang', async (ctx) => {
    store.setUserLang(ctx.from.id, langOf(ctx) === 'ar' ? 'en' : 'ar');
    await ctx.reply(L(ctx).langSet);
    await ctx.reply(L(ctx).mainMenu, { reply_markup: mainKeyboard(ctx) });
  });
  bot.command('active', (ctx) => (isStaff(ctx.from.id) ? showActive(ctx) : null));

  // Owner commands
  const ownerOnly = (fn) => async (ctx) => (isOwner(ctx.from.id) ? fn(ctx) : ctx.reply(L(ctx).onlyOwner));
  const editorsText = (ctx) => {
    const list = store.state.editors.map((id) => {
      const u = store.state.users[id];
      return `• <code>${id}</code> ${u?.name ? esc(u.name) : ''} ${u?.username ? '@' + esc(u.username) : ''}`;
    }).join('\n');
    return L(ctx).editorsTitle(list);
  };
  bot.command('editors', ownerOnly((ctx) => ctx.reply(editorsText(ctx), { parse_mode: 'HTML' })));
  bot.command('addeditor', ownerOnly(async (ctx) => {
    const id = Number(String(ctx.match || '').trim());
    if (!Number.isFinite(id) || id <= 0) return ctx.reply('/addeditor 123456789');
    store.addEditor(id);
    await ctx.reply(L(ctx).editorAdded(id), { parse_mode: 'HTML' });
  }));
  bot.command('removeeditor', ownerOnly(async (ctx) => {
    const id = Number(String(ctx.match || '').trim());
    store.removeEditor(id);
    await ctx.reply(L(ctx).editorRemoved(id), { parse_mode: 'HTML' });
  }));
  const statsText = (ctx) => {
    const day = Date.now() - 86400_000;
    return L(ctx).stats({
      active: store.activeAlerts().length,
      day: store.state.alerts.filter((a) => Date.parse(a.timestamp) >= day).length,
      total: store.state.stats.published || 0,
      editors: store.state.editors.length,
      backup: store.lastBackupAt ? fmtTime(store.lastBackupAt, langOf(ctx)) : null,
    });
  };
  bot.command('stats', ownerOnly((ctx) => ctx.reply(statsText(ctx), { parse_mode: 'HTML' })));
  bot.command('backup', ownerOnly(async (ctx) => {
    await store.backup?.save(JSON.stringify(store.state));
    store.lastBackupAt = new Date().toISOString();
    await ctx.reply(L(ctx).backupDone);
  }));

  // -------- callbacks
  bot.callbackQuery('home', async (ctx) => { await ctx.answerCallbackQuery(); await home(ctx); });
  bot.callbackQuery('cancel', async (ctx) => { await ctx.answerCallbackQuery(L(ctx).cancelled); await home(ctx); });
  bot.callbackQuery('lang', async (ctx) => {
    store.setUserLang(ctx.from.id, langOf(ctx) === 'ar' ? 'en' : 'ar');
    await ctx.answerCallbackQuery(L(ctx).langSet);
    await home(ctx);
  });
  bot.callbackQuery('editors', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isOwner(ctx.from.id)) return;
    await show(ctx, editorsText(ctx), new InlineKeyboard().text(L(ctx).btnHome, 'home'));
  });
  bot.callbackQuery('stats', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isOwner(ctx.from.id)) return;
    await show(ctx, statsText(ctx), new InlineKeyboard().text(L(ctx).btnHome, 'home'));
  });

  bot.callbackQuery(/^t:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const type = ctx.match[1];
    if (!ALERT_TYPES[type]) return;
    if (!isStaff(ctx.from.id)) {
      if (store.isBanned(ctx.from.id)) return show(ctx, L(ctx).banned, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
      if (Date.now() - (lastReport.get(ctx.from.id) || 0) < REPORT_COOLDOWN_MS) return show(ctx, L(ctx).reportRate, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
    }
    const d = newDraft(ctx, type);
    if (type === 'breaking') {
      await show(ctx, L(ctx).askBreaking, new InlineKeyboard().text(L(ctx).btnCancel, 'cancel'));
    } else {
      await askLocation(ctx, d);
    }
  });

  const needDraft = (fn) => async (ctx) => {
    const d = getDraft(ctx);
    if (!d) {
      await ctx.answerCallbackQuery(L(ctx).expiredSession);
      return home(ctx);
    }
    await ctx.answerCallbackQuery();
    return fn(ctx, d);
  };

  bot.callbackQuery(/^g:(\d+)$/, needDraft(async (ctx, d) => {
    const gov = ctx.match[1];
    if (!getGov(gov)) return;
    d.gov = gov; d.step = 'dist';
    const lang = langOf(ctx);
    await show(ctx, L(ctx).askDist(`<b>${esc(typeLabel(d.type, lang))}</b>`, esc(lang === 'en' ? getGov(gov).en : getGov(gov).ar)), distKeyboard(ctx, gov));
  }));
  bot.callbackQuery(/^wg:(\d+)$/, needDraft(async (ctx, d) => {
    d.location = locationFrom({ govCode: ctx.match[1] });
    await afterLocation(ctx, d);
  }));
  const showPlaces = async (ctx, d, dist, page) => {
    d.dist = dist; d.step = 'place';
    const lang = langOf(ctx);
    const { kb, page: p, pages } = placeKeyboard(ctx, dist, page);
    const dd = getDist(dist);
    await show(ctx, L(ctx).askPlace(`<b>${esc(typeLabel(d.type, lang))}</b>`, esc(lang === 'en' ? dd.en : dd.ar), p, pages), kb);
  };
  bot.callbackQuery(/^d:(\d+)$/, needDraft((ctx, d) => (getDist(ctx.match[1]) ? showPlaces(ctx, d, ctx.match[1], 0) : null)));
  bot.callbackQuery(/^pg:(\d+):(\d+)$/, needDraft((ctx, d) => showPlaces(ctx, d, ctx.match[1], Number(ctx.match[2]))));
  bot.callbackQuery(/^wd:(\d+)$/, needDraft(async (ctx, d) => {
    d.location = locationFrom({ distCode: ctx.match[1] });
    await afterLocation(ctx, d);
  }));
  bot.callbackQuery(/^p:(\d+)$/, needDraft(async (ctx, d) => {
    const loc = locationFrom({ placeId: Number(ctx.match[1]) });
    if (!loc) return;
    d.location = loc;
    await afterLocation(ctx, d);
  }));
  bot.callbackQuery('noloc', needDraft(async (ctx, d) => {
    d.location = locationFrom({});
    await showPreview(ctx, d);
  }));
  bot.callbackQuery('skip', needDraft((ctx, d) => showPreview(ctx, d)));
  bot.callbackQuery(/^back:(gov|dist)$/, needDraft(async (ctx, d) => {
    if (ctx.match[1] === 'dist' && d.gov) {
      d.step = 'dist';
      const lang = langOf(ctx);
      return show(ctx, L(ctx).askDist(`<b>${esc(typeLabel(d.type, lang))}</b>`, esc(lang === 'en' ? getGov(d.gov).en : getGov(d.gov).ar)), distKeyboard(ctx, d.gov));
    }
    return askLocation(ctx, d);
  }));
  bot.callbackQuery('editdetails', needDraft(async (ctx, d) => {
    if (d.type === 'breaking') {
      d.step = 'text';
      return show(ctx, L(ctx).askBreaking, new InlineKeyboard().text(L(ctx).btnCancel, 'cancel'));
    }
    d.details = '';
    d.step = 'details';
    const kb = new InlineKeyboard().text(L(ctx).btnSkip, 'skip').row().text(L(ctx).btnCancel, 'cancel');
    await show(ctx, L(ctx).askDetails(`<b>${esc(typeLabel(d.type, langOf(ctx)))}</b>`, esc(locName(d.location, langOf(ctx)))), kb);
  }));
  bot.callbackQuery('dur', needDraft(async (ctx, d) => {
    const kb = new InlineKeyboard();
    DURATIONS.forEach((m, i) => {
      kb.text((m === d.ttlMin ? '• ' : '') + fmtDur(m, langOf(ctx)), 'setdur:' + m);
      if (i % 4 === 3) kb.row();
    });
    kb.row().text(L(ctx).btnBack, 'preview');
    await show(ctx, L(ctx).durTitle, kb);
  }));
  bot.callbackQuery(/^setdur:(\d+)$/, needDraft(async (ctx, d) => {
    const m = Number(ctx.match[1]);
    if (DURATIONS.includes(m)) d.ttlMin = m;
    await showPreview(ctx, d);
  }));
  bot.callbackQuery('preview', needDraft((ctx, d) => showPreview(ctx, d)));

  bot.callbackQuery('publish', needDraft(async (ctx, d) => {
    if (!isStaff(ctx.from.id)) return;
    if (d.type === 'breaking' && !d.text) return askLocation(ctx, d);
    sessions.delete(ctx.from.id);
    const alert = await publishDraft(ctx.api, d, { id: ctx.from.id, name: ctx.from.first_name });
    await show(ctx, `${L(ctx).published}\n\n${draftSummary(d, langOf(ctx))}`, resultKeyboard(ctx, alert));
  }));

  bot.callbackQuery('submit', needDraft(async (ctx, d) => {
    if (store.isBanned(ctx.from.id)) return;
    sessions.delete(ctx.from.id);
    lastReport.set(ctx.from.id, Date.now());
    const rid = Math.random().toString(36).slice(2, 10);
    const rep = { draft: d, from: { id: ctx.from.id, first_name: ctx.from.first_name, last_name: ctx.from.last_name, username: ctx.from.username }, messages: [], created: Date.now() };
    reports.set(rid, rep);
    const reviewers = [...new Set([...config.ownerIds, ...store.state.editors])];
    for (const uid of reviewers) {
      const lang = store.userLang(uid) === 'en' ? 'en' : 'ar';
      const l = T[lang];
      const kb = new InlineKeyboard().text(l.btnApprove, 'rap:' + rid).row().text(l.btnReject, 'rrj:' + rid).text(l.btnBan, 'rbn:' + rid);
      try {
        const m = await ctx.api.sendMessage(uid, `${l.reportNew(who(ctx.from))}\n\n${draftSummary(d, lang)}`, { parse_mode: 'HTML', reply_markup: kb });
        rep.messages.push([uid, m.message_id]);
      } catch (e) { /* reviewer has not started the bot */ }
    }
    await show(ctx, L(ctx).reportSent, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
  }));

  const closeReport = async (ctx, rid, line) => {
    const rep = reports.get(rid);
    if (!rep) return;
    reports.delete(rid);
    for (const [chat, mid] of rep.messages) {
      const lang = store.userLang(chat) === 'en' ? 'en' : 'ar';
      try {
        await ctx.api.editMessageText(chat, mid, `${T[lang].reportNew(who(rep.from))}\n\n${draftSummary(rep.draft, lang)}\n\n${line}`, { parse_mode: 'HTML' });
      } catch { /* ignore */ }
    }
  };
  bot.callbackQuery(/^r(ap|rj|bn):(\w+)$/, async (ctx) => {
    if (!isStaff(ctx.from.id)) return ctx.answerCallbackQuery();
    const [, action, rid] = ctx.match;
    const rep = reports.get(rid);
    if (!rep) return ctx.answerCallbackQuery(L(ctx).notFound);
    await ctx.answerCallbackQuery();
    const by = esc(ctx.from.first_name || String(ctx.from.id));
    if (action === 'ap') {
      const alert = await publishDraft(ctx.api, rep.draft, { id: rep.from.id, name: rep.from.first_name, approvedBy: ctx.from.id });
      await closeReport(ctx, rid, L(ctx).reportApproved(by));
      try { await ctx.api.sendMessage(rep.from.id, T[store.userLang(rep.from.id)].reportApprovedUser); } catch { /* ignore */ }
      if (alert) await ctx.reply(L(ctx).published, { parse_mode: 'HTML', reply_markup: resultKeyboard(ctx, alert) });
    } else {
      if (action === 'bn') store.ban(rep.from.id);
      await closeReport(ctx, rid, L(ctx).reportRejected(by) + (action === 'bn' ? ' · 🚫' : ''));
    }
  });

  // -------- active alerts management
  async function showActive(ctx) {
    const l = L(ctx);
    const lang = langOf(ctx);
    const act = store.activeAlerts().slice(0, 30);
    if (!act.length) return show(ctx, l.noActive, new InlineKeyboard().text(l.btnHome, 'home'));
    const kb = new InlineKeyboard();
    for (const a of act) {
      const t = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(a.timestamp));
      kb.text(`${typeOf(a.type).emoji} ${t} · ${(lang === 'en' ? a.title_en : a.title) || ''}`.slice(0, 60), 'm:' + a.id).row();
    }
    kb.text(l.btnHome, 'home');
    await show(ctx, l.activeTitle(store.activeAlerts().length), kb);
  }
  bot.callbackQuery('active', async (ctx) => { await ctx.answerCallbackQuery(); if (isStaff(ctx.from.id)) await showActive(ctx); });

  const manageText = (ctx, a) => {
    const lang = langOf(ctx);
    const exp = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ar-SY', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(a.expires_at));
    return `${L(ctx).manageTitle}\n\n${typeOf(a.type).emoji} <b>${esc(lang === 'en' ? a.title_en : a.title)}</b>\n${a.description ? esc(a.description) + '\n' : ''}🕒 ${esc(fmtTime(a.timestamp, lang))}\n⌛ ${lang === 'en' ? 'Expires' : 'ينتهي'}: ${exp}${a.is_active ? '' : '\n\n' + L(ctx).ended}`;
  };
  bot.callbackQuery(/^m:([\w-]{36})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!isStaff(ctx.from.id)) return;
    const a = store.getAlert(ctx.match[1]);
    if (!a) return show(ctx, L(ctx).notFound, new InlineKeyboard().text(L(ctx).btnHome, 'home'));
    const kb = resultKeyboard(ctx, a).row().text(L(ctx).btnBack, 'active');
    await show(ctx, manageText(ctx, a), kb);
  });
  bot.callbackQuery(/^(end|del|ext):([\w-]{36})$/, async (ctx) => {
    if (!isStaff(ctx.from.id)) return ctx.answerCallbackQuery();
    const [, action, id] = ctx.match;
    const a = store.getAlert(id);
    if (!a) {
      await ctx.answerCallbackQuery(L(ctx).notFound);
      return;
    }
    if (action === 'end') {
      store.endAlert(id);
      await refreshChannelPost(ctx.api, store.getAlert(id), true);
      await ctx.answerCallbackQuery(L(ctx).ended);
      await show(ctx, manageText(ctx, store.getAlert(id)), new InlineKeyboard().text(L(ctx).btnDelete, 'del:' + id).row().text(L(ctx).btnActive, 'active').text(L(ctx).btnHome, 'home'));
    } else if (action === 'ext') {
      const base = Math.max(Date.now(), Date.parse(a.expires_at));
      store.updateAlert(id, { expires_at: new Date(base + 30 * 60_000).toISOString(), is_active: true, ended_at: undefined });
      await refreshChannelPost(ctx.api, store.getAlert(id), false);
      await ctx.answerCallbackQuery(L(ctx).extended);
      await show(ctx, manageText(ctx, store.getAlert(id)), resultKeyboard(ctx, store.getAlert(id)));
    } else {
      const removed = store.deleteAlert(id);
      if (removed?.channel_message_id) {
        try { await ctx.api.deleteMessage(config.channel, removed.channel_message_id); } catch (e) { console.error('[bot] delete failed', e.description); }
      }
      await ctx.answerCallbackQuery(L(ctx).deleted);
      await show(ctx, L(ctx).deleted, new InlineKeyboard().text(L(ctx).btnActive, 'active').text(L(ctx).btnHome, 'home'));
    }
  });

  // -------- text & location input
  bot.on('message:location', async (ctx) => {
    const d = getDraft(ctx);
    if (!d || !['gov', 'dist', 'place', 'details'].includes(d.step)) return;
    const { latitude: lat, longitude: lon } = ctx.message.location;
    if (!insideSyriaBox(lat, lon)) return ctx.reply(L(ctx).outside);
    d.location = locationFrom({ lat, lon });
    d.msgId = null;
    await afterLocation(ctx, d);
  });

  bot.on('message:text', async (ctx) => {
    const text = clean(ctx.message.text, 2000);
    if (text.startsWith('/')) return;
    const d = getDraft(ctx);
    if (!d) return home(ctx);
    const l = L(ctx);
    if (d.step === 'text') {
      if (text.length > 900) return ctx.reply(l.tooLong);
      d.text = text;
      if (d.location) return showPreview(ctx, d);
      return askLocation(ctx, d);
    }
    if (d.step === 'details') {
      if (text.length > 900) return ctx.reply(l.tooLong);
      d.details = text;
      return showPreview(ctx, d);
    }
    if (['gov', 'dist', 'place'].includes(d.step)) {
      const res = searchPlaces(text, 12);
      const lang = langOf(ctx);
      if (!res.length) return ctx.reply(l.searchNone(esc(text.slice(0, 40))), { parse_mode: 'HTML' });
      const kb = new InlineKeyboard();
      for (const p of res) {
        if (p.scope === 'governorate') kb.text(`📍 ${lang === 'en' ? p.en : p.ar}`, 'wg:' + p.gov).row();
        else {
          const dd = getDist(p.dist);
          const g = getGov(p.gov);
          kb.text(`${lang === 'en' ? p.en : p.ar} — ${lang === 'en' ? dd?.en || g?.en : dd?.ar || g?.ar}`.slice(0, 60), 'p:' + p.id).row();
        }
      }
      kb.text(l.btnBack, 'back:gov').text(l.btnCancel, 'cancel');
      return ctx.reply(l.searchResults(esc(text.slice(0, 40))), { parse_mode: 'HTML', reply_markup: kb });
    }
    if (d.step === 'preview') return showPreview(ctx, d);
  });

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) console.error('[bot] API error:', e.description);
    else if (e instanceof HttpError) console.error('[bot] network error:', e.message);
    else console.error('[bot] error:', e?.message || e);
  });

  // When alerts expire automatically, mark the channel post as ended.
  store.on('expired', (a) => refreshChannelPost(bot.api, a, true));

  // Clean old pending reports
  setInterval(() => {
    for (const [k, r] of reports) if (Date.now() - r.created > 12 * 3600_000) reports.delete(k);
  }, 3600_000).unref();

  return bot;
}

// ---------------------------------------------------------------- backup adapter (pinned JSON in owner chat)

export function telegramBackupAdapter(api) {
  const owner = config.ownerIds[0];
  if (!owner) return null;
  let lastMsgId = null;
  const NAME = 'red-alert-syria-backup.json';
  return {
    async save(json) {
      const file = () => new InputFile(Buffer.from(json), NAME);
      const caption = '🗄 نسخة احتياطية تلقائية لبيانات Red Alert Syria — لا تحذفها ولا تلغِ تثبيتها.\nAutomatic backup — keep pinned.';
      if (lastMsgId) {
        try {
          await api.editMessageMedia(owner, lastMsgId, InputMediaBuilder.document(file(), { caption }));
          return;
        } catch (e) {
          if (/not modified/i.test(e.description || '')) return;
        }
      }
      const m = await api.sendDocument(owner, file(), { caption, disable_notification: true });
      try { await api.pinChatMessage(owner, m.message_id, { disable_notification: true }); } catch { /* ignore */ }
      if (lastMsgId) { try { await api.deleteMessage(owner, lastMsgId); } catch { /* ignore */ } }
      lastMsgId = m.message_id;
    },
    async load() {
      const chat = await api.getChat(owner);
      const pm = chat.pinned_message;
      if (!pm?.document || pm.document.file_name !== NAME) return null;
      lastMsgId = pm.message_id;
      const f = await api.getFile(pm.document.file_id);
      const res = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${f.file_path}`);
      if (!res.ok) return null;
      return await res.text();
    },
  };
}

export const BOT_COMMANDS = {
  ar: [
    { command: 'start', description: 'القائمة الرئيسية' },
    { command: 'active', description: 'التنبيهات النشطة' },
    { command: 'lang', description: 'English / العربية' },
    { command: 'id', description: 'معرّفي' },
    { command: 'help', description: 'المساعدة' },
  ],
  en: [
    { command: 'start', description: 'Main menu' },
    { command: 'active', description: 'Active alerts' },
    { command: 'lang', description: 'العربية / English' },
    { command: 'id', description: 'My ID' },
    { command: 'help', description: 'Help' },
  ],
};

export { TYPE_KEYS };
