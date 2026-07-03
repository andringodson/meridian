// Meridian — markets endpoint. Free, no-key quotes via Yahoo Finance's chart
// endpoint. Returns world indices, crypto and commodities for the live ticker.
// (Quotes may be delayed; true real-time markets require a paid feed.)
const INSTRUMENTS = [
  { s: '^GSPC', label: 'S&P 500', kind: 'index' },
  { s: '^DJI', label: 'Dow Jones', kind: 'index' },
  { s: '^IXIC', label: 'Nasdaq', kind: 'index' },
  { s: '^FTSE', label: 'FTSE 100', kind: 'index' },
  { s: '^GDAXI', label: 'DAX', kind: 'index' },
  { s: '^N225', label: 'Nikkei 225', kind: 'index' },
  { s: 'BTC-USD', label: 'Bitcoin', kind: 'crypto' },
  { s: 'ETH-USD', label: 'Ethereum', kind: 'crypto' },
  { s: 'GC=F', label: 'Gold', kind: 'commodity' },
  { s: 'CL=F', label: 'Crude Oil', kind: 'commodity' },
  { s: 'EURUSD=X', label: 'EUR/USD', kind: 'fx' },
];

async function quote(inst, ms = 5000) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(inst.s)}?range=1d&interval=1d`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MeridianBot/0.1)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const m = j?.chart?.result?.[0]?.meta;
    if (!m || !isFinite(m.regularMarketPrice)) return null;
    const price = m.regularMarketPrice;
    const prev = isFinite(m.chartPreviousClose) ? m.chartPreviousClose : m.previousClose;
    const changePct = prev ? ((price - prev) / prev) * 100 : 0;
    return {
      symbol: inst.s,
      label: inst.label,
      kind: inst.kind,
      price: Math.round(price * 100) / 100,
      changePct: Math.round(changePct * 100) / 100,
      currency: m.currency || 'USD',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  const results = await Promise.allSettled(INSTRUMENTS.map((i) => quote(i)));
  const quotes = results
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean);

  res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=300');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json({ updatedAt: new Date().toISOString(), count: quotes.length, quotes });
}
