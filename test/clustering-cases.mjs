/* Meridian — labelled cases for same-story clustering.
 *
 * clusterStories() in api/news.js decides which items are one event. That
 * decision is load-bearing twice over: it is what turns five near-identical
 * cards into one card with its breadth visible, and it is what the cross-outlet
 * compare feature is handed. Until this file existed, every change to it was a
 * judgement call — this makes it a measurement.
 *
 * Each group below is one real event as several newsrooms would file it. The
 * `kind` says what the group is testing, so the report can separate "this needs
 * a better algorithm" from "this needs a semantic model":
 *
 *   lexical    — outlets landed on similar wording. Token overlap should find
 *                these, and a regression here is a plain bug.
 *   paraphrase — the same event described in words that barely intersect.
 *                Overlap cannot see these; they are the standing argument for
 *                embedding-based clustering, and are expected to fail until
 *                that lands. Tracked so the gain is visible when it does.
 *   trap       — must NOT merge with its neighbours here. Every trap sits next
 *                to a group it shares vocabulary with, because that is when
 *                clustering actually goes wrong: two tariff stories, two
 *                Manchester United stories, two model launches.
 *   singleton  — an ordinary unrelated story. These exist so precision is
 *                measured against a realistic feed rather than a page of
 *                near-duplicates.
 *
 * Headlines are written for this fixture rather than copied from any outlet's
 * wire. The publishers are real because clustering keys on publisher identity,
 * and the pairing of outlet to story is arbitrary.
 */

export const GROUPS = [
  {
    id: 'fed-rates',
    kind: 'paraphrase',
    note: 'Two outlets converge on "holds interest rates steady"; the other two ' +
          'describe the same decision without reusing a single significant word.',
    articles: [
      { publisher: 'cnbc.com', source: 'CNBC', title: 'Fed holds interest rates steady for a third straight meeting' },
      { publisher: 'npr.org', source: 'NPR', title: 'Federal Reserve holds interest rates steady, citing cooling inflation' },
      { publisher: 'bbc.co.uk', source: 'BBC News', title: 'US central bank leaves borrowing costs unchanged' },
      { publisher: 'nytimes.com', source: 'The New York Times', title: 'Powell signals patience as the Fed pauses rate rises again' },
    ],
  },
  {
    id: 'japan-quake',
    kind: 'lexical',
    articles: [
      { publisher: 'cnn.com', source: 'CNN', title: 'Magnitude 6.8 earthquake strikes off northern Japan' },
      { publisher: 'news.sky.com', source: 'Sky News', title: 'Strong earthquake strikes northern Japan, tsunami advisory issued' },
      { publisher: 'theguardian.com', source: 'The Guardian', title: 'Tsunami advisory issued after magnitude 6.8 earthquake off northern Japan' },
    ],
  },
  {
    id: 'eu-ai-act',
    kind: 'paraphrase',
    note: 'EU / Europe / Brussels are the same actor under three names, and ' +
          '"artificial intelligence" alone is two tokens — below the old floor of three.',
    articles: [
      { publisher: 'france24.com', source: 'France 24', title: 'EU lawmakers approve sweeping artificial intelligence rules' },
      { publisher: 'dw.com', source: 'Deutsche Welle', title: 'Europe agrees landmark artificial intelligence regulation' },
      { publisher: 'theverge.com', source: 'The Verge', title: 'Brussels signs off on world-first AI law' },
    ],
  },

  /* The chaining trap. Each of the two tariff stories is a separate event, and
     the analysis piece names both. Union-find with no cohesion check will merge
     A with the bridge, the bridge with B, and hand back one cluster of five
     covering two unrelated trade disputes. */
  {
    id: 'ev-tariffs',
    kind: 'paraphrase',
    articles: [
      { publisher: 'cbsnews.com', source: 'CBS News', title: 'US announces new tariffs on Chinese electric vehicles' },
      { publisher: 'fortune.com', source: 'Fortune', title: 'Washington raises duties on electric vehicles imported from China' },
    ],
  },
  {
    id: 'steel-tariffs',
    kind: 'lexical',
    articles: [
      { publisher: 'aljazeera.com', source: 'Al Jazeera', title: 'EU weighs retaliatory tariffs on US steel imports' },
      { publisher: 'independent.co.uk', source: 'The Independent', title: 'Brussels considers tariffs on American steel imports' },
    ],
  },
  {
    id: 'trade-analysis',
    kind: 'trap',
    note: 'Bridges ev-tariffs and steel-tariffs. Must stay on its own.',
    articles: [
      { publisher: 'telegraph.co.uk', source: 'The Telegraph', title: 'Steel imports and electric vehicles: how new tariffs reshape trade' },
    ],
  },

  /* Same subject, different events — the case where a clustering pass that has
     been loosened to catch paraphrase starts doing real damage. */
  {
    id: 'united-final',
    kind: 'lexical',
    articles: [
      { publisher: 'espn.com', source: 'ESPN', title: 'Manchester United beat Arsenal to reach the cup final' },
      { publisher: 'skysports.com', source: 'Sky Sports', title: 'Manchester United reach cup final after beating Arsenal' },
    ],
  },
  {
    id: 'united-ceo',
    kind: 'trap',
    note: 'Shares the club name with united-final and nothing else.',
    articles: [
      { publisher: 'cbssports.com', source: 'CBS Sports', title: 'Manchester United appoint new chief executive' },
    ],
  },

  /* Two model launches in the same week. "releases a faster … model" is the
     shared frame; only the company differs, and the company is the story. */
  {
    id: 'openai-launch',
    kind: 'lexical',
    articles: [
      { publisher: 'techcrunch.com', source: 'TechCrunch', title: 'OpenAI releases a faster, cheaper reasoning model' },
      { publisher: 'arstechnica.com', source: 'Ars Technica', title: 'OpenAI launches faster reasoning model at lower cost' },
    ],
  },
  {
    id: 'google-launch',
    kind: 'trap',
    note: 'Near-miss against openai-launch: same verb, same adjective, same noun.',
    articles: [
      { publisher: 'engadget.com', source: 'Engadget', title: 'Google releases a faster on-device model for Android' },
      { publisher: 'cnet.com', source: 'CNET', title: 'Google launches faster on-device AI model for phones' },
    ],
  },

  {
    id: 'canada-wildfire',
    kind: 'lexical',
    articles: [
      { publisher: 'globalnews.ca', source: 'Global News', title: 'Wildfires force thousands to evacuate in western Canada' },
      { publisher: 'cbc.ca', source: 'CBC News', title: 'Thousands evacuate as wildfires spread across western Canada' },
      { publisher: 'abc.net.au', source: 'ABC News', title: 'Western Canada wildfires prompt mass evacuation orders' },
    ],
  },
  {
    id: 'mars-lander',
    kind: 'paraphrase',
    note: 'Two of the three converge on "touches down safely"; the third shares ' +
          'only the word "lander" with them. Mars/Martian, safe/safely and ' +
          'touchdown/touches down are all out of reach of token matching, so the ' +
          'group is filed by its hardest member rather than its easiest.',
    articles: [
      { publisher: 'nasa.gov', source: 'NASA', title: 'NASA lander touches down safely on the Martian surface' },
      { publisher: 'space.com', source: 'Space.com', title: 'NASA Mars lander touches down safely after seven-minute descent' },
      { publisher: 'livescience.com', source: 'Live Science', title: 'Mars lander sends first images after safe touchdown' },
    ],
  },
  {
    id: 'nhs-strike',
    kind: 'lexical',
    articles: [
      { publisher: 'standard.co.uk', source: 'Evening Standard', title: 'Junior doctors in England begin a five-day strike over pay' },
      { publisher: 'thewire.in', source: 'The Wire', title: 'Five-day junior doctors strike begins across England in pay dispute' },
    ],
  },
  {
    id: 'india-budget',
    kind: 'lexical',
    articles: [
      { publisher: 'thehindu.com', source: 'The Hindu', title: 'Finance Minister presents budget with higher capital spending' },
      { publisher: 'indianexpress.com', source: 'The Indian Express', title: 'Budget raises capital spending, keeps fiscal deficit target' },
      { publisher: 'livemint.com', source: 'Mint', title: 'Budget raises capital spending, holds the fiscal deficit target' },
    ],
  },
  {
    id: 'cricket-series',
    kind: 'lexical',
    articles: [
      { publisher: 'ndtv.com', source: 'NDTV', title: 'India beat Australia by six wickets to win the series' },
      { publisher: 'indiatimes.com', source: 'The Times of India', title: 'India beat Australia by six wickets, seal series win' },
    ],
  },
  {
    id: 'film-awards',
    kind: 'lexical',
    articles: [
      { publisher: 'variety.com', source: 'Variety', title: 'Independent drama sweeps the major categories at the awards' },
      { publisher: 'deadline.com', source: 'Deadline', title: 'Independent drama sweeps major awards categories' },
    ],
  },

  /* Ordinary unrelated stories, so precision is measured against something that
     resembles a feed rather than a page of near-duplicates. */
  ...[
    ['hollywoodreporter.com', 'The Hollywood Reporter', 'Studio delays its summer blockbuster to next year'],
    ['rollingstone.com', 'Rolling Stone', 'Veteran rock band announces a farewell world tour'],
    ['billboard.com', 'Billboard', 'Streaming numbers hit a record over the holiday weekend'],
    ['wired.com', 'WIRED', 'Researchers find a flaw in a widely used encryption library'],
    ['gizmodo.com', 'Gizmodo', 'A new deep-sea species is described off the Pacific coast'],
    ['statnews.com', 'STAT', 'Trial results show promise for a new diabetes treatment'],
    ['hindustantimes.com', 'Hindustan Times', 'Monsoon arrives early over the southern coast'],
    ['news18.com', 'News18', 'Metro line extension opens to passengers'],
    ['smh.com.au', 'The Sydney Morning Herald', 'Sydney housing approvals fall to a five-year low'],
    ['scroll.in', 'Scroll.in', 'Court reserves judgement in a long-running land dispute'],
    ['sports.yahoo.com', 'Yahoo Sports', 'Veteran quarterback signs a two-year extension'],
    ['engadget.com', 'Engadget', 'Handheld console gets a long-requested firmware update'],
    ['cnet.com', 'CNET', 'Broadband provider raises prices for existing customers'],
  ].map(([publisher, source, title], i) => ({
    id: `solo-${i + 1}`,
    kind: 'singleton',
    articles: [{ publisher, source, title }],
  })),
];

/* clusterStories() takes the shape parseFeed() produces. Timestamps descend so
   the ordering is deterministic; no item carries an image, so the group
   representative is simply the newest — none of which affects the partition
   being measured. */
export function fixture() {
  const out = [];
  let n = 0;
  for (const g of GROUPS) {
    for (const a of g.articles) {
      n++;
      out.push({
        ...a,
        gold: g.id,
        kind: g.kind,
        link: `https://example.test/${g.id}/${n}`,
        summary: '',
        image: '',
        publishedAt: new Date(Date.UTC(2026, 6, 31, 12, 0, 0) - n * 60_000).toISOString(),
      });
    }
  }
  return out;
}
