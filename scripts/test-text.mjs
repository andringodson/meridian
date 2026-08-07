/* Meridian — tests for the feed-field normalisers in api/_text.js, and for the
 * routes' tolerance of a feed item that is malformed rather than absent.
 *
 * These are the values that arrive from other people's publishing systems, so
 * the interesting cases are not the well-formed ones. A newsroom emitting a
 * pubDate its own CMS invented, or a title carrying a character reference
 * nobody decodes, must cost that one item at most — never the feed it came in,
 * and never the request.
 *
 *   npm run test:text
 */
import { XMLParser } from 'fast-xml-parser';
import { stripHtml, decodeEntities, safeLink, isoDate } from '../api/_text.js';
import { clusterStories } from '../api/news.js';

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(58)} ${detail}`);
};
const eq = (name, got, want) =>
  record(name, got === want, got === want ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

console.log('Meridian — feed field normalisation\n');

console.log('  character references');
eq('decimal reference', stripHtml('D&#038;D is getting crossovers'), 'D&D is getting crossovers');
eq('curly apostrophe', stripHtml('Apple&#8217;s sales grow'), 'Apple’s sales grow');
eq('paired curly quotes', stripHtml('a major &#8216;reset&#8217;'), 'a major ‘reset’');
eq('hex reference', stripHtml('&#x2019;hex'), '’hex');
eq('named reference', stripHtml('&hellip;and more'), '…and more');
eq('accented named reference', stripHtml('&eacute;lan'), 'élan');
eq('ampersand', stripHtml('A &amp; B'), 'A & B');
eq('double-encoded markup is not shown', stripHtml('&lt;p&gt;Text&lt;/p&gt;'), 'Text');
eq('tags separate words', stripHtml('<p>one</p><p>two</p>'), 'one two');
eq('script survives nothing', stripHtml('&lt;script&gt;alert(1)&lt;/script&gt;'), 'alert(1)');
eq('double-encoded ampersand', stripHtml('Womack &amp;amp; Womack'), 'Womack & Womack');
eq('double-encoded markup', stripHtml('&amp;lt;p&amp;gt;Text&amp;lt;/p&amp;gt;'), 'Text');
eq('unknown reference is left alone', stripHtml('keeps &notareference; intact'), 'keeps &notareference; intact');
eq('a bare ampersand is untouched', stripHtml('Tom & Jerry'), 'Tom & Jerry');
eq('AT&T is not a reference', stripHtml('AT&T; shares rise'), 'AT&T; shares rise');
eq('out-of-range code point is left alone', stripHtml('&#999999999999;'), '&#999999999999;');
eq('lone surrogate is left alone', stripHtml('&#xD800;'), '&#xD800;');
eq('whitespace collapses', stripHtml('  a \n\n  b '), 'a b');
eq('decodeEntities leaves markup alone', decodeEntities('<b>&amp;</b>'), '<b>&</b>');

console.log('\n  links');
eq('https passes', safeLink('https://example.com/a?b=1'), 'https://example.com/a?b=1');
eq('http passes', safeLink('http://example.com/'), 'http://example.com/');
eq('surrounding space is trimmed', safeLink('  https://example.com/x  '), 'https://example.com/x');
eq('javascript is refused', safeLink('javascript:alert(1)'), '');
eq('mixed-case javascript is refused', safeLink('JaVaScRiPt:alert(1)'), '');
eq('data is refused', safeLink('data:text/html,<script>alert(1)</script>'), '');
eq('vbscript is refused', safeLink('vbscript:msgbox(1)'), '');
eq('a non-URL is refused', safeLink('not a url'), '');
eq('empty is refused', safeLink(''), '');

console.log('\n  dates');
eq('RFC 822 parses', isoDate('Wed, 05 Aug 2026 10:00:00 GMT'), '2026-08-05T10:00:00.000Z');
eq('ISO parses', isoDate('2026-08-05T10:00:00Z'), '2026-08-05T10:00:00.000Z');
eq('prose is refused, not thrown', isoDate('yesterday afternoon'), null);
eq('an impossible date is refused', isoDate('Tue, 32 Feb 2026 99:99:99 GMT'), null);
eq('empty is null', isoDate(''), null);
eq('undefined is null', isoDate(undefined), null);

/* The regression this file exists for. One item with a pubDate its publisher
   invented used to throw RangeError out of the item mapper — which cost the
   whole feed in api/news.js, where the parse is wrapped and the failure
   silently drops that newsroom from the category, and cost the entire request
   in api/search.js, which answers 502. */
console.log('\n  a malformed item must not cost the feed');
const FEED = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title>Good story one</title><link>https://example.com/1</link><pubDate>Wed, 05 Aug 2026 10:00:00 GMT</pubDate></item>
  <item><title>Story with an invented date</title><link>https://example.com/2</link><pubDate>yesterday afternoon</pubDate></item>
  <item><title>Story with a hostile link</title><link>javascript:alert(1)</link><pubDate>Wed, 05 Aug 2026 09:30:00 GMT</pubDate></item>
  <item><title>Story with D&amp;#038;D in the title</title><link>https://example.com/4</link><pubDate>Wed, 05 Aug 2026 09:00:00 GMT</pubDate></item>
</channel></rss>`;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true, processEntities: false });
let items = [];
let threw = null;
try {
  const doc = parser.parse(FEED);
  items = (Array.isArray(doc.rss.channel.item) ? doc.rss.channel.item : [doc.rss.channel.item])
    .map((it) => ({
      title: stripHtml(it.title ?? ''),
      link: safeLink(it.link ?? ''),
      publishedAt: isoDate(it.pubDate),
      summary: '',
      source: 'Example',
      publisher: 'example.com',
    }));
} catch (e) { threw = `${e.constructor.name}: ${e.message}`; }

record('the mapper survives the whole feed', threw === null, threw || '');
record('the item with the invented date is kept, dated null',
  items[1]?.title === 'Story with an invented date' && items[1]?.publishedAt === null);
record('the hostile link is emptied so the item is dropped downstream',
  items[2]?.link === '');
/* The feed carries `D&amp;#038;D`, which is the double-encoding this whole file
   is about: the XML escape resolves to `&#038;`, and that is itself the HTML
   escape for an ampersand. Decoding only to `D&#038;D` is what put "D&#038;D is
   getting World of Warcraft crossovers" on the front page. */
record('a double-encoded reference in a title resolves fully',
  items[3]?.title === 'Story with D&D in the title', items[3]?.title);

// The route drops unusable items after mapping; the survivors must still cluster.
const usable = items.filter((a) => a.title && a.link && a.source);
record('three of four items survive', usable.length === 3, `${usable.length} usable`);
let clustered = null;
try { clustered = clusterStories(usable); } catch (e) { threw = String(e.message); }
record('clustering handles null publishedAt', Array.isArray(clustered) && clustered.length === 3,
  clustered ? `${clustered.length} groups` : threw);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
