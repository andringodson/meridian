// Meridian — build the on-device embedding model that ships in public/models/.
//
//   node scripts/make-embedding-model.mjs [--src=minishlab/potion-base-8M]
//                                         [--out=public/models/potion] [--force]
//
// Meridian's semantic features (search, For You ranking) run entirely in the
// browser, so the model has to be small enough to actually download and simple
// enough to execute without a neural-network runtime.
//
// model2vec models are exactly that: a sentence transformer distilled down to a
// *static* token → vector table. There is no forward pass at inference — an
// embedding is the mean of its tokens' rows, L2-normalised. That means no ONNX,
// no WebAssembly, no CSP relaxation, and no 12MB runtime; the client engine in
// public/embed.js is a few hundred lines of plain JS.
//
// This script fetches the upstream weights once, quantises them fp32 → int8
// with a per-row scale (a single global scale loses too much: token vector
// norms span more than two orders of magnitude), and writes:
//
//   vectors.bin  magic | rows | dims | f32 scales[rows] | i8 data[rows*dims]
//   vocab.txt    one token per line, line number = token id
//   meta.json    dims, vocab size, provenance and licence
//
// Re-run only to change or update the model; the outputs are committed.

import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));

const SRC = String(args.src || 'minishlab/potion-base-8M');
const OUT = String(args.out || 'public/models/potion');
const HF = (f) => `https://huggingface.co/${SRC}/resolve/main/${f}`;
const MAGIC = 'MRDNVEC1';

async function grab(file) {
  const r = await fetch(HF(file));
  if (!r.ok) throw new Error(`${file} → HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// safetensors: <u64 header length><json header><raw tensor bytes>
function readSafetensors(buf) {
  const headerLen = Number(buf.readBigUInt64LE(0));
  const header = JSON.parse(buf.subarray(8, 8 + headerLen).toString('utf8'));
  const body = 8 + headerLen;
  const name = Object.keys(header).find((k) => k !== '__metadata__');
  const t = header[name];
  if (t.dtype !== 'F32') throw new Error(`expected F32 weights, got ${t.dtype}`);
  const [rows, dims] = t.shape;
  const raw = buf.subarray(body + t.data_offsets[0], body + t.data_offsets[1]);
  // Copy through a fresh buffer: the safetensors body is not guaranteed to sit
  // on a 4-byte boundary, and Float32Array demands one.
  const f32 = new Float32Array(rows * dims);
  for (let i = 0; i < f32.length; i++) f32[i] = raw.readFloatLE(i * 4);
  return { name, rows, dims, f32 };
}

function quantise(f32, rows, dims) {
  const scales = new Float32Array(rows);
  const data = new Int8Array(rows * dims);
  let worst = 0, total = 0;
  for (let r = 0; r < rows; r++) {
    const off = r * dims;
    let peak = 0;
    for (let c = 0; c < dims; c++) peak = Math.max(peak, Math.abs(f32[off + c]));
    // An all-zero row (unused vocab slot) stays zero; scale 0 is the signal.
    const scale = peak > 0 ? peak / 127 : 0;
    scales[r] = scale;
    let err = 0;
    for (let c = 0; c < dims; c++) {
      const v = f32[off + c];
      const q = scale > 0 ? Math.max(-127, Math.min(127, Math.round(v / scale))) : 0;
      data[off + c] = q;
      err += Math.abs(q * scale - v);
    }
    const rel = peak > 0 ? err / dims / peak : 0;
    total += rel;
    worst = Math.max(worst, rel);
  }
  return { scales, data, meanErr: total / rows, worstErr: worst };
}

async function main() {
  const outDir = join(process.cwd(), OUT);
  if (!args.force) {
    try { await stat(join(outDir, 'vectors.bin')); console.log(`${OUT}/vectors.bin exists — pass --force to rebuild.`); return; }
    catch { /* not built yet */ }
  }
  await mkdir(outDir, { recursive: true });

  console.log(`source: ${SRC}`);
  const [weights, tokJson, cfgJson] = await Promise.all([
    grab('model.safetensors'), grab('tokenizer.json'), grab('config.json'),
  ]);
  const cfg = JSON.parse(cfgJson.toString('utf8'));
  const tok = JSON.parse(tokJson.toString('utf8'));
  const { rows, dims, f32 } = readSafetensors(weights);
  console.log(`weights: ${rows} × ${dims} f32 (${(weights.length / 1048576).toFixed(1)} MB)`);

  // --- vocabulary, ordered by id so the line number IS the id ---
  const vocab = tok.model.vocab;
  const byId = new Array(rows).fill('');
  for (const [token, id] of Object.entries(vocab)) if (id < rows) byId[id] = token;
  if (byId.some((t) => /[\r\n]/.test(t))) throw new Error('vocab token contains a newline — the line-per-token format would break');
  const missing = byId.filter((t) => t === '').length;
  if (missing) console.log(`note: ${missing} vocab slots unused`);

  const { scales, data, meanErr, worstErr } = quantise(f32, rows, dims);
  console.log(`quantised int8 — mean error ${(meanErr * 100).toFixed(2)}% of row peak, worst ${(worstErr * 100).toFixed(2)}%`);

  const head = Buffer.alloc(16);
  head.write(MAGIC, 0, 'ascii');
  head.writeUInt32LE(rows, 8);
  head.writeUInt32LE(dims, 12);
  const bin = Buffer.concat([head, Buffer.from(scales.buffer), Buffer.from(data.buffer)]);
  await writeFile(join(outDir, 'vectors.bin'), bin);
  await writeFile(join(outDir, 'vocab.txt'), byId.join('\n'), 'utf8');
  await writeFile(join(outDir, 'meta.json'), JSON.stringify({
    source: SRC,
    modelType: cfg.model_type,
    tokenizer: cfg.tokenizer_name,
    dims, vocab: rows,
    lowercase: tok.normalizer?.lowercase !== false,
    unkId: vocab['[UNK]'] ?? 1,
    subwordPrefix: tok.model.continuing_subword_prefix || '##',
    maxCharsPerWord: tok.model.max_input_chars_per_word || 100,
    normalize: cfg.normalize !== false,
    licence: 'MIT (minishlab/model2vec)',
    builtBy: 'scripts/make-embedding-model.mjs',
  }, null, 2) + '\n', 'utf8');

  const vsz = (bin.length / 1048576).toFixed(2);
  const tsz = (Buffer.byteLength(byId.join('\n')) / 1048576).toFixed(2);
  console.log(`\nwrote ${OUT}/`);
  console.log(`  vectors.bin  ${vsz} MB`);
  console.log(`  vocab.txt    ${tsz} MB`);
  console.log(`  total        ${(+vsz + +tsz).toFixed(2)} MB  (was ${(weights.length / 1048576).toFixed(1)} MB unquantised)`);
}

main().catch((e) => { console.error(`build failed: ${e.message}`); process.exit(1); });
