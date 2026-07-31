/* Meridian — lexical similarity over short news text.
 *
 * Two callers, one scoring model. api/news.js uses it to decide which items are
 * the same event; api/ai.js uses it to decide which of the reader's headlines a
 * question is actually about. Both are asking "how close are these two short
 * pieces of news text", and having them answer it differently would mean the
 * assistant retrieving a story the feed had already judged unrelated.
 *
 * Terms are weighted by inverse document frequency computed over the batch in
 * hand, not against a fixed list. That is the whole point: a stopword list is a
 * guess made in advance about which words carry no information, and it is wrong
 * on exactly the days that matter — "tariffs" is a distinguishing word most of
 * the time and pure noise on a day when forty headlines carry it. Computing it
 * per batch means the weighting is right on both days without anyone tuning it.
 *
 * There is no model here and nothing is downloaded. That is a real ceiling, not
 * a temporary one: this cannot see that "Fed holds rates steady" and "US central
 * bank leaves borrowing costs unchanged" are one event, because they share no
 * words. Closing that gap needs embeddings — public/embed.js already ships the
 * model on the client, and scripts/eval-cluster.mjs tracks the gap as
 * `paraphrase` recall so the size of the prize stays visible.
 */

/* Kept underneath the IDF weighting rather than replaced by it. A small batch
   can make an ordinary word look rare — twelve headlines that happen not to say
   "said" would hand the word a high weight — and these are words that never
   carry a story whatever the arithmetic says. */
const STOP = new Set((
  'the a an of to in on for and with as at by after over from is are be has ' +
  'have it its his her their new says say said will was were this that not ' +
  'no but up out how what why who more than into about amid against could would'
).split(' '));

/* Plural folding, for retrieval only.
 *
 * A reader asking about "the rate decision" should be handed a story headlined
 * "Fed holds rates steady", and without this they are not: `rate` and `rates`
 * are unrelated strings. It matters far more for a question than for a headline
 * pair — a question is five or six words, so one term lost to an -s is a large
 * fraction of everything there was to match on, while two headlines usually have
 * other terms in common to fall back on.
 *
 * Deliberately the crudest rule that works, not a stemmer. It only ever removes
 * a trailing s, and only where doing so is unlikely to change the word: not on
 * short words, and not on the -ss/-us/-is endings that are singular already
 * (business, virus, crisis). It will still mangle the occasional irregular, and
 * that costs a little ranking accuracy rather than any correctness — both sides
 * of every comparison are folded the same way. */
const foldPlural = (w) =>
  (w.length >= 5 && w.endsWith('s') && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w);

/* Unicode-aware. The obvious [^a-z0-9] form silently maps a headline in any
   non-Latin script to the empty string, which does not fail — it quietly
   produces a document with no terms that matches nothing and is matched by
   nothing.

   `minLen` is a noise filter, and the right setting differs by caller. At 4 it
   drops the short connectives that survive the stopword list, which is what
   clustering wants across a batch of full headlines. Retrieval passes 2,
   because a reader's question is a handful of words and the shortest of them
   are often the entire subject: EU, AI, UN, oil, war, Fed.

   Length is a crude proxy for "carries meaning" and it holds for alphabetic
   scripts. CJK, where a word is one or two characters, would need segmentation
   this does not attempt. */
export function sigTokens(text, minLen = 4, fold = false) {
  const set = new Set();
  const clean = String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!clean) return set;
  for (const w of clean.split(/\s+/)) {
    if (w.length >= minLen && !STOP.has(w)) set.add(fold ? foldPlural(w) : w);
  }
  return set;
}

/* A headline is the claim; a summary restates it in other words. The restating
   is exactly the evidence that is missing when two newsrooms word a headline
   differently, so it is worth having — but discounted, because a summary is
   longer and proportionally more of it is incidental vocabulary. */
const TITLE_W = 1;
const SUMMARY_W = 0.4;

export function weigh(doc, minLen = 4, fold = false) {
  const m = new Map();
  for (const w of sigTokens(doc?.title || '', minLen, fold)) m.set(w, TITLE_W);
  if (doc?.summary) {
    for (const w of sigTokens(doc.summary, minLen, fold)) if (!m.has(w)) m.set(w, SUMMARY_W);
  }
  return m;
}

/* tf-idf vectors for a batch, plus the cosine between any two of them.
 *
 * `minShared` exists because cosine alone will happily return a high score for
 * two documents whose only common term is rare — a single unusual word shared
 * by two short headlines can dominate both vectors. One coincidence is not a
 * shared story, so the caller says how many terms it wants to see agree. */
export function vectorSpace(docs, { minLen = 4, fold = false } = {}) {
  const n = docs.length;
  const local = docs.map((d) => weigh(d, minLen, fold));

  const df = new Map();
  for (const m of local) for (const w of m.keys()) df.set(w, (df.get(w) || 0) + 1);

  const vecs = local.map((m) => {
    const out = new Map();
    for (const [w, lw] of m) out.set(w, lw * Math.log((n + 1) / (df.get(w) + 0.5)));
    return out;
  });

  const norms = vecs.map((m) => {
    let s = 0;
    for (const v of m.values()) s += v * v;
    return Math.sqrt(s);
  });

  const cosine = (i, j, minShared = 2) => {
    const a = vecs[i], b = vecs[j];
    if (!a || !b) return 0;
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    let dot = 0, shared = 0;
    for (const [w, wa] of small) {
      const wb = big.get(w);
      if (wb === undefined) continue;
      dot += wa * wb;
      shared++;
    }
    if (shared < minShared) return 0;
    const d = norms[i] * norms[j];
    return d > 0 ? dot / d : 0;
  };

  return { local, df, vecs, norms, cosine };
}

/* Rank documents against a free-text query, best first.
 *
 * The query joins the batch as document zero rather than being scored against a
 * corpus built without it, so its own terms are weighted on the same footing as
 * everything else. With a handful of documents that shifts IDF slightly; the
 * alternative — a query whose terms have no document frequency at all — is
 * worse, because every term in it would look equally rare. */
export function rank(query, docs, { limit = 5, minLen = 2, minShared = 1, fold = true } = {}) {
  if (!query || !docs?.length) return [];
  const space = vectorSpace([{ title: query }, ...docs], { minLen, fold });
  return docs
    .map((_, i) => ({ index: i, score: space.cosine(0, i + 1, minShared) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
