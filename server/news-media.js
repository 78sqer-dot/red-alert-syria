import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns/promises';
import { config } from './config.js';

export const MEDIA_LIMITS = Object.freeze({ photo: 8 * 1024 * 1024, video: 20 * 1024 * 1024 });
const hosts = /^(?:telesco\.pe|cdn\d+\.telesco\.pe)$/i;
const extensions = { photo: /\.(?:jpe?g|png|webp)$/i, video: /\.(?:mp4|webm)$/i };
const mimeByExt = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const privateV4 = (ip) => { const p = ip.split('.').map(Number); return p[0] === 10 || p[0] === 127 || p[0] === 0 || p[0] === 169 && p[1] === 254 || p[0] === 172 && p[1] >= 16 && p[1] <= 31 || p[0] === 192 && p[1] === 168 || p[0] >= 224; };
function publicAddress(ip) { if (ip.includes(':')) return !(/^::|^fc|^fd|^fe[89ab]|^::ffff:(?:0:|127\.)/i.test(ip)); return !privateV4(ip); }
export function validateMediaUrl(value, type) {
  let u; try { u = new URL(value); } catch { throw new Error('invalid_media_url'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !hosts.test(u.hostname) || !extensions[type]?.test(u.pathname)) throw new Error('media_url_rejected');
  u.hash = ''; return u;
}
function sniff(buf, type, ext) {
  const e = ext.toLowerCase();
  const ok = e === '.jpg' || e === '.jpeg' ? buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
    : e === '.png' ? buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : e === '.webp' ? buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
        : e === '.mp4' ? buf.toString('ascii', 4, 8) === 'ftyp' : e === '.webm' ? buf.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) : false;
  if (!ok || (type === 'photo') !== Boolean(e.match(/^\.(?:jpe?g|png|webp)$/))) throw new Error('media_content_rejected');
  return mimeByExt[e];
}
export async function captureTelegramMedia(items, { fetchImpl = fetch, lookup = dns.lookup, directory = path.join(config.dataDir, 'news-media'), timeoutMs = 8000 } = {}) {
  const output = [];
  for (const item of (Array.isArray(items) ? items : []).slice(0, 2)) {
    const base = { type: item.type, sourceUrl: item.url };
    try {
      let url = validateMediaUrl(item.url, item.type);
      let response;
      for (let hop = 0; hop < 4; hop++) {
        const addresses = await lookup(url.hostname, { all: true, verbatim: true });
        if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('media_host_rejected');
        response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: item.type === 'photo' ? 'image/jpeg,image/png,image/webp' : 'video/mp4,video/webm' } });
        if (response.status >= 300 && response.status < 400) {
          if (hop === 3) throw new Error('media_redirect_limit');
          const location = response.headers.get('location'); if (!location) throw new Error('media_redirect_rejected');
          url = validateMediaUrl(new URL(location, url).href, item.type); continue;
        }
        break;
      }
      if (!response?.ok || !response.body) throw new Error('media_fetch_failed');
      const ext = path.extname(url.pathname).toLowerCase(), expectedMime = mimeByExt[ext];
      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (contentType !== expectedMime) throw new Error('media_mime_rejected');
      const len = Number(response.headers.get('content-length'));
      if (Number.isFinite(len) && len > MEDIA_LIMITS[item.type]) throw new Error('media_too_large');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > MEDIA_LIMITS[item.type]) { await response.body.cancel?.().catch?.(()=>{}); throw new Error('media_too_large'); } chunks.push(Buffer.from(chunk)); }
      const bytes = Buffer.concat(chunks);
      if (!bytes.length || sniff(bytes, item.type, ext) !== expectedMime) throw new Error('media_content_rejected');
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const name = `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
      const filePath = path.join(directory, name);
      await fs.writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
      output.push({ ...base, status: 'captured', path: filePath, mimeType: expectedMime, size });
    } catch (error) {
      output.push({ ...base, status: 'unavailable', error: String(error?.message || 'capture_failed').slice(0, 64) });
    }
  }
  return output;
}
