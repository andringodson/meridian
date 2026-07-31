<div align="center">

<!-- The app's logo.svg is drawn in currentColor, which an <img> cannot inherit
     from GitHub's theme — it resolves to black and disappears in dark mode.
     These two variants are literally coloured and swapped by prefers-color-scheme. -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset=".github/assets/logo-light.svg" />
  <img src=".github/assets/logo-light.svg" alt="Meridian" width="76" height="76" />
</picture>

# Meridian

**Read the world from one calm surface — news, markets and history, drawn entirely from open sources and kept current on its own.**

[![Live](https://img.shields.io/badge/live-meridian--andrin.vercel.app-0000ee?style=flat-square)](https://meridian-andrin.vercel.app)
[![PWA](https://img.shields.io/badge/installable-PWA-0000ee?style=flat-square)](https://meridian-andrin.vercel.app)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-222222?style=flat-square)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-222222?style=flat-square)](LICENSE)

</div>

---

## About

Meridian is a personal wire service. It draws headlines from a spread of
established newsrooms, folds the same story told by different outlets into one
card, threads in the day's history from Wikipedia, and keeps itself current
without being asked. No account, no API keys, no tracking, no advertising.

Three commitments shape it:

**Provenance over volume.** Every story shows who is carrying it — how many
newsrooms, in which countries, and how each is funded: publicly, commercially or
as a non-profit. Country and funding are matters of public record. Meridian
deliberately publishes no left/right rating, because those are contested and
shipping one would mean encoding someone else's politics as if it were data.

**Intelligence that stays on your device.** Search understands meaning, not just
matching words — "monetary policy" finds the rate decision. It runs on a 7.5 MB
open static-embedding model that executes in the browser as a lookup and an
average, with no neural-network runtime and no WebAssembly. Nothing you read or
type is transmitted anywhere. It is opt-in, cached for offline use, and can be
removed in one click.

**Legible by design.** A black canvas, one electric-blue accent, hairline rules
and typography doing the work. Saved stories keep their text for reading with no
connection at all.

> Meridian reads only open, publicly available sources — public RSS feeds and
> the Wikimedia API. It stores no personal data and requires no account. Every
> story links back to the newsroom that reported it.

## Highlights

- **Real-time aggregation** — multiple free RSS sources per category (Google
  News topics plus curated publishers), normalized and de-duplicated on the
  server so you see each story once, from its original outlet.
- **Search across all the news** — the search box filters what's loaded as you
  type, and Enter escalates to a real full-text search over every source, with
  the same same-story clustering as the feed. No index, no key.
- **Semantic search & For You, on your device** — an optional 7.5 MB language
  model matches stories by *meaning*, so "monetary policy" finds the rate
  decision and following "Space" surfaces a launch story that never says the
  word. It is a [model2vec](https://github.com/MinishLab/model2vec) static
  embedding table — a token → vector lookup with no neural network at
  inference — so there is no WebAssembly, no runtime, no key and no server:
  nothing you type or read leaves the machine. Strictly opt-in, cached for
  offline use, and reversible from Settings.
- **A grounded news assistant** — ask about what is actually on your screen:
  summarise the open story, get the background behind it, or have the day's
  headlines briefed. It answers from the supplied material only and is told to
  say so when that material falls short, so it reports rather than speculates.
  Runs on an open-weights model (Llama 3.3 70B by default) behind a serverless
  route, so no key ever reaches the browser and the page keeps `connect-src
  'self'`. With no key configured it degrades to on-device extractive
  summarising instead of disappearing. See [Assistant setup](#assistant-setup).
- **A neural voice, on your device** — optional. Your system's own voices are
  the default and Meridian now lets you pick the best one it has, which for most
  people is enough. Where it isn't, a ~27 MB opt-in download brings
  [KittenTTS](https://github.com/KittenML/KittenTTS) nano (Apache-2.0) into the
  browser on ONNX Runtime: eight voices, entirely local, cached for offline,
  and given back when switched off. Every byte is served from this origin, so
  `connect-src` stays `'self'`. It reads a paragraph at a time, so the
  word-by-word highlight below stays with the system voice.
- **Read aloud, word by word** — the reader speaks a story and highlights each
  word as it reaches it, using `boundary` events mapped onto ranges and painted
  with the CSS Custom Highlight API, so the article's DOM is never touched while
  it reads. Speed control, a margin marker for the current paragraph, and no
  download: it is the platform's own voice.
- **Compare the accounts** — Meridian already knows which outlets carry the same
  story. *Compare accounts* pulls each newsroom's own text and sets out what
  they agree on, where they diverge in fact or framing, and what only one outlet
  reports — attributed by name, with no verdict on who is right. Without a model
  configured it still lays each outlet's opening line side by side with its
  country and funding.
- **Translate in place** — where the browser ships Chrome's built-in
  `LanguageDetector` and `Translator`, a foreign-language story can be read in
  your own, translated locally with nothing sent anywhere. Offered only when
  detection is confident and the exact pair is supported.
- **Dark and light** — the black canvas is still the default and still the brand,
  but Settings → Appearance offers Light and System. Every colour resolves
  through a token, and the light greys are re-picked against white rather than
  inverted, so contrast holds at small sizes.
- **Self-updating** — the client refreshes on a timer and on refocus; the API is
  cached at the edge with `stale-while-revalidate`, so responses are instant and
  refreshed in the background. Meridian stays current with zero interaction.
- **Live markets ticker** — world indices, crypto and commodities streamed from
  a free quote feed, with a continuous marquee and up/down colouring.
- **The Desk** — four AI curator personas (Optimist, Analyst, Culturist,
  Skeptic) each surface a top pick from the live feed, refreshed with it.
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

Both themes come out of one token block at the top of `styles.css`; there is no
second stylesheet and no duplicated palette. Light is a re-pick rather than an
inversion — `#999` secondary text is 2.8:1 on white and fails, so the light
greys are chosen against white independently, and a selected pill swaps its
label to the accent because white on a 9%-opacity tint is invisible.

`theme.js` is render-blocking in `<head>` on purpose: it stamps the palette class
on `<html>` before the first paint, so switching never flashes. It is a separate
file rather than an inline script because the page ships `script-src 'self'`
with no hash allowance.

## Architecture

Meridian is a static front end over a thin serverless API, deployed as one
Vercel project. The browser never talks to upstream feeds directly (which avoids
CORS and keys); the serverless functions fetch, parse, normalize, and cache.

```
meridian/
├── api/
│   ├── news.js       # Aggregate + normalize free RSS feeds → JSON (edge-cached)
│   ├── search.js     # Full-text search over all the news (Google News search feed)
│   ├── ai.js         # Assistant — streams an open-weights model, key stays server-side
│   └── wiki.js       # Wikipedia "On this day" events
├── public/
│   ├── index.html    # App shell
│   ├── theme.js      # Palette boot — render-blocking, sets dark/light before paint
│   ├── styles.css    # Design system (both themes, one token block)
│   ├── app.js        # Rendering, search, self-refresh, PWA install
│   ├── assistant.js  # Assistant UI + on-device extractive fallback
│   ├── readaloud.js  # Spoken stories with word-level highlighting
│   ├── translate.js  # On-device translation (Chrome built-in AI)
│   ├── pointer.js    # Magnetic controls + card spotlight
│   ├── embed.js      # On-device semantic engine (WordPiece + static vectors)
│   ├── models/potion # Quantised embedding table — built by scripts/make-embedding-model.mjs
│   ├── sw.js         # Service worker (offline app shell)
│   ├── 404.html      # Branded not-found page
│   ├── manifest.webmanifest
│   ├── robots.txt · sitemap.xml
│   ├── logo.svg      # Minimal meridian mark
│   └── icons/icon.svg
├── vercel.json       # Clean URLs · security headers · CSP
└── package.json
```

## API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/news?category=<cat>` | Aggregated, de-duplicated headlines. Categories: `top`, `world`, `business`, `technology`, `science`, `health`, `sports`, `entertainment`. |
| `GET` | `/api/search?q=<query>` | Full-text search across all the news (Google News' keyless search feed), normalized and same-story clustered like the main feed. |
| `GET` | `/api/wiki` | Notable historical events for the current date. |
| `GET` | `/api/markets` | World indices, crypto & commodities (delayed quotes). |
| `GET` | `/api/ai` | Capability probe — `{ available, model }`. Never returns the key. |
| `POST` | `/api/ai` | Assistant. Body: `{ mode, question, article, cluster, headlines, topics, edition, history }` where `mode` is `ask`\|`summarize`\|`explain`\|`brief`\|`compare`. Streams the answer as plain text. |

These return JSON and are cached at the edge (`s-maxage`) so upstream sources are
never hammered. `/api/ai` is the exception: `no-store`, and streamed.

## Public API

Meridian's aggregation is available as a small public API. What makes it worth
consuming rather than reading raw RSS is the two things done to the feeds:
same-story clustering, so one event is one story rather than twelve
near-duplicates, and provenance — where each newsroom is based and how it is
funded, plus a reading of how concentrated the coverage is.

```
GET /api/v1                 discovery document
GET /api/v1/stories         clustered stories with provenance
GET /api/v1/publishers      the provenance registry
```

`/api/v1/stories` takes `category`, `edition` and `limit` (1–100, default 40):

```bash
curl 'https://meridian-andrin.vercel.app/api/v1/stories?category=world&limit=5'
```

Each story carries a `spread`:

```json
{
  "outlets": 5,
  "known": 4,
  "countries": ["US", "GB"],
  "funding": { "private": 3, "public": 1 },
  "concentration": "broad"
}
```

`known` is how many of those outlets have provenance on file — claims are only
made over those, and `concentration` is `null` below three. **No left/right
rating is published**, for the reason given at the top of `api/_publishers.js`:
country and funding are matters of public record, political lean is contested,
and shipping one would mean shipping someone else's judgement as though it were
data.

CORS-open, edge-cached, and rate limited to 60 requests per minute per address.
Please cache — this proxies live newsroom feeds. Headlines, standfirsts and
links only; article bodies are never republished, and every story links back to
the newsroom that reported it.

## Assistant setup

The assistant is optional. Without configuration the route answers `503
ai-unconfigured` and the client falls back to extractive summarising on the
device — worse prose, same facts, works offline. To enable the generative path,
set one environment variable in the Vercel project (Settings → Environment
Variables) or in `.env.local` for `vercel dev`:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `AI_API_KEY` | no | — | Deployment-wide provider key. Never sent to the browser. Optional now: a reader can supply their own in Settings instead. |
| `AI_BASE_URL` | no | `https://api.groq.com/openai/v1` | Any OpenAI-compatible endpoint. |
| `AI_MODEL` | no | `llama-3.3-70b-versatile` | Open weights by default. |

Groq is the default because its free tier serves Llama 3.3 70B without a credit
card (roughly 30 requests/minute, 14,400/day at the time of writing) and its
latency suits streaming. Nothing about the route is Groq-specific — Cerebras,
Together, OpenRouter or a local vLLM work by changing `AI_BASE_URL` and
`AI_MODEL`.

Two things worth knowing about the design:

- **The key never reaches the client.** The browser only ever calls
  `/api/ai` on its own origin, which is what lets the page keep
  `connect-src 'self'` in its CSP.
- **Third-party article text is fenced.** Story bodies come from arbitrary news
  pages, so they are wrapped in explicit markers and the system prompt tells the
  model that anything inside them is data to analyse, never instructions to
  follow.

## Run locally

```bash
npm install
npx vercel dev      # static app + /api functions at localhost:3000
```

## Build & preview

Meridian ships a minified bundle. The build mirrors `public/` into `dist/`,
minifying JS/CSS with [esbuild] and HTML with html-minifier-terser (same
filenames, so nothing needs rewiring). Vercel runs it automatically
(`buildCommand` in `vercel.json`); to run it yourself:

```bash
npm run build       # → dist/  (minified, ~24% smaller before gzip)
npm run preview     # serve the built bundle at localhost:8080 (static only)
```

## Performance

- **Self-hosted display font** — Space Grotesk ships as one variable `woff2`
  from the same origin, so first paint no longer waits on a third-party font
  stylesheet + `gstatic` round-trip. The font is cached `immutable` for a year.
- **Minified bundle** — JS/CSS/HTML are minified on build; long-lived assets
  (fonts, icons) get immutable caching, code gets revalidated so deploys apply.
- **Idle-aware client** — news, markets, video and the "new-since-last-visit"
  sweep all pause while the tab is hidden and run off `requestIdleCallback`, so
  a backgrounded tab spends almost no network.

## Docker toolchain

A reproducible build/preview/audit environment — *not* the production runtime
(that's Vercel). Handy for building or benchmarking the bundle on any machine:

```bash
docker compose up preview                            # build + serve on :8080
docker compose run --rm build                        # emit dist/ to the host
docker compose --profile audit run --rm lighthouse   # Lighthouse → ./reports
```

## Deploy

```bash
vercel deploy --prod
```

Hosted on Vercel: the built `dist/` on the CDN, `/api/*` as Node serverless
functions, and security headers plus a content-security policy applied in
`vercel.json`.

[esbuild]: https://esbuild.github.io/

## Roadmap

- **Markets** — a full analytics view (movers, charts, watchlists) building on
  the live ticker.
- **History explorer** — Wikipedia-driven topic pages with rich visuals.
- **Native shells** — Capacitor (Android/iOS) and Tauri (`.exe`) wrappers.

## License

MIT — see [`LICENSE`](LICENSE).

---

<div align="center">
<sub><b>A Thingy by <a href="https://github.com/andringodson">Andrin Godson</a></b></sub>
</div>
