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
  { u: 'SyrSMOT', name: 'وزارة النقل السورية', general: true, roadOnly: true },
  { u: 'syrianmoi', name: 'وزارة الداخلية السورية', general: true, roadOnly: true },
  { u: 'ALMHARAR', name: 'شبكة أخبار سوريا الحرة', general: true },
  { u: 'HalabTodayTV', name: 'حلب اليوم', general: true },
  { u: 'alarabiyaBr', name: 'العربية عاجل', general: true },
  // Additional Syrian reporting and humanitarian coverage for north Syria / Idlib.
  { u: 'enabbaladi', name: 'عنب بلدي', general: true },
  { u: 'SyriaDefence', name: 'الدفاع المدني السوري', general: true, local: true },
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
    text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => inner)
      .replace(/<[^>]+>/g, '');
    text = unescape(text).replace(/\u200f|\u200e|\u202b|\u202c/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const fwd = /tgme_widget_message_forwarded_from/.test(block);
    posts.push({ id, ts: Number.isFinite(ts) ? ts : null, text, url: `https://t.me/${u}/${id}`, fwd });
  }
  posts.sort((a, b) => a.id - b.id);
  return { title, posts };
}

export async function fetchChannel(u, { timeoutMs = 15_000, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://t.me/s/${encodeURIComponent(u)}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ar,en;q=0.8', Accept: 'text/html' },
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  // a private / unknown username redirects to t.me/<u> (no preview)
  if (res.status >= 300 && res.status < 400) { const e = new Error('no public preview'); e.code = 'nopreview'; throw e; }
  if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.code = 'http'; throw e; }
  const html = await res.text();
  const out = parseChannelPage(html, u);
  if (!out.posts.length && !/tgme_channel_info/.test(html)) { const e = new Error('no public preview'); e.code = 'nopreview'; throw e; }
  return out;
}

// Remove channel signatures, "subscribe" footers, links and hashtag decoration; keep the news itself.
const SIGNATURE = /(اشترك|تابعونا|انضموا|لمتابعة|للمزيد من التفاصيل|التفاصيل على الرابط|لمشاهدة الحلقة|على تلغرام|على تيليغرام|على التلغرام|على التيليجرام|قناة التليغرام|قناة التيليجرام|t\.me\/|@[A-Za-z]\w{3,}\s*$|خدمة شبكة|👇)/;
// A channel's promo block ("🔻لمتابعة زينو🔻 اضغط على الرابط 👇", "تابع قناة التلغرام", "للتواصل مع الإدارة")
// ends the news: everything from its first line on is dropped.
const PROMO_START = /^[\s\p{Extended_Pictographic}\uFE0F🔻🔺•▪️*_~-]*(لمتابعة|للمتابعة|تابعونا|تابعوا|تابع قناة|تابع صفحة|تابعو|اشترك|اشتركوا|للاشتراك|انضم|انضموا|للانضمام|للتواصل|للإعلان|للاعلان|لإعلاناتكم|رابط القناة|رابط اليوتيوب|رابط الفيسبوك|رابط الصفحة|قناتنا|صفحتنا|أخبار أكثر|اخبار اكثر|أخــبـــار|ادعم|لدعم القناة|شاركونا|راسلونا)/u;
const PROMO_LINE = /(اضغط|الرابط|على الرابط|فيسبوك|فيس بوك|يوتيوب|انستغرام|انستقرام|واتساب|تيك توك|Facebook|YouTube|Instagram|WhatsApp|TikTok|تفاصيل أكثر حال ورودها|التفاصيل تباعاً|بالسلامة للجميع|تابعونا)/iu;
export function cleanPostText(raw) {
  const lines = String(raw || '').split('\n').map((l) => l.replace(/https?:\/\/\S+/g, '').trim());
  const keep = [];
  for (const l of lines) {
    if (!l) { keep.push(''); continue; }
    if (keep.some((x) => x) && PROMO_START.test(l)) break; // promo block: the rest is not news
    if (PROMO_LINE.test(l) && l.length < 90) continue;
    if (!/[\p{L}\p{N}]/u.test(l)) continue; // emoji / arrows / symbols only
    if (SIGNATURE.test(l) && l.length < 160) continue;
    if (/^(https?:\/\/|www\.)\S+$/.test(l)) continue;
    if (/^[-ـ_—=•.]{3,}$/.test(l)) continue;
    if (/^(#[\p{L}\p{N}_]+\s*)+$/u.test(l) && !/عاجل/.test(l)) continue; // hashtag-only line (#سانا, #الإخبارية_السورية)
    keep.push(l);
  }
  let t = keep.join('\n').replace(/https?:\/\/\S+/g, '').replace(/\n{2,}/g, '\n').trim();
  const breaking = /(^|[\s#|])عاجل/.test(t.slice(0, 40));
  t = t.replace(/^[\s#|🔴🚨⚡️⭕️❗️]*عاجل[\s|:：\-–—]*/u, '').trim();
  // "#بصرى_الشام" -> "بصرى الشام", "#درعا" -> "درعا"
  t = t.replace(/^#?(?:د\s?24|د24)\s*[:：]\s*/u, ''); // "#د24:" channel tag
  t = t.replace(/#([\p{L}\p{N}_]+)/gu, (_, w) => w.replace(/_/g, ' '));
  // anti-filter spellings: "الإسـ..ـرائيلي", "مقت.ل", "جثم.ان", "م.ش.ن.و.ق،اً", "حـ.ـ.ـ.ـ،،زب" -> plain words
  t = t.replace(/(\p{Script=Arabic})(?:[.*ـ،]*[.*ـ][.*ـ،]*|،+(?=[اى]|ً))(?=\p{Script=Arabic})/gu, '$1').replace(/ـ+/g, '');
  t = t.replace(/[📌🔹🔸▪️•●◾️✅🔻🔺]+/gu, '•').replace(/[ \t]+/g, ' ').trim();
  return { text: t, breaking };
}
