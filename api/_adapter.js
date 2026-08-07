/* Meridian — run the routes on any Web-standard runtime.
 *
 * Every handler in api/ is written to Vercel's Node signature, `(req, res)`.
 * Cloudflare Workers, Netlify's edge functions and Deno all speak the Web
 * standard instead: a Request goes in, a Response comes out. This maps between
 * the two so a second host can serve the same routes without a second copy of
 * them — the alternative being to fork nine handlers and then keep both forks
 * honest, which is how the two of them start quietly disagreeing.
 *
 * It is a small map because the handlers use a small surface. Everything they
 * touch is here: query, method, headers and body on the way in; setHeader,
 * status, json, write, end, writeHead, headersSent and the 'close' event on the
 * way out.
 *
 * Streaming is the part that has to be right rather than merely present. The
 * assistant streams tokens as they arrive, so the Response has to be handed back
 * the moment the first chunk is written and stay open while the handler keeps
 * writing. Buffering it into one string would work, and would also turn a
 * visibly-typing answer into fifteen seconds of nothing.
 */

const ENCODER = new TextEncoder();

export function toWebHandler(handler, { env } = {}) {
  return async function serve(request) {
    const url = new URL(request.url);

    const query = {};
    for (const [k, v] of url.searchParams) query[k] = v;

    const headers = {};
    for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;

    /* Vercel parses a JSON body before the handler sees it, so the handlers
       expect an object. api/ai.js also tolerates a string and parses it itself,
       but the rest do not. */
    let body;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const raw = await request.text();
      if (raw) {
        if (/\bjson\b/i.test(headers['content-type'] || '')) {
          try { body = JSON.parse(raw); } catch { body = raw; }
        } else {
          body = raw;
        }
      }
    }

    const req = {
      method: request.method,
      url: url.pathname + url.search,
      headers,
      query,
      body,
      /* clientIp() in api/ai.js falls back to this when there is no forwarding
         header. Cloudflare puts the caller in CF-Connecting-IP. */
      socket: { remoteAddress: headers['cf-connecting-ip'] || '' },
    };

    const outHeaders = new Headers();
    let status = 200;
    let started = false;
    let ended = false;
    let controller = null;
    let hand;                                   // resolves the Response
    const responded = new Promise((r) => { hand = r; });
    const onClose = new Set();

    const fireClose = () => {
      for (const fn of onClose) { try { fn(); } catch { /* a listener's problem */ } }
      onClose.clear();
    };

    const stream = new ReadableStream({
      start(c) { controller = c; },
      // The reader navigated away or closed the panel. api/ai.js listens for
      // this to abort its upstream rather than pay for tokens nobody will read.
      cancel() { fireClose(); },
    });

    // Once headers are handed over they are fixed, so this is the point of no
    // return for status and setHeader.
    const begin = () => {
      if (started) return;
      started = true;
      hand(new Response(request.method === 'HEAD' ? null : stream, { status, headers: outHeaders }));
    };

    const res = {
      get headersSent() { return started; },
      setHeader(k, v) { outHeaders.set(k, String(v)); return res; },
      getHeader(k) { return outHeaders.get(k); },
      removeHeader(k) { outHeaders.delete(k); return res; },
      status(code) { status = code; return res; },
      writeHead(code, hdrs) {
        status = code;
        for (const [k, v] of Object.entries(hdrs || {})) outHeaders.set(k, String(v));
        return res;
      },
      write(chunk) {
        begin();
        if (ended || chunk == null) return true;
        try {
          controller?.enqueue(typeof chunk === 'string' ? ENCODER.encode(chunk) : chunk);
        } catch { /* the client is gone */ }
        return true;
      },
      end(chunk) {
        if (ended) return res;
        if (chunk != null) res.write(chunk);
        begin();
        ended = true;
        try { controller?.close(); } catch { /* already closed */ }
        return res;
      },
      json(obj) {
        if (!outHeaders.has('Content-Type')) {
          outHeaders.set('Content-Type', 'application/json; charset=utf-8');
        }
        return res.end(JSON.stringify(obj));
      },
      on(ev, fn) { if (ev === 'close') onClose.add(fn); return res; },
      once(ev, fn) { return res.on(ev, fn); },
      off(ev, fn) { if (ev === 'close') onClose.delete(fn); return res; },
      removeListener(ev, fn) { return res.off(ev, fn); },
    };

    // An aborted request is the same signal as a closed socket on Node.
    request.signal?.addEventListener('abort', fireClose, { once: true });

    /* process.env does not exist on Workers. The handlers read it at module
       scope, so a host that passes configuration as a binding has to put it
       somewhere they can find it before they are imported — see the note in
       functions/api/[[route]].js. This only tops it up for anything imported
       later. */
    if (env && typeof globalThis.process === 'object' && globalThis.process.env) {
      for (const [k, v] of Object.entries(env)) {
        if (typeof v === 'string' && globalThis.process.env[k] === undefined) {
          globalThis.process.env[k] = v;
        }
      }
    }

    const running = Promise.resolve()
      .then(() => handler(req, res))
      .then(() => { if (!ended) res.end(); })
      .catch(() => {
        // A handler that threw before writing anything still owes the caller a
        // response, and it must not be a hung stream.
        if (!started) {
          status = 500;
          outHeaders.set('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'handler-failed' }));
        } else if (!ended) {
          res.end();
        }
      });

    // Whichever happens first: the handler commits its headers, or it finishes.
    // Racing is what keeps a streaming response streaming — waiting for the
    // handler to return would buffer the assistant's whole answer.
    await Promise.race([responded, running]);
    begin();
    return responded;
  };
}

/* Map a pathname onto one of the route modules.
 *
 * The table is passed in rather than discovered, because a bundler cannot
 * follow a dynamic import built from a variable — every host that packages
 * functions needs the imports to be statically visible. */
export function routeFrom(table, pathname, prefix = '/api/') {
  const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
  const key = rest.replace(/\/+$/, '').toLowerCase();
  return table[key] || table[key.split('/')[0]] || null;
}
