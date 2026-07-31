// Meridian — fetch and prepare the on-device neural voice that ships in
// public/models/kitten/.
//
//   node scripts/make-tts-model.mjs [--out=public/models/kitten] [--force]
//
// The platform's own speech synthesis is free and instant, and on most machines
// it is good. On some it is not, and there is nothing the app can do about it —
// you get whatever voices the OS installed. This is the opt-in alternative: a
// small neural TTS that runs in the browser.
//
// KittenTTS nano 0.8, int8-quantised, Apache-2.0. Chosen over Kokoro on size
// alone: Kokoro is ~86MB of weights plus 28MB of voice embeddings, where this
// is 23MB plus 3MB, and the whole payload including the ONNX runtime lands
// around 42MB. Chosen over the "Mini" export because that one is fp32 and 75MB
// despite the family's 25MB billing.
//
// Everything is vendored rather than pulled from a CDN at runtime. The page
// ships `connect-src 'self'` and that is the point of it — the browser talks to
// this origin and nowhere else. The cost is repository size, paid once.
//
// Three transformations happen here so the client stays simple:
//
//   1. voices.npz is a zip of NumPy arrays. Parsing that in the browser would
//      mean shipping a zip library and an .npy reader for data that never
//      changes. It becomes one flat Float32 blob plus an index.
//   2. The phoneme vocabulary is not published with the 0.8 weights at all —
//      only with the 0.1 ONNX export, which uses the same 175-token IPA set.
//      It is fetched from there and written out beside the model.
//   3. The ONNX Runtime wasm binary is copied out of node_modules, so the
//      runtime is served from this origin too.
//
// Re-run only to change or update the model; the outputs are committed.

import { mkdir, writeFile, stat, readFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));

const OUT = String(args.out || 'public/models/kitten');
const MODEL_REPO = 'KittenML/kitten-tts-nano-0.8-int8';
const VOCAB_REPO = 'onnx-community/kitten-tts-nano-0.1-ONNX';
const hf = (repo, file) => `https://huggingface.co/${repo}/resolve/main/${file}`;

async function grab(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

/* Minimal .npy reader: a fixed magic, a little-endian header length, then a
   Python dict literal describing dtype and shape, then raw data. Only the
   float32 C-order case the voice table actually uses is supported — anything
   else is a change upstream that should fail loudly rather than silently
   produce noise. */
function npy(buf) {
  if (buf.slice(0, 6).toString('latin1') !== '\x93NUMPY') throw new Error('not an .npy');
  const headerLen = buf.readUInt16LE(8);
  const header = buf.slice(10, 10 + headerLen).toString('latin1');
  const descr = (header.match(/'descr':\s*'([^']+)'/) || [])[1];
  const fortran = /'fortran_order':\s*True/.test(header);
  const shape = ((header.match(/'shape':\s*\(([^)]*)\)/) || [])[1] || '').match(/\d+/g)?.map(Number) || [];
  if (descr !== '<f4') throw new Error(`expected float32, got ${descr}`);
  if (fortran) throw new Error('fortran-order arrays not supported');
  const raw = buf.slice(10 + headerLen);
  return { shape, data: new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4) };
}

async function main() {
  const outDir = join(process.cwd(), OUT);
  if (!args.force) {
    try {
      await stat(join(outDir, 'model.onnx'));
      console.log(`${OUT}/model.onnx exists — pass --force to rebuild.`);
      return;
    } catch { /* not built yet */ }
  }
  await mkdir(outDir, { recursive: true });

  // ---- weights ----
  console.log(`fetching ${MODEL_REPO}…`);
  const onnx = await grab(hf(MODEL_REPO, 'kitten_tts_nano_v0_8.onnx'));
  await writeFile(join(outDir, 'model.onnx'), onnx);
  console.log(`  model.onnx    ${(onnx.length / 1048576).toFixed(1)} MB`);

  // ---- voices: npz → one flat blob + an index ----
  const npz = await grab(hf(MODEL_REPO, 'voices.npz'));
  const { default: JSZip } = await import('jszip').catch(() => {
    throw new Error('jszip is needed to unpack voices.npz — npm i -D jszip');
  });
  const zip = await JSZip.loadAsync(npz);
  const names = Object.keys(zip.files).sort();
  const voices = [];
  let dims = 0, rows = 0;
  const chunks = [];
  for (const name of names) {
    const arr = npy(await zip.files[name].async('nodebuffer'));
    const [r, d] = arr.shape.length === 2 ? arr.shape : [1, arr.shape[0]];
    if (dims && d !== dims) throw new Error(`voice ${name} has ${d} dims, expected ${dims}`);
    dims = d; rows = r;
    voices.push(name.replace(/\.npy$/, ''));
    chunks.push(Buffer.from(arr.data.buffer, arr.data.byteOffset, arr.data.byteLength));
  }
  const blob = Buffer.concat(chunks);
  await writeFile(join(outDir, 'voices.bin'), blob);
  console.log(`  voices.bin    ${(blob.length / 1048576).toFixed(1)} MB — ${voices.length} voices, [${rows}, ${dims}]`);

  // ---- phoneme vocabulary (published only with the 0.1 export) ----
  console.log(`fetching vocabulary from ${VOCAB_REPO}…`);
  const tok = JSON.parse((await grab(hf(VOCAB_REPO, 'tokenizer.json'))).toString('utf8'));
  const vocab = tok?.model?.vocab;
  if (!vocab || Object.keys(vocab).length < 100) throw new Error('vocabulary missing or too small');
  await writeFile(join(outDir, 'vocab.json'), JSON.stringify(vocab), 'utf8');
  console.log(`  vocab.json    ${Object.keys(vocab).length} tokens`);

  // ---- the ONNX runtime, served from this origin ----
  // Single-threaded deliberately: the threaded build needs SharedArrayBuffer,
  // which needs cross-origin isolation (COOP/COEP), which would block every
  // cross-origin article thumbnail on the site.
  // Located via the package's main entry, which already lives in dist/.
  // onnxruntime-web declares `exports` and lists neither package.json nor the
  // wasm files, so require.resolve refuses either by name — but the main entry
  // resolves fine and sits in the same directory.
  const require = createRequire(join(process.cwd(), 'noop.js'));
  let wasmPath;
  try {
    wasmPath = join(require.resolve('onnxruntime-web'), '..', 'ort-wasm-simd-threaded.wasm');
    await stat(wasmPath);
  } catch (e) {
    throw new Error(`ONNX Runtime wasm not found (${e.code || e.message}) — npm i onnxruntime-web`);
  }
  await copyFile(wasmPath, join(outDir, 'ort-wasm-simd-threaded.wasm'));
  const wasmSize = (await stat(join(outDir, 'ort-wasm-simd-threaded.wasm'))).size;
  console.log(`  ort wasm      ${(wasmSize / 1048576).toFixed(1)} MB`);

  // ORT fetches its Emscripten glue as a sibling of the .wasm at runtime, so
  // that file has to sit beside it on this origin too — bundling it does not
  // help, the loader asks for it by URL.
  const gluePath = join(wasmPath, '..', 'ort-wasm-simd-threaded.mjs');
  await copyFile(gluePath, join(outDir, 'ort-wasm-simd-threaded.mjs'));
  const glueSize = (await stat(join(outDir, 'ort-wasm-simd-threaded.mjs'))).size;
  console.log(`  ort glue      ${(glueSize / 1024).toFixed(0)} KB`);

  await writeFile(join(outDir, 'meta.json'), JSON.stringify({
    model: MODEL_REPO,
    licence: 'Apache-2.0',
    sampleRate: 24000,
    voices,
    styleRows: rows,
    styleDims: dims,
    vocabSource: VOCAB_REPO,
    inputs: ['input_ids', 'style', 'speed'],
    outputs: ['waveform', 'duration'],
    /* Recorded because the CDN does not always send Content-Length — the large
       files come back chunked, which leaves a download with no denominator and
       a progress bar frozen at whatever it last showed. These are the fallback. */
    sizes: { 'model.onnx': onnx.length, 'voices.bin': blob.length },
    bytes: onnx.length + blob.length + wasmSize + glueSize,
  }, null, 2), 'utf8');

  const total = (onnx.length + blob.length + wasmSize + glueSize) / 1048576;
  console.log(`✓ ${OUT} — ${total.toFixed(1)} MB total`);
}

main().catch((e) => { console.error('make-tts-model failed:', e.message); process.exit(1); });
