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
  sports: 'Sports', entertainment: 'Culture',
};

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

function cardHTML(a, lead) {
  const thumb = a.image
    ? `<div class="thumb"><img src="${esc(a.image)}" alt="" loading="lazy" decoding="async"
         referrerpolicy="no-referrer"
         onerror="this.parentElement.classList.add('noimg');this.parentElement.style.backgroundImage='${gradientFor(a.title)}';this.remove();" /></div>`
    : `<div class="thumb noimg" style="background-image:${gradientFor(a.title)}">
         <span class="glyph">${esc((a.source || '?').trim().charAt(0).toUpperCase())}</span>
       </div>`;
  return `<a class="card${lead ? ' lead' : ''}" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">
    ${thumb}
    <div class="card-body">
      <div class="headline">${esc(a.title)}</div>
      ${lead && a.summary ? `<div class="summary">${esc(a.summary)}</div>` : ''}
      <div class="meta">
        <span class="source">${esc(a.source || 'Source')}</span>
        <span class="dot-sep"></span>
        <span>${timeAgo(a.publishedAt)}</span>
      </div>
    </div>
  </a>`;
}

function renderFeed(list) {
  if (!list.length) { feedEl.innerHTML = `<p class="empty">No stories found.</p>`; return; }
  feedEl.innerHTML = list.map((a, i) => cardHTML(a, i === 0)).join('');
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
  if (skeleton) renderSkeleton();
  try {
    const r = await fetch(`/api/news?category=${encodeURIComponent(cat)}`, { cache: 'no-store' });
    const data = await r.json();
    currentArticles = data.articles || [];
    lastFetch = Date.now();
    applySearch();
    renderCurators(currentArticles);
    updatedEl.textContent = `Updated ${new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    setLive(true);
  } catch (e) {
    setLive(false);
    if (!currentArticles.length) feedEl.innerHTML = `<p class="empty">Couldn’t reach the news service. Retrying…</p>`;
  }
}

async function loadHistory() {
  try {
    const r = await fetch('/api/wiki', { cache: 'no-store' });
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

/* tabs */
$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab'); if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === btn));
  searchInput.value = '';
  loadNews(btn.dataset.cat);
});
$('#search').addEventListener('submit', (e) => e.preventDefault());

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
  return `<span class="tick">
    <span class="tick-label">${esc(q.label)}</span>
    <span class="tick-price">${fmtPrice(q.price)}</span>
    <span class="tick-chg ${dir}">${arrow} ${sign}${q.changePct.toFixed(2)}%</span>
  </span>`;
}
async function loadMarkets() {
  const track = document.getElementById('ticker-track');
  if (!track) return;
  try {
    const r = await fetch('/api/markets', { cache: 'no-store' });
    const data = await r.json();
    if (!data.quotes || !data.quotes.length) return;
    const one = data.quotes.map(tickHTML).join('');
    track.innerHTML = one + one; // duplicate for a seamless marquee loop
  } catch { /* leave prior ticker in place */ }
}

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

/* boot */
loadNews('top');
loadHistory();
loadMarkets();
setInterval(loadMarkets, 60_000);
