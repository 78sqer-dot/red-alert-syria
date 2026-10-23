import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { webhookCallback } from 'grammy';
import { config } from './config.js';
import { store, publicAlert } from './store.js';
import { createBot, telegramBackupAdapter, BOT_COMMANDS } from './bot.js';
import { governorates } from './places.js';

const ROOT = new URL('..', import.meta.url).pathname;
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');

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
const bot = createBot();
const webhookPath = config.webhookSecret ? `/tg/${config.webhookSecret.slice(0, 24)}` : null;
if (bot && webhookPath) {
  app.post(webhookPath, express.json({ limit: '1mb' }), webhookCallback(bot, 'express', { secretToken: config.webhookSecret, onTimeout: 'return', timeoutMilliseconds: 9000 }));
}

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
  res.json({ alerts: list, server_time: new Date().toISOString() });
});

app.get('/api/alerts/:id', apiLimiter, (req, res) => {
  if (!/^[\w-]{36}$/.test(req.params.id)) return res.status(400).json({ error: 'bad id' });
  const a = store.getAlert(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  res.json({ alert: publicAlert(a) });
});

app.get('/api/meta', apiLimiter, (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({ governorates: governorates.map(({ code, ar, en, lat, lon }) => ({ code, ar, en, lat, lon })), channel: config.channelUrl, bot: botUsername ? `https://t.me/${botUsername}` : null });
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
  res.write(`event: snapshot\ndata: ${JSON.stringify({ alerts: store.recentAlerts().map(publicAlert), server_time: new Date().toISOString() })}\n\n`);
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
setInterval(() => {
  for (const c of clients) c.write(`: ping ${Date.now()}\n\n`);
}, 25_000).unref();

// ------------------------------------------------------------------ static site
const longCache = { maxAge: '30d', immutable: true };
app.use('/vendor', express.static(path.join(PUBLIC, 'vendor'), longCache));
app.use('/fonts', express.static(path.join(PUBLIC, 'fonts'), longCache));
app.use('/shared', express.static(SHARED, { maxAge: '1h' }));
app.use(express.static(PUBLIC, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('.html') || p.endsWith('sw.js') || p.endsWith('.webmanifest')) res.setHeader('Cache-Control', 'no-cache'); } }));

const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
function renderIndex(lang) {
  const url = config.publicUrl || '';
  return indexHtml
    .replaceAll('{{LANG}}', lang)
    .replaceAll('{{DIR}}', lang === 'ar' ? 'rtl' : 'ltr')
    .replaceAll('{{URL}}', url)
    .replaceAll('{{TITLE}}', lang === 'ar' ? 'الإنذار الأحمر سوريا — خريطة سوريا المباشرة للتنبيهات لحظةً بلحظة' : 'Red Alert Syria — Live map of alerts across Syria')
    .replaceAll('{{DESC}}', lang === 'ar' ? 'خريطة تفاعلية مباشرة لتنبيهات المسيّرات والطيران الحربي والصواريخ والقصف في سوريا، تُحدَّث لحظةً بلحظة. مجاني، بدون تطبيق، للجميع.' : 'Real-time interactive map of drone, warplane, missile and shelling alerts across Syria. Free, no app, for everyone.');
}
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
let botUsername = null;
async function start() {
  const backup = bot ? telegramBackupAdapter(bot.api) : null;
  await store.init(backup);

  const server = app.listen(config.port, () => console.log(`[web] listening on :${config.port}`));
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  if (!bot) {
    console.warn('[bot] BOT_TOKEN missing — running website only');
    return;
  }
  await bot.init();
  botUsername = bot.botInfo.username;
  console.log(`[bot] @${botUsername} ready (${config.botMode})`);
  try {
    await bot.api.setMyCommands(BOT_COMMANDS.ar);
    await bot.api.setMyCommands(BOT_COMMANDS.en, { language_code: 'en' });
    await bot.api.setMyDescription('🔴 بوت Red Alert Syria — نشر التنبيهات العاجلة في القناة وعلى الخريطة التفاعلية المباشرة لسوريا.\n\nRed Alert Syria — live alerts for Syria: channel + interactive map.');
    await bot.api.setMyShortDescription('الإنذار الأحمر سوريا — تنبيهات لحظية على القناة والخريطة المباشرة.');
  } catch (e) {
    console.warn('[bot] could not set commands', e.description || e.message);
  }

  if (config.botMode === 'webhook' && config.publicUrl) {
    const url = config.publicUrl + webhookPath;
    await bot.api.setWebhook(url, { secret_token: config.webhookSecret, allowed_updates: ['message', 'callback_query'], max_connections: 20 });
    console.log('[bot] webhook set');
  } else {
    await bot.api.deleteWebhook();
    bot.start({ allowed_updates: ['message', 'callback_query'], onStart: () => console.log('[bot] long polling started') });
  }

  // Keep the free Render instance awake (requests through the public URL count as traffic).
  if (config.keepAlive && config.publicUrl) {
    setInterval(() => {
      fetch(config.publicUrl + '/api/health').catch(() => {});
    }, 9 * 60_000).unref();
  }
}

const shutdown = async () => {
  try { store._writeLocal(); } catch { /* ignore */ }
  try { await Promise.race([store.flushBackup(), new Promise((r) => setTimeout(r, 5000))]); } catch { /* ignore */ }
  try { if (bot && config.botMode !== 'webhook') await bot.stop(); } catch { /* ignore */ }
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
