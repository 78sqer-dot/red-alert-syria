import crypto from 'node:crypto';

function list(v) {
  return String(v || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';

// Derive a stable, non-guessable webhook secret from the bot token when none is provided.
const derivedSecret = token
  ? crypto.createHash('sha256').update('ras-webhook:' + token).digest('hex').slice(0, 48)
  : '';

const reportToken = process.env.REPORT_BOT_TOKEN || '';
const reportSecret = reportToken ? crypto.createHash('sha256').update('ras-report-webhook:' + reportToken).digest('hex').slice(0, 48) : '';
export const config = {
  reportBotToken: reportToken,
  reportWebhookSecret: process.env.REPORT_WEBHOOK_SECRET || reportSecret,
  port: Number(process.env.PORT || 3000),
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),
  botToken: token,
  botMode: (process.env.BOT_MODE || (process.env.RENDER ? 'webhook' : 'polling')).toLowerCase(),
  webhookSecret: process.env.WEBHOOK_SECRET || derivedSecret,
  channel: process.env.CHANNEL_ID || '@Red_Alert_Syria',
  channelUrl: process.env.CHANNEL_URL || 'https://t.me/Red_Alert_Syria',
  reportBotUsername: (process.env.REPORT_BOT_USERNAME || 'Rad_Alert_Syria1_bot').replace(/^@/, ''),
  ownerIds: list(process.env.OWNER_IDS || process.env.ADMIN_ID).map(Number).filter(Number.isFinite),
  dataDir: process.env.DATA_DIR || new URL('../data/runtime', import.meta.url).pathname,
  telegramBackup: process.env.TELEGRAM_BACKUP !== 'false',
  // channel posts as a map image (set ALERT_IMAGES=false to post text only)
  alertImages: process.env.ALERT_IMAGES !== 'false',
  keepAlive: process.env.KEEP_ALIVE ? process.env.KEEP_ALIVE !== 'false' : Boolean(process.env.RENDER),
  siteName: 'Red Alert Syria',
  timezone: 'Asia/Damascus',
  historyHours: Number(process.env.HISTORY_HOURS || 72),
  maxAlerts: Number(process.env.MAX_ALERTS || 1500),
};

export const isOwner = (id) => config.ownerIds.includes(Number(id));
// ---- project hand-over: runtime overrides (owner, bot tokens, channel) set from the bot.
const deriveSecret = (prefix, t) => (t ? crypto.createHash('sha256').update(prefix + t).digest('hex').slice(0, 48) : '');
export const envDefaults = Object.freeze({
  ownerIds: [...config.ownerIds],
  botToken: config.botToken,
  reportBotToken: config.reportBotToken,
  channel: config.channel,
  channelUrl: config.channelUrl,
  reportBotUsername: config.reportBotUsername,
});
// Apply saved overrides (or env defaults when a field is missing) to the live config object.
export function applyProject(p = {}) {
  const ownerId = Number(p.ownerId);
  config.ownerIds = Number.isFinite(ownerId) && ownerId > 0 ? [ownerId] : [...envDefaults.ownerIds];
  config.botToken = p.botToken || envDefaults.botToken;
  config.reportBotToken = p.reportBotToken || envDefaults.reportBotToken;
  config.channel = p.channel || envDefaults.channel;
  config.channelUrl = p.channelUrl || envDefaults.channelUrl;
  config.reportBotUsername = (p.reportBotUsername || envDefaults.reportBotUsername || '').replace(/^@/, '');
  config.webhookSecret = process.env.WEBHOOK_SECRET && config.botToken === envDefaults.botToken
    ? process.env.WEBHOOK_SECRET : deriveSecret('ras-webhook:', config.botToken);
  config.reportWebhookSecret = process.env.REPORT_WEBHOOK_SECRET && config.reportBotToken === envDefaults.reportBotToken
    ? process.env.REPORT_WEBHOOK_SECRET : deriveSecret('ras-report-webhook:', config.reportBotToken);
}
