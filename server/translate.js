// English text for the /en/ site: every alert's Arabic description is translated once (Gemini),
// in the background, and kept as `description_en`. The Arabic site, the channel and the bots are
// untouched; if Gemini is unavailable the English site simply keeps showing the Arabic text.
import { store } from './store.js';

const AR = /[\u0600-\u06FF]/;
const KEY = () => process.env.GEMINI_API_KEY || '';
const MODELS = () => (process.env.TR_AI_MODELS || process.env.NEWS_AI_MODELS || 'gemini-flash-lite-latest,gemini-flash-latest')
  .split(',').map((s) => s.trim()).filter(Boolean);
const SYS = 'You translate short Syrian news alerts from Arabic to English for a public safety map. '
  + 'Translate faithfully and concisely in neutral news English. Use common English spellings for Syrian places '
  + '(e.g. Daraa, Idlib, Deir ez-Zor, Latakia, Raqqa, Hasakah, Quneitra, Sweida, Tartus, Homs, Hama, Aleppo, Damascus). '
  + 'Translate «ريف X» as «the X countryside» (e.g. ريف دمشق = the Damascus countryside). '
  + 'Do not add facts, sources, hashtags, links or emojis. Reply with the English text only.';

const R = { queue: [], busy: false, done: new Set(), fails: 0, last: '' };

async function translate(text) {
  const key = KEY();
  if (!key) throw new Error('no GEMINI_API_KEY');
  let err;
  for (const m of MODELS()) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYS }] },
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
        }),
        signal: AbortSignal.timeout(25_000),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${m}: HTTP ${res.status}`);
      const out = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim()
        .replace(/^["“]|["”]$/g, '').replace(/https?:\/\/\S+/g, '').replace(/#\S+/g, '').trim();
      // sanity: real English, not empty/echoed Arabic, sensible length
      if (!out || AR.test(out) || out.length > text.length * 4 + 80) throw new Error(`${m}: bad output`);
      return out;
    } catch (e) { err = e; }
  }
  throw err;
}

async function pump() {
  if (R.busy) return;
  R.busy = true;
  try {
    while (R.queue.length) {
      const id = R.queue.shift();
      const a = store.getAlert(id);
      if (!a || a.description_en || !a.description || !AR.test(a.description) || R.done.has(id)) continue;
      R.done.add(id);
      try {
        const en = await translate(a.description.slice(0, 1200));
        if (store.getAlert(id) && !store.getAlert(id).description_en) store.updateAlert(id, { description_en: en });
      } catch (e) {
        R.fails++; R.last = String(e.message || e).replace(/key=[^&\s]+/g, 'key=…').slice(0, 160);
        console.warn('[translate] failed', id, R.last);
      }
      await new Promise((r) => setTimeout(r, 1500)); // gentle on the shared free Gemini quota
    }
  } finally { R.busy = false; }
}
const want = (id) => { if (id && !R.queue.includes(id)) { R.queue.push(id); pump().catch(() => {}); } };

export function startTranslations() {
  if (!KEY()) { console.log('[translate] off (no Gemini key)'); return; }
  store.on('alert', (a) => want(a.id));
  // alerts already on the map when the server starts
  const t = setTimeout(() => { for (const a of store.state.alerts || []) if (a.is_active !== false && !a.description_en) want(a.id); }, 20_000);
  t.unref?.();
}
export const translateDebug = () => ({ queue: R.queue.length, busy: R.busy, done: R.done.size, fails: R.fails, last: R.last });
export const _test = { translate };
