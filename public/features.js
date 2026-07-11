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
