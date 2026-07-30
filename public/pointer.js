/* Meridian — pointer response.
 *
 * Two effects, both driven from one rAF-throttled pointermove listener and both
 * expressed as custom properties the stylesheet reads. No library: each is a
 * few lines of arithmetic, and pulling in an animation engine to move a button
 * 4px would cost more than the whole feature.
 *
 * 1. Magnetic controls — a button leans toward the cursor as it approaches,
 *    then springs back. Applied only to small round controls, where the pull
 *    reads as responsiveness rather than drift.
 * 2. Spotlight — cards carry a soft radial wash centred on the cursor, so the
 *    grid lights up under the hand.
 *
 * Both are switched off wholesale for coarse pointers (a finger has no hover,
 * so the effect would only ever fire mid-tap) and for reduced motion. Neither
 * moves layout: transform and background only, so nothing here can trigger a
 * reflow no matter how fast the pointer moves.
 */
(function () {
  'use strict';

  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  // The reader's own setting is a class on <html>; honour it like the CSS does.
  const motionOff = () =>
    reduce.matches || document.documentElement.classList.contains('reduce-motion');

  let enabled = fine.matches && !motionOff();

  /* ---------- magnetic controls ---------- */

  const MAGNETIC = '.icon-btn, .to-top, .ai-send, .bn-item, .wx';
  const RADIUS = 58;     // px from centre at which the pull begins
  const PULL = 0.28;     // fraction of the offset the control travels

  let magnets = [];
  let held = new Set();  // controls currently displaced, so they can be released

  function collectMagnets() {
    magnets = enabled ? [...document.querySelectorAll(MAGNETIC)] : [];
  }

  function release(el) {
    el.style.transform = '';
    held.delete(el);
  }

  function magnetise(x, y) {
    for (const el of magnets) {
      if (!el.isConnected || el.hidden) { release(el); continue; }
      const r = el.getBoundingClientRect();
      if (!r.width) { release(el); continue; }
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = x - cx;
      const dy = y - cy;
      // Cheap rejection before the square root — most controls fail this.
      if (Math.abs(dx) > RADIUS + r.width || Math.abs(dy) > RADIUS + r.height) {
        if (held.has(el)) release(el);
        continue;
      }
      const dist = Math.hypot(dx, dy);
      const reach = RADIUS + Math.max(r.width, r.height) / 2;
      if (dist > reach) { if (held.has(el)) release(el); continue; }
      // Falls off with distance, so the control settles instead of snapping.
      const k = (1 - dist / reach) * PULL;
      el.style.transform = `translate(${(dx * k).toFixed(2)}px, ${(dy * k).toFixed(2)}px)`;
      held.add(el);
    }
  }

  function releaseAll() {
    for (const el of [...held]) release(el);
  }

  /* ---------- card spotlight ----------
     Only the card under the pointer is updated. Writing --mx/--my on every card
     in the grid each frame would be ~70 style invalidations a move for an
     effect that is, by definition, visible on one of them. */
  let lit = null;

  function spotlight(target, x, y) {
    const card = target?.closest?.('.card, .vcard, .mkt-card, .curator');
    if (card !== lit) {
      if (lit) lit.classList.remove('lit');
      lit = card || null;
      if (lit) lit.classList.add('lit');
    }
    if (!lit) return;
    const r = lit.getBoundingClientRect();
    lit.style.setProperty('--mx', `${(((x - r.left) / r.width) * 100).toFixed(1)}%`);
    lit.style.setProperty('--my', `${(((y - r.top) / r.height) * 100).toFixed(1)}%`);
  }

  /* ---------- the one listener ---------- */

  let px = 0, py = 0, target = null, ticking = false;

  function frame() {
    ticking = false;
    if (!enabled) return;
    magnetise(px, py);
    spotlight(target, px, py);
  }

  addEventListener('pointermove', (e) => {
    if (!enabled || e.pointerType !== 'mouse') return;
    px = e.clientX; py = e.clientY; target = e.target;
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(frame);
  }, { passive: true });

  // Leaving the window must not strand a control off-centre.
  addEventListener('pointerleave', releaseAll, { passive: true });
  addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  /* The control set changes constantly — the reader builds its own buttons, the
     assistant panel is created on first open. Re-collect on a settled DOM
     rather than querying every frame. */
  let rescan = null;
  const scheduleRescan = () => {
    if (rescan) return;
    rescan = setTimeout(() => { rescan = null; collectMagnets(); }, 200);
  };
  new MutationObserver(scheduleRescan).observe(document.body, { childList: true, subtree: true });

  function refresh() {
    const was = enabled;
    enabled = fine.matches && !motionOff();
    if (was && !enabled) { releaseAll(); if (lit) { lit.classList.remove('lit'); lit = null; } }
    collectMagnets();
  }

  fine.addEventListener?.('change', refresh);
  reduce.addEventListener?.('change', refresh);

  /* features.js toggles .reduce-motion on <html> from Settings, so the class
     list has to be watched — but app.js also toggles .chrome-hidden there on
     every change of scroll direction, and rescanning the whole document for
     controls on each of those was pure waste. Only act when the one class this
     cares about actually flips. */
  let wasReduced = motionOff();
  new MutationObserver(() => {
    const now = motionOff();
    if (now === wasReduced) return;
    wasReduced = now;
    refresh();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  collectMagnets();
})();
