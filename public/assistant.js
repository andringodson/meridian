/* Meridian — the news assistant.
 *
 * A grounded reader, not a chatbot. Every answer is built from what is actually
 * on the reader's screen: the headlines in the current feed, and the full text
 * of the story if one is open. Nothing is asked of the model that the supplied
 * material cannot answer, and the model is told to say so when it can't.
 *
 * The server route (api/ai.js) holds the key and talks to an open-weights model.
 * When no key is configured that route answers 503, and everything below falls
 * back to an extractive summariser that runs on the device — worse prose, same
 * information, and it works offline. The assistant is never simply "off".
 *
 * Classic script, like the rest of public/: it shares the global lexical scope
 * with app.js and features.js and reads their state directly.
 */
const Assistant = (() => {
  'use strict';

  const MAX_HEADLINES = 40;
  const MAX_HISTORY = 6;

  let panel = null, transcriptEl = null, inputEl = null, sendBtn = null, chipsEl = null, badgeEl = null;
  let open = false;
  let busy = false;
  let ctl = null;              // AbortController for the in-flight answer
  let history = [];            // [{ role, content }] — trimmed, sent for follow-ups
  let backend = null;          // { available, model } once probed; null until then

  /* ---------- context: what the reader is actually looking at ---------- */

  // The reader panel owns `readerList`/`readerIndex`/`readerParas` in app.js.
  function openStory() {
    if (typeof reader === 'undefined' || reader?.hidden) return null;
    const a = (typeof readerList !== 'undefined' && readerList[readerIndex]) || null;
    if (!a) return null;
    const paras = (typeof readerParas !== 'undefined' && readerParas) || [];
    return {
      title: a.title || '',
      source: a.source || '',
      publishedAt: a.publishedAt || '',
      text: paras.join('\n\n') || a.summary || '',
      link: a.link || '',
    };
  }

  /* The link and the standfirst ride along with the headline so the server can
     rank the feed against a question and fetch the few stories it turns out to
     be about — see the retrieval note in api/ai.js. Without the link there is
     nothing to fetch, and the assistant is answering from headlines alone. */
  function feedHeadlines() {
    const arts = (typeof currentArticles !== 'undefined' && currentArticles) || [];
    return arts.slice(0, MAX_HEADLINES).map((a) => ({
      title: a.title,
      source: a.source,
      link: a.link,
      summary: a.summary,
    }));
  }

  const topics = () => {
    try { return (typeof getTopics === 'function' ? getTopics() : []) || []; } catch { return []; }
  };
  const edition = () => {
    try { return (JSON.parse(localStorage.getItem('meridian-settings')) || {}).edition || 'us'; }
    catch { return 'us'; }
  };

  /* A reader's own provider key, if they supplied one. Sent per request to this
     app's own /api/ai, which uses it for that one upstream call and stores
     nothing — see the note in api/ai.js. It is never rendered back into the
     page: the settings field shows a mask, not the value. */
  const readerKey = () => {
    try { return (JSON.parse(localStorage.getItem('meridian-settings')) || {}).aiKey || ''; }
    catch { return ''; }
  };

  /* ---------- rendering ----------
     Model output is untrusted text. It is escaped first, then a deliberately
     small subset of markdown is re-introduced from the escaped string, so there
     is no path from a generated token to live markup. */
  function render(text) {
    const safe = esc(text);
    const blocks = [];
    let list = null;

    for (const raw of safe.split('\n')) {
      const line = raw.trim();
      if (!line) { if (list) { blocks.push(`<ul>${list}</ul>`); list = null; } continue; }

      const bullet = line.match(/^(?:[-*•]|\d+\.)\s+(.*)$/);
      if (bullet) { list = (list || '') + `<li>${inline(bullet[1])}</li>`; continue; }

      if (list) { blocks.push(`<ul>${list}</ul>`); list = null; }
      blocks.push(`<p>${inline(line)}</p>`);
    }
    if (list) blocks.push(`<ul>${list}</ul>`);
    return blocks.join('');
  }

  // **bold** and *italic* only — on already-escaped text.
  const inline = (s) => s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, '$1<em>$2</em>');

  function bubble(role, html, cls = '') {
    const div = document.createElement('div');
    div.className = `ai-msg ai-${role}${cls ? ` ${cls}` : ''}`;
    div.innerHTML = html;
    transcriptEl.appendChild(div);
    scrollDown();
    return div;
  }

  function scrollDown() {
    // Only chase the bottom if the reader is already there — scrolling back up
    // to re-read an answer should not be yanked forward by the next token.
    const nearBottom = transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight < 90;
    if (nearBottom) transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  /* ---------- suggestions, keyed to context ---------- */

  function suggestions() {
    const story = openStory();
    if (story) {
      return [
        ['Summarise this', { mode: 'summarize' }],
        ['Why does it matter?', { mode: 'explain' }],
        ['Who else is covering it?', { mode: 'ask', question: 'Which outlets in my feed are covering this same story, and do their accounts differ?' }],
      ];
    }
    const t = topics();
    const out = [
      ['Brief me on today', { mode: 'brief' }],
      ['What are outlets disagreeing on?', { mode: 'ask', question: 'Across the headlines in my feed, where do outlets appear to disagree or frame the same event differently?' }],
    ];
    if (t.length) {
      out.splice(1, 0, [`Anything on ${t[0]}?`, { mode: 'ask', question: `What is happening with ${t[0]} in my feed right now?` }]);
    }
    return out;
  }

  function renderChips() {
    if (!chipsEl) return;
    chipsEl.innerHTML = '';
    for (const [label, payload] of suggestions()) {
      const b = document.createElement('button');
      b.className = 'ai-chip';
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => ask(payload, label));
      chipsEl.appendChild(b);
    }
  }

  /* ---------- the panel ---------- */

  function build() {
    panel = document.createElement('section');
    panel.className = 'ai-panel';
    panel.id = 'ai-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', 'Meridian news assistant');
    panel.innerHTML = `
      <div class="ai-head">
        <div class="ai-title">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/><circle cx="19" cy="4.5" r="1.4"/></svg>
          <span>Assistant</span>
          <span class="ai-badge" id="ai-badge">checking…</span>
        </div>
        <div class="ai-head-actions">
          <button class="icon-btn" id="ai-clear" aria-label="Clear conversation" title="Clear conversation">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>
          <button class="icon-btn" id="ai-close" aria-label="Close assistant">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div class="ai-transcript" id="ai-transcript" aria-live="polite" aria-atomic="false"></div>
      <div class="ai-chips" id="ai-chips"></div>
      <form class="ai-composer" id="ai-composer">
        <textarea id="ai-input" rows="1" placeholder="Ask about the news on your screen…"
                  aria-label="Ask the assistant" maxlength="600" autocomplete="off"></textarea>
        <button class="ai-send" id="ai-send" type="submit" aria-label="Send">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15"/><path d="M13 6l6 6-6 6"/></svg>
        </button>
      </form>
      <p class="ai-foot">Answers are built only from the stories on your screen. Check anything that matters.</p>
    `;
    document.body.appendChild(panel);

    transcriptEl = $('#ai-transcript', panel);
    inputEl = $('#ai-input', panel);
    sendBtn = $('#ai-send', panel);
    chipsEl = $('#ai-chips', panel);
    badgeEl = $('#ai-badge', panel);

    $('#ai-close', panel).addEventListener('click', close);
    $('#ai-clear', panel).addEventListener('click', clear);
    $('#ai-composer', panel).addEventListener('submit', (e) => {
      e.preventDefault();
      const q = inputEl.value.trim();
      if (q) ask({ mode: 'ask', question: q }, q);
    });

    // Enter sends, Shift+Enter breaks the line; the box grows with the question.
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#ai-composer', panel).requestSubmit(); }
    });
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = `${Math.min(inputEl.scrollHeight, 120)}px`;
    });

    addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) close(); });
  }

  /* ---------- backend probe ---------- */

  let probing = null;     // in-flight probe, shared by concurrent callers

  async function probe() {
    if (backend) return backend;
    // Opening the panel probes, and asking immediately probes again — against a
    // cold serverless function that was two round trips where one would do.
    if (probing) return probing;
    probing = (async () => {
      try {
        const r = await fetch('/api/ai', { headers: { Accept: 'application/json' } });
        const info = r.ok ? await r.json() : { available: false, model: null };
        // A reader who brought their own key has a working backend even when
        // the deployment itself has none configured.
        if (!info.available && info.byok && readerKey()) info.available = true;
        return info;
      } catch {
        return { available: false, model: null };    // offline — on-device path still works
      }
    })();
    try {
      backend = await probing;
    } finally {
      probing = null;
    }
    if (badgeEl) {
      badgeEl.textContent = backend.available ? (backend.model || 'open model') : 'on-device';
      badgeEl.title = backend.available
        ? `Answers generated by ${backend.model}`
        : 'No model configured — falling back to on-device extraction';
    }
    return backend;
  }

  /* ---------- asking ---------- */

  async function ask(payload, label) {
    if (busy) return;
    // A comparison carries its own material and must not also drag in the open
    // story, or the lead outlet's text would be sent twice.
    const story = payload.cluster ? null : openStory();

    bubble('user', render(label || payload.question || 'Summarise this'));
    inputEl.value = '';
    inputEl.style.height = 'auto';

    busy = true;
    sendBtn.disabled = true;
    const out = bubble('bot', '<span class="ai-dots"><i></i><i></i><i></i></span>', 'is-streaming');

    const cfg = await probe();
    if (!cfg.available) { offline(out, payload, story); return; }

    ctl = new AbortController();
    let text = '';

    try {
      const mine = readerKey();
      const res = await fetch('/api/ai', {
        method: 'POST',
        signal: ctl.signal,
        headers: mine
          ? { 'Content-Type': 'application/json', 'X-AI-Key': mine }
          : { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: payload.mode || 'ask',
          question: payload.question || '',
          article: story,
          cluster: payload.cluster || undefined,
          provenance: payload.provenance || undefined,
          headlines: (story || payload.cluster) ? [] : feedHeadlines(),
          topics: topics(),
          edition: edition(),
          history: history.slice(-MAX_HISTORY),
        }),
      });

      if (!res.ok) {
        let err = {};
        try { err = await res.json(); } catch { /* not JSON */ }
        if (err.error === 'ai-unconfigured') { backend = { available: false, model: null }; offline(out, payload, story); return; }
        out.classList.remove('is-streaming');
        out.innerHTML = render(
          err.error === 'bad-key'
            ? (err.detail || 'That provider key was rejected. Check it in Settings.')
            : err.error === 'rate-limited'
              ? 'That’s more questions than the quota allows in a minute. Give it about a minute and ask again.'
              : 'The assistant couldn’t be reached just now — your connection, or the model host. Try again in a moment.'
        );
        finish();
        return;
      }

      // Streaming is the point: a 70B answer takes a couple of seconds and the
      // reader should watch it arrive rather than a spinner.
      if (res.body?.getReader) {
        const rd = res.body.getReader();
        const dec = new TextDecoder();
        let first = true;
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          text += dec.decode(value, { stream: true });
          if (first) { out.innerHTML = ''; first = false; }
          out.innerHTML = render(text);
          scrollDown();
        }
      } else {
        text = await res.text();
        out.innerHTML = render(text);
      }

      out.classList.remove('is-streaming');
      if (!text.trim()) out.innerHTML = render('No answer came back. Try rephrasing.');

      history.push({ role: 'user', content: label || payload.question || payload.mode });
      history.push({ role: 'assistant', content: text.slice(0, 1200) });
      history = history.slice(-MAX_HISTORY);
    } catch (e) {
      out.classList.remove('is-streaming');
      if (e?.name !== 'AbortError') out.innerHTML = render('That request failed partway through. Try again.');
    } finally {
      finish();
    }
  }

  function finish() {
    busy = false;
    ctl = null;
    if (sendBtn) sendBtn.disabled = false;
    renderChips();
    scrollDown();
  }

  /* ---------- on-device fallback ----------
     No key, no network, or the route said it isn't configured. Extractive, not
     generative: it selects the sentences that carry the most of the story rather
     than writing new ones. Where the semantic model is already loaded it scores
     against the story's own centroid; otherwise it falls back to term frequency,
     which is cruder but needs nothing at all. */

  const SENT = /[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g;

  function sentences(text) {
    return (String(text).match(SENT) || [])
      .map((s) => s.trim())
      .filter((s) => s.length > 45 && s.length < 400);
  }

  function extract(text, n = 4) {
    const sents = sentences(text);
    if (sents.length <= n) return sents;

    const semantic = typeof Embed !== 'undefined' && Embed.ready;
    let scored;

    if (semantic) {
      const vecs = sents.map((s) => Embed.embed(s));
      const centre = Embed.centroid(vecs);
      scored = sents.map((s, i) => ({ s, i, v: Embed.similarity(centre, vecs[i]) }));
    } else {
      const freq = new Map();
      const words = (s) => s.toLowerCase().match(/[a-z0-9']{4,}/g) || [];
      for (const s of sents) for (const w of words(s)) freq.set(w, (freq.get(w) || 0) + 1);
      scored = sents.map((s, i) => {
        const ws = words(s);
        const sum = ws.reduce((a, w) => a + (freq.get(w) || 0), 0);
        return { s, i, v: ws.length ? sum / Math.sqrt(ws.length) : 0 };   // length-normalised
      });
    }

    // Lead bias: news is written top-heavy, so an early sentence earns a nudge.
    return scored
      .map((x) => ({ ...x, v: x.v + Math.max(0, 1 - x.i / 12) * 0.15 }))
      .sort((a, b) => b.v - a.v)
      .slice(0, n)
      .sort((a, b) => a.i - b.i)      // restore reading order
      .map((x) => x.s);
  }

  function offline(out, payload, story) {
    out.classList.remove('is-streaming');
    const note = '<p class="ai-note">Generated on your device — no model is configured for this deployment.</p>';

    /* Without a model there is no reading of framing — but the provenance and
       the outlets' own lead sentences are facts already in hand, and laying
       them side by side is most of what "who is covering this" is asking. */
    if (payload.cluster) {
      const lines = payload.cluster.map((c) => {
        const prov = [c.country && c.country.toUpperCase(), c.ownership && `${c.ownership}-funded`]
          .filter(Boolean).join(', ');
        const lead = extract(c.text, 1)[0] || (c.title || '').trim();
        return `- **${c.source}**${prov ? ` (${prov})` : ''} — ${lead}`;
      });
      const head = `${payload.cluster.length} outlets, each opening the story its own way:`;
      const tail = payload.provenance ? `\n\n${payload.provenance}` : '';
      out.innerHTML = render(`${head}\n${lines.join('\n')}${tail}`) + note;
      finish();
      return;
    }

    if (story && story.text) {
      const points = extract(story.text, 4);
      out.innerHTML = points.length
        ? render(points.map((p) => `- ${p}`).join('\n')) + note
        : render('There isn’t enough extracted text from this story to summarise. Open it at the source.');
      finish();
      return;
    }

    const heads = feedHeadlines();
    if (heads.length) {
      const q = (payload.question || '').toLowerCase();
      const terms = q.match(/[a-z0-9']{4,}/g) || [];
      let picked = heads;
      if (terms.length) {
        const hit = heads.filter((h) => terms.some((t) => (h.title || '').toLowerCase().includes(t)));
        if (hit.length) picked = hit;
      }
      out.innerHTML = render(
        'Here’s what’s in your feed right now:\n' +
        picked.slice(0, 6).map((h) => `- ${h.title}${h.source ? ` — ${h.source}` : ''}`).join('\n')
      ) + note;
    } else {
      out.innerHTML = render('Nothing is loaded to work from yet. Give the feed a moment.');
    }
    finish();
  }

  /* ---------- open / close ---------- */

  function greet() {
    if (transcriptEl.children.length) return;
    const story = openStory();
    bubble('bot', render(
      story
        ? `Reading **${story.title || 'this story'}**. Ask me anything about it, or pick one below.`
        : 'I can only see the stories on your screen — ask about them, or start with one of these.'
    ), 'ai-greet');
  }

  const launcher = () => $('#ai-btn');

  function openPanel() {
    if (!panel) build();
    open = true;
    panel.hidden = false;
    document.body.classList.add('ai-open');
    launcher()?.setAttribute('aria-expanded', 'true');
    probe();
    greet();
    renderChips();
    // Not on a phone: a keyboard springing up over the transcript on open is
    // worse than one tap.
    if (innerWidth > 700) setTimeout(() => inputEl?.focus(), 60);
  }

  function close() {
    open = false;
    if (ctl) { ctl.abort(); ctl = null; }
    busy = false;
    if (sendBtn) sendBtn.disabled = false;
    if (panel) panel.hidden = true;
    document.body.classList.remove('ai-open');
    launcher()?.setAttribute('aria-expanded', 'false');
  }

  function clear() {
    history = [];
    if (transcriptEl) transcriptEl.innerHTML = '';
    greet();
    renderChips();
  }

  function toggle() { open ? close() : openPanel(); }

  /* Ask a specific thing and open the panel to show it — the reader's
     "Summarize" button routes through here. */
  function run(payload, label) {
    if (!open) openPanel();
    ask(payload, label);
  }

  /* Hand in accounts of one event from several newsrooms; app.js gathers them,
     along with a reading of how concentrated that set of newsrooms is. */
  function compare(cluster, provenance) {
    if (!Array.isArray(cluster) || cluster.length < 2) return;
    run({ mode: 'compare', cluster, provenance: provenance?.text || '' },
      `Compare how ${cluster.length} outlets are covering this`);
  }

  $('#ai-btn')?.addEventListener('click', toggle);

  // Lets Settings invalidate the cached probe when a key is added or removed.
  const resetBackend = () => { backend = null; };

  return { open: openPanel, close, toggle, run, compare, probe, resetBackend };
})();
