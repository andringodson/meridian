// Meridian — public API v1: clustered stories with provenance.
//
//   GET /api/v1/stories?category=top&edition=us&limit=40
//
// The same aggregation the app runs, under a contract that will not change
// shape within v1. What makes this worth consuming rather than reading a raw
// RSS feed is the two things done to it:
//
//   1. Same-story clustering. Twelve feeds report one event; this returns one
//      story with the outlets that carried it, rather than twelve near-duplicate
//      items to de-duplicate yourself.
//   2. Provenance. Every outlet carries where it is based and how it is funded —
//      public record, from api/_publishers.js — plus a reading of how
//      concentrated the coverage is.
//
// Deliberately absent: any left/right rating. See the note atop
// api/_publishers.js; those are contested, and shipping one would mean shipping
// someone else's political judgement as though it were data.

import { aggregate } from '../news.js';
import { PUBLISHERS } from '../_publishers.js';

const VERSION = 1;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 40;

/* ---------- rate limiting ----------
   Per-instance and therefore approximate: several containers may serve the same
   caller, so the real ceiling is this times the fan-out. It is not a billing
   boundary — it is here so one looping script cannot exhaust the upstream feeds
   this proxies, which are other people's newsrooms. */
const HITS = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

function rateLimit(ip) {
  const now = Date.now();
  const hits = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  HITS.set(ip, hits);
  if (HITS.size > 1000) {
    for (const [k, v] of HITS) if (!v.length || now - v[v.length - 1] > WINDOW_MS) HITS.delete(k);
  }
  return { limited: hits.length > MAX_PER_WINDOW, remaining: Math.max(0, MAX_PER_WINDOW - hits.length) };
}

const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket?.remoteAddress || 'anon';

/* ---------- provenance ---------- */

const outletOf = (o) => {
  const p = o?.publisher && PUBLISHERS[o.publisher];
  return {
    source: (p && p.name) || o?.source || 'unknown',
    country: (p && p.country) || null,
    funding: (p && p.ownership) || null,
    url: o?.link || null,
  };
};

/* How varied is the set of newsrooms carrying this story?

   The honesty constraint is that plenty of sources have no provenance on file.
   A claim about "all five outlets" is false when two of the five cannot be
   placed, so `known` is reported alongside `outlets` and the verdict is only
   offered once at least three are actually known. */
function spreadOf(outlets) {
  const known = outlets.filter((o) => o.country && o.funding);
  const countries = [...new Set(known.map((o) => o.country))];
  const funding = {};
  for (const o of known) funding[o.funding] = (funding[o.funding] || 0) + 1;

  let concentration = null;
  if (known.length >= 3) {
    concentration = (countries.length === 1 || Object.keys(funding).length === 1) ? 'narrow' : 'broad';
  }
  return {
    outlets: outlets.length,
    known: known.length,
    countries,
    funding,
    // null when too few outlets can be placed to call a pattern at all.
    concentration,
  };
}

function project(a, limitCoverage = 8) {
  const lead = outletOf({ publisher: a.publisher, source: a.source, link: a.link });
  const also = (a.coverage || []).slice(0, limitCoverage).map(outletOf);
  return {
    title: a.title || '',
    url: a.link || '',
    summary: a.summary || '',
    publishedAt: a.publishedAt || null,
    image: a.image || null,
    lead,
    alsoCarriedBy: also,
    spread: spreadOf([lead, ...also]),
  };
}

/* ---------- handler ---------- */

export default async function handler(req, res) {
  // A public API is consumed cross-origin by definition.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const { limited, remaining } = rateLimit(clientIp(req));
  res.setHeader('X-RateLimit-Limit', String(MAX_PER_WINDOW));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  if (limited) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({
      error: 'rate_limited',
      detail: `More than ${MAX_PER_WINDOW} requests in a minute. This proxies live newsroom feeds; please cache.`,
    });
    return;
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query?.limit, 10) || DEFAULT_LIMIT));

  try {
    const data = await aggregate({ category: req.query?.category, edition: req.query?.edition });
    res.setHeader('Cache-Control', data.cache);
    res.status(200).json({
      version: VERSION,
      category: data.category,
      edition: data.edition,
      updatedAt: data.updatedAt,
      count: Math.min(limit, data.articles.length),
      stories: data.articles.slice(0, limit).map((a) => project(a)),
    });
  } catch (e) {
    res.setHeader('Cache-Control', 's-maxage=30');
    res.status(502).json({ error: 'upstream_unavailable' });
  }
}
