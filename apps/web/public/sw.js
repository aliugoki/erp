/* eslint-disable */
/* MetaXperts ERP service worker — makes the app (esp. the POS terminal) usable offline.
 *
 * Strategy:
 *  - Immutable build assets (/_next/static, fonts, images, the icon): cache-first (content-hashed).
 *  - Page navigations + RSC payloads: network-first, falling back to the cached copy when offline, so
 *    a page you've opened once keeps loading with no internet.
 *  - The API (the backend origin / cross-origin, and anything that isn't a GET): NEVER cached — the app
 *    handles offline writes itself via its local sale queue + idempotent replay. We don't want a stale
 *    cached API response masquerading as live data.
 */
const CACHE = 'mx-erp-v1';
const PRECACHE = ['/', '/pos', '/offline.html', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => undefined)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

const isStatic = (url) =>
  url.pathname.startsWith('/_next/static/') ||
  url.pathname.startsWith('/icon') ||
  /\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // writes (incl. API POSTs) go straight to the network / local queue
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin (e.g. the API host) is never cached here

  // Cache-first for immutable build assets.
  if (isStatic(url)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => putInCache(req, res))),
    );
    return;
  }

  // Network-first for navigations + RSC, falling back to cache (then the offline shell) when offline.
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html') || url.search.includes('_rsc')) {
    event.respondWith(
      fetch(req)
        .then((res) => putInCache(req, res))
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/pos') || caches.match('/offline.html'))),
    );
  }
});

function putInCache(req, res) {
  if (res && res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
  }
  return res;
}
