// Meridian build — produces a minified static bundle in dist/.
// Mirrors public/ file-for-file (same names, so index.html + sw.js references
// keep resolving), minifying JS/CSS with esbuild and HTML with
// html-minifier-terser. Everything else (fonts, images, manifest…) is copied
// verbatim. Vercel runs this as the build step; dist/ is the served output.
import { readdir, readFile, writeFile, mkdir, rm, copyFile, stat } from 'node:fs/promises';
import { join, extname, dirname, relative } from 'node:path';
import * as esbuild from 'esbuild';
import { minify as minifyHtml } from 'html-minifier-terser';

const SRC = 'public';
// Pages serves this repo under /meridian/, so its build asks for relative asset
// paths. Vercel serves at the root and does not.
const RELATIVE = process.argv.includes('--relative');
const OUT = 'dist';

async function walk(dir) {
  const files = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...await walk(p));
    else files.push(p);
  }
  return files;
}

const HTML_OPTS = {
  collapseWhitespace: true,
  removeComments: true,
  removeRedundantAttributes: false, // keep type="search" etc. — some are load-bearing
  minifyCSS: true,
  minifyJS: true,
  keepClosingSlash: true,
  ignoreCustomComments: [/^\s*!/],
};

const kb = (n) => `${(n / 1024).toFixed(1)}KB`;

/* The one bundled artefact. public/ is otherwise a set of classic scripts that
   are only minified, but ONNX Runtime and the phonemiser are ESM packages with
   their own dependency graphs and cannot join that world unbundled. This turns
   src/tts-runtime.mjs into an IIFE that public/ can load like any other script.

   It writes into public/ rather than straight to dist/ so the committed tree is
   what actually ships, and so `npm run preview` serves the same bytes as
   production. */
async function bundleRuntime() {
  const entry = 'src/tts-runtime.mjs';
  try { await stat(entry); } catch { return null; }   // optional — model not vendored
  const out = join(SRC, 'tts-runtime.js');
  await esbuild.build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    legalComments: 'none',
    // ORT ships a Node build behind the same specifier; keep it out of the
    // browser bundle, along with the node builtins it reaches for.
    external: ['onnxruntime-node', 'node:*', 'fs', 'path', 'os', 'crypto', 'worker_threads'],
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  return (await stat(out)).size;
}

async function build() {
  const t0 = Date.now();
  const runtimeBytes = await bundleRuntime();
  if (runtimeBytes) console.log(`  bundled tts-runtime.js — ${kb(runtimeBytes)}`);
  await rm(OUT, { recursive: true, force: true });
  const files = await walk(SRC);
  let before = 0, after = 0, min = 0;

  for (const src of files) {
    const dst = join(OUT, relative(SRC, src));
    await mkdir(dirname(dst), { recursive: true });
    const ext = extname(src).toLowerCase();

    if (ext === '.js' || ext === '.css') {
      const raw = await readFile(src, 'utf8');
      // Script-mode minify: esbuild preserves top-level (global) names, so the
      // classic scripts that share globals across files stay wired together;
      // only function-local identifiers are mangled.
      const { code } = await esbuild.transform(raw, {
        minify: true,
        loader: ext.slice(1),
        legalComments: 'none',
      });
      await writeFile(dst, code);
      before += raw.length; after += code.length; min++;
    } else if (ext === '.html') {
      const raw = await readFile(src, 'utf8');
      let out = await minifyHtml(raw, HTML_OPTS);
      /* GitHub Pages serves a project at /<repo>/, where an absolute
         src="/app.js" resolves to the domain root and 404s — the HTML arrives
         and nothing else does. --relative rewrites asset references to be
         relative to the document so the same build works at any prefix.

         Only src/href are touched. Protocol-relative and absolute URLs are left
         alone, and so is everything JS fetches at runtime: the mirror's shim
         resolves /api/* itself, and the opt-in downloads it cannot reach fail
         the way a missing model already fails. */
      if (RELATIVE) {
        out = out.replace(/\b(src|href)="\/(?!\/)/g, '$1="./');
      }
      await writeFile(dst, out);
      before += raw.length; after += out.length; min++;
    } else {
      await copyFile(src, dst);
    }
  }

  const pct = before ? Math.round((1 - after / before) * 100) : 0;
  console.log(`✓ built dist/ — ${files.length} files, ${min} minified`);
  console.log(`  JS/CSS/HTML: ${kb(before)} → ${kb(after)} (−${pct}%) in ${Date.now() - t0}ms`);
}

build().catch((e) => { console.error('build failed:', e); process.exit(1); });
