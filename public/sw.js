/* Meridian service worker — app-shell offline support.
   Shell: cache-first. Live API + news links: network-first. */
const SHELL = 'meridian-shell-v8';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/fluid.js', '/features.js', '/logo.svg', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Only manage our own origin; let cross-origin (fonts, article links) pass through.
  if (url.origin !== self.location.origin) return;

  // Live data: network-first, no long-term caching.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  // App shell: cache-first, refresh in background.
  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
