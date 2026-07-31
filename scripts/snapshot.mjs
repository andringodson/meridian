// Meridian — freeze the API into static JSON for the GitHub Pages mirror.
//
//   node scripts/snapshot.mjs [--out=dist/api-static] [--edition=us]
//
// Pages serves files, not functions, so the mirror cannot call /api/*. This
// runs the same aggregation the serverless routes run and writes the results
// to disk, and public/static-api.js points the client at them.
//
// The mirror is a fallback, not a replacement. It is as fresh as the last
// scheduled run, and the endpoints that are inherently per-request — reader
// extraction, full-text search, weather, the assistant — cannot be frozen at
// all. Those degrade in the client rather than being faked here.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { aggregate } from '../api/news.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));

const OUT = String(args.out || 'dist/api-static');
const EDITION = String(args.edition || 'us');
const CATEGORIES = ['top', 'world', 'business', 'technology', 'science', 'health', 'sports', 'entertainment'];

/* The remaining routes have no exported core to call, and re-implementing them
   here would mean two copies of the same parsing. They are fetched from the
   live deployment instead — this script runs in CI, where reaching the
   production origin is fine. */
const LIVE = String(args.live || 'https://meridian-andrin.vercel.app');

async function grab(path) {
  const r = await fetch(`${LIVE}${path}`, { headers: { 'User-Agent': 'MeridianSnapshot/1' } });
  if (!r.ok) throw new Error(`${r.status} for ${path}`);
  return r.json();
}

async function main() {
  const dir = join(process.cwd(), OUT);
  await mkdir(dir, { recursive: true });
  const written = [];
  const write = async (name, data) => {
    await writeFile(join(dir, name), JSON.stringify(data));
    written.push(name);
  };

  // News: run the real aggregation rather than fetching our own endpoint, so a
  // cold or rate-limited deployment cannot produce an empty mirror.
  for (const category of CATEGORIES) {
    try {
      const { cache, ...payload } = await aggregate({ category, edition: EDITION });
      await write(`news-${EDITION}-${category}.json`, payload);
      console.log(`  news-${EDITION}-${category}  ${payload.count} stories, ${payload.sources} sources`);
    } catch (e) {
      console.log(`  news-${EDITION}-${category}  FAILED: ${e.message}`);
    }
  }

  for (const [name, path] of [
    ['markets.json', '/api/markets'],
    ['wiki-events.json', '/api/wiki?type=events'],
    ['wiki-births.json', '/api/wiki?type=births'],
    ['wiki-deaths.json', '/api/wiki?type=deaths'],
    ['videos.json', '/api/videos'],
  ]) {
    try {
      await write(name, await grab(path));
      console.log(`  ${name}`);
    } catch (e) {
      console.log(`  ${name}  FAILED: ${e.message}`);
    }
  }

  await write('manifest.json', {
    generatedAt: new Date().toISOString(),
    edition: EDITION,
    categories: CATEGORIES,
    files: written,
    note: 'Static mirror of the Meridian API. Reader extraction, search, weather and ' +
          'the assistant need a live server and are unavailable here.',
  });

  console.log(`✓ ${OUT} — ${written.length} files`);
  // A mirror with no news is worse than no mirror; fail the build rather than
  // publish an empty shell.
  const newsFiles = written.filter((f) => f.startsWith('news-')).length;
  if (newsFiles < 4) {
    console.error(`only ${newsFiles} news files — refusing to publish a hollow mirror`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('snapshot failed:', e.message); process.exit(1); });
