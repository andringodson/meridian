/* Meridian — v2 features. Loaded after app.js (classic scripts share the
   global lexical scope, so app.js helpers like $, esc, loadNews, showMarkets
   are available here). Mobile shell, personalization, power tools. */
'use strict';

/* ---------- bottom navigation (phones) ---------- */
const bottomNav = $('#bottom-nav');

function setBottomActive(nav) {
  bottomNav?.querySelectorAll('.bn-item').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.nav === nav));
}

bottomNav?.addEventListener('click', (e) => {
  const btn = e.target.closest('.bn-item'); if (!btn) return;
  const nav = btn.dataset.nav;
  if (nav === 'videos') {
    // videos live on the home view — make sure we're there, then scroll
    if (marketsOpen) $('.tab[data-cat="top"]')?.click();
    setBottomActive('videos');
    setTimeout(() => $('#reel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    return;
  }
  setBottomActive(nav);
  if (nav === 'home') { $('.tab[data-cat="top"]')?.click(); scrollTo({ top: 0, behavior: 'smooth' }); }
  else if (nav === 'markets') $('.tab[data-view="markets"]')?.click();
  else if (nav === 'saved') $('.tab[data-cat="saved"]')?.click();
});

/* keep the bottom bar in sync when the user navigates via the top tabs */
$('#tabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab'); if (!tab) return;
  if (tab.dataset.view === 'markets') setBottomActive('markets');
  else if (tab.dataset.cat === 'saved') setBottomActive('saved');
  else setBottomActive('home');
});

/* ---------- swipe between categories (touch) ---------- */
const CAT_ORDER = ['top', 'world', 'business', 'technology', 'science', 'health', 'sports', 'entertainment'];
(() => {
  let sx = 0, sy = 0, swiping = false;
  const feed = $('#feed'); if (!feed) return;
  feed.addEventListener('touchstart', (e) => {
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; swiping = true;
  }, { passive: true });
  feed.addEventListener('touchend', (e) => {
    if (!swiping) return; swiping = false;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
    const i = CAT_ORDER.indexOf(currentCat); if (i === -1) return;
    const next = CAT_ORDER[(i + (dx < 0 ? 1 : -1) + CAT_ORDER.length) % CAT_ORDER.length];
    const tab = $(`.tab[data-cat="${next}"]`);
    tab?.click();
    tab?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, { passive: true });
})();

/* ---------- settings (persisted) + For You ---------- */
const SET_KEY = 'meridian-settings';
function getSettings() {
  try { return JSON.parse(localStorage.getItem(SET_KEY)) || {}; } catch { return {}; }
}
function saveSettings(patch) {
  const s = { ...getSettings(), ...patch };
  localStorage.setItem(SET_KEY, JSON.stringify(s));
  applySettings(s);
  return s;
}
function applySettings(s = getSettings()) {
  const root = document.documentElement;
  root.classList.toggle('ts-s', s.text === 's');
  root.classList.toggle('ts-l', s.text === 'l');
  root.classList.toggle('data-saver', !!s.datasaver);
  root.classList.toggle('reduce-motion', !!s.motion);
}
applySettings();

const SUGGESTED_TOPICS = ['AI', 'Space', 'Climate', 'Crypto', 'Football', 'Cricket', 'Elections', 'Movies'];
function getTopics() { return getSettings().topics || []; }

async function buildForYou() {
  const topics = getTopics();
  if (!topics.length) return [];
  const cats = ['top', 'world', 'business', 'technology', 'science', 'health', 'sports', 'entertainment'];
  const results = await Promise.allSettled(
    cats.map((c) => fetch(`/api/news?category=${c}`).then((r) => r.json()))
  );
  const seen = new Set(); const pool = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const a of r.value.articles || []) {
      if (!seen.has(a.link)) { seen.add(a.link); pool.push(a); }
    }
  }
  const terms = topics.map((t) => t.toLowerCase());
  return pool
    .map((a) => {
      const hay = (a.title + ' ' + (a.summary || '')).toLowerCase();
      let s = 0;
      for (const t of terms) if (hay.includes(t)) s += 2;
      if (s) s += recency(a) + (a.image ? 0.3 : 0);
      return { a, s };
    })
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, 60)
    .map((x) => x.a);
}

/* settings sheet UI */
const sheetEl = $('#settings-sheet');
const backdropEl = $('#sheet-backdrop');
function openSheet() {
  renderTopicChips();
  const s = getSettings();
  sheetEl.querySelectorAll('#set-text button').forEach((b) => b.classList.toggle('on', b.dataset.v === (s.text || 'm')));
  sheetEl.querySelectorAll('#set-default button').forEach((b) => b.classList.toggle('on', b.dataset.v === (s.defaultTab || 'top')));
  $('#set-datasaver').checked = !!s.datasaver;
  $('#set-motion').checked = !!s.motion;
  sheetEl.hidden = false; backdropEl.hidden = false;
}
function closeSheet() { sheetEl.hidden = true; backdropEl.hidden = true; }
$('#settings-btn')?.addEventListener('click', openSheet);
$('#sheet-close')?.addEventListener('click', closeSheet);
backdropEl?.addEventListener('click', closeSheet);

function renderTopicChips() {
  const wrap = $('#topic-chips'); if (!wrap) return;
  const mine = getTopics();
  const suggestions = SUGGESTED_TOPICS.filter((t) => !mine.includes(t));
  wrap.innerHTML =
    mine.map((t) => `<button class="tchip on" data-t="${esc(t)}">${esc(t)} ✕</button>`).join('') +
    suggestions.map((t) => `<button class="tchip" data-t="${esc(t)}">+ ${esc(t)}</button>`).join('');
  wrap.querySelectorAll('.tchip').forEach((b) =>
    b.addEventListener('click', () => {
      const t = b.dataset.t;
      const cur = getTopics();
      saveSettings({ topics: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] });
      renderTopicChips();
      if (currentCat === 'foryou') loadNews('foryou', { skeleton: false });
    }));
}
$('#topic-add')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#topic-input');
  const t = input.value.trim().replace(/\s+/g, ' ');
  if (!t) return;
  const cur = getTopics();
  if (!cur.some((x) => x.toLowerCase() === t.toLowerCase())) saveSettings({ topics: [...cur, t] });
  input.value = '';
  renderTopicChips();
});
$('#set-text')?.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  saveSettings({ text: b.dataset.v });
  $('#set-text').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
});
$('#set-default')?.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  saveSettings({ defaultTab: b.dataset.v });
  $('#set-default').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
});
$('#set-datasaver')?.addEventListener('change', (e) => {
  saveSettings({ datasaver: e.target.checked });
  applySearch(); // re-render cards with/without images
  toast(e.target.checked ? 'Data saver on' : 'Data saver off');
});
$('#set-motion')?.addEventListener('change', (e) => {
  saveSettings({ motion: e.target.checked });
});

/* ---------- command palette (Ctrl/Cmd+K) ---------- */
const palEl = $('#palette');
const palInput = $('#pal-input');
const palList = $('#pal-list');
let palIdx = 0;
let palTicker = null;

function openPalette() {
  if (!palEl) return;
  palEl.hidden = false;
  palInput.value = '';
  buildPalette('');
  palInput.focus();
}
function closePalette() { if (palEl) palEl.hidden = true; }

function palItem(icon, label, sub, action) {
  return { icon, label, sub, action };
}
function navItems(q) {
  const items = [];
  const cats = [['top', 'Top stories'], ['foryou', 'For You'], ['world', 'World'], ['business', 'Business'],
    ['technology', 'Technology'], ['science', 'Science'], ['health', 'Health'], ['sports', 'Sports'],
    ['entertainment', 'Culture'], ['saved', 'Saved stories']];
  for (const [cat, label] of cats) {
    if (!q || label.toLowerCase().includes(q)) {
      items.push(palItem('→', `Go to ${label}`, 'section', () => $(`.tab[data-cat="${cat}"]`)?.click()));
    }
  }
  if (!q || 'markets'.includes(q)) {
    items.push(palItem('→', 'Open Markets', 'section', () => $('.tab[data-view="markets"]')?.click()));
  }
  if (!q || 'settings'.includes(q)) items.push(palItem('⚙', 'Open Settings', 'panel', openSheet));
  return items;
}
function shortcutItems() {
  return [
    palItem('⌨', '/ — focus story search', 'shortcut', () => $('#search-input')?.focus()),
    palItem('⌨', '1–8 — switch category · m Markets · s Saved', 'shortcut', () => {}),
    palItem('⌨', 'Ctrl K — this palette · Esc — close overlays', 'shortcut', () => {}),
  ];
}
async function buildPalette(qRaw) {
  const q = qRaw.trim().toLowerCase();
  let items = [];
  if (q === '?') items = shortcutItems();
  else {
    items = navItems(q).slice(0, q ? 4 : 6);
    if (q) {
      const stories = currentArticles
        .filter((a) => (a.title + ' ' + a.source).toLowerCase().includes(q))
        .slice(0, 5)
        .map((a) => palItem('¶', a.title, a.source, () => window.open(a.link, '_blank', 'noopener')));
      items = [...items, ...stories];
    }
  }
  renderPalette(items);
  if (q.length >= 2 && q !== '?') {
    clearTimeout(palTicker);
    palTicker = setTimeout(async () => {
      try {
        const r = await fetch(`/api/markets?search=${encodeURIComponent(q)}`);
        const d = await r.json();
        if (palInput.value.trim().toLowerCase() !== q) return; // stale
        const ticks = (d.matches || []).slice(0, 4).map((m) =>
          palItem('▲', `${m.symbol} — ${m.name}`, 'chart', () => {
            $('.tab[data-view="markets"]')?.click();
            selectSymbol(m.symbol);
          }));
        if (ticks.length) renderPalette([...items, ...ticks]);
      } catch { /* offline */ }
    }, 220);
  }
}
let palItems = [];
function renderPalette(items) {
  palItems = items;
  palIdx = 0;
  palList.innerHTML = items.length ? items.map((it, i) => `
    <button class="pal-item${i === 0 ? ' active' : ''}" data-i="${i}">
      <span class="pal-ico">${it.icon}</span>
      <span class="pal-label">${esc(it.label)}</span>
      <span class="pal-sub">${esc(it.sub)}</span>
    </button>`).join('') : `<div class="pal-empty">No matches — try a headline word or a ticker.</div>`;
  palList.querySelectorAll('.pal-item').forEach((b) =>
    b.addEventListener('click', () => runPal(+b.dataset.i)));
}
function runPal(i) {
  const it = palItems[i];
  if (!it) return;
  closePalette();
  it.action();
}
function movePal(d) {
  if (!palItems.length) return;
  palIdx = (palIdx + d + palItems.length) % palItems.length;
  palList.querySelectorAll('.pal-item').forEach((b, i) => b.classList.toggle('active', i === palIdx));
  palList.querySelectorAll('.pal-item')[palIdx]?.scrollIntoView({ block: 'nearest' });
}
palInput?.addEventListener('input', () => buildPalette(palInput.value));
palInput?.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); movePal(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); movePal(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); runPal(palIdx); }
});
palEl?.addEventListener('click', (e) => { if (e.target === palEl) closePalette(); });

/* ---------- Morning Brief: templated 30-second digest ---------- */
const BRIEF_KEY = 'meridian-brief-dismissed';
const todayKey = () => new Date().toISOString().slice(0, 10);
$('#brief-close')?.addEventListener('click', () => {
  localStorage.setItem(BRIEF_KEY, todayKey());
  $('#brief').hidden = true;
});
function renderBrief() {
  const el = $('#brief'), grid = $('#brief-grid');
  if (!el || !grid) return;
  if (localStorage.getItem(BRIEF_KEY) === todayKey()) { el.hidden = true; return; }
  const heads = currentArticles.slice(0, 3);
  if (!heads.length) return;
  const h = new Date().getHours();
  $('#brief-greet').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';

  const stocks = lastQuotes.filter((q) => q.kind === 'stock');
  const sorted = [...stocks].sort((a, b) => b.changePct - a.changePct);
  const up = sorted[0], down = sorted[sorted.length - 1];
  const ev = lastHistory[0];

  grid.innerHTML = `
    <div class="brief-col">
      <div class="brief-label">Top headlines</div>
      ${heads.map((a) => `<a class="brief-item" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">
        <span class="brief-item-t">${esc(a.title)}</span><span class="brief-item-s">${esc(a.source)}</span></a>`).join('')}
    </div>
    <div class="brief-col">
      <div class="brief-label">Markets pulse</div>
      ${up ? `<button class="brief-item brief-mkt" data-sym="${esc(up.symbol)}"><span class="brief-item-t">${esc(up.label)}</span>${chgHTML(up.changePct)}</button>` : ''}
      ${down ? `<button class="brief-item brief-mkt" data-sym="${esc(down.symbol)}"><span class="brief-item-t">${esc(down.label)}</span>${chgHTML(down.changePct)}</button>` : ''}
      <div class="brief-note">Today's strongest and weakest of the big names.</div>
    </div>
    <div class="brief-col">
      <div class="brief-label">On this day</div>
      ${ev ? `<a class="brief-item" href="${esc(ev.url || '#')}" target="_blank" rel="noopener noreferrer">
        <span class="brief-item-t"><strong>${ev.year}</strong> — ${esc(String(ev.text).slice(0, 130))}</span></a>` : '<div class="brief-note">History is loading…</div>'}
    </div>`;
  grid.querySelectorAll('.brief-mkt').forEach((b) =>
    b.addEventListener('click', () => {
      $('.tab[data-view="markets"]')?.click();
      selectSymbol(b.dataset.sym);
    }));
  el.hidden = false;
}

/* ---------- Listen: spoken briefing of the loaded headlines ---------- */
(() => {
  const btn = $('#listen'), label = $('#listen-label');
  if (!btn || !('speechSynthesis' in window)) return;
  btn.hidden = false;
  let speaking = false;

  function highlight(link) {
    document.querySelectorAll('.card.reading').forEach((c) => c.classList.remove('reading'));
    if (!link) return;
    const card = document.querySelector(`.card[href="${CSS.escape(link)}"]`);
    if (card) { card.classList.add('reading'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
  function stopListen() {
    speechSynthesis.cancel();
    speaking = false;
    btn.classList.remove('on');
    label.textContent = 'Listen';
    highlight(null);
  }
  function marketLine() {
    const sp = lastQuotes.find((q) => q.symbol === '^GSPC');
    const bt = lastQuotes.find((q) => q.symbol === 'BTC-USD');
    const bits = [];
    if (sp) bits.push(`the S and P 500 is ${sp.changePct >= 0 ? 'up' : 'down'} ${Math.abs(sp.changePct).toFixed(1)} percent`);
    if (bt) bits.push(`Bitcoin is ${bt.changePct >= 0 ? 'up' : 'down'} ${Math.abs(bt.changePct).toFixed(1)} percent`);
    return bits.length ? `In the markets, ${bits.join(', and ')}.` : '';
  }
  btn.addEventListener('click', () => {
    if (speaking) { stopListen(); return; }
    const heads = currentArticles.slice(0, 8);
    if (!heads.length) return;
    speaking = true;
    btn.classList.add('on');
    label.textContent = 'Stop';
    const queue = [
      { text: `Here is your ${(CAT_LABEL[currentCat] || 'news').toLowerCase()} briefing from Meridian.`, link: null },
      ...heads.map((a, i) => ({ text: `${i + 1}. ${a.title}. From ${a.source}.`, link: a.link })),
    ];
    const mkt = marketLine();
    if (mkt) queue.push({ text: mkt, link: null });
    queue.push({ text: 'That was your briefing.', link: null });
    let qi = 0;
    const next = () => {
      if (!speaking || qi >= queue.length) { stopListen(); return; }
      const item = queue[qi++];
      const u = new SpeechSynthesisUtterance(item.text);
      u.rate = 1.03;
      u.onstart = () => highlight(item.link);
      u.onend = next;
      u.onerror = stopListen;
      speechSynthesis.speak(u);
    };
    next();
  });
  // switching sections mid-briefing stops it
  $('#tabs')?.addEventListener('click', () => { if (speaking) stopListen(); });
  addEventListener('beforeunload', () => speechSynthesis.cancel());
})();

/* ---------- global keyboard shortcuts ---------- */
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    palEl?.hidden === false ? closePalette() : openPalette();
    return;
  }
  if (e.key === 'Escape') { closePalette(); closeSheet(); return; }
  const typing = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || '') || e.ctrlKey || e.metaKey || e.altKey;
  if (typing) return;
  if (e.key === '/') { e.preventDefault(); $('#search-input')?.focus(); return; }
  if (e.key >= '1' && e.key <= '8') { $(`.tab[data-cat="${CAT_ORDER[+e.key - 1]}"]`)?.click(); return; }
  if (e.key === 'm') { $('.tab[data-view="markets"]')?.click(); return; }
  if (e.key === 's') { $('.tab[data-cat="saved"]')?.click(); return; }
  if (e.key === 'f') { $('.tab[data-cat="foryou"]')?.click(); return; }
});

/* ---------- pull-to-refresh (touch, from the very top) ---------- */
(() => {
  if (!matchMedia('(pointer: coarse)').matches) return;
  const ptr = document.createElement('div');
  ptr.className = 'ptr';
  ptr.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
  document.body.appendChild(ptr);
  let startY = 0, pull = 0, active = false, busy = false;
  addEventListener('touchstart', (e) => {
    if (scrollY > 2 || busy) return;
    startY = e.touches[0].clientY; active = true; pull = 0;
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (!active || busy) return;
    pull = Math.max(0, e.touches[0].clientY - startY);
    if (pull > 8 && scrollY <= 0) {
      const d = Math.min(pull * 0.45, 84);
      ptr.style.transform = `translate(-50%, ${d}px) rotate(${d * 3.2}deg)`;
      ptr.classList.toggle('ready', d >= 70);
      ptr.classList.add('show');
    }
  }, { passive: true });
  addEventListener('touchend', async () => {
    if (!active) return; active = false;
    const ready = ptr.classList.contains('ready');
    if (!ready) { ptr.classList.remove('show', 'ready'); ptr.style.transform = ''; return; }
    busy = true;
    ptr.classList.add('spin');
    try { await Promise.all([loadNews(currentCat, { skeleton: false }), loadMarkets()]); } catch { /* offline */ }
    if (typeof toast === 'function') toast('Refreshed');
    ptr.classList.remove('show', 'ready', 'spin');
    ptr.style.transform = '';
    busy = false;
  }, { passive: true });
})();
