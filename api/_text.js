/* Meridian — feed markup to plain text.
 *
 * Every feed route parses XML with `processEntities: false`, because the large
 * aggregate feeds exceed fast-xml-parser's entity-expansion cap and get dropped
 * whole when it is on. That trade is deliberate, but it hands every route raw
 * character references and leaves decoding to the caller — and three callers
 * each grew their own partial version, all of which handled `&amp;` and none of
 * which handled `&#8217;`.
 *
 * The effect was visible on the front page: headlines reading "D&#038;D is
 * getting World of Warcraft crossovers" and "Apple&#8217;s iPhone sales keep
 * growing". Numeric references are what publishing systems actually emit —
 * WordPress encodes a plain ampersand as `&#038;` and a curly apostrophe as
 * `&#8217;` — so the one form nobody handled was the common one.
 *
 * This is the only implementation. It handles numeric references, hex
 * references, and the named entities that appear in news copy.
 */

/* Named references worth carrying. Not the full HTML set — that is 2,000-odd
   entries, nearly all of which are for mathematical and Greek characters that
   do not appear in a news headline. Anything outside this list is far more
   likely to arrive as a numeric reference, which is handled generically. */
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '‘', rsquo: '’', sbquo: '‚',
  ldquo: '“', rdquo: '”', bdquo: '„',
  hellip: '…', mdash: '—', ndash: '–', minus: '−',
  bull: '•', middot: '·', deg: '°',
  copy: '©', reg: '®', trade: '™',
  euro: '€', pound: '£', yen: '¥', cent: '¢',
  laquo: '«', raquo: '»', dagger: '†',
  frac12: '½', frac14: '¼', frac34: '¾',
  times: '×', divide: '÷', plusmn: '±',
  eacute: 'é', egrave: 'è', ecirc: 'ê',
  agrave: 'à', aacute: 'á', acirc: 'â', auml: 'ä', aring: 'å',
  iacute: 'í', oacute: 'ó', ouml: 'ö', oslash: 'ø',
  uacute: 'ú', uuml: 'ü', ccedil: 'ç', ntilde: 'ñ', szlig: 'ß',
  shy: '', zwj: '', zwnj: '', ensp: ' ', emsp: ' ', thinsp: ' ',
};

const REF = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

/* A reference that names a character we cannot produce is left exactly as it
   arrived rather than dropped. A headline that really does contain the literal
   text "&foo;" should keep it, and a malformed reference is better shown as
   itself than silently deleted. */
function decodeRef(match, ref) {
  if (ref[0] === '#') {
    const hex = ref[1] === 'x' || ref[1] === 'X';
    const cp = parseInt(hex ? ref.slice(2) : ref.slice(1), hex ? 16 : 10);
    if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return match;
    // Lone surrogates are not characters and String.fromCodePoint would produce
    // an unpaired one, which breaks JSON transport downstream.
    if (cp >= 0xd800 && cp <= 0xdfff) return match;
    // C0 controls carry no meaning in a headline and some of them (\r in
    // particular) would survive into a dedupe key and split it.
    if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a) return ' ';
    try { return String.fromCodePoint(cp); } catch { return match; }
  }
  const named = NAMED[ref] ?? NAMED[ref.toLowerCase()];
  return named === undefined ? match : named;
}

export const decodeEntities = (s = '') => String(s).replace(REF, decodeRef);

const TAG = /<[^>]*>/g;

/* Tags out, references decoded, whitespace collapsed.
 *
 * The second tag pass is not redundant. Feeds routinely double-encode, so a
 * description arrives as `&lt;p&gt;Text&lt;/p&gt;` — the first pass sees no
 * tags, decoding reveals them, and without the second pass the reader is shown
 * literal `<p>` markers. It is also the safer order: anything that decodes into
 * a tag is removed rather than passed on.
 *
 * Tags become a space rather than nothing, so `<p>one</p><p>two</p>` reads as
 * "one two" instead of "onetwo". The collapse below tidies up after it.
 */
export function stripHtml(s = '') {
  return decodeEntities(String(s).replace(TAG, ' '))
    .replace(TAG, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Feed-supplied links end up in an href. A feed is a third party, and `esc()`
   on the client escapes the delimiters but has no opinion about the scheme —
   so `javascript:…` would arrive intact inside an anchor that the reader is
   invited to click.
 *
 * Nothing observed in the wild does this; the point is that nothing in the
 * pipeline was checking, and the check is one line. Anything that is not plain
 * http(s) is refused rather than rewritten, so a link either works or is not
 * offered. */
export function safeLink(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  try {
    const p = new URL(s);
    return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : '';
  } catch {
    return '';
  }
}
