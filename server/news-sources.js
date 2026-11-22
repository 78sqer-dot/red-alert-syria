// Public Telegram channels as news sources: https://t.me/s/<username> is Telegram's public web preview of a
// channel (no account, no API key). It lists the ~20 latest posts with their id, time and text.
// Every source is read by the server itself (Render, 24/7), independent of anyone's phone.

// Default sources. `general: true` = channel also covers non-Syrian news, so a post must mention Syria
// (a Syrian place / "سوريا") before it is even considered.
export const DEFAULT_SOURCES = [
  { u: 'ajasyr', name: 'الجزيرة سوريا' },
  { u: 'alarabiya_sy', name: 'العربية سوريا' },
  { u: 'AlarabyTvSy', name: 'التلفزيون العربي - سوريا' },
  { u: 'TelevisionSyria', name: 'تلفزيون سوريا' },
  { u: 'AlekhbariahSY', name: 'الإخبارية السورية' },
  { u: 'sana_gov', name: 'وكالة الأنباء السورية (سانا)', general: true },
  { u: 'SyrSMOT', name: 'وزارة النقل السورية', general: true, roadOnly: true },
  { u: 'syrianmoi', name: 'وزارة الداخلية السورية', general: true, roadOnly: true },
  { u: 'ALMHARAR', name: 'شبكة أخبار سوريا الحرة', general: true },
  { u: 'HalabTodayTV', name: 'حلب اليوم', general: true },
  { u: 'alarabiyaBr', name: 'العربية عاجل', general: true },
  // Additional Syrian reporting and humanitarian coverage for north Syria / Idlib.
  { u: 'enabbaladi', name: 'عنب بلدي', general: true },
  { u: 'SyriaDefence', name: 'الدفاع المدني السوري', general: true, local: true },
  { u: 'HawarNews', name: 'وكالة هاوار للأنباء', general: true, local: true },
  { u: 'ZAMANALWSLnews', name: 'زمان الوصل', general: true },
  { u: 'QasiounAr1', name: 'قاسيون', general: true },
  // local / activist channels (fast regional coverage, less reliable): `local: true` = shown as
  // "محلي" in the draft card, never classified by the simple no-AI rules, and the AI is stricter with them.
  { u: 'zainaldinmaham1', name: 'زينو ياسر محاميد', general: true, local: true },
  { u: 'HoranFreeMedia', name: 'تجمع أحرار حوران', general: true, local: true },
  { u: 'daraa24_org', name: 'درعا 24', general: true, local: true },
  { u: 'D24net', name: 'دير الزور 24', general: true, local: true },
  { u: 'AbomosaabSharkea', name: 'مراسل الشرقية', general: true, local: true },
  { u: 'suhebb0', name: 'صهيب اليعربي', general: true, local: true },
  { u: 'alkhabour', name: 'الخابور', general: true, local: true },
  { u: 'syriancoast24', name: 'الساحل السوري 24', general: true, local: true },
  { u: 'SweidaGov1', name: 'محافظة السويداء', general: true, local: true },
  // Expansion batch (verified 2026-11-17: public t.me/s/ preview on, real posts present).
  // Channels without a public preview cannot be read by the monitor and are NOT listed.
  { u: 'ShaamNetwork', name: 'شبكة شام الإخبارية', general: true },
  { u: 'SouriaPost', name: 'سوريا بوست', general: true },
  { u: 'OrientNewsAR', name: 'أورينت نيوز', general: true },
  { u: 'Homs_News', name: 'حمص نيوز', general: true, local: true },
  { u: 'golantimes', name: 'جولان تايمز', general: true, local: true },
  { u: 'idlibplus', name: 'إدلب بلس', general: true, local: true },
  { u: 'FuratPost', name: 'فرات بوست', general: true, local: true },
  // 2026-11-20 expansion batch (verified public previews with fresh posts today).
  { u: 'SN4HR', name: 'الشبكة السورية لحقوق الإنسان' },
  { u: 'AlHadath', name: 'الحدث', general: true },
  { u: 'aleppocitycouncil', name: 'مجلس مدينة حلب', local: true },
];

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", rlm: '', lrm: '', zwj: '', zwnj: '', laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—' };
const unescape = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z0-9#]+);/gi, (m, k) => ENT[k] ?? m);

export const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
/** "@name", "t.me/name", "https://t.me/s/name/123" -> "name" (or null) */
export function parseUsername(input) {
  const s = String(input || '').trim();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z][A-Za-z0-9_]{3,31})(?:[/?#].*)?$/i) || s.match(/^@?([A-Za-z][A-Za-z0-9_]{3,31})$/);
  const RESERVED = /^(joinchat|addlist|share|boost|proxy|socks|login|setlanguage|addstickers|addemoji|iv|contact|invoice|giftcode)$/i;
  return m && USERNAME_RE.test(m[1]) && !RESERVED.test(m[1]) ? m[1] : null;
}

/** Parse the t.me/s/<u> page. Returns { title, posts: [{ id, ts, text, url }] } (oldest first). */
export function parseChannelPage(html, u) {
  const title = unescape((html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || '').trim();
  const posts = [];
  for (const block of html.split('<div class="tgme_widget_message_wrap').slice(1)) {
    const post = (block.match(/data-post="([^"]+)"/) || [])[1];
    if (!post) continue;
    const [chan, idStr] = post.split('/');
    // Telegram pages can contain embedded/quoted widgets. Never attribute one of those
    // to the requested feed unless its data-post username matches that exact feed.
    if (!chan || chan.toLowerCase() !== String(u).toLowerCase()) continue;
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    if (/tgme_widget_message_service/.test(block.slice(0, 400))) continue; // "channel created", pinned...
    const ts = Date.parse((block.match(/<time[^>]*datetime="([^"]+)"/) || [])[1] || '');
    // the post text (or a media caption); a quoted reply has its own smaller text block first: skip it
    const m = block.match(/<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/)
      || block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    let text = m ? m[1] : '';
    const links = [...(m?.[1] || '').matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/gi)]
      .map((x) => unescape(x[1]).replace(/&amp;/g, '&'))
      .filter((x) => /^https:\/\//i.test(x) && !/\/s\//i.test(x));
    text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => inner)
      .replace(/<[^>]+>/g, '');
    text = unescape(text).replace(/\u200f|\u200e|\u202b|\u202c/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const fwd = /tgme_widget_message_forwarded_from/.test(block);
    // Public Telegram embeds expose photos as telesco.pe background images and
    // videos as telesco.pe <video>/<source> URLs. Keep only public HTTPS CDN URLs.
    const media = [];
    const addMedia = (type, raw) => {
      const value = unescape(String(raw || '').replace(/&amp;/g, '&'));
      let parsed; try { parsed = new URL(value); } catch { return; }
      if (parsed.protocol !== 'https:' || !/^(?:cdn\d+\.)?telesco\.pe$/i.test(parsed.hostname) || parsed.username || parsed.password) return;
      const pathname = parsed.pathname.toLowerCase();
      const allowed = type === 'photo' ? /\.(?:jpe?g|png|webp)$/i.test(pathname) : /\.(?:mp4|webm)$/i.test(pathname);
      if (!allowed || media.some((item) => item.type === type)) return;
      parsed.hash = '';
      media.push({ type, url: parsed.toString() });
    };
    for (const m of block.matchAll(/<a\b[^>]*class="[^"]*tgme_widget_message_photo[^"]*"[^>]*style="[^"]*background-image:\s*url\(['"]?(https:\/\/[^'")]+)['"]?\)/gi)) addMedia('photo', m[1]);
    for (const m of block.matchAll(/<(?:video|source)\b[^>]*src="(https:\/\/[^"]+)"/gi)) addMedia('video', m[1]);
    posts.push({ id, ts: Number.isFinite(ts) ? ts : null, text, url: `https://t.me/${u}/${id}`, links, fwd, media });
  }
  posts.sort((a, b) => a.id - b.id);
  return { title, posts };
}

export async function fetchChannel(u, { timeoutMs = 15_000, fetchImpl = fetch, afterId = null, maxPages = 24 } = {}) {
  const base = `https://t.me/s/${encodeURIComponent(u)}`;
  const posts = new Map();
  let title = '';
  let before = null;
  let oldest = Infinity;
  let pages = 0;
  let complete = true;
  while (pages < (afterId == null ? 1 : maxPages)) {
    const url = before == null ? base : `${base}?before=${before}`;
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ar,en;q=0.8', Accept: 'text/html' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    // a private / unknown username redirects to t.me/<u> (no preview)
    if (res.status >= 300 && res.status < 400) { const e = new Error('no public preview'); e.code = 'nopreview'; throw e; }
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.code = 'http'; throw e; }
    const html = await res.text();
    const page = parseChannelPage(html, u);
    title ||= page.title;
    if (!page.posts.length && pages === 0 && !/tgme_channel_info/.test(html)) { const e = new Error('no public preview'); e.code = 'nopreview'; throw e; }
    pages++;
    for (const post of page.posts) { posts.set(post.id, post); oldest = Math.min(oldest, post.id); }
    if (afterId == null || !page.posts.length || oldest <= afterId) break;
    const nextBefore = oldest;
    if (nextBefore >= (before ?? Infinity)) break;
    before = nextBefore;
    if (pages >= maxPages) complete = false;
  }
  return { title, posts: [...posts.values()].sort((a, b) => a.id - b.id), complete, pages };
}

// Remove channel signatures, "subscribe" footers, links and hashtag decoration; keep the news itself.
const SIGNATURE = /(اشترك|تابعونا|انضموا|لمتابعة|للمزيد من التفاصيل|التفاصيل على الرابط|لمشاهدة الحلقة|على تلغرام|على تيليغرام|على التلغرام|على التيليجرام|قناة التليغرام|قناة التيليجرام|t\.me\/|@[A-Za-z]\w{3,}\s*$|خدمة شبكة|👇)/;
// A channel's promo block ("🔻لمتابعة زينو🔻 اضغط على الرابط 👇", "تابع قناة التلغرام", "للتواصل مع الإدارة")
// ends the news: everything from its first line on is dropped.
const PROMO_START = /^[\s\p{Extended_Pictographic}\uFE0F🔻🔺•▪️*_~-]*(لمتابعة|للمتابعة|تابعونا|تابعوا|تابع قناة|تابع صفحة|تابعو|اشترك|اشتركوا|للاشتراك|انضم|انضموا|للانضمام|للتواصل|للإعلان|للاعلان|لإعلاناتكم|رابط القناة|رابط اليوتيوب|رابط الفيسبوك|رابط الصفحة|قناتنا|صفحتنا|أخبار أكثر|اخبار اكثر|أخــبـــار|ادعم|لدعم القناة|شاركونا|راسلونا)/u;
const PROMO_LINE = /(اضغط|الرابط|على الرابط|فيسبوك|فيس بوك|يوتيوب|انستغرام|انستقرام|واتساب|واتس اب|تيك توك|بلوسكاي|Bluesky|موقعنا على|لحظة بلحظة|ANHA|Facebook|YouTube|Instagram|WhatsApp|TikTok|تفاصيل أكثر حال ورودها|التفاصيل تباعاً|بالسلامة للجميع|تابعونا)/iu;
// ANHA-style signature tail glued to the story's last sentence: «…مدينة ديرك. وكالة أنباء هاوار ANHA موقعنا على بلوسكاي…».
// Cut from the outlet signature to the end ONLY when promo words follow — a plain attribution («…حسب وكالة أنباء هاوار») is kept.
const OUTLET_TAIL = /\s+وكالة أنباء هاوار(?:\s+ANHA)?(?=[\s\S]{0,220}$)(?=[\s\S]*(?:موقعنا|بلوسكاي|واتس|لحظة بلحظة|ANHA|Bluesky))/iu;
const PROMO_TAIL = /\s*(?:موقعنا على|لحظة بلحظة عبر)[\s\S]*$/u;
// Lead duplication: outlets often repeat their lead - a short first sentence, then a
// fuller restatement («قرار رئاسي تركي يقضي بإغلاق كليات ومعاهد… في ريف حلب. قرار رئاسي
// تركي يقضي بإغلاق كليات تابعة… في الراعي.», post 1424). Drop the shorter first telling
// when the two opening sentences clearly say the same thing: a shared opening run of 4+
// words and 80%+ of the shorter sentence's words present in the longer one.
const leadWord = (w) => w.replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
function dedupeLead(t) {
  const m = String(t).match(/^(.{10,}?[.!؟?])\s+(.{10,}?[.!؟?])([\s\S]*)$/u);
  if (!m) return t;
  const [, s1, s2, rest] = m;
  const w1 = s1.split(/\s+/).map(leadWord).filter(Boolean);
  const w2 = s2.split(/\s+/).map(leadWord).filter(Boolean);
  if (w1.length < 4 || w2.length < 4) return t;
  let run = 0;
  while (run < w1.length && run < w2.length && w1[run] === w2[run]) run++;
  const [short, long] = w1.length <= w2.length ? [w1, w2] : [w2, w1];
  const longSet = new Set(long);
  const contained = short.filter((w) => longSet.has(w)).length;
  if (run >= 4 && contained >= Math.ceil(short.length * 0.8)) {
    const kept = w2.length >= w1.length ? s2 : s1;
    return kept + rest;
  }
  return t;
}
export function cleanPostText(raw) {
  // Telegram/source text can include its "show more" control followed by the outlet's
  // site/social footer. It is not part of the reported story. The control can glue to the
  // preceding sentence with no whitespace («…مدينة ديرك.عرض المزيد وكالة أنباء هاوار…»).
  const sourceText = String(raw || '').replace(/عرض المزيد(?=[\s.,:;،]|$)[\s\S]*$/iu, '').trim();
  const lines = sourceText.split('\n').map((l) => l.replace(/https?:\/\/\S+/g, '').trim());
  const keep = [];
  for (const l of lines) {
    if (!l) { keep.push(''); continue; }
    if (keep.some((x) => x) && PROMO_START.test(l)) break; // promo block: the rest is not news
    if (PROMO_LINE.test(l) && l.length < 90) continue;
    if (!/[\p{L}\p{N}]/u.test(l)) continue; // emoji / arrows / symbols only
    if (SIGNATURE.test(l) && l.length < 160) continue;
    if (/^(https?:\/\/|www\.)\S+$/.test(l)) continue;
    if (/^[-ـ_—=•.]{3,}$/.test(l)) continue;
    if (/^(#[\p{L}\p{N}_]+\s*)+$/u.test(l) && !/عاجل|متداول|غير_مؤكد|معلومات_أولية|معلومات_اولية/u.test(l)) continue; // hashtag-only line (#سانا, #الإخبارية_السورية)
    keep.push(l);
  }
  let t = keep.join('\n').replace(/https?:\/\/\S+/g, '').replace(/\n{2,}/g, '\n').trim();
  t = t.replace(OUTLET_TAIL, '').replace(PROMO_TAIL, '').trim();
  const breaking = /(^|[\s#|])عاجل/.test(t.slice(0, 40));
  t = t.replace(/^[\s#|🔴🚨⚡️⭕️❗️]*عاجل[\s|:：\-–—]*/u, '').trim();
  // "#بصرى_الشام" -> "بصرى الشام", "#درعا" -> "درعا"
  t = t.replace(/^#?(?:د\s?24|د24)\s*[:：]\s*/u, ''); // "#د24:" channel tag
  t = t.replace(/#([\p{L}\p{N}_]+)/gu, (_, w) => w.replace(/_/g, ' '));
  // anti-filter spellings: "الإسـ..ـرائيلي", "مقت.ل", "جثم.ان", "م.ش.ن.و.ق،اً", "حـ.ـ.ـ.ـ،،زب" -> plain words
  t = t.replace(/(\p{Script=Arabic})(?:[.*ـ،]*[.*ـ][.*ـ،]*|،+(?=[اى]|ً))(?=\p{Script=Arabic})/gu, '$1').replace(/ـ+/g, '');
  t = t.replace(/[📌🔹🔸▪️•●◾️✅🔻🔺]+/gu, '•').replace(/[ \t]+/g, ' ').trim();
  t = dedupeLead(t);
  return { text: t, breaking };
}
