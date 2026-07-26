// Meridian — browser smoke test.
//
//   node scripts/smoke.mjs [--base=URL] [--min-images=90] [--timeout=45000]
//                          [--keep-open] [--json]
//
// The image audit in check-images.mjs probes the API. It cannot see the app.
// When a service-worker change routed article thumbnails through a fetch that
// the page's own CSP forbade, ~85% of preview images broke in production and
// every API check stayed green — a reader found it, not CI. This loads the real
// deployment in a real browser and asserts the things a reader would notice:
//
//   · the feed renders cards at all
//   · their preview images actually decode (naturalWidth > 0), after scrolling
//     the whole feed so lazy and content-visibility images are given their turn
//   · the reader opens and closes
//   · nothing throws on the console
//
// Zero dependencies: Chrome is driven over the DevTools Protocol using Node's
// built-in WebSocket (Node 22+), so there is no Puppeteer to install or pin.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));

const BASE = String(args.base || 'https://meridian-andrin.vercel.app').replace(/\/$/, '');
const MIN_IMAGES = parseFloat(args['min-images']) || 90;   // % of thumbnails that must decode
const TIMEOUT = parseInt(args.timeout, 10) || 45000;
const PORT = 9333 + (process.pid % 200);                   // avoid colliding with a stray Chrome

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  throw new Error('no Chrome found — set CHROME_PATH');
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevTools(deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return (await r.json()).Browser;
    } catch { /* not up yet */ }
    await wait(250);
  }
  throw new Error('Chrome never opened its debugging port');
}

// --- minimal CDP client -----------------------------------------------------
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      const text = d.exception?.description || d.text || '';
      // Vercel's analytics script 404s until Web Analytics is enabled in the
      // dashboard; that is a project setting, not a regression in this app.
      if (!/insights|analytics/i.test((d.url || '') + text)) consoleErrors.push(text.split('\n')[0].slice(0, 160));
    }
  };

  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
    return r.result?.result?.value;
  };

  return { ready, send, evaluate, consoleErrors, close: () => ws.close() };
}

// --- the checks -------------------------------------------------------------
const checks = [];
const record = (name, pass, detail) => { checks.push({ name, pass, detail }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${detail}`); };

async function main() {
  const chrome = findChrome();
  const profile = await mkdtemp(join(tmpdir(), 'meridian-smoke-'));
  const proc = spawn(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1280,1600', 'about:blank',
  ], { stdio: 'ignore' });

  let cdp;
  try {
    const version = await waitForDevTools(Date.now() + 25000);
    console.log(`Meridian smoke test — ${BASE}`);
    console.log(`${version}\n`);

    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page');
    cdp = connect(page.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    // Two visits: the first installs the service worker, the second is the one
    // a returning reader gets — and the one where a bad worker does its damage.
    for (let i = 0; i < 2; i++) {
      await cdp.send('Page.navigate', { url: `${BASE}/?smoke=${Date.now()}` });
      await wait(TIMEOUT / 4);
    }
    cdp.consoleErrors.length = 0; // only judge the settled visit

    const cards = await cdp.evaluate(`document.querySelectorAll('#feed .card').length`);
    record('feed renders', cards > 10, `${cards} cards`);

    // Scroll the whole feed: lazy loading and content-visibility mean an
    // unscrolled page looks perfect even when every image below the fold is dead.
    await cdp.evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
    await wait(TIMEOUT / 5);
    await cdp.evaluate(`window.scrollTo(0, 0)`);
    await wait(2000);

    const img = JSON.parse(await cdp.evaluate(`(() => {
      const i = [...document.querySelectorAll('#feed .thumb img')];
      return JSON.stringify({
        total: i.length,
        ok: i.filter(x => x.complete && x.naturalWidth > 0).length,
        gradients: document.querySelectorAll('#feed .thumb.noimg').length,
      });
    })()`));
    const shown = img.total + img.gradients;
    const pct = shown ? (img.ok / shown) * 100 : 0;
    record('preview images decode', pct >= MIN_IMAGES,
      `${img.ok}/${shown} (${pct.toFixed(0)}%, need ${MIN_IMAGES}%) · ${img.gradients} fell back`);

    const responsive = await cdp.evaluate(`document.querySelectorAll('#feed .thumb img[srcset]').length`);
    record('responsive variants served', responsive > 0, `${responsive} images carry srcset`);

    const leadEager = await cdp.evaluate(
      `(() => { const i = document.querySelector('#feed .card.lead .thumb img'); return i ? i.loading : 'none'; })()`);
    record('lead image not lazy', leadEager !== 'lazy', `loading="${leadEager}"`);

    await cdp.evaluate(`openReaderFromFeed(1)`);
    await wait(2500);
    const readerOpen = await cdp.evaluate(`!document.querySelector('.reader').hidden`);
    await cdp.evaluate(`closeReader()`);
    await wait(1800);
    const readerClosed = await cdp.evaluate(`document.querySelector('.reader').hidden`);
    record('reader opens and closes', readerOpen && readerClosed, `open=${readerOpen} closed=${readerClosed}`);

    record('console clean', cdp.consoleErrors.length === 0,
      cdp.consoleErrors.length ? cdp.consoleErrors.slice(0, 3).join(' | ') : 'no exceptions');
  } finally {
    try { cdp?.close(); } catch { /* already gone */ }
    if (!args['keep-open']) { proc.kill(); await rm(profile, { recursive: true, force: true }).catch(() => {}); }
  }

  const failed = checks.filter((c) => !c.pass);
  if (args.json) console.log('\n' + JSON.stringify({ base: BASE, checks }, null, 2));
  console.log(failed.length
    ? `\nRESULT: FAIL — ${failed.length} of ${checks.length} checks failed.`
    : `\nRESULT: PASS — all ${checks.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(`smoke test crashed: ${e.message}`); process.exit(2); });
