/* Kill-switch for the retired PWA service worker that once lived at this URL.
   Browsers holding the old registration fetch this file on their update check;
   it takes over immediately, deletes every cache, unregisters itself, and
   reloads any open pages so they load fresh from the network. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.registration.unregister();
    const wins = await self.clients.matchAll({ type: 'window' });
    for (const c of wins) {
      try { await c.navigate(c.url); } catch (e) { /* page gone */ }
    }
  })());
});
/* No fetch handler: every request goes straight to the network. */
