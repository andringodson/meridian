// Meridian — video briefs endpoint. Pulls the latest clips from major news
// channels' public YouTube RSS feeds (open data, no key). Returns titles,
// preview thumbnails and video ids for an embedded player.
import { XMLParser } from 'fast-xml-parser';

const CHANNELS = [
  { id: 'UC16niRr50-MSBwiO3YDb3RA', name: 'BBC News' },
  { id: 'UCNye-wNBqNL5ZzHSJj3l8Bg', name: 'Al Jazeera' },
  { id: 'UCknLrEdhRCp1aegoMqRaCZg', name: 'DW News' },
  { id: 'UCoMdktPbSTixAyNGwb-UYkQ', name: 'Sky News' },
  { id: 'UCeY0bbntWzzVIaj2z3QigXg', name: 'NBC News' },
  { id: 'UCupvZG-5ko_eiXAupbDfxWw', name: 'CNN' },
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  processEntities: false,
});

async function fetchChannel({ id, name }, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'MeridianBot/0.1 (news reader)' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const doc = parser.parse(await r.text());
    const entries = doc?.feed?.entry || [];
    return (Array.isArray(entries) ? entries : [entries]).map((e) => {
      const g = e['media:group'] || {};
      return {
        id: e['yt:videoId'],
        title: String(e.title || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
        channel: name,
        thumbnail: g['media:thumbnail']?.['@_url'] || `https://i.ytimg.com/vi/${e['yt:videoId']}/hqdefault.jpg`,
        publishedAt: e.published || null,
      };
    }).filter((v) => v.id && v.title);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  const results = await Promise.allSettled(CHANNELS.map((c) => fetchChannel(c)));
  const perChannel = results.map((r) => (r.status === 'fulfilled' ? r.value : []));

  // Interleave channels (newest-first within each) so no single outlet
  // dominates the reel, then keep the freshest 14.
  const mixed = [];
  for (let i = 0; mixed.length < 24; i++) {
    let added = false;
    for (const list of perChannel) {
      if (list[i]) { mixed.push(list[i]); added = true; }
    }
    if (!added) break;
  }
  const candidates = mixed
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .slice(0, 18);

  // Channels pull or embed-restrict clips (breaking news especially), which
  // leaves a black player. oEmbed answers 200 only for live, embeddable
  // videos — drop the rest. Network hiccups keep the video (fail open).
  const embeddable = await Promise.allSettled(candidates.map(async (v) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    try {
      const r = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://youtu.be/${v.id}`)}&format=json`,
        { signal: ctrl.signal, headers: { 'User-Agent': 'MeridianBot/0.1' } }
      );
      return r.ok;
    } catch {
      return true; // timeout — don't over-filter
    } finally {
      clearTimeout(t);
    }
  }));
  const videos = candidates
    .filter((_, i) => embeddable[i].status !== 'fulfilled' || embeddable[i].value)
    .slice(0, 14);

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=1800, stale-if-error=86400');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json({ updatedAt: new Date().toISOString(), count: videos.length, videos });
}
