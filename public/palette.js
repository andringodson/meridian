/* Meridian — the command palette.
 *
 * ⌘K / Ctrl-K. One box that reaches everything the app can do: sections, the
 * markets and video views, every setting that is a discrete choice, the stories
 * currently on screen, the watchlist, and the followed topics.
 *
 * The commands are rebuilt on each open rather than registered once, because
 * most of them are derived from state that moves — the loaded feed, the saved
 * queue, the watchlist. A registry would need invalidating from six places; a
 * rebuild costs a millisecond and cannot go stale.
 *
 * Matching is subsequence-based, the same shape editors use: "dkth" finds "Dark
 * theme". Scoring favours matches that start a word and that sit near the front
 * of the label, so short exact-ish hits beat long incidental ones.
 */
(() => {
  'use strict';

  const MAX_ROWS = 9;

  let el = null, inputEl = null, listEl = null;
  let open = false;
  let items = [];        // the filtered, scored, visible set
  let active = 0;
  let lastFocus = null;

  /* ---------- fuzzy match ---------- */

  /* Returns a score, or -1 for no match. Higher is better. */
  function score(needle, hay) {
    if (!needle) return 0;
    const n = needle.toLowerCase();
    const h = hay.toLowerCase();

    const direct = h.indexOf(n);
    if (direct !== -1) {
      // Contiguous hit: strongly preferred, more so at a word boundary.
      const boundary = direct === 0 || /[\s·—-]/.test(h[direct - 1]);
      return 1000 - direct * 2 + (boundary ? 60 : 0) - h.length * 0.2;
    }

    // Subsequence fallback: every character in order, gaps allowed.
    let i = 0, s = 0, prev = -1;
    for (let j = 0; j < h.length && i < n.length; j++) {
      if (h[j] !== n[i]) continue;
      const boundary = j === 0 || /[\s·—-]/.test(h[j - 1]);
      s += boundary ? 12 : 4;
      if (prev === j - 1) s += 6;      // adjacency is evidence of intent
      prev = j; i++;
    }
    if (i < n.length) return -1;
    return s - h.length * 0.15;
  }

  /* ---------- the command set ---------- */

  const settings = () => {
    try { return JSON.parse(localStorage.getItem('meridian-settings')) || {}; }
    catch { return {}; }
  };

  function build() {
    const out = [];
    const add = (group, label, run, hint) => out.push({ group, label, run, hint });

    // Sections. Reuses the tab buttons rather than duplicating their handlers,
    // so a section that changes behaviour changes here for free.
    document.querySelectorAll('#tabs .tab').forEach((tab) => {
      const name = tab.textContent.replace(/\d+$/, '').trim();
      add('Section', name, () => tab.click(), 'Go');
    });

    add('View', 'Back to top', () => scrollTo({ top: 0, behavior: 'smooth' }), 'Scroll');
    add('View', 'Refresh stories', () => document.getElementById('refresh')?.click(), 'Reload');
    add('View', 'Open settings', () => document.getElementById('settings-btn')?.click(), 'Open');
    add('View', 'Ask the assistant', () => (typeof Assistant !== 'undefined' ? Assistant.open() : null), 'Open');
    if (document.getElementById('listen') && !document.getElementById('listen').hidden) {
      add('View', 'Listen to the briefing', () => document.getElementById('listen').click(), 'Play');
    }

    // Appearance and text size — the discrete settings worth reaching by keyboard.
    const s = settings();
    for (const [v, name] of [['dark', 'Dark theme'], ['light', 'Light theme'], ['system', 'System theme']]) {
      add('Appearance', name, () => {
        if (typeof saveSettings === 'function') saveSettings({ theme: v });
        Theme.apply(v);
        toast(name + ' on');
      }, s.theme === v ? 'Current' : 'Set');
    }
    for (const [v, name] of [['s', 'Small text'], ['m', 'Medium text'], ['l', 'Large text']]) {
      add('Appearance', name, () => { saveSettings({ text: v }); toast(name); }, (s.text || 'm') === v ? 'Current' : 'Set');
    }

    for (const [v, name] of [['us', 'US'], ['gb', 'UK'], ['in', 'India'], ['au', 'Australia'], ['ca', 'Canada']]) {
      add('Edition', `${name} edition`, () => {
        document.querySelector(`#set-edition button[data-v="${v}"]`)?.click();
      }, (s.edition || 'us') === v ? 'Current' : 'Switch');
    }

    add('Setting', 'Toggle data saver', () => document.getElementById('set-datasaver')?.click(), s.datasaver ? 'On' : 'Off');
    add('Setting', 'Toggle reduced motion', () => document.getElementById('set-motion')?.click(), s.motion ? 'On' : 'Off');

    // Followed topics run a search — the fastest way back to a subject.
    for (const t of (s.topics || [])) {
      add('Topic', t, () => {
        const box = document.getElementById('search-input');
        if (!box) return;
        box.value = t;
        box.focus();
        box.form?.requestSubmit?.() ?? box.dispatchEvent(new Event('input', { bubbles: true }));
      }, 'Search');
    }

    // Watchlist tickers jump straight into the markets view.
    if (typeof getWatch === 'function') {
      for (const sym of getWatch().slice(0, 12)) {
        add('Watchlist', sym, () => {
          document.querySelector('.tab[data-view="markets"]')?.click();
          setTimeout(() => document.querySelector(`.mkt-card[data-symbol="${CSS.escape(sym)}"]`)?.click(), 220);
        }, 'Open');
      }
    }

    // Whatever is on screen right now, openable without hunting for it.
    const arts = (typeof currentArticles !== 'undefined' && currentArticles) || [];
    arts.slice(0, 40).forEach((a, i) => {
      add('Story', a.title, () => openReaderFromFeed(i), a.source || 'Read');
    });

    return out;
  }

  /* ---------- rendering ---------- */

  function filter(q) {
    const all = build();
    const scored = [];
    for (const it of all) {
      // Group name participates, so "story bank" and "edition uk" both work.
      const v = Math.max(score(q, it.label), score(q, `${it.group} ${it.label}`) - 40);
      if (v >= 0) scored.push({ it, v });
    }
    scored.sort((a, b) => b.v - a.v);
    items = scored.slice(0, MAX_ROWS).map((x) => x.it);
    active = 0;
    paint(q);
  }

  // Marks the matched characters without ever putting the query into markup.
  function markup(label, q) {
    const safe = esc(label);
    if (!q) return safe;
    const i = safe.toLowerCase().indexOf(esc(q).toLowerCase());
    if (i === -1) return safe;
    const n = esc(q).length;
    return `${safe.slice(0, i)}<mark>${safe.slice(i, i + n)}</mark>${safe.slice(i + n)}`;
  }

  function paint(q) {
    if (!items.length) {
      listEl.innerHTML = `<div class="cp-empty">Nothing matches “${esc(q)}”.</div>`;
      return;
    }
    listEl.innerHTML = items.map((it, i) => `
      <button class="cp-item${i === active ? ' active' : ''}" data-i="${i}" role="option" aria-selected="${i === active}">
        <span class="cp-group">${esc(it.group)}</span>
        <span class="cp-label">${markup(it.label, q)}</span>
        <span class="cp-hint">${esc(it.hint || '')}</span>
      </button>`).join('');
  }

  function move(delta) {
    if (!items.length) return;
    active = (active + delta + items.length) % items.length;
    paint(inputEl.value.trim());
    listEl.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    const it = items[i ?? active];
    if (!it) return;
    close();
    // After the palette is gone, so a command that focuses something wins.
    setTimeout(() => { try { it.run(); } catch { toast('That command failed'); } }, 0);
  }

  /* ---------- shell ---------- */

  function mount() {
    el = document.createElement('div');
    el.className = 'cp';
    el.id = 'palette';
    el.hidden = true;
    el.innerHTML = `
      <div class="cp-backdrop" data-close="1"></div>
      <div class="cp-box" role="dialog" aria-modal="true" aria-label="Command palette">
        <input id="cp-input" type="text" role="combobox" aria-expanded="true" aria-controls="cp-list"
               aria-autocomplete="list" placeholder="Jump to a section, story, setting…" autocomplete="off" spellcheck="false" />
        <div class="cp-list" id="cp-list" role="listbox"></div>
        <div class="cp-foot"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>↵</kbd> run · <kbd>esc</kbd> close</div>
      </div>`;
    document.body.appendChild(el);
    inputEl = el.querySelector('#cp-input');
    listEl = el.querySelector('#cp-list');

    inputEl.addEventListener('input', () => filter(inputEl.value.trim()));
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
    });
    listEl.addEventListener('click', (e) => {
      const b = e.target.closest('.cp-item');
      if (b) choose(+b.dataset.i);
    });
    // Hovering should move the selection, or the mouse and keyboard disagree.
    listEl.addEventListener('mousemove', (e) => {
      const b = e.target.closest('.cp-item');
      if (b && +b.dataset.i !== active) { active = +b.dataset.i; paint(inputEl.value.trim()); }
    });
    el.addEventListener('mousedown', (e) => { if (e.target.dataset.close) close(); });
  }

  function show() {
    if (!el) mount();
    lastFocus = document.activeElement;
    open = true;
    el.hidden = false;
    inputEl.value = '';
    filter('');
    inputEl.focus();
  }

  function close() {
    if (!open) return;
    open = false;
    el.hidden = true;
    try { lastFocus?.focus(); } catch { /* gone */ }
  }

  addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      open ? close() : show();
    }
  });

  // Exposed so the palette can be opened from a button or another feature.
  self.Palette = { show, close, get open() { return open; } };
})();
