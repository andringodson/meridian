/* Meridian — read the open story aloud, word by word.
 *
 * `SpeechSynthesisUtterance` fires a `boundary` event as it reaches each word,
 * carrying a character offset into the text it was given. Speaking one
 * paragraph per utterance keeps that offset meaningful: it indexes straight
 * into that paragraph's own text node, so the spoken word can be located
 * exactly.
 *
 * The word is then painted with the CSS Custom Highlight API — a Range handed
 * to `CSS.highlights`, styled by `::highlight()`. Nothing is wrapped, split or
 * re-rendered, so the article's DOM is untouched while it reads and there is no
 * layout thrash sixty times a minute. Where the API is missing the paragraph
 * still highlights, which is the part that actually helps you keep your place.
 *
 * Voice quality is whatever the platform ships. This file is deliberately the
 * boring, free, zero-download half of the voice story — a neural model would be
 * tens of megabytes and is a separate, opt-in decision.
 */
const ReadAloud = (() => {
  'use strict';

  const SUPPORTED = 'speechSynthesis' in window;
  const CAN_PAINT = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';

  const RATES = [1, 1.25, 1.5, 0.85];

  let paras = [];          // [{ el, text, node }]
  let idx = -1;            // paragraph being spoken
  let speaking = false;
  let paused = false;
  let rate = 1;
  let keepAlive = null;
  let wordHl = null, paraHl = null;

  if (CAN_PAINT) {
    wordHl = new Highlight();
    paraHl = new Highlight();
    CSS.highlights.set('ra-word', wordHl);
    CSS.highlights.set('ra-para', paraHl);
  }

  const btn = () => document.querySelector('.reader-listen');
  const rateBtn = () => document.querySelector('.reader-rate');

  /* ---------- painting ---------- */

  function clearPaint() {
    if (CAN_PAINT) { wordHl.clear(); paraHl.clear(); }
    document.querySelectorAll('#reader-body p.ra-on').forEach((p) => p.classList.remove('ra-on'));
  }

  function paintParagraph(i) {
    clearPaint();
    const p = paras[i];
    if (!p) return;
    // The margin rule is unconditional — it is what keeps your place where the
    // Highlight API is missing, and it reads as a progress marker where it isn't.
    p.el.classList.add('ra-on');
    if (!CAN_PAINT || !p.node) return;
    const r = document.createRange();
    r.setStart(p.node, 0);
    r.setEnd(p.node, p.node.data.length);
    paraHl.add(r);
  }

  /* The event gives a start offset; `charLength` is not implemented everywhere,
     so the end of the word is recovered from the text itself when it is absent. */
  function paintWord(i, start, len) {
    const p = paras[i];
    if (!CAN_PAINT || !p?.node) return;
    const data = p.node.data;
    if (start >= data.length) return;

    let end = start + (len || 0);
    if (!len) {
      end = start;
      while (end < data.length && !/\s/.test(data[end])) end++;
    }
    if (end <= start) return;

    const r = document.createRange();
    r.setStart(p.node, start);
    r.setEnd(p.node, Math.min(end, data.length));
    wordHl.clear();
    wordHl.add(r);
    follow(r);
  }

  /* Keep the spoken line in view without fighting a reader who scrolls away:
     only nudge when the word has actually left the comfortable middle band. */
  function follow(range) {
    const scroller = document.getElementById('reader-scroll');
    if (!scroller) return;
    const box = range.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (!box.height) return;
    const top = view.top + view.height * 0.2;
    const bottom = view.top + view.height * 0.75;
    if (box.top >= top && box.bottom <= bottom) return;
    const smooth = !document.documentElement.classList.contains('reduce-motion') &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollBy({ top: box.top - (view.top + view.height * 0.35), behavior: smooth ? 'smooth' : 'auto' });
  }

  /* ---------- speaking ---------- */

  function collect() {
    const body = document.getElementById('reader-body');
    if (!body) return [];
    return [...body.querySelectorAll('p')]
      .filter((el) => !el.classList.contains('reader-status') && el.textContent.trim().length > 1)
      .map((el) => ({ el, text: el.textContent, node: el.firstChild?.nodeType === 3 ? el.firstChild : null }));
  }

  function setLabel(text, on) {
    const b = btn();
    if (!b) return;
    const span = b.querySelector('span');
    if (span) span.textContent = text;
    b.classList.toggle('on', !!on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /* Chrome on Android silently stops synthesis after ~15s. Poking pause/resume
     on a timer is the long-standing workaround; it is a no-op elsewhere. */
  function startKeepAlive() {
    stopKeepAlive();
    keepAlive = setInterval(() => {
      if (!speaking || paused) return;
      speechSynthesis.pause();
      speechSynthesis.resume();
    }, 9000);
  }
  function stopKeepAlive() { if (keepAlive) { clearInterval(keepAlive); keepAlive = null; } }

  function speakFrom(i) {
    if (!speaking) return;
    if (i >= paras.length) { stop(); toast('Finished reading'); return; }
    idx = i;
    paintParagraph(i);

    const u = new SpeechSynthesisUtterance(paras[i].text);
    u.rate = rate;
    u.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      paintWord(i, e.charIndex, e.charLength);
    };
    u.onend = () => speakFrom(i + 1);
    u.onerror = (e) => {
      // `interrupted` and `canceled` are what a deliberate stop looks like.
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      stop();
      toast('Speech stopped unexpectedly');
    };
    speechSynthesis.speak(u);
  }

  function start() {
    paras = collect();
    if (!paras.length) { toast('Nothing to read yet'); return; }
    speechSynthesis.cancel();          // clear anything the briefing left queued
    speaking = true;
    paused = false;
    setLabel('Pause', true);
    showRate(true);
    startKeepAlive();
    speakFrom(0);
  }

  function stop() {
    speaking = false;
    paused = false;
    stopKeepAlive();
    speechSynthesis.cancel();
    clearPaint();
    setLabel('Listen', false);
    showRate(false);
    idx = -1;
  }

  function toggle() {
    if (!SUPPORTED) { toast('This browser has no speech synthesis'); return; }
    if (!speaking) { start(); return; }
    if (paused) { speechSynthesis.resume(); paused = false; setLabel('Pause', true); }
    else { speechSynthesis.pause(); paused = true; setLabel('Resume', true); }
  }

  function showRate(on) {
    const r = rateBtn();
    if (r) r.hidden = !on;
  }

  /* Changing speed mid-sentence means re-speaking the current paragraph — the
     rate of an utterance already handed to the engine cannot be changed. */
  function cycleRate() {
    rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    const r = rateBtn();
    if (r) { const s = r.querySelector('span'); if (s) s.textContent = `${rate}×`; }
    if (speaking) {
      const resume = Math.max(0, idx);
      speechSynthesis.cancel();
      paused = false;
      setLabel('Pause', true);
      setTimeout(() => speakFrom(resume), 60);
    }
  }

  addEventListener('beforeunload', () => speechSynthesis.cancel());

  return {
    toggle, stop, cycleRate,
    get supported() { return SUPPORTED; },
    get speaking() { return speaking; },
  };
})();
