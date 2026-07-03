<div align="center">

<img src="public/logo.svg" alt="Meridian" width="72" height="72" />

# Meridian

**Real-time intelligence — world news, history and markets from open sources, updated on its own.**

[![Live](https://img.shields.io/badge/live-meridian.vercel.app-0000ee?style=flat-square)](https://meridian.vercel.app)
[![PWA](https://img.shields.io/badge/installable-PWA-0000ee?style=flat-square)](https://meridian.vercel.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-222222?style=flat-square)](LICENSE)

</div>

---

## Overview

Meridian is a real-time intelligence surface. It aggregates world news from
open public feeds, surfaces the day in history from Wikipedia, and refreshes
itself continuously — no accounts, no API keys, no manual reloads. One
codebase runs as a website and installs as an app on Android, iOS, and Windows
via PWA.

> **v1 is news-first.** Market analytics and a deeper history explorer are the
> next strands on the same foundation.

## Features

- **Live news aggregation** — multiple free RSS sources per category (Google
  News topics + curated publishers), normalized and de-duplicated server-side.
- **Self-updating** — the client refreshes on a timer and on refocus; the API
  is cached at the edge (`s-maxage`), and a scheduled job keeps it warm. Content
  stays current with zero user action.
- **On this day** — notable historical events for the current date, from the
  Wikimedia REST feed.
- **Installable everywhere** — a PWA with offline app-shell caching; installs on
  desktop and mobile from the browser.
- **Creative, cohesive visuals** — stories without artwork get a deterministic
  cinematic gradient keyed to their headline, so the grid always looks composed.
- **Open sources only** — no keys required. Wikipedia + public RSS.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Zero-build vanilla JS · Space Grotesk / Arial · installable PWA |
| API | Vercel serverless functions (Node) · `fast-xml-parser` |
| Data | Public RSS (Google News, BBC, Guardian, Al Jazeera, The Verge …) · Wikipedia REST |
| Hosting | Vercel (static frontend + serverless `/api`) |

## Design

Dark, cinematic, premium — a black canvas, white type, a single electric-blue
accent (`#0000ee`), grotesk display headings, and flat hairline-bordered
surfaces. (Design language adapted from the TitanGate Equity system.)

## Project structure

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
│   ├── manifest.webmanifest
│   ├── logo.svg      # Minimal meridian mark
│   └── icons/icon.svg
├── vercel.json       # Clean URLs + cron warm-up
└── package.json
```

## Run locally

```bash
npm install
npx vercel dev      # serves the static app + /api functions
```

Or deploy:

```bash
vercel deploy --prod
```

## Roadmap

- **Markets** — real-time (or delayed-free) quotes, indices, movers, and charts.
- **History explorer** — Wikipedia-driven topic pages with rich visuals.
- **Native shells** — Capacitor (Android/iOS) and Tauri (`.exe`) wrappers.

## License

MIT — see [`LICENSE`](LICENSE).
