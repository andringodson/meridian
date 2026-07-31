/* Meridian — bundle entry for the neural voice runtime.
 *
 * This is the one file in the project that is *bundled* rather than merely
 * minified. Everything in public/ is a classic script sharing one global scope,
 * which is deliberate — no build step stands between the source and the page.
 * ONNX Runtime and the phonemiser are ESM with their own dependency graphs, so
 * they cannot be dropped into that world as-is. scripts/build.mjs bundles this
 * entry into public/tts-runtime.js as an IIFE, and the result joins the classic
 * scripts like any other file.
 *
 * Nothing else imports from node_modules. If that ever stops being true, the
 * bundling story needs rethinking rather than extending.
 */
import * as ort from 'onnxruntime-web/wasm';
import { phonemize } from 'phonemizer';

/* Single-threaded on purpose. The threaded build wants SharedArrayBuffer, which
   wants cross-origin isolation (COOP/COEP), which would refuse every
   cross-origin article thumbnail on the site — trading the feature that makes
   the feed look like anything for a fraction of a second of synthesis time. */
ort.env.wasm.numThreads = 1;

/* Served from this origin, like everything else. Left unset, ORT reaches for a
   CDN, which `connect-src 'self'` would refuse outright. */
ort.env.wasm.wasmPaths = '/models/kitten/';

/* ORT is chatty on stderr about unused initialisers in quantised graphs. */
ort.env.logLevel = 'error';

self.TTSRuntime = { ort, phonemize };
