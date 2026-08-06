// Meridian — news search endpoint.
// Searches all of the news, not just what's on screen: queries Google News'
// keyless search feed (it aggregates the same publishers as the topic feeds),
// then reuses Meridian's own normalize + same-story clustering so a query reads
// like a curated result set, not a raw RSS dump. Edge-cached per query.
import { XMLParser } from 'fast-xml-parser';
import { identify, PUBLISHERS } from './_publishers.js';
import { stripHtml, safeLink } from './_text.js';

// Same edition triple as api/news.js, so a search returns the same regional
// slice of the news the feed is showing.
const EDITION_LOCALE = {
  us: ['en-US', 'US', 'US:en'], gb: ['en-GB', 'GB', 'GB:en'], in: ['en-IN', 'IN', 'IN:en'],
  au: ['en-AU', 'AU', 'AU:en'], ca: ['en-CA', 'CA', 'CA:en'],
};
const gnSearch = (q, edition = 'us') => {
  const [hl, gl, ceid] = EDITION_LOCALE[edition] || EDITION_LOCALE.us;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${encodeURIComponent(ceid)}`;
};

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

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Google News search titles are "Headline - Source"; split off the source and,
// where present, credit the original publisher. Descriptions in this feed are a
// nested <ol> of related links, never real article prose, so summary stays blank.
function normalize(item) {
  const rawTitle = stripHtml(item.title?.['#text'] ?? item.title ?? '');
  // See the note in api/news.js — a feed-supplied link reaches an href.
  const link = safeLink(
    (typeof item.link === 'object' ? item.link['@_href'] : item.link) ||
    item.guid?.['#text'] || item.guid || ''
  );
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
  // Same publisher identity as the feed, so a search result opens with the
  // same byline and provenance as the story would have on the home page.
  const pub = identify(source, link);
  const published = item.pubDate || item.published || item.updated || '';
  return {
    title,
    link,
    source: pub ? pub.name : '',
    publisher: pub ? pub.key : null,
    summary: '',
    image: null,
    publishedAt: published ? new Date(published).toISOString() : null,
  };
}

function parseFeed(xml) {
  const doc = parser.parse(xml);
  const items = doc?.rss?.channel?.item || doc?.feed?.entry || [];
  const arr = Array.isArray(items) ? items : [items];
  // Unattributable items (no <source>, no " - Publisher" suffix) are dropped
  // rather than bylined to the aggregator that listed them.
  return arr.map(normalize).filter((a) => a.title && a.link && a.source);
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
    // Dedupe on the publisher key so one newsroom arriving under two labels is
    // not counted twice, and never credit an unidentified aggregator entry.
    const idOf = (m) => m.publisher || m.source.toLowerCase();
    const covered = new Set([idOf(rep)]);
    const coverage = [];
    for (const m of sorted) {
      if (!m.publisher) continue;
      const s = idOf(m);
      if (m === rep || covered.has(s)) continue;
      covered.add(s);
      coverage.push({ source: m.source, publisher: m.publisher, link: m.link });
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
  const edition = EDITION_LOCALE[String(req.query?.edition || '').toLowerCase()] ? String(req.query.edition).toLowerCase() : 'us';
  if (q.length < 2) {
    res.status(400).json({ error: 'query too short', query: q });
    return;
  }

  let articles = [];
  try {
    articles = parseFeed(await fetchText(gnSearch(q, edition)));
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
  articles = clusterStories([...seen.values()]).slice(0, 60);
  // Counted after clustering and slicing, so the tally describes the results
  // actually returned rather than the raw feed they were drawn from.
  const sourceCount = new Set(
    articles.flatMap((a) => [a.publisher || a.source, ...(a.coverage || []).map((c) => c.publisher || c.source)])
      .filter(Boolean)
  ).size;

  // Per-query cache: fresh within 2 min, served stale while revalidating so a
  // repeated query is instant and upstream is queried at most once a window.
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600, stale-if-error=86400');
  // Provenance for the outlets in these results, so a story opened from search
  // shows the same coverage spread it would from the feed.
  const present = {};
  for (const a of articles) {
    for (const id of [a.publisher, ...(a.coverage || []).map((c) => c.publisher)]) {
      if (id && PUBLISHERS[id]) present[id] = PUBLISHERS[id];
    }
  }
  res.status(200).json({
    query: q,
    count: articles.length,
    sources: sourceCount,
    publishers: present,
    updatedAt: new Date().toISOString(),
    articles,
  });
}
