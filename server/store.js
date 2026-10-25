import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { ALERT_TYPES, typeOf } from '../shared/types.js';
import { alertZones } from './places.js';
import { cleanAlertText } from './clean-text.js';

/**
 * In-memory state with atomic JSON persistence on disk and an optional remote backup
 * (the bot keeps a pinned JSON snapshot in the owner's private chat so data survives
 * redeploys on hosts with ephemeral disks such as Render's free tier).
 */
class Store extends EventEmitter {
  constructor() {
    super();
    this.state = { version: 1, alerts: [], editors: [], banned: [], users: {}, stats: { published: 0 }, settings: { autoDeleteHours: 1, autoDel1h: true, daily: { on: true, time: '23:00', last: null }, weekly: { on: true, day: 5, time: '23:00', last: null } }, log: [], relay: {}, threads: {} };
    this.file = path.join(config.dataDir, 'state.json');
    this.backup = null; // { save(jsonString), load() -> jsonString|null }
    this._saveTimer = null;
    this._backupTimer = null;
    this.lastBackupAt = null;
  }

  async init(backupAdapter) {
    this.backup = backupAdapter || null;
    fs.mkdirSync(config.dataDir, { recursive: true });
    let loaded = false;
    try {
      if (fs.existsSync(this.file)) {
        this._apply(JSON.parse(fs.readFileSync(this.file, 'utf8')));
        loaded = true;
        console.log(`[store] loaded ${this.state.alerts.length} alerts from disk`);
      }
    } catch (e) {
      console.error('[store] failed to read local state', e.message);
    }
    if (!loaded && this.backup) {
      try {
        const json = await this.backup.load();
        if (json) {
          this._apply(JSON.parse(json));
          console.log(`[store] restored ${this.state.alerts.length} alerts from Telegram backup`);
          this._writeLocal();
        }
      } catch (e) {
        console.error('[store] backup restore failed', e.message);
      }
    }
    this._restoredAt = Date.now();
    if (!Array.isArray(this.state.log)) this.state.log = this.state.alerts.map((a) => this._logEntry(a)).reverse();
    this.expireSweep();
    setInterval(() => this.expireSweep(), 30_000).unref();
  }

  _apply(s) {
    if (!s || typeof s !== 'object') return;
    this.state = {
      version: 1,
      alerts: Array.isArray(s.alerts) ? s.alerts.filter((a) => a && a.id && ALERT_TYPES[a.type]) : [],
      editors: Array.isArray(s.editors) ? s.editors.map(Number).filter(Number.isFinite) : [],
      banned: Array.isArray(s.banned) ? s.banned.map(Number).filter(Number.isFinite) : [],
      users: s.users && typeof s.users === 'object' ? s.users : {},
      stats: s.stats || { published: 0 },
      settings: {
        // owner's request (24 Oct): every alert leaves the map 1 hour after publishing -> one-time switch to 1 h
        autoDeleteHours: !s.settings?.autoDel1h ? 1 : [0, 1, 24, 48].includes(s.settings?.autoDeleteHours) ? s.settings.autoDeleteHours : 1,
        autoDel1h: true,
        daily: {
          on: s.settings?.daily?.on !== false,
          time: /^\d\d:\d\d$/.test(s.settings?.daily?.time || '') ? s.settings.daily.time : '23:00',
          last: s.settings?.daily?.last || null,
        },
        weekly: {
          on: s.settings?.weekly?.on !== false,
          day: Number.isInteger(s.settings?.weekly?.day) && s.settings.weekly.day >= 0 && s.settings.weekly.day <= 6 ? s.settings.weekly.day : 5,
          time: /^\d\d:\d\d$/.test(s.settings?.weekly?.time || '') ? s.settings.weekly.time : '23:00',
          last: s.settings?.weekly?.last || null,
        },
        // public contact links shown on the website (set by the owner from the publishing bot)
        contacts: (() => {
          const c = s.settings?.contacts;
          if (!c || typeof c !== 'object') return {};
          const o = {};
          if (typeof c.wa === 'string' && /^https:\/\/whatsapp\.com\/channel\/[A-Za-z0-9]{10,40}$/.test(c.wa)) o.wa = c.wa;
          if (typeof c.phone === 'string' && /^\+[1-9]\d{7,14}$/.test(c.phone)) o.phone = c.phone;
          if (['both', 'wa', 'tel'].includes(c.phoneMode)) o.phoneMode = c.phoneMode;
          if (typeof c.tg === 'string' && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(c.tg)) o.tg = c.tg;
          return o;
        })(),
        project: (() => {
          const pr = s.settings?.project;
          if (!pr || typeof pr !== 'object') return {};
          const o = {};
          for (const k of ['ownerId', 'botToken', 'reportBotToken', 'channel', 'channelUrl', 'reportBotUsername', 'prevOwnerId', 'changedAt'])
            if (pr[k] !== undefined && pr[k] !== null && pr[k] !== '') o[k] = pr[k];
          return o;
        })(),
      },
      // owner <-> reporter conversation links (message -> reporter id) and open threads
      relay: s.relay && typeof s.relay === 'object' ? s.relay : {},
      threads: s.threads && typeof s.threads === 'object' ? s.threads : {},
      convo: s.convo && typeof s.convo === 'object' ? s.convo : {},
      // compact event log for statistics (kept 35 days, independent of the map's auto-delete)
      log: Array.isArray(s.log) ? s.log.filter((e) => e && e.ty && e.ts) : null,
      maint: s.maint && typeof s.maint === 'object' ? s.maint : {},
      // bot messages per private chat (clean-chat tracker): { 'role:chat': [{ id, t, s, m, u, k }] }
      ui: s.ui && typeof s.ui === 'object' ? s.ui : {},
      // public reports waiting for a decision (survive restarts/deploys) and decided report ids
      reports: s.reports && typeof s.reports === 'object' ? s.reports : {},
      reportsDone: s.reportsDone && typeof s.reportsDone === 'object' ? s.reportsDone : {},
      // ids of alerts removed by hand / auto-delete (so a late copy from an old instance can't bring them back)
      gone: s.gone && typeof s.gone === 'object' ? s.gone : {},
      // 📡 news monitor: settings, sources, drafts, remembered incidents (server/news-monitor.js)
      news: s.news && typeof s.news === 'object' ? s.news : {},
      // 💱 prices bulletin, 🛣 road status, ⚡ electricity updates (server/prices.js, server/services.js)
      svc: s.svc && typeof s.svc === 'object' ? s.svc : {},
    };
  }

  _writeLocal() {
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.state));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] write failed', e.message);
    }
  }

  persist({ backupSoon = true } = {}) {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._writeLocal(), 300);
    if (!backupSoon) this._backupLazy = true; // saved with the next backup / on shutdown
    if (backupSoon && this.backup && config.telegramBackup) {
      clearTimeout(this._backupTimer);
      this._backupPending = true;
      this._backupTimer = setTimeout(() => this.flushBackup(), 15_000);
    }
  }
  async flushBackup(force = false) {
    clearTimeout(this._backupTimer);
    if (!this.backup || !(this._backupPending || (force && this._backupLazy && config.telegramBackup))) return;
    this._backupPending = false; this._backupLazy = false;
    try {
      await this.backup.save(JSON.stringify(this.state));
      this.lastBackupAt = new Date().toISOString();
    } catch (e) {
      this._backupPending = true;
      console.error('[store] remote backup failed', e.message);
    }
  }

  // ---------- alerts ----------
  newId() {
    return crypto.randomUUID();
  }

  addAlert(input) {
    const t = typeOf(input.type);
    const now = new Date();
    const ttl = Math.max(5, Math.min(Number(input.ttlMin) || t.ttlMin, 24 * 60));
    const alert = {
      id: input.id || this.newId(),
      type: input.type,
      title: input.title,
      title_en: input.title_en,
      description: input.description || '',
      location: input.location?.latitude != null ? { latitude: input.location.latitude, longitude: input.location.longitude } : null,
      place: input.location || null,
      areas: input.areas || [],
      // further affected areas of the same alert (publishing bot "➕ add area"); each gets its own circle(s)
      extra: Array.isArray(input.extra) ? input.extra.filter((x) => x && Number.isFinite(x.latitude)).slice(0, 20) : [],
      scope: input.location?.scope || 'country',
      timestamp: now.toISOString(),
      // an alert never outlives the auto-delete window (default 1 h), so "ends at" matches when it leaves the map
      expires_at: new Date(now.getTime() + Math.min(ttl, this.autoDeleteHours ? this.autoDeleteHours * 60 : Infinity) * 60_000).toISOString(),
      source: input.source || 'telegram',
      is_active: true,
      author: input.author || null,
      channel_message_id: null,
    };
    this.state.alerts.unshift(alert);
    this.state.stats.published = (this.state.stats.published || 0) + 1;
    this._log(alert);
    this._trim();
    this.persist();
    this.emit('alert', publicAlert(alert));
    return alert;
  }

  getAlert(id) {
    return this.state.alerts.find((a) => a.id === id);
  }

  updateAlert(id, patch) {
    const a = this.getAlert(id);
    if (!a) return null;
    Object.assign(a, patch);
    if ('channel_message_id' in patch) this._logPatch(id, { m: patch.channel_message_id || undefined });
    this.persist();
    this.emit('update', publicAlert(a));
    return a;
  }

  endAlert(id) {
    const a = this.getAlert(id);
    if (!a || !a.is_active) return a;
    a.is_active = false;
    a.ended_at = new Date().toISOString();
    this.persist();
    this.emit('update', publicAlert(a));
    return a;
  }

  deleteAlert(id) {
    const i = this.state.alerts.findIndex((a) => a.id === id);
    if (i < 0) return null;
    const [a] = this.state.alerts.splice(i, 1);
    this._tomb([id]);
    // an alert removed by hand was a mistake -> it should not count in the statistics
    this.state.log = (this.state.log || []).filter((e) => e.id !== id);
    this.persist();
    this.emit('remove', { id });
    return a;
  }

  _tomb(ids) {
    const g = (this.state.gone ||= {});
    const now = Date.now();
    for (const id of ids) g[id] = now;
    for (const [k, t] of Object.entries(g)) if (now - t > 3 * 86400_000) delete g[k];
  }

  // ---------- pending public reports (persisted: a restart/deploy must never lose one) ----------
  reportPut(rid, rep) {
    (this.state.reports ||= {})[rid] = rep;
    this.persist();
  }
  reportGet(rid) { return this.state.reports?.[rid] || null; }
  reportDone(rid) { return !!this.state.reportsDone?.[rid]; }
  /** Claim a report for a decision: returns it once, then it is gone (no double publishing). */
  reportTake(rid) {
    const rep = this.state.reports?.[rid];
    if (!rep) return null;
    delete this.state.reports[rid];
    (this.state.reportsDone ||= {})[rid] = Date.now();
    this.persist();
    return rep;
  }
  /** Undo a claim when publishing failed, so the reviewer can try again. */
  reportRestore(rid, rep) {
    delete this.state.reportsDone?.[rid];
    this.reportPut(rid, rep);
  }
  reportsPrune(maxAgeMs = 48 * 3600_000) {
    const now = Date.now();
    let n = 0;
    for (const [k, r] of Object.entries(this.state.reports || {})) if (!r || now - (r.created || 0) > maxAgeMs) { delete this.state.reports[k]; n++; }
    for (const [k, t] of Object.entries(this.state.reportsDone || {})) if (now - t > 4 * 86400_000) { delete this.state.reportsDone[k]; n++; }
    if (n) this.persist({ backupSoon: false });
  }

  /**
   * During a deploy Render keeps the old instance serving for a few seconds after the new one has
   * loaded its data; the old one saves its final state to the Telegram backup when it stops.
   * Pull in what it received in that window (reports, alerts, reply links) - additions only.
   */
  async mergeFromBackup() {
    if (!this.backup) return { reports: 0, alerts: 0 };
    let o;
    try { const json = await this.backup.load(); if (!json) return { reports: 0, alerts: 0 }; o = JSON.parse(json); } catch (e) {
      console.error('[store] merge: backup read failed', e.message); return { reports: 0, alerts: 0 };
    }
    let reports = 0, alerts = 0;
    const st = this.state;
    st.reports ||= {}; st.reportsDone ||= {}; st.gone ||= {};
    for (const [rid, t] of Object.entries(o.reportsDone || {})) {
      if (!st.reportsDone[rid]) st.reportsDone[rid] = t;
      if (st.reports[rid]) { delete st.reports[rid]; reports++; }
    }
    for (const [rid, r] of Object.entries(o.reports || {})) {
      if (!r || st.reports[rid] || st.reportsDone[rid]) continue;
      st.reports[rid] = r; reports++;
    }
    const since = (this._restoredAt || Date.now()) - 10 * 60_000;
    const known = new Set(st.alerts.map((a) => a.id));
    for (const a of Array.isArray(o.alerts) ? o.alerts : []) {
      if (!a || !a.id || !ALERT_TYPES[a.type] || known.has(a.id) || st.gone[a.id] || o.gone?.[a.id]) continue;
      if (Date.parse(a.timestamp) < since) continue; // only what arrived around the switch
      st.alerts.push(a); known.add(a.id); alerts++;
      if (!(st.log || []).some((e) => e.id === a.id)) (st.log ||= []).push(this._logEntry(a));
      this.emit('alert', publicAlert(a));
    }
    if (alerts) {
      st.alerts.sort((x, y) => Date.parse(y.timestamp) - Date.parse(x.timestamp));
      st.log.sort((x, y) => Date.parse(x.ts) - Date.parse(y.ts));
    }
    for (const [k, v] of Object.entries(o.relay || {})) if (!st.relay[k]) st.relay[k] = v;
    for (const [k, v] of Object.entries(o.threads || {})) if (!st.threads[k]) st.threads[k] = v;
    for (const f of this.mergeHooks || []) { try { f(o); } catch (e) { console.error('[store] merge hook failed', e.message); } }
    if (reports || alerts) console.log(`[store] merged from the previous instance: ${reports} report change(s), ${alerts} alert(s)`);
    this.persist(); // the pinned backup becomes the merged state again
    return { reports, alerts };
  }

  // ---------- statistics log ----------
  _logEntry(a) {
    const p = a.place || {};
    // place/district (p, d, pa, pe) + extra areas' districts (xd): used by the per-area SEO pages
    const xd = [...new Set((a.extra || []).map((x) => x.district).filter(Boolean))];
    const xg = [...new Set((a.extra || []).map((x) => x.governorate).filter((g) => g && g !== p.governorate))];
    return {
      id: a.id, ty: a.type, ts: a.timestamp, g: p.governorate || null, ga: p.governorate_ar || null, ge: p.governorate_en || null, src: a.source || 'telegram',
      ...(p.place_id ? { p: p.place_id } : {}), ...(p.district ? { d: p.district } : {}),
      ...(p.name_ar && p.scope !== 'governorate' ? { pa: p.name_ar, pe: p.name_en || undefined } : {}),
      ...(xd.length ? { xd } : {}), ...(xg.length ? { xg } : {}),
    };
  }
  _log(a) {
    if (!Array.isArray(this.state.log)) this.state.log = [];
    this.state.log.push(this._logEntry(a));
    const cutoff = Date.now() - 35 * 86400_000;
    if (this.state.log.length > 100 && Date.parse(this.state.log[0].ts) < cutoff) this.state.log = this.state.log.filter((e) => Date.parse(e.ts) >= cutoff);
    if (this.state.log.length > 20000) this.state.log = this.state.log.slice(-20000);
  }
  _logPatch(id, patch) {
    const log = this.state.log || [];
    for (let i = log.length - 1; i >= 0 && i >= log.length - 500; i--) if (log[i].id === id) { Object.assign(log[i], patch); return; }
  }
  /** log entries with ts in [fromMs, toMs) */
  logBetween(fromMs, toMs = Date.now()) {
    return (this.state.log || []).filter((e) => { const t = Date.parse(e.ts); return t >= fromMs && t < toMs; });
  }
  get daily() { return this.state.settings?.daily || { on: true, time: '23:00', last: null }; }
  setDaily(patch) {
    this.state.settings = { ...(this.state.settings || {}), daily: { ...this.daily, ...patch } };
    this.persist();
  }
  get weekly() { return this.state.settings?.weekly || { on: true, day: 5, time: '23:00', last: null }; }
  setWeekly(patch) {
    this.state.settings = { ...(this.state.settings || {}), weekly: { ...this.weekly, ...patch } };
    this.persist();
  }
  // ---------- owner <-> reporter relay ----------
  relayPut(key, uid) {
    const r = (this.state.relay ||= {});
    r[key] = [uid, Date.now()];
    const keys = Object.keys(r);
    if (keys.length > 4000) {
      const cut = Date.now() - 21 * 86400_000;
      for (const k of keys) if (r[k][1] < cut) delete r[k];
      const left = Object.keys(r);
      if (left.length > 4000) left.sort((a, b) => r[a][1] - r[b][1]).slice(0, left.length - 3500).forEach((k) => delete r[k]);
    }
    this.persist();
  }
  relayGet(key) { const v = this.state.relay?.[key]; return v ? v[0] : null; }
  openThread(uid, staffId = null) {
    const t = (this.state.threads ||= {});
    t[uid] = { staff: staffId ?? t[uid]?.staff ?? null, at: Date.now() };
    const cut = Date.now() - 14 * 86400_000;
    for (const k of Object.keys(t)) if (t[k].at < cut) delete t[k];
    this.persist();
  }
  // chat messages of a relay conversation, per bot chat, so pressing the menu can clear them
  convoAdd(bot, chatId, ...ids) {
    const c = (this.state.convo ||= {});
    const k = `${bot}:${chatId}`;
    const cut = Date.now() - 47 * 3600_000; // Telegram lets bots delete messages for 48 h only
    c[k] = [...(c[k] || []).filter((x) => x[1] > cut), ...ids.filter(Boolean).map((id) => [id, Date.now()])].slice(-300);
    this.persist({ backupSoon: false });
  }
  convoTake(bot, chatId) {
    const k = `${bot}:${chatId}`;
    const list = this.state.convo?.[k];
    if (!list || !list.length) return [];
    delete this.state.convo[k];
    this.persist({ backupSoon: false });
    return list.map((x) => x[0]);
  }
  thread(uid) { const t = this.state.threads?.[uid]; return t && Date.now() - t.at < 7 * 86400_000 ? t : null; }
  // ---------- bulk actions & auto-delete ----------
  get autoDeleteHours() { return this.state.settings?.autoDeleteHours ?? 1; }
  setAutoDelete(h) {
    if (![0, 1, 24, 48].includes(h)) return;
    this.state.settings = { ...(this.state.settings || {}), autoDeleteHours: h };
    this.persist();
    this.autoDeleteSweep();
  }
  // How many hours of history the map shows (auto-delete window caps it)
  get historyWindow() { const h = this.autoDeleteHours; return h ? Math.min(h, config.historyHours) : config.historyHours; }
  endAll() {
    const ended = [];
    for (const a of this.state.alerts) {
      if (!a.is_active) continue;
      a.is_active = false;
      a.ended_at = new Date().toISOString();
      ended.push(a);
      this.emit('update', publicAlert(a));
    }
    if (ended.length) this.persist();
    return ended;
  }
  deleteMany(pred) {
    const gone = this.state.alerts.filter(pred);
    if (!gone.length) return [];
    const ids = new Set(gone.map((a) => a.id));
    this.state.alerts = this.state.alerts.filter((a) => !ids.has(a.id));
    this._tomb([...ids]);
    for (const a of gone) this.emit('remove', { id: a.id });
    this.persist();
    return gone;
  }
  deleteActive() { return this.deleteMany((a) => a.is_active); }
  autoDeleteSweep() {
    const h = this.autoDeleteHours;
    if (!h) return [];
    const cutoff = Date.now() - h * 3600_000;
    const gone = this.deleteMany((a) => Date.parse(a.timestamp) < cutoff);
    // still-active alerts removed by the timer: mark their channel post as ended (the post itself stays)
    for (const a of gone) if (a.is_active && a.channel_message_id) { a.ended_at = new Date().toISOString(); this.emit('expired', a); }
    return gone;
  }
  activeAlerts() {
    return this.state.alerts.filter((a) => a.is_active);
  }

  recentAlerts(hours = this.historyWindow) {
    const since = Date.now() - hours * 3600_000;
    return this.state.alerts.filter((a) => a.is_active || Date.parse(a.timestamp) >= since);
  }

  expireSweep() {
    const now = Date.now();
    this.autoDeleteSweep();
    for (const a of this.state.alerts) {
      if (a.is_active && Date.parse(a.expires_at) <= now) {
        a.is_active = false;
        a.ended_at = a.expires_at;
        this.emit('update', publicAlert(a));
        this.emit('expired', a);
        this.persist();
      }
    }
  }

  _trim() {
    const cutoff = Date.now() - Math.max(config.historyHours, 24 * 14) * 3600_000;
    this.state.alerts = this.state.alerts
      .filter((a) => a.is_active || Date.parse(a.timestamp) >= cutoff)
      .slice(0, config.maxAlerts);
  }

  // ---------- users / roles ----------
  touchUser(u) {
    if (!u?.id) return;
    const rec = this.state.users[u.id] || {};
    rec.name = [u.first_name, u.last_name].filter(Boolean).join(' ').slice(0, 64);
    rec.username = u.username || undefined;
    rec.seen = new Date().toISOString();
    rec.lang = rec.lang || (u.language_code?.startsWith('ar') ? 'ar' : u.language_code ? 'en' : 'ar');
    this.state.users[u.id] = rec;
    this.persist({ backupSoon: false });
  }

  userLang(id) {
    return this.state.users[id]?.lang || 'ar';
  }

  setUserLang(id, lang) {
    this.state.users[id] = { ...(this.state.users[id] || {}), lang };
    this.persist();
  }

  // ---------- project hand-over overrides (owner / tokens / channel) ----------
  get contacts() { return this.state.settings?.contacts || {}; }
  /** Public view for the website: only what is set; phone split into WhatsApp chat / call by mode. */
  get publicContacts() {
    const c = this.contacts;
    const mode = c.phoneMode || 'both';
    const o = {};
    if (c.wa) o.wa = c.wa;
    if (c.phone) {
      o.phone = c.phone;
      if (mode !== 'tel') o.waChat = 'https://wa.me/' + c.phone.slice(1);
      if (mode !== 'wa') o.tel = 'tel:' + c.phone;
    }
    if (c.tg) o.tg = 'https://t.me/' + c.tg;
    return o;
  }
  setContacts(patch) {
    const cur = { ...this.contacts };
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === undefined || v === '') delete cur[k]; else cur[k] = v; }
    if (!cur.phone) delete cur.phoneMode;
    this.state.settings = { ...(this.state.settings || {}), contacts: cur };
    this.persist();
    this.emit('contacts', this.publicContacts);
  }
  get project() {
    return this.state.settings.project || (this.state.settings.project = {});
  }
  setProject(patch) {
    const cur = { ...this.project };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '') delete cur[k]; else cur[k] = v;
    }
    cur.changedAt = new Date().toISOString();
    this.state.settings.project = cur;
    this.persist();
    return cur;
  }
  isEditor(id) {
    return this.state.editors.includes(Number(id));
  }

  addEditor(id) {
    id = Number(id);
    if (!Number.isFinite(id)) return false;
    if (!this.state.editors.includes(id)) this.state.editors.push(id);
    this.persist();
    return true;
  }

  removeEditor(id) {
    this.state.editors = this.state.editors.filter((x) => x !== Number(id));
    this.persist();
  }

  isBanned(id) {
    return this.state.banned.includes(Number(id));
  }

  ban(id) {
    id = Number(id);
    if (!this.state.banned.includes(id)) this.state.banned.push(id);
    this.persist();
  }
}

/** Strip private fields before sending an alert to browsers. */
export function publicAlert(a) {
  const p = a.place || {};
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    title_en: a.title_en,
    description: cleanAlertText(a.description) || undefined,
    location: a.location,
    place: {
      name_ar: p.name_ar, name_en: p.name_en,
      district_ar: p.district_ar, district_en: p.district_en,
      governorate_ar: p.governorate_ar, governorate_en: p.governorate_en,
    },
    areas: a.areas,
    scope: a.scope,
    // every alert type now shows a glowing circle over each affected area (main + extra areas)
    zones: a.location ? alertZones(a) : undefined,
    more: (a.extra || []).length ? a.extra.map((x) => ({ name_ar: x.name_ar, name_en: x.name_en, district_ar: x.district_ar, district_en: x.district_en, governorate_ar: x.governorate_ar, governorate_en: x.governorate_en, scope: x.scope })) : undefined,
    timestamp: a.timestamp,
    expires_at: a.expires_at,
    ended_at: a.ended_at,
    is_active: a.is_active,
    telegram_url: a.channel_message_id && config.channel.startsWith('@') ? `https://t.me/${config.channel.slice(1)}/${a.channel_message_id}` : undefined,
  };
}

export const store = new Store();
