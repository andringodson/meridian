/* Meridian — translate the open story, on the device.
 *
 * Chrome ships `LanguageDetector` and `Translator` as built-in AI primitives:
 * local models, no key, no request, nothing leaving the machine. That makes
 * them the only translation option that fits this app — a cloud translator
 * would mean shipping every story a reader opens to a third party, which is
 * exactly what Meridian promises it does not do.
 *
 * Progressive enhancement in the strict sense: where the APIs are absent the
 * button never appears and nothing else changes. Where they are present but the
 * language pair is unsupported, the button also stays hidden — an offer to
 * translate that then fails is worse than no offer.
 *
 * The first use of a pair downloads a model (tens of MB, managed by the
 * browser, shared across every site). That is surfaced as progress on the
 * button rather than hidden, because it is the reader's bandwidth.
 */
const Translate = (() => {
  'use strict';

  const HAS_DETECTOR = typeof self.LanguageDetector !== 'undefined';
  const HAS_TRANSLATOR = typeof self.Translator !== 'undefined';
  const SUPPORTED = HAS_DETECTOR && HAS_TRANSLATOR;

  // Offered as targets. Availability is still checked per pair before the
  // button appears, so an unsupported combination is never advertised.
  const TARGETS = [
    ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'],
    ['pt', 'Português'], ['it', 'Italiano'], ['nl', 'Nederlands'], ['ru', 'Русский'],
    ['ar', 'العربية'], ['hi', 'हिन्दी'], ['bn', 'বাংলা'], ['ta', 'தமிழ்'],
    ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文'], ['tr', 'Türkçe'], ['vi', 'Tiếng Việt'],
  ];

  const LABEL = new Map(TARGETS);
  const translators = new Map();     // "fr->en" → Promise<Translator>
  let detector = null;

  let original = null;               // [{ el, html }] captured before replacing
  let translated = false;
  let busy = false;
  let detectedLang = null;

  const btn = () => document.querySelector('.reader-translate');

  /* The target follows the reader's edition-adjacent preference, defaulting to
     the browser's own language rather than assuming English. */
  function target() {
    try {
      const s = JSON.parse(localStorage.getItem('meridian-settings')) || {};
      if (s.translateTo) return s.translateTo;
    } catch { /* storage unavailable */ }
    const nav = (navigator.language || 'en').split('-')[0].toLowerCase();
    return LABEL.has(nav) ? nav : 'en';
  }

  const autoOn = () => {
    try { return !!(JSON.parse(localStorage.getItem('meridian-settings')) || {}).autoTranslate; }
    catch { return false; }
  };

  /* ---------- detection ---------- */

  function sampleText() {
    const body = document.getElementById('reader-body');
    if (!body) return '';
    const title = document.querySelector('.reader-title')?.textContent || '';
    const paras = [...body.querySelectorAll('p')]
      .filter((p) => !p.classList.contains('reader-status'))
      .slice(0, 3).map((p) => p.textContent).join(' ');
    return `${title} ${paras}`.trim().slice(0, 1200);
  }

  async function detect(text) {
    if (!HAS_DETECTOR || text.length < 40) return null;
    try {
      if (!detector) {
        const avail = await LanguageDetector.availability();
        if (avail === 'unavailable') return null;
        detector = await LanguageDetector.create();
      }
      const [best] = await detector.detect(text);
      // Below about 0.6 the guess is not worth acting on — a short English
      // story quoting a French official should not be offered as French.
      if (!best || best.confidence < 0.6) return null;
      return best.detectedLanguage?.split('-')[0]?.toLowerCase() || null;
    } catch {
      return null;
    }
  }

  /* ---------- translating ---------- */

  function pairKey(from, to) { return `${from}->${to}`; }

  async function getTranslator(from, to, onProgress) {
    const key = pairKey(from, to);
    if (translators.has(key)) return translators.get(key);
    const p = Translator.create({
      sourceLanguage: from,
      targetLanguage: to,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          // e.loaded is 0..1 in the shipped API.
          if (onProgress) onProgress(Math.round((e.loaded || 0) * 100));
        });
      },
    }).catch((err) => { translators.delete(key); throw err; });
    translators.set(key, p);
    return p;
  }

  function setLabel(text, on) {
    const b = btn();
    if (!b) return;
    const span = b.querySelector('span');
    if (span) span.textContent = text;
    b.classList.toggle('on', !!on);
    b.disabled = busy;
  }

  function capture() {
    const body = document.getElementById('reader-body');
    if (!body) return [];
    const nodes = [
      document.querySelector('.reader-title'),
      ...body.querySelectorAll('p'),
    ].filter((el) => el && !el.classList.contains('reader-status') && el.textContent.trim());
    return nodes.map((el) => ({ el, html: el.innerHTML, text: el.textContent }));
  }

  function restore() {
    if (!original) return;
    for (const o of original) { if (o.el.isConnected) o.el.innerHTML = o.html; }
    translated = false;
    setLabel(`Translate`, false);
  }

  async function run() {
    if (busy) return;
    if (translated) { restore(); return; }

    const to = target();
    const from = detectedLang;
    if (!from || from === to) return;

    busy = true;
    setLabel('Translating…', false);

    try {
      const tr = await getTranslator(from, to, (pct) => setLabel(`Downloading ${pct}%`, false));
      original = capture();
      if (!original.length) throw new Error('nothing to translate');

      // Sequential on purpose: the local model is one shared resource, and
      // firing forty paragraphs at it concurrently makes it slower, not faster.
      for (const o of original) {
        if (!o.el.isConnected) continue;
        const out = await tr.translate(o.text);
        if (out) o.el.textContent = out;
      }

      translated = true;
      setLabel(`Show original`, true);
      toast(`Translated from ${LABEL.get(from) || from.toUpperCase()}`);
    } catch (e) {
      setLabel('Translate', false);
      toast('Translation is unavailable for this story');
    } finally {
      busy = false;
      const b = btn();
      if (b) b.disabled = false;
    }
  }

  /* ---------- offered only when it will work ----------
     Called by app.js once a story's paragraphs have landed. */
  async function offer() {
    const b = btn();
    if (!b || !SUPPORTED) return;
    b.hidden = true;
    translated = false;
    original = null;
    detectedLang = null;

    const to = target();
    const from = await detect(sampleText());
    if (!from || from === to) return;

    try {
      const avail = await Translator.availability({ sourceLanguage: from, targetLanguage: to });
      if (avail === 'unavailable') return;
      detectedLang = from;
      const span = b.querySelector('span');
      if (span) span.textContent = 'Translate';
      b.setAttribute('title', `Translate from ${LABEL.get(from) || from} to ${LABEL.get(to) || to}`);
      b.hidden = false;
      // 'downloadable' means a first-use download; auto-translate should not
      // spend someone's data without them asking for this story specifically.
      if (autoOn() && avail === 'available') run();
    } catch { /* pair unsupported — stay hidden */ }
  }

  return {
    offer, run, restore,
    get supported() { return SUPPORTED; },
    get targets() { return TARGETS; },
    target,
  };
})();
