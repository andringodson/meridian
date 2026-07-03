<div align="center">

<img src="public/logo.svg" alt="Meridian" width="76" height="76" />

# Meridian

**A real-time intelligence surface — world news, history, and markets, assembled from open sources and kept current on its own.**

[![Live](https://img.shields.io/badge/live-meridian.vercel.app-0000ee?style=flat-square)](https://meridian.vercel.app)
[![PWA](https://img.shields.io/badge/installable-PWA-0000ee?style=flat-square)](https://meridian.vercel.app)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-222222?style=flat-square)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-222222?style=flat-square)](LICENSE)

</div>

---

## About

Meridian is a single, calm surface for keeping up with the world. It gathers
headlines from a spread of reputable public feeds, threads in the day's notable
history from Wikipedia, and refreshes itself continuously — no sign-in, no API
keys, no manual reloads. The result reads like a private wire service: fast,
uncluttered, and always current.

It is built to run everywhere from one codebase. On the web it is a website; on
a phone or a laptop it installs as an app (PWA) with an offline-ready shell. The
design is deliberately spare — a black canvas, a single electric-blue accent,
and typography doing the heavy lifting — so the content, not the chrome, holds
your attention.

**Version 1 is news-first.** Live market analytics and a deeper history explorer
are the next strands, built on the same foundation.

> Meridian reads only open, publicly available sources (public RSS and the
> Wikimedia API). It stores no personal data and requires no account.

## Highlights

- **Real-time aggregation** — multiple free RSS sources per category (Google
  News topics plus curated publishers), normalized and de-duplicated on the
  server so you see each story once, from its original outlet.
- **Self-updating** — the client refreshes on a timer and on refocus; the API is
  cached at the edge and warmed on a schedule. Meridian stays current with zero
  interaction.
- **On this day** — notable historical events for today's date, drawn live from
  the Wikimedia REST feed.
- **Installs everywhere** — one PWA installs as an app on Android, iOS, and
  Windows, with an offline app shell.
- **Composed visuals** — stories without artwork receive a deterministic
  cinematic gradient keyed to their headline, so the grid always looks
  intentional.
- **Open by design** — no keys, no tracking, no lock-in. Public sources only.

## Design

Adapted from the TitanGate Equity system: a `#000000` canvas, white text, a
muted secondary grey, hairline `#222` borders, and a single electric-blue accent
(`#0000ee`). Display type is a geometric grotesk (Space Grotesk, a free stand-in
for Fellix); body text is Arial. Surfaces are flat — depth comes from borders,
never shadows.

## Architecture

Meridian is a static front end over a thin serverless API, deployed as one
Vercel project. The browser never talks to upstream feeds directly (which avoids
CORS and keys); the serverless functions fetch, parse, normalize, and cache.

```
meridian/
├── api/
│   ├── news.js       # Aggregate + normalize free RSS feeds → JSON (edge-cached)
│   └── wiki.js       # Wikipedia "On this day" events
├── public/
│   ├── index.html    # App shell
│   ├── styles.css    # Design system
│   ├── app.js        # Rendering, search, self-refresh, PWA install
│   ├── sw.js         # Service worker (offline app shell)
│   ├── 404.html      # Branded not-found page
│   ├── manifest.webmanifest
│   ├── robots.txt · sitemap.xml
│   ├── logo.svg      # Minimal meridian mark
│   └── icons/icon.svg
├── vercel.json       # Clean URLs · security headers · cron warm-up
└── package.json
```

## API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/news?category=<cat>` | Aggregated, de-duplicated headlines. Categories: `top`, `world`, `business`, `technology`, `science`, `health`, `sports`, `entertainment`. |
| `GET` | `/api/wiki` | Notable historical events for the current date. |

Both return JSON and are cached at the edge (`s-maxage`) so upstream sources are
never hammered.

## Run locally

```bash
npm install
npx vercel dev      # serves the static app + /api functions at localhost:3000
```

## Deploy

```bash
vercel deploy --prod
```

Hosted on Vercel: static assets on the CDN, `/api/*` as Node serverless
functions, security headers and a content-security policy applied in
`vercel.json`, and a cron job that keeps the feed warm.

## Roadmap

- **Markets** — indices, movers, and charts via free/delayed quote feeds.
- **History explorer** — Wikipedia-driven topic pages with rich visuals.
- **Native shells** — Capacitor (Android/iOS) and Tauri (`.exe`) wrappers.

## License

MIT — see [`LICENSE`](LICENSE).

---

<div align="center">
<sub><b>A Thingy by <a href="https://github.com/andringodson">Andrin Godson</a></b></sub>
</div>
