/**
 * Offline service worker — stale-while-revalidate over same-origin GETs. After the first
 * load the whole static app (HTML, hashed JS incl. the bundled weights) is cached, so
 * wiz-tower runs offline with no server. Hashed asset names mean new builds never serve
 * stale code; the un-hashed index is refreshed in the background each visit.
 */
const CACHE = 'wiz-tower-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
