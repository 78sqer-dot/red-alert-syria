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
import { startNewsMonitor, stopNewsMonitor, newsDebug, sendTestDraft } from './news-monitor.js';
import { createBot, imageTest, resyncChannelPosts, startDailySummary, telegramBackupAdapter, BOT_COMMANDS, REPORT_COMMANDS, botInfo, runtimeHooks } from './bot.js';
import { applyProject } from './config.js';
import { governorates } from './places.js';

const ROOT = new URL('..', import.meta.url).pathname;
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');

const ADMIN_DESC = '🔒 بوت النشر الخاص بإدارة Red Alert Syria (للمشرفين فقط).';
const ADMIN_SHORT = 'بوت النشر الخاص — Red Alert Syria';
const REPORT_DESC = '📨 بوت التبليغ الخاص بـ Red Alert Syria — الإنذار الأحمر سوريا.\n\nأبلغ عن مسيّرة، طيران حربي، قصف مدفعي، هجوم، صواريخ أو حدث مدني في منطقتك. يصل بلاغك إلى الإدارة ويُنشر على القناة والخريطة بعد التحقق.\n\nReport drones, warplanes, shelling, attacks, missiles or civil events in Syria.';
const REPORT_SHORT = 'أرسل بلاغاً عن حدث في سوريا — Red Alert Syria';
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ------------------------------------------------------------------ security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'wasm-unsafe-eval'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:', 'https://tiles.openfreemap.org', 'https://server.arcgisonline.com', 'https://elevation-tiles-prod.s3.amazonaws.com'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'", 'https://tiles.openfreemap.org', 'https://server.arcgisonline.com', 'https://elevation-tiles-prod.s3.amazonaws.com'],
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

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()), active: store.activeAlerts().length, clients: clients.size }));

app.get('/api/alerts', apiLimiter, (req, res) => {
  const includeInactive = req.query.include === 'inactive' || req.query.all === '1';
  const list = (includeInactive ? store.recentAlerts() : store.activeAlerts()).map(publicAlert);
  res.json({ alerts: list, history_hours: store.historyWindow, server_time: new Date().toISOString() });
});

app.get('/api/alerts/:id', apiLimiter, (req, res) => {
  if (!/^[\w-]{36}$/.test(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const a = store.getAlert(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  res.json({ alert: publicAlert(a) });
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
  res.write(`event: snapshot\ndata: ${JSON.stringify({ alerts: store.recentAlerts().map(publicAlert), history_hours: store.historyWindow, server_time: new Date().toISOString(), build: BUILD, contacts: store.publicContacts })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
const broadcast = (event, data) => {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
};
store.on('alert', (a) => broadcast('alert', a));
store.on('update', (a) => broadcast('update', a));
store.on('remove', (a) => broadcast('remove', a));
store.on('contacts', (c) => broadcast('contacts', c)); // website contact links change instantly
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
const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(/\?v=\d+/g, `?v=${BUILD}`);
function renderIndex(lang) {
  const url = config.publicUrl || '';
  return indexHtml
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
app.use((req, res) => res.status(404).type('text').send('Not found'));

// ------------------------------------------------------------------ start
const UPD = ['message', 'callback_query'];
const secretOf = (role) => (role === 'admin' ? config.webhookSecret : config.reportWebhookSecret);
const tokenOf = (role) => (role === 'admin' ? config.botToken : config.reportBotToken);
async function describe(role, b) {
  try {
    if (role === 'admin') {
      await b.api.setMyCommands(BOT_COMMANDS.ar);
      await b.api.setMyCommands(BOT_COMMANDS.en, { language_code: 'en' });
      await b.api.setMyDescription(ADMIN_DESC + (botInfo.report ? `\n\nلإرسال بلاغ: @${botInfo.report}` : ''));
      await b.api.setMyShortDescription(ADMIN_SHORT + (botInfo.report ? ` · للبلاغات: @${botInfo.report}` : ''));
    } else {
      await b.api.setMyCommands(REPORT_COMMANDS.ar);
      await b.api.setMyCommands(REPORT_COMMANDS.en, { language_code: 'en' });
      await b.api.setMyDescription(REPORT_DESC);
      await b.api.setMyShortDescription(REPORT_SHORT);
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
  await store.init(backup);
  // 2) apply hand-over overrides saved from the bot (owner / tokens / channel)
  applyProject(store.project);
  // One-time clean start requested by the owner: remove every alert (active and ended) from the map,
  // the local file and the Telegram backup. Runs once (marker saved in the backup); channel posts stay.
  const WIPE_ID = 'wipe-all-alerts-2026-10-23';
  if (!store.state.maint?.[WIPE_ID]) {
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
    for (const sec of [20, 60, 180]) setTimeout(() => store.mergeFromBackup().catch(() => {}), sec * 1000).unref();
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
    startNewsMonitor(); // 📡 Syrian news channels -> drafts for the owner (never auto-published)
    setTimeout(() => resyncChannelPosts(bots.admin.api).then((n) => console.log(`[bot] channel posts re-synced: ${n}`)).catch((e) => console.warn('[bot] resync failed', e.message)), 20_000).unref();
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
