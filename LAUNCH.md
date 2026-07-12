# Meridian — Launch & Growth Checklist (all free)

## 0. See your real-time users (2 minutes, do this first)

- [ ] Vercel dashboard → project **meridian** → **Analytics** tab → **Enable
      Web Analytics** (free tier). The tracking script is already in the site;
      the moment you click Enable, live visitors, page views, and referrers
      appear in real time. This is how you'll know which launch post worked.

## 0.5 Ready-to-paste launch copy

**Show HN title:**
> Show HN: Meridian – real-time news, markets and history, all from open data

**Show HN body:**
> I built a real-time intelligence dashboard: world news from ~30 publishers'
> RSS interleaved so no outlet dominates, live-ish market charts from Yahoo's
> public endpoints, video briefs from newsroom YouTube feeds, and Wikipedia's
> "on this day". Zero build tools (vanilla JS), zero API keys, zero tracking,
> free and ad-free. Installable as a PWA with offline support. Would love
> feedback on the source mixing — every feed is open data.

**Product Hunt tagline (60 chars):**
> Real-time news, markets & history — free, open data, no ads

**Tweet/X:**
> Built a thing: Meridian — real-time world news, live market charts, video
> briefs and daily history, all from open data. No ads, no login, no tracking.
> Installs like an app. → https://meridian-andrin.vercel.app

**Reddit r/InternetIsBeautiful title:**
> A free real-time dashboard of world news, markets and history — no ads, no
> account, built entirely on open data

Everything below costs nothing. Work top to bottom; the first two sections
compound over time, the rest are one-shot launch pushes.

## 1. Search engines (do these first — compounding traffic)

- [ ] **Google Search Console** — <https://search.google.com/search-console>
      Add property `meridian-andrin.vercel.app` (URL-prefix), verify via the
      HTML-tag method (add the meta tag they give you to `index.html`), then
      submit the sitemap: `https://meridian-andrin.vercel.app/sitemap.xml`.
- [ ] **Bing Webmaster Tools** — <https://www.bing.com/webmasters>
      "Import from Google Search Console" makes this a 2-minute job. Bing also
      feeds DuckDuckGo and Yahoo.
- [ ] After a week, check Search Console → Performance for the queries you're
      appearing on; add those words to the site `<meta name="description">`.

## 2. GitHub as a discovery channel

- [ ] Make the repo **public** (Settings → Danger Zone → Change visibility).
- [ ] Add **topics**: `news`, `pwa`, `finance`, `vanilla-js`, `rss`,
      `open-data`, `vercel` (Settings → topics box on the repo home).
- [ ] Upload `public/og.png` as the **social preview** (Settings → Social preview).
- [ ] Pin the repo on your profile; add the live link to the repo About box.
- [ ] Create a profile README (`andringodson/andringodson`) featuring Meridian.

## 3. Launch posts (biggest single-day spikes)

Lead with the hook: **"free, ad-free, no login, no tracking — every source is
open data"**. Link the live site, not the repo (repo goes in a comment).

- [ ] **Hacker News** — "Show HN: Meridian – real-time news, markets and
      history from open sources" (<https://news.ycombinator.com/submit>).
      Post on a weekday morning US time; reply to every comment fast.
- [ ] **Product Hunt** — <https://www.producthunt.com/posts/new>. Use og.png
      as the gallery image; schedule for 12:01 AM PT.
- [ ] **Reddit** — r/SideProject, r/InternetIsBeautiful, r/webdev (Showoff
      Saturday), r/PWA. One subreddit per day, tailor the title to each.
- [ ] **dev.to / Hashnode write-up** — "How I built a real-time news + markets
      PWA with zero build tools and zero API keys". Technical posts outlive
      launch day and rank on Google.
- [ ] **X/Twitter + LinkedIn** — short demo clip (screen-record the fluid
      background, ticker and charts; 30–45 s).

## 4. Directories & listings (slow drip, zero effort)

- [ ] PWA directories: <https://progressivewebapproom.com>, findpwa.com,
      appscope (submit once each).
- [ ] AlternativeTo — list Meridian as an alternative to Google News / Feedly.
- [ ] Uneed / Peerlist launchpads — free tiers exist for both.

## 5. Retention (what makes traffic stick)

- Meridian already has: installable PWA, offline shell, Saved stories,
  For You topics, watchlist, daily brief. Mention these in every post —
  "install it like an app" is the retention hook.
- Share the site with the `?cat=` / `?view=markets` deep links when relevant.

---
A Thingy by [Andrin Godson](https://github.com/andringodson)
