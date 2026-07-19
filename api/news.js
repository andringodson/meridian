// Meridian — news aggregation endpoint.
// Pulls free, no-key RSS feeds (Google News topics + curated publishers),
// normalizes and de-duplicates them, and returns JSON. Cached at the CDN edge
// so the site stays fresh on its own without hammering upstreams.
import { XMLParser } from 'fast-xml-parser';

const GN = 'https://news.google.com/rss';
const gnTopic = (id) =>
  `${GN}/headlines/section/topic/${id}?hl=en-US&gl=US&ceid=US:en`;

// Category → list of source feeds. Google News topic feeds aggregate many
// publishers; a couple of direct feeds add variety and resilience.
const FEEDS = {
  top: [
    `${GN}?hl=en-US&gl=US&ceid=US:en`,
    'https://feeds.bbci.co.uk/news/rss.xml',
    'https://www.aljazeera.com/xml/rss/all.xml',
    'https://feeds.npr.org/1001/rss.xml',
    'https://rss.dw.com/rdf/rss-en-all',
    'https://www.france24.com/en/rss',
    'https://feeds.skynews.com/feeds/rss/home.xml',
    'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml',
    'https://www.theguardian.com/international/rss',
    'https://www.cbsnews.com/latest/rss/main',
    'https://www.independent.co.uk/news/rss',
  ],
  world: [
    gnTopic('WORLD'),
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://www.theguardian.com/world/rss',
    'https://feeds.npr.org/1004/rss.xml',
    'https://www.cbc.ca/webfeed/rss/rss-world',
    'https://rss.dw.com/rdf/rss-en-world',
    'https://feeds.skynews.com/feeds/rss/world.xml',
    'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
    'https://www.independent.co.uk/news/world/rss',
    'https://www.cbsnews.com/latest/rss/world',
  ],
  business: [
    gnTopic('BUSINESS'),
    'https://feeds.bbci.co.uk/news/business/rss.xml',
    'https://www.theguardian.com/uk/business/rss',
    'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    'https://feeds.npr.org/1006/rss.xml',
    'https://feeds.skynews.com/feeds/rss/business.xml',
    'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
    'https://fortune.com/feed/',
    'https://www.independent.co.uk/news/business/rss',
  ],
  technology: [
    gnTopic('TECHNOLOGY'),
    'https://feeds.bbci.co.uk/news/technology/rss.xml',
    'https://www.theverge.com/rss/index.xml',
    'https://feeds.arstechnica.com/arstechnica/index',
    'https://www.wired.com/feed/rss',
    'https://techcrunch.com/feed/',
    'https://feeds.skynews.com/feeds/rss/technology.xml',
    'https://www.engadget.com/rss.xml',
    'https://gizmodo.com/feed',
    'https://www.cnet.com/rss/news/',
  ],
  science: [
    gnTopic('SCIENCE'),
    'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
    'https://www.theguardian.com/science/rss',
    'https://feeds.npr.org/1007/rss.xml',
    'https://feeds.arstechnica.com/arstechnica/science',
    'https://www.space.com/feeds/all',
    'https://www.livescience.com/feeds/all',
    'https://www.nasa.gov/rss/dyn/breaking_news.rss',
  ],
  health: [
    gnTopic('HEALTH'),
    'https://feeds.npr.org/1128/rss.xml',
    'https://www.theguardian.com/society/health/rss',
    'https://feeds.bbci.co.uk/news/health/rss.xml',
    'https://rss.nytimes.com/services/xml/rss/nyt/Health.xml',
    'https://www.statnews.com/feed/',
    'https://www.independent.co.uk/topic/health/rss',
  ],
  sports: [
    gnTopic('SPORTS'),
    'https://feeds.bbci.co.uk/sport/rss.xml',
    'https://www.espn.com/espn/rss/news',
    'https://www.theguardian.com/sport/rss',
    'https://www.skysports.com/rss/12040',
    'https://sports.yahoo.com/rss/',
    'https://www.cbssports.com/rss/headlines/',
  ],
  entertainment: [
    gnTopic('ENTERTAINMENT'),
    'https://www.theguardian.com/culture/rss',
    'https://feeds.npr.org/1008/rss.xml',
    'https://variety.com/feed/',
    'https://feeds.skynews.com/feeds/rss/entertainment.xml',
    'https://deadline.com/feed/',
    'https://www.hollywoodreporter.com/feed/',
    'https://www.rollingstone.com/feed/',
    'https://www.billboard.com/feed/',
  ],
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  // Big feeds (Google News) exceed the default entity-expansion cap and would
  // be dropped whole; stripHtml() decodes the common entities instead.
  processEntities: false,
});

async function fetchText(url, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'MeridianBot/0.1 (+https://github.com; news reader)' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

function stripHtml(s = '') {
  return String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Bump common CDN thumbnail URLs to a larger, sharper size so cards don't
// upscale a tiny image into a blurry mess.
function upgradeImage(url) {
  if (!url) return url;
  try {
    let u = url;
    // Signed resizer URLs must pass through untouched — changing any size
    // param voids the signature and the CDN serves an error page instead of
    // the picture. Covers the Guardian (s=<hash> query) and Red Ventures
    // sites like CNET/ZDNet (40-hex signature in the resize path).
    if (/i\.guim\.co\.uk/i.test(u) || /\/resize\/[0-9a-f]{40}\//i.test(u)) return u;
    // WordPress / many CMSs: strip "-320x180" style size suffixes → original.
    u = u.replace(/-\d{2,4}x\d{2,4}(\.(jpe?g|png|webp))/i, '$1');
    // BBC ichef: width lives in the path (…/standard/240/… or …/news/240/…).
    u = u.replace(/(ichef\.bbci\.co\.uk\/(?:ace\/)?[a-z_]+)\/\d{2,4}\//i, '$1/1024/');
    // BBC ichef "images/ic" variant sizes with WxH in the path.
    u = u.replace(/(ichef\.bbci\.co\.uk\/images\/ic)\/\d+x\d+\//i, '$1/1920x1080/');
    // CBS signs each thumbnail size (resizing the path 404s), but the original
    // upload lives at the same path minus the /thumbnail/<size>/<hash>/ leg.
    if (/cbsnewsstatic\.com/i.test(u)) {
      u = u.replace(/\/thumbnail\/\d+x\d+\/[0-9a-f]{32}\//i, '/');
    }
    // NPR's dims3 resizer re-renders on demand; RSS asks for the full crop
    // (4500px+, seconds-slow). Cap at 1200 wide, keeping the aspect ratio.
    if (/brightspotcdn\.com\/dims3\//i.test(u)) {
      u = u.replace(/\/resize\/(\d+)x(\d+)(!?)\//i, (m, w, h, ex) =>
        +w > 1400 ? `/resize/1200x${Math.round((+h / +w) * 1200)}${ex}/` : m);
    }
    // Query-sized CDNs (Guardian, WP, Cloudinary, etc.): raise the dimensions.
    u = u.replace(/([?&](?:width|w))=\d+/gi, '$1=1200')
         .replace(/([?&](?:height|h))=\d+/gi, '$1=675')
         .replace(/([?&](?:quality|q))=\d+/gi, '$1=85')
         .replace(/([?&]resize=)\d+(?:px)?%2C\d+(?:px)?/gi, '$11200px%2C675px');
    return u;
  } catch { return url; }
}

// URLs arrive entity-escaped (processEntities is off); a literal "&#038;" in a
// query string reads as a fragment marker in the browser and hides the params
// behind it from upgradeImage.
const decodeUrl = (u) => String(u).replace(/&amp;|&#0?38;/gi, '&');

// Tracking pixels and other non-pictures that RSS feeds disguise as images
// (NPR ships a 1×1 rss-pixel as the first <img> of every description; the BBC
// sport feed leads with an a1.api.bbc.co.uk/hit.xiti analytics beacon).
const JUNK_IMG = /rss-pixel|\/pixel[._?-]|feedburner\.com|gravatar\.com|\/1x1[._-]|hit\.xiti|a1\.api\.bbc\.co\.uk|\/(?:hit|beacon|track(?:ing)?)[._/?-]/i;

// CDNs that only ever serve sub-ultra widths in RSS: the Guardian's signed
// resizer caps at 700px (its signature voids if you touch the width — verified
// 401) and Yahoo's zenfs store hands back fixed <1000px crops that ignore any
// size param. We keep these quality sources, but let sharper CDNs fill the
// feed first so a surplus tab isn't crowded out by capped thumbnails.
const CAPPED_HOST = /i\.guim\.co\.uk|media\.zenfs\.com/i;

// Pick the highest-resolution image RSS offers, from wherever it hides it.
function extractImage(item) {
  let best = null, bestW = 0;
  const consider = (node) => {
    if (!node) return;
    const url = node['@_url'] || (typeof node === 'string' ? node : null);
    if (!url || !/^https?:\/\//.test(url) || JUNK_IMG.test(url)) return;
    const w = parseInt(node['@_width'] || 0, 10) || 0;
    if (!best || w > bestW) { best = decodeUrl(url); bestW = w; }
  };
  const mc = item['media:content'] ?? item['media:group']?.['media:content'];
  if (Array.isArray(mc)) mc.forEach(consider); else consider(mc);
  const mt = item['media:thumbnail'] ?? item['media:group']?.['media:thumbnail'];
  if (Array.isArray(mt)) mt.forEach(consider); else consider(mt);
  consider(item.enclosure);
  consider(item.image); // CBS-style plain <image> child
  if (!best) {
    // Embedded HTML arrives entity-escaped (processEntities is off) — decode
    // enough of it to find the first <img>. Covers RSS description/encoded
    // and Atom content/summary.
    const raw = ['content:encoded', 'content', 'description', 'summary']
      .map((k) => item[k]?.['#text'] ?? item[k])
      .find((v) => typeof v === 'string' && v.length) || '';
    const html = raw
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&');
    // First *real* image — descriptions often lead with a tracking pixel.
    for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
      if (/^https?:\/\//.test(m[1]) && !JUNK_IMG.test(m[1])) { best = decodeUrl(m[1]); break; }
    }
  }
  // Feeds occasionally emit literal "undefined"/relative src values.
  if (best && !/^https?:\/\//.test(best)) best = null;
  return upgradeImage(best);
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function normalize(item, feedUrl) {
  const rawTitle = stripHtml(item.title?.['#text'] ?? item.title ?? '');
  const link =
    (typeof item.link === 'object' ? item.link['@_href'] : item.link) ||
    item.guid?.['#text'] || item.guid || '';
  // Google News titles are "Headline - Source"; split off the trailing source.
  // Only GN feeds get this treatment — regular publisher titles may contain
  // " - " and must not be split.
  const isGN = feedUrl.includes('news.google.com');
  let title = rawTitle;
  let source =
    (typeof item.source === 'object' ? item.source['#text'] : item.source) || '';
  if (isGN && !source && / - [^-]+$/.test(rawTitle)) {
    const idx = rawTitle.lastIndexOf(' - ');
    title = rawTitle.slice(0, idx);
    source = rawTitle.slice(idx + 3);
  }
  // Credit lines ("© AFP") or overlong strings are not publisher names.
  if (/^©/.test(source) || source.length > 40) source = '';
  if (!source) source = hostOf(link) || hostOf(feedUrl);
  const published = item.pubDate || item.published || item.updated || '';
  return {
    title,
    link,
    source: source.trim(),
    summary: stripHtml(item.description?.['#text'] ?? item.description ?? '').slice(0, 240),
    image: extractImage(item),
    publishedAt: published ? new Date(published).toISOString() : null,
  };
}

function parseFeed(xml, feedUrl) {
  const doc = parser.parse(xml);
  const items =
    doc?.rss?.channel?.item ||
    doc?.feed?.entry || // Atom
    doc?.['rdf:RDF']?.item || // RDF (DW)
    [];
  const arr = Array.isArray(items) ? items : [items];
  return arr.map((it) => normalize(it, feedUrl)).filter((a) => a.title && a.link);
}

const keyOf = (a) =>
  a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);

/* ---------- same-story clustering ----------
   Exact-key dedupe can't see the same event worded differently by different
   outlets. Titles that share most of their significant words are folded into
   one article carrying a `coverage` list of the other outlets, so a story on
   every front page reads as one card with its breadth visible — not five
   near-identical cards. */
const STOP = new Set((
  'the a an of to in on for and with as at by after over from is are be has ' +
  'have it its his her their new says say said will was were this that not ' +
  'no but up out how what why who more than into about amid against could would'
).split(' '));
function sigTokens(title) {
  const set = new Set();
  for (const w of title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (w.length > 3 && !STOP.has(w)) set.add(w);
  }
  return set;
}
function clusterStories(list) {
  const toks = list.map((a) => sigTokens(a.title));
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  // Candidate pairs come from a token index (very common tokens are skipped),
  // so the pass stays near-linear instead of comparing every title pair.
  const posts = new Map();
  toks.forEach((set, i) => {
    for (const w of set) {
      let p = posts.get(w);
      if (!p) posts.set(w, (p = []));
      if (p.length < 20) p.push(i);
    }
  });
  const tried = new Set();
  toks.forEach((set, i) => {
    for (const w of set) {
      for (const j of posts.get(w)) {
        if (j >= i) break;
        const pairKey = j * list.length + i;
        if (tried.has(pairKey)) continue;
        tried.add(pairKey);
        const other = toks[j];
        let inter = 0;
        for (const t of set) if (other.has(t)) inter++;
        if (inter >= 3 && inter >= Math.min(set.size, other.size) * 0.6) {
          const ri = find(i), rj = find(j);
          if (ri !== rj) parent[rj] = ri;
        }
      }
    }
  });
  const groups = new Map();
  list.forEach((a, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(a);
  });
  const out = [];
  for (const members of groups.values()) {
    const sorted = [...members].sort(
      (a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')
    );
    const rep = sorted.find((m) => m.image) || sorted[0];
    const covered = new Set([rep.source.toLowerCase()]);
    const coverage = [];
    for (const m of sorted) {
      const s = m.source.toLowerCase();
      if (m === rep || covered.has(s)) continue;
      covered.add(s);
      coverage.push({ source: m.source, link: m.link });
      if (coverage.length >= 6) break;
    }
    if (coverage.length) rep.coverage = coverage;
    out.push(rep);
  }
  return out.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
}

export default async function handler(req, res) {
  const category = String(req.query?.category || 'top').toLowerCase();
  const feeds = FEEDS[category] || FEEDS.top;

  const results = await Promise.allSettled(feeds.map((f) => fetchText(f)));
  let articles = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      try { articles.push(...parseFeed(r.value, feeds[i])); } catch { /* skip bad feed */ }
    }
  });

  // De-duplicate by normalized headline, keep the newest.
  const seen = new Map();
  for (const a of articles) {
    const k = keyOf(a);
    const prev = seen.get(k);
    if (!prev || (a.publishedAt || '') > (prev.publishedAt || '')) seen.set(k, a);
  }
  const sourceCount = new Set(articles.map((a) => a.source)).size;
  articles = [...seen.values()].sort(
    (a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')
  );

  // Fold same-story items from different outlets into one card + coverage list.
  articles = clusterStories(articles);

  // Round-robin across publishers (newest-first within each, capped) so the
  // feed reads as a mix of voices instead of one source's burst.
  const interleave = (list, limit, perSource = 10) => {
    const bySource = new Map();
    for (const a of list) {
      const s = a.source.toLowerCase();
      if (!bySource.has(s)) bySource.set(s, []);
      if (bySource.get(s).length < perSource) bySource.get(s).push(a);
    }
    const queues = [...bySource.values()];
    const out = [];
    for (let round = 0; out.length < limit; round++) {
      let added = false;
      for (const q of queues) {
        if (out.length >= limit) break;
        if (q[round]) { out.push(q[round]); added = true; }
      }
      if (!added) break;
    }
    return out;
  };
  // The page is visual end to end: only stories with a real preview image make
  // the feed (interleaved across publishers). Imageless wire items are kept
  // solely as emergency fill when a category can't muster enough pictures.
  const LIMIT = 80, FLOOR = 40;
  // Front-load stories on sharper CDNs: when a tab has more images than it can
  // show, the capped-host thumbnails (Guardian 700px, Yahoo zenfs) are the ones
  // that drop, lifting the tab's high-res ratio. Stable sort keeps newest-first
  // within each group, and interleave still mixes publishers for variety.
  const withImage = articles
    .filter((a) => a.image)
    .sort((a, b) => (CAPPED_HOST.test(a.image) ? 1 : 0) - (CAPPED_HOST.test(b.image) ? 1 : 0));
  const imaged = interleave(withImage, LIMIT);
  articles = imaged.length >= FLOOR
    ? imaged
    : [...imaged, ...interleave(articles.filter((a) => !a.image), FLOOR - imaged.length)];

  // Edge-cache: fresh within 60s, serve slightly stale while revalidating.
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600, stale-if-error=86400');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json({
    category,
    count: articles.length,
    sources: sourceCount,
    updatedAt: new Date().toISOString(),
    articles,
  });
}
