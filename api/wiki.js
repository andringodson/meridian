// Meridian — Wikipedia "On This Day" endpoint (open data, no key).
// Uses Wikimedia's REST feed to surface notable historical events for today's
// date, giving the app a self-updating "history" strand alongside the news.
// ?type=events|births|deaths picks the strand (events by default).
const TYPES = new Set(['events', 'births', 'deaths']);

export default async function handler(req, res) {
  const type = TYPES.has(String(req.query?.type)) ? String(req.query.type) : 'events';
  const now = new Date();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/${type}/${mm}/${dd}`;

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'MeridianBot/0.1 (news + history reader)',
        Accept: 'application/json',
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();

    const events = (data[type] || data.events || [])
      .sort((a, b) => (b.year || 0) - (a.year || 0))
      .slice(0, 20)
      .map((e) => {
        const page = (e.pages || [])[0] || {};
        return {
          year: e.year,
          text: e.text,
          title: page.titles?.normalized || page.title || '',
          extract: page.extract || '',
          thumbnail: page.thumbnail?.source || null,
          url:
            page.content_urls?.desktop?.page ||
            (page.title
              ? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`
              : null),
        };
      });

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400, stale-if-error=604800');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json({ date: `${mm}-${dd}`, type, count: events.length, events });
  } catch (err) {
    res.status(502).json({ error: 'wikipedia_unavailable', detail: String(err) });
  }
}
