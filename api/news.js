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
  ],
  world: [
    gnTopic('WORLD'),
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://www.theguardian.com/world/rss',
  ],
  business: [
    gnTopic('BUSINESS'),
    'https://feeds.bbci.co.uk/news/business/rss.xml',
  ],
  technology: [
    gnTopic('TECHNOLOGY'),
    'https://feeds.bbci.co.uk/news/technology/rss.xml',
    'https://www.theverge.com/rss/index.xml',
  ],
  science: [
    gnTopic('SCIENCE'),
    'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
  ],
  health: [gnTopic('HEALTH')],
  sports: [gnTopic('SPORTS')],
  entertainment: [gnTopic('ENTERTAINMENT')],
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
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

// Pull an image URL out of the many places RSS hides one.
function extractImage(item) {
  const cand =
    item['media:content']?.['@_url'] ||
    item['media:thumbnail']?.['@_url'] ||
    (Array.isArray(item['media:content']) && item['media:content'][0]?.['@_url']) ||
    item.enclosure?.['@_url'] ||
    null;
  if (cand && /^https?:\/\//.test(cand)) return cand;
  const m = String(item['content:encoded'] || item.description || '').match(
    /<img[^>]+src=["']([^"']+)["']/i
  );
  return m ? m[1] : null;
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
  let title = rawTitle;
  let source =
    (typeof item.source === 'object' ? item.source['#text'] : item.source) || '';
  if (!source && / - [^-]+$/.test(rawTitle)) {
    const idx = rawTitle.lastIndexOf(' - ');
    title = rawTitle.slice(0, idx);
    source = rawTitle.slice(idx + 3);
  }
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
    [];
  const arr = Array.isArray(items) ? items : [items];
  return arr.map((it) => normalize(it, feedUrl)).filter((a) => a.title && a.link);
}

const keyOf = (a) =>
  a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);

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
  articles = [...seen.values()].sort(
    (a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')
  ).slice(0, 48);

  // Edge-cache: fresh within 60s, serve slightly stale while revalidating.
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json({
    category,
    count: articles.length,
    updatedAt: new Date().toISOString(),
    articles,
  });
}
