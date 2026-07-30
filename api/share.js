// Meridian — link previews for shared stories.
//
// A shared Meridian link used to inherit the site's static Open Graph tags, so
// every story pasted into Slack, WhatsApp or X previewed identically: the
// Meridian logo and the site tagline, with no hint of what had been shared.
//
// This route serves the story's own headline, standfirst and photograph
// instead. No image is synthesised — api/read.js already extracts og:image,
// og:title and og:site_name from the source page, so the preview shows the
// picture the newsroom actually published, credited to it. That needs no image
// renderer, no font, and no new dependency, and it is more honest than a
// generated card: the reader sees the outlet's own framing of the story.
//
// Crawlers do not execute JavaScript, so they read the tags and stop. People do,
// and are moved straight into the app by a same-origin script — inline script is
// not an option here, the site ships `script-src 'self'` with no hash allowance.

import { extractPage } from './read.js';

const LIMITS = { title: 200, description: 300, url: 2000 };

/* Escapes for both attribute and text contexts. Everything interpolated below
   is third-party: a headline from an arbitrary news page, or a title carried in
   a link anyone can craft. Single quotes are escaped too, since some attributes
   below are the values of double-quoted `content="…"` but the anchor text is
   not — one helper, safe in every position. */
const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

/* Only an absolute http(s) URL may ever reach og:image. The value comes from a
   third-party page, so a `javascript:` or `data:` payload is not hypothetical. */
function safeImage(u) {
  if (!u) return '';
  try {
    const p = new URL(String(u));
    return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : '';
  } catch { return ''; }
}

function origin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'meridian-andrin.vercel.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

function page({ title, description, image, site, canonical, appUrl }) {
  const t = esc(title);
  const d = esc(description);
  const img = esc(image);
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${t}</title>
<meta name="description" content="${d}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Meridian" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:url" content="${esc(canonical)}" />
${img ? `<meta property="og:image" content="${img}" />
<meta name="twitter:image" content="${img}" />
<meta name="twitter:card" content="summary_large_image" />` :
`<meta name="twitter:card" content="summary" />`}
<meta name="twitter:title" content="${t}" />
<meta name="twitter:description" content="${d}" />
${site ? `<meta name="twitter:label1" content="Source" /><meta name="twitter:data1" content="${esc(site)}" />` : ''}
<link rel="icon" href="/logo.svg" type="image/svg+xml" />
<link rel="stylesheet" href="/styles.css" />
<script src="/share-open.js" defer></script>
<noscript><meta http-equiv="refresh" content="0; url=${esc(appUrl)}" /></noscript>
</head>
<body>
<main class="share-wait">
  <p class="share-kicker">Meridian</p>
  <h1>${t}</h1>
  ${site ? `<p class="share-src">${esc(site)}</p>` : ''}
  <p><a class="reader-open" href="${esc(appUrl)}">Open this story</a></p>
</main>
</body>
</html>`;
}

export default async function handler(req, res) {
  const target = String(req.query?.u || '').slice(0, LIMITS.url);
  const hint = String(req.query?.t || '');
  const base = origin(req);

  // Anything that is not a story link belongs at the front page, not at an
  // error — a share URL is something people paste around and mangle.
  if (!/^https?:\/\//i.test(target)) {
    res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  const appUrl = `/?read=${encodeURIComponent(target)}${hint ? `&t=${encodeURIComponent(clip(hint, LIMITS.title))}` : ''}`;
  const canonical = `${base}/s?u=${encodeURIComponent(target)}`;

  let data = null;
  try {
    data = await extractPage(target);
  } catch {
    data = null;   // preview degrades to the link's own hint; never fails outright
  }

  const title = clip(data?.title || hint || 'A story on Meridian', LIMITS.title);
  /* The page's own standfirst first. A first extracted paragraph is frequently
     a byline and a timestamp run together — "Senior football correspondent
     Published 30 July 2026 BST Updated Just now…" — which is precisely what a
     link preview should not lead with. */
  const description = clip(
    data?.description || data?.paragraphs?.[0] ||
      'Read this story in Meridian — world news, markets and history from open sources.',
    LIMITS.description
  );
  const image = safeImage(data?.image);

  // Cache the rendered preview: crawlers re-fetch these, and the extraction
  // behind it is the expensive part. Errors are cached briefly, not for a day.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', data?.ok
    ? 's-maxage=600, stale-while-revalidate=86400'
    : 's-maxage=120');
  res.status(200).end(page({ title, description, image, site: data?.site || '', canonical, appUrl }));
}
