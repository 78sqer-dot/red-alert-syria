const BASE_URL = (process.env.PUSH_MONITOR_BASE_URL || 'https://red-alert-syria.onrender.com').replace(/\/$/, '');
const SAMPLES = 3;
const MAX_LATENCY_MS = Number(process.env.PUSH_MONITOR_MAX_LATENCY_MS || 10_000);

async function probe(path, validate) {
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    const started = performance.now();
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(MAX_LATENCY_MS),
    });
    const text = await response.text();
    const elapsedMs = performance.now() - started;
    if (elapsedMs > MAX_LATENCY_MS) throw new Error(`${path} exceeded ${MAX_LATENCY_MS}ms (${elapsedMs.toFixed(0)}ms)`);
    let body;
    try { body = JSON.parse(text); } catch { throw new Error(`${path} returned invalid JSON`); }
    if (!response.ok) {
      if (path === '/api/push/public-key' && response.status === 404 && body?.enabled === false) {
        throw new Error('Web Push is disabled on the monitored service (VAPID configuration is missing)');
      }
      throw new Error(`${path} returned HTTP ${response.status}`);
    }
    validate(body);
    samples.push(Math.round(elapsedMs));
  }
  const max = Math.max(...samples);
  const average = Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length);
  console.log(`${path}: ${SAMPLES}/${SAMPLES} healthy; avg=${average}ms max=${max}ms`);
}

await probe('/api/health?src=web-push-monitor', (body) => {
  if (body?.ok !== true) throw new Error('/api/health did not report ok=true');
});

await probe('/api/push/public-key', (body) => {
  if (body?.enabled !== true || typeof body.publicKey !== 'string') {
    throw new Error('Web Push is not configured on the monitored service');
  }
  // Validate only the public key shape; deliberately never print or store the key.
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(body.publicKey)) {
    throw new Error('Web Push public key has an unexpected format');
  }
});

console.log(`Web Push readiness and latency checks passed for ${BASE_URL}. No subscription or notification was created.`);
