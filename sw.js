/* Offline cache for the lighter. Network-first, so the app is never stale
   while online; the cache only answers when the network cannot. Replaces the
   earlier kill-switch worker (activate still clears every old cache). */
const CACHE = 'lighter-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin && url.hostname !== 'cdn.jsdelivr.net') return;
  const nav = req.mode === 'navigate';
  event.respondWith((async () => {
    try {
      const ctrl = new AbortController();
      const timer = nav ? setTimeout(() => ctrl.abort(), 4000) : 0;
      const res = await fetch(req, nav ? { signal: ctrl.signal } : undefined);
      clearTimeout(timer);
      if (res && (res.ok || res.type === 'opaque')) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    } catch (e) {
      const hit = await caches.match(req);
      if (hit) return hit;
      throw e;
    }
  })());
});
