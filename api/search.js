// Meridian — news search endpoint.
// Searches all of the news, not just what's on screen: queries Google News'
// keyless search feed (it aggregates the same publishers as the topic feeds),
// then reuses Meridian's own normalize + same-story clustering so a query reads
// like a curated result set, not a raw RSS dump. Edge-cached per query.
import { XMLParser } from 'fast-xml-parser';

const gnSearch = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  // Google News' feed exceeds fast-xml-parser's entity-expansion cap and would
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

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Google News search titles are "Headline - Source"; split off the source and,
// where present, credit the original publisher. Descriptions in this feed are a
// nested <ol> of related links, never real article prose, so summary stays blank.
function normalize(item) {
  const rawTitle = stripHtml(item.title?.['#text'] ?? item.title ?? '');
  const link =
    (typeof item.link === 'object' ? item.link['@_href'] : item.link) ||
    item.guid?.['#text'] || item.guid || '';
  let title = rawTitle;
  let source =
    (typeof item.source === 'object' ? item.source['#text'] : item.source) || '';
  if (!source && / - [^-]+$/.test(rawTitle)) {
    const idx = rawTitle.lastIndexOf(' - ');
    title = rawTitle.slice(0, idx);
    source = rawTitle.slice(idx + 3);
  }
  if (/^©/.test(source) || source.length > 40) source = '';
  if (!source) source = hostOf(link);
  const published = item.pubDate || item.published || item.updated || '';
  return {
    title,
    link,
    source: source.trim(),
    summary: '',
    image: null,
    publishedAt: published ? new Date(published).toISOString() : null,
  };
}

function parseFeed(xml) {
  const doc = parser.parse(xml);
  const items = doc?.rss?.channel?.item || doc?.feed?.entry || [];
  const arr = Array.isArray(items) ? items : [items];
  return arr.map(normalize).filter((a) => a.title && a.link);
}

const keyOf = (a) =>
  a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);

/* ---------- same-story clustering (shared shape with api/news.js) ----------
   Fold the same event, worded differently by different outlets, into one card
   carrying a `coverage` list of the other outlets. */
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
    const rep = sorted[0];
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
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const q = String(req.query?.q || '').trim().slice(0, 120);
  if (q.length < 2) {
    res.status(400).json({ error: 'query too short', query: q });
    return;
  }

  let articles = [];
  try {
    articles = parseFeed(await fetchText(gnSearch(q)));
  } catch {
    res.setHeader('Cache-Control', 's-maxage=30');
    res.status(502).json({ error: 'search unavailable', query: q });
    return;
  }

  // De-duplicate by normalized headline, keep the newest.
  const seen = new Map();
  for (const a of articles) {
    const k = keyOf(a);
    const prev = seen.get(k);
    if (!prev || (a.publishedAt || '') > (prev.publishedAt || '')) seen.set(k, a);
  }
  const sourceCount = new Set(articles.map((a) => a.source)).size;
  articles = clusterStories([...seen.values()]).slice(0, 60);

  // Per-query cache: fresh within 2 min, served stale while revalidating so a
  // repeated query is instant and upstream is queried at most once a window.
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600, stale-if-error=86400');
  res.status(200).json({
    query: q,
    count: articles.length,
    sources: sourceCount,
    updatedAt: new Date().toISOString(),
    articles,
  });
}
