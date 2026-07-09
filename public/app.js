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
let lastFetch = 0;
const REFRESH_MS = 90_000;

const CAT_LABEL = {
  top: 'Top stories', world: 'World', business: 'Business',
  technology: 'Technology', science: 'Science', health: 'Health',
  sports: 'Sports', entertainment: 'Culture', saved: 'Saved stories',
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

function cardHTML(a, lead, i) {
  const thumb = a.image
    ? `<div class="thumb"><img src="${esc(a.image)}" alt="" loading="lazy" decoding="async"
         referrerpolicy="no-referrer"
         onerror="this.parentElement.classList.add('noimg');this.parentElement.style.backgroundImage='${gradientFor(a.title)}';this.remove();" /></div>`
    : `<div class="thumb noimg" style="background-image:${gradientFor(a.title)}">
         <span class="glyph">${esc((a.source || '?').trim().charAt(0).toUpperCase())}</span>
       </div>`;
  const saved = isSaved(a.link);
  return `<a class="card${lead ? ' lead' : ''}${a.image ? ' has-img' : ''}" style="--i:${i}" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">
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
    </div>
  </a>`;
}

function renderFeed(list) {
  if (!list.length) { feedEl.innerHTML = `<p class="empty">No stories found.</p>`; return; }
  feedEl.innerHTML = list.map((a, i) => cardHTML(a, i === 0, i)).join('');
}

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

async function loadNews(cat, { skeleton = true } = {}) {
  currentCat = cat;
  stageTitle.textContent = CAT_LABEL[cat] || 'Stories';
  if (cat === 'saved') {
    currentArticles = getSaved();
    lastFetch = Date.now();
    applySearch();
    updatedEl.textContent = `${currentArticles.length} saved on this device`;
    if (!currentArticles.length) feedEl.innerHTML = `<p class="empty">Nothing saved yet — tap the bookmark on any story.</p>`;
    return;
  }
  if (skeleton) renderSkeleton();
  try {
    const r = await fetch(`/api/news?category=${encodeURIComponent(cat)}`, { cache: 'no-store' });
    const data = await r.json();
    currentArticles = data.articles || [];
    lastFetch = Date.now();
    applySearch();
    renderCurators(currentArticles);
    const t = new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    updatedEl.textContent = data.sources ? `${data.count} stories · ${data.sources} sources · ${t}` : `Updated ${t}`;
    setLive(true);
    hideBoot();
  } catch (e) {
    setLive(false);
    if (!currentArticles.length) feedEl.innerHTML = `<p class="empty">Couldn’t reach the news service. Retrying…</p>`;
  }
}

let historyType = 'events';
async function loadHistory() {
  try {
    const r = await fetch(`/api/wiki?type=${historyType}`, { cache: 'no-store' });
    const data = await r.json();
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

/* tabs — categories switch the feed; the Markets tab switches the whole view */
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab'); if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === btn));
  hidePeek();
  if (btn.dataset.view === 'markets') { showMarkets(true); return; }
  showMarkets(false);
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

/* self-updating: refresh on timer, and when the tab regains focus if stale */
setInterval(() => loadNews(currentCat, { skeleton: false }), REFRESH_MS);
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

let gridKind = 'all';
function renderMarketGrid() {
  const grid = $('#mkt-grid');
  if (!grid || !lastQuotes.length) return;
  const shown = gridKind === 'all' ? lastQuotes : lastQuotes.filter((q) => q.kind === gridKind);
  grid.innerHTML = shown.map((q) => `
    <button class="mkt-card${q.symbol === detailSymbol ? ' is-active' : ''}" data-sym="${esc(q.symbol)}">
      <div class="mkt-card-top">
        <span class="mkt-label">${esc(q.label)}</span>
        <span class="mkt-kind" style="color:${hueOf(q.kind)}">${esc(q.kind)}</span>
      </div>
      <canvas class="mkt-spark" width="120" height="36" aria-hidden="true"></canvas>
      <div class="mkt-card-bottom">
        <span class="mkt-price">${fmtPrice(q.price)}</span>
        ${chgHTML(q.changePct)}
      </div>
    </button>`).join('');
  grid.querySelectorAll('.mkt-card').forEach((card, i) => {
    drawSpark(card.querySelector('.mkt-spark'), shown[i].spark, shown[i].changePct, shown[i].kind);
    card.addEventListener('click', () => {
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
$('#mkt-filters')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-kind]'); if (!btn) return;
  gridKind = btn.dataset.kind;
  $('#mkt-filters').querySelectorAll('.rng').forEach((b) => b.classList.toggle('is-active', b === btn));
  renderMarketGrid();
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
  const btn = e.target.closest('.act'); if (!btn) return;
  e.preventDefault(); e.stopPropagation();
  if (btn.classList.contains('act-save')) {
    const a = currentArticles.find((x) => x.link === btn.dataset.link);
    if (!a) return;
    toggleSave(a);
    const on = isSaved(a.link);
    btn.classList.toggle('on', on);
    btn.querySelector('svg').setAttribute('fill', on ? 'currentColor' : 'none');
    btn.title = on ? 'Saved' : 'Save';
    if (currentCat === 'saved' && !on) loadNews('saved');
    return;
  }
  if (btn.classList.contains('act-share')) {
    const url = btn.dataset.link, title = btn.dataset.title;
    try {
      if (navigator.share) { await navigator.share({ title, url }); return; }
      await navigator.clipboard.writeText(url);
      btn.classList.add('done');
      setTimeout(() => btn.classList.remove('done'), 1200);
    } catch { /* user cancelled */ }
  }
});

/* reading progress bar */
const progressEl = $('#progress');
addEventListener('scroll', () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  if (progressEl) progressEl.style.width = `${max > 0 ? (scrollY / max) * 100 : 0}%`;
}, { passive: true });

/* ---------- video briefs: reel + lightbox player ---------- */
const vlight = $('#vlight'), vframe = $('#vframe');
function openVideo(id) {
  if (!vlight || !vframe) return;
  vframe.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0"
    title="Video player" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
  vlight.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeVideo() {
  if (!vlight) return;
  vframe.innerHTML = '';
  vlight.hidden = true;
  document.body.style.overflow = '';
}
$('#vclose')?.addEventListener('click', closeVideo);
vlight?.addEventListener('click', (e) => { if (e.target === vlight) closeVideo(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && vlight && !vlight.hidden) closeVideo(); });

async function loadVideos() {
  const reel = $('#reel'), row = $('#reel-row');
  if (!reel || !row) return;
  try {
    const r = await fetch('/api/videos', { cache: 'no-store' });
    const data = await r.json();
    if (!data.videos || !data.videos.length) return;
    row.innerHTML = data.videos.map((v) => `
      <button class="vcard" data-id="${esc(v.id)}" title="${esc(v.title)}">
        <span class="vthumb">
          <img src="${esc(v.thumbnail)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
          <span class="vplay" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>
          </span>
        </span>
        <span class="vtitle">${esc(v.title)}</span>
        <span class="vmeta">${esc(v.channel)} · ${timeAgo(v.publishedAt)}</span>
      </button>`).join('');
    row.querySelectorAll('.vcard').forEach((b) =>
      b.addEventListener('click', () => openVideo(b.dataset.id)));
    reel.hidden = false;
  } catch { /* keep the reel hidden on failure */ }
}

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

/* boot */
loadNews('top');
loadHistory();
loadMarkets();
loadVideos();
setInterval(loadMarkets, 60_000);
setInterval(loadVideos, 600_000);
