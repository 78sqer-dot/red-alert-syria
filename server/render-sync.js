// Durable project settings on Render: the free instance has an ephemeral disk, so changes made in the
// bot (owner, bot tokens, channel) are also written to this service's environment variables when the
// owner links a Render API key from the bot. The key itself is stored only as the env var RENDER_API_KEY
// (never in the data file or the Telegram backup).
const API = 'https://api.render.com/v1';
let runtimeKey = '';
let cachedServiceId = '';

export const renderKey = () => runtimeKey || process.env.RENDER_API_KEY || '';
export const renderLinked = () => Boolean(renderKey());

async function call(method, path, key, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error(`render ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Find this service's id: RENDER_SERVICE_ID is provided by Render at runtime; otherwise match by name/URL.
async function serviceId(key) {
  if (process.env.RENDER_SERVICE_ID) return process.env.RENDER_SERVICE_ID;
  if (cachedServiceId) return cachedServiceId;
  const list = await call('GET', '/services?limit=100', key);
  const name = process.env.RENDER_SERVICE_NAME || '';
  const url = (process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  const hit = (list || []).map((x) => x.service || x).find((s) =>
    (name && s.name === name) || (url && (s.serviceDetails?.url || '').replace(/\/+$/, '') === url));
  if (!hit) throw Object.assign(new Error('service not found'), { status: 404 });
  cachedServiceId = hit.id;
  return hit.id;
}

// Validate a key against this service. Returns { ok, name } or { ok:false, reason }.
export async function renderCheck(key) {
  if (!/^rnd_[A-Za-z0-9]{10,}$/.test(String(key || ''))) return { ok: false, reason: 'format' };
  try {
    const id = await serviceId(key);
    const s = await call('GET', `/services/${id}`, key);
    return { ok: true, name: s?.name || id };
  } catch (e) {
    return { ok: false, reason: e.status === 401 || e.status === 403 ? 'auth' : e.status === 404 ? 'service' : 'network' };
  }
}

// Write env vars (merge, one by one). pairs: { KEY: value }. Empty values are skipped.
export async function renderSetEnv(pairs, key = renderKey()) {
  if (!key) return { ok: false, reason: 'unlinked' };
  try {
    const id = await serviceId(key);
    for (const [k, v] of Object.entries(pairs)) {
      if (v === undefined || v === null || v === '') continue;
      await call('PUT', `/services/${id}/env-vars/${encodeURIComponent(k)}`, key, { value: String(v) });
    }
    return { ok: true };
  } catch (e) {
    console.error('[render] env update failed', e.status || e.message);
    return { ok: false, reason: e.status === 401 || e.status === 403 ? 'auth' : 'network' };
  }
}

// Link: validate, store the key itself as RENDER_API_KEY on the service, keep it in memory.
export async function renderLink(key) {
  const chk = await renderCheck(key);
  if (!chk.ok) return chk;
  const w = await renderSetEnv({ RENDER_API_KEY: key }, key);
  if (!w.ok) return w;
  runtimeKey = key;
  return chk;
}

// Test hook (simulations): pretend a key is linked without network.
export function _setRenderKeyForTest(k) { runtimeKey = k || ''; }
