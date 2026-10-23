import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { config } from './config.js';
import { ALERT_TYPES, typeOf } from '../shared/types.js';
import { zonePoints } from './places.js';

/**
 * In-memory state with atomic JSON persistence on disk and an optional remote backup
 * (the bot keeps a pinned JSON snapshot in the owner's private chat so data survives
 * redeploys on hosts with ephemeral disks such as Render's free tier).
 */
class Store extends EventEmitter {
  constructor() {
    super();
    this.state = { version: 1, alerts: [], editors: [], banned: [], users: {}, stats: { published: 0 }, settings: { autoDeleteHours: 48 } };
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
      settings: { autoDeleteHours: [0, 24, 48].includes(s.settings?.autoDeleteHours) ? s.settings.autoDeleteHours : 48 },
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
    if (backupSoon && this.backup && config.telegramBackup) {
      clearTimeout(this._backupTimer);
      this._backupPending = true;
      this._backupTimer = setTimeout(() => this.flushBackup(), 15_000);
    }
  }
  async flushBackup() {
    clearTimeout(this._backupTimer);
    if (!this._backupPending || !this.backup) return;
    this._backupPending = false;
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
      scope: input.location?.scope || 'country',
      timestamp: now.toISOString(),
      expires_at: new Date(now.getTime() + ttl * 60_000).toISOString(),
      source: input.source || 'telegram',
      is_active: true,
      author: input.author || null,
      channel_message_id: null,
    };
    this.state.alerts.unshift(alert);
    this.state.stats.published = (this.state.stats.published || 0) + 1;
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
    this.persist();
    this.emit('remove', { id });
    return a;
  }

  // ---------- bulk actions & auto-delete ----------
  get autoDeleteHours() { return this.state.settings?.autoDeleteHours ?? 48; }
  setAutoDelete(h) {
    if (![0, 24, 48].includes(h)) return;
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
    for (const a of gone) this.emit('remove', { id: a.id });
    this.persist();
    return gone;
  }
  deleteActive() { return this.deleteMany((a) => a.is_active); }
  autoDeleteSweep() {
    const h = this.autoDeleteHours;
    if (!h) return [];
    const cutoff = Date.now() - h * 3600_000;
    return this.deleteMany((a) => Date.parse(a.timestamp) < cutoff);
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
    description: a.description || undefined,
    location: a.location,
    place: {
      name_ar: p.name_ar, name_en: p.name_en,
      district_ar: p.district_ar, district_en: p.district_en,
      governorate_ar: p.governorate_ar, governorate_en: p.governorate_en,
    },
    areas: a.areas,
    scope: a.scope,
    zones: typeOf(a.type).zone ? zonePoints({ ...(a.place || {}), ...(a.location || {}) }, a.scope) : undefined,
    timestamp: a.timestamp,
    expires_at: a.expires_at,
    ended_at: a.ended_at,
    is_active: a.is_active,
    source: a.source,
    telegram_url: a.channel_message_id && config.channel.startsWith('@') ? `https://t.me/${config.channel.slice(1)}/${a.channel_message_id}` : undefined,
  };
}

export const store = new Store();
