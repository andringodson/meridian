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
  setBottomActive(nav);
  if (nav === 'home') { $('.tab[data-cat="top"]')?.click(); scrollTo({ top: 0, behavior: 'smooth' }); }
  else if (nav === 'markets') $('.tab[data-view="markets"]')?.click();
  else if (nav === 'videos') $('.tab[data-view="videos"]')?.click();
  else if (nav === 'saved') $('.tab[data-cat="saved"]')?.click();
});

/* keep the bottom bar in sync when the user navigates via the top tabs */
$('#tabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab'); if (!tab) return;
  if (tab.dataset.view === 'markets') setBottomActive('markets');
  else if (tab.dataset.view === 'videos') setBottomActive('videos');
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
  syncInstallBtn();
  const s = getSettings();
  sheetEl.querySelectorAll('#set-text button').forEach((b) => b.classList.toggle('on', b.dataset.v === (s.text || 'm')));
  sheetEl.querySelectorAll('#set-default button').forEach((b) => b.classList.toggle('on', b.dataset.v === (s.defaultTab || 'top')));
  $('#set-datasaver').checked = !!s.datasaver;
  $('#set-motion').checked = !!s.motion;
  const nBox = $('#set-notify');
  if (nBox) nBox.checked = !!s.notify && 'Notification' in window && Notification.permission === 'granted';
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

/* ---------- story alerts: notifications + periodic background check ----------
   Opt-in only. With the app installed (Chrome/Edge), a periodic background
   sync lets the service worker check the top feed and notify while Meridian is
   closed; elsewhere the permission still enables the app-icon unread badge. */
$('#set-notify')?.addEventListener('change', async (e) => {
  const box = e.target;
  if (!box.checked) {
    saveSettings({ notify: false });
    try { (await navigator.serviceWorker.ready).periodicSync?.unregister('news-check'); } catch { /* fine */ }
    try { navigator.clearAppBadge?.(); } catch { /* fine */ }
    return;
  }
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    toast('Notifications aren’t supported in this browser');
    box.checked = false;
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toast('Notifications are blocked for this site');
    box.checked = false;
    return;
  }
  saveSettings({ notify: true });
  let background = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) {
      await reg.periodicSync.register('news-check', { minInterval: 60 * 60 * 1000 });
      background = true;
    }
  } catch { /* needs an installed app — foreground alerts still work */ }
  toast(background ? 'Alerts on — Meridian checks in the background' : 'Alerts on while Meridian is open');
});

/* ---------- app: install from settings + saved-stories export ----------
   `deferredPrompt` is app.js's captured beforeinstallprompt (shared scope). */
function syncInstallBtn() {
  const b = $('#set-install');
  if (b) b.hidden = !deferredPrompt;
}
$('#set-install')?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  syncInstallBtn();
});
addEventListener('appinstalled', () => { deferredPrompt = null; syncInstallBtn(); });

$('#set-export')?.addEventListener('click', () => {
  const list = getSaved();
  if (!list.length) { toast('Nothing saved yet — bookmark some stories first'); return; }
  const blob = new Blob(
    [JSON.stringify({ exportedAt: new Date().toISOString(), stories: list }, null, 2)],
    { type: 'application/json' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `meridian-saved-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`Exported ${list.length} ${list.length === 1 ? 'story' : 'stories'}`);
});

/* ---------- smart search: the topbar search box grows a dropdown with
   section jumps and ticker matches, while the feed live-filters as before ---------- */
const sdrop = document.createElement('div');
sdrop.className = 'sdrop';
sdrop.hidden = true;
$('#search')?.appendChild(sdrop);
let sdropItems = [];
let sdropIdx = -1;
let sdropTicker = null;

function sdItem(icon, label, sub, action) { return { icon, label, sub, action }; }
function sectionMatches(q) {
  const cats = [['top', 'Top stories'], ['foryou', 'For You'], ['world', 'World'], ['business', 'Business'],
    ['technology', 'Technology'], ['science', 'Science'], ['health', 'Health'], ['sports', 'Sports'],
    ['entertainment', 'Culture'], ['saved', 'Saved stories']];
  const items = [];
  for (const [cat, label] of cats) {
    if (label.toLowerCase().includes(q)) {
      items.push(sdItem('→', `Go to ${label}`, 'section', () => $(`.tab[data-cat="${cat}"]`)?.click()));
    }
  }
  if ('markets'.includes(q)) items.push(sdItem('→', 'Open Markets', 'section', () => $('.tab[data-view="markets"]')?.click()));
  if ('settings'.includes(q)) items.push(sdItem('⚙', 'Open Settings', 'panel', openSheet));
  return items.slice(0, 3);
}
function hideSdrop() { sdrop.hidden = true; sdropItems = []; sdropIdx = -1; }
function renderSdrop() {
  if (!sdropItems.length) { hideSdrop(); return; }
  sdropIdx = -1;
  sdrop.innerHTML = sdropItems.map((it, i) => `
    <button class="sd-item" data-i="${i}" type="button">
      <span class="sd-ico">${it.icon}</span>
      <span class="sd-label">${esc(it.label)}</span>
      <span class="sd-sub">${esc(it.sub)}</span>
    </button>`).join('');
  sdrop.hidden = false;
  sdrop.querySelectorAll('.sd-item').forEach((b) => {
    // pointerdown fires before the input loses focus — keeps the click alive
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => runSdrop(+b.dataset.i));
  });
}
function runSdrop(i) {
  const it = sdropItems[i];
  if (!it) return;
  hideSdrop();
  searchInput.value = '';
  applySearch();
  it.action();
}
function moveSdrop(d) {
  if (!sdropItems.length) return;
  sdropIdx = (sdropIdx + d + sdropItems.length) % sdropItems.length;
  sdrop.querySelectorAll('.sd-item').forEach((b, i) => b.classList.toggle('active', i === sdropIdx));
}
function updateSdrop() {
  const q = searchInput.value.trim().toLowerCase();
  if (q.length < 2) { hideSdrop(); return; }
  sdropItems = sectionMatches(q);
  renderSdrop();
  clearTimeout(sdropTicker);
  sdropTicker = setTimeout(async () => {
    try {
      const r = await fetch(`/api/markets?search=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (searchInput.value.trim().toLowerCase() !== q) return; // stale
      const ticks = (d.matches || []).slice(0, 4).map((m) =>
        sdItem('▲', `${m.symbol} — ${m.name}`, 'chart', () => {
          $('.tab[data-view="markets"]')?.click();
          selectSymbol(m.symbol);
        }));
      if (ticks.length) { sdropItems = [...sectionMatches(q), ...ticks]; renderSdrop(); }
    } catch { /* offline */ }
  }, 250);
}
searchInput?.addEventListener('input', updateSdrop);
searchInput?.addEventListener('keydown', (e) => {
  if (sdrop.hidden) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); moveSdrop(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveSdrop(-1); }
  else if (e.key === 'Enter' && sdropIdx >= 0) { e.preventDefault(); runSdrop(sdropIdx); }
  else if (e.key === 'Escape') { hideSdrop(); }
});
searchInput?.addEventListener('blur', () => setTimeout(hideSdrop, 150));

/* ---------- topbar clock ---------- */
(() => {
  const clock = $('#clock'); if (!clock) return;
  const tick = () => {
    const now = new Date();
    clock.textContent = `${now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };
  tick();
  setInterval(tick, 30_000);
})();

/* ---------- weather micro-widget (opt-in geolocation) ---------- */
(() => {
  const wx = $('#wx'); if (!wx) return;
  async function showWeather(lat, lon) {
    try {
      const r = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
      const d = await r.json();
      if (!isFinite(d.temp)) return;
      wx.textContent = `${d.icon} ${d.temp}${d.unit}`;
      wx.title = `${d.label} · updated ${new Date(d.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      wx.classList.add('has-data');
    } catch { /* keep previous */ }
  }
  function refresh() {
    const { wxLat, wxLon } = getSettings();
    if (isFinite(wxLat) && isFinite(wxLon)) showWeather(wxLat, wxLon);
  }
  wx.addEventListener('click', () => {
    const { wxLat, wxLon } = getSettings();
    if (isFinite(wxLat) && isFinite(wxLon)) { refresh(); return; }
    if (!navigator.geolocation) { toast('Location not available in this browser'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 100) / 100;
        const lon = Math.round(pos.coords.longitude * 100) / 100;
        saveSettings({ wxLat: lat, wxLon: lon });
        showWeather(lat, lon);
        toast('Weather on — location stays on this device');
      },
      () => toast('Location permission declined')
    );
  });
  refresh();
  setInterval(refresh, 900_000); // 15 min
})();

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
  if (e.key === 'Escape') { hideSdrop(); closeSheet(); return; }
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
