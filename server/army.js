import crypto from 'node:crypto';
import { InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { store } from './store.js';
import { fetchChannel } from './news-sources.js';
import { normalizeApplicationDeadline, isApplicationDeadlineExpired } from './application-deadline.js';

export const ARMY_CATEGORIES = Object.freeze({
  recruitment: Object.freeze({ ar: 'الانتساب والتطوع', en: 'Enlistment & volunteering', icon: '🪖', iconKey: 'users' }),
  army: Object.freeze({ ar: 'رواتب الجيش', en: 'Army salaries', icon: '💰', iconKey: 'coin' }),
  police: Object.freeze({ ar: 'رواتب الشرطة', en: 'Police salaries', icon: '👮', iconKey: 'patrol' }),
  security: Object.freeze({ ar: 'رواتب الأمن', en: 'Security salaries', icon: '🛡️', iconKey: 'shield' }),
  units: Object.freeze({ ar: 'الفرق العسكرية', en: 'Military units', icon: '🎖️', iconKey: 'swords' }),
  special: Object.freeze({ ar: 'المهام الخاصة', en: 'Special missions', icon: '🎯', iconKey: 'target' }),
  official_links: Object.freeze({ ar: 'روابط الانتساب الرسمية', en: 'Official enlistment links', icon: '🔗', iconKey: 'link' }),
  government: Object.freeze({ ar: 'الدوائر الحكومية (سجل قديم)', en: 'Government departments (legacy)', icon: '🏛️', iconKey: 'news', public: false }),
});

// These public Telegram previews identify themselves as official ministry channels.
// They are input sources only: the monitor never posts to any of these channels.
export const ARMY_SOURCES = Object.freeze([
  Object.freeze({ u: 'Sy_Defense', name: 'وزارة الدفاع السورية', agency: 'الدفاع', url: 'https://t.me/Sy_Defense' }),
  Object.freeze({ u: 'syrianmoi', name: 'وزارة الداخلية السورية', agency: 'الداخلية', url: 'https://t.me/syrianmoi' }),
  Object.freeze({ u: 'SyrMOfF', name: 'وزارة المالية السورية', agency: 'المالية', url: 'https://t.me/SyrMOfF' }),
  Object.freeze({ u: 'sana_gov', name: 'الوكالة العربية السورية للأنباء (سانا)', agency: 'الحكومة', url: 'https://t.me/sana_gov' }),
]);

// Private bot-only inputs; publicArmy().sources and visitor follow links stay unchanged.
export const ARMY_MONITOR_ONLY_SOURCES = Object.freeze([
  Object.freeze({ u: 'SyrArArmy', name: 'الجيش العربي السوري', agency: 'العسكرية', type: 'official', url: 'https://t.me/SyrArArmy' }),
  Object.freeze({ u: 'SANANewsEnglish', name: 'SANA English', agency: 'الحكومة', type: 'official', url: 'https://t.me/SANANewsEnglish' }),
  Object.freeze({ u: 'televisionsyria', name: 'تلفزيون سوريا (إشارة إعلامية)', agency: 'إعلام', type: 'media', url: 'https://t.me/televisionsyria' }),
]);
export const ARMY_MONITOR_SOURCES = Object.freeze([...ARMY_SOURCES, ...ARMY_MONITOR_ONLY_SOURCES]);
const MAX_MANUAL_ARMY_SOURCES = 10;

export function normalizeArmyTelegramUsername(raw) {
  let value = String(raw || '').trim();
  if (value.startsWith('@')) value = value.slice(1);
  if (/^(?:https?:\/\/|www\.|t\.me\/)/i.test(value)) {
    try {
      const url = new URL(value.startsWith('t.me/') ? `https://${value}` : value.startsWith('www.') ? `https://${value}` : value);
      if (url.protocol !== 'https:' || !['t.me', 'www.t.me'].includes(url.hostname.toLowerCase()) || url.username || url.password || url.port || url.search || url.hash) return '';
      value = url.pathname.replace(/^\/+|\/+$/g, '');
    } catch { return ''; }
  }
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value) ? value : '';
}

export function normalizeManualArmySource(input = {}) {
  const u = normalizeArmyTelegramUsername(input.username || input.u || input.url);
  const name = clean(input.name, 70);
  const type = input.type === 'media' ? 'media' : input.type === 'official' ? 'official' : '';
  if (!u) return { ok: false, error: 'invalid_username' };
  if (name.length < 2) return { ok: false, error: 'invalid_name' };
  if (!type) return { ok: false, error: 'invalid_type' };
  return { ok: true, source: { u, name, agency: type === 'media' ? 'إعلام' : 'مصدر يدوي', type, url: `https://t.me/${u}`, manual: true } };
}

export function armyMonitorSources(j = armyState()) {
  const sources = [...ARMY_MONITOR_SOURCES];
  const seen = new Set(sources.map((source) => source.u.toLowerCase()));
  for (const source of Object.values(j.manualSources || {})) {
    if (!source || seen.has(String(source.u || '').toLowerCase())) continue;
    seen.add(source.u.toLowerCase()); sources.push(source);
  }
  return sources;
}

export function addManualArmySource(input, j = armyState(), now = Date.now()) {
  const normalized = normalizeManualArmySource(input);
  if (!normalized.ok) return normalized;
  const source = normalized.source; const u = source.u.toLowerCase();
  if (ARMY_MONITOR_SOURCES.some((row) => row.u.toLowerCase() === u) || Object.keys(j.manualSources || {}).some((key) => key.toLowerCase() === u)) return { ok: false, error: 'duplicate' };
  if (Object.keys(j.manualSources || {}).length >= MAX_MANUAL_ARMY_SOURCES) return { ok: false, error: 'limit' };
  j.manualSources ||= {}; j.manualSources[source.u] = source;
  j.sources[source.u] = { lastId: null, initialized: false, lastCheck: null, lastError: null };
  j.monitorSourcesUpdatedAt = now;
  return { ok: true, source };
}

export function updateManualArmySource(username, patch, j = armyState(), now = Date.now()) {
  const old = String(username || ''); const current = j.manualSources?.[old];
  if (!current) return { ok: false, error: 'not_found' };
  const normalized = normalizeManualArmySource({ ...current, ...patch });
  if (!normalized.ok) return normalized;
  const source = normalized.source; const duplicate = [...ARMY_MONITOR_SOURCES, ...Object.values(j.manualSources || {})].some((row) => row.u.toLowerCase() === source.u.toLowerCase() && row.u !== old);
  if (duplicate) return { ok: false, error: 'duplicate' };
  if (source.u !== old) {
    delete j.manualSources[old]; delete j.sources[old];
    j.sources[source.u] = { lastId: null, initialized: false, lastCheck: null, lastError: null };
  }
  j.manualSources[source.u] = source; j.monitorSourcesUpdatedAt = now;
  return { ok: true, source };
}

export function removeManualArmySource(username, j = armyState(), now = Date.now()) {
  const u = String(username || '');
  if (!j.manualSources?.[u]) return { ok: false, error: 'not_found' };
  const source = j.manualSources[u]; delete j.manualSources[u]; delete j.sources[u];
  j.monitorSourcesUpdatedAt = now;
  return { ok: true, source };
}

const POLL_MS = 15 * 60_000;
const MAX_SOURCE_AGE = 30 * 86400_000;
const MAX_TEXT = 3600;
const URL_RE = /https:\/\/[^\s<>()[\]{}]+/gi;
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clean = (s, max = MAX_TEXT) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[ؤئ]/g, 'ء').replace(/\s+/g, ' ').trim();
const uidFrom = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 14);
const isCategory = (key) => Object.hasOwn(ARMY_CATEGORIES, String(key || ''));
const isPublicArmyCategory = (key) => isCategory(key) && ARMY_CATEGORIES[key].public !== false;

function safeHttps(raw) {
  const s = String(raw || '').trim().replace(/&amp;/g, '&');
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password || u.port) return '';
    return u.href;
  } catch { return ''; }
}
function safeLinks(links = []) {
  const result = [];
  for (const raw of links) {
    const url = safeHttps(raw);
    if (url && !result.includes(url)) result.push(url);
    if (result.length >= 8) break;
  }
  return result;
}
function linksFromText(text) { return safeLinks(String(text || '').match(URL_RE) || []); }
function cleanPublicArmyText(raw) {
  const lines = String(raw || '').split(/\r?\n/).filter((line) => {
    const value = line.trim();
    if (/(?:تابعونا\s+على|تابعوا\s+على|follow\s+us\s+on)\s*(?:التلغرام|التليغرام|تلغرام|تليغرام|telegram)/iu.test(value)) return false;
    if (/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\/sana_gov\/?$/i.test(value)) return false;
    return true;
  }).map((line) => line.replace(/#\s*(?:سانا|sana)(?=$|[\s|])/giu, '').trim()).filter(Boolean);
  while (lines.length && /^[ـ—–=_-]{3,}$/.test(lines[lines.length - 1])) lines.pop();
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function armySourceRelatedLink(raw, rawSource) {
  try {
    const link = new URL(raw);
    const source = new URL(safeHttps(rawSource));
    const host = (value) => value.toLowerCase().replace(/^www\./, '');
    const linkPath = link.pathname.replace(/\/+$/, '').toLowerCase() || '/';
    const sourcePath = source.pathname.replace(/\/+$/, '').toLowerCase() || '/';
    return host(link.hostname) === host(source.hostname)
      && (linkPath === sourcePath || (linkPath !== '/' && sourcePath.startsWith(`${linkPath}/`)));
  } catch { return false; }
}
function publicArmyLinks(item) {
  return safeLinks(item.links || []).filter((raw) => {
    try {
      const url = new URL(raw);
      const host = url.hostname.toLowerCase();
      const sanaFollow = ['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(host)
        && url.pathname.replace(/\/+$/, '').toLowerCase() === '/sana_gov';
      return !sanaFollow && !armySourceRelatedLink(raw, item.sourceUrl);
    } catch { return false; }
  });
}
function titleFromText(text) {
  const line = String(text || '').split(/\r?\n/).map((x) => x.trim()).find(Boolean) || 'تحديث رسمي';
  return clean(line.replace(/<[^>]*>/g, ''), 120);
}

export function normalizeArmyChannelLink(kind, raw) {
  const s = String(raw || '').trim();
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return '';
    const path = u.pathname.replace(/\/+$/, '');
    if (kind === 'tg' && ['t.me', 'www.t.me'].includes(u.hostname.toLowerCase()) && /^\/(?:[A-Za-z][A-Za-z0-9_]{3,31}|\+[A-Za-z0-9_-]{8,})$/.test(path)) return `https://t.me${path}`;
    if (kind === 'wa' && ['whatsapp.com', 'www.whatsapp.com'].includes(u.hostname.toLowerCase()) && /^\/channel\/[A-Za-z0-9]{10,40}$/.test(path)) return `https://whatsapp.com${path}`;
    if (kind === 'wa' && u.hostname.toLowerCase() === 'chat.whatsapp.com' && /^\/[A-Za-z0-9]{10,40}$/.test(path)) return `https://chat.whatsapp.com${path}`;
  } catch { /* invalid URL */ }
  return '';
}

export function initialArmyState() {
  return {
    monitorOn: true, monitorUpdatedAt: 0, monitorSourcesUpdatedAt: 0, manualSources: {},
    sources: Object.fromEntries(ARMY_MONITOR_SOURCES.map((s) => [s.u, { lastId: null, initialized: false, lastCheck: null, lastError: null }])),
    pending: {}, published: {}, decisions: {}, deleted: {}, seen: {}, fingerprints: {},
    channels: { tg: '', wa: '', updatedAt: 0 }, adminDrafts: {},
  };
}

export function armyState(root = store.state) {
  root.army ||= initialArmyState();
  const j = root.army;
  if (typeof j.monitorOn !== 'boolean') j.monitorOn = true;
  j.monitorUpdatedAt = Number(j.monitorUpdatedAt) || 0;
  j.monitorSourcesUpdatedAt = Number(j.monitorSourcesUpdatedAt) || 0;
  const manualSources = {};
  for (const row of Object.values(j.manualSources && typeof j.manualSources === 'object' ? j.manualSources : {})) {
    const normalized = normalizeManualArmySource(row);
    if (normalized.ok && !ARMY_MONITOR_SOURCES.some((source) => source.u.toLowerCase() === normalized.source.u.toLowerCase())) manualSources[normalized.source.u] = normalized.source;
  }
  j.manualSources = manualSources;
  j.sources = j.sources && typeof j.sources === 'object' ? j.sources : {};
  for (const source of armyMonitorSources(j)) {
    j.sources[source.u] = j.sources[source.u] && typeof j.sources[source.u] === 'object' ? j.sources[source.u] : {};
    const status = j.sources[source.u];
    status.lastId = Number.isFinite(Number(status.lastId)) ? Number(status.lastId) : null;
    status.initialized = status.initialized === true;
    status.lastCheck = status.lastCheck || null;
    status.lastError = status.lastError ? String(status.lastError).slice(0, 160) : null;
  }
  for (const key of ['pending', 'published', 'decisions', 'deleted', 'seen', 'fingerprints', 'adminDrafts']) {
    j[key] = j[key] && typeof j[key] === 'object' ? j[key] : {};
  }
  const channels = j.channels && typeof j.channels === 'object' ? j.channels : {};
  j.channels = {
    tg: normalizeArmyChannelLink('tg', channels.tg) || '',
    wa: normalizeArmyChannelLink('wa', channels.wa) || '',
    updatedAt: Number(channels.updatedAt) || 0,
  };
  return j;
}

const SALARY_TERMS = /(?:رواتب|راتب|اجور|مرتبات|تعويضات|علاوات|منحه ماليه|صرف المستحقات|salary|salaries|payroll|wages|pay raise|pay increase)/iu;
const RECRUITMENT_TERMS = /(?:انتساب|التحاق|التجنيد|تجنيد|التطوع|تطوع|متطوع|دوره افراد|recruitment|enlistment|recruiting|recruits?|volunteer(?:ing)?)/iu;
const CLEAR_RECRUITMENT = /(?:فتح باب الانتساب|دوره افراد|التجنيد|انتساب.{0,55}(?:الجيش|الشرطه|القوات المسلحه|عسكري)|التحاق.{0,55}(?:الجيش|الشرطه|القوات المسلحه|عسكري)|(?:التطوع|تطوع).{0,55}(?:الجيش|الشرطه|القوات المسلحه|عسكري)|(?:army|police|security|armed forces).{0,55}(?:enlistment|recruitment|recruit|volunteer|join))/iu;
const MILITARY_CONTEXT = /(?:الجيش|القوات المسلحه|وزاره الدفاع|وزاره الداخليه|عسكري|جندي|الشرطه|قوى الامن الداخلي|الامن العام|قوات الامن|المهام الخاصه|القوات الخاصه|army|armed forces|military|police|security forces|soldier)/iu;
const MILITARY_PAY_CONTEXT = /(?:الجيش|القوات المسلحه|عسكري|جندي|الشرطه|شرطي|قوى الامن الداخلي|الامن العام|قوات الامن|القوات الخاصه|الامن|army|armed forces|military personnel|military|police|security forces|soldier)/iu;
const CIVIL_WORK = /(?:شواغر|وظائف|وظيفه|فرص عمل|vacanc(?:y|ies)|job openings|hiring|employment|positions?)/iu;
const CIVIL_ACTIVITY = /(?:حمله|مبادره|حديقه|تشجير|تنظيف|صيانة|صيانه|تجميل|community campaign|park cleanup|civil volunteer)/iu;
const OFFICIAL_MILITARY_SOURCES = new Set(['sy_defense', 'syrararmy', 'syrianmoi']);

function hasOfficialApplicationLink(text, links, sourceUsername) {
  const allLinks = [...(Array.isArray(links) ? links : []), ...(String(text || '').match(URL_RE) || [])].map(safeHttps).filter(Boolean);
  const officialDomain = allLinks.some((url) => /(?:\.gov\.sy|\.moi-sy\.com)(?:\/|$)/i.test(new URL(url).hostname));
  const officialSourceLink = OFFICIAL_MILITARY_SOURCES.has(String(sourceUsername || '').toLowerCase()) && allLinks.length > 0;
  return officialDomain || officialSourceLink;
}

export function salaryNewsKind(text, sourceUsername = '', links = []) {
  const n = norm(text);
  const salary = SALARY_TERMS.test(n) && MILITARY_PAY_CONTEXT.test(n);
  const recruitment = RECRUITMENT_TERMS.test(n) && (MILITARY_CONTEXT.test(n) || CLEAR_RECRUITMENT.test(n));
  if (CIVIL_WORK.test(n) && !CLEAR_RECRUITMENT.test(n)) return false;
  if (CIVIL_ACTIVITY.test(n) && !CLEAR_RECRUITMENT.test(n)) return false;
  return salary || recruitment || (RECRUITMENT_TERMS.test(n) && hasOfficialApplicationLink(text, links, sourceUsername) && MILITARY_CONTEXT.test(n));
}

export function inferArmyCategory(text, sourceUsername = '', links = []) {
  const n = norm(text);
  if (!salaryNewsKind(text, sourceUsername, links)) return null;
  const source = String(sourceUsername || '').toLowerCase();
  const recruitment = RECRUITMENT_TERMS.test(n) && (MILITARY_CONTEXT.test(n) || CLEAR_RECRUITMENT.test(n));
  const special = /(?:المهام الخاصه|العمليات الخاصه|قوات خاصه|وحدات خاصه|special forces|special mission)/iu.test(n);
  const units = /(?:فرقه عسكريه|الفرق العسكريه|الفرقه|اللواء|الكتائب|كتيبه|فوج|وحدات عسكريه|military unit|brigade|battalion)/iu.test(n);
  const police = /(?:الشرطه|شرطي|وزاره الداخليه|قوى الامن الداخلي|police)/iu.test(n) || source === 'syrianmoi';
  const security = /(?:الاستخبارات|الامن العام|قوات الامن|الامن الداخلي|security)/iu.test(n);
  const hasSalary = SALARY_TERMS.test(n);
  if (special) return 'special';
  if (units) return 'units';
  if (recruitment && hasOfficialApplicationLink(text, links, source)) return 'official_links';
  if (recruitment) return 'recruitment';
  if (police) return 'police';
  if (security) return 'security';
  if (hasSalary && MILITARY_PAY_CONTEXT.test(n)) return 'army';
  return null;
}

function armySourceUsername(item) {
  const keyMatch = String(item?.sourceKey || '').match(/^telegram:([^:]+):/i);
  if (keyMatch) return keyMatch[1];
  try {
    const url = new URL(item?.sourceUrl || '');
    if (['t.me', 'www.t.me'].includes(url.hostname.toLowerCase())) return url.pathname.split('/').filter(Boolean)[0] || '';
  } catch { /* no source username */ }
  return String(item?.sourceUsername || '');
}

export function armyFingerprint(text, _category = '') {
  const normalized = norm(String(text || '').replace(URL_RE, ' '));
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

export function createPendingArmyItem(input, j = armyState(), now = Date.now()) {
  const text = String(input?.text || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, MAX_TEXT);
  if (text.length < 10) return { duplicate: false, item: null, error: 'text_required' };
  const applicationDeadline = normalizeApplicationDeadline(input?.applicationDeadline);
  if (input?.applicationDeadline && !applicationDeadline) return { duplicate: false, item: null, error: 'deadline_invalid' };
  const sourceUrl = safeHttps(input.sourceUrl);
  if (input.kind !== 'manual' && !sourceUrl) return { duplicate: false, item: null, error: 'source_required' };
  const inferredCategory = inferArmyCategory(`${input.title || ''}\n${text}`, input.sourceUsername || '', input.links || []);
  if (!inferredCategory) return { duplicate: false, item: null, error: 'not_army_related' };
  const category = isPublicArmyCategory(input.category) ? input.category : inferredCategory;
  const fingerprint = armyFingerprint(text, category);
  const sourceKey = String(input.sourceKey || `manual:${fingerprint}`).slice(0, 180);
  if (j.seen[sourceKey]) return { duplicate: true, item: null, duplicateOf: j.seen[sourceKey].id || null };
  const old = j.fingerprints[fingerprint];
  if (old) {
    j.seen[sourceKey] = { status: 'duplicate', id: old.id || null, fingerprint, at: now };
    return { duplicate: true, item: null, duplicateOf: old.id || null };
  }
  const id = uidFrom(sourceKey);
  const kind = input.kind === 'manual' ? 'manual' : input.kind === 'media_source' ? 'media_source' : 'official_source';
  const item = {
    id, kind, sourceKey, fingerprint, category,
    ...(category !== inferredCategory ? { categoryOverride: true } : {}),
    title: clean(input.title || titleFromText(text), 120) || 'تحديث رسمي',
    text,
    sourceName: clean(input.sourceName || (kind === 'manual' ? 'إضافة الإدارة' : 'مصدر رسمي'), 100),
    sourceUrl,
    links: safeLinks(input.links || linksFromText(text)),
    ...(applicationDeadline ? { applicationDeadline } : {}),
    createdAt: now, status: 'pending', notifiedAt: null, cards: [],
  };
  j.pending[id] = item;
  j.seen[sourceKey] = { status: 'pending', id, fingerprint, at: now };
  j.fingerprints[fingerprint] = { status: 'pending', id, at: now };
  return { duplicate: false, item };
}

export function decideArmyItem(id, action, j = armyState(), by = null, now = Date.now()) {
  const item = j.pending[id];
  if (!item) return { ok: false, item: null, decision: j.decisions[id] || null };
  const outcome = action === 'approve' ? 'approved' : action === 'ignore' ? 'ignored' : null;
  if (!outcome) return { ok: false, item: null, decision: null };
  delete j.pending[id];
  item.status = outcome;
  item.decidedAt = now;
  item.decidedBy = by == null ? null : Number(by) || null;
  const decision = { id, action: outcome, decidedAt: now, decidedBy: item.decidedBy, fingerprint: item.fingerprint, sourceKey: item.sourceKey };
  j.decisions[id] = decision;
  if (outcome === 'approved') {
    item.publishedAt = new Date(now).toISOString();
    j.published[id] = item;
  } else delete j.published[id];
  if (j.seen[item.sourceKey]) j.seen[item.sourceKey] = { ...j.seen[item.sourceKey], status: outcome, id, at: now };
  if (j.fingerprints[item.fingerprint]) j.fingerprints[item.fingerprint] = { ...j.fingerprints[item.fingerprint], status: outcome, id, at: now };
  return { ok: true, item, decision };
}

export function updateArmyItem(id, patch, j = armyState(), by = null, now = Date.now()) {
  const item = j.pending[id] || j.published[id];
  if (!item || j.deleted[id]) return { ok: false, error: 'not_found' };
  if (patch.title !== undefined) {
    const title = clean(patch.title, 120);
    if (title.length < 3) return { ok: false, error: 'title_required' };
    item.title = title;
  }
  if (patch.text !== undefined) {
    const text = String(patch.text || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, MAX_TEXT);
    if (text.length < 10) return { ok: false, error: 'text_too_short' };
    const fingerprint = armyFingerprint(text);
    const duplicate = j.fingerprints[fingerprint];
    if (duplicate && duplicate.id !== id) return { ok: false, error: 'duplicate_content' };
    j.fingerprints[fingerprint] = { status: item.status, id, at: now };
    if (item.sourceKey && j.seen[item.sourceKey]) j.seen[item.sourceKey] = { ...j.seen[item.sourceKey], fingerprint, at: now };
    if (j.decisions[id]) j.decisions[id] = { ...j.decisions[id], fingerprint };
    item.fingerprint = fingerprint;
    item.text = text;
    item.links = safeLinks(patch.links || linksFromText(text));
  }
  if (patch.category !== undefined) {
    if (!isCategory(patch.category)) return { ok: false, error: 'category_invalid' };
    item.category = patch.category;
    item.categoryOverride = true;
  }
  if (patch.sourceUrl !== undefined) {
    const url = safeHttps(patch.sourceUrl);
    if (!url) return { ok: false, error: 'source_invalid' };
    item.sourceUrl = url;
  }
  if (patch.applicationDeadline !== undefined) {
    const deadline = normalizeApplicationDeadline(patch.applicationDeadline);
    if (patch.applicationDeadline != null && patch.applicationDeadline !== '' && !deadline) return { ok: false, error: 'deadline_invalid' };
    if (deadline) item.applicationDeadline = deadline; else delete item.applicationDeadline;
  }
  item.updatedAt = now;
  if (by != null) item.updatedBy = Number(by) || null;
  return { ok: true, item };
}

export function deleteArmyItem(id, j = armyState(), by = null, now = Date.now()) {
  const item = j.pending[id] || j.published[id];
  if (!item || j.deleted[id]) return { ok: false, item: null };
  delete j.pending[id]; delete j.published[id];
  const tombstone = { id, action: 'deleted', deletedAt: now, deletedBy: by == null ? null : Number(by) || null, fingerprint: item.fingerprint, sourceKey: item.sourceKey };
  j.deleted[id] = tombstone;
  j.decisions[id] = { id, action: 'deleted', decidedAt: now, decidedBy: tombstone.deletedBy, fingerprint: item.fingerprint, sourceKey: item.sourceKey };
  if (item.sourceKey && j.seen[item.sourceKey]) j.seen[item.sourceKey] = { ...j.seen[item.sourceKey], status: 'deleted', id, at: now };
  if (item.fingerprint && j.fingerprints[item.fingerprint]) j.fingerprints[item.fingerprint] = { ...j.fingerprints[item.fingerprint], status: 'deleted', id, at: now };
  return { ok: true, item, tombstone };
}

export function setArmyChannel(kind, raw, j = armyState(), now = Date.now()) {
  if (!['tg', 'wa'].includes(kind)) return { ok: false, error: 'channel_kind' };
  const url = normalizeArmyChannelLink(kind, raw);
  if (!url) return { ok: false, error: 'channel_url' };
  j.channels[kind] = url;
  j.channels.updatedAt = now;
  return { ok: true, url };
}

export function clearArmyChannel(kind, j = armyState(), now = Date.now()) {
  if (!['tg', 'wa'].includes(kind)) return false;
  j.channels[kind] = '';
  j.channels.updatedAt = now;
  return true;
}

export function publicArmy(j = armyState(), now = Date.now()) {
  const items = Object.values(j.published || {})
    .filter((item) => item && item.status === 'approved' && !j.deleted?.[item.id] && !isApplicationDeadlineExpired(item.applicationDeadline, now))
    .map((item) => {
      const inferred = inferArmyCategory(`${item.title || ''}\n${item.text || ''}`, armySourceUsername(item), item.links || []);
      const category = inferred && item.categoryOverride && isPublicArmyCategory(item.category) ? item.category : inferred;
      return category ? { item, category } : null;
    }).filter(Boolean)
    .sort((a, b) => Date.parse(b.item.publishedAt || 0) - Date.parse(a.item.publishedAt || 0))
    .slice(0, 100)
    .map(({ item, category }) => ({
      id: item.id, category, title: cleanPublicArmyText(item.title) || item.title,
      text: cleanPublicArmyText(item.text).replace(/https?:\/\/[^\s<>]+/gi, (raw) => armySourceRelatedLink(raw.replace(/[),.;!?]+$/, ''), item.sourceUrl) ? '' : raw).trim(),
      links: publicArmyLinks(item),
      application_deadline: item.applicationDeadline || null,
      created_at: item.createdAt || null, updated_at: item.updatedAt || null, published_at: item.publishedAt || null,
    }));
  return {
    categories: Object.entries(ARMY_CATEGORIES).filter(([, row]) => row.public !== false).map(([id, row]) => ({ id, ...row })),
    items,
    channels: { tg: j.channels.tg || '', wa: j.channels.wa || '' },
  };
}

export function mergeArmyFromBackup(snapshot, j = armyState()) {
  const remote = snapshot?.army;
  if (!remote || typeof remote !== 'object') return false;
  const before = JSON.stringify(j);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (Number(remote.monitorUpdatedAt) > Number(j.monitorUpdatedAt)) {
    j.monitorOn = remote.monitorOn !== false;
    j.monitorUpdatedAt = Number(remote.monitorUpdatedAt) || 0;
  }
  if (Number(remote.channels?.updatedAt) > Number(j.channels.updatedAt)) {
    j.channels = {
      tg: normalizeArmyChannelLink('tg', remote.channels?.tg) || '',
      wa: normalizeArmyChannelLink('wa', remote.channels?.wa) || '',
      updatedAt: Number(remote.channels?.updatedAt) || 0,
    };
  }
  if (Number(remote.monitorSourcesUpdatedAt) > Number(j.monitorSourcesUpdatedAt)) {
    const rows = {};
    for (const row of Object.values(remote.manualSources && typeof remote.manualSources === 'object' ? remote.manualSources : {})) {
      const normalized = normalizeManualArmySource(row);
      if (normalized.ok && !ARMY_MONITOR_SOURCES.some((source) => source.u.toLowerCase() === normalized.source.u.toLowerCase())) rows[normalized.source.u] = normalized.source;
    }
    j.manualSources = rows; j.monitorSourcesUpdatedAt = Number(remote.monitorSourcesUpdatedAt) || 0;
  }
  for (const source of armyMonitorSources(j)) {
    const current = j.sources[source.u] || (j.sources[source.u] = {});
    const row = remote.sources?.[source.u];
    if (!row) continue;
    if (Number(row.lastId) > Number(current.lastId || 0)) { current.lastId = Number(row.lastId); current.initialized = true; }
    if (row.initialized && !current.initialized) { current.lastId = Number(row.lastId) || 0; current.initialized = true; }
    if (Date.parse(row.lastCheck || 0) > Date.parse(current.lastCheck || 0)) { current.lastCheck = row.lastCheck; current.lastError = row.lastError || null; }
  }
  for (const [uid, draft] of Object.entries(remote.adminDrafts || {})) {
    if (!draft || Date.now() - Number(draft.updatedAt || draft.createdAt || 0) > 6 * 3600_000) continue;
    const mine = j.adminDrafts[uid];
    if (!mine || Number(draft.updatedAt || draft.createdAt) > Number(mine.updatedAt || mine.createdAt)) j.adminDrafts[uid] = draft;
  }
  for (const [id, row] of Object.entries(remote.deleted || {})) {
    if (!row) continue;
    if (!j.deleted[id] || Number(row.deletedAt) > Number(j.deleted[id].deletedAt)) j.deleted[id] = row;
    delete j.pending[id]; delete j.published[id];
    j.decisions[id] = { id, action: 'deleted', decidedAt: Number(j.deleted[id].deletedAt) || Date.now(), decidedBy: j.deleted[id].deletedBy || null, fingerprint: j.deleted[id].fingerprint, sourceKey: j.deleted[id].sourceKey };
  }
  for (const [id, decision] of Object.entries(remote.decisions || {})) {
    if (!decision) continue;
    const local = j.decisions[id];
    if (j.deleted[id] || decision.action === 'deleted' || local?.action === 'deleted') continue;
    if (decision.action === 'ignored' || local?.action === 'ignored') {
      const selected = local?.action === 'ignored' ? local : decision;
      j.decisions[id] = selected; delete j.pending[id]; delete j.published[id];
    } else if (!local || Number(decision.decidedAt) < Number(local.decidedAt)) j.decisions[id] = decision;
  }
  for (const [id, item] of Object.entries(remote.published || {})) {
    if (!item || j.deleted[id] || remote.deleted?.[id] || j.decisions[id]?.action === 'ignored' || remote.decisions?.[id]?.action === 'ignored') continue;
    const local = j.published[id];
    const version = (x) => Number(x?.updatedAt) || Date.parse(x?.publishedAt || 0) || Number(x?.decidedAt) || 0;
    const selected = local && version(local) > version(item) ? local : item;
    if (selected.status === 'approved') {
      const row = { ...selected, status: 'approved' };
      if (!same(j.published[id], row)) j.published[id] = row;
      delete j.pending[id];
      j.decisions[id] ||= remote.decisions?.[id] || { id, action: 'approved', decidedAt: Date.parse(item.publishedAt || 0) || 0, sourceKey: item.sourceKey, fingerprint: item.fingerprint };
    }
  }
  for (const [id, item] of Object.entries(remote.pending || {})) {
    if (!item || j.deleted[id] || j.decisions[id] || j.pending[id] || j.published[id]) continue;
    const prior = item.fingerprint && j.fingerprints[item.fingerprint];
    if (prior && prior.id !== id) continue;
    j.pending[id] = item;
    if (item.sourceKey) j.seen[item.sourceKey] ||= { status: 'pending', id, fingerprint: item.fingerprint, at: item.createdAt };
    if (item.fingerprint) j.fingerprints[item.fingerprint] ||= { status: 'pending', id, at: item.createdAt };
  }
  for (const [key, value] of Object.entries(remote.seen || {})) if (!j.seen[key]) j.seen[key] = value;
  for (const [key, value] of Object.entries(remote.fingerprints || {})) if (!j.fingerprints[key]) j.fingerprints[key] = value;
  const changed = before !== JSON.stringify(j);
  if (changed && j === armyState()) {
    store.persist();
    store.emit('army', publicArmy());
  }
  return changed;
}

export async function pollArmyOnce({ j = armyState(), fetcher = fetchChannel, notify = async () => {}, now = Date.now() } = {}) {
  if (!j.monitorOn) return { skipped: true, newItems: 0, checkedPosts: 0 };
  let baseline = false; let newItems = 0; let checkedPosts = 0; const errors = [];
  for (const source of armyMonitorSources(j)) {
    const cursor = j.sources[source.u] || (j.sources[source.u] = { lastId: null, initialized: false, lastCheck: null, lastError: null });
    let result;
    try {
      result = await fetcher(source.u, cursor.initialized && cursor.lastId != null ? { afterId: cursor.lastId } : {});
    } catch (e) {
      cursor.lastCheck = new Date(now).toISOString();
      cursor.lastError = (e.code === 'nopreview' ? 'no public preview' : String(e.message || e)).slice(0, 160);
      errors.push({ source: source.u, error: cursor.lastError });
      continue;
    }
    cursor.lastCheck = new Date(now).toISOString(); cursor.lastError = null;
    if (result?.complete === false) {
      cursor.lastError = 'catch-up exceeds page limit; checkpoint preserved';
      errors.push({ source: source.u, error: cursor.lastError });
      continue;
    }
    const posts = Array.isArray(result?.posts) ? result.posts : [];
    const maxId = posts.reduce((max, post) => Math.max(max, Number(post.id) || 0), Number(cursor.lastId) || 0);
    if (!cursor.initialized) {
      cursor.lastId = maxId; cursor.initialized = true; baseline = true;
      continue; // Never import old posts on first startup.
    }
    const fresh = posts.filter((post) => Number(post.id) > Number(cursor.lastId || 0)).sort((a, b) => Number(a.id) - Number(b.id));
    for (const post of fresh) {
      const text = String(post.text || '').trim();
      const key = `telegram:${source.u}:${post.id}`;
      if (text && salaryNewsKind(text, source.u, post.links || []) && post.ts && now - Number(post.ts) <= MAX_SOURCE_AGE) {
        const made = createPendingArmyItem({
          kind: source.type === 'media' ? 'media_source' : 'official_source', sourceKey: key, sourceUsername: source.u,
          category: inferArmyCategory(text, source.u, post.links || []), title: titleFromText(text), text,
          sourceName: source.name, sourceUrl: post.url || `${source.url}/${post.id}`, links: post.links || [],
        }, j, now);
        if (made.item) {
          newItems++;
          try { await notify(made.item); } catch (e) { console.warn('[army] review notification failed', e.description || e.message); }
        }
      }
      cursor.lastId = Math.max(Number(cursor.lastId) || 0, Number(post.id) || 0);
      checkedPosts++;
    }
    if (posts.length) cursor.lastId = Math.max(Number(cursor.lastId) || 0, maxId);
  }
  return { baseline, newItems, checkedPosts, errors };
}

let active = false;
let running = false;
let timer = null;
let deadlineTimer = null;
let lastExpiredArmyIds = null;
let adminApi = null;

export function setArmyAdminApi(api) { adminApi = api || null; }

function reviewText(item, english = false) {
  const category = ARMY_CATEGORIES[item.category] || ARMY_CATEGORIES.army;
  const links = (item.links || []).map((url, i) => `<a href="${escHtml(url)}">${english ? `Link ${i + 1}` : `رابط ${i + 1}`}</a>`).join(' · ');
  const ar = !english;
  const media = item.kind === 'media_source';
  return [
    `<b>${category.icon} ${ar ? (media ? 'إشارة من مصدر إعلامي — تحقّق قبل الاعتماد' : 'خبر من مصدر رسمي — بانتظار مراجعتك') : (media ? 'Media report — verify before approval' : 'Official-source item — awaiting your review')}</b>`,
    `${ar ? 'الفئة' : 'Category'}: <b>${escHtml(ar ? category.ar : category.en)}</b>`,
    `${ar ? 'المصدر' : 'Source'}: <a href="${escHtml(item.sourceUrl)}">${escHtml(item.sourceName)}</a>`,
    '', `<b>${escHtml(item.title)}</b>`, escHtml(item.text.slice(0, 2200)),
    links ? `${ar ? 'روابط وردت في المنشور' : 'Links found in the post'}: ${links}` : '',
    item.sourceUrl ? `<a href="${escHtml(item.sourceUrl)}">${ar ? 'فتح المنشور الأصلي' : 'Open original post'}</a>` : '',
    '', `<i>${ar ? (media ? 'هذا رصد إعلامي وليس تأكيداً رسمياً؛ تحقّق من الجهة الأولية قبل الاعتماد. لن يظهر على الموقع/الخريطة إلا بعد موافقتك.' : 'لن يظهر على الموقع/الخريطة إلا بعد اعتمادك. لن يُنشر في قناة الأخبار أو تيليغرام/واتساب.') : (media ? 'This is a media signal, not official confirmation; verify with a primary source before approval. It remains off the website/map until you approve it.' : 'It stays off the website/map until you approve it. It is never posted to the news channel or Telegram/WhatsApp.')}</i>`,
  ].filter(Boolean).join('\n');
}

export async function notifyArmyPending(item, { force = false } = {}) {
  const j = armyState();
  const current = j.pending[item?.id];
  if (!current || (!force && current.notifiedAt)) return false;
  const ids = [...new Set((config.ownerIds || []).map(Number).filter(Number.isFinite))];
  if (!adminApi || !ids.length) return false;
  let success = 0;
  for (const owner of ids) {
    try {
      const sent = await adminApi.sendMessage(owner, reviewText(current, false), {
        parse_mode: 'HTML', reply_markup: armyReviewKeyboard(current, false),
        link_preview_options: { is_disabled: true },
      });
      current.cards ||= [];
      if (sent?.message_id && !current.cards.some(([chat, mid]) => Number(chat) === owner && Number(mid) === Number(sent.message_id))) current.cards.push([owner, Number(sent.message_id)]);
      success++;
    } catch (e) { console.warn('[army] owner review message failed', e.description || e.message); }
  }
  if (success) { current.notifiedAt = Date.now(); store.persist(); }
  return success > 0;
}

export function armyReviewKeyboard(item, english = false) {
  const category = ARMY_CATEGORIES[item.category] || ARMY_CATEGORIES.army;
  const kb = new InlineKeyboard()
    .text(english ? '✅ Approve for website/map only' : '✅ اعتماد للموقع والخريطة فقط', `army:approve:${item.id}`).row()
    .text(english ? '✏️ Edit title' : '✏️ تعديل العنوان', `army:edit:title:${item.id}`)
    .text(english ? '✏️ Edit text' : '✏️ تعديل النص', `army:edit:text:${item.id}`).row()
    .text(english ? `${category.icon} Change category` : `${category.icon} تغيير الفئة`, `army:edit-category:${item.id}`)
    .text(english ? '🚫 Ignore' : '🚫 تجاهل', `army:ignore:${item.id}`).row()
    .text(english ? '🗑 Delete' : '🗑 حذف', `army:delete:${item.id}`);
  if (item.kind === 'manual') return kb;
  return kb;
}

export function startArmyMonitor(getApi = () => null, { everyMs = POLL_MS, poller = pollArmyOnce } = {}) {
  if (active) return;
  active = true;
  lastExpiredArmyIds = Object.values(armyState().published || {}).filter((item) => isApplicationDeadlineExpired(item?.applicationDeadline)).map((item) => item.id).sort().join(',');
  deadlineTimer = setInterval(() => {
    const j = armyState();
    const next = Object.values(j.published || {}).filter((item) => isApplicationDeadlineExpired(item?.applicationDeadline)).map((item) => item.id).sort().join(',');
    if (lastExpiredArmyIds !== null && next !== lastExpiredArmyIds) store.emit('army', publicArmy(j));
    lastExpiredArmyIds = next;
  }, 60_000);
  deadlineTimer.unref?.();
  setArmyAdminApi(getApi());
  store.mergeHooks ||= [];
  if (!store.mergeHooks.includes(mergeArmyFromBackup)) store.mergeHooks.push(mergeArmyFromBackup);
  const run = async () => {
    if (!active || running) return;
    running = true;
    setArmyAdminApi(getApi());
    try {
      const j = armyState();
      if (store.backup && config.telegramBackup && Date.now() - (startArmyMonitor.lastMergeAt || 0) >= 5 * 60_000) {
        await store.mergeFromBackup().catch(() => {});
        startArmyMonitor.lastMergeAt = Date.now();
      }
      const result = await poller({ j, notify: notifyArmyPending });
      if (result.baseline || result.newItems || result.errors?.length) store.persist();
      if (result.newItems) store.emit('army', publicArmy());
      if (result.newItems) console.log(`[army] queued ${result.newItems} official-source item(s) for owner approval`);
      if (result.errors?.length) console.warn('[army] source checks with errors', result.errors.map((x) => `${x.source}:${x.error}`).join('; '));
    } catch (e) { console.error('[army] monitor failed', e.message); }
    finally { running = false; }
  };
  run();
  const schedule = () => { if (!active) return; timer = setTimeout(async () => { await run(); schedule(); }, everyMs); timer.unref?.(); };
  schedule();
}

export function stopArmyMonitor() { active = false; clearTimeout(timer); clearInterval(deadlineTimer); timer = deadlineTimer = null; running = false; }

export const _test = {
  safeHttps, safeLinks, linksFromText, titleFromText, norm, isCategory,
  POLL_MS, MAX_SOURCE_AGE, reviewText, armyReviewKeyboard,
};
