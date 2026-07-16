// Meridian preview server — serves a built directory (default dist/) with the
// right content types, for a production-like local check and inside the Docker
// preview image. Zero dependencies. Note: /api/* functions are NOT served here
// (that's Vercel's runtime); this previews the static bundle only.
//   node scripts/serve.mjs [dir] [port]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const DIR = process.argv[2] || 'dist';
const PORT = Number(process.argv[3] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // Resolve within DIR; block path traversal.
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(DIR, path);
    let s = await stat(file).catch(() => null);
    if (s?.isDirectory()) { file = join(file, 'index.html'); s = await stat(file).catch(() => null); }
    if (!s) { // SPA/clean-url fallback → app shell
      file = join(DIR, 'index.html');
      s = await stat(file).catch(() => null);
      if (!s) { res.writeHead(404); res.end('404'); return; }
    }
    const body = await readFile(file);
    const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(body);
  } catch (e) {
    res.writeHead(500); res.end('500');
  }
});

server.listen(PORT, () => console.log(`Meridian preview → http://localhost:${PORT}  (serving ${DIR}/)`));
