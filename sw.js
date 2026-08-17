/* Offline cache for the lighter. Network-first, so the app is never stale while
   online; the cache only answers when the network cannot.

   Two ways that promise was broken, both fixed here.

   The cache name was the constant 'lighter-v1', so activate's purge --
   keys.filter(k => k !== CACHE) -- could never delete anything on a deploy: the
   one cache it kept was always the one it already had. An entry written months
   ago stayed until the origin was cleared by hand.

   And a network-first fetch that goes through the HTTP cache is not a network
   fetch. `fetch(req)` for a navigation is free to answer from the browser's own
   cache without touching the server, so a stale document came back looking like
   a fresh one. Navigations now force cache: 'reload', which bypasses it.

   BUMP BUILD ON EVERY DEPLOY. It names the cache, so changing it is what
   evicts the previous build; index.html carries the same string and the test
   suite fails if the two drift apart. */
const BUILD = '2026-08-17e';
const CACHE = 'lighter-' + BUILD;

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
      // 'reload' on the document only: sub-resources are content-addressed or
      // versioned by the document that names them, and forcing a revalidation
      // on every one of them would cost a round trip each on a phone.
      const res = await fetch(req, nav ? { signal: ctrl.signal, cache: 'reload' } : undefined);
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
