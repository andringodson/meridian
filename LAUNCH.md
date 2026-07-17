# Meridian — Launch & Growth Playbook (all free)

Everything here costs nothing and is yours to execute — Claude can't (and
shouldn't) post to communities on your behalf. Work top to bottom: sections 0–1
compound over time, sections 3+ are one-shot launch pushes. Do the two things in
section 0 **before** you post anywhere.

## The hook (use this everywhere)

> **Real-time world news from ~30 open sources — read every story in a calm,
> ad-free reader without bouncing between sites. No login, no tracking,
> installs like an app.**

What makes Meridian different from Google News / Feedly, in one line each:
- **The reader** — tap any story, it opens *in Meridian* (hero + the lead
  paragraphs), no ad walls, no cookie banners, no 30 different site layouts.
- **"New since last visit"** — unseen stories are flagged; each section shows
  how many are waiting.
- **One calm surface** — news, live-ish market charts, video briefs, and
  Wikipedia's "on this day", all open data, all free, zero ads/keys/tracking.
- **Installable PWA** with an offline shell. Fast: self-hosted fonts, minified,
  edge-cached.

## 0. Turn on analytics + Search Console (10 min — do first)

- [ ] Vercel dashboard → **meridian** → **Analytics** → **Enable Web
      Analytics** (free). The script is already in the site; live visitors,
      views and **referrers** appear instantly — this is how you'll know which
      post actually worked.
- [ ] **Google Search Console** — <https://search.google.com/search-console>.
      Add `meridian-andrin.vercel.app` (URL-prefix), verify with the HTML-tag
      method (paste their meta tag into `public/index.html`), submit the
      sitemap `https://meridian-andrin.vercel.app/sitemap.xml`. Compounding
      organic traffic starts here.
- [ ] **Bing Webmaster Tools** — <https://www.bing.com/webmasters> → "Import
      from Google Search Console" (2 min; also feeds DuckDuckGo + Yahoo).

## 0.5 Ready-to-paste copy

**Show HN title:**
> Show HN: Meridian – read the news from 30 open sources in one ad-free reader

**Show HN body:**
> I wanted to follow the world without bouncing between 30 sites, each with its
> own paywall prompts, cookie walls and ad layouts. So I built Meridian: it
> pulls ~30 publishers' RSS (Google News topics + BBC/Guardian/NPR/Reuters/…),
> interleaves them so no single outlet dominates, and opens any story in a calm
> in-app reader — hero image + the lead paragraphs — with a one-tap link out to
> the original. It also flags what's new since your last visit, has live-ish
> market charts from Yahoo's public endpoints, and Wikipedia's "on this day".
> Vanilla JS, no API keys, no tracking, no ads, free, installable as a PWA.
> Reader extraction and source-mixing are the parts I'd most like feedback on —
> every source is open data.

**Product Hunt tagline (60 chars):**
> The world's news in one calm, ad-free reader — free, open data

**Tweet / X:**
> I built Meridian — read the world's news from ~30 open sources in one calm,
> ad-free reader. No login, no tracking, flags what's new since you last looked,
> installs like an app. → https://meridian-andrin.vercel.app

**Reddit r/InternetIsBeautiful title:**
> A free, ad-free reader for the world's news from ~30 open sources — no account,
> flags what's new since your last visit, built entirely on open data

## 1. Launch posts (biggest single-day spikes)

Lead with the hook. Link the **live site**, not the repo (drop the repo in a
first comment). Reply to every comment fast — engagement in the first hour is
what ranks you.

- [ ] **Hacker News** — "Show HN" (above). Post Tue–Thu ~8–10am ET. Be present
      for 3–4 hours to answer.
- [ ] **Product Hunt** — <https://www.producthunt.com/posts/new>. Gallery image
      = `public/og.png`; schedule for 12:01am PT; line up a few friends to be
      early.
- [ ] **Reddit** — one subreddit/day, title tailored to each:
      r/InternetIsBeautiful, r/SideProject, r/webdev (Showoff Saturday), r/PWA,
      r/rss. Read each sub's self-promo rules first.
- [ ] **dev.to / Hashnode** — "Building a zero-build, zero-key real-time news
      reader (and a readability extractor in ~120 lines)". Technical write-ups
      outlive launch day and rank on Google.
- [ ] **X + LinkedIn** — a 20–30s screen-record: open a story into the reader,
      swipe prev/next, show the "new" flags and the live ticker.

## 2. Share loop (built-in — use it)

- Every story's **Share** button now copies a **Meridian** link
  (`/?read=<story>`) that reopens that story *in the reader* for whoever clicks
  — so shares bring people back to Meridian, not straight to the outlet. Share
  interesting stories yourself; each is a tiny ad for the site.
- Section deep links still work for targeted shares: `?view=markets`,
  `?cat=technology`, etc.

## 3. GitHub as a discovery channel

- [x] Repo is **public**.
- [ ] Confirm **topics** are set: `news`, `pwa`, `rss`, `open-data`,
      `vanilla-js`, `finance`, `vercel`.
- [ ] Settings → **Social preview** → upload `public/og.png`.
- [ ] Pin the repo on your profile; put the live link in the About box.
- [ ] Profile README (`andringodson/andringodson`) featuring Meridian with a
      screenshot/GIF.

## 4. Directories & listings (slow drip, one-shot each)

- [ ] PWA directories: findpwa.com, appsco.pe, progressivewebapproom.com.
- [ ] **AlternativeTo** — list Meridian as an alternative to Google News /
      Feedly / Ground News.
- [ ] Free launchpads: Uneed, Peerlist, Fazier, Tiny Launch.

## 5. Retention (what makes traffic stick)

Say this in every post — "install it like an app" is the retention hook:
- Installable PWA + offline shell, **Saved** stories, **For You** topics,
  markets **watchlist**, the **reader**, and "new since last visit" so it's
  worth coming back daily.
- Watch Search Console → Performance after a week; fold the queries you rank for
  into `<meta name="description">`.

---
A Thingy by [Andrin Godson](https://github.com/andringodson)
