// Public Telegram channels as news sources: https://t.me/s/<username> is Telegram's public web preview of a
// channel (no account, no API key). It lists the ~20 latest posts with their id, time and text.
// Every source is read by the server itself (Render, 24/7), independent of anyone's phone.

// Default sources (verified 25 Oct 2026). `general: true` = channel also covers non-Syrian news, so a post
// must mention Syria (a Syrian place / "سوريا") before it is even considered.
export const DEFAULT_SOURCES = [
  { u: 'ajasyr', name: 'الجزيرة سوريا' },
  { u: 'alarabiya_sy', name: 'العربية سوريا' },
  { u: 'AlarabyTvSy', name: 'التلفزيون العربي - سوريا' },
  { u: 'TelevisionSyria', name: 'تلفزيون سوريا' },
  { u: 'AlekhbariahSY', name: 'الإخبارية السورية' },
  { u: 'ALMHARAR', name: 'شبكة أخبار سوريا الحرة', general: true },
  { u: 'HalabTodayTV', name: 'حلب اليوم', general: true },
  { u: 'alarabiyaBr', name: 'العربية عاجل', general: true },
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
    posts.push({ id, ts: Number.isFinite(ts) ? ts : null, text, url: `https://t.me/${chan || u}/${id}`, fwd });
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
export function cleanPostText(raw) {
  const lines = String(raw || '').split('\n').map((l) => l.replace(/https?:\/\/\S+/g, '').trim());
  const keep = [];
  for (const l of lines) {
    if (!l) { keep.push(''); continue; }
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
  t = t.replace(/#([\p{L}\p{N}_]+)/gu, (_, w) => w.replace(/_/g, ' '));
  t = t.replace(/(\p{L})\.\.ـ?(\p{L})/gu, '$1$2').replace(/ـ+/g, ''); // "الإسـ..ـرائيلي" anti-filter spelling
  t = t.replace(/[📌🔹🔸▪️•●◾️✅🔻🔺]+/gu, '•').replace(/[ \t]+/g, ' ').trim();
  return { text: t, breaking };
}
