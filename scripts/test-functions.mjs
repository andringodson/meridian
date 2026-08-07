/* Meridian — tests for the Cloudflare Pages entry points.
 *
 * Invokes functions/ exactly as Pages does: onRequest({ request, env }), with
 * configuration arriving as a binding rather than as process.env. That last part
 * is the whole reason this file exists — it is the difference between the two
 * runtimes that would otherwise be discovered in production, as an assistant
 * that reports itself unconfigured no matter what key is set.
 *
 *   npm run test:functions
 */
const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(56)} ${detail}`);
};

console.log('Meridian — Cloudflare Pages entry points\n');

/* Workers has no process.env. Removing it before importing anything is what
   makes this a real test of the binding path rather than a test that happens to
   pass because Node had the variables all along. */
const savedProcess = globalThis.process;
delete globalThis.process;
record('the runtime starts without process.env', typeof globalThis.process === 'undefined');

const { onRequest: apiRoute } = await import('../functions/api/[[route]].js');
const { onRequest: shareRoute } = await import('../functions/s.js');

const call = (route, url, env = {}, init = {}) =>
  route({ request: new Request(url, init), env, params: {} });

console.log('\n  routing');
let r = await call(apiRoute, 'https://meridian.pages.dev/api/nope');
record('an unknown route is 404, not a crash', r.status === 404, `HTTP ${r.status}`);
record('the 404 is JSON', (await r.json()).error === 'not found');

r = await call(apiRoute, 'https://meridian.pages.dev/api/ai');
record('a known route reaches its handler', r.status === 200, `HTTP ${r.status}`);

r = await call(apiRoute, 'https://meridian.pages.dev/api/v1');
record('a nested v1 route resolves', r.status === 200, `HTTP ${r.status}`);

console.log('\n  configuration arrives as a binding');
r = await call(apiRoute, 'https://meridian.pages.dev/api/ai');
let j = await r.json();
record('with no binding the assistant reports itself off',
  j.available === false, `available=${j.available} model=${j.model}`);
record('it still advertises bring-your-own-key', j.byok === true);

r = await call(apiRoute, 'https://meridian.pages.dev/api/ai', {
  AI_API_KEY: 'sk-from-binding',
  AI_MODEL: 'model-from-binding',
});
j = await r.json();
record('a bound key switches the assistant on', j.available === true, `available=${j.available}`);
record('a bound model name is used', j.model === 'model-from-binding', j.model);
record('the key itself is never in the response',
  !JSON.stringify(j).includes('sk-from-binding'), JSON.stringify(j));

console.log('\n  method handling');
r = await call(apiRoute, 'https://meridian.pages.dev/api/ai', {}, { method: 'DELETE' });
record('an unsupported method is refused', r.status === 405, `HTTP ${r.status}`);
record('Allow survives the adapter', (r.headers.get('allow') || '').includes('POST'), r.headers.get('allow'));

/* A fresh isolate. Cloudflare hands one isolate one env and does not change it
   mid-life, so this is not a transition that happens in production — but the
   adapter writes the binding into a global, and without the reset this request
   would inherit the key bound two tests ago and be answered by the provider
   rather than by the unconfigured path being tested here. */
globalThis.process.env = {};
r = await call(apiRoute, 'https://meridian.pages.dev/api/ai', {}, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'ask', question: 'hello', headlines: [] }),
});
record('a POST with no key configured degrades to 503', r.status === 503, `HTTP ${r.status}`);
record('and says why', (await r.json()).error === 'ai-unconfigured');

console.log('\n  the share route');
r = await call(shareRoute, 'https://meridian.pages.dev/s');
record('/s with no story redirects to the app', r.status === 302, `HTTP ${r.status}`);
record('the redirect points somewhere', !!r.headers.get('location'), r.headers.get('location'));

r = await call(shareRoute, 'https://meridian.pages.dev/s?u=javascript:alert(1)&t=x');
record('/s refuses a hostile url rather than reflecting it',
  r.status === 302 || !(await r.text()).includes('javascript:alert'), `HTTP ${r.status}`);

if (savedProcess) globalThis.process = savedProcess;

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (globalThis.process) globalThis.process.exitCode = failed.length ? 1 : 0;
