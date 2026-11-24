// Version the cache with the deployed app build so changed modules cannot be served stale.
const BUILD = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `ras-static-${BUILD}`;
// Pages and API responses stay network-fresh. Build-versioned JS/CSS/shared code and vendor/fonts
// are cache-first for fast repeat visits; images and data remain network-first with offline fallback.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const m = url.pathname.match(/^\/(vendor|fonts|img|data|js|css|shared)\//);
  if (!m) return;
  if (['vendor', 'fonts', 'js', 'css', 'shared'].includes(m[1])) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) await c.put(e.request, r.clone());
      return r;
    }).catch(() => caches.match(e.request).then((hit) => hit || Response.error())));
    return;
  }
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request).then((hit) => hit || Response.error())));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || '/ar/';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => {
    const same = cs.find((c) => 'focus' in c);
    return same ? same.focus().then(() => same.navigate(target)) : self.clients.openWindow(target);
  }));
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data?.text() || 'تنبيه جديد' }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Red Alert Syria', {
    body: data.body || 'تنبيه جديد',
    icon: '/img/icon-192.png',
    badge: '/img/icon-192.png',
    tag: data.tag || 'ras-alert',
    renotify: data.event === 'new',
    data: { url: data.url || '/ar/' },
    vibrate: [180, 80, 180],
  }));
});
