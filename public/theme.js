/* Meridian — theme boot.
 *
 * Loaded *synchronously* in <head>, ahead of the stylesheet, because it decides
 * which palette the very first paint uses. Deferring it would show a black
 * screen to a light-theme reader for a frame or two, which is the flash every
 * theme switcher exists to avoid. It is its own file rather than an inline
 * <script> because the page ships `script-src 'self'` with no hash allowance —
 * an inline block would simply be refused.
 *
 * Three states are stored, not two. "system" is a live subscription: it follows
 * the OS for as long as it is selected, which is why the media query is kept
 * around after boot instead of being read once.
 *
 * The default is dark. Meridian's black canvas is the brand, and readers who
 * have never opened settings should not have the app change under them on the
 * morning this shipped — light is offered, not imposed.
 */
var Theme = (function () {
  'use strict';

  var KEY = 'meridian-settings';
  var DEFAULT = 'dark';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  /* Reads the same blob features.js owns, so the choice travels with the rest of
     the settings (export, sync, a manual wipe) instead of living in its own key. */
  function read() {
    try {
      var v = (JSON.parse(localStorage.getItem(KEY)) || {}).theme;
      return v === 'light' || v === 'dark' || v === 'system' ? v : DEFAULT;
    } catch (e) {
      return DEFAULT;   // private mode, corrupt JSON, storage disabled
    }
  }

  function resolve(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return mq && mq.matches ? 'light' : 'dark';
  }

  /* The single writer of the theme classes. Returns the mode it settled on so
     callers can react (the fluid background repaints on the result). */
  function apply(pref) {
    var mode = resolve(pref || read());
    var root = document.documentElement;
    root.classList.toggle('light', mode === 'light');
    root.classList.toggle('dark', mode === 'dark');

    // Browser chrome and the PWA task-switcher card follow the canvas.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'light' ? '#ffffff' : '#000000');

    // iOS reads this one for the status bar over a standalone window.
    var ios = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (ios) ios.setAttribute('content', mode === 'light' ? 'default' : 'black');

    try {
      root.dispatchEvent(new CustomEvent('themechange', { detail: { mode: mode } }));
    } catch (e) { /* CustomEvent unavailable — nothing downstream is required */ }

    return mode;
  }

  apply();

  /* Only "system" listens. A reader who picked a side keeps it when they change
     their OS at dusk. */
  if (mq) {
    var onChange = function () { if (read() === 'system') apply('system'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);   // Safari < 14
  }

  return { apply: apply, read: read, resolve: resolve };
})();
