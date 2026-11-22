import { operatorReportsStatus, operatorReportReview, operateReport } from './reports-operator.js';
import { transferCounters } from './transfer-counters.js';
import { backupTransfer } from './backup-codec.js';
import { configureCoordination } from './editor-coordination.js';
import { startTranslations } from './translate.js';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { webhookCallback } from 'grammy';
import { config } from './config.js';
import { store, publicAlert } from './store.js';
import { startNewsMonitor, stopNewsMonitor, newsDebug, sendTestDraft, operatorNewsReview, operateNewsDraft, operatorNewsStatus, setOperatorNewsMode, reconcilePublishedNewsDuplicate } from './news-monitor.js';
import { startJobsMonitor, stopJobsMonitor, publicJobs } from './jobs.js';
import { reviseJobMetadata } from './jobs-metadata.js';
import { operatorJobsStatus, operatorJobReview, operateJobDraft } from './jobs-operator.js';
import { startArmyMonitor, stopArmyMonitor, publicArmy } from './army.js';
import { createBot, imageTest, resyncChannelPosts, refreshChannelInfo, fixPostMarkup, retypeAlerts, startDailySummary, telegramBackupAdapter, BOT_COMMANDS, REPORT_COMMANDS, botInfo, runtimeHooks, fetchAlertMediaFile, pauseAlnabaBatchIntake, deleteAlertEverywhere, publishInput, repairNewsAlert } from './bot.js';
import { applyProject } from './config.js';
import { governorates, searchFollowPlaces } from './places.js';
import { mountSeo, homeJsonLd, verifyMetaTags } from './seo.js';
import { startPrices, publicPrices, postBulletin, pricesDebug, refreshPrices } from './prices.js';
import { publicWeather, startWxBulletin, weatherNowDebug, wxBulletinDebug, postWxBulletin } from './wx-daily.js';
import { startQuakes, quakesDebug, pollQuakes } from './quakes.js';
import { weatherDebug, checkWeather } from './weather.js';
import { publicBorders, setBorder, CROSSINGS } from './borders.js';
import { renderNewsIllustrationPng } from './alert-image.js';
import { startServices, publicRoads, publicPower } from './services.js';
import { pushConfigured, pushPublicKey, saveSubscription, removeSubscription, sendPush } from './push.js';

const ROOT = new URL('..', import.meta.url).pathname;
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const startupMaintenanceEnabled = process.env.RUN_STARTUP_MAINTENANCE === 'true';

const ADMIN_DESC = '🔒 بوت النشر الخاص بإدارة Red Alert Syria (للمشرفين فقط).';
const ADMIN_SHORT = 'بوت النشر الخاص — Red Alert Syria';
const REPORT_DESC = '📨 بوت التبليغ الخاص بـ Red Alert Syria — الإنذار الأحمر سوريا.\n\nأبلغ عن مسيّرة، طيران حربي، قصف مدفعي، هجوم، صواريخ أو حدث مدني في منطقتك. يصل بلاغك إلى الإدارة ويُنشر على القناة والخريطة بعد التحقق.\n\nReport drones, warplanes, shelling, attacks, missiles or civil events in Syria.';
const REPORT_SHORT = 'أرسل بلاغاً عن حدث في سوريا — Red Alert Syria';
const ADMIN_DESC_EN = '🔒 Private publishing bot of the Red Alert Syria team (moderators only).';
const ADMIN_SHORT_EN = 'Private publishing bot — Red Alert Syria';
const REPORT_DESC_EN = '📨 The reporting bot of Red Alert Syria.\n\nReport a drone, warplane, shelling, attack, missiles or a civil event in your area. Your report reaches the team and is posted on the channel and the map after it is checked.';
const REPORT_SHORT_EN = 'Report an event in Syria — Red Alert Syria';
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
// Install before compression so these private counters see compressed body chunks.
app.use(transferCounters.middleware);

// ------------------------------------------------------------------ security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'wasm-unsafe-eval'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:', 'https://tiles.openfreemap.org', 'https://server.arcgisonline.com', 'https://elevation-tiles-prod.s3.amazonaws.com', 'https://tile.openstreetmap.org'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'", 'https://tiles.openfreemap.org', 'https://server.arcgisonline.com', 'https://elevation-tiles-prod.s3.amazonaws.com', 'https://tile.openstreetmap.org'],
        'worker-src': ["'self'", 'blob:'],
        'child-src': ["'self'", 'blob:'],
        'media-src': ["'self'", 'data:', 'blob:'],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'upgrade-insecure-requests': [],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
  }),
);
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()');
  next();
});
app.use(compression({ filter: (req, res) => (req.path === '/api/stream' ? false : compression.filter(req, res)) }));

// ------------------------------------------------------------------ telegram webhook
// Bot 1 (admin): private publishing panel for the owner + editors.
// Bot 2 (report): public bot where anyone can send a report; reports reach the editors through bot 1.
// Both can be switched at runtime (🔁 Project hand-over), so webhooks are routed through a lookup table.
const bots = { admin: null, report: null };
const hooks = new Map(); // webhook key -> grammY express handler
const hookKey = (secret) => String(secret || '').slice(0, 24);
app.post('/tg/:k', express.json({ limit: '1mb' }), (req, res, next) => {
  const h = hooks.get(req.params.k);
  if (!h) return res.status(404).end();
  return h(req, res, next);
});

// ------------------------------------------------------------------ API
const apiLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
const streamLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/api/', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.get('/api/push/public-key', apiLimiter, (req, res) => {
  if (!pushConfigured) return res.status(404).json({ enabled: false });
  res.json({ enabled: true, publicKey: pushPublicKey });
});
app.post('/api/push/subscribe', apiLimiter, express.json({ limit: '32kb' }), (req, res) => {
  if (!pushConfigured) return res.status(503).json({ enabled: false });
  const id = saveSubscription(store, req.body?.subscription, req.body?.preferences);
  if (!id) return res.status(400).json({ error: 'invalid subscription' });
  res.status(201).json({ ok: true, id });
});
app.delete('/api/push/subscribe', apiLimiter, express.json({ limit: '8kb' }), (req, res) => {
  if (!pushConfigured) return res.status(404).end();
  res.json({ ok: removeSubscription(store, req.body?.subscription || req.body?.endpoint) });
});

app.get('/api/places/search', apiLimiter, (req, res) => {
  res.json({ places: searchFollowPlaces(req.query.q, req.query.gov) });
});

// Lightweight public page counters (map + shared alert pages) for the owner's growth
// report. In-memory: resets on redeploy, no cookies, no personal data, static
// assets and API calls never count. /api/health reports the live numbers.
const pageStats = { since: new Date().toISOString(), day: new Date().toISOString().slice(0, 10), map: 0, alertPages: 0 };
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const p = req.path;
  const isMap = p === '/' || p === '/ar' || p === '/en' || p === '/ar/' || p === '/en/';
  const isAlertPage = /^\/(?:ar|en)\/a\//.test(p);
  if (!isMap && !isAlertPage) return next();
  const today = new Date().toISOString().slice(0, 10);
  if (pageStats.day !== today) { pageStats.day = today; pageStats.map = 0; pageStats.alertPages = 0; }
  if (isMap) pageStats.map++; else pageStats.alertPages++;
  next();
});

app.get('/api/health', (req, res) => {
  const latest = store.state.alerts.reduce((best, a) => Number(a.channel_message_id) > Number(best?.channel_message_id || 0) ? a : best, null);
  res.json({ ok: true, build: BUILD, uptime: Math.round(process.uptime()), active: store.activeAlerts().length, clients: clients.size,
    latest_publication: latest ? { id: latest.id, telegram_post_id: latest.channel_message_id } : null,
    backup_transfer: { ...backupTransfer }, pageviews: { ...pageStats } });
});

app.get('/api/alerts', apiLimiter, (req, res) => {
  const includeInactive = req.query.include === 'inactive' || req.query.all === '1';
  const list = (includeInactive ? store.recentAlerts() : store.activeAlerts()).map(publicAlert);
  res.json({ alerts: list, history_hours: store.historyWindow, server_time: new Date().toISOString(), support: store.publicSupport, build: BUILD });
});

app.get('/api/alerts/:id', apiLimiter, (req, res) => {
  if (!/^[\w-]{36}$/.test(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const a = store.getAlert(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  res.json({ alert: publicAlert(a) });
});

const newsIllustrationCache = new Map();
app.get('/api/alerts/:id/illustration', apiLimiter, async (req, res) => {
  if (!/^[\w-]{36}$/.test(req.params.id)) return res.status(400).end();
  const alert = store.getAlert(req.params.id);
  if (!alert) return res.status(404).end();
  if (publicAlert(alert).media_items?.length) return res.status(404).end();
  const lang = req.query.lang === 'en' ? 'en' : 'ar';
  const revision = {
    id: alert.id, type: alert.type, title: alert.title, title_en: alert.title_en,
    description: alert.description, description_en: alert.description_en,
    location: alert.location, place: alert.place, scope: alert.scope, extra: alert.extra,
    timestamp: alert.timestamp,
    meta: { hazard: alert.meta?.hazard, signalPlatform: alert.meta?.signalPlatform, incursionKind: alert.meta?.incursionKind },
  };
  const tag = `"${crypto.createHash('sha256').update(JSON.stringify([revision, lang, 'brief-layout-v2'])).digest('hex').slice(0, 16)}"`;
  res.setHeader('ETag', tag);
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="alert-${req.params.id}-illustration.png"`);
  if (req.headers['if-none-match']?.split(',').map((value) => value.trim()).includes(tag)) return res.status(304).end();
  const key = `${req.params.id}:${lang}:${tag}`;
  try {
    let buffer = newsIllustrationCache.get(key);
    if (!buffer) {
      buffer = renderNewsIllustrationPng(alert, lang);
      newsIllustrationCache.set(key, buffer);
      while (newsIllustrationCache.size > 32) newsIllustrationCache.delete(newsIllustrationCache.keys().next().value);
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(buffer.length));
    return res.status(200).end(buffer);
  } catch (error) {
    console.warn(`[illustration] render failed for alert ${req.params.id}:`, error?.message || error);
    return res.status(503).json({ error: 'illustration temporarily unavailable' });
  }
});

app.get('/api/alerts/:id/media', apiLimiter, async (req, res) => {
  if (!/^[\w-]{36}$/.test(req.params.id)) return res.status(400).end();
  const requestedType = String(req.query.type || '');
  if (requestedType && !['photo', 'video'].includes(requestedType)) return res.status(400).end();
  const alert = store.getAlert(req.params.id);
  const projected = alert && publicAlert(alert);
  const publicMedia = requestedType
    ? projected?.media_items?.find((item) => item.type === requestedType)
    : projected?.media;
  if (!alert || !publicMedia) return res.status(404).end();
  const etag = `"${publicMedia.version}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' })[publicMedia.mime_type] || (publicMedia.type === 'photo' ? 'jpg' : 'mp4');
  res.setHeader('Content-Disposition', `inline; filename="alert-${req.params.id}.${extension}"`);
  res.setHeader('Accept-Ranges', 'bytes');
  if (req.headers['if-none-match']?.split(',').map((value) => value.trim()).includes(etag)) return res.status(304).end();
  try {
    const asset = await fetchAlertMediaFile(req.params.id, requestedType || null);
    if (!asset?.buffer?.length) return res.status(404).end();
    res.setHeader('Content-Type', asset.contentType);
    const size = asset.buffer.length;
    const range = req.headers.range;
    if (!range) {
      res.setHeader('Content-Length', String(size));
      return res.status(200).end(asset.buffer);
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    const suffixLength = match[1] ? null : Number(match[2]);
    const start = match[1] ? Number(match[1]) : Math.max(0, size - suffixLength);
    const end = match[2] && match[1] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    return res.status(206).end(asset.buffer.subarray(start, end + 1));
  } catch {
    console.warn(`[media] Telegram attachment unavailable for alert ${req.params.id}`);
    return res.status(502).json({ error: 'media temporarily unavailable' });
  }
});

// Token-protected self-test of the channel image on this server: renders samples and sends them to the
// owner's private chat only. key = sha256(BOT_TOKEN + ':imgtest').
app.get('/api/imgtest', apiLimiter, async (req, res) => {
  const want = config.botToken ? crypto.createHash('sha256').update(`${config.botToken}:imgtest`).digest('hex') : null;
  const key = String(req.query.key || '');
  if (!want || !bots.admin || key.length !== want.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(want))) return res.status(404).end();
  const owner = config.ownerIds[0];
  if (!owner) return res.status(400).json({ error: 'no owner' });
  try {
    res.json(await imageTest(bots.admin.api, owner, { type: String(req.query.type || 'uav'), q: String(req.query.q || ''), lang: req.query.lang === 'en' ? 'en' : 'ar' }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Token-protected news-monitor tools (owner's private chat only): status JSON, and a clearly marked
// test draft (cannot publish; removed after 10 min). key = sha256(BOT_TOKEN + ':news').
const newsKeyOk = (req) => {
  const want = config.botToken ? crypto.createHash('sha256').update(`${config.botToken}:news`).digest('hex') : null;
  const key = String(req.query.key || '');
  return Boolean(want && key.length === want.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(want)));
};
app.get('/api/newsdebug', apiLimiter, (req, res) => (newsKeyOk(req) ? res.json(newsDebug()) : res.status(404).end()));
app.get('/api/newstest', apiLimiter, async (req, res) => {
  if (!newsKeyOk(req) || !bots.admin) return res.status(404).end();
  const owner = config.ownerIds[0];
  if (!owner) return res.status(400).json({ error: 'no owner' });
  try { res.json(await sendTestDraft(owner)); } catch (e) { res.status(500).json({ error: e.message }); }
});
// Operator alert removal (e.g. duplicated stories): same delete path as the admin
// bot's 🗑 — removes the map alert AND its channel post. Disabled unless an
// ADMIN_API_KEY env var is set on the service; 404 either way when the key is wrong.
const adminKeyOk = (req) => {
  const want = process.env.ADMIN_API_KEY || '';
  const key = String(req.headers['x-admin-key'] || '');
  return Boolean(want && key.length === want.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(want)));
};
transferCounters.mountPrivateStatus(app, adminKeyOk, apiLimiter);
app.get('/api/admin/jobs/status', apiLimiter, (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-store');
  return res.json(operatorJobsStatus());
});
app.get('/api/admin/jobs/:id', apiLimiter, (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-store');
  const review = operatorJobReview(req.params.id);
  return review ? res.json(review) : res.status(404).json({ error: 'unknown-listing' });
});
app.post('/api/admin/jobs/:id/review', apiLimiter, express.json({ limit: '2kb' }), async (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await operateJobDraft(req.params.id, { action: req.body?.action, revision: req.body?.revision });
    return res.status(result.ok ? 200 : 409).json(result);
  } catch (e) { return res.status(409).json({ ok: false, error: e.message }); }
});
app.post('/api/admin/jobs/:id/metadata', apiLimiter, (req, res, next) => adminKeyOk(req) ? next() : res.status(404).end(), express.json({ limit: '40kb' }), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await reviseJobMetadata(req.params.id, req.body);
    return res.status(result.ok ? 200 : 409).json(result);
  } catch (e) { return res.status(409).json({ ok: false, error: e.message }); }
});
app.get('/api/admin/reports/status', apiLimiter, (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-store'); return res.json(operatorReportsStatus());
});
app.get('/api/admin/reports/:id', apiLimiter, (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-store'); const r = operatorReportReview(req.params.id);
  return r ? res.json(r) : res.status(404).json({ error: 'unknown-report' });
});
app.post('/api/admin/reports/:id/review', apiLimiter, express.json({ limit: '24kb' }), async (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-store');
  try { const r = await operateReport(req.params.id, req.body); return res.status(r.ok ? 200 : 409).json(r); }
  catch (e) { return res.status(409).json({ ok: false, error: e.message }); }
});
app.get('/api/admin/news/status', apiLimiter, (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  return res.json(operatorNewsStatus(req.query.include === 'ids'));
});
app.post('/api/admin/news/mode', apiLimiter, express.json({ limit: '2kb' }), async (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  try { return res.json(await setOperatorNewsMode(req.body?.mode)); }
  catch (e) { return res.status(409).json({ ok: false, error: e.message }); }
});
app.post('/api/admin/news/:id/reconcile-duplicate', apiLimiter, express.json({ limit: '8kb' }), async (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  try { return res.json(await reconcilePublishedNewsDuplicate(req.params.id, req.body)); }
  catch (e) { return res.status(409).json({ ok: false, error: e.message }); }
});
app.get('/api/admin/news/:id', apiLimiter, (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  const review = operatorNewsReview(req.params.id);
  return review ? res.json(review) : res.status(404).json({ error: 'unknown-draft' });
});
app.post('/api/admin/news/:id/review', apiLimiter, express.json({ limit: '8kb' }), async (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  try {
    const result = await operateNewsDraft(req.params.id, { action: req.body?.action, revision: req.body?.revision });
    return res.status(result.ok ? 200 : 409).json(result);
  } catch (e) { return res.status(409).json({ ok: false, error: e.message }); }
});
app.get('/api/admin/editor-coordination', apiLimiter, (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  return res.json(store.state.news?.coordination || { until: null, chats: [], replies: [] });
});
app.post('/api/admin/editor-coordination', apiLimiter, express.json({ limit: '8kb' }), async (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  try {
    const value = configureCoordination(store.state, req.body, [...config.ownerIds, ...store.state.editors]);
    store.persist(); await store.flushBackup(true);
    return res.json({ ok: true, until: value.until, chats: value.chats });
  } catch (error) { return res.status(400).json({ ok: false, error: error.message }); }
});
app.post('/api/admin/alerts/:id/delete', apiLimiter, async (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  try {
    const removed = await deleteAlertEverywhere(bots.admin?.api, req.params.id);
    if (!removed) return res.status(404).json({ ok: false, error: 'alert not found' });
    return res.json({ ok: true, id: removed.id, channelPost: removed.channel_message_id || null });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});
// Manual publish: map + channel in one shot (owner-driven stories the radar missed).
// Syria bounding box sanity check (owner 2026-11-20): a transposed latitude once
// plotted المالكية abroad; raw coordinates must stay inside the country.
const SYRIA_BBOX = { latMin: 32.3, latMax: 37.4, lonMin: 35.6, lonMax: 42.45 };
const insideSyria = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon)
  && lat >= SYRIA_BBOX.latMin && lat <= SYRIA_BBOX.latMax && lon >= SYRIA_BBOX.lonMin && lon <= SYRIA_BBOX.lonMax;

app.post('/api/admin/alerts/publish', apiLimiter, express.json({ limit: '64kb' }), async (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  if (!bots.admin?.api) return res.status(503).json({ ok: false, error: 'admin bot not up' });
  try {
    const b = req.body || {};
    if (!b.type || !b.title) return res.status(400).json({ ok: false, error: 'type and title required' });
    if (b.location && Number.isFinite(b.location.latitude) && !insideSyria(Number(b.location.latitude), Number(b.location.longitude))) {
      return res.status(400).json({ ok: false, error: 'location outside Syria bounds' });
    }
    const alert = await publishInput(bots.admin.api, {
      type: b.type, title: b.title, title_en: b.title_en,
      description: b.description || '', body: b.body || undefined,
      location: b.location || null, areas: b.areas || [], extra: b.extra || [],
      meta: b.meta || null, source: b.source || 'telegram', author: b.author || { id: 0, name: 'manual', via: 'admin-api' },
    });
    return res.json({ ok: true, id: alert.id, channelPost: alert.channel_message_id || null, url: publicAlert(alert) ? `${(config.publicUrl || '').replace(/\/$/, '')}/ar/a/${alert.id}` : null });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});
// Move a published alert's pin to corrected coordinates (map + alert page update live;
// the channel post text carries no coordinates, so it stays untouched).
app.post('/api/admin/alerts/:id/location', apiLimiter, express.json({ limit: '8kb' }), (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  const lat = Number(req.body?.latitude); const lon = Number(req.body?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ ok: false, error: 'latitude/longitude required' });
  if (!insideSyria(lat, lon)) return res.status(400).json({ ok: false, error: 'outside Syria bounds' });
  const a = store.getAlert(req.params.id);
  if (!a) return res.status(404).json({ ok: false, error: 'unknown alert' });
  store.updateAlert(a.id, { location: { ...(a.location || {}), latitude: lat, longitude: lon } });
  return res.json({ ok: true, id: a.id });
});

// Re-render every channel post with the current formatting (e.g. pin first-name rule).
app.post('/api/admin/alerts/resync', apiLimiter, async (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  if (!bots.admin?.api) return res.status(503).json({ ok: false, error: 'admin bot not up' });
  try { const n = await resyncChannelPosts(bots.admin.api); return res.json({ ok: true, resynced: n }); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});
// Repair a monitored-news alert after cleaner/classifier fixes: re-runs cleanup, type
// and place resolution on the stored raw text, updates the record, re-edits the channel
// post in place (owner-flagged post repairs; never a repost).
app.post('/api/admin/alerts/:id/repair-news', apiLimiter, express.json({ limit: '16kb' }), async (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  if (!bots.admin?.api) return res.status(503).json({ ok: false, error: 'admin bot not up' });
  try {
    const r = await repairNewsAlert(bots.admin.api, req.params.id, req.body?.correction, {
      dryRun: req.body?.dry_run === true, refreshPhoto: req.body?.refresh_photo === true,
      expectedRevision: req.body?.expected_revision, expectedPostId: req.body?.expected_post_id,
    });
    return res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/admin/channel/delete-message', apiLimiter, express.json({ limit: '8kb' }), async (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  if (!bots.admin?.api) return res.status(503).json({ ok: false, error: 'admin bot not up' });
  const mid = Number(req.body?.message_id);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ ok: false, error: 'message_id required' });
  try { await bots.admin.api.deleteMessage(config.channel, mid); return res.json({ ok: true, deleted: mid }); }
  catch (e) { return res.status(500).json({ ok: false, error: e.description || e.message }); }
});
app.post('/api/admin/channel/refresh-info', apiLimiter, express.json({ limit: '16kb' }), async (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  if (!bots.admin?.api) return res.status(503).json({ ok: false, error: 'admin bot not up' });
  try {
    if (req.body?.fix_markup_message_id) return res.json(await fixPostMarkup(req.body.fix_markup_message_id));
    return res.json(await refreshChannelInfo());
  }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});
// 💱 prices / 🛣 roads / ⚡ electricity for the website
app.get('/api/weather', apiLimiter, async (req, res) => {
  try { res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60'); res.json(await publicWeather()); } catch { res.set('Cache-Control', 'no-store'); res.status(503).json({ ok: false, error: 'weather unavailable' }); }
});
app.get('/api/weathernow', apiLimiter, (req, res) => res.json(weatherNowDebug()));
app.get('/api/admin/weather/status', apiLimiter, async (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  res.json({ bulletin: wxBulletinDebug(), now: weatherNowDebug() });
});
app.post('/api/admin/weather/publish', apiLimiter, async (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  if (!bots.admin?.api) return res.status(503).json({ ok: false, error: 'admin bot not up' });
  try { const r = await postWxBulletin(bots.admin.api, {}); return res.json({ ok: true, result: r || null }); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/admin/borders/set-all', apiLimiter, express.json({ limit: '8kb' }), async (req, res) => {
  if (!adminKeyOk(req)) return res.status(404).end();
  const st = String(req.body?.status || 'open');
  const note = String(req.body?.note || '').slice(0, 300);
  try {
    let n = 0;
    for (const c of CROSSINGS) if (setBorder(c.id, st, note, 'owner')) n++;
    return res.json({ ok: true, updated: n });
  } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/services', apiLimiter, (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ prices: publicPrices(), roads: publicRoads(), power: publicPower(), borders: publicBorders(), jobs: publicJobs(), army: publicArmy(), server_time: new Date().toISOString() });
});
// Token-protected prices tools: status JSON, and a clearly marked preview of the bulletin sent to the
// owner's private chat only (never the channel). key = sha256(BOT_TOKEN + ':prices').
const pricesKeyOk = (req) => {
  const want = config.botToken ? crypto.createHash('sha256').update(`${config.botToken}:prices`).digest('hex') : null;
  const key = String(req.query.key || '');
  return Boolean(want && key.length === want.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(want)));
};
app.get('/api/pricesdebug', apiLimiter, async (req, res) => {
  if (!pricesKeyOk(req)) return res.status(404).end();
  if (req.query.refresh) await refreshPrices({ force: true }).catch(() => {});
  res.json(pricesDebug());
});
app.get('/api/weatherdebug', apiLimiter, async (req, res) => {
  if (!pricesKeyOk(req)) return res.status(404).end();
  if (req.query.dry) return res.json({ dry: await checkWeather({ dry: true }).catch((e) => ({ error: e.message })), ...weatherDebug() });
  res.json({ ...weatherDebug(), bulletin: wxBulletinDebug() });
});
app.get('/api/quakesdebug', apiLimiter, async (req, res) => {
  if (!pricesKeyOk(req)) return res.status(404).end();
  if (req.query.dry) return res.json({ dry: await pollQuakes({ dry: true }).catch((e) => ({ error: e.message })), ...quakesDebug() });
  res.json(quakesDebug());
});
app.get('/api/pricestest', apiLimiter, async (req, res) => {
  if (!pricesKeyOk(req) || !bots.admin) return res.status(404).end();
  const owner = config.ownerIds[0];
  if (!owner) return res.status(400).json({ error: 'no owner' });
  try { res.json(await postBulletin(bots.admin.api, { chatId: owner, test: true })); } catch (e) { res.status(500).json({ error: e.description || e.message }); }
});
app.get('/api/meta', apiLimiter, (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({ governorates: governorates.map(({ code, ar, en, lat, lon }) => ({ code, ar, en, lat, lon })), channel: config.channelUrl, bot: (botInfo.report || botInfo.admin) ? `https://t.me/${botInfo.report || botInfo.admin}` : null });
});

// ------------------------------------------------------------------ Server-Sent Events
const clients = new Set();
const MAX_CLIENTS = 5000;
app.get('/api/stream', streamLimiter, (req, res) => {
  if (clients.size >= MAX_CLIENTS) return res.status(503).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 4000\n\n');
  res.write(`event: snapshot\ndata: ${JSON.stringify({ alerts: store.recentAlerts().map(publicAlert), history_hours: store.historyWindow, server_time: new Date().toISOString(), build: BUILD, contacts: store.publicContacts, support: store.publicSupport, roads: publicRoads(), jobs: publicJobs(), army: publicArmy() })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
const broadcast = (event, data) => {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
};
store.on('alert', (a) => { broadcast('alert', a); sendPush(store, a, 'new').catch((e) => console.warn('[push] new alert failed:', e.message)); });
store.on('update', (a) => {
  broadcast('update', a);
  if (a.updates?.at(-1)?.kind === 'updated') sendPush(store, a, 'update').catch((e) => console.warn('[push] update failed:', e.message));
});
store.on('remove', (a) => broadcast('remove', a));
store.on('roads', (r) => broadcast('roads', r)); // 🛣 road status layer
store.on('power', (p) => broadcast('power', p));
store.on('borders', (b) => broadcast('borders', b)); // 🛂 border crossings // ⚡ electricity updates
store.on('jobs', (j) => broadcast('jobs', j)); // 💼 approved jobs only
store.on('army', (a) => broadcast('army', a)); // 🏛 owner-approved official salary / recruitment items only
store.on('contacts', (c) => broadcast('contacts', c)); // website contact links change instantly
store.on('support', (s) => broadcast('support', s)); // optional wallet support changes instantly
setInterval(() => {
  for (const c of clients) c.write(`event: ping\ndata: ${Date.now()}\n\n`);
}, 25_000).unref();

// ------------------------------------------------------------------ static site
const longCache = { maxAge: '30d', immutable: true };
app.use('/vendor', express.static(path.join(PUBLIC, 'vendor'), longCache));
app.use('/fonts', express.static(path.join(PUBLIC, 'fonts'), longCache));
app.use('/shared', express.static(SHARED, { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.use(express.static(PUBLIC, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (/\.(html|js|mjs|css|webmanifest)$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } }));

// build id: changes on every deploy so browsers fetch fresh files and open pages reload themselves
const BUILD = String(process.env.RENDER_GIT_COMMIT || Date.now().toString(36)).slice(0, 10);
// Bust integer app asset versions but preserve semantic vendor versions (e.g. 6.16.0),
// so modulepreload URLs match the exact imports used by app.js.
const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(/\?v=(\d+)(?=["&])/g, `?v=${BUILD}`);
function renderIndex(lang) {
  const url = config.publicUrl || '';
  const head = `${verifyMetaTags()}<link rel="alternate" hreflang="x-default" href="${url}/ar/" /><meta property="og:locale" content="${lang === 'ar' ? 'ar_SY' : 'en_US'}" />`
    + homeJsonLd(lang).map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('');
  return indexHtml
    .replace('</head>', `${head}\n</head>`)
    .replaceAll('{{LANG}}', lang)
    .replaceAll('{{DIR}}', lang === 'ar' ? 'rtl' : 'ltr')
    .replaceAll('{{URL}}', url)
    .replaceAll('{{TITLE}}', lang === 'ar' ? 'الإنذار الأحمر سوريا — خريطة سوريا المباشرة للتنبيهات لحظةً بلحظة' : 'Red Alert Syria — Live map of alerts across Syria')
    .replaceAll('{{DESC}}', lang === 'ar' ? 'خريطة تفاعلية مباشرة لتنبيهات المسيّرات والطيران الحربي والصواريخ والقصف في سوريا، تُحدَّث لحظةً بلحظة. مجاني، بدون تطبيق، للجميع.' : 'Real-time interactive map of drone, warplane, missile and shelling alerts across Syria. Free, no app, for everyone.');
}
// Installable app (PWA) manifest per language: same app id, so /ar/ and /en/ are one app.
const manifestBase = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
const manifestFor = (lang) => JSON.stringify({
  ...manifestBase,
  id: '/?app=red-alert-syria',
  name: lang === 'en' ? 'Red Alert Syria — Live alerts map' : 'Red Alert Syria — الإنذار الأحمر سوريا',
  description: lang === 'en' ? 'Live map of alerts across Syria, moment by moment' : manifestBase.description,
  start_url: `/${lang}/?source=pwa`,
  lang,
  dir: lang === 'en' ? 'ltr' : 'rtl',
});
const MANIFEST = { ar: manifestFor('ar'), en: manifestFor('en') };
app.get(['/manifest-ar.webmanifest', '/manifest-en.webmanifest', '/manifest.webmanifest'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/manifest+json').send(MANIFEST[req.path.includes('-en') ? 'en' : 'ar']);
});
app.get('/', (req, res) => {
  const pref = String(req.headers['accept-language'] || '').toLowerCase();
  res.redirect(302, pref.startsWith('en') ? '/en/' : '/ar/');
});
app.get(['/ar', '/en', '/ar/', '/en/'], (req, res) => {
  const p = req.originalUrl.split('?')[0];
  if (!p.endsWith('/')) return res.redirect(301, p + '/');
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(renderIndex(p.startsWith('/en') ? 'en' : 'ar'));
});
mountSeo(app, { limiter: apiLimiter });
app.use((req, res) => res.status(404).type('text').send('Not found'));

// ------------------------------------------------------------------ start
const UPD = ['message', 'callback_query', 'edited_channel_post'];
const secretOf = (role) => (role === 'admin' ? config.webhookSecret : config.reportWebhookSecret);
const tokenOf = (role) => (role === 'admin' ? config.botToken : config.reportBotToken);
async function describe(role, b) {
  try {
    if (role === 'admin') {
      await b.api.setMyCommands(BOT_COMMANDS.ar);
      await b.api.setMyCommands(BOT_COMMANDS.en, { language_code: 'en' });
      await b.api.setMyDescription(ADMIN_DESC + (botInfo.report ? `\n\nلإرسال بلاغ: @${botInfo.report}` : ''));
      await b.api.setMyShortDescription(ADMIN_SHORT + (botInfo.report ? ` · للبلاغات: @${botInfo.report}` : ''));
      await b.api.setMyDescription(ADMIN_DESC_EN + (botInfo.report ? `\n\nTo send a report: @${botInfo.report}` : ''), { language_code: 'en' });
      await b.api.setMyShortDescription(ADMIN_SHORT_EN + (botInfo.report ? ` · Reports: @${botInfo.report}` : ''), { language_code: 'en' });
    } else {
      await b.api.setMyCommands(REPORT_COMMANDS.ar);
      await b.api.setMyCommands(REPORT_COMMANDS.en, { language_code: 'en' });
      await b.api.setMyDescription(REPORT_DESC);
      await b.api.setMyShortDescription(REPORT_SHORT);
      await b.api.setMyDescription(REPORT_DESC_EN, { language_code: 'en' });
      await b.api.setMyShortDescription(REPORT_SHORT_EN, { language_code: 'en' });
    }
  } catch (e) { console.warn(`[${role}] could not set commands`, e.description || e.message); }
}
async function launch(role, b) {
  const label = role === 'admin' ? 'bot' : 'report-bot';
  if (config.botMode === 'webhook' && config.publicUrl) {
    const secret = secretOf(role);
    hooks.set(hookKey(secret), webhookCallback(b, 'express', { secretToken: secret, timeoutMilliseconds: 9000,
      // answer Telegram anyway (no re-delivery storm) but leave a trace: the update is still being handled
      onTimeout: () => console.warn(`[${label}] update still running after 9 s (Telegram API slow?) — continuing in background`) }));
    const set = b.api.setWebhook(`${config.publicUrl}/tg/${hookKey(secret)}`, { secret_token: secret, allowed_updates: UPD, max_connections: 20, drop_pending_updates: false });
    const slow = new Promise((r) => setTimeout(() => r('slow'), 20_000).unref());
    const r = await Promise.race([set, slow]);
    if (r === 'slow') { console.warn(`[${label}] setWebhook slow — handler attached, continuing`); set.then(() => console.log(`[${label}] webhook set (late)`)).catch((e) => console.error(`[${label}] setWebhook failed`, e.description || e.message)); }
    else console.log(`[${label}] webhook set`);
  } else {
    await b.api.deleteWebhook();
    b.start({ allowed_updates: UPD, onStart: () => console.log(`[${label}] long polling started`) });
  }
}
async function retire(role, b, secret) {
  if (!b) return;
  hooks.delete(hookKey(secret));
  try { if (config.botMode === 'webhook' && config.publicUrl) await b.api.deleteWebhook(); else await b.stop(); } catch { /* old token may be revoked */ }
}
// Bring up (or swap) bots from the live config. Throws if a new bot cannot start; the old one is kept then.
async function bringUp(roles, reuse = {}) {
  for (const role of roles) {
    const token = tokenOf(role);
    const old = bots[role];
    const oldSecret = old ? old.__secret : null;
    if (old && old.token === token) continue;
    if (!token) { await retire(role, old, oldSecret); bots[role] = null; botInfo[role] = null; continue; }
    const b = reuse[role] && reuse[role].token === token ? reuse[role] : createBot({ role, token });
    try {
      // Telegram can stall for minutes on a single bot: never wait more than 20 s, the caller retries
      await Promise.race([b.init(), new Promise((_, rej) => setTimeout(() => rej(new Error('getMe timeout (20s)')), 20_000).unref())]);
      b.__secret = secretOf(role);
      botInfo[role] = b.botInfo.username;
      await launch(role, b);
    } catch (e) {
      hooks.delete(hookKey(secretOf(role)));
      if (old) { createBotRestore(role, old); botInfo[role] = old.botInfo?.username || null; }
      throw e;
    }
    bots[role] = b;
    if (old) await retire(role, old, oldSecret);
    console.log(`[${role}] @${botInfo[role]} ready (${config.botMode})`);
    describe(role, b);
    if (role === 'report' && bots.admin) describe('admin', bots.admin);
  }
}
// createBot() registers the bot's api for the shared helpers; put the old one back after a failed swap.
function createBotRestore(role, old) { runtimeHooks.restoreApi?.(role, old); }
runtimeHooks.reloadBots = (roles) => bringUp(roles);

async function start() {
  // 1) restore state with the bot from the environment (the backup lives in its chat with the owner)
  const envBot = createBot({ role: 'admin' });
  const backup = envBot ? telegramBackupAdapter(envBot.api) : null;
  if (backup && config.telegramBackup) {
    store._backupWritesPaused = true;
    pauseAlnabaBatchIntake();
  }
  await store.init(backup, { deferSweep: !!(backup && config.telegramBackup) });
  // 2) apply hand-over overrides saved from the bot (owner / tokens / channel)
  applyProject(store.project);
  // One-time clean start requested by the owner: remove every alert (active and ended) from the map,
  // the local file and the Telegram backup. Runs once (marker saved in the backup); channel posts stay.
  const WIPE_ID = 'wipe-all-alerts-2026-10-23';
  if (startupMaintenanceEnabled && !store.state.maint?.[WIPE_ID]) {
    const n = store.deleteMany(() => true).length;
    store.state.maint = { ...(store.state.maint || {}), [WIPE_ID]: new Date().toISOString() };
    store.persist();
    store._writeLocal();
    await store.flushBackup();
    console.log(`[store] one-time wipe: removed ${n} alerts`);
  }

  const server = app.listen(config.port, () => console.log(`[web] listening on :${config.port}`));
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  // Deploy hand-off: the previous instance keeps answering for a few seconds after this one loaded
  // its data, then saves its final state to the backup as it stops. Pick up what it received.
  if (store.backup && config.telegramBackup) {
    const retryDelays = [60_000, 120_000, 300_000];
    let retryIndex = 0;
    let recovered = false;
    const recoverHandoff = async () => {
      if (recovered) return;
      try {
        if (typeof runtimeHooks.resumeAlnabaBatches !== 'function') throw new Error('bot recovery hook is not ready');
        const merge = await store.mergeFromBackup();
        if (!merge.backupLoaded) throw new Error('durable backup is not readable yet');
        store._backupWritesPaused = false;
        store.persist();
        const backupSaved = await store.flushBackup(true);
        if (!backupSaved || store._backupPending) throw new Error('merged durable backup save was not confirmed');
        // The merged state is durably saved; only now may the expiry sweep shrink it.
        store.beginSweeps();
        await runtimeHooks.resumeAlnabaBatches();
        recovered = true;
      } catch (error) {
        store._backupWritesPaused = true;
        pauseAlnabaBatchIntake();
        console.error('[alnaba] handoff recovery failed', error?.message || error);
        const delay = retryDelays[Math.min(retryIndex, retryDelays.length - 1)];
        retryIndex += 1;
        setTimeout(recoverHandoff, delay).unref();
      }
    };
    setTimeout(recoverHandoff, 20_000).unref();
    // Safety net: if hand-off recovery is still stuck after 5 minutes, start the sweeps
    // anyway so expired alerts do not linger on the map indefinitely.
    setTimeout(() => store.beginSweeps(), 300_000).unref();
  }

  if (!config.botToken) {
    console.warn('[bot] BOT_TOKEN missing — running website only');
    return;
  }
  const afterAdmin = async () => {
    const upReport = async (attempt = 1) => {
      try { await bringUp(['report']); } catch (e) {
        if (e.error_code === 401 && store.project.reportBotToken) {
          console.error('[report-bot] saved token rejected, falling back to env token');
          store.setProject({ reportBotToken: null }); applyProject(store.project);
          return upReport(attempt);
        }
        if (e.error_code === 401) return console.error('[report-bot] token rejected by Telegram');
        const wait = Math.min(300, 15 * attempt);
        console.warn(`[report-bot] init failed (${e.description || e.message}); retry in ${wait}s`);
        setTimeout(() => upReport(attempt + 1), wait * 1000).unref();
      }
    };
    upReport();
    startDailySummary(bots.admin.api);
    startWxBulletin(() => bots.admin?.api); // 🌤 morning weather bulletin (separate post, default 08:00)
    startPrices(() => bots.admin?.api); // 💱 morning prices bulletin (in-app scheduler, Damascus time)
    startServices(); // 🛣 road statuses expiry
    startQuakes(() => bots.admin?.api); // 🌍 earthquake alerts (EMSC + USGS, auto-posted)
    if (startupMaintenanceEnabled) {
    // one-time owner request (2026-10-25): 3 explosions published as "civil" -> "explosion" (edit posts in place)
    {
      const RT_ID = 'retype-explosion-2026-10-25';
      const RT_IDS = ['459b76e6-f4a8-4466-a929-deb3e75753a0', 'a3c2e253-8664-43c2-a06c-3f73b37d0277', '61f9bf0b-52ab-4517-a507-48d9e7a75d2e'];
      setTimeout(async () => {
        if (store.state.maint?.[RT_ID]) return;
        store.state.maint = { ...(store.state.maint || {}), [RT_ID]: { started: new Date().toISOString() } };
        store.persist();
        try {
          const res = await retypeAlerts(bots.admin.api, RT_IDS, 'explosion');
          store.state.maint[RT_ID] = { done: new Date().toISOString(), res };
          console.log('[retype] done', JSON.stringify(res));
        } catch (e) { console.error('[retype] failed', e.message); }
        store.persist();
        try { await store.flushBackup(); } catch { /* ignore */ }
      }, 200_000).unref();
    }
    // One-time owner-approved icon correction: change only this attack's map glyph and existing channel photo.
    {
      const GLYPH_ID = 'weapon-glyph-hawrat-ammurin-2026-10-27';
      const ALERT_ID = '1c96f12e-a894-4907-94e5-3e011c8611b7';
      const correctWeaponGlyph = async () => {
        if (store.state.maint?.[GLYPH_ID]?.done) return;
        const a = store.getAlert(ALERT_ID);
        if (!a || a.type !== 'attack' || a.channel_message_id !== 168 || a.channel_media !== 'photo'
          || a.place?.name_ar !== 'حورات عمورين' || !String(a.description || '').includes('شقيقين')) {
          console.error('[glyph] exact alert/photo guard failed; no change made');
          return;
        }
        try {
          const res = await retypeAlerts(bots.admin.api, [ALERT_ID], 'attack', { markerGlyph: 'weapon', gapMs: 0 });
          if (!res[0]?.ok || res[0]?.post !== 168) { console.error('[glyph] update failed', JSON.stringify(res)); return; }
          store.state.maint = { ...(store.state.maint || {}), [GLYPH_ID]: { done: new Date().toISOString(), res } };
          store.persist();
          await store.flushBackup(true);
          console.log('[glyph] updated exact alert and edited channel photo in place');
        } catch (e) { console.error('[glyph] update failed', e.description || e.message); }
      };
      setTimeout(() => resyncChannelPosts(bots.admin.api).then(async (n) => {
        console.log(`[bot] channel posts re-synced: ${n}`);
        await correctWeaponGlyph();
      }).catch((e) => console.warn('[bot] resync failed', e.message)), 20_000).unref();
    }
    }
    startNewsMonitor(); // 📡 Syrian news channels -> drafts for the owner (auto-published only in the owner's night window)
    startJobsMonitor(); // 💼 separate Syria jobs source -> owner approval -> website Jobs only
    startArmyMonitor(() => bots.admin?.api); // 🏛 official ministries -> owner approval -> website/map section only
    startTranslations(); // 🌐 English descriptions for /en/
  };
  const upAdmin = async (attempt = 1) => {
    try {
      await bringUp(['admin'], { admin: envBot });
      return afterAdmin();
    } catch (e) {
      // a token saved from the bot was rejected by Telegram (revoked): fall back to the environment's bot
      if (e.error_code === 401 && store.project.botToken) {
        console.error('[bot] saved publishing token rejected, falling back to env token');
        store.setProject({ botToken: null }); applyProject(store.project);
        return upAdmin(attempt);
      }
      // network hiccup / Telegram down: keep the website running and retry
      const wait = Math.min(300, 15 * attempt);
      console.error(`[bot] init failed (${e.description || e.message}); retry in ${wait}s`);
      setTimeout(() => upAdmin(attempt + 1), wait * 1000).unref();
    }
  };
  await upAdmin();
  // Keep the free Render instance awake (requests through the public URL count as traffic).
  if (config.keepAlive && config.publicUrl) {
    const ping = () => fetch(`${config.publicUrl}/api/health?src=self&t=${Date.now()}`, { signal: AbortSignal.timeout(30_000) })
      .catch((e) => console.error('[keep-alive] self-ping failed', e.message));
    setInterval(ping, 4 * 60_000).unref();
    setTimeout(ping, 30_000).unref();
  }
}

const shutdown = async () => {
  try { stopNewsMonitor(); } catch { /* ignore */ }
  try { stopJobsMonitor(); } catch { /* ignore */ }
  try { stopArmyMonitor(); } catch { /* ignore */ }
  try { await Promise.race([runtimeHooks.flushAlnabaBatches?.(), new Promise((r) => setTimeout(r, 20_000))]); } catch (e) { console.warn('alnaba batch shutdown flush failed', e?.message || e); }
  try { store._writeLocal(); } catch { /* ignore */ }
  try { await Promise.race([store.flushBackup(true), new Promise((r) => setTimeout(r, 5000))]); } catch { /* ignore */ }
  try { if (config.botMode !== 'webhook') { for (const b of Object.values(bots)) if (b) await b.stop(); } } catch { /* ignore */ }
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
