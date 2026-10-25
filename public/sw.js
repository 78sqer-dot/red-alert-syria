// Minimal service worker: caches immutable static assets for faster repeat visits.
const CACHE = 'ras-static-v16';
// Pages, app code and styles are never cached here (always fresh from the server).
// vendor/ and fonts/ never change → cache first. img/ and data/ (logo, place lists) → network first,
// cache only as an offline fallback, so a new logo or data file shows up on the very next visit.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const m = url.pathname.match(/^\/(vendor|fonts|img|data)\//);
  if (!m) return;
  if (m[1] === 'vendor' || m[1] === 'fonts') {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
    return;
  }
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request).then((hit) => hit || Response.error())));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow('/ar/'))));
});
