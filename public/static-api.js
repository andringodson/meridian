/* Meridian — the static mirror shim.
 *
 * GitHub Pages serves files, not functions, so /api/* does not exist there.
 * Rather than thread a "static mode" flag through every call site, this wraps
 * fetch once and rewrites the handful of API paths onto the JSON snapshots that
 * scripts/snapshot.mjs wrote at build time.
 *
 * It does nothing at all on the real deployment: the wrapper is only installed
 * when the page is served from a host that cannot run functions. That check is
 * the host, not a build flag, so the same bytes work in both places.
 *
 * Some endpoints cannot be frozen — reader extraction, full-text search,
 * weather and the assistant are per-request by nature. Those return a shape the
 * client already handles as a failure, so the app degrades to exactly what it
 * does when a request fails, which is a path that is already tested.
 */
(() => {
  'use strict';

  // Pages and the common static hosts. Everything else is assumed to have an
  // API behind it, which is the safe default: a wrong guess here would break a
  // working deployment, while missing one only means the mirror looks offline.
  const STATIC_HOST = /\.github\.io$|\.pages\.dev$|\.netlify\.app$|\.surge\.sh$/;
  if (!STATIC_HOST.test(location.hostname)) return;

  const BASE = 'api-static/';
  const root = () => {
    // Project Pages live under /<repo>/, so paths must stay relative to it.
    const p = location.pathname.replace(/\/[^/]*$/, '/');
    return p.endsWith('/') ? p : `${p}/`;
  };

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });

  /* The shapes the client already treats as "this failed, carry on". Returning
     them is honest — on a static mirror these genuinely are unavailable. */
  const UNAVAILABLE = {
    read: { ok: false, reason: 'static-mirror' },
    search: { articles: [], count: 0, query: '', static: true },
    weather: { error: 'unavailable on the static mirror' },
    ai: { error: 'ai-unconfigured', detail: 'The assistant needs a live server.' },
  };

  function mapPath(url) {
    let u;
    try { u = new URL(url, location.href); } catch { return null; }
    if (u.origin !== location.origin) return null;

    const m = u.pathname.match(/\/api\/([a-z0-9]+)\/?$/i);
    if (!m) return null;
    const route = m[1].toLowerCase();
    const q = u.searchParams;

    if (route === 'news') {
      const cat = (q.get('category') || 'top').toLowerCase();
      const ed = (q.get('edition') || 'us').toLowerCase();
      return { file: `news-${ed}-${cat}.json` };
    }
    if (route === 'wiki') {
      const type = (q.get('type') || 'events').toLowerCase();
      return { file: `wiki-${type}.json` };
    }
    if (route === 'videos') return { file: 'videos.json' };
    if (route === 'markets') {
      // Only the overview is frozen; per-symbol history and ticker search are
      // per-request. An empty result reads as "no data", which the markets view
      // already renders without breaking.
      if (q.get('symbol') || q.get('search')) return { inline: { quotes: [], results: [], static: true } };
      return { file: 'markets.json' };
    }
    if (route in UNAVAILABLE) return { inline: UNAVAILABLE[route] };
    return null;
  }

  const real = window.fetch.bind(window);

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url);
    const hit = url ? mapPath(url) : null;
    if (!hit) return real(input, init);

    if (hit.inline) return Promise.resolve(json(hit.inline));

    return real(root() + BASE + hit.file, init).then((r) => {
      if (r.ok) return r;
      // A snapshot that never got written should look like a failed request
      // rather than a 404 page parsed as JSON.
      return json({ error: 'not-in-mirror' }, 503);
    }).catch(() => json({ error: 'not-in-mirror' }, 503));
  };

  // Let the app say so rather than looking mysteriously stale.
  document.addEventListener('DOMContentLoaded', () => {
    real(root() + BASE + 'manifest.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!m) return;
        const live = document.getElementById('live');
        if (live) {
          live.classList.add('stale');
          live.title = `Static mirror — snapshot taken ${new Date(m.generatedAt).toLocaleString()}. ` +
            'Reader, search, weather and the assistant need the live site.';
          const label = live.querySelector('.live-label');
          if (label) label.textContent = 'MIRROR';
        }
      })
      .catch(() => { /* the badge is a nicety */ });
  });
})();
