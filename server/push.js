import webpush from 'web-push';
import crypto from 'node:crypto';
import { matchesFollowArea } from '../shared/area-follow.js';
import { getGov, getPlace, placeKm } from './places.js';

const PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || '').trim();
const PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || '').trim();
const SUBJECT = String(process.env.VAPID_SUBJECT || 'mailto:admin@red-alert-syria.example').trim();
const configured = Boolean(PUBLIC_KEY && PRIVATE_KEY && SUBJECT);
if (configured) webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);

const endpointKey = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 40);
const validEndpoint = (endpoint) => typeof endpoint === 'string' && /^https:\/\//.test(endpoint) && endpoint.length <= 2048;
const validKeys = (keys) => keys && typeof keys.p256dh === 'string' && typeof keys.auth === 'string' && keys.p256dh.length <= 256 && keys.auth.length <= 256;

export const pushConfigured = configured;
export const pushPublicKey = configured ? PUBLIC_KEY : null;

export function sanitizeSubscription(input) {
  const s = input && typeof input === 'object' ? input : {};
  if (!validEndpoint(s.endpoint) || !validKeys(s.keys)) return null;
  return { endpoint: s.endpoint, expirationTime: s.expirationTime || null, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

export function sanitizeFollowArea(input) {
  const area = input && typeof input === 'object' ? input : {};
  if (area.type === 'governorate') {
    const governorate = getGov(String(area.code || ''));
    return governorate ? { type: 'governorate', code: governorate.code } : null;
  }
  if (area.type === 'place') {
    const place = getPlace(Number(area.placeId ?? area.id));
    return place ? { type: 'place', placeId: place.id } : null;
  }
  return null;
}

export function saveSubscription(store, input, preferences = {}) {
  const subscription = sanitizeSubscription(input);
  if (!subscription) return null;
  const id = endpointKey(subscription.endpoint);
  const types = Array.isArray(preferences.types) ? preferences.types.filter((x) => typeof x === 'string').slice(0, 80) : [];
  const governorate = typeof preferences.governorate === 'string' && /^[0-9]{2}$/.test(preferences.governorate) ? preferences.governorate : 'all';
  const followArea = sanitizeFollowArea(preferences.followArea);
  store.savePushSubscription(id, { ...subscription, types, governorate, followArea, lang: preferences.lang === 'en' ? 'en' : 'ar', updatedAt: Date.now() });
  return id;
}

export function removeSubscription(store, input) {
  const endpoint = typeof input === 'string' ? input : input?.endpoint;
  if (!validEndpoint(endpoint)) return false;
  return store.removePushSubscription(endpointKey(endpoint));
}

function matches(alert, sub) {
  if (Array.isArray(sub.types) && sub.types.length && !sub.types.includes(alert.type)) return false;
  if (sub.followArea) {
    const followArea = sub.followArea.type === 'governorate'
      ? (() => { const g = getGov(sub.followArea.code); return g && { type: 'governorate', code: g.code, name_ar: g.ar, name_en: g.en }; })()
      : sub.followArea.type === 'place'
        ? (() => { const p = getPlace(sub.followArea.placeId); return p && { type: 'place', placeId: p.id, code: p.gov, name_ar: p.ar, name_en: p.en, lat: p.lat, lon: p.lon, radiusKm: placeKm(p) }; })()
        : null;
    if (!followArea || !matchesFollowArea(alert, followArea)) return false;
  } else if (sub.governorate && sub.governorate !== 'all') {
    const places = [alert.place, ...(Array.isArray(alert.more) ? alert.more : [])];
    if (!places.some((p) => p?.governorate === sub.governorate || p?.governorate_code === sub.governorate)) return false;
  }
  return true;
}

export async function dispatchPush(store, alert, event = 'new', sendNotification) {
  if (!alert?.id || typeof sendNotification !== 'function') return { sent: 0, skipped: 0 };
  const title = event === 'update' ? '🔄 تحديث تنبيه — Red Alert Syria' : '🚨 تنبيه جديد — Red Alert Syria';
  const body = String(alert.title || alert.description || 'تنبيه جديد').slice(0, 240);
  const url = `/${alert.lang === 'en' ? 'en' : 'ar'}/#${encodeURIComponent(alert.id)}`;
  const payload = JSON.stringify({ title, body, tag: `ras-${alert.id}`, url, event, alertId: alert.id });
  let sent = 0; let skipped = 0;
  for (const [id, sub] of store.pushSubscriptions()) {
    if (!matches(alert, sub)) { skipped++; continue; }
    try {
      await sendNotification(sub, payload, { TTL: 300, urgency: event === 'new' ? 'high' : 'normal' });
      sent++;
    } catch (err) {
      if ([404, 410].includes(err.statusCode)) store.removePushSubscription(id);
      else console.warn('[push] delivery failed:', err.statusCode || err.message);
    }
  }
  return { sent, skipped };
}

export async function sendPush(store, alert, event = 'new') {
  if (!configured || !alert?.id) return { sent: 0, skipped: 0 };
  return dispatchPush(store, alert, event, webpush.sendNotification);
}
