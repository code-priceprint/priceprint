// PricePrint service worker — makes the site installable (PWA) and usable
// offline, WITHOUT risking stale deploys.
//
// Strategy: NETWORK-FIRST for everything same-origin. When online, the visitor
// always gets the freshly deployed file (so pushes show up immediately — no
// "stuck on old cached version" problem). Every successful response is copied
// into the cache, so when the visitor is offline the last-seen version is
// served instead. Cross-origin requests (Google Analytics/Ads, fonts, etc.)
// are never intercepted — they pass straight through.
//
// Bump CACHE_VERSION to force-evict the old cache on the next deploy.

const CACHE_VERSION = 'priceprint-v1';

// Minimal precache so the very first offline visit still renders something.
// Runtime caching (below) fills in everything else the visitor actually loads.
const PRECACHE = [
  '/',
  '/log-price.html',
  '/inflation-calculator.html',
  '/css/style.css',
  '/manifest.json',
  '/android-icon-192x192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // Per-entry so one redirect/404 can't fail the whole precache batch
      // (cache.addAll is all-or-nothing). Runtime caching covers the rest.
      .then((cache) => Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GETs. Let analytics/ads/3rd-party pass through
  // untouched so consent-gated tracking and external assets work normally.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache a copy of every good same-origin response for offline use.
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          // Offline and never cached: for a page navigation, fall back to the
          // cached home page so the visitor lands somewhere usable.
          if (req.mode === 'navigate') return caches.match('/');
          return Response.error();
        })
      )
  );
});
