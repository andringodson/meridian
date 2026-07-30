/* Meridian service worker — app-shell offline support.
   Shell: network-first (deploys apply on next load), cache fallback offline.
   Live API: network-first. */
const SHELL = 'meridian-shell-v30';
const STATE = 'meridian-state'; // tiny key-value store; survives shell upgrades
// The opt-in semantic model is 7.5MB the reader chose to download. It lives in
// its own cache (written by embed.js) and must outlive shell upgrades, or every
// deploy would silently bill them for it again.
const MODEL = 'meridian-model-v1';
// Saved stories keep their extracted text and hero image here so the reading
// queue survives a lost connection — and a deploy.
const READING = 'meridian-reading-v1';
const KEEP = [SHELL, STATE, MODEL, READING];
// theme.js is render-blocking in <head>: if it were ever missing offline the
// shell would paint with the markup's fallback theme, so it belongs here.
const ASSETS = ['/', '/index.html', '/styles.css', '/theme.js', '/app.js', '/fluid.js', '/features.js', '/embed.js', '/assistant.js', '/readaloud.js', '/translate.js', '/pointer.js', '/palette.js', '/fonts/space-grotesk-latin.woff2', '/logo.svg', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Cross-origin (article images, outbound links) must be left to the browser
  // whenever there is a network.
  //
  // This worker is served with the site's CSP, and `connect-src` there is
  // 'self'. A fetch() from inside the worker counts as a connect, so proxying
  // an article thumbnail through here gets it blocked outright — while the very
  // same URL loads fine straight from an <img>, which answers to `img-src
  // https:` instead. Doing that broke ~85% of preview images in production.
  //
  // Offline is the one case worth intercepting, and there the answer comes from
  // the reading queue's cache rather than the network, so no connect happens.
  if (url.origin !== self.location.origin) {
    if (request.destination === 'image' && self.navigator && self.navigator.onLine === false) {
      e.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
    }
    return;
  }

  // Live data: network-first, no long-term caching.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  // Model weights manage their own cache in embed.js — passing them through the
  // shell logic below would store a second 7.5MB copy on every load.
  if (url.pathname.startsWith('/models/')) return;

  // App shell: network-first so every deploy is live on the next load;
  // the cache copy only serves when offline.
  e.respondWith(
    fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(request))
  );
});

/* ---------- story alerts (opt-in, installed app) ----------
   When alerts are enabled the page registers a periodic background sync; each
   firing fetches the top feed, notifies once about what changed since the last
   check, and sets the app-icon badge. The SW has no localStorage, so the last
   seen links live in a small dedicated cache. */
async function getState(key) {
  try {
    const c = await caches.open(STATE);
    const r = await c.match(`/__state/${key}`);
    return r ? await r.json() : null;
  } catch { return null; }
}
async function setState(key, value) {
  try {
    const c = await caches.open(STATE);
    await c.put(`/__state/${key}`, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* best effort */ }
}

async function checkNews() {
  const r = await fetch('/api/news?category=top', { cache: 'no-store' });
  const data = await r.json();
  const articles = data.articles || [];
  if (!articles.length) return;
  const prev = (await getState('last-top')) || { links: [] };
  const known = new Set(prev.links);
  const fresh = articles.filter((a) => !known.has(a.link));
  await setState('last-top', { links: articles.map((a) => a.link).slice(0, 120) });
  if (!prev.links.length || !fresh.length) return; // first run seeds silently
  const lead = fresh[0];
  try {
    await self.registration.showNotification(
      fresh.length === 1 ? 'Meridian — new story' : `Meridian — ${fresh.length} new stories`,
      {
        body: lead.title,
        tag: 'meridian-news', // one notification, replaced in place — never a pile
        icon: '/icons/icon.svg',
        badge: '/icons/icon.svg',
        data: { url: '/' },
      }
    );
  } catch { /* notification permission may have been revoked */ }
  try { if (navigator.setAppBadge) await navigator.setAppBadge(fresh.length); } catch { /* unsupported */ }
}

self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'news-check') e.waitUntil(checkNews());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const c = list.find((w) => 'focus' in w);
      return c ? c.focus() : clients.openWindow((e.notification.data && e.notification.data.url) || '/');
    })
  );
});
