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

  /* Two ways to know this deployment has no API behind it, and the order
     matters.

     The build says so. `build.mjs --static` stamps a meta tag, and the workflow
     that publishes a frozen mirror is the one that passes it. That is knowledge
     rather than inference: the same build that wrote the snapshots said they are
     what to read.

     Failing that, a host that cannot run server code whatever it is asked to.
     github.io and surge.sh serve files and nothing else, so the guess is safe.

     What is NOT in that list any more is pages.dev and netlify.app. Both were
     here, and both are wrong: Cloudflare Pages and Netlify run functions, so
     deploying the real API to either would have had this shim quietly answer
     from stale snapshots instead — a live site serving yesterday's news with no
     error anywhere to explain it. Ambiguous hosts have to be told, and the meta
     tag is how they are told. */
  const declared = document.querySelector('meta[name="meridian-api"]')?.content === 'static';
  const FILES_ONLY_HOST = /\.github\.io$|\.surge\.sh$/;
  if (!declared && !FILES_ONLY_HOST.test(location.hostname)) return;

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
          // A class, not textContent: app.js rewrites this label every time it
          // finishes a load, so anything written here is overwritten seconds later.
          // CSS wins that race by not entering it.
          live.classList.add('is-mirror');
        }
      })
      .catch(() => { /* the badge is a nicety */ });
  });
})();
