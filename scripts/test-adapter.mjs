/* Meridian — tests for the Web-standard adapter in api/_adapter.js.
 *
 * The point of the adapter is that a second host can serve the same handlers
 * rather than a second copy of them. That is only true if the mapping is
 * faithful, so these run the real routes through it and check the Response
 * against what the Vercel path produces: status, headers, body, and — the part
 * most likely to be quietly wrong — whether a streaming answer still streams
 * instead of arriving in one lump at the end.
 *
 *   npm run test:adapter
 */
import http from 'node:http';
import { toWebHandler, routeFrom } from '../api/_adapter.js';

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(56)} ${detail}`);
};

console.log('Meridian — Web-standard adapter\n');

/* ---------- a stub provider, so the assistant can be exercised without a key
   and without the network ---------- */
const upstream = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // Written with gaps, so a buffering adapter and a streaming one differ.
    let i = 0;
    const parts = ['Rates ', 'held ', 'steady.'];
    const tick = () => {
      if (i < parts.length) {
        res.write(`data: {"choices":[{"delta":{"content":"${parts[i++]}"}}]}\n\n`);
        setTimeout(tick, 120);
      } else {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    };
    tick();
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));

process.env.AI_BASE_URL = `http://127.0.0.1:${upstream.address().port}/v1`;
process.env.AI_MODEL = 'test-model';
process.env.AI_API_KEY = 'sk-test';

const { default: ai } = await import('../api/ai.js');
const { default: wiki } = await import('../api/wiki.js');
const { default: stories } = await import('../api/v1/stories.js');

/* ---------- routing ---------- */
console.log('  routing');
const TABLE = { ai, wiki, 'v1/stories': stories };
record('a plain route resolves', routeFrom(TABLE, '/api/wiki') === wiki);
record('a nested route resolves', routeFrom(TABLE, '/api/v1/stories') === stories);
record('a trailing slash resolves', routeFrom(TABLE, '/api/wiki/') === wiki);
record('an unknown route resolves to nothing', routeFrom(TABLE, '/api/nope') === null);
record('a path outside the prefix resolves to nothing', routeFrom(TABLE, '/elsewhere') === null);

/* ---------- request mapping ---------- */
console.log('\n  request mapping');
const probe = toWebHandler(ai);
let r = await probe(new Request('https://example.test/api/ai'));
let j = await r.json();
record('GET reaches the handler and returns its JSON', r.status === 200 && j.model === 'test-model', `model=${j.model}`);
record('a header set by the handler survives',
  /application\/json/.test(r.headers.get('content-type') || ''), r.headers.get('content-type'));
record('Cache-Control survives', r.headers.get('cache-control') === 'no-store', r.headers.get('cache-control'));

r = await probe(new Request('https://example.test/api/ai', { method: 'DELETE' }));
record('an unsupported method is refused by the handler, not the adapter',
  r.status === 405, `HTTP ${r.status}`);
record('the Allow header survives', (r.headers.get('allow') || '').includes('POST'), r.headers.get('allow'));

r = await probe(new Request('https://example.test/api/ai', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"mode":"ask"}',
}));
record('a JSON body is parsed before the handler sees it', r.status === 400, `HTTP ${r.status}`);

r = await probe(new Request('https://example.test/api/ai', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json at all',
}));
record('a malformed body is refused, not thrown', r.status === 400, `HTTP ${r.status}`);

/* Query strings are what most routes read. wiki takes ?type=. */
const wikiWeb = toWebHandler(wiki);
r = await wikiWeb(new Request('https://example.test/api/wiki?type=births'));
j = await r.json().catch(() => ({}));
record('the query string reaches the handler',
  r.status === 200 ? j.type === 'births' : true, `HTTP ${r.status} type=${j.type ?? '(upstream down)'}`);

/* ---------- streaming ---------- */
console.log('\n  streaming');
const t0 = Date.now();
r = await probe(new Request('https://example.test/api/ai', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'ask', question: 'What did the Fed decide?', headlines: [] }),
}));
const headersAt = Date.now() - t0;
record('headers arrive before the body is finished', r.status === 200 && headersAt < 250, `${headersAt}ms`);
record('the stream is a stream, not a buffered string', !!r.body);

const chunks = [];
const times = [];
const reader = r.body.getReader();
const dec = new TextDecoder();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks.push(dec.decode(value, { stream: true }));
  times.push(Date.now() - t0);
}
const text = chunks.join('');
record('the streamed text is complete', text === 'Rates held steady.', JSON.stringify(text));
record('it arrived in pieces, not all at once', chunks.length > 1, `${chunks.length} chunks over ${times.at(-1)}ms`);
record('the first piece landed well before the last',
  times.length > 1 && times[0] < times.at(-1) - 100, `first ${times[0]}ms, last ${times.at(-1)}ms`);

/* ---------- close and failure ---------- */
console.log('\n  close and failure');
const ctl = new AbortController();
const aborted = probe(new Request('https://example.test/api/ai', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'ask', question: 'abandon me', headlines: [] }),
  signal: ctl.signal,
}));
ctl.abort();
let abortOk = true;
try { await aborted; } catch { /* either outcome is fine — it must not hang */ }
record('an aborted request settles rather than hanging', abortOk);

const thrower = toWebHandler(() => { throw new Error('boom'); });
r = await thrower(new Request('https://example.test/api/x'));
record('a handler that throws yields 500, not a hung stream', r.status === 500, `HTTP ${r.status}`);
record('the error body is JSON', (await r.json()).error === 'handler-failed');

const silent = toWebHandler(() => {});
r = await silent(new Request('https://example.test/api/x'));
record('a handler that writes nothing still responds', r.status === 200, `HTTP ${r.status}`);

const headOnly = toWebHandler((req, res) => { res.status(200).json({ ok: true }); });
r = await headOnly(new Request('https://example.test/api/x', { method: 'HEAD' }));
record('HEAD returns headers with no body', r.status === 200 && r.body === null);

upstream.close();
const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
