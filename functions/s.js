/* Meridian on Cloudflare Pages — /s, the per-story link preview.
 *
 * Separate from the /api/* catch-all because it is not under /api/: it is the
 * URL that goes into a shared link, so it stays short. api/share.js renders the
 * Open Graph tags for one story and redirects a human straight on to the app.
 *
 * See functions/api/[[route]].js for how the two runtimes are bridged.
 */
import { toWebHandler } from '../api/_adapter.js';
import share from '../api/share.js';

export async function onRequest(context) {
  const { request, env } = context;
  return toWebHandler(share, { env })(request);
}
