// Meridian — public API v1 index.
//
//   GET /api/v1
//
// A discovery document, so the API describes itself rather than depending on
// the README staying in sync with it.

import { PUBLISHERS } from '../_publishers.js';

const VERSION = 1;

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json({
    version: VERSION,
    name: 'Meridian API',
    description:
      'World news, clustered so one event is one story, with the provenance of every ' +
      'outlet carrying it: where the newsroom is based and how it is funded.',
    licence: 'Stories link to and are attributed to the newsroom that reported them. ' +
      'Meridian returns headlines, standfirsts and links — not article bodies.',
    endpoints: {
      'GET /api/v1': 'This document.',
      'GET /api/v1/stories': {
        description: 'Clustered stories with provenance and a coverage-spread reading.',
        params: {
          category: 'top | world | business | technology | science | health | sports | entertainment',
          edition: 'us | gb | in | au | ca — which country\'s newsrooms lead',
          limit: '1-100, default 40',
        },
        example: '/api/v1/stories?category=world&edition=gb&limit=20',
      },
      'GET /api/v1/publishers': 'The provenance registry: every known outlet, its country and funding model.',
    },
    fields: {
      'stories[].lead': 'The outlet whose report anchors the cluster.',
      'stories[].alsoCarriedBy': 'Other newsrooms carrying the same story.',
      'stories[].spread.outlets': 'How many newsrooms carried it.',
      'stories[].spread.known': 'How many of those have provenance on file. Claims are only made over these.',
      'stories[].spread.countries': 'Distinct countries among the known outlets.',
      'stories[].spread.funding': 'Counts by funding model: public, nonprofit, private, government.',
      'stories[].spread.concentration':
        '"narrow" when the known outlets share one country or one funding model, ' +
        '"broad" when they span several, null when fewer than three can be placed.',
    },
    notes: [
      'No left/right rating is published. Country and funding are matters of public record; ' +
      'political lean is contested, and shipping one would mean shipping someone else\'s judgement as data.',
      'Rate limited to 60 requests per minute per address. Responses are edge-cached — please cache too, ' +
      'since this proxies live newsroom feeds.',
    ],
    publishersKnown: Object.keys(PUBLISHERS).length,
    docs: 'https://github.com/andringodson/meridian#public-api',
  });
}
