// Turns news posts into alert candidates: a cheap keyword pre-filter (no AI cost for weather/sports/
// politics), then one Gemini call per batch that says, for every post, whether it reports a NEW concrete
// event inside Syria, its type, the place(s) and a short neutral headline, and whether it is the same
// incident as an event we already know (published, pending, ignored). Places are then matched to the
// bot's own places database, so a draft always points at a real place of the map.
import { ALERT_TYPES } from '../shared/types.js';
import { governorates, districts, searchPlaces, normalizeArabic, getGov, getDist, places } from './places.js';

export const NEWS_TYPES = ['breaking', 'uav', 'warplane', 'missile', 'attack', 'artillery', 'civil', 'accident', 'protest', 'fire', 'civil_plane'];
const N = normalizeArabic;
const stripAl = (w) => (w.startsWith('ال') && w.length > 3 ? w.slice(2) : w);

// ---------------------------------------------------------------- keyword pre-filter
const KW = {
  uav: ['مسيره', 'مسيرات', 'المسيره', 'درون', 'طائره مسيره', 'طائرات مسيره', 'انتحاريه'],
  warplane: ['طيران حربي', 'الطيران الحربي', 'طائرات حربيه', 'طائره حربيه', 'غاره', 'غارات', 'قصف جوي', 'الطيران الاسرائيلي', 'تحليق'],
  missile: ['صاروخ', 'صواريخ', 'صاروخي', 'صاروخيه', 'قذيفه صاروخيه'],
  attack: ['هجوم', 'اعتداء', 'استهداف', 'استهدف', 'اطلاق نار', 'اطلاق النار', 'رصاص', 'انفجار', 'تفجير', 'عبوه', 'لغم', 'اشتباك', 'اشتباكات', 'اغتيال', 'مسلحين', 'مسلحون', 'مسلح', 'كمين', 'مقتل', 'استشهاد', 'قتلى', 'قتيل', 'جرحى', 'اصابه', 'اصابات', 'توغل', 'اقتحام', 'حاجز', 'خطف', 'اختطاف', 'جريمه'],
  artillery: ['قصف', 'مدفعي', 'مدفعيه', 'قذائف', 'قذيفه', 'هاون'],
  accident: ['حادث سير', 'حوادث سير', 'انقلاب', 'تصادم', 'دهس', 'حادث مروري'],
  fire: ['حريق', 'حرائق', 'اندلاع', 'النيران', 'اشتعال', 'اخماد'],
  protest: ['مظاهره', 'مظاهرات', 'وقفه احتجاجيه', 'احتجاج', 'احتجاجات', 'اعتصام', 'تظاهر', 'يتظاهرون', 'تخرج تضامنا'],
  civil_plane: ['طائره مدنيه', 'هبوط اضطراري', 'طائره ركاب', 'رحله جويه', 'مطار'],
  breaking: ['توغل', 'توغلت', 'توغلات', 'اقتحام', 'اقتحمت', 'حاجز تفتيش', 'مداهمه', 'حمله امنيه', 'حظر تجول', 'اختطاف', 'خطف', 'اغتيال', 'اشتباكات', 'استنفار', 'دوي',
    // foreign (mostly Israeli) army ground activity in the south: incursions, patrols, bulldozing, berms, new positions
    'الاحتلال', 'قوات الاحتلال', 'جيش الاحتلال', 'الجيش الإسرائيلي', 'القوات الإسرائيلية', 'قوة إسرائيلية', 'دورية إسرائيلية', 'آليات إسرائيلية', 'آليات عسكرية', 'دبابات', 'ميركافا',
    'جرافات', 'جرافة', 'أعمال حفر', 'أعمال الحفر', 'عمليات الحفر', 'حفر خندق', 'خنادق', 'ساتر ترابي', 'سواتر', 'تجريف', 'جرف', 'تحصينات', 'نقطة عسكرية', 'قاعدة عسكرية', 'تمركز', 'نصب حاجز', 'حاجزا', 'اعتقال', 'اعتقلت', 'رتل', 'تعزيزات عسكرية', 'انتشار عسكري', 'تفجير منزل', 'نسف'],
  civil: ['انهيار', 'غرق', 'فيضان', 'سيول', 'زلزال', 'هزه ارضيه', 'مخلفات الحرب', 'الدفاع المدني', 'انقاذ', 'تسمم', 'عاصفه'],
};
const KW_N = Object.fromEntries(Object.entries(KW).map(([k, a]) => [k, a.map(N)]));
const has = (nt, w) => nt.includes(w);
/** which types' keywords appear in the (normalized) text */
export function keywordTypes(text) {
  const nt = ' ' + N(text) + ' ';
  return Object.keys(KW_N).filter((k) => KW_N[k].some((w) => has(nt, w)));
}
// obviously not an event on the ground
const NOISE = ['اسعار', 'سعر صرف', 'الذهب', 'مباراه', 'المنتخب', 'كاس العالم', 'الدوري', 'الطقس', 'الارصاد', 'درجات الحراره', 'موجز اخبار', 'برنامج', 'الحلقه', 'لقاء خاص', 'مقابله', 'التقويم', 'تهنئه', 'ذكري', 'الذكري', 'امتحانات', 'مسابقه', 'المعرض', 'مؤتمر صحفي'].map(N);
const SY_WORDS = ['سوريا', 'سوريه', 'السوري', 'السوريه', 'سوري', 'دمشق', 'الجولان'].map(N);
// big Syrian place names (governorates, districts, rank<=2 places): a post from a general channel must name one
const BIG = new Set([...governorates.map((g) => N(g.ar)), ...districts.map((d) => N(d.ar)), ...places.filter((p) => p.rank <= 2).map((p) => N(p.ar))]
  .flatMap((n) => [n, stripAl(n)]).filter((n) => n.length >= 4 && !['المركز', 'مركز'].includes(n)));
for (const g of governorates) BIG.add(N(g.ar)); // short ones too: حلب، حمص
export function mentionsSyria(text) {
  const words = N(text).split(' ');
  const pre = (w) => [w, w.replace(/^[وبلف]/, ''), w.replace(/^(وب|وال|بال|لل|فال)/, 'ال')];
  const set = new Set(words.flatMap(pre).flatMap((w) => [w, stripAl(w)]));
  if (SY_WORDS.some((w) => set.has(w) || N(text).includes(w))) return true;
  for (let i = 0; i < words.length; i++) {
    for (const n of [words[i], words[i] + ' ' + (words[i + 1] || '')]) {
      for (const v of pre(n)) if (BIG.has(v) || BIG.has(stripAl(v))) return true;
    }
  }
  return false;
}
/** decide whether a post is worth a look by the AI at all */
export function prefilter(text, { general = false, breaking = false } = {}) {
  const t = String(text || '');
  if (t.replace(/\s/g, '').length < 25) return { ok: false, why: 'short' };
  const kt = keywordTypes(t);
  const nt = N(t);
  const noisy = NOISE.some((w) => nt.includes(w));
  if (!kt.length && !breaking) return { ok: false, why: 'no-keywords' };
  if (noisy && kt.length <= 1 && !breaking) return { ok: false, why: 'noise' };
  if (general && !mentionsSyria(t)) return { ok: false, why: 'not-syria' };
  return { ok: true, kt };
}

// ---------------------------------------------------------------- places
const GOV_ALIASES = { [N('الشام')]: '', [N('العاصمه')]: '' };
const govByName = new Map();
for (const g of governorates) { govByName.set(N(g.ar), g.code); govByName.set(stripAl(N(g.ar)), g.code); }
/** "درعا" / "ريف درعا الشرقي" / "محافظة ريف دمشق" -> governorate code */
export function govCodeOf(name) {
  let n = N(name).replace(/^محافظه /, '').trim();
  if (!n || GOV_ALIASES[n] === '') return null;
  if (govByName.has(n)) return govByName.get(n);
  n = n.replace(/ (الشرقي|الغربي|الشمالي|الجنوبي|الشمالي الشرقي|الشمالي الغربي|الجنوبي الشرقي|الجنوبي الغربي|الاوسط)$/, '');
  if (govByName.has(n)) return govByName.get(n);
  if (n.startsWith('ريف ')) { const r = n.slice(4); if (govByName.has(r)) return govByName.get(r); }
  return null;
}
const PREFIX = /^(مدينه|بلده|قريه|حي|منطقه|ناحيه|مزرعه|مخيم|جسر|طريق|اوتوستراد|اوتستراد|ساحه|سوق|محيط|قرب|بالقرب من|مدخل|اطراف|شرق|غرب|شمال|جنوب|شرقي|غربي|شمالي|جنوبي|وسط)\s+/;
function exactHits(name, govCode) {
  const q = N(name);
  if (q.length < 2) return [];
  const qs = stripAl(q);
  return searchPlaces(name, 40).filter((p) => !p.scope && (!govCode || p.gov === govCode)
    && [p.ar, ...(p.alt || [])].some((x) => { const n = N(x); return n === q || stripAl(n) === qs || n.replace(/\s/g, '') === q.replace(/\s/g, ''); }));
}
/**
 * One AI place -> a location of the map: { kind: 'place'|'district'|'governorate', placeId|distCode|govCode }.
 * Only exact name matches (inside the stated governorate when there is one): never a guess.
 */
export function resolvePlace({ name, gov } = {}) {
  const g = gov ? govCodeOf(gov) : null;
  const raw = String(name || '').trim();
  if (!raw) return g ? { kind: 'governorate', govCode: g } : null;
  const asGov = govCodeOf(raw);
  if (asGov && (!g || g === asGov)) {
    // "درعا" can be the city or the governorate: the city when name and governorate are the same word
    // (AI: {name:"درعا", gov:"درعا"}); "ريف درعا الشرقي" / "ريف دمشق" stay the governorate
    const city = N(raw) === N(getGov(asGov).ar) ? exactHits(raw, asGov).sort((a, b) => a.rank - b.rank)[0] : null;
    if (g && city && city.rank <= 2) return { kind: 'place', placeId: city.id };
    return { kind: 'governorate', govCode: asGov };
  }
  const tries = [raw];
  let s = N(raw);
  for (let i = 0; i < 3 && PREFIX.test(s); i++) { s = s.replace(PREFIX, ''); tries.push(s); }
  for (const t of tries) {
    const dist = districts.find((d) => (!g || d.gov === g) && [N(d.ar), stripAl(N(d.ar))].includes(stripAl(N(t))) && places.some((p) => p.dist === d.code));
    const hits = exactHits(t, g);
    if (hits.length) {
      const govs = new Set(hits.map((p) => p.gov));
      if (!g && govs.size > 1) continue; // same name in several governorates and none given: don't guess
      hits.sort((a, b) => a.rank - b.rank);
      return { kind: 'place', placeId: hits[0].id };
    }
    if (dist) return { kind: 'district', distCode: dist.code };
  }
  return g ? { kind: 'governorate', govCode: g } : null;
}
// generic words that are also village names somewhere: never matched from free text
const GENERIC = new Set(['الشرقي', 'الغربي', 'الشمالي', 'الجنوبي', 'المدينه', 'البلده', 'القريه', 'الطريق', 'المركز', 'الحاجز', 'السوق', 'المشفي', 'المستشفي', 'الجسر', 'الدوار', 'المنطقه', 'الريف', 'الحدود', 'الاحد', 'الاثنين', 'الثلاثاء', 'الاربعاء', 'الخميس', 'الجمعه', 'السبت', 'اليوم', 'مساء', 'صباح', 'عنصر', 'عناصر', 'الامن', 'قوات', 'الجيش', 'الاحتلال', 'مسلحين', 'مدنيين', 'اصابه', 'مقتل', 'حادث', 'سير', 'هجوم', 'قصف', 'انفجار'].map(N));
/** exact names of villages/towns of one governorate that appear as words in the text (most specific first) */
export function scanTextPlaces(text, govCode, max = 3) {
  if (!govCode) return [];
  const words = N(text).split(' ');
  const out = [];
  for (let i = 0; i < words.length && out.length < max; i++) {
    for (const len of [3, 2, 1]) {
      const raw = words.slice(i, i + len).join(' ');
      // as written first ("بلودان"), then without a joined prefix ("بدرعا" -> "درعا", "والصنمين" -> "الصنمين")
      const variants = [...new Set([raw, raw.replace(/^(وب|وال|بال|لل|فال)/, 'ال'), raw.replace(/^[وبل](?=\S{3})/, '')])];
      let hits = [];
      for (const cand of variants) {
        if (cand.length < 4 || GENERIC.has(cand) || GENERIC.has(stripAl(cand)) || govCodeOf(cand)) continue;
        hits = exactHits(cand, govCode);
        if (hits.length) break;
      }
      if (!hits.length) continue;
      if (!out.includes(hits[0].id)) out.push(hits[0].id);
      i += len - 1; break;
    }
  }
  return out;
}
/** a place name must really be in the post (no hallucinated places) */
export function nameInText(name, text) {
  const nt = ' ' + N(text) + ' ';
  const n = N(name).replace(PREFIX, '');
  if (!n) return false;
  if (nt.includes(n) || nt.includes(stripAl(n))) return true;
  const first = n.split(' ').find((w) => w.length >= 3);
  return !!first && nt.includes(stripAl(first));
}

// ---------------------------------------------------------------- Gemini
const TYPE_HELP = `- uav: drone (مسيّرة) seen / striking / shot down over a Syrian area
- warplane: military aircraft activity or air strike (طيران حربي، غارة جوية)
- missile: missiles/rockets launched at, falling on or intercepted over a Syrian area
- attack: armed attack, shooting at people/checkpoint, explosion, IED, car bomb, assassination, clashes, armed kidnapping, a military incursion/raid by a foreign army into a Syrian village (e.g. Israeli forces storming/raiding a village, searching homes, arresting or shooting at people, blowing up a house)
- artillery: artillery / mortar / rocket-launcher shelling (قصف مدفعي، قذائف هاون)
- accident: traffic accident (حادث سير، انقلاب، تصادم، دهس)
- fire: fire (حريق) of a building, forest, crops, market…
- protest: demonstration, protest, sit-in (مظاهرة، وقفة احتجاجية)
- civil_plane: civil aircraft incident (emergency landing, crash)
- civil: other civil emergency: building collapse, drowning, flood, earthquake, landmine/war-remnant explosion hurting civilians, mass poisoning
- breaking: another urgent, major security or humanitarian event in Syria that people need to know right now and that has none of the types above (e.g. curfew, road closed for security, major security operation starting, foreign forces setting up a checkpoint inside Syria). Israeli army ground activity inside Syria WITHOUT a raid or shooting IS an event of this type: vehicles/tanks/a patrol advancing near or into an area, bulldozing land or uprooting trees, digging trenches, building earth berms (سواتر ترابية) or fortifications, resuming excavation, setting up a new position — mostly in Quneitra / Daraa countryside / Mount Hermon (جبل الشيخ). It counts even when it is an ongoing or resumed activity, as long as the post reports it now.`;
export function buildPrompt(items, known, nowIso) {
  const sys = `You are the news desk of "Red Alert Syria", a live alert map of Syria. You read short posts from Syrian news channels and decide which ones should become a map alert.
For EACH post return one object. Rules:
1. event=true ONLY if the post reports a concrete incident that is happening now or happened in the last hours INSIDE Syria, at a nameable place. event=false for: statements, politics, diplomacy, meetings, economy, prices, sports, weather forecasts, analysis, interviews, reports/documentaries, anniversaries, statistics, aid deliveries, returns of displaced people, arrests or trials as such, condemnations, and anything outside Syria (Lebanon, Iraq, Israel, Palestine, Yemen, Saudi Arabia, Iran, Turkey… even if it mentions Syrians). Israeli army activity INSIDE Syrian territory (Quneitra, Daraa, Rif Dimashq, the separation line with the occupied Golan, Mount Hermon) is inside Syria. Reports that only summarise many past violations (monthly counts, statistics) are not events.
2. Follow-ups are NOT new events: casualty updates ("ارتفاع حصيلة"), someone dying of wounds from an earlier incident, "the perpetrators were arrested", the hospital receiving the wounded of an incident already reported, a reporter's details/video of an incident already reported, re-posts, "again/مجدداً" reports of the same ongoing incident. For those: event=true, new_incident=false and same_as = the known event id (E…) or earlier post (P…) it follows up. Use new_incident=false only for a follow-up of an incident in KNOWN EVENTS / an earlier post, or a clear aftermath (casualty update, funeral, arrest of perpetrators) of an earlier incident; an activity that starts again after a pause ("يستأنف … بعد توقف") is a NEW incident. If a post is the same incident as a known event or an earlier post in this batch (same kind of incident, same area, close in time — even if described with different nearby village names, e.g. "حاجز مفرق خربا" = "قرب بلدة معربة" = "بصرى الشام" for one checkpoint attack in eastern Daraa countryside), set same_as to it.
3. type: the most specific of:
${TYPE_HELP}
Use "breaking" only when nothing else fits. Shooting by unknown gunmen = attack. Israeli army shelling = artillery; Israeli air strike = warplane.
4. places: where it happened, most specific first, max 4 — list every named village/town of the incident in the post (e.g. both villages of a road "طريق عين البيضة - جباتا الخشب"). name = the Arabic place name exactly as a Syrian would write it (town/village/neighbourhood; without words like "بلدة/مدينة/قرية/ريف/حي"), gov = its Syrian governorate in Arabic (one of: دمشق، ريف دمشق، حلب، حمص، حماة، اللاذقية، طرطوس، إدلب، درعا، السويداء، القنيطرة، دير الزور، الرقة، الحسكة). For a road between two cities ("أوتوستراد دمشق درعا") give the nearest named place in the post (e.g. "خبب") or the governorate. If only the governorate is known, give name = the governorate.
5. headline: one neutral Arabic sentence (max 140 characters) saying what happened and where, without the source name, hashtags or emojis.
Return a JSON array, one object per post, same order.`;
  const lines = [];
  lines.push(`Now (Damascus): ${nowIso}`);
  lines.push('', 'KNOWN EVENTS (already published, waiting for review, or dismissed):');
  if (!known.length) lines.push('(none)');
  for (const k of known) lines.push(`${k.id} | ${k.type} | ${k.where} | ${k.ago} | ${k.headline}`);
  lines.push('', 'POSTS:');
  for (const it of items) lines.push(`P${it.i} | ${it.source} | ${it.ago}\n${it.text.slice(0, 900)}\n---`);
  return { sys, user: lines.join('\n') };
}
const SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      i: { type: 'INTEGER' },
      event: { type: 'BOOLEAN' },
      type: { type: 'STRING', enum: [...NEWS_TYPES, 'none'] },
      new_incident: { type: 'BOOLEAN' },
      same_as: { type: 'STRING', nullable: true },
      places: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, gov: { type: 'STRING' } }, required: ['name'] } },
      headline: { type: 'STRING' },
    },
    required: ['i', 'event', 'type', 'new_incident', 'places', 'headline'],
  },
};
export const aiStats = { calls: 0, fails: 0, lastError: '', lastModel: '', day: '', today: 0 };
export async function callGemini({ sys, user }, { key, models, timeoutMs = 40_000, fetchImpl = fetch } = {}) {
  if (!key) throw new Error('no GEMINI_API_KEY');
  let lastErr;
  for (const m of models) {
    try {
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: SCHEMA },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${m}: HTTP ${res.status} ${(j.error?.message || '').slice(0, 120)}`);
      const txt = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      const arr = JSON.parse(txt);
      if (!Array.isArray(arr)) throw new Error(`${m}: not an array`);
      aiStats.calls++; aiStats.lastModel = m;
      return arr;
    } catch (e) {
      lastErr = e; aiStats.fails++; aiStats.lastError = String(e.message || e).replace(/key=[^&\s]+/g, 'key=…').slice(0, 200);
    }
  }
  throw lastErr || new Error('AI failed');
}

// ---------------------------------------------------------------- rule-based fallback (AI unavailable)
const RULE_ORDER = ['uav', 'warplane', 'missile', 'artillery', 'accident', 'fire', 'protest', 'civil_plane', 'attack', 'civil'];
const FOLLOW_UP = ['ارتفاع حصيله', 'ارتفاع عدد', 'القبض علي', 'قبضنا', 'القت القبض', 'تقبض علي', 'منفذي الهجوم', 'تفاصيل', 'ينقل', 'نتابع وصول', 'وصول اكثر من', 'وصول جثث'].map(N);
export function ruleClassify(text, { breaking = false } = {}) {
  const nt = N(text);
  if (FOLLOW_UP.some((w) => nt.includes(w))) return null;
  if (!mentionsSyria(text)) return null;
  const kt = keywordTypes(text);
  let type = RULE_ORDER.find((k) => kt.includes(k));
  if (type === 'civil_plane' && !nt.includes(N('طائره'))) type = kt.find((k) => k !== 'civil_plane' && RULE_ORDER.includes(k));
  if (!type && breaking) type = 'breaking';
  if (!type) return null;
  // places: governorate / district / place names that appear as words in the text
  const words = nt.split(' ');
  const found = [];
  for (let i = 0; i < words.length && found.length < 3; i++) {
    for (const len of [3, 2, 1]) {
      const cand = words.slice(i, i + len).join(' ').replace(/^[وبل](?=ال)/, '');
      if (cand.length < 3) continue;
      const hits = exactHits(cand, null);
      const g = govCodeOf(cand);
      if (g && len <= 2) { found.push({ name: cand, gov: getGov(g).ar }); i += len - 1; break; }
      if (hits.length && new Set(hits.map((p) => p.gov)).size === 1 && hits[0].rank <= 4 && cand.length >= 4) { found.push({ name: cand, gov: getGov(hits[0].gov).ar }); i += len - 1; break; }
    }
  }
  if (!found.length) return null;
  const first = text.split('\n').find((l) => l.trim().length > 15) || text;
  return { event: true, type, new_incident: true, same_as: null, places: found, headline: first.replace(/[•:]+\s*$/, '').trim().slice(0, 140), rule: true };
}
export const typeLabelAr = (k) => `${ALERT_TYPES[k]?.emoji || ''} ${ALERT_TYPES[k]?.ar || k}`.trim();
export { getGov, getDist };
