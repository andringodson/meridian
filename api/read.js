// Meridian — reader endpoint.
// Fetches a story's page and extracts a clean lead-in: hero image, byline and
// the first few paragraphs, so stories open inside Meridian's calm reader
// instead of bouncing straight out. A short preview only — every reader links
// out to finish the piece at its original outlet. Cached at the edge so each
// page is pulled once and served fast.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0 Safari/537.36';

// Decode the entities a real page throws at us, then flatten any stray tags.
function clean(s = '') {
  return String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ''; } })
    .replace(/&amp;/g, '&')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…')
    .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/\s+/g, ' ')
    .trim();
}

// Read the first matching <meta property|name="…"> content value.
function meta(html, ...names) {
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tag = html.match(
      new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*>`, 'i'));
    if (tag) {
      const c = tag[0].match(/content=["']([^"']*)["']/i);
      if (c && c[1]) return clean(c[1]);
    }
  }
  return '';
}

// Lines that are furniture, not article prose.
const BOILER = /^(advertisement|sign up|subscribe|newsletter|cookie|related:|read more|follow us|share this|most read|watch:|listen:|photograph:|image:|credit:|getty|reuters|associated press|copyright|©|by\s+\w+\s+\w+\s*$)/i;

// Pull the first handful of real paragraphs out of the page.
function paragraphs(html) {
  // Prefer the <article> body; fall back to <body>, then the whole doc.
  let scope = html;
  const art = html.match(/<article[\s\S]*?<\/article>/i);
  if (art) scope = art[0];
  else {
    const body = html.match(/<body[\s\S]*?<\/body>/i);
    if (body) scope = body[0];
  }
  scope = scope
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<figure[\s\S]*?<\/figure>/gi, ' ')
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ');

  const out = [];
  for (const m of scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const t = clean(m[1]);
    if (t.length < 45) continue;                 // captions, bylines, links
    if (BOILER.test(t)) continue;
    if (/hide caption|\bgetty images\b/i.test(t)) continue; // photo-credit lines
    if (!/[.?!]/.test(t)) continue;              // prose has sentence punctuation
    const words = t.split(/\s+/);
    if (words.length < 8) continue;              // chips, labels, buttons
    // Jammed navigation ("HomeNewsSportWeather…") has huge "words" and no spaces.
    if (t.replace(/\s/g, '').length / words.length > 11) continue;
    if (!/[.?!"'’”)]$/.test(t) && t.length < 90) continue; // stubby fragments
    out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const url = String(req.query?.url || '');
  if (!/^https?:\/\//i.test(url)) {
    res.status(400).json({ ok: false, reason: 'bad-url' });
    return;
  }

  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }

  // Google News links are obfuscated redirects we can't unwrap server-side;
  // the client keeps its own summary and just links out.
  if (/news\.google\.|google\.[a-z.]+\/rss/i.test(url)) {
    res.setHeader('Cache-Control', 's-maxage=3600');
    res.status(200).json({ ok: false, reason: 'redirect' });
    return;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!/html/i.test(r.headers.get('content-type') || '')) throw new Error('not html');

    let html = await r.text();
    if (html.length > 800_000) html = html.slice(0, 800_000);
    const finalUrl = r.url || url;

    const paras = paragraphs(html);
    let total = 0;
    const kept = [];
    for (const p of paras) {
      if (total > 1500 && kept.length >= 3) break;   // a lead-in, not the article
      kept.push(p);
      total += p.length;
    }

    let image = meta(html, 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src');
    if (image && !/^https?:\/\//i.test(image)) {
      try { image = new URL(image, finalUrl).href; } catch { image = ''; }
    }
    let author = meta(html, 'author', 'article:author', 'og:article:author');
    if (/^https?:\/\//i.test(author) || author.length > 60) author = '';

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=86400, stale-if-error=86400');
    res.status(200).json({
      ok: kept.length > 0,
      url: finalUrl,
      site: meta(html, 'og:site_name') || host,
      title: meta(html, 'og:title', 'twitter:title'),
      image,
      author,
      published: meta(html, 'article:published_time', 'og:article:published_time', 'article:modified_time'),
      paragraphs: kept,
      truncated: kept.length < paras.length || paras.length >= 10,
    });
  } catch {
    res.setHeader('Cache-Control', 's-maxage=120');
    res.status(200).json({ ok: false, reason: 'fetch-failed' });
  } finally {
    clearTimeout(timer);
  }
}
