// Meridian — public API v1: the provenance registry.
//
//   GET /api/v1/publishers
//
// Every outlet Meridian can place, with where it is based and how it is funded.
// Static and hand-maintained, so it is cached hard.

import { PUBLISHERS } from '../_publishers.js';

const FUNDING = {
  public: 'Funded by the public or the state — licence fee or state budget.',
  nonprofit: 'Non-commercial: a trust, foundation or member funding.',
  private: 'Commercially owned.',
  government: 'A government body publishing directly, not a newsroom.',
};

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');

  const publishers = Object.entries(PUBLISHERS).map(([id, p]) => ({
    id,
    name: p.name,
    country: p.country || null,
    funding: p.ownership || null,
  })).sort((a, b) => a.name.localeCompare(b.name));

  res.status(200).json({
    version: 1,
    count: publishers.length,
    fundingModels: FUNDING,
    note: 'Country and funding are matters of public record. No political lean is published.',
    publishers,
  });
}
