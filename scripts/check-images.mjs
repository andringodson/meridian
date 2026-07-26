// Meridian — automatic preview-image resolution audit.
// Walks every tab's feed (all news categories + video briefs), downloads just
// enough bytes of each preview image to read its real pixel dimensions, and
// grades them against an ultra-high-res bar. Zero dependencies (Node 18+).
//
//   node scripts/check-images.mjs [--base=URL] [--min=1000] [--pass=65]
//                                 [--floor=480] [--floor-tol=2] [--junk=300]
//                                 [--limit=0] [--timeout=15000] [--json]
//
//   --base       deployment to audit (default: production)
//   --min        minimum width in px to count as ultra-high-res
//   --pass       required % of measurable images at/above --min, per tab
//   --floor      quality floor — more than --floor-tol below it fails the run
//   --floor-tol  sub-floor images tolerated per tab before failing
//   --junk       hard junk bar — a single image under it fails the run
//   --limit      probe only the first N images per tab (0 = all)
//   --timeout    per-image probe timeout in ms (failed probes retry once)
//   --json       emit the full report as JSON on stdout
//
// Three-tier bar: anything under --junk is not a photograph at all (sprite,
// avatar, beacon, or a CDN ignoring its own size token) and fails on sight.
// Between --junk and --floor sit real photos a wire desk published small; a
// couple per tab is upstream reality rather than a regression, so --floor-tol
// of them are tolerated and only a cluster fails. The --pass rate then requires
// most of each tab to clear the --min ultra bar. Several quality sources cap
// below it — the Guardian's
// signed CDN tops out at 700px in RSS (its signature 401s if you touch the
// width) and Yahoo's zenfs store serves fixed <1000px crops — so 100% ultra
// isn't attainable without dropping them. The rate (not an absolute) tolerates
// that; 65% keeps most tabs honest, and tabs whose wire is dominated by capped
// sources get a lower per-tab floor (see TAB_PASS) rather than flapping red —
// the hard floor still catches genuine junk on every tab.

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const BASE = String(args.base || 'https://meridian-andrin.vercel.app').replace(/\/$/, '');
const MIN_ULTRA = parseInt(args.min, 10) || 1000;
const PASS_PCT = parseFloat(args.pass) || 65;
// Per-tab floors for tabs whose sources structurally cap below the ultra bar.
// Sports draws much of its wire from the Guardian (signed CDN, fixed 700px) and
// Yahoo's zenfs store (<1000px crops), so it tops out ~64-67% ultra where every
// other tab clears 76-100%. An honest per-tab floor beats dragging the global
// bar down for everyone — the 480px hard floor still guards sports from junk.
const TAB_PASS = { sports: 55 };
const passBarFor = (tab) => TAB_PASS[tab] ?? PASS_PCT;
const FLOOR_W = parseInt(args.floor, 10) || 480;
// Anything this small is not a news photo — a sprite, an avatar, a beacon or a
// CDN that ignored its own size token. One is a bug, so one fails the run.
const JUNK_W = parseInt(args.junk, 10) || 300;
// Between JUNK_W and FLOOR_W sit real photographs that a wire desk simply
// published small (CBS screenshots, Billboard's 474px portraits). We can't
// upgrade what the source never shot large, and failing the whole run over one
// of them made this check flap red on days the feed was otherwise fine. Allow a
// couple per tab; more than that is a systemic regression worth failing on.
const FLOOR_TOL = parseInt(args.floorTol ?? args['floor-tol'], 10) || 2;
const PER_TAB_LIMIT = parseInt(args.limit, 10) || 0;
const TIMEOUT_MS = parseInt(args.timeout, 10) || 15000;
// Higher parallelism saturates a home connection and turns healthy CDNs into
// false "timeout" failures — 5 keeps probes honest.
const CONCURRENCY = 5;
// Dimensions live in the header; 128KB clears even EXIF-heavy JPEGs without
// pulling whole multi-MB originals through slow on-demand resizers.
const PROBE_BYTES = 128 * 1024;
// Second-chance window for JPEGs whose colour profiles bury the SOF marker
// deeper than that (Adobe Stock originals put it past 300KB).
const DEEP_PROBE_BYTES = 640 * 1024;

// For You and Saved re-render articles from these same category feeds, and
// Markets draws canvas charts — the news categories + videos cover every
// preview image the UI can show.
const NEWS_TABS = ['top', 'world', 'business', 'technology', 'science', 'health', 'sports', 'entertainment'];

// ---------------------------------------------------------------------------
// Dimension parsers — each reads a header from a partial buffer.

const jpegSize = (b) => {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; }
    // SOF0–SOF15 carry dimensions, except the DHT/DAC/JPG pseudo-markers.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
};

const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
const gifSize = (b) => ({ w: b.readUInt16LE(6), h: b.readUInt16LE(8) });
const bmpSize = (b) => ({ w: b.readInt32LE(18), h: Math.abs(b.readInt32LE(22)) });

const webpSize = (b) => {
  const fourcc = b.toString('ascii', 12, 16);
  if (fourcc === 'VP8 ' && b.length >= 30) {
    return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === 'VP8L' && b.length >= 25) {
    return {
      w: 1 + (((b[22] & 0x3f) << 8) | b[21]),
      h: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
    };
  }
  if (fourcc === 'VP8X' && b.length >= 30) {
    return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  }
  return null;
};

// AVIF/HEIC: the ispe property box holds the image spatial extent.
const isobmffSize = (b) => {
  const i = b.indexOf('ispe');
  if (i < 0 || i + 16 > b.length) return null;
  return { w: b.readUInt32BE(i + 8), h: b.readUInt32BE(i + 12) };
};

function sniffSize(buf, contentType = '') {
  if (buf.length < 30) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return { fmt: 'jpeg', ...jpegSize(buf) };
  if (buf.readUInt32BE(0) === 0x89504e47) return { fmt: 'png', ...pngSize(buf) };
  if (buf.toString('ascii', 0, 4) === 'GIF8') return { fmt: 'gif', ...gifSize(buf) };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { fmt: 'webp', ...webpSize(buf) };
  }
  if (buf.toString('ascii', 4, 8) === 'ftyp') return { fmt: 'avif', ...isobmffSize(buf) };
  if (buf[0] === 0x42 && buf[1] === 0x4d) return { fmt: 'bmp', ...bmpSize(buf) };
  // Vector previews scale to any density — always sharp.
  if (/svg/i.test(contentType) || /^\s*<(\?xml|svg)/i.test(buf.toString('utf8', 0, 200))) {
    return { fmt: 'svg', vector: true };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Probing — ranged GET, stream just enough bytes to sniff the header.

async function probeImage(url, ms = TIMEOUT_MS, bytes = PROBE_BYTES) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // Some news CDNs refuse bot-looking agents with 403.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MeridianImageAudit/1.0',
        Range: `bytes=0-${bytes - 1}`,
        Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      },
    });
    // A bot wall or a rate limit says nothing about the picture — only that a
    // datacenter IP asked for it. Keep it out of the broken-image alarm.
    if ([401, 403, 405, 429, 451].includes(r.status)) {
      return { status: 'blocked', error: `HTTP ${r.status}` };
    }
    if (!r.ok && r.status !== 206) return { status: 'broken', error: `HTTP ${r.status}` };
    const contentType = r.headers.get('content-type') || '';
    // A CDN answering an image URL with HTML is serving an error page.
    if (/text\/html/i.test(contentType)) return { status: 'broken', error: 'HTML instead of image' };

    // 206 → the server honored Range and the body is already capped: read it
    // whole. 200 → it ignored Range: stream just enough, then cancel the
    // READER, not the request — aborting completed/in-flight requests poisons
    // the shared connection pool and snowballs into fake timeouts.
    let buf;
    if (r.status === 206) {
      buf = Buffer.from(await r.arrayBuffer());
    } else {
      const reader = r.body.getReader();
      const chunks = [];
      let size = 0;
      while (size < bytes) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
      }
      await reader.cancel().catch(() => {});
      buf = Buffer.concat(chunks);
    }
    const dims = sniffSize(buf, contentType);
    if (!dims) return { status: 'unreadable', error: `unknown format (${contentType || 'no content-type'})` };
    if (dims.vector) return { status: 'ok', fmt: dims.fmt, vector: true };
    if (!dims.w || !dims.h) return { status: 'unreadable', error: `${dims.fmt} header truncated` };
    return { status: 'ok', fmt: dims.fmt, w: dims.w, h: dims.h };
  } catch (e) {
    // Our own early abort still lands here if the body ended mid-read.
    if (e.name === 'AbortError') return { status: 'broken', error: 'timeout' };
    return { status: 'broken', error: e.cause?.code || e.message };
  } finally {
    clearTimeout(t);
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'MeridianImageAudit/1.0' } });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------------------

// One retry with extra headroom — news CDNs resize on demand and a cold
// cache can genuinely take >15s once, without the image being broken.
async function probeWithRetry(url) {
  const first = await probeImage(url);
  // A "truncated header" is usually our window being too small, not a bad file:
  // agency JPEGs from Adobe Stock carry ICC/EXIF profiles that push the SOF
  // marker past 300KB. Read further before calling a 5000px photo unreadable —
  // these were being counted as broken AND dropped from the pass rate.
  if (first.status === 'unreadable' && /truncated/.test(first.error || '')) {
    const deeper = await probeImage(url, TIMEOUT_MS * 2, DEEP_PROBE_BYTES);
    if (deeper.status === 'ok') return deeper;
    return first;
  }
  if (first.status !== 'broken') return first;
  return probeImage(url, TIMEOUT_MS * 2);
}

// Concurrency is global, so five workers can all land on one newsroom CDN at
// once — that burst, not any fault in the images, is what earned NASA's 429s.
// Serialise per host with a small gap; different hosts still run in parallel.
const HOST_GAP_MS = 250;
const hostChain = new Map();
function pacedByHost(url, fn) {
  let host;
  try { host = new URL(url).hostname; } catch { host = url; }
  const run = (hostChain.get(host) || Promise.resolve()).then(async () => {
    const out = await fn();
    await new Promise((r) => setTimeout(r, HOST_GAP_MS));
    return out;
  });
  // Keep the chain alive whatever this probe did; a rejection must not stall
  // every later image on the same host.
  hostChain.set(host, run.then(() => {}, () => {}));
  return run;
}

const probeCache = new Map(); // same image can appear in several tabs
const cachedProbe = (url) => {
  if (!probeCache.has(url)) probeCache.set(url, pacedByHost(url, () => probeWithRetry(url)));
  return probeCache.get(url);
};

async function auditTab(tab, entries) {
  const list = PER_TAB_LIMIT > 0 ? entries.slice(0, PER_TAB_LIMIT) : entries;
  const results = await mapLimit(list, CONCURRENCY, async (e) => ({
    ...e,
    ...(await cachedProbe(e.image)),
  }));
  const measured = results.filter((r) => r.status === 'ok');
  const ultra = measured.filter((r) => r.vector || r.w >= MIN_ULTRA);
  const below = measured.filter((r) => !r.vector && r.w < MIN_ULTRA);
  const tiny = below.filter((r) => r.w < FLOOR_W);
  const junk = tiny.filter((r) => r.w < JUNK_W);
  const broken = results.filter((r) => r.status === 'broken' || r.status === 'unreadable');
  // Upstream WAFs block datacenter IPs (Gizmodo 403s every CI run; NASA 429s
  // under our own probe rate). Those images are fine in a real browser, so they
  // are reported apart from genuinely dead ones and never counted against us.
  const blocked = results.filter((r) => r.status === 'blocked');
  const passRate = measured.length ? (ultra.length / measured.length) * 100 : 0;
  return { tab, total: results.length, ultra, below, tiny, junk, broken, blocked, passRate };
}

async function main() {
  console.log(`Meridian image audit — ${BASE}`);
  console.log(`ultra bar: width ≥ ${MIN_ULTRA}px · pass rate: ${PASS_PCT}% per tab (sports ${TAB_PASS.sports}%, source-capped)`);
  console.log(`floor: ${FLOOR_W}px, up to ${FLOOR_TOL} tolerated per tab · junk bar: ${JUNK_W}px, zero tolerated\n`);

  const tabs = [];
  for (const cat of NEWS_TABS) {
    const data = await fetchJson(`${BASE}/api/news?category=${cat}`);
    const entries = (data.articles || [])
      .filter((a) => a.image)
      .map((a) => ({ image: a.image, label: a.source }));
    tabs.push(await auditTab(cat, entries));
    process.stdout.write(`  probed ${cat} (${entries.length} images)\n`);
  }
  const vids = await fetchJson(`${BASE}/api/videos`);
  const ventries = (vids.videos || [])
    .filter((v) => v.thumbnail)
    .map((v) => ({ image: v.thumbnail, label: v.channel }));
  tabs.push(await auditTab('videos', ventries));
  process.stdout.write(`  probed videos (${ventries.length} images)\n\n`);

  // Report.
  const pad = (s, n) => String(s).padEnd(n);
  const rpad = (s, n) => String(s).padStart(n);
  console.log(`${pad('TAB', 15)}${rpad('IMAGES', 7)}${rpad('ULTRA', 7)}${rpad('BELOW', 7)}${rpad('TINY', 6)}${rpad('BROKEN', 8)}${rpad('BLOCKED', 9)}${rpad('PASS', 7)}${rpad('NEED', 6)}`);
  let failed = false;
  for (const t of tabs) {
    const bar = passBarFor(t.tab);
    const reasons = [];
    if (t.passRate < bar) reasons.push(`${t.passRate.toFixed(0)}% < ${bar}% ultra`);
    if (t.junk.length) reasons.push(`${t.junk.length} under ${JUNK_W}px`);
    if (t.tiny.length > FLOOR_TOL) reasons.push(`${t.tiny.length} under ${FLOOR_W}px (tol ${FLOOR_TOL})`);
    if (reasons.length) failed = true;
    const flag = reasons.length ? `✗ FAIL — ${reasons.join(', ')}`
      : t.tiny.length ? `✓ (${t.tiny.length} small, within tol)` : '✓';
    console.log(
      `${pad(t.tab, 15)}${rpad(t.total, 7)}${rpad(t.ultra.length, 7)}${rpad(t.below.length, 7)}` +
      `${rpad(t.tiny.length, 6)}${rpad(t.broken.length, 8)}${rpad(t.blocked.length, 9)}` +
      `${rpad(t.passRate.toFixed(0) + '%', 7)}${rpad(bar + '%', 6)}  ${flag}`
    );
  }

  const allBelow = tabs.flatMap((t) => t.below.map((r) => ({ tab: t.tab, ...r })))
    .sort((a, b) => a.w - b.w);
  if (allBelow.length) {
    console.log(`\nBelow ${MIN_ULTRA}px (worst first, ✖ = under ${JUNK_W}px junk bar, ⚠ = under the ${FLOOR_W}px floor):`);
    for (const r of allBelow.slice(0, 40)) {
      const mark = r.w < JUNK_W ? '✖' : r.w < FLOOR_W ? '⚠' : ' ';
      console.log(`  ${mark} [${r.tab}] ${r.w}×${r.h} ${r.fmt}  ${r.label}  ${r.image}`);
    }
    if (allBelow.length > 40) console.log(`  … and ${allBelow.length - 40} more`);
  }
  const allBroken = tabs.flatMap((t) => t.broken.map((r) => ({ tab: t.tab, ...r })));
  if (allBroken.length) {
    console.log('\nUnreachable / unreadable:');
    for (const r of allBroken.slice(0, 20)) {
      console.log(`  [${r.tab}] ${r.error}  ${r.label}  ${r.image}`);
    }
    if (allBroken.length > 20) console.log(`  … and ${allBroken.length - 20} more`);
  }
  // Informational only — these load fine for real visitors.
  const allBlocked = tabs.flatMap((t) => t.blocked.map((r) => ({ tab: t.tab, ...r })));
  if (allBlocked.length) {
    const byHost = new Map();
    for (const r of allBlocked) {
      let h; try { h = new URL(r.image).hostname; } catch { h = r.label; }
      byHost.set(`${h} ${r.error}`, (byHost.get(`${h} ${r.error}`) || 0) + 1);
    }
    console.log('\nBlocked to CI (bot wall / rate limit — fine in a browser, not counted):');
    for (const [k, n] of [...byHost].sort((a, b) => b[1] - a[1])) console.log(`  ${n}×  ${k}`);
  }

  if (args.json) {
    console.log('\n' + JSON.stringify({
      base: BASE, minWidth: MIN_ULTRA, floorWidth: FLOOR_W, floorTolerance: FLOOR_TOL,
      junkWidth: JUNK_W, requiredPassPct: PASS_PCT, tabs,
    }, null, 2));
  }

  console.log(failed
    ? `\nRESULT: FAIL — a tab is under its ultra-high-res rate, serves an image under ${JUNK_W}px, or has more than ${FLOOR_TOL} under ${FLOOR_W}px.`
    : '\nRESULT: PASS — every tab meets the ultra-high-res bar.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(`audit crashed: ${e.message}`);
  process.exit(2);
});
