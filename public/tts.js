/* Meridian — the optional neural voice.
 *
 * KittenTTS nano, int8, running in the browser on ONNX Runtime. Strictly
 * opt-in: nothing here is fetched, and the 1.3MB runtime is not even parsed,
 * until a reader turns the voice on. The platform's own speech synthesis
 * remains the default and is free.
 *
 * Everything is served from this origin — see scripts/make-tts-model.mjs for
 * why — so the page keeps `connect-src 'self'`. The one concession is
 * `'wasm-unsafe-eval'` in script-src, without which no WebAssembly runtime can
 * compile at all.
 *
 * The download is ~39MB and is kept in the Cache API rather than left to the
 * HTTP cache, so it survives eviction, works offline, and is not silently
 * re-charged to the reader on the next deploy. Same arrangement as the semantic
 * model in embed.js.
 */
const TTS = (() => {
  'use strict';

  const BASE = '/models/kitten/';
  const CACHE = 'meridian-tts-v1';
  const RUNTIME = '/tts-runtime.js';

  let meta = null;
  let session = null;
  let vocab = null;
  let styles = null;     // Float32Array, voices × rows × dims
  let loading = null;    // in-flight load(), shared by parallel callers
  let ctx = null;        // AudioContext, created on first play (needs a gesture)
  let current = null;    // the playing source, so it can be stopped

  const ready = () => !!session;

  /* ---------- fetching, with progress ---------- */

  async function cached(url, onProgress, expected = 0) {
    const cache = await caches.open(CACHE).catch(() => null);
    if (cache) {
      const hit = await cache.match(url);
      if (hit) return hit.arrayBuffer();
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} for ${url}`);

    // Stream so the reader sees movement on a 23MB file rather than a stall.
    // Content-Length is not guaranteed — the CDN serves the large files chunked,
    // and without a denominator the bar would freeze for the whole download. The
    // size recorded in meta.json at build time stands in.
    const total = +(res.headers.get('content-length') || 0) || expected;
    if (!onProgress || !res.body?.getReader || !total) {
      const buf = await res.arrayBuffer();
      if (cache) await cache.put(url, new Response(buf)).catch(() => {});
      return buf;
    }
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      onProgress(got / total);
    }
    const blob = new Blob(parts);
    const buf = await blob.arrayBuffer();
    if (cache) await cache.put(url, new Response(buf)).catch(() => {});
    return buf;
  }

  function injectRuntime() {
    if (self.TTSRuntime) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = RUNTIME;
      s.onload = () => (self.TTSRuntime ? res() : rej(new Error('runtime did not register')));
      s.onerror = () => rej(new Error('runtime failed to load'));
      document.head.appendChild(s);
    });
  }

  /* ---------- load ---------- */

  async function load(onProgress = () => {}) {
    if (session) return true;
    if (loading) return loading;

    loading = (async () => {
      // Weighted so the bar tracks bytes rather than steps — the model is the
      // overwhelming majority of the wait.
      const step = (name, frac, base) => (p) => onProgress(base + p * frac, name);

      await injectRuntime();
      onProgress(0.04, 'runtime');

      meta = JSON.parse(new TextDecoder().decode(
        await cached(`${BASE}meta.json`)));
      vocab = JSON.parse(new TextDecoder().decode(
        await cached(`${BASE}vocab.json`)));
      onProgress(0.06, 'runtime');

      const sizes = meta.sizes || {};
      const styleBuf = await cached(`${BASE}voices.bin`, step('voices', 0.08, 0.06), sizes['voices.bin']);
      styles = new Float32Array(styleBuf);

      const modelBuf = await cached(`${BASE}model.onnx`, step('model', 0.84, 0.14), sizes['model.onnx']);
      onProgress(0.98, 'starting');

      const { ort } = self.TTSRuntime;
      session = await ort.InferenceSession.create(modelBuf, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      onProgress(1, 'ready');
      return true;
    })().catch((e) => { session = null; throw e; })
      .finally(() => { loading = null; });

    return loading;
  }

  async function forget() {
    stop();
    session = null; styles = null; vocab = null; meta = null;
    try { await caches.delete(CACHE); } catch { /* nothing stored */ }
  }

  /* ---------- text → audio ---------- */

  const voices = () => (meta?.voices || []).slice();

  function styleFor(voiceName, tokenCount) {
    const idx = Math.max(0, (meta.voices || []).indexOf(voiceName));
    const { styleRows, styleDims } = meta;
    // The table is indexed by token count: longer utterances get a different
    // prosody vector. Clamp rather than wrap — past the end, the last row is
    // the right answer, an early one is a different voice entirely.
    const row = Math.min(Math.max(tokenCount, 0), styleRows - 1);
    const at = (idx * styleRows + row) * styleDims;
    return styles.slice(at, at + styleDims);
  }

  async function synth(text, { voice, speed = 1 } = {}) {
    if (!session) throw new Error('voice not loaded');
    const { ort, phonemize } = self.TTSRuntime;

    const ipa = (await phonemize(String(text), 'en-us')).join(' ');
    const ids = [0];
    for (const ch of ipa) {
      const id = vocab[ch];
      if (id !== undefined) ids.push(id);
    }
    ids.push(0);
    if (ids.length < 3) return null;      // nothing pronounceable

    const style = styleFor(voice || meta.voices[0], ids.length);
    const out = await session.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      style: new ort.Tensor('float32', style, [1, meta.styleDims]),
      speed: new ort.Tensor('float32', Float32Array.from([speed]), [1]),
    });
    return out.waveform.data;             // Float32Array @ meta.sampleRate
  }

  /* ---------- playback ---------- */

  function audio() {
    if (!ctx) ctx = new (self.AudioContext || self.webkitAudioContext)();
    return ctx;
  }

  function stop() {
    if (current) { try { current.stop(); } catch { /* already ended */ } current = null; }
  }

  /* Resolves when the clip finishes, or immediately if it is cut short — the
     caller drives a queue of paragraphs off this. */
  function play(wave) {
    return new Promise((resolve) => {
      if (!wave || !wave.length) return resolve();
      const ac = audio();
      const buf = ac.createBuffer(1, wave.length, meta.sampleRate || 24000);
      buf.copyToChannel(wave instanceof Float32Array ? wave : Float32Array.from(wave), 0);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(ac.destination);
      src.onended = () => { if (current === src) current = null; resolve(); };
      stop();
      current = src;
      // Autoplay policy: the context starts suspended until a gesture.
      ac.resume?.().catch(() => {});
      src.start();
    });
  }

  async function speak(text, opts) {
    const wave = await synth(text, opts);
    await play(wave);
  }

  return {
    load, forget, synth, play, speak, stop, voices,
    get ready() { return ready(); },
    get loading() { return !!loading; },
    get meta() { return meta; },
  };
})();
