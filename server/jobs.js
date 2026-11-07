import crypto from 'node:crypto';
import { InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { store } from './store.js';
import { fetchChannel } from './news-sources.js';
import { governorates, places, districtsOf, placesOf, getGov, getDist, getPlace, normalizeArabic } from './places.js';
import { cleanMenuMessages } from './ui-clean.js';

export const JOB_SOURCE = Object.freeze({ u: 'syrian_jobb', name: 'وظائف سوريا', url: 'https://t.me/syrian_jobb' });
const POLL_MS = 60_000;
const MAX_SOURCE_AGE = 30 * 86400_000;
const INTAKE_AGE = 30 * 60_000;
const MAX_JOB_TEXT = 3600;
const MAX_INTAKE_TEXT = 2000;
const JOB_TERMS = /(?:وظيف|فرص[هة]?\s*عمل|شاغر|شواغر|توظيف|تعيين|مطلوب\s+(?:[\p{L}]{3,})(?:\s+[\p{L}]{3,})?|vacanc(?:y|ies)|hiring|job\s+openings?|employment|career\s+opportunit(?:y|ies))/iu;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let active = false;
let timer = null;
let running = false;
let adminApi = null;
let helpers = null;

export function initialJobsState() {
  return {
    source: { u: JOB_SOURCE.u, name: JOB_SOURCE.name, on: true, initialized: false, lastId: null, updatedAt: 0, lastCheck: null, lastError: null },
    pending: {}, published: {}, decisions: {}, deleted: {}, seen: {}, fingerprints: {}, intake: {},
    customGovernorates: [], customAreas: [], adminDrafts: {},
  };
}

export function jobsState(root = store.state) {
  root.jobs ||= initialJobsState();
  const j = root.jobs;
  j.source ||= {};
  j.source.u = JOB_SOURCE.u;
  j.source.name = JOB_SOURCE.name;
  if (typeof j.source.on !== 'boolean') j.source.on = true;
  if (typeof j.source.initialized !== 'boolean') j.source.initialized = false;
  if (!Number.isFinite(Number(j.source.lastId))) j.source.lastId = null;
  j.source.updatedAt = Number(j.source.updatedAt) || 0;
  j.pending = j.pending && typeof j.pending === 'object' ? j.pending : {};
  j.published = j.published && typeof j.published === 'object' ? j.published : {};
  j.decisions = j.decisions && typeof j.decisions === 'object' ? j.decisions : {};
  j.deleted = j.deleted && typeof j.deleted === 'object' ? j.deleted : {};
  j.seen = j.seen && typeof j.seen === 'object' ? j.seen : {};
  j.fingerprints = j.fingerprints && typeof j.fingerprints === 'object' ? j.fingerprints : {};
  j.intake = j.intake && typeof j.intake === 'object' ? j.intake : {};
  j.customGovernorates = Array.isArray(j.customGovernorates) ? j.customGovernorates : [];
  j.customAreas = Array.isArray(j.customAreas) ? j.customAreas : [];
  j.adminDrafts = j.adminDrafts && typeof j.adminDrafts === 'object' ? j.adminDrafts : {};
  return j;
}

export function jobFingerprint(text) {
  const norm = normalizeArabic(String(text || '').replace(/https?:\/\/\S+/gi, ' '));
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 24);
}

export function isJobPost(text) { return JOB_TERMS.test(String(text || '')); }

const SYRIA_PLACE_KEYS = [...new Set([
  ...governorates.flatMap((g) => [g.ar, g.en]),
  ...places.flatMap((p) => [p.ar, p.en, ...(p.alt || [])]),
].map((x) => normalizeArabic(x)).filter((x) => x.length >= 3))].sort((a, b) => b.length - a.length);
export function hasSyrianLocation(text) {
  const original = String(text || '');
  if (/\b(?:syria|syrian|damascus|aleppo|homs|hama|idlib|latakia|tartous|tartus|daraa|raqqa|hasakah|hasaka|quneitra|deir\s+ez\s+zor)\b/i.test(original)) return true;
  const n = ` ${normalizeArabic(original)} `;
  if (['سوريا', 'سوريه', 'الجمهوريه العربيه السوريه'].some((name) => n.includes(` ${normalizeArabic(name)} `))) return true;
  const tokens = n.trim().split(/\s+/);
  return SYRIA_PLACE_KEYS.some((name) => n.includes(` ${name} `) || (!name.includes(' ') && tokens.some((token) => {
    let value = token.replace(/^(?:ب|ل|و|ف|ك)/u, '');
    if (value.startsWith('ال') && value.length > 4) value = value.slice(2);
    const bareName = name.startsWith('ال') && name.length > 4 ? name.slice(2) : name;
    return value === name || value === bareName;
  })));
}

export function locationForGovernorate(code, j = jobsState()) {
  const gov = getGov(String(code || ''));
  const custom = !gov && j.customGovernorates.find((row) => row.code === String(code || ''));
  const selected = gov || custom;
  if (!selected) return null;
  return {
    scope: 'governorate', governorate_code: selected.code, governorate_ar: selected.ar, governorate_en: selected.en || '',
    district_code: null, district_ar: '', district_en: '', place_id: null, place_ar: '', place_en: '',
    ...(custom ? { custom: true, custom_governorate: true } : {}),
    label_ar: selected.ar, label_en: selected.en || selected.ar,
  };
}
export function locationForDistrict(code, j = jobsState()) {
  const district = getDist(String(code || ''));
  if (district) {
    const gov = getGov(district.gov);
    if (!gov) return null;
    return {
      scope: 'district', governorate_code: gov.code, governorate_ar: gov.ar, governorate_en: gov.en,
      district_code: district.code, district_ar: district.ar, district_en: district.en || '', place_id: null, place_ar: '', place_en: '',
      label_ar: [district.ar, gov.ar].filter(Boolean).join('، '), label_en: [district.en || district.ar, gov.en].filter(Boolean).join(', '),
    };
  }
  const area = j.customAreas.find((row) => row.code === String(code || ''));
  if (!area) return null;
  const gov = getGov(area.governorate_code) || j.customGovernorates.find((row) => row.code === area.governorate_code);
  if (!gov) return null;
  return {
    scope: 'district', governorate_code: gov.code, governorate_ar: gov.ar, governorate_en: gov.en || '',
    district_code: area.code, district_ar: area.ar, district_en: area.en || '', place_id: null, place_ar: '', place_en: '',
    custom: true, custom_area: true,
    label_ar: [area.ar, gov.ar].filter(Boolean).join('، '), label_en: [area.en || area.ar, gov.en || gov.ar].filter(Boolean).join(', '),
  };
}
export function locationForPlace(placeId, expectedGov = null) {
  const place = getPlace(Number(placeId));
  if (!place || (expectedGov != null && String(place.gov) !== String(expectedGov))) return null;
  const gov = getGov(place.gov); const district = getDist(place.dist);
  if (!gov) return null;
  return {
    scope: 'place', governorate_code: gov.code, governorate_ar: gov.ar, governorate_en: gov.en,
    district_code: district?.code || null, district_ar: district?.ar || '', district_en: district?.en || '',
    place_id: place.id, place_ar: place.ar, place_en: place.en || '',
    label_ar: [place.ar, district?.ar, gov.ar].filter(Boolean).join('، '),
    label_en: [place.en || place.ar, district?.en, gov.en].filter(Boolean).join(', '),
  };
}
export function normalizeJobLocation(location, j = jobsState()) {
  if (!location || typeof location !== 'object') return null;
  if (location.place_id) return locationForPlace(location.place_id, location.governorate_code);
  if (location.custom_area || location.custom_area_code) return locationForDistrict(location.custom_area_code || location.district_code, j);
  if (location.custom_governorate || location.custom_governorate_code) return locationForGovernorate(location.custom_governorate_code || location.governorate_code, j);
  if (location.scope === 'district' && location.district_code) return locationForDistrict(location.district_code, j);
  return locationForGovernorate(location.governorate_code, j);
}

const cleanLocationName = (value) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
const freshCode = (prefix) => `${prefix}${crypto.randomBytes(4).toString('hex')}`;
export function addCustomGovernorate(input, j = jobsState(), now = Date.now()) {
  const ar = cleanLocationName(input?.ar); const en = cleanLocationName(input?.en);
  if (!ar) return { ok: false, error: 'name_required' };
  if (j.customGovernorates.length >= 50) return { ok: false, error: 'limit' };
  if ([...governorates, ...j.customGovernorates].some((row) => normalizeArabic(row.ar) === normalizeArabic(ar))) return { ok: false, error: 'duplicate' };
  const row = { code: freshCode('x'), ar, en, createdAt: now };
  j.customGovernorates.push(row);
  return { ok: true, row };
}
export function addCustomArea(governorateCode, input, j = jobsState(), now = Date.now()) {
  const code = String(governorateCode || '');
  const gov = getGov(code) || j.customGovernorates.find((row) => row.code === code);
  const ar = cleanLocationName(input?.ar); const en = cleanLocationName(input?.en);
  if (!gov) return { ok: false, error: 'governorate_required' };
  if (!ar) return { ok: false, error: 'name_required' };
  if (j.customAreas.length >= 300) return { ok: false, error: 'limit' };
  const existing = [...districtsOf(code), ...j.customAreas.filter((row) => row.governorate_code === code)];
  if (existing.some((row) => normalizeArabic(row.ar) === normalizeArabic(ar))) return { ok: false, error: 'duplicate' };
  const row = { code: freshCode('a'), governorate_code: code, ar, en, createdAt: now };
  j.customAreas.push(row);
  return { ok: true, row };
}

function safeLinks(links = []) {
  const out = [];
  for (const raw of links) {
    const u = String(raw || '').trim().replace(/&amp;/g, '&');
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s<>]*)?$/i.test(u)) continue;
    if (!out.includes(u)) out.push(u);
  }
  return out.slice(0, 8);
}
function linksFromText(text) { return safeLinks(String(text || '').match(/https:\/\/[^\s<>()[\]{}]+/gi) || []); }
const JOB_CHANNEL_PROMO = /[@#]\s*syrian[_\s-]?jo[b]+\b[#]?/giu;
const JOB_HASHTAG = /#(?:[\p{L}\p{N}\p{M}_]+)/gu;
const JOB_HASHTAG_ONLY_LINE = /^(?:\s*#[\p{L}\p{N}\p{M}_]+\s*)+$/u;
const JOB_PROMO_LINE = /(?:لنشر|للنشر).{0,90}(?:راسلونا|تواصلوا|اتصلوا).{0,30}(?:دايركت|مباشرة|direct|dm)|(?:for\s+(?:posting|publishing|sharing)|to\s+(?:post|publish|advertise)).{0,70}(?:jobs?|vacanc\w*).{0,60}(?:dm|direct|message|contact)|(?:للاعلان|للإعلان|للترويج|تابعونا|اشتركوا|انضموا.{0,30}(?:قناة|تيليجرام)|لمزيد من (?:(?:فرص|فرصة)\s+عمل|الفرص|الوظائف|الاعلانات|الإعلانات)|follow us|join\s+(?:our\s+)?(?:channel|telegram))/iu;
const JOB_ARROW_LINE = /^[\s🔻🔽👇⬇️⬇︎▼▾↓]+$/u;
export function cleanJobText(value) {
  const urls = [];
  const protectedText = String(value || '').replace(/https?:\/\/[^\s<>]+/gi, (url) => `\uE000${urls.push(url) - 1}\uE001`);
  const cleaned = protectedText.replace(/\r/g, '').split('\n').map((line) => {
    const withoutChannel = line.replace(JOB_CHANNEL_PROMO, ' ').trim();
    if (JOB_HASHTAG_ONLY_LINE.test(withoutChannel)) return '';
    return withoutChannel.replace(JOB_HASHTAG, (tag) => ` ${tag.slice(1).replace(/_/g, ' ')} `).replace(/[ \t]{2,}/g, ' ').replace(/^[\s|·•–—-]+|[\s|·•–—-]+$/g, '').trim();
  })
    .filter((line) => line && !JOB_PROMO_LINE.test(line) && !JOB_ARROW_LINE.test(line))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned.replace(/\uE000(\d+)\uE001/g, (_, index) => urls[Number(index)] || '');
}
function titleFromText(text) {
  const line = cleanJobText(text).split(/\r?\n/).map((x) => x.trim()).find(Boolean) || 'فرصة عمل';
  return line.replace(/<[^>]*>/g, '').slice(0, 120);
}

export function createPendingJob(input, j = jobsState(), now = Date.now()) {
  const text = cleanJobText(input?.text).slice(0, MAX_JOB_TEXT);
  if (!text) return { duplicate: false, job: null, error: 'empty' };
  const location = normalizeJobLocation(input.location, j);
  const baseFingerprint = jobFingerprint(text);
  const fp = location
    ? crypto.createHash('sha256').update(`${baseFingerprint}:${location.governorate_code}:${location.place_id || location.district_code || 'governorate'}`).digest('hex').slice(0, 24)
    : baseFingerprint;
  const sourceKey = String(input.sourceKey || `${input.kind || 'source'}:${fp}`).slice(0, 160);
  if (j.seen[sourceKey]) return { duplicate: true, job: null, duplicateOf: j.seen[sourceKey].id || null };
  const prior = j.fingerprints[fp];
  if (prior) {
    j.seen[sourceKey] = { status: 'duplicate', id: prior.id || null, fingerprint: fp, at: now };
    return { duplicate: true, job: null, duplicateOf: prior.id || null };
  }
  // Deterministic across overlapping Render instances: callbacks remain idempotent after a deploy.
  const id = crypto.createHash('sha256').update(sourceKey).digest('hex').slice(0, 14);
  const kind = input.kind === 'employer' ? 'employer' : input.kind === 'manual' ? 'manual' : 'source';
  const title = cleanJobText(input.title).replace(/\s+/g, ' ').trim() || titleFromText(text);
  const job = {
    id, kind, sourceKey, fingerprint: fp,
    title: title.slice(0, 120) || 'فرصة عمل',
    text,
    sourceName: String(input.sourceName || (kind === 'source' ? JOB_SOURCE.name : kind === 'manual' ? 'إضافة الإدارة' : 'طلب صاحب عمل')).slice(0, 80),
    sourceUrl: /^https:\/\//i.test(String(input.sourceUrl || '')) ? String(input.sourceUrl).slice(0, 500) : '',
    links: safeLinks(input.links || linksFromText(text)),
    location,
    createdAt: now,
    status: 'pending',
    notifiedAt: null,
    cards: [],
    ...(input.submitter && Number.isFinite(Number(input.submitter.id)) ? { submitter: {
      id: Number(input.submitter.id),
      username: String(input.submitter.username || '').slice(0, 64),
      name: String(input.submitter.name || '').slice(0, 100),
    } } : {}),
  };
  j.pending[id] = job;
  j.seen[sourceKey] = { status: 'pending', id, fingerprint: fp, at: now };
  j.fingerprints[fp] = { status: 'pending', id, at: now };
  return { duplicate: false, job };
}

export function decideJob(id, action, j = jobsState(), by = null, now = Date.now()) {
  const job = j.pending[id];
  if (!job) return { ok: false, job: null, decision: j.decisions[id] || null };
  const outcome = action === 'approve' ? 'approved' : action === 'ignore' ? 'ignored' : null;
  if (!outcome) return { ok: false, job: null, decision: null };
  if (outcome === 'approved') {
    const location = normalizeJobLocation(job.location, j);
    if (!location) return { ok: false, job: null, decision: null, error: 'location_required' };
    job.location = location;
  }
  delete j.pending[id];
  job.status = outcome;
  job.decidedAt = now;
  if (by != null) job.decidedBy = Number(by) || null;
  const decision = { id, action: outcome, decidedAt: now, fingerprint: job.fingerprint, sourceKey: job.sourceKey };
  j.decisions[id] = decision;
  if (outcome === 'approved') { job.publishedAt = new Date(now).toISOString(); j.published[id] = job; }
  else delete j.published[id];
  if (j.seen[job.sourceKey]) j.seen[job.sourceKey] = { ...j.seen[job.sourceKey], status: outcome, id, at: now };
  if (j.fingerprints[job.fingerprint]) j.fingerprints[job.fingerprint] = { ...j.fingerprints[job.fingerprint], status: outcome, id, at: now };
  return { ok: true, job, decision };
}

export function updatePublishedJob(id, patch, j = jobsState(), by = null, now = Date.now()) {
  const job = j.published[id];
  if (!job || job.status !== 'approved' || j.deleted[id]) return { ok: false, error: 'not_found' };
  if (patch.title !== undefined) {
    const title = cleanJobText(patch.title).replace(/\s+/g, ' ').trim();
    if (!title) return { ok: false, error: 'title_required' };
    job.title = title.slice(0, 120);
  }
  if (patch.text !== undefined) {
    const text = cleanJobText(String(patch.text || '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')).slice(0, MAX_JOB_TEXT);
    if (text.length < 10) return { ok: false, error: 'text_too_short' };
    job.text = text;
    job.links = safeLinks(patch.links || linksFromText(text));
  }
  if (patch.location !== undefined) {
    const location = normalizeJobLocation(patch.location, j);
    if (!location) return { ok: false, error: 'location_required' };
    job.location = location;
  }
  job.updatedAt = now;
  if (by != null) job.updatedBy = Number(by) || null;
  return { ok: true, job };
}

export function deleteJobListing(id, j = jobsState(), by = null, now = Date.now()) {
  const job = j.pending[id] || j.published[id];
  if (!job || j.deleted[id]) return { ok: false, job: null };
  delete j.pending[id];
  delete j.published[id];
  const tombstone = { id, action: 'deleted', deletedAt: now, deletedBy: by == null ? null : Number(by) || null, fingerprint: job.fingerprint, sourceKey: job.sourceKey };
  j.deleted[id] = tombstone;
  j.decisions[id] = { id, action: 'deleted', decidedAt: now, decidedBy: tombstone.deletedBy, fingerprint: job.fingerprint, sourceKey: job.sourceKey };
  if (job.sourceKey && j.seen[job.sourceKey]) j.seen[job.sourceKey] = { ...j.seen[job.sourceKey], status: 'deleted', id, at: now };
  if (job.fingerprint && j.fingerprints[job.fingerprint]) j.fingerprints[job.fingerprint] = { ...j.fingerprints[job.fingerprint], status: 'deleted', id, at: now };
  return { ok: true, job, tombstone };
}

export function publicJobs(j = jobsState()) {
  return Object.values(j.published || {}).filter((x) => x && x.status === 'approved' && !j.deleted?.[x.id] && normalizeJobLocation(x.location, j))
    .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0)).slice(0, 100)
    .map((x) => {
      const text = cleanJobText(x.text);
      const title = cleanJobText(x.title).replace(/\s+/g, ' ').trim() || titleFromText(text);
      return {
      id: x.id, title, text, links: safeLinks(x.links || []),
      source_name: x.sourceName, source_url: x.sourceUrl || '',
      location: normalizeJobLocation(x.location, j),
      published_at: x.publishedAt || null,
      };
    });
}

function saveJobs({ broadcast = false, backupSoon = true } = {}) {
  store.persist({ backupSoon });
  if (broadcast) store.emit('jobs', publicJobs());
}
let intakeMergeAt = 0;
async function mergeJobBackup(force = false) {
  if (!store.backup || !config.telegramBackup) return;
  if (!force && Date.now() - intakeMergeAt < 5_000) return;
  await store.mergeFromBackup().catch(() => {});
  intakeMergeAt = Date.now();
}

function reviewText(job, lang = 'ar') {
  const ar = lang !== 'en';
  const heading = job.kind === 'source'
    ? (ar ? '📡 إعلان مرصود من قناة الوظائف السورية' : '📡 Monitored post from the Syrian jobs channel')
    : (ar ? '🏢 طلب نشر وظيفة من صاحب عمل' : '🏢 Vacancy submission from an employer');
  const origin = job.kind === 'source'
    ? `${ar ? 'المصدر' : 'Source'}: <a href="${esc(job.sourceUrl || JOB_SOURCE.url)}">@${esc(JOB_SOURCE.u)}</a>`
    : `${ar ? 'مقدّم الطلب' : 'Submitted by'}: ${job.submitter?.username ? '@' + esc(job.submitter.username) : esc(job.submitter?.name || String(job.submitter?.id || ''))}`;
  const linkLine = job.links?.length ? `\n\n${ar ? 'روابط التقديم/التواصل:' : 'Application/contact links:'}\n${job.links.map((u, i) => `<a href="${esc(u)}">${ar ? 'رابط' : 'Link'} ${i + 1}</a>`).join(' · ')}` : '';
  const sourceLine = job.kind === 'source' && job.sourceUrl ? `\n<a href="${esc(job.sourceUrl)}">${ar ? 'فتح المنشور الأصلي' : 'Open original post'}</a>` : '';
  const locationLine = job.location ? `\n📍 <b>${ar ? 'الموقع' : 'Location'}:</b> ${esc(ar ? job.location.label_ar : job.location.label_en)}` : `\n📍 <b>${ar ? 'الموقع' : 'Location'}:</b> ${ar ? 'لم يُحدّد بعد — اختر مكاناً سورياً قبل الموافقة' : 'Not selected — choose a Syrian place before approval'}`;
  const contactLine = job.kind === 'employer' ? `\n\n<i>${ar ? 'للرد على صاحب الطلب، استخدم «رد» على هذه البطاقة.' : 'Reply to this card to contact the submitter.'}</i>` : '';
  return `<b>${heading}</b>\n${origin}${locationLine}\n\n<b>${esc(job.title)}</b>\n\n${esc(job.text.slice(0, 2550))}${job.text.length > 2550 ? '…' : ''}${linkLine}${sourceLine}${contactLine}\n\n<i>${ar ? 'الموافقة تُظهر الإعلان في قسم الوظائف بالموقع فقط؛ لا يُنشر في قناة الأخبار.' : 'Approval lists this only in the website Jobs section; it is not posted to the news channel.'}</i>`;
}
function reviewKeyboard(job, lang = 'ar') {
  const kb = new InlineKeyboard();
  kb.text(job.location ? (lang === 'en' ? '📍 Change location' : '📍 تغيير الموقع') : (lang === 'en' ? '📍 Select Syrian location' : '📍 تحديد الموقع'), `j:locjob:${job.id}:gov`);
  if (job.location) kb.text(lang === 'en' ? '✅ Approve for website' : '✅ موافقة وإظهار بالموقع', `j:approve:${job.id}`);
  return kb.row().text(lang === 'en' ? '❌ Ignore' : '❌ تجاهل', `j:ignore:${job.id}`);
}

async function sendReview(job, { force = false } = {}) {
  const j = jobsState();
  const current = j.pending[job?.id];
  if (!current || (!force && current.notifiedAt)) return false;
  const api = adminApi?.();
  const owner = config.ownerIds?.[0];
  if (!api || !owner) return false;
  const sent = await api.sendMessage(owner, reviewText(current, 'ar'), {
    parse_mode: 'HTML', reply_markup: reviewKeyboard(current, 'ar'),
    link_preview_options: { is_disabled: true },
  });
  current.notifiedAt = Date.now();
  current.cards ||= [];
  if (sent?.message_id && !current.cards.some(([chat, mid]) => Number(chat) === Number(owner) && Number(mid) === Number(sent.message_id))) current.cards.push([Number(owner), Number(sent.message_id)]);
  if (current.kind === 'employer' && current.submitter?.id && sent?.message_id) store.relayPut(`a:${owner}:${sent.message_id}`, current.submitter.id);
  saveJobs();
  return true;
}

export async function notifyPending(j = jobsState(), { forceId = null } = {}) {
  const api = adminApi?.();
  if (!api || !config.ownerIds?.[0]) return 0;
  const rows = (forceId ? [j.pending[forceId]].filter(Boolean) : Object.values(j.pending).filter((x) => !x.notifiedAt))
    .sort((a, b) => a.createdAt - b.createdAt).slice(0, forceId ? 1 : 10);
  let n = 0;
  for (const row of rows) {
    try { if (await sendReview(row, { force: !!forceId })) n++; }
    catch (e) { console.warn('[jobs] review message failed', e.description || e.message); }
  }
  return n;
}

export function mergeJobsFromBackup(snapshot, j = jobsState()) {
  const remote = snapshot?.jobs;
  if (!remote || typeof remote !== 'object') return;
  let changed = false;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const key of ['customGovernorates', 'customAreas']) {
    const current = new Set(j[key].map((row) => row?.code).filter(Boolean));
    for (const row of Array.isArray(remote[key]) ? remote[key] : []) {
      if (!row?.code || current.has(row.code)) continue;
      j[key].push(row); current.add(row.code); changed = true;
    }
  }
  for (const [uid, draft] of Object.entries(remote.adminDrafts || {})) {
    if (!draft || Date.now() - Number(draft.updatedAt || draft.createdAt || 0) > 24 * 3600_000) continue;
    const mine = j.adminDrafts[uid];
    if (!mine || Number(draft.updatedAt || draft.createdAt) > Number(mine.updatedAt || mine.createdAt)) { j.adminDrafts[uid] = draft; changed = true; }
  }
  for (const [id, tombstone] of Object.entries(remote.deleted || {})) {
    if (!tombstone) continue;
    if (!j.deleted[id] || Number(tombstone.deletedAt) > Number(j.deleted[id].deletedAt)) { j.deleted[id] = tombstone; changed = true; }
    if (j.pending[id]) { delete j.pending[id]; changed = true; }
    if (j.published[id]) { delete j.published[id]; changed = true; }
    const decision = { id, action: 'deleted', decidedAt: Number(tombstone.deletedAt) || Date.now(), decidedBy: tombstone.deletedBy || null, fingerprint: tombstone.fingerprint, sourceKey: tombstone.sourceKey };
    if (!same(j.decisions[id], decision)) { j.decisions[id] = decision; changed = true; }
  }
  for (const [uid, intake] of Object.entries(remote.intake || {})) {
    if (!intake || Date.now() - Number(intake.createdAt || 0) > INTAKE_AGE) continue;
    const mine = j.intake[uid];
    if (!mine || Number(intake.createdAt) > Number(mine.createdAt)) { j.intake[uid] = intake; changed = true; }
  }
  for (const [id, row] of Object.entries(remote.published || {})) {
    if (!row) continue;
    const localDecision = j.decisions[id];
    const remoteDecision = remote.decisions?.[id] || { id, action: 'approved', decidedAt: Date.parse(row.publishedAt || 0) || 0 };
    if (j.deleted[id] || remote.deleted?.[id] || localDecision?.action === 'deleted' || remoteDecision.action === 'deleted') {
      const tombstone = j.deleted[id] || remote.deleted?.[id] || { id, action: 'deleted', deletedAt: remoteDecision.decidedAt || Date.now(), deletedBy: remoteDecision.decidedBy || null, fingerprint: row.fingerprint, sourceKey: row.sourceKey };
      j.deleted[id] = tombstone;
      j.decisions[id] = { id, action: 'deleted', decidedAt: Number(tombstone.deletedAt) || Date.now(), decidedBy: tombstone.deletedBy || null, fingerprint: tombstone.fingerprint, sourceKey: tombstone.sourceKey };
      if (j.pending[id]) delete j.pending[id];
      if (j.published[id]) delete j.published[id];
      changed = true;
      continue;
    }
    if (localDecision?.action === 'ignored' || remoteDecision.action === 'ignored') {
      const rejected = localDecision?.action === 'ignored' ? localDecision : remoteDecision;
      if (!same(j.decisions[id], rejected)) { j.decisions[id] = rejected; changed = true; }
      if (j.pending[id]) { delete j.pending[id]; changed = true; }
      if (j.published[id]) { delete j.published[id]; changed = true; }
      continue; // a rejection always wins a stale approval
    }
    const localRow = j.published[id];
    const localVersion = Number(localRow?.updatedAt) || Date.parse(localRow?.publishedAt || 0) || Number(localDecision?.decidedAt) || 0;
    const remoteVersion = Number(row.updatedAt) || Date.parse(row.publishedAt || 0) || Number(remoteDecision.decidedAt) || 0;
    const selectedRow = localRow && localVersion > remoteVersion ? localRow : row;
    const location = normalizeJobLocation(selectedRow.location, j);
    if (!location || remoteDecision.action !== 'approved') continue;
    if (!localDecision && !same(j.decisions[id], remoteDecision)) { j.decisions[id] = remoteDecision; changed = true; }
    if (j.pending[id]) { delete j.pending[id]; changed = true; }
    const approvedRow = { ...selectedRow, location, status: 'approved' };
    if (!same(j.published[id], approvedRow)) { j.published[id] = approvedRow; changed = true; }
    if (row.sourceKey) {
      const seen = { status: 'approved', id, fingerprint: row.fingerprint, at: remoteDecision.decidedAt };
      if (!same(j.seen[row.sourceKey], seen)) { j.seen[row.sourceKey] = seen; changed = true; }
    }
    if (row.fingerprint) {
      const fp = { status: 'approved', id, at: remoteDecision.decidedAt };
      if (!same(j.fingerprints[row.fingerprint], fp)) { j.fingerprints[row.fingerprint] = fp; changed = true; }
    }
  }
  for (const [id, decision] of Object.entries(remote.decisions || {})) {
    if (!decision) continue;
    const localDecision = j.decisions[id];
    if (j.deleted[id] || decision.action === 'deleted' || localDecision?.action === 'deleted') {
      const tombstone = j.deleted[id] || remote.deleted?.[id] || { id, action: 'deleted', deletedAt: decision.decidedAt || Date.now(), deletedBy: decision.decidedBy || null, fingerprint: decision.fingerprint, sourceKey: decision.sourceKey };
      j.deleted[id] = tombstone;
      j.decisions[id] = { id, action: 'deleted', decidedAt: Number(tombstone.deletedAt) || Date.now(), decidedBy: tombstone.deletedBy || null, fingerprint: tombstone.fingerprint, sourceKey: tombstone.sourceKey };
      if (j.pending[id]) delete j.pending[id];
      if (j.published[id]) delete j.published[id];
      changed = true;
      continue;
    }
    const chosen = localDecision?.action === 'ignored' || decision.action === 'ignored'
      ? (localDecision?.action === 'ignored' ? localDecision : decision)
      : (!localDecision || Number(decision.decidedAt) < Number(localDecision.decidedAt) ? decision : localDecision);
    if (chosen.action === 'approved') {
      const candidate = remote.published?.[id] || j.published[id] || j.pending[id];
      if (!normalizeJobLocation(candidate?.location, j)) {
        if (j.decisions[id]?.action === 'approved') { delete j.decisions[id]; changed = true; }
        if (j.published[id]) { delete j.published[id]; changed = true; }
        continue;
      }
    }
    if (!localDecision || !same(chosen, localDecision)) { j.decisions[id] = chosen; changed = true; }
    if (chosen.action === 'ignored') {
      if (j.pending[id]) { delete j.pending[id]; changed = true; }
      if (j.published[id]) { delete j.published[id]; changed = true; }
    } else if (chosen.action === 'approved') {
      const remoteRow = remote.published?.[id];
      const localRow = j.published[id];
      const remoteVersion = Number(remoteRow?.updatedAt) || Date.parse(remoteRow?.publishedAt || 0) || Number(decision.decidedAt) || 0;
      const localVersion = Number(localRow?.updatedAt) || Date.parse(localRow?.publishedAt || 0) || Number(localDecision?.decidedAt) || 0;
      const row = localRow && localVersion > remoteVersion ? localRow : remoteRow || localRow || j.pending[id];
      const location = normalizeJobLocation(row?.location, j);
      if (row && location) {
        const approvedRow = { ...row, location, status: 'approved' };
        if (!same(j.published[id], approvedRow)) { j.published[id] = approvedRow; changed = true; }
        if (j.pending[id]) { delete j.pending[id]; changed = true; }
      }
    }
  }
  for (const [id, row] of Object.entries(remote.pending || {})) {
    if (!row || j.deleted[id] || j.decisions[id] || j.pending[id]) continue;
    const fp = row.fingerprint && j.fingerprints[row.fingerprint];
    if (fp && fp.id !== id) continue;
    j.pending[id] = { ...row, location: normalizeJobLocation(row.location, j) };
    if (row.sourceKey) j.seen[row.sourceKey] ||= { status: 'pending', id, fingerprint: row.fingerprint, at: row.createdAt };
    if (row.fingerprint) j.fingerprints[row.fingerprint] ||= { status: 'pending', id, at: row.createdAt };
    changed = true;
  }
  for (const [key, value] of Object.entries(remote.seen || {})) if (!j.seen[key]) { j.seen[key] = value; changed = true; }
  for (const [key, value] of Object.entries(remote.fingerprints || {})) if (!j.fingerprints[key]) { j.fingerprints[key] = value; changed = true; }
  if (remote.source && Number(remote.source.updatedAt) > Number(j.source.updatedAt)) {
    j.source = { ...j.source, ...remote.source, u: JOB_SOURCE.u, name: JOB_SOURCE.name };
    changed = true;
  } else if (remote.source && Number(remote.source.updatedAt) === Number(j.source.updatedAt)) {
    if (remote.source.initialized && (!j.source.initialized || Number(remote.source.lastId) > Number(j.source.lastId || 0))) {
      j.source.initialized = true; j.source.lastId = Number(remote.source.lastId) || 0; changed = true;
    }
  }
  if (changed && j === jobsState()) {
    saveJobs({ broadcast: true });
  }
}

export async function pollJobsOnce({ j = jobsState(), fetcher = fetchChannel, notify = async () => {}, now = Date.now() } = {}) {
  const src = j.source;
  if (!src.on) return { skipped: true, newJobs: 0, checkedPosts: 0 };
  let result;
  try { result = await fetcher(JOB_SOURCE.u, { ...(src.initialized && src.lastId != null ? { afterId: src.lastId } : {}) }); }
  catch (e) {
    src.lastCheck = now; src.lastError = e.code === 'nopreview' ? 'no public preview' : String(e.message || e).slice(0, 120);
    return { error: src.lastError, newJobs: 0, checkedPosts: 0 };
  }
  if (result.complete === false) {
    src.lastCheck = now; src.lastError = 'catch-up exceeds page limit; checkpoint preserved';
    return { incomplete: true, newJobs: 0, checkedPosts: 0 };
  }
  src.lastCheck = now; src.lastError = null;
  const posts = Array.isArray(result.posts) ? result.posts : [];
  const maxId = posts.reduce((max, p) => Math.max(max, Number(p.id) || 0), Number(src.lastId) || 0);
  if (!src.initialized) {
    // Begin from now. Historical channel posts are deliberately not sent for approval.
    src.lastId = maxId; src.initialized = true;
    return { baseline: true, newJobs: 0, checkedPosts: 0 };
  }
  const fresh = posts.filter((p) => Number(p.id) > Number(src.lastId || 0)).sort((a, b) => Number(a.id) - Number(b.id));
  let newJobs = 0;
  for (const p of fresh) {
    const key = `telegram:${JOB_SOURCE.u}:${p.id}`;
    const text = String(p.text || '').trim();
    if (text && isJobPost(text) && p.ts && now - p.ts <= MAX_SOURCE_AGE) {
      const created = createPendingJob({
        kind: 'source', sourceKey: key, title: titleFromText(text), text,
        sourceName: JOB_SOURCE.name, sourceUrl: p.url || `${JOB_SOURCE.url}/${p.id}`,
        links: p.links || [],
      }, j, now);
      if (created.job) {
        newJobs++;
        try { await notify(created.job); } catch (e) { console.warn('[jobs] notify pending failed', e.description || e.message); }
      }
    } else if (text && isJobPost(text)) {
      j.seen[key] ||= { status: 'expired', fingerprint: jobFingerprint(text), at: now };
    }
    // Advance only after this post has been handled or deliberately screened out.
    src.lastId = Math.max(Number(src.lastId) || 0, Number(p.id) || 0);
  }
  if (posts.length) src.lastId = Math.max(Number(src.lastId) || 0, maxId);
  return { baseline: false, newJobs, checkedPosts: fresh.length };
}

function sourceScreenText(ctx) {
  const j = jobsState(); const s = j.source;
  const ago = s.lastCheck ? new Date(s.lastCheck).toLocaleString(hLang(ctx) === 'en' ? 'en-GB' : 'ar-SY', { timeZone: 'Asia/Damascus' }) : (hLang(ctx) === 'en' ? 'not checked yet' : 'لم يبدأ الفحص بعد');
  const pending = Object.keys(j.pending).length; const approved = Object.keys(j.published).length;
  return [
    hLang(ctx) === 'en' ? '<b>💼 Syrian jobs monitor</b>' : '<b>💼 رصد الوظائف</b>', '',
    hLang(ctx) === 'en' ? `Dedicated public Syrian source: <a href="${JOB_SOURCE.url}">@${JOB_SOURCE.u}</a>. New job posts go to you for approval first; approval shows them on the website Jobs page only, never in the news channel.` : `مصدر سوري عام مستقل: <a href="${JOB_SOURCE.url}">@${JOB_SOURCE.u}</a>. كل إعلان جديد يوصلك للموافقة أولاً؛ بعد الموافقة يظهر بقسم الوظائف في الموقع فقط، ولا يُنشر بقناة الأخبار.`, '',
    `${hLang(ctx) === 'en' ? 'Monitoring' : 'الرصد'}: ${s.on ? (hLang(ctx) === 'en' ? '✅ on' : '✅ يعمل') : (hLang(ctx) === 'en' ? '⏸ paused' : '⏸ متوقف')}`,
    `${hLang(ctx) === 'en' ? 'Last check' : 'آخر فحص'}: ${esc(ago)}${s.lastError ? ` · ⚠️ ${esc(s.lastError)}` : ''}`,
    `${hLang(ctx) === 'en' ? 'Pending approval' : 'بانتظار موافقتك'}: ${pending} · ${hLang(ctx) === 'en' ? 'Published on site' : 'منشور بالموقع'}: ${approved}`,
    '', hLang(ctx) === 'en' ? 'Employer submissions from the report bot also wait here for your approval.' : 'طلبات أصحاب العمل عبر بوت التبليغ تصل إلى هنا للموافقة أيضاً.',
  ].join('\n');
}
function hLang(ctx) { return helpers?.langOf?.(ctx) === 'en' ? 'en' : 'ar'; }
function sourceScreenKb(ctx) {
  const s = jobsState().source; const en = hLang(ctx) === 'en';
  return new InlineKeyboard()
    .text(s.on ? (en ? '⏸ Pause jobs monitor' : '⏸ إيقاف رصد الوظائف') : (en ? '▶️ Resume jobs monitor' : '▶️ تشغيل رصد الوظائف'), s.on ? 'j:off' : 'j:on').row()
    .text(en ? '📋 Pending approvals' : '📋 الطلبات المعلّقة', 'j:pending').row()
    .text(en ? '🔄 Refresh' : '🔄 تحديث', 'j:menu').text(en ? '↩️ Back' : '↩️ رجوع', 'nws');
}
function pendingText(ctx) {
  const rows = Object.values(jobsState().pending).sort((a, b) => a.createdAt - b.createdAt).slice(0, 12);
  if (!rows.length) return hLang(ctx) === 'en' ? '<b>No job posts are waiting for review.</b>' : '<b>ما في إعلانات وظائف بانتظار المراجعة.</b>';
  return `${hLang(ctx) === 'en' ? '<b>Pending job posts</b>' : '<b>إعلانات الوظائف المعلّقة</b>'}\n\n${rows.map((r, i) => `${i + 1}. ${esc(r.title)}${r.kind === 'source' ? ` — @${JOB_SOURCE.u}` : ' — طلب صاحب عمل'}`).join('\n')}`;
}
function pendingKb(ctx) {
  const rows = Object.values(jobsState().pending).sort((a, b) => a.createdAt - b.createdAt).slice(0, 12);
  const kb = new InlineKeyboard(); const en = hLang(ctx) === 'en';
  for (const row of rows) kb.text(`${en ? '📨 Review' : '📨 أعد عرض'}: ${row.title}`.slice(0, 55), `j:resend:${row.id}`).row();
  return kb.text(en ? '↩️ Back' : '↩️ رجوع', 'j:menu');
}

function toast(ctx, text) { return ctx.answerCallbackQuery(text ? { text: String(text).slice(0, 190) } : undefined).catch(() => {}); }
async function deleteJobCards(ctx, job) {
  const current = ctx.callbackQuery?.message;
  const cards = [...(job.cards || [])];
  if (current?.message_id) cards.push([current.chat.id, current.message_id]);
  const unique = new Set(cards.map(([chat, mid]) => `${chat}:${mid}`));
  await Promise.allSettled([...unique].map((key) => { const [chat, mid] = key.split(':'); return ctx.api.deleteMessage(Number(chat), Number(mid)); }));
}

const LOC_PAGE_SIZE = 20;
function locGovKeyboard(en, prefix) {
  const kb = new InlineKeyboard();
  governorates.forEach((g, i) => {
    kb.text((en ? g.en : g.ar).slice(0, 54), `${prefix}:g:${g.code}`);
    if (i % 2 === 1 || i === governorates.length - 1) kb.row();
  });
  return kb;
}
function locDistrictKeyboard(en, prefix, govCode, withGovernorate = false) {
  const kb = new InlineKeyboard(); const rows = districtsOf(String(govCode));
  rows.forEach((d, i) => {
    kb.text((en ? d.en : d.ar).slice(0, 54), `${prefix}:d:${d.code}`);
    if (i % 2 === 1 || i === rows.length - 1) kb.row();
  });
  if (withGovernorate) kb.text(en ? 'Entire governorate' : 'المحافظة كلها', `${prefix}:govonly:${govCode}`).row();
  return kb;
}
function locPlaceKeyboard(en, prefix, govCode, distCode, page = 0, admin = false) {
  const kb = new InlineKeyboard(); const rows = placesOf(String(distCode));
  const pages = Math.max(1, Math.ceil(rows.length / LOC_PAGE_SIZE));
  const p = Math.max(0, Math.min(pages - 1, Number(page) || 0));
  const list = rows.slice(p * LOC_PAGE_SIZE, (p + 1) * LOC_PAGE_SIZE);
  list.forEach((place, i) => {
    kb.text((en ? place.en || place.ar : place.ar).slice(0, 54), `${prefix}:place:${place.id}`);
    if (i % 2 === 1 || i === list.length - 1) kb.row();
  });
  if (pages > 1) {
    if (p > 0) kb.text(en ? '‹ Previous' : '‹ السابق', `${prefix}:p:${distCode}:${p - 1}`);
    kb.text(en ? `Page ${p + 1}/${pages}` : `صفحة ${p + 1}/${pages}`, `${prefix}:noop`);
    if (p + 1 < pages) kb.text(en ? 'Next ›' : 'التالي ›', `${prefix}:p:${distCode}:${p + 1}`);
    kb.row();
  }
  kb.text(en ? '↩️ Districts' : '↩️ الأقضية', `${prefix}:back:dist:${govCode}`).row();
  return admin
    ? kb.text(en ? '↩️ Review card' : '↩️ بطاقة المراجعة', `${prefix}:back:card`)
    : kb.text(en ? 'Cancel' : 'إلغاء', 'j:cancel');
}
function employerGovText(en) {
  return en ? '<b>Choose the Syrian governorate where the job is located</b>\n\nThe place is selected from the project’s verified Syrian geography list.' : '<b>اختر المحافظة السورية التي تقع فيها الوظيفة</b>\n\nسنحدد المكان من قائمة المدن والبلدات المعتمدة في بيانات المشروع.';
}
function employerDistrictText(en, govCode) {
  const gov = getGov(govCode);
  return en ? `<b>Choose a district in ${esc(gov?.en || '')}</b>\n\nOr select the whole governorate if the vacancy is not limited to one city.` : `<b>اختر المنطقة/القضاء في ${esc(gov?.ar || '')}</b>\n\nيمكنك اختيار المحافظة كلها إذا لم تكن الوظيفة محصورة بمدينة محددة.`;
}
function employerPlaceText(en, distCode) {
  const dist = getDist(distCode);
  return en ? `<b>Choose the city or town in ${esc(dist?.en || '')}</b>\n\nPick the closest exact place from the Syrian locations list.` : `<b>اختر المدينة أو البلدة في ${esc(dist?.ar || '')}</b>\n\nاختر المكان الأدق من قائمة المواقع السورية.`;
}
function promptText(en, location) {
  const selected = en ? location?.label_en : location?.label_ar;
  return en
    ? `<b>Post a job vacancy</b>\n📍 <b>Selected location:</b> ${esc(selected || '')}\n\nSend the details in one message: job title, employer (optional), duties and requirements, how to apply/contact, and salary or deadline if known. Your submission will go to the owner for approval before it appears on the website.`
    : `<b>طلب نشر وظيفة</b>\n📍 <b>الموقع المحدد:</b> ${esc(selected || '')}\n\nأرسل التفاصيل برسالة واحدة: المسمّى الوظيفي، جهة العمل (اختياري)، المهام والشروط، طريقة التقديم أو التواصل، والراتب أو آخر موعد إن وُجد. سيصل الطلب للمالك للموافقة قبل ظهوره على الموقع.`;
}
function promptKeyboard(en) {
  return new InlineKeyboard().text(en ? '📍 Change location' : '📍 تغيير الموقع', 'j:loc:change').text(en ? 'Cancel' : 'إلغاء', 'j:cancel');
}
async function editIntakeScreen(ctx, intake, text, keyboard) {
  const opts = { parse_mode: 'HTML', reply_markup: keyboard, link_preview_options: { is_disabled: true } };
  let message = null;
  if (ctx.callbackQuery?.message) {
    try { await ctx.editMessageText(text, opts); message = ctx.callbackQuery.message; }
    catch (e) {
      if (/message is not modified/i.test(e.description || e.message || '')) message = ctx.callbackQuery.message;
      else message = await ctx.reply(text, opts).catch(() => null);
    }
  } else message = await ctx.reply(text, opts).catch(() => null);
  const id = message?.message_id || ctx.callbackQuery?.message?.message_id;
  if (id) intake.promptId = Number(id);
  saveJobs();
}
async function denyNonPrivateJobRequest(ctx) {
  const text = hLang(ctx) === 'en'
    ? 'For privacy, send vacancy details only in a private chat with this bot.'
    : 'حفاظاً على خصوصيتك، أرسل تفاصيل الوظيفة في محادثة خاصة مع البوت فقط.';
  if (ctx.callbackQuery) return toast(ctx, text);
  if (ctx.ras) ctx.ras.keepInput = true;
  if (ctx.message?.message_id) try { await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id); } catch { /* ignore */ }
  if (helpers?.sendTransient) return helpers.sendTransient(ctx.api, ctx.chat.id, text);
  return ctx.reply(text).catch(() => {});
}
async function startJobRequest(ctx) {
  const uid = Number(ctx.from?.id); if (!uid || !ctx.chat) return;
  if (store.isBanned(uid)) return;
  if (ctx.chat.type !== 'private') return denyNonPrivateJobRequest(ctx);
  await mergeJobBackup(true);
  if (ctx.callbackQuery) await toast(ctx, '');
  const en = hLang(ctx) === 'en';
  if (ctx.message) {
    ctx.ras && (ctx.ras.keepInput = true);
    await cleanMenuMessages(ctx.api, 'report', ctx.chat.id, ctx.message);
  }
  const j = jobsState();
  const key = String(uid); const previous = j.intake[key];
  if (previous?.promptId) try { await ctx.api.deleteMessage(previous.chatId || ctx.chat.id, previous.promptId); } catch { /* already gone */ }
  const intake = j.intake[key] = { id: uid, chatId: Number(ctx.chat.id), createdAt: Date.now(), promptId: null, step: 'governorate' };
  saveJobs();
  await editIntakeScreen(ctx, intake, employerGovText(en), locGovKeyboard(en, 'j:loc'));
}
async function clearIntakeMessages(ctx, intake) {
  ctx.ras && (ctx.ras.keepInput = true);
  try { await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id); } catch { /* already gone */ }
  if (intake?.promptId) try { await ctx.api.deleteMessage(intake.chatId || ctx.chat.id, intake.promptId); } catch { /* already gone */ }
}

function adminLocationText(job, mode, code = '', page = 0) {
  const title = `<b>📍 تحديد موقع الوظيفة</b>\n<b>${esc(job.title)}</b>`;
  if (mode === 'gov') return `${title}\n\nاختر المحافظة السورية التي يقع فيها الإعلان. إذا لم يذكر المصدر مدينة دقيقة، اختر المحافظة فقط.`;
  if (mode === 'district') return `${title}\n\nاختر القضاء/المنطقة في <b>${esc(getGov(code)?.ar || '')}</b>، أو حدّد المحافظة كلها.`;
  const list = placesOf(String(code)); const pages = Math.max(1, Math.ceil(list.length / LOC_PAGE_SIZE));
  return `${title}\n\nاختر المدينة أو البلدة الأدق في <b>${esc(getDist(code)?.ar || '')}</b>. الصفحة ${Math.min(Number(page) + 1, pages)} من ${pages}.`;
}
function adminLocationKeyboard(job, mode, govCode = '', distCode = '', page = 0) {
  const prefix = `j:locjob:${job.id}`;
  if (mode === 'gov') return locGovKeyboard(false, prefix).row().text('↩️ العودة للإعلان', `${prefix}:back:card`);
  if (mode === 'district') return locDistrictKeyboard(false, prefix, govCode, true).row()
    .text('↩️ المحافظات', `${prefix}:back:gov`).row().text('↩️ العودة للإعلان', `${prefix}:back:card`);
  return locPlaceKeyboard(false, prefix, govCode, distCode, page, true).row()
    .text('↩️ العودة للإعلان', `${prefix}:back:card`);
}
async function showAdminLocation(ctx, job, mode, govCode = '', distCode = '', page = 0) {
  try {
    await ctx.editMessageText(adminLocationText(job, mode, mode === 'places' ? distCode : govCode, page), {
      parse_mode: 'HTML', reply_markup: adminLocationKeyboard(job, mode, govCode, distCode, page),
      link_preview_options: { is_disabled: true },
    });
  } catch (e) { if (!/message is not modified/i.test(e.description || e.message || '')) throw e; }
}
async function showAdminReview(ctx, job) {
  try {
    await ctx.editMessageText(reviewText(job, 'ar'), {
      parse_mode: 'HTML', reply_markup: reviewKeyboard(job, 'ar'),
      link_preview_options: { is_disabled: true },
    });
  } catch (e) { if (!/message is not modified/i.test(e.description || e.message || '')) throw e; }
}
function setAdminJobLocation(job, location) {
  if (!location) return false;
  job.location = location;
  delete job.locationPickGov; delete job.locationPickDist;
  saveJobs();
  return true;
}

export function registerJobsTools(bot, h, role = 'admin') {
  helpers = h;
  if (role === 'admin') {
    adminApi = () => h.apis?.().admin || bot.api;
    const ownerOnly = async (ctx, fn) => { if (!h.owner(ctx)) return toast(ctx, ''); return fn(); };
    bot.callbackQuery('j:menu', (ctx) => ownerOnly(ctx, async () => { await toast(ctx, ''); await h.show(ctx, sourceScreenText(ctx), sourceScreenKb(ctx)); }));
    bot.callbackQuery(/^j:(on|off)$/, (ctx) => ownerOnly(ctx, async () => {
      const j = jobsState(); const on = ctx.match[1] === 'on';
      j.source.on = on; j.source.updatedAt = Date.now(); j.source.lastError = null;
      if (on) { j.source.initialized = false; j.source.lastId = null; } // resume from now; do not flood old listings
      saveJobs();
      await toast(ctx, on ? (hLang(ctx) === 'en' ? 'Jobs monitor resumed from now' : 'عاد رصد الوظائف من الآن') : (hLang(ctx) === 'en' ? 'Jobs monitor paused' : 'توقف رصد الوظائف'));
      await h.show(ctx, sourceScreenText(ctx), sourceScreenKb(ctx));
    }));
    bot.callbackQuery('j:pending', (ctx) => ownerOnly(ctx, async () => { await toast(ctx, ''); await h.show(ctx, pendingText(ctx), pendingKb(ctx)); }));
    bot.callbackQuery(/^j:resend:([a-f0-9]{14})$/, (ctx) => ownerOnly(ctx, async () => {
      await toast(ctx, '');
      const row = jobsState().pending[ctx.match[1]];
      if (!row) return h.show(ctx, pendingText(ctx), pendingKb(ctx));
      await sendReview(row, { force: true }).catch((e) => console.warn('[jobs] resend failed', e.description || e.message));
      await h.sendTransient(ctx.api, ctx.chat.id, hLang(ctx) === 'en' ? 'Review card sent to this chat.' : 'أعدت إرسال بطاقة المراجعة لهذه المحادثة.');
    }));
    bot.callbackQuery(/^j:locjob:([a-f0-9]{14}):(.+)$/, (ctx) => ownerOnly(ctx, async () => {
      await toast(ctx, '');
      if (store.backup && config.telegramBackup) await store.mergeFromBackup().catch(() => {});
      const j = jobsState(); const job = j.pending[ctx.match[1]];
      if (!job) return h.show(ctx, pendingText(ctx), pendingKb(ctx));
      const parts = ctx.match[2].split(':'); const [op, a, b] = parts;
      if (op === 'gov') return showAdminLocation(ctx, job, 'gov');
      if (op === 'g') {
        const gov = getGov(a); if (!gov) return toast(ctx, 'المحافظة غير موجودة');
        job.locationPickGov = gov.code; delete job.locationPickDist; saveJobs();
        return showAdminLocation(ctx, job, 'district', gov.code);
      }
      if (op === 'govonly') {
        if (String(a) !== String(job.locationPickGov)) return toast(ctx, 'اختر المحافظة أولاً');
        if (!setAdminJobLocation(job, locationForGovernorate(a))) return toast(ctx, 'المحافظة غير موجودة');
        await toast(ctx, 'تم تحديد الموقع'); return showAdminReview(ctx, job);
      }
      if (op === 'd') {
        const dist = getDist(a);
        if (!dist || String(dist.gov) !== String(job.locationPickGov)) return toast(ctx, 'المنطقة غير مطابقة للمحافظة');
        job.locationPickDist = dist.code; saveJobs();
        return showAdminLocation(ctx, job, 'places', job.locationPickGov, dist.code, 0);
      }
      if (op === 'p') {
        if (String(a) !== String(job.locationPickDist)) return toast(ctx, 'اختر المنطقة أولاً');
        return showAdminLocation(ctx, job, 'places', job.locationPickGov, a, Number(b) || 0);
      }
      if (op === 'place') {
        const place = getPlace(Number(a));
        if (!place || String(place.gov) !== String(job.locationPickGov) || String(place.dist) !== String(job.locationPickDist)) return toast(ctx, 'الموقع غير مطابق للاختيار');
        if (!setAdminJobLocation(job, locationForPlace(place.id, job.locationPickGov))) return toast(ctx, 'تعذّر تحديد الموقع');
        await toast(ctx, 'تم تحديد الموقع'); return showAdminReview(ctx, job);
      }
      if (op === 'noop') return toast(ctx, '');
      if (op === 'back' && a === 'card') return showAdminReview(ctx, job);
      if (op === 'back' && a === 'gov') return showAdminLocation(ctx, job, 'gov');
      if (op === 'back' && a === 'dist') {
        const govCode = String(b || job.locationPickGov || '');
        if (govCode !== String(job.locationPickGov)) return toast(ctx, 'اختر المحافظة أولاً');
        return showAdminLocation(ctx, job, 'district', govCode);
      }
      return toast(ctx, '');
    }));
    bot.callbackQuery(/^j:(approve|ignore):([a-f0-9]{14})$/, (ctx) => ownerOnly(ctx, async () => {
      if (store.backup && config.telegramBackup) await store.mergeFromBackup().catch(() => {});
      const j = jobsState(); const [, action, id] = ctx.match; const job = j.pending[id];
      if (!job) {
        const done = j.decisions[id]; await toast(ctx, done ? (hLang(ctx) === 'en' ? 'Already reviewed' : 'تمت مراجعة الإعلان مسبقاً') : '');
        try { await ctx.deleteMessage(); } catch { /* ignore */ }
        return;
      }
      const result = decideJob(id, action, j, ctx.from.id);
      if (!result.ok && result.error === 'location_required') {
        await toast(ctx, hLang(ctx) === 'en' ? 'Choose a Syrian location first' : 'حدّد موقعاً سورياً أولاً');
        return showAdminLocation(ctx, job, 'gov');
      }
      if (!result.ok) return toast(ctx, '');
      saveJobs({ broadcast: true });
      await toast(ctx, action === 'approve' ? (hLang(ctx) === 'en' ? 'Approved for the website only' : 'تمت الموافقة للموقع فقط') : (hLang(ctx) === 'en' ? 'Ignored; it will not be shown' : 'تم التجاهل ولن يظهر'));
      await deleteJobCards(ctx, result.job);
      await h.sendTransient(ctx.api, ctx.chat.id, action === 'approve'
        ? (hLang(ctx) === 'en' ? '✅ Approved and added to the website Jobs section only — not the news channel.' : '✅ أُضيف الإعلان لقسم الوظائف في الموقع فقط؛ لم يُنشر في قناة الأخبار.')
        : (hLang(ctx) === 'en' ? 'The job post was ignored and will not be listed.' : 'تم تجاهل إعلان الوظيفة ولن يُعرض.'));
    }));
  } else if (role === 'report') {
    bot.command('start', async (ctx, next) => {
      const payload = String(ctx.match || '').trim().split(/\s+/)[0];
      if (payload === 'job') return startJobRequest(ctx);
      const j = jobsState(); const key = String(ctx.from?.id); const intake = j.intake[key];
      if (intake && Number(intake.chatId) === Number(ctx.chat.id)) {
        delete j.intake[key]; saveJobs();
        if (intake.promptId) try { await ctx.api.deleteMessage(intake.chatId || ctx.chat.id, intake.promptId); } catch { /* already gone */ }
      }
      return next();
    });
    bot.command('job', (ctx) => startJobRequest(ctx));
    bot.callbackQuery('j:new', (ctx) => startJobRequest(ctx));
    bot.callbackQuery(/^j:loc:(.+)$/, async (ctx) => {
      await mergeJobBackup(true);
      const uid = Number(ctx.from?.id); const key = String(uid); const j = jobsState(); const intake = j.intake[key];
      if (!intake || Number(intake.id) !== uid) return toast(ctx, hLang(ctx) === 'en' ? 'Start a new vacancy request first' : 'ابدأ طلب وظيفة جديداً أولاً');
      if (ctx.chat?.type !== 'private' || Number(intake.chatId) !== Number(ctx.chat.id)) {
        if (ctx.chat?.type !== 'private' && Number(intake.chatId) === Number(ctx.chat.id)) {
          delete j.intake[key]; saveJobs();
          try { await ctx.deleteMessage(); } catch { /* ignore */ }
        }
        return denyNonPrivateJobRequest(ctx);
      }
      if (Date.now() - Number(intake.createdAt || 0) > INTAKE_AGE) {
        delete j.intake[key]; saveJobs(); await toast(ctx, hLang(ctx) === 'en' ? 'Form expired' : 'انتهت مهلة النموذج');
        try { await ctx.deleteMessage(); } catch { /* ignore */ }
        return;
      }
      await toast(ctx, '');
      const en = hLang(ctx) === 'en'; const parts = ctx.match[1].split(':'); const [op, a, b] = parts;
      if (op === 'change') {
        intake.step = 'governorate'; delete intake.pickerGov; delete intake.pickerDist;
        return editIntakeScreen(ctx, intake, employerGovText(en), locGovKeyboard(en, 'j:loc'));
      }
      if (op === 'g') {
        const gov = getGov(a); if (!gov) return toast(ctx, en ? 'Governorate not found' : 'المحافظة غير موجودة');
        intake.pickerGov = gov.code; intake.step = 'district'; saveJobs();
        const kb = locDistrictKeyboard(en, 'j:loc', gov.code, true).row()
          .text(en ? '↩️ Governorates' : '↩️ المحافظات', 'j:loc:back:gov').row()
          .text(en ? 'Cancel' : 'إلغاء', 'j:cancel');
        return editIntakeScreen(ctx, intake, employerDistrictText(en, gov.code), kb);
      }
      if (op === 'govonly') {
        if (String(a) !== String(intake.pickerGov)) return toast(ctx, en ? 'Choose a governorate first' : 'اختر المحافظة أولاً');
        const location = locationForGovernorate(a); if (!location) return toast(ctx, en ? 'Governorate not found' : 'المحافظة غير موجودة');
        intake.location = location; intake.step = 'details'; delete intake.pickerGov; delete intake.pickerDist;
        return editIntakeScreen(ctx, intake, promptText(en, location), promptKeyboard(en));
      }
      if (op === 'd') {
        const dist = getDist(a);
        if (!dist || String(dist.gov) !== String(intake.pickerGov)) return toast(ctx, en ? 'District does not match the governorate' : 'المنطقة لا تتبع المحافظة المختارة');
        intake.pickerDist = dist.code; intake.step = 'place'; saveJobs();
        return editIntakeScreen(ctx, intake, employerPlaceText(en, dist.code), locPlaceKeyboard(en, 'j:loc', intake.pickerGov, dist.code, 0));
      }
      if (op === 'p') {
        if (String(a) !== String(intake.pickerDist)) return toast(ctx, en ? 'Choose a district first' : 'اختر المنطقة أولاً');
        return editIntakeScreen(ctx, intake, employerPlaceText(en, a), locPlaceKeyboard(en, 'j:loc', intake.pickerGov, a, Number(b) || 0));
      }
      if (op === 'place') {
        const place = getPlace(Number(a));
        if (!place || String(place.gov) !== String(intake.pickerGov) || String(place.dist) !== String(intake.pickerDist)) return toast(ctx, en ? 'Place does not match the selection' : 'الموقع لا يطابق الاختيار');
        const location = locationForPlace(place.id, intake.pickerGov); if (!location) return toast(ctx, en ? 'Place not found' : 'الموقع غير موجود');
        intake.location = location; intake.step = 'details'; delete intake.pickerGov; delete intake.pickerDist;
        return editIntakeScreen(ctx, intake, promptText(en, location), promptKeyboard(en));
      }
      if (op === 'noop') return toast(ctx, '');
      if (op === 'back' && a === 'gov') {
        intake.step = 'governorate';
        return editIntakeScreen(ctx, intake, employerGovText(en), locGovKeyboard(en, 'j:loc'));
      }
      if (op === 'back' && a === 'dist') {
        const govCode = String(b || intake.pickerGov || '');
        if (govCode !== String(intake.pickerGov)) return toast(ctx, en ? 'Choose a governorate first' : 'اختر المحافظة أولاً');
        intake.step = 'district';
        const kb = locDistrictKeyboard(en, 'j:loc', govCode, true).row()
          .text(en ? '↩️ Governorates' : '↩️ المحافظات', 'j:loc:back:gov').row()
          .text(en ? 'Cancel' : 'إلغاء', 'j:cancel');
        return editIntakeScreen(ctx, intake, employerDistrictText(en, govCode), kb);
      }
      return toast(ctx, '');
    });
    bot.callbackQuery('j:cancel', async (ctx) => {
      const j = jobsState(); const intake = j.intake[String(ctx.from?.id)];
      if (intake && Number(intake.chatId) === Number(ctx.chat?.id)) { delete j.intake[String(ctx.from.id)]; saveJobs(); }
      await toast(ctx, hLang(ctx) === 'en' ? 'Cancelled' : 'تم الإلغاء');
      try { await ctx.deleteMessage(); } catch { /* ignore */ }
    });
    bot.on('message:text', async (ctx, next) => {
      const uid = Number(ctx.from?.id); const key = String(uid);
      let j = jobsState(); let intake = j.intake[key];
      if (store.backup && config.telegramBackup && (intake || Date.now() - intakeMergeAt >= 5_000)) {
        await mergeJobBackup(!!intake);
        j = jobsState(); intake = j.intake[key];
      }
      if (!intake) return next();
      if (ctx.chat?.type !== 'private' || Number(intake.chatId) !== Number(ctx.chat.id)) {
        if (ctx.chat?.type !== 'private' && Number(intake.chatId) === Number(ctx.chat.id)) {
          delete j.intake[key]; saveJobs();
          if (intake.promptId) try { await ctx.api.deleteMessage(intake.chatId, intake.promptId); } catch { /* ignore */ }
        }
        return denyNonPrivateJobRequest(ctx);
      }
      if (Date.now() - Number(intake.createdAt || 0) > INTAKE_AGE) {
        delete j.intake[key]; saveJobs();
        await clearIntakeMessages(ctx, intake);
        await h.sendTransient(ctx.api, ctx.chat.id, hLang(ctx) === 'en' ? 'This form expired. Tap “Post a vacancy” to start again.' : 'انتهت مهلة النموذج. اضغط «مطلوب موظف» للبدء من جديد.');
        return;
      }
      const text = String(ctx.message.text || '').trim();
      if (text.startsWith('/')) return next();
      if (intake.step !== 'details' || !intake.location) {
        ctx.ras && (ctx.ras.keepInput = true);
        try { await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id); } catch { /* ignore */ }
        return h.sendTransient(ctx.api, ctx.chat.id, hLang(ctx) === 'en' ? 'Choose a Syrian governorate and place from the buttons first.' : 'اختر المحافظة والمدينة السورية من الأزرار أولاً.');
      }
      if (text.length < 40 || text.length > MAX_INTAKE_TEXT) {
        const msg = text.length > MAX_INTAKE_TEXT
          ? (hLang(ctx) === 'en' ? 'Please keep the details under 2,000 characters.' : 'اختصر التفاصيل إلى أقل من ٢٠٠٠ حرف.')
          : (hLang(ctx) === 'en' ? 'Please add more detail: job title, employer (if known), duties, requirements and how to apply.' : 'أضف تفاصيل أكثر: المسمّى الوظيفي، جهة العمل إن عُرفت، المهام والشروط وطريقة التقديم.');
        ctx.ras && (ctx.ras.keepInput = true);
        try { await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id); } catch { /* ignore */ }
        return h.sendTransient(ctx.api, ctx.chat.id, msg);
      }
      const user = ctx.from || {};
      const locationKey = intake.location.place_id || intake.location.governorate_code;
      const sourceKey = `employer:${uid}:${locationKey}:${jobFingerprint(text)}`;
      const created = createPendingJob({
        kind: 'employer', sourceKey, title: titleFromText(text), text,
        sourceName: 'طلب صاحب عمل', sourceUrl: '', links: linksFromText(text),
        location: intake.location,
        submitter: { id: uid, username: user.username || '', name: [user.first_name, user.last_name].filter(Boolean).join(' ') },
      }, j);
      delete j.intake[key];
      saveJobs();
      await clearIntakeMessages(ctx, intake);
      if (created.duplicate) return h.sendTransient(ctx.api, ctx.chat.id, hLang(ctx) === 'en' ? 'These details have already been submitted; no duplicate was sent for review.' : 'وصلتنا التفاصيل نفسها من قبل؛ لم أرسل طلباً مكرراً للمراجعة.');
      if (!created.job) return h.sendTransient(ctx.api, ctx.chat.id, hLang(ctx) === 'en' ? 'Could not save the job post. Please try again.' : 'تعذّر حفظ طلب الوظيفة. حاول مرة ثانية.');
      await notifyPending(j);
      await h.sendTransient(ctx.api, ctx.chat.id, hLang(ctx) === 'en' ? '✅ Received. The owner will review it before it appears on the website.' : '✅ وصل الطلب. سيُراجعه المالك قبل ظهوره على الموقع.');
    });
  }
}

export function startJobsMonitor({ everyMs = POLL_MS } = {}) {
  if (active) return;
  active = true;
  jobsState();
  store.mergeHooks ||= [];
  if (!store.mergeHooks.includes(mergeJobsFromBackup)) store.mergeHooks.push(mergeJobsFromBackup);
  const loop = async () => {
    if (!active || running) return;
    running = true;
    try {
      if (store.backup && config.telegramBackup && Date.now() - (startJobsMonitor.lastMergeAt || 0) >= 5 * 60_000) {
        await store.mergeFromBackup().catch(() => {});
        startJobsMonitor.lastMergeAt = Date.now();
      }
      const j = jobsState();
      const result = await pollJobsOnce({ j, notify: async (job) => { saveJobs(); await sendReview(job); } });
      if (result.baseline || result.newJobs || result.error || result.incomplete) saveJobs({ backupSoon: !!(result.baseline || result.newJobs), broadcast: result.newJobs > 0 });
      else if (result.checkedPosts) saveJobs({ backupSoon: false });
      await notifyPending(j);
    } catch (e) { console.error('[jobs] monitor failed', e.message); }
    finally { running = false; }
    if (active) { timer = setTimeout(loop, everyMs); timer.unref?.(); }
  };
  void loop();
}
export function stopJobsMonitor() { active = false; clearTimeout(timer); timer = null; }

export const _test = { JOB_TERMS, safeLinks, linksFromText, cleanJobText, titleFromText, reviewText, reviewKeyboard, mergeJobsFromBackup, sourceScreenText, pendingText };
