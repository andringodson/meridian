// Meridian — publisher identity and provenance.
//
// The same outlet reaches the feed under two different labels: direct RSS gives
// a hostname ("nytimes.com") while Google News gives a display name ("The New
// York Times"). Left alone they count as two publishers, so a cluster credits
// one outlet twice and the source tally overstates how many newsrooms actually
// covered a story. Everything is folded to one key here.
//
// `country` is where the newsroom is based; `ownership` is how it is funded.
// Both are matters of public record — deliberately NOT a left/right rating,
// which is contested and would mean shipping someone else's political
// judgement. Readers can draw their own conclusions from who pays for a
// newsroom and where it sits.
//
//   public      funded by the public or the state (licence fee, state budget)
//   nonprofit   non-commercial: a trust, foundation or member funding
//   private     commercially owned
//   government  a government body publishing directly, not a newsroom
//
// A leading underscore keeps this out of Vercel's route table.

export const PUBLISHERS = {
  'nytimes.com':           { name: 'The New York Times',      country: 'US', ownership: 'private' },
  'cbsnews.com':           { name: 'CBS News',                country: 'US', ownership: 'private' },
  'cbssports.com':         { name: 'CBS Sports',              country: 'US', ownership: 'private' },
  'npr.org':               { name: 'NPR',                     country: 'US', ownership: 'nonprofit' },
  'cnn.com':               { name: 'CNN',                     country: 'US', ownership: 'private' },
  'cnbc.com':              { name: 'CNBC',                    country: 'US', ownership: 'private' },
  'fortune.com':           { name: 'Fortune',                 country: 'US', ownership: 'private' },
  'statnews.com':          { name: 'STAT',                    country: 'US', ownership: 'private' },
  'wired.com':             { name: 'WIRED',                   country: 'US', ownership: 'private' },
  'theverge.com':          { name: 'The Verge',               country: 'US', ownership: 'private' },
  'techcrunch.com':        { name: 'TechCrunch',              country: 'US', ownership: 'private' },
  'arstechnica.com':       { name: 'Ars Technica',            country: 'US', ownership: 'private' },
  'engadget.com':          { name: 'Engadget',                country: 'US', ownership: 'private' },
  'gizmodo.com':           { name: 'Gizmodo',                 country: 'US', ownership: 'private' },
  'cnet.com':              { name: 'CNET',                    country: 'US', ownership: 'private' },
  'space.com':             { name: 'Space.com',               country: 'US', ownership: 'private' },
  'livescience.com':       { name: 'Live Science',            country: 'US', ownership: 'private' },
  'espn.com':              { name: 'ESPN',                    country: 'US', ownership: 'private' },
  'sports.yahoo.com':      { name: 'Yahoo Sports',            country: 'US', ownership: 'private' },
  'variety.com':           { name: 'Variety',                 country: 'US', ownership: 'private' },
  'deadline.com':          { name: 'Deadline',                country: 'US', ownership: 'private' },
  'hollywoodreporter.com': { name: 'The Hollywood Reporter',  country: 'US', ownership: 'private' },
  'rollingstone.com':      { name: 'Rolling Stone',           country: 'US', ownership: 'private' },
  'billboard.com':         { name: 'Billboard',               country: 'US', ownership: 'private' },
  'nasa.gov':              { name: 'NASA',                    country: 'US', ownership: 'government' },

  'bbc.co.uk':             { name: 'BBC News',                country: 'GB', ownership: 'public' },
  'theguardian.com':       { name: 'The Guardian',            country: 'GB', ownership: 'nonprofit' },
  'independent.co.uk':     { name: 'The Independent',         country: 'GB', ownership: 'private' },
  'news.sky.com':          { name: 'Sky News',                country: 'GB', ownership: 'private' },
  'skysports.com':         { name: 'Sky Sports',              country: 'GB', ownership: 'private' },

  'france24.com':          { name: 'France 24',               country: 'FR', ownership: 'public' },
  'dw.com':                { name: 'Deutsche Welle',          country: 'DE', ownership: 'public' },
  'aljazeera.com':         { name: 'Al Jazeera',              country: 'QA', ownership: 'public' },
  'cbc.ca':                { name: 'CBC',                     country: 'CA', ownership: 'public' },
};

export const OWNERSHIP_LABEL = {
  public: 'publicly funded',
  nonprofit: 'non-profit',
  private: 'commercial',
  government: 'government body',
};

export const COUNTRY_LABEL = {
  US: 'United States', GB: 'United Kingdom', FR: 'France',
  DE: 'Germany', QA: 'Qatar', CA: 'Canada',
};

// Feed subdomains that are not the brand's public host.
const HOST_FIX = [
  [/^feeds?\./, ''], [/^rss\./, ''], [/^www\./, ''],
  [/^feeds\.bbci\.co\.uk$/, 'bbc.co.uk'],
];

// An aggregator is a directory of other people's journalism — counting it as a
// publisher would credit Google for the newsroom's work.
export const AGGREGATOR = /(?:^|\.)news\.google\.com$|(?:^|\.)google\.com$/i;

const byName = new Map();
for (const [key, p] of Object.entries(PUBLISHERS)) byName.set(p.name.toLowerCase(), key);
// Display names Google News uses that differ from the brand above.
for (const [alias, key] of Object.entries({
  'bbc': 'bbc.co.uk', 'bbc news': 'bbc.co.uk', 'bbc sport': 'bbc.co.uk',
  'the new york times': 'nytimes.com', 'new york times': 'nytimes.com',
  'the guardian': 'theguardian.com', 'guardian': 'theguardian.com',
  'sky news': 'news.sky.com', 'sky sports': 'skysports.com',
  'al jazeera': 'aljazeera.com', 'al jazeera english': 'aljazeera.com',
  'deutsche welle': 'dw.com', 'dw': 'dw.com', 'dw news': 'dw.com',
  'the independent': 'independent.co.uk', 'independent': 'independent.co.uk',
  'npr': 'npr.org', 'cbs news': 'cbsnews.com', 'cbs sports': 'cbssports.com',
  'france 24': 'france24.com', 'ars technica': 'arstechnica.com',
  'the hollywood reporter': 'hollywoodreporter.com', 'yahoo sports': 'sports.yahoo.com',
})) byName.set(alias, key);

const normHost = (h) => {
  let out = String(h || '').toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  for (const [re, to] of HOST_FIX) out = out.replace(re, to);
  return out;
};

/**
 * Fold a raw source label (hostname OR display name) plus its link onto one
 * publisher. Returns null for aggregators, which must not be credited, and a
 * name-only record for outlets we hold no provenance for — an unknown publisher
 * still deserves its byline, it just adds nothing to the spread.
 */
export function identify(rawSource, link = '') {
  const raw = String(rawSource || '').trim();
  const linkHost = normHost((link.match(/^https?:\/\/([^/]+)/) || [])[1] || '');
  if (AGGREGATOR.test(linkHost) && !raw) return null;

  const asHost = normHost(raw);
  let key = PUBLISHERS[asHost] ? asHost
    : byName.get(raw.toLowerCase()) ||
      (PUBLISHERS[linkHost] ? linkHost : null);

  // Match a bare brand host against a longer one (news.bbc.co.uk → bbc.co.uk).
  if (!key) {
    const probe = asHost || linkHost;
    if (probe) key = Object.keys(PUBLISHERS).find((k) => probe === k || probe.endsWith('.' + k)) || null;
  }
  if (key) return { key, ...PUBLISHERS[key] };
  if (AGGREGATOR.test(asHost)) return null;
  if (!raw) return null;
  return { key: asHost || raw.toLowerCase(), name: raw, country: null, ownership: null };
}
