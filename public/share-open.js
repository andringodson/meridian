/* Meridian — move a person from a shared link into the app.
 *
 * /s exists so a crawler can read a story's own headline and photograph. A
 * person landing there should not see it at all, so this hands them straight to
 * the reader. It reads the target from its own page's query string, which is
 * what lets it be a same-origin file rather than an inline script: the site
 * ships `script-src 'self'` with no hash allowance, and an inline redirect
 * would simply be refused.
 *
 * replace() rather than assign(): the interstitial must not sit in history,
 * or Back from the story would land on it and bounce forward again.
 */
(function () {
  'use strict';
  try {
    var q = new URLSearchParams(location.search);
    var u = q.get('u');
    if (!u || !/^https?:\/\//i.test(u)) { location.replace('/'); return; }
    var t = q.get('t') || '';
    location.replace('/?read=' + encodeURIComponent(u) + (t ? '&t=' + encodeURIComponent(t) : ''));
  } catch (e) {
    // The visible "Open this story" link in the markup is the fallback.
  }
})();
