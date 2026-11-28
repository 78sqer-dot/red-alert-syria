import crypto from 'node:crypto';
import { publicAlert } from './store.js';
import { publishedRepairRevision } from './approved-public-correction.js';
export const CONTEXT_1660_ID = '8808dd35-297c-4fd1-a677-ad55b59f7f60';
export const CONTEXT_1660_KEY = 'context-1660-2026-11-28';
const EXPECTED = 'c7108f8e8b906f050890422b25fd50897ba6792432a10cc959097a70c509fa3d';
const DRAFT = '7a9015e0f2';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function context1660Candidate(a, d, now = Date.now()) {
  if (!a || a.id !== CONTEXT_1660_ID || a.channel_message_id !== 1660 || a.channel_media !== 'text'
    || a.channel_delivery?.status !== 'confirmed' || !a.is_active || !(Date.parse(a.expires_at) > now)
    || publishedRepairRevision(a) !== EXPECTED || d?.id !== DRAFT || d.status !== 'published'
    || d.alertId !== a.id || d.postId !== 1660 || d.sourceText !== a.meta?.sourceText
    || !d.srcs?.some(s => s.url === 'https://t.me/D24net/48610')
    || d.extra?.length !== 1 || d.extra[0].place_id !== 163434) return null;
  return { ...a, title: 'تنبيه مدني — أم الكيف', title_en: 'Civil alert — Um Elkeif', extra: [], areas: a.areas.filter(x => x !== a.extra[0].name_ar) };
}
// Preparation only. No bot import, Telegram calls, or startup wiring.
// maintenance-update needs a dedicated SSE-only listener before adoption.
// Any durable claim (including a crash between state writes) blocks automatic
// retry. An operator must inspect actual Telegram + current state + backup.
export async function runContext1660Correction({ store, now = Date.now }) {
  const prior = store.state.maint?.[CONTEXT_1660_KEY];
  if (prior) return { skipped: true, state: prior.state, needsInspection: prior.state !== 'done' };
  const read = () => ({ a: store.getAlert(CONTEXT_1660_ID), d: store.state.news?.drafts?.[DRAFT], c: store.state.news?.alerts?.find(x => x.id === CONTEXT_1660_ID) });
  const before = read(), candidate = context1660Candidate(before.a, before.d, now());
  if (!candidate || hash(before.d) !== 'b3ee73bb5a9bc1433ff469a4c8f0391e9b993bd59841614a4618908aed637ee8' || hash(before.c) !== '425cf1df8934f3c30671577d20313ddfc2c60ad35d28f7f5f64450f5c3e9459b') return { skipped: true, reason: 'exact-revision-guard' };
  const baseline = hash(before);
  const durable = async () => {
    store.persist(); store._backupPending = true;
    try { return store.backup ? !!await store.flushBackup(true) : false; } catch { return false; }
  };
  const marker = { state: 'claimed', at: new Date(now()).toISOString(), post: 1660, expected: EXPECTED };
  (store.state.maint ||= {})[CONTEXT_1660_KEY] = marker;
  if (!await durable()) return { ok: false, state: 'claim-backup-unverified', needsInspection: true };
  if (hash(read()) !== baseline || !context1660Candidate(read().a, read().d, now())) {
    marker.state = 'revision-conflict'; await durable(); return { ok: false, state: marker.state, needsInspection: true };
  }
  // State/map only. Never call Telegram, edit its text/markup, or publish.
  // Keep the durable claim through any crash between these synchronous writes.
  Object.assign(before.a, { title: candidate.title, title_en: candidate.title_en, extra: [], areas: candidate.areas });
  store._history(before.a, 'updated');
  store.persist();
  before.d.extra = [];
  // Existing cache contains duplicated primary points. Remove only the exact
  // contextual town coordinates/name, retaining every unrelated cache field.
  before.c.headline = [candidate.title, candidate.description].filter(Boolean).join(' ');
  const oldContext = { latitude: 36.65556, longitude: 40.37079 };
  if (oldContext && before.c.geo?.pts) before.c.geo.pts = before.c.geo.pts.filter(p => !(p.lat === oldContext.latitude && p.lon === oldContext.longitude));
  // where/administrative arrays describe locations, regenerate from retained
  // original components rather than deduplicate or rewrite unrelated data.
  before.c.where = before.c.where?.split(' + ').filter(part => !part.startsWith('تل تمر،')).join(' + ');
  if (before.c.geo?.dists?.length === 2) before.c.geo.dists = before.c.geo.dists.slice(0, 1);
  if (before.c.geo?.govs?.length === 2) before.c.geo.govs = before.c.geo.govs.slice(0, 1);
  marker.state = 'done'; marker.done = new Date(now()).toISOString();
  if (!await durable()) return { ok: false, state: 'final-backup-unverified', needsInspection: true };
  store.emit('maintenance-update', publicAlert(before.a));
  return { ok: true, state: 'done', post: 1660, id: CONTEXT_1660_ID };
}
