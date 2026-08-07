/* Meridian on Cloudflare Pages — every /api/* route.
 *
 * Pages Functions are Web-standard: a Request goes in, a Response comes out.
 * The handlers in api/ are written to Vercel's Node signature, so api/_adapter.js
 * maps between the two and this file is only a routing table. Both hosts
 * therefore run the same nine routes rather than two copies that drift.
 *
 * The imports are static because they have to be. A bundler cannot follow an
 * import built from a variable, so a table assembled at runtime would package
 * nothing and 404 everything.
 *
 * Configuration arrives as a binding on `context.env`, not as process.env, and
 * the adapter copies it across before the handler runs. Set AI_API_KEY in the
 * Pages project settings to turn the assistant on; without it the route answers
 * 503 `ai-unconfigured` and the client falls back to on-device summarising,
 * exactly as it does anywhere else.
 *
 * Set up: connect the repo in the Cloudflare dashboard, build `npm run build`,
 * output `dist`. Note there is no --static flag on that build, and that is the
 * point of this file — Pages runs functions, so the API is real here and
 * public/static-api.js must stay out of the way. It will: activation is by the
 * meta tag that only the frozen-mirror build stamps.
 */
import { toWebHandler, routeFrom } from '../../api/_adapter.js';

import news from '../../api/news.js';
import wiki from '../../api/wiki.js';
import markets from '../../api/markets.js';
import search from '../../api/search.js';
import videos from '../../api/videos.js';
import weather from '../../api/weather.js';
import read from '../../api/read.js';
import ai from '../../api/ai.js';
import v1index from '../../api/v1/index.js';
import v1stories from '../../api/v1/stories.js';
import v1publishers from '../../api/v1/publishers.js';

const ROUTES = {
  news,
  wiki,
  markets,
  search,
  videos,
  weather,
  read,
  ai,
  v1: v1index,
  'v1/stories': v1stories,
  'v1/publishers': v1publishers,
};

const notFound = () =>
  new Response(JSON.stringify({ error: 'not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

export async function onRequest(context) {
  const { request, env } = context;
  const handler = routeFrom(ROUTES, new URL(request.url).pathname);
  if (!handler) return notFound();
  return toWebHandler(handler, { env })(request);
}
