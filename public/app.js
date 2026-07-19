/* Meridian — client. Fetches aggregated news + Wikipedia history, renders the
   premium dark UI, and refreshes itself on a timer so content stays current
   without any manual action. */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const feedEl = $('#feed');
const historyEl = $('#history');
const updatedEl = $('#updated');
const stageTitle = $('#stage-title');
const liveEl = $('#live');

let currentCat = 'top';
let currentArticles = [];
let renderedList = [];        // exactly what the feed shows now (post-search) — drives the reader
let currentNew = new Set();   // links considered "new since last visit" in the current view
let lastFetch = 0;
const REFRESH_MS = 90_000;

const CAT_LABEL = {
  top: 'Top stories', world: 'World', business: 'Business',
  technology: 'Technology', science: 'Science', health: 'Health',
  sports: 'Sports', entertainment: 'Culture', saved: 'Saved stories',
  foryou: 'For You',
};

/* ---------- saved stories (localStorage, keyed by link) ---------- */
const SAVE_KEY = 'meridian-saved';
function getSaved() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || []; } catch { return []; }
}
function isSaved(link) { return getSaved().some((a) => a.link === link); }
function toggleSave(article) {
  let list = getSaved();
  if (list.some((a) => a.link === article.link)) list = list.filter((a) => a.link !== article.link);
  else list = [article, ...list].slice(0, 100);
  localStorage.setItem(SAVE_KEY, JSON.stringify(list));
}

/* ---------- "new since last visit" (localStorage, keyed by link) ----------
   Every headline you're shown is remembered; anything unseen since your last
   visit is flagged on its card and counted on its category tab. A gentle
   background sweep keeps the tab counts honest without you opening each one.
   On a device's very first run we seed silently — there's no "last visit" to
   compare against, so nothing is falsely marked new. */
const SEEN_KEY = 'meridian-seen';
const SEEN_INIT = 'meridian-seen-init';
const SEEN_CAP = 2500;
let seenSet = (() => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) || []); } catch { return new Set(); }
})();
const seenReady = () => localStorage.getItem(SEEN_INIT) === '1';
function persistSeen() {
  let arr = [...seenSet];
  if (arr.length > SEEN_CAP) { arr = arr.slice(arr.length - SEEN_CAP); seenSet = new Set(arr); }
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(arr)); } catch { /* quota */ }
}
function addSeen(links) { for (const l of links) if (l) seenSet.add(l); persistSeen(); }

const tabNew = new Map(); // category → unseen count, mirrored onto the tab
function setTabNew(cat, n) {
  tabNew.set(cat, n);
  const tab = document.querySelector(`.tab[data-cat="${cat}"]`);
  if (!tab) return;
  let b = tab.querySelector('.tab-new');
  if (n > 0) {
    if (!b) { b = document.createElement('span'); b.className = 'tab-new'; tab.appendChild(b); }
    b.textContent = n > 99 ? '99+' : String(n);
  } else if (b) { b.remove(); }
}
// Snapshot which of these links are new, mark them all seen, clear this tab's badge.
function computeNew(articles) {
  const links = articles.map((a) => a.link).filter(Boolean);
  if (!seenReady()) { addSeen(links); currentNew = new Set(); return; }
  currentNew = new Set(links.filter((l) => !seenSet.has(l)));
  addSeen(links);
  setTabNew(currentCat, 0);
}

const SWEEP_CATS = ['top', 'world', 'business', 'technology', 'science', 'health', 'sports', 'entertainment'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sweeping = false;
async function sweepNew() {
  if (sweeping || document.hidden || !navigator.onLine) return;
  sweeping = true;
  const ready = seenReady();
  try {
    for (const cat of SWEEP_CATS) {
      try {
        const arts = await peekData(cat); // reuses the hover-peek cache — cheap
        const links = arts.map((a) => a.link).filter(Boolean);
        if (!ready) { for (const l of links) seenSet.add(l); } // seed, no badges
        else setTabNew(cat, cat === currentCat ? 0 : links.filter((l) => !seenSet.has(l)).length);
      } catch { /* skip this category */ }
      await sleep(250); // stagger so the sweep never bursts
    }
    if (!ready) { persistSeen(); try { localStorage.setItem(SEEN_INIT, '1'); } catch { /* quota */ } }
  } finally { sweeping = false; }
}

/* deterministic cinematic gradient for stories without an image */
const GRADIENTS = [
  ['#0000ee', '#05051a'], ['#1a1050', '#05050f'], ['#032a3a', '#04040c'],
  ['#2a0a3a', '#070510'], ['#0a2540', '#04040c'], ['#3a1020', '#0a0508'],
  ['#102a2a', '#04040c'], ['#1c1c3a', '#050510'],
];
function hash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }
function gradientFor(seed) {
  const [a, b] = GRADIENTS[hash(seed) % GRADIENTS.length];
  const ang = 120 + (hash(seed + 'x') % 90);
  return `linear-gradient(${ang}deg, ${a}, ${b})`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const esc = (s = '') => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- toast notifications ---------- */
const toastEl = document.createElement('div');
toastEl.className = 'toast';
toastEl.setAttribute('role', 'status');
document.body.appendChild(toastEl);
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}
addEventListener('offline', () => toast('You’re offline — showing cached stories'));
addEventListener('online', () => toast('Back online'));

/* ---------- "new stories" pill: polls never yank the page mid-read ---------- */
const pillEl = document.createElement('button');
pillEl.className = 'new-pill';
pillEl.hidden = true;
document.body.appendChild(pillEl);
let pendingNews = null;
pillEl.addEventListener('click', () => {
  if (!pendingNews) return;
  applyNews(pendingNews);
  pendingNews = null;
  pillEl.hidden = true;
  scrollTo({ top: 0, behavior: 'smooth' });
});

function cardHTML(a, lead, i) {
  const showImg = a.image && !document.documentElement.classList.contains('data-saver');
  const thumb = showImg
    ? `<div class="thumb"><img src="${esc(a.image)}" alt="" loading="lazy" decoding="async"
         referrerpolicy="no-referrer" data-fallback="${gradientFor(a.title)}" /></div>`
    : `<div class="thumb noimg" style="background-image:${gradientFor(a.title)}">
         <span class="glyph">${esc((a.source || '?').trim().charAt(0).toUpperCase())}</span>
       </div>`;
  const saved = isSaved(a.link);
  const fresh = currentNew.has(a.link);
  return `<a class="card${lead ? ' lead' : ''}${showImg ? ' has-img' : ''}${fresh ? ' is-new' : ''}" style="--i:${i}" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">
    ${fresh ? '<span class="new-tag">New</span>' : ''}
    ${thumb}
    <div class="card-body">
      <div class="headline">${esc(a.title)}</div>
      ${a.summary ? `<div class="summary">${esc(a.summary)}</div>` : ''}
      <div class="meta">
        <span class="source">${esc(a.source || 'Source')}</span>
        <span class="dot-sep"></span>
        <span>${timeAgo(a.publishedAt)}</span>
        <span class="acts">
          <button class="act act-save${saved ? ' on' : ''}" data-link="${esc(a.link)}" aria-label="${saved ? 'Remove from saved' : 'Save for later'}" title="${saved ? 'Saved' : 'Save'}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg>
          </button>
          <button class="act act-share" data-link="${esc(a.link)}" data-title="${esc(a.title)}" aria-label="Share story" title="Share">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.7l6.8-4.4M8.6 13.3l6.8 4.4"/></svg>
          </button>
        </span>
      </div>
      ${a.coverage && a.coverage.length ? `<div class="coverage" title="Other outlets covering this story">Also: ${a.coverage.slice(0, 3).map((c) => esc(c.source)).join(' · ')}${a.coverage.length > 3 ? ` +${a.coverage.length - 3}` : ''}</div>` : ''}
    </div>
  </a>`;
}

function renderFeed(list) {
  renderedList = list;
  if (!list.length) { feedEl.innerHTML = `<p class="empty">No stories found.</p>`; return; }
  feedEl.innerHTML = list.map((a, i) => cardHTML(a, i === 0, i)).join('');
}

// A preview URL that 404s must never show a broken-image icon: swap the thumb
// to its gradient fallback. Capture phase — img error events don't bubble, and
// CSP (script-src 'self') rules out inline onerror handlers.
feedEl.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const wrap = img.parentElement;
  if (!wrap?.classList.contains('thumb')) { img.remove(); return; }
  // One retry before giving up: news CDNs (NPR's on-demand resizer especially)
  // 504 on a cold render, then serve fine once it's cached. Re-request the same
  // URL after a beat — reusing the identical URL keeps signed CDNs (Guardian)
  // intact — and only fall back to the gradient if it fails a second time.
  if (!img.dataset.retried) {
    img.dataset.retried = '1';
    const src = img.src;
    setTimeout(() => { if (img.isConnected) img.src = src; }, 1500);
    return;
  }
  wrap.classList.add('noimg');
  wrap.style.backgroundImage = img.dataset.fallback || '';
  img.closest('.card')?.classList.remove('has-img');
  img.remove();
}, true);

function renderSkeleton(n = 6) {
  feedEl.innerHTML = Array.from({ length: n }).map((_, i) =>
    `<div class="card skeleton${i === 0 ? ' lead' : ''}"><div class="thumb"></div>
     <div class="card-body"><div class="line" style="width:80%"></div><div class="line" style="width:55%"></div></div></div>`
  ).join('');
}

function setLive(ok) {
  liveEl.classList.toggle('stale', !ok);
  $('.live-label', liveEl).textContent = ok ? 'LIVE' : 'OFFLINE';
}

function applyNews(data) {
  currentArticles = data.articles || [];
  computeNew(currentArticles);
  applySearch();
  renderCurators(currentArticles);
  const t = new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  updatedEl.textContent = data.sources ? `${data.count} stories · ${data.sources} sources · ${t}` : `Updated ${t}`;
}

async function loadNews(cat, { skeleton = true } = {}) {
  currentCat = cat;
  stageTitle.textContent = CAT_LABEL[cat] || 'Stories';
  if (skeleton) { pendingNews = null; pillEl.hidden = true; } // stale offer dies with the view
  if (cat === 'saved') {
    currentArticles = getSaved();
    currentNew = new Set(); // saved stories are yours already — never flagged "new"
    lastFetch = Date.now();
    applySearch();
    updatedEl.textContent = `${currentArticles.length} saved on this device`;
    if (!currentArticles.length) feedEl.innerHTML = `<p class="empty">Nothing saved yet — tap the bookmark on any story.</p>`;
    return;
  }
  if (cat === 'foryou') {
    if (skeleton) renderSkeleton();
    try {
      currentArticles = typeof buildForYou === 'function' ? await buildForYou() : [];
      computeNew(currentArticles);
      lastFetch = Date.now();
      applySearch();
      if (currentArticles.length) {
        renderCurators(currentArticles);
        updatedEl.textContent = `${currentArticles.length} stories matching your topics`;
      } else {
        updatedEl.textContent = '';
        feedEl.innerHTML = `<p class="empty">Follow some topics in Settings (the gear icon) and your personal feed appears here.</p>`;
      }
      setLive(true);
      hideBoot();
    } catch { setLive(false); }
    return;
  }
  if (skeleton) renderSkeleton();
  try {
    const r = await fetch(`/api/news?category=${encodeURIComponent(cat)}`, { cache: 'no-store' });
    const data = await r.json();
    lastFetch = Date.now();
    // Background poll while the reader is scrolled down: offer, don't yank.
    if (!skeleton && scrollY > 300 && currentArticles.length) {
      const have = new Set(currentArticles.map((a) => a.link));
      const fresh = (data.articles || []).filter((a) => !have.has(a.link)).length;
      if (fresh > 0) {
        pendingNews = data;
        pillEl.textContent = `↑ ${fresh} new ${fresh === 1 ? 'story' : 'stories'}`;
        pillEl.hidden = false;
        setLive(true);
        return;
      }
    }
    applyNews(data);
    setLive(true);
    hideBoot();
  } catch (e) {
    setLive(false);
    if (!currentArticles.length) feedEl.innerHTML = `<p class="empty">Couldn’t reach the news service. Retrying…</p>`;
  }
}

let historyType = 'events';
let lastHistory = [];
async function loadHistory() {
  try {
    const r = await fetch(`/api/wiki?type=${historyType}`, { cache: 'no-store' });
    const data = await r.json();
    if (historyType === 'events') lastHistory = data.events || [];
    $('#rail-date').textContent = new Date().toLocaleDateString([], { month: 'long', day: 'numeric' });
    historyEl.innerHTML = (data.events || []).slice(0, 12).map((e) => `
      <li><a href="${esc(e.url || '#')}" target="_blank" rel="noopener noreferrer">
        <span class="yr">${e.year}</span>
        <div class="ev">${esc(e.text)}</div>
      </a></li>`).join('') || `<li class="empty">History unavailable.</li>`;
  } catch { historyEl.innerHTML = `<li class="empty">History unavailable.</li>`; }
}

/* ---------- The Desk: AI curator personas ----------
   Four characters, each with a voice, surface a top/interesting pick from the
   live feed. Picks and one-liners are generated from the headlines — no keys,
   no external calls — and refresh whenever the feed does. */
const PERSONAS = [
  { id: 'aria', name: 'Aria', role: 'The Optimist', color: '#0000ee', mono: 'A',
    likes: ['break', 'first', 'launch', 'deal', 'win', 'record', 'cure', 'peace', 'rescue', 'growth'],
    lines: [
      'Genuinely hopeful — {t} is the kind of story we need more of.',
      'A bright signal today: {t}. Worth your two minutes.',
      'This one lifted me — {t}. Progress, quietly.',
    ] },
  { id: 'kato', name: 'Kato', role: 'The Analyst', color: '#a0c3ec', mono: 'K',
    likes: ['market', 'economy', 'rate', 'trade', 'election', 'policy', 'gdp', 'inflation', 'court', 'data', 'oil'],
    lines: [
      'Watch the second-order effects — {t} moves more than it looks.',
      'Signal over noise: {t} is the one to track this week.',
      'Structurally important — {t}. Follow the incentives.',
    ] },
  { id: 'nova', name: 'Nova', role: 'The Culturist', color: '#c4b5fd', mono: 'N',
    likes: ['film', 'music', 'art', 'game', 'ai', 'design', 'culture', 'star', 'award', 'viral', 'fashion', 'space'],
    lines: [
      'Everyone will be talking about this — {t}.',
      'The zeitgeist, captured: {t}.',
      'File under “iconic”: {t}.',
    ] },
  { id: 'rex', name: 'Rex', role: 'The Skeptic', color: '#ff7a17', mono: 'R',
    likes: ['claim', 'reportedly', 'could', 'may', 'promise', 'hype', 'sued', 'probe', 'warn', 'ban', 'crisis'],
    lines: [
      'Read the fine print before you believe the headline on {t}.',
      'I’m not sold yet — {t} deserves a harder look.',
      'Big claim, thin evidence: {t}. Stay skeptical.',
    ] },
];

function topic(title) {
  const words = title.replace(/[—–:|].*$/, '').trim().split(/\s+/).slice(0, 7).join(' ');
  return words.replace(/[.,;]$/, '');
}
function recency(a) {
  if (!a.publishedAt) return 0;
  const h = (Date.now() - new Date(a.publishedAt)) / 3.6e6;
  return Math.max(0, 1 - h / 24); // newer = higher, ~0 after a day
}
function scoreFor(persona, a) {
  const hay = (a.title + ' ' + (a.summary || '')).toLowerCase();
  let s = recency(a) * 2;
  for (const k of persona.likes) if (hay.includes(k)) s += 1.5;
  if (a.image) s += 0.4;
  return s;
}
function renderCurators(articles) {
  const row = document.getElementById('curators-row');
  if (!row || !articles.length) return;
  const used = new Set();
  const cards = PERSONAS.map((p) => {
    const ranked = articles
      .map((a) => ({ a, s: scoreFor(p, a) }))
      .sort((x, y) => y.s - x.s);
    const pick = (ranked.find((r) => !used.has(r.a.link)) || ranked[0]).a;
    used.add(pick.link);
    const line = p.lines[hash(p.id + pick.title) % p.lines.length].replace('{t}', `“${esc(topic(pick.title))}”`);
    return `<article class="curator">
      <div class="curator-top">
        <span class="avatar" style="--c:${p.color}">${p.mono}</span>
        <div><div class="curator-name">${p.name}</div><div class="curator-role">${p.role}</div></div>
      </div>
      <p class="curator-take">${line}</p>
      <a class="curator-pick" href="${esc(pick.link)}" target="_blank" rel="noopener noreferrer">
        ${esc(pick.title)}
        <span class="curator-src">${esc(pick.source)}</span>
      </a>
    </article>`;
  });
  row.innerHTML = cards.join('');
}

/* search filters the loaded category client-side */
const searchInput = $('#search-input');
function applySearch() {
  const q = searchInput.value.trim().toLowerCase();
  const list = !q ? currentArticles
    : currentArticles.filter((a) => (a.title + ' ' + a.source).toLowerCase().includes(q));
  renderFeed(list);
}
searchInput.addEventListener('input', applySearch);

/* tabs — categories switch the feed; Markets and Videos switch the whole view */
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab'); if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === btn));
  hidePeek();
  showMarkets(btn.dataset.view === 'markets');
  showVideos(btn.dataset.view === 'videos');
  if (btn.dataset.view) return;
  searchInput.value = '';
  loadNews(btn.dataset.cat);
});
$('#search').addEventListener('submit', (e) => e.preventDefault());

/* ---------- tab peek: headline preview on hover ----------
   Hovering a category tab prefetches that category (cached briefly) and shows
   its top headlines in a small popover, so you know what's inside before you
   click. Hover-only by design — touch and keyboard users just activate the tab. */
const peekEl = $('#tab-peek');
const peekCache = new Map(); // cat → { at, articles }
let peekToken = 0;
async function peekData(cat) {
  const hit = peekCache.get(cat);
  if (hit && Date.now() - hit.at < REFRESH_MS) return hit.articles;
  const r = await fetch(`/api/news?category=${encodeURIComponent(cat)}`);
  const data = await r.json();
  peekCache.set(cat, { at: Date.now(), articles: data.articles || [] });
  return data.articles || [];
}
function hidePeek() { if (peekEl) { peekEl.hidden = true; } }
async function showPeek(tab) {
  const cat = tab.dataset.cat;
  if (!cat || !peekEl) return;
  const token = ++peekToken;
  const rect = tab.getBoundingClientRect();
  try {
    const arts = await peekData(cat);
    if (token !== peekToken || !arts.length) return;
    peekEl.innerHTML = `
      <div class="peek-title">${CAT_LABEL[cat] || cat} · right now</div>
      ${arts.slice(0, 3).map((a) => `
        <div class="peek-item">
          <span class="peek-src">${esc(a.source)}</span>
          <span class="peek-head">${esc(a.title)}</span>
        </div>`).join('')}`;
    peekEl.hidden = false;
    const w = peekEl.offsetWidth;
    const left = Math.max(8, Math.min(innerWidth - w - 8, rect.left + rect.width / 2 - w / 2));
    peekEl.style.left = `${left}px`;
    peekEl.style.top = `${rect.bottom + 8 + scrollY}px`;
  } catch { /* no peek on failure */ }
}
if (matchMedia('(hover: hover)').matches) {
  let peekTimer = null;
  $('#tabs').addEventListener('mouseover', (e) => {
    const tab = e.target.closest('.tab');
    clearTimeout(peekTimer);
    if (!tab || !tab.dataset.cat || tab.dataset.cat === 'saved' || tab.classList.contains('is-active')) { hidePeek(); return; }
    peekTimer = setTimeout(() => showPeek(tab), 180);
  });
  $('#tabs').addEventListener('mouseleave', () => { clearTimeout(peekTimer); peekToken++; hidePeek(); });
  addEventListener('scroll', hidePeek, { passive: true });
}

/* self-updating: refresh on timer (only while visible — a backgrounded tab
   spends no network), and immediately when the tab regains focus if stale */
setInterval(() => { if (!document.hidden) loadNews(currentCat, { skeleton: false }); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastFetch > REFRESH_MS) loadNews(currentCat, { skeleton: false });
});
// keep the "updated" label honest without a refetch
setInterval(() => { if (currentArticles.length) applySearch(); }, 60_000);

/* ---------- markets ticker ---------- */
function fmtPrice(v) {
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 1) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
}
function tickHTML(q) {
  const dir = q.changePct > 0.01 ? 'up' : q.changePct < -0.01 ? 'down' : 'flat';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '·';
  const sign = q.changePct > 0 ? '+' : '';
  const href = `https://finance.yahoo.com/quote/${encodeURIComponent(q.symbol)}`;
  return `<a class="tick" href="${href}" target="_blank" rel="noopener noreferrer">
    <span class="tick-label">${esc(q.label)}</span>
    <span class="tick-price">${fmtPrice(q.price)}</span>
    <span class="tick-chg ${dir}">${arrow} ${sign}${q.changePct.toFixed(2)}%</span>
  </a>`;
}
let lastQuotes = [];
async function loadMarkets() {
  const track = document.getElementById('ticker-track');
  if (!track) return;
  try {
    const r = await fetch('/api/markets', { cache: 'no-store' });
    const data = await r.json();
    if (!data.quotes || !data.quotes.length) return;
    lastQuotes = data.quotes;
    // Marquee stays a world-markets tape; individual stocks live in the grid.
    const tape = data.quotes.filter((q) => q.kind !== 'stock');
    const one = tape.map(tickHTML).join('');
    track.innerHTML = one + one; // duplicate for a seamless marquee loop
    if (marketsOpen) { renderMarketGrid(); renderMovers(); }
    const upd = $('#mkt-updated');
    if (upd) upd.textContent = `Updated ${new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · auto-refreshing · quotes may be delayed`;
  } catch { /* leave prior ticker in place */ }
}

/* ---------- Markets analysis view ----------
   A grid of instrument cards with intraday sparklines, plus a large detail
   chart with range switching and a crosshair tooltip. Everything is drawn on
   canvas in the site palette; direction is always labeled (▲/▼ and signed %),
   never color alone. */
const UP = '#35d07f', DOWN = '#ff5470', FLAT = '#999999';
let marketsOpen = false;
let detailSymbol = '^GSPC';
let detailRange = '1d';
let detailData = null;

function dirOf(pct) { return pct > 0.01 ? 'up' : pct < -0.01 ? 'down' : 'flat'; }
function colorOf(pct) { return pct > 0.01 ? UP : pct < -0.01 ? DOWN : FLAT; }
function chgHTML(pct) {
  const d = dirOf(pct);
  const arrow = d === 'up' ? '▲' : d === 'down' ? '▼' : '·';
  return `<span class="chg ${d}">${arrow} ${pct > 0 ? '+' : ''}${pct.toFixed(2)}%</span>`;
}

function setupCanvas(cv, cssW, cssH) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
  cv.style.width = `${cssW}px`; cv.style.height = `${cssH}px`;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/* each asset family gets its own hue; the line blends it into the up/down
   color so charts are colorful while direction stays labeled by the chips */
const KIND_HUE = {
  index: '#5b8cff', stock: '#f0abfc', crypto: '#f5b942',
  commodity: '#ff9e64', fx: '#4dd0e1',
};
function hueOf(kind) { return KIND_HUE[kind] || '#5b8cff'; }

function drawSpark(cv, values, pct, kind) {
  if (!values || values.length < 2) return;
  const W = 120, H = 36, pad = 2;
  const ctx = setupCanvas(cv, W, H);
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const x = (i) => pad + (i / (values.length - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
  const c = colorOf(pct), hue = hueOf(kind);
  const stroke = ctx.createLinearGradient(0, 0, W, 0);
  stroke.addColorStop(0, hue); stroke.addColorStop(1, c);
  ctx.beginPath();
  values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.shadowColor = c; ctx.shadowBlur = 6;
  ctx.strokeStyle = stroke; ctx.lineWidth = 1.75; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineTo(x(values.length - 1), H); ctx.lineTo(x(0), H); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, c + '3a'); g.addColorStop(0.55, hue + '14'); g.addColorStop(1, hue + '00');
  ctx.fillStyle = g; ctx.fill();
}

/* watchlist: starred symbols, persisted on-device */
const WATCH_KEY = 'meridian-watchlist';
function getWatch() { try { return JSON.parse(localStorage.getItem(WATCH_KEY)) || []; } catch { return []; } }
function toggleWatch(sym) {
  let w = getWatch();
  w = w.includes(sym) ? w.filter((s) => s !== sym) : [...w, sym].slice(0, 24);
  localStorage.setItem(WATCH_KEY, JSON.stringify(w));
  return w.includes(sym);
}
// pseudo-quotes for watchlist symbols outside the built-in instrument set
const extraQuotes = new Map();
async function loadExtraWatch() {
  const known = new Set(lastQuotes.map((q) => q.symbol));
  const need = getWatch().filter((s) => !known.has(s)).slice(0, 6);
  await Promise.allSettled(need.map(async (s) => {
    const r = await fetch(`/api/markets?symbol=${encodeURIComponent(s)}&range=1d`);
    const d = await r.json();
    if (!d.points || !d.points.length) return;
    const last = d.points[d.points.length - 1][1];
    const prev = d.prevClose ?? d.points[0][1];
    extraQuotes.set(d.symbol, {
      symbol: d.symbol, label: d.label, kind: d.kind || 'stock',
      price: last, prevClose: prev,
      changePct: prev ? Math.round(((last - prev) / prev) * 10000) / 100 : 0,
      spark: d.points.map((p) => p[1]).slice(-80),
    });
  }));
}

let gridKind = 'all';
function renderMarketGrid() {
  const grid = $('#mkt-grid');
  if (!grid || !lastQuotes.length) return;
  const watch = getWatch();
  const shown = gridKind === 'all' ? lastQuotes
    : gridKind === 'watch'
      ? [...lastQuotes, ...extraQuotes.values()].filter((q) => watch.includes(q.symbol))
      : lastQuotes.filter((q) => q.kind === gridKind);
  if (!shown.length && gridKind === 'watch') {
    grid.innerHTML = `<p class="empty">Nothing starred yet — tap the ★ on any instrument to build your watchlist.</p>`;
    return;
  }
  grid.innerHTML = shown.map((q) => `
    <button class="mkt-card${q.symbol === detailSymbol ? ' is-active' : ''}" data-sym="${esc(q.symbol)}">
      <div class="mkt-card-top">
        <span class="mkt-label">${esc(q.label)}</span>
        <span class="mkt-top-right">
          <span class="mkt-kind" style="color:${hueOf(q.kind)}">${esc(q.kind)}</span>
          <span class="wstar${watch.includes(q.symbol) ? ' on' : ''}" data-sym="${esc(q.symbol)}" role="button" tabindex="0" aria-label="Toggle watchlist" title="Watchlist">★</span>
        </span>
      </div>
      <canvas class="mkt-spark" width="120" height="36" aria-hidden="true"></canvas>
      <div class="mkt-card-bottom">
        <span class="mkt-price">${fmtPrice(q.price)}</span>
        ${chgHTML(q.changePct)}
      </div>
    </button>`).join('');
  grid.querySelectorAll('.mkt-card').forEach((card, i) => {
    drawSpark(card.querySelector('.mkt-spark'), shown[i].spark, shown[i].changePct, shown[i].kind);
    card.addEventListener('click', (e) => {
      const star = e.target.closest('.wstar');
      if (star) {
        e.stopPropagation();
        const on = toggleWatch(star.dataset.sym);
        star.classList.toggle('on', on);
        toast(on ? 'Added to watchlist' : 'Removed from watchlist');
        if (gridKind === 'watch') renderMarketGrid();
        return;
      }
      detailSymbol = card.dataset.sym;
      grid.querySelectorAll('.mkt-card').forEach((c) => c.classList.toggle('is-active', c === card));
      loadDetail();
    });
  });
}

function drawDetail() {
  const wrap = $('#mkt-chart-wrap'), cv = $('#mkt-chart');
  if (!wrap || !cv || !detailData || detailData.points.length < 2) return;
  const W = wrap.clientWidth, H = Math.max(220, Math.min(320, W * 0.4));
  const ctx = setupCanvas(cv, W, H);
  const pts = detailData.points;
  const vals = pts.map((p) => p[1]);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (detailData.prevClose && detailRange === '1d') {
    min = Math.min(min, detailData.prevClose); max = Math.max(max, detailData.prevClose);
  }
  const span = max - min || 1;
  min -= span * 0.06; max += span * 0.06;
  const padL = 8, padR = 64, padT = 12, padB = 22;
  const x = (i) => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  // recessive horizontal grid + right-side value labels
  ctx.font = '11px Arial'; ctx.fillStyle = '#999'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4, yy = y(v);
    ctx.strokeStyle = '#1c1c1c'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
    ctx.fillText(fmtPrice(v), W - padR + 8, yy);
  }
  // time labels
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
  const fmtT = (t) => detailRange === '1d'
    ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
  [0, Math.floor(pts.length / 2), pts.length - 1].forEach((i, k) => {
    ctx.textAlign = k === 0 ? 'left' : k === 1 ? 'center' : 'right';
    ctx.fillText(fmtT(pts[i][0]), x(i), H - 6);
  });
  ctx.textAlign = 'left';

  const first = detailRange === '1d' && detailData.prevClose ? detailData.prevClose : vals[0];
  const pct = first ? ((vals[vals.length - 1] - first) / first) * 100 : 0;
  const c = colorOf(pct);
  const hue = hueOf(detailData.kind);

  // previous-close reference (1D only)
  if (detailRange === '1d' && detailData.prevClose) {
    const yy = y(detailData.prevClose);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#333';
    ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
    ctx.setLineDash([]);
  }

  // area + line — colorful gradient stroke with a soft glow: brand blue
  // sweeps through the asset family's hue into the direction color.
  const stroke = ctx.createLinearGradient(padL, 0, W - padR, 0);
  stroke.addColorStop(0, '#4d5dff'); stroke.addColorStop(0.5, hue); stroke.addColorStop(1, c);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p[1])) : ctx.moveTo(x(i), y(p[1]))));
  ctx.shadowColor = c; ctx.shadowBlur = 14;
  ctx.strokeStyle = stroke; ctx.lineWidth = 2.25; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineTo(x(pts.length - 1), H - padB); ctx.lineTo(x(0), H - padB); ctx.closePath();
  const g = ctx.createLinearGradient(0, padT, 0, H - padB);
  g.addColorStop(0, c + '3d'); g.addColorStop(0.5, hue + '1c'); g.addColorStop(1, '#4d5dff00');
  ctx.fillStyle = g; ctx.fill();
  // last-price pulse dot
  const lx = x(pts.length - 1), ly = y(vals[vals.length - 1]);
  ctx.beginPath(); ctx.arc(lx, ly, 7, 0, Math.PI * 2); ctx.fillStyle = c + '2e'; ctx.fill();
  ctx.beginPath(); ctx.arc(lx, ly, 3.2, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();

  // header quote
  $('#mkt-detail-name').textContent = detailData.label;
  syncDetailWatch();
  $('#mkt-detail-price').textContent = `${fmtPrice(vals[vals.length - 1])} ${detailData.currency || ''}`;
  $('#mkt-detail-chg').outerHTML = chgHTML(Math.round(pct * 100) / 100).replace('class="chg', 'id="mkt-detail-chg" class="chg');

  // stash geometry for the crosshair
  detailData._geo = { x, y, W, H, padL, padR, padT, padB, c };
}

async function loadDetail() {
  if (!marketsOpen) return;
  try {
    const r = await fetch(`/api/markets?symbol=${encodeURIComponent(detailSymbol)}&range=${detailRange}`, { cache: 'no-store' });
    const data = await r.json();
    if (!data.points) return;
    detailData = data;
    drawDetail();
  } catch { /* keep previous chart */ }
}

/* crosshair + tooltip on the detail chart */
const chartWrap = $('#mkt-chart-wrap');
const tipEl = $('#mkt-tip');
chartWrap?.addEventListener('pointermove', (e) => {
  if (!detailData || !detailData._geo) return;
  const { x, y, W, H, padL, padR, padT, padB, c } = detailData._geo;
  const rect = chartWrap.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const pts = detailData.points;
  const i = Math.max(0, Math.min(pts.length - 1,
    Math.round(((mx - padL) / (W - padL - padR)) * (pts.length - 1))));
  drawDetail(); // redraw base, then overlay crosshair
  const ctx = $('#mkt-chart').getContext('2d');
  const cx = x(i), cy = y(pts[i][1]);
  ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, H - padB); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = c; ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
  const when = detailRange === '1d'
    ? new Date(pts[i][0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : new Date(pts[i][0]).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  tipEl.innerHTML = `<span class="tip-t">${when}</span><span class="tip-v">${fmtPrice(pts[i][1])}</span>`;
  tipEl.hidden = false;
  const tw = tipEl.offsetWidth;
  tipEl.style.left = `${Math.max(0, Math.min(W - tw, cx - tw / 2))}px`;
  tipEl.style.top = `${Math.max(0, cy - 44)}px`;
});
chartWrap?.addEventListener('pointerleave', () => { tipEl.hidden = true; if (detailData) drawDetail(); });

$('#mkt-ranges')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.rng'); if (!btn) return;
  detailRange = btn.dataset.range;
  document.querySelectorAll('.rng').forEach((b) => b.classList.toggle('is-active', b === btn));
  loadDetail();
});

/* movers: today's biggest stock gainers and losers, click to chart */
function moverHTML(q) {
  return `<button class="mover" data-sym="${esc(q.symbol)}">
    <span class="mover-name">${esc(q.label)}</span>
    <span class="mover-price">${fmtPrice(q.price)}</span>
    ${chgHTML(q.changePct)}
  </button>`;
}
function renderMovers() {
  const el = $('#mkt-movers');
  const stocks = lastQuotes.filter((q) => q.kind === 'stock');
  if (!el || stocks.length < 6) return;
  const sorted = [...stocks].sort((a, b) => b.changePct - a.changePct);
  el.innerHTML = `
    <div class="movers-col">
      <div class="movers-title">Top gainers</div>
      ${sorted.slice(0, 3).map(moverHTML).join('')}
    </div>
    <div class="movers-col">
      <div class="movers-title">Top losers</div>
      ${sorted.slice(-3).reverse().map(moverHTML).join('')}
    </div>`;
  el.querySelectorAll('.mover').forEach((b) =>
    b.addEventListener('click', () => selectSymbol(b.dataset.sym)));
}

function selectSymbol(sym) {
  detailSymbol = sym;
  document.querySelectorAll('.mkt-card').forEach((c) => c.classList.toggle('is-active', c.dataset.sym === sym));
  loadDetail();
  $('#mkt-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* instrument-type filter chips */
$('#mkt-filters')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-kind]'); if (!btn) return;
  gridKind = btn.dataset.kind;
  $('#mkt-filters').querySelectorAll('.rng').forEach((b) => b.classList.toggle('is-active', b === btn));
  if (gridKind === 'watch') await loadExtraWatch();
  renderMarketGrid();
});

/* watch star in the detail header follows the charted symbol */
const detailWatchBtn = $('#detail-watch');
function syncDetailWatch() {
  detailWatchBtn?.classList.toggle('on', getWatch().includes(detailSymbol));
}
detailWatchBtn?.addEventListener('click', () => {
  const on = toggleWatch(detailSymbol);
  syncDetailWatch();
  toast(on ? 'Added to watchlist' : 'Removed from watchlist');
  if (gridKind === 'watch') loadExtraWatch().then(renderMarketGrid);
});

/* ticker search: type a name or symbol, chart anything Yahoo knows */
const mktSearchInput = $('#mkt-search-input');
const mktResults = $('#mkt-results');
let mktSearchTimer = null;
function hideMktResults() { if (mktResults) mktResults.hidden = true; }
mktSearchInput?.addEventListener('input', () => {
  clearTimeout(mktSearchTimer);
  const q = mktSearchInput.value.trim();
  if (q.length < 2) { hideMktResults(); return; }
  mktSearchTimer = setTimeout(async () => {
    try {
      const r = await fetch(`/api/markets?search=${encodeURIComponent(q)}`);
      const data = await r.json();
      const list = (data.matches || []).slice(0, 6);
      if (!list.length) { hideMktResults(); return; }
      mktResults.innerHTML = list.map((m) => `
        <button class="mkt-result" data-sym="${esc(m.symbol)}">
          <span class="res-sym">${esc(m.symbol)}</span>
          <span class="res-name">${esc(m.name)}</span>
          <span class="res-exch">${esc(m.exch)}</span>
        </button>`).join('');
      mktResults.hidden = false;
      mktResults.querySelectorAll('.mkt-result').forEach((b) =>
        b.addEventListener('click', () => { selectSymbol(b.dataset.sym); hideMktResults(); mktSearchInput.value = b.dataset.sym; }));
    } catch { hideMktResults(); }
  }, 250);
});
$('#mkt-search')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const first = mktResults?.querySelector('.mkt-result');
  if (first) { first.click(); return; }
  const raw = mktSearchInput.value.trim().toUpperCase();
  if (raw) { selectSymbol(raw); hideMktResults(); }
});
document.addEventListener('click', (e) => { if (!e.target.closest('.mkt-search')) hideMktResults(); });

function showMarkets(on) {
  marketsOpen = on;
  document.body.classList.toggle('view-markets', on);
  $('#markets-view').hidden = !on;
  if (on) {
    if (typeof showVideos === 'function' && videosOpen) showVideos(false);
    if (lastQuotes.length) { renderMarketGrid(); renderMovers(); } else loadMarkets();
    loadDetail();
  }
}
addEventListener('resize', () => { if (marketsOpen && detailData) drawDetail(); }, { passive: true });

/* history strand tabs: Events / Births / Deaths */
$('#rail-tabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.rtab'); if (!btn) return;
  historyType = btn.dataset.type;
  document.querySelectorAll('.rtab').forEach((b) => b.classList.toggle('is-active', b === btn));
  loadHistory();
});

/* card actions: save-for-later + share (delegated; cards are links) */
feedEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('.act');
  if (!btn) {
    // Not an action button → a plain click opens the in-app reader. Modified
    // clicks (⌘/Ctrl/Shift/middle) still open the source in a new tab.
    const card = e.target.closest('.card');
    if (!card || card.classList.contains('skeleton')) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const idx = [...feedEl.querySelectorAll('.card')].indexOf(card);
    if (idx < 0 || !renderedList[idx]) return;
    e.preventDefault();
    openReaderFromFeed(idx);
    return;
  }
  e.preventDefault(); e.stopPropagation();
  if (btn.classList.contains('act-save')) {
    const a = currentArticles.find((x) => x.link === btn.dataset.link);
    if (!a) return;
    toggleSave(a);
    const on = isSaved(a.link);
    btn.classList.toggle('on', on);
    btn.querySelector('svg').setAttribute('fill', on ? 'currentColor' : 'none');
    btn.title = on ? 'Saved' : 'Save';
    toast(on ? 'Saved for later' : 'Removed from saved');
    if (currentCat === 'saved' && !on) loadNews('saved');
    return;
  }
  if (btn.classList.contains('act-share')) {
    const a = currentArticles.find((x) => x.link === btn.dataset.link) || { link: btn.dataset.link, title: btn.dataset.title };
    if (await shareArticle(a) === 'copied') {
      btn.classList.add('done');
      setTimeout(() => btn.classList.remove('done'), 1200);
    }
  }
});

/* reading progress bar */
const progressEl = $('#progress');
addEventListener('scroll', () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  if (progressEl) progressEl.style.width = `${max > 0 ? (scrollY / max) * 100 : 0}%`;
}, { passive: true });

/* ---------- video briefs: reel of clips that open directly on YouTube.
   No embedded player — embeds proved unreliable (pulled clips, extensions,
   pre-roll ads), so a click always opens the real thing in a new tab. ---------- */

/* Videos live in their own view (off the home page — YouTube embeds carry
   YouTube's own pre-roll ads, so they only load when deliberately opened). */
let videosOpen = false;
let reelLoaded = false;
function showVideos(on) {
  videosOpen = on;
  document.body.classList.toggle('view-videos', on);
  const reel = $('#reel');
  if (reel) reel.hidden = !on;
  if (on && !reelLoaded) loadVideos();
}

async function loadVideos() {
  const reel = $('#reel'), row = $('#reel-row');
  if (!reel || !row) return;
  try {
    const r = await fetch('/api/videos', { cache: 'no-store' });
    const data = await r.json();
    if (!data.videos || !data.videos.length) return;
    row.innerHTML = data.videos.map((v) => `
      <a class="vcard" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}"
         target="_blank" rel="noopener noreferrer" title="${esc(v.title)}">
        <span class="vthumb">
          <img src="${esc(v.thumbnail)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
          <span class="vplay" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>
          </span>
        </span>
        <span class="vtitle">${esc(v.title)}</span>
        <span class="vmeta">${esc(v.channel)} · ${timeAgo(v.publishedAt)} · YouTube ↗</span>
      </a>`).join('');
    reelLoaded = true;
    reel.hidden = !videosOpen;
  } catch { /* keep the reel hidden on failure */ }
}

/* ---------- story reader ----------
   Clicking a story opens it here — hero, headline, and a lead-in pulled by
   /api/read — instead of bouncing straight to the source. Prev/next walk the
   feed; every reader links out to finish at the original outlet. */
const reader = document.createElement('div');
reader.className = 'reader';
reader.hidden = true;
reader.innerHTML = `
  <div class="reader-backdrop" data-rclose></div>
  <article class="reader-panel" role="dialog" aria-modal="true" aria-label="Story reader">
    <header class="reader-bar">
      <button class="reader-btn reader-close" data-rclose aria-label="Close reader" title="Close (Esc)">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        <span>Close</span>
      </button>
      <div class="reader-steps">
        <button class="reader-btn reader-prev" aria-label="Previous story" title="Previous (←)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button class="reader-btn reader-next" aria-label="Next story" title="Next (→)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>
    </header>
    <div class="reader-scroll" id="reader-scroll"></div>
  </article>`;
document.body.appendChild(reader);
const readerScroll = $('#reader-scroll', reader);
let readerList = [];       // snapshot of the feed at open time — stable under background refreshes
let readerIndex = -1;
let readToken = 0;         // cancels a slow /api/read when the reader moves on
let readerLastFocus = null;
const readerOpen = () => !reader.hidden;

function renderReaderShell(a) {
  const hero = a.image
    ? `<div class="reader-hero"><img src="${esc(a.image)}" alt="" referrerpolicy="no-referrer" data-fallback="${gradientFor(a.title)}" /></div>`
    : `<div class="reader-hero noimg" style="background-image:${gradientFor(a.title)}"><span class="glyph">${esc((a.source || '?').trim().charAt(0).toUpperCase())}</span></div>`;
  const saved = isSaved(a.link);
  readerScroll.innerHTML = `
    ${hero}
    <div class="reader-content">
      <div class="reader-kicker"><span class="reader-src">${esc(a.source || 'Source')}</span><span class="dot-sep"></span><span>${timeAgo(a.publishedAt)}</span></div>
      <h1 class="reader-title">${esc(a.title)}</h1>
      <div class="reader-actions">
        <a class="reader-open" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">Read at ${esc(a.source || 'source')}
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M8 7h9v9"/></svg></a>
        <button class="reader-act reader-save${saved ? ' on' : ''}" aria-label="Save story"><svg viewBox="0 0 24 24" width="15" height="15" fill="${saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg><span>${saved ? 'Saved' : 'Save'}</span></button>
        <button class="reader-act reader-share" aria-label="Share story"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.7l6.8-4.4M8.6 13.3l6.8 4.4"/></svg><span>Share</span></button>
      </div>
      ${a.coverage && a.coverage.length ? `<div class="reader-coverage"><span class="cov-label">Also covering this</span>${a.coverage.map((c) => `<a href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">${esc(c.source)}</a>`).join('')}</div>` : ''}
      <div class="reader-body" id="reader-body">
        ${a.summary ? `<p>${esc(a.summary)}</p>` : ''}
        <p class="reader-status">Opening the full story…</p>
      </div>
    </div>`;
  readerScroll.scrollTop = 0;
}

function updateReaderNav() {
  $('.reader-prev', reader).disabled = readerIndex <= 0;
  $('.reader-next', reader).disabled = readerIndex >= readerList.length - 1;
}

const linkOut = (a, site) =>
  `<p class="reader-cont"><a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">Continue reading at ${esc(site || a.source || 'the source')} <span aria-hidden="true">↗</span></a></p>`;

/* Sharing a story shares a Meridian link (?read=<url>) that reopens it in the
   reader — so a share brings the reader back to Meridian, not straight to the
   outlet. The reader always links out to the source, so credit is preserved. */
function meridianShareUrl(article) {
  try {
    const u = new URL('/', location.origin);
    u.searchParams.set('read', article.link);
    if (article.title) u.searchParams.set('t', article.title.slice(0, 200)); // headline shows instantly, even if extraction fails
    return u.toString();
  } catch { return article.link; }
}
async function shareArticle(article) {
  const url = meridianShareUrl(article);
  try {
    if (navigator.share) { await navigator.share({ title: article.title || 'Meridian', url }); return 'shared'; }
    await navigator.clipboard.writeText(url);
    toast('Meridian link copied');
    return 'copied';
  } catch { return 'cancelled'; }
}

// Swap the reader hero from its gradient placeholder to a real image once the
// reader endpoint reports one (used for shared ?read= links with no feed data).
function swapReaderHero(src, a) {
  const hero = $('.reader-hero', reader);
  if (!hero) return;
  hero.classList.remove('noimg');
  hero.style.backgroundImage = '';
  hero.innerHTML = `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer" data-fallback="${gradientFor(a.title || a.link)}" />`;
}

async function showReader(index) {
  const a = readerList[index];
  if (!a) return;
  readerIndex = index;
  const token = ++readToken;
  updateReaderNav();
  renderReaderShell(a);
  try {
    const r = await fetch(`/api/read?url=${encodeURIComponent(a.link)}`);
    const d = await r.json();
    if (token !== readToken) return; // moved to another story
    // Shared links arrive with no feed metadata — backfill the header from the
    // reader endpoint so a standalone story still renders fully.
    if (d) {
      if (!a.title && d.title) {
        a.title = d.title;
        const h = $('.reader-title', reader); if (h) h.textContent = d.title;
      }
      if (!a.source && d.site) {
        a.source = d.site;
        const s = $('.reader-src', reader); if (s) s.textContent = d.site;
        const openA = $('.reader-open', reader);
        if (openA && openA.firstChild && openA.firstChild.nodeType === 3) openA.firstChild.textContent = `Read at ${d.site} `;
      }
      if (!a.image && d.image) { a.image = d.image; swapReaderHero(d.image, a); }
    }
    const body = $('#reader-body', reader);
    if (d && d.ok && d.paragraphs && d.paragraphs.length) {
      body.innerHTML = d.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('') + linkOut(a, d.site);
    } else {
      const s = $('.reader-status', body);
      if (s) s.outerHTML = linkOut(a);
    }
  } catch {
    if (token !== readToken) return;
    const s = $('.reader-status', reader);
    if (s) s.outerHTML = linkOut(a);
  }
}

// Open the reader for a bare URL (a shared ?read= link) with no feed context.
// An optional title (carried in the share link) shows instantly while the rest
// is fetched, and survives even when extraction can't run (e.g. GN redirects).
function openReaderFromUrl(url, title = '') {
  if (!/^https?:\/\//i.test(url)) return;
  readerList = [{ link: url, title: title || '', source: '', image: null, summary: '', publishedAt: null }];
  readerLastFocus = document.activeElement;
  if (reader.hidden) {
    reader.hidden = false;
    document.documentElement.classList.add('reader-lock');
  }
  showReader(0);
  $('.reader-close', reader)?.focus();
}

function openReaderFromFeed(idx) {
  readerList = renderedList.slice();          // stable snapshot
  if (!reader.hidden) return showReader(idx); // already open (unlikely) — just swap
  readerLastFocus = document.activeElement;
  reader.hidden = false;
  document.documentElement.classList.add('reader-lock');
  showReader(idx);
  $('.reader-close', reader)?.focus();
}

function closeReader() {
  if (reader.hidden) return;
  reader.hidden = true;
  readToken++; // drop any in-flight fetch
  document.documentElement.classList.remove('reader-lock');
  try { readerLastFocus?.focus(); } catch { /* gone */ }
}

reader.addEventListener('click', (e) => {
  if (e.target.closest('[data-rclose]')) { closeReader(); return; }
  if (e.target.closest('.reader-prev')) { if (readerIndex > 0) showReader(readerIndex - 1); return; }
  if (e.target.closest('.reader-next')) { if (readerIndex < readerList.length - 1) showReader(readerIndex + 1); return; }
  const a = readerList[readerIndex];
  if (!a) return;
  const save = e.target.closest('.reader-save');
  if (save) {
    toggleSave(a);
    const on = isSaved(a.link);
    save.classList.toggle('on', on);
    save.querySelector('svg').setAttribute('fill', on ? 'currentColor' : 'none');
    save.querySelector('span').textContent = on ? 'Saved' : 'Save';
    toast(on ? 'Saved for later' : 'Removed from saved');
    // keep the feed card's bookmark in sync
    const feedBtn = feedEl.querySelector(`.card[href="${CSS.escape(a.link)}"] .act-save`);
    if (feedBtn) { feedBtn.classList.toggle('on', on); feedBtn.querySelector('svg').setAttribute('fill', on ? 'currentColor' : 'none'); }
    if (currentCat === 'saved' && !on) { closeReader(); loadNews('saved'); }
    return;
  }
  if (e.target.closest('.reader-share')) { shareArticle(a); }
});

// hero image that 404s → its gradient fallback (mirrors the feed's handling,
// including the single cold-CDN retry before falling back)
reader.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  const wrap = img.closest('.reader-hero');
  if (!wrap) return;
  if (!img.dataset.retried) {
    img.dataset.retried = '1';
    const src = img.src;
    setTimeout(() => { if (img.isConnected) img.src = src; }, 1500);
    return;
  }
  wrap.classList.add('noimg'); wrap.style.backgroundImage = img.dataset.fallback || ''; img.remove();
}, true);

// Reader keys: Esc closes, ←/↑/k previous, →/↓/j next. Capture phase + swallow
// so the global tab shortcuts don't fire behind an open reader.
document.addEventListener('keydown', (e) => {
  if (!readerOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeReader(); }
  else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'k') { e.preventDefault(); e.stopImmediatePropagation(); if (readerIndex > 0) showReader(readerIndex - 1); }
  else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'j') { e.preventDefault(); e.stopImmediatePropagation(); if (readerIndex < readerList.length - 1) showReader(readerIndex + 1); }
  else if (k.length === 1 && /[a-z0-9/]/i.test(k)) { e.stopImmediatePropagation(); } // don't leak to tab shortcuts
}, true);

/* ---------- startup splash ---------- */
const bootEl = $('#boot');
let bootDone = false;
function hideBoot() {
  if (bootDone || !bootEl) return;
  bootDone = true;
  bootEl.classList.add('off');
  setTimeout(() => bootEl.remove(), 700);
}
setTimeout(hideBoot, 2600); // never hold the app hostage

/* PWA install */
let deferredPrompt = null;
const installBtn = $('#install');
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; installBtn.hidden = false; });
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; installBtn.hidden = true;
});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

/* manual refresh */
const refreshBtn = $('#refresh');
refreshBtn?.addEventListener('click', async () => {
  refreshBtn.classList.add('spinning');
  await Promise.all([loadNews(currentCat), loadMarkets()]);
  setTimeout(() => refreshBtn.classList.remove('spinning'), 400);
});

/* back-to-top */
const toTop = $('#to-top');
addEventListener('scroll', () => { toTop.hidden = scrollY < 600; }, { passive: true });
toTop?.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

/* boot — PWA shortcut URL params win, then the "open at launch" preference */
const bootTab = (() => {
  const p = new URLSearchParams(location.search);
  if (p.get('view') === 'markets') return 'markets';
  if (p.get('cat')) return p.get('cat');
  try { return (JSON.parse(localStorage.getItem('meridian-settings')) || {}).defaultTab; } catch { return null; }
})();
if (bootTab === 'markets' || bootTab === 'foryou' || bootTab === 'saved') {
  // defer one tick so features.js (loaded after this file) is ready
  setTimeout(() => {
    $(bootTab === 'markets' ? '.tab[data-view="markets"]' : `.tab[data-cat="${bootTab}"]`)?.click();
  }, 0);
}

// Shared story link (?read=<source url>&t=<title>) → open it in the reader.
// URLSearchParams already decodes, so the values are passed through as-is.
(() => {
  const params = new URLSearchParams(location.search);
  const shared = params.get('read');
  if (shared) { try { openReaderFromUrl(shared, params.get('t') || ''); } catch { /* malformed link */ } }
})();

loadNews('top');
loadHistory();
loadMarkets();
// Background timers idle out when the tab isn't visible — no wasted requests.
const onIdle = (fn, timeout) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, timeout));
setInterval(() => { if (!document.hidden) loadMarkets(); }, 60_000);
setInterval(() => { if (!document.hidden && reelLoaded) loadVideos(); }, 600_000);
onIdle(sweepNew, 2500);              // seed / populate per-tab "new" counts, off the critical path
setInterval(() => { if (!document.hidden) onIdle(sweepNew, 2000); }, 300_000); // keep them honest every 5 min
