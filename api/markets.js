// Meridian — markets endpoint. Free, no-key quotes via Yahoo Finance's chart
// endpoint. Default mode returns world indices, crypto and commodities with an
// intraday sparkline series for the ticker + analysis grid. Detail mode
// (?symbol=&range=) returns a full price series for one instrument's chart.
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
  // Widely-watched stocks for the analysis grid + movers.
  { s: 'AAPL', label: 'Apple', kind: 'stock' },
  { s: 'MSFT', label: 'Microsoft', kind: 'stock' },
  { s: 'NVDA', label: 'NVIDIA', kind: 'stock' },
  { s: 'GOOGL', label: 'Alphabet', kind: 'stock' },
  { s: 'AMZN', label: 'Amazon', kind: 'stock' },
  { s: 'META', label: 'Meta', kind: 'stock' },
  { s: 'TSLA', label: 'Tesla', kind: 'stock' },
  { s: 'AVGO', label: 'Broadcom', kind: 'stock' },
  { s: 'JPM', label: 'JPMorgan', kind: 'stock' },
  { s: 'V', label: 'Visa', kind: 'stock' },
  { s: 'NFLX', label: 'Netflix', kind: 'stock' },
  { s: 'AMD', label: 'AMD', kind: 'stock' },
  { s: 'INTC', label: 'Intel', kind: 'stock' },
  { s: 'DIS', label: 'Disney', kind: 'stock' },
  { s: 'KO', label: 'Coca-Cola', kind: 'stock' },
  { s: 'BA', label: 'Boeing', kind: 'stock' },
];

// Any Yahoo-style symbol a user can chart via search (validated, not proxied).
const SYM_RE = /^[A-Za-z0-9.^=-]{1,12}$/;

// Allowed history windows → Yahoo range/interval pairs.
const RANGES = {
  '1d': { range: '1d', interval: '5m' },
  '5d': { range: '5d', interval: '30m' },
  '1mo': { range: '1mo', interval: '1d' },
  '6mo': { range: '6mo', interval: '1d' },
  '1y': { range: '1y', interval: '1wk' },
};

async function chart(sym, { range, interval }, ms = 6000) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MeridianBot/0.1)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return j?.chart?.result?.[0] || null;
  } finally {
    clearTimeout(t);
  }
}

function series(result) {
  const ts = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const pts = [];
  for (let i = 0; i < ts.length; i++) {
    if (isFinite(closes[i]) && closes[i] !== null) pts.push([ts[i] * 1000, Math.round(closes[i] * 10000) / 10000]);
  }
  return pts;
}

async function quote(inst) {
  try {
    const result = await chart(inst.s, RANGES['1d']);
    const m = result?.meta;
    if (!m || !isFinite(m.regularMarketPrice)) return null;
    const price = m.regularMarketPrice;
    const prev = isFinite(m.chartPreviousClose) ? m.chartPreviousClose : m.previousClose;
    const changePct = prev ? ((price - prev) / prev) * 100 : 0;
    return {
      symbol: inst.s,
      label: inst.label,
      kind: inst.kind,
      price: Math.round(price * 100) / 100,
      prevClose: prev ? Math.round(prev * 100) / 100 : null,
      changePct: Math.round(changePct * 100) / 100,
      currency: m.currency || 'USD',
      spark: series(result).map((p) => p[1]).slice(-80),
    };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // Search mode: find tickers by name/symbol (Yahoo's public search).
  const q = req.query?.search;
  if (q) {
    try {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(String(q).slice(0, 40))}&quotesCount=8&newsCount=0`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MeridianBot/0.1)' } }
      );
      const j = await r.json();
      const matches = (j?.quotes || [])
        .filter((m) => m.symbol && SYM_RE.test(m.symbol))
        .map((m) => ({
          symbol: m.symbol,
          name: m.shortname || m.longname || m.symbol,
          exch: m.exchDisp || m.exchange || '',
          type: m.quoteType || '',
        }));
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400, stale-if-error=604800');
      res.status(200).json({ matches });
    } catch {
      res.status(502).json({ error: 'search unavailable' });
    }
    return;
  }

  // Detail mode: full series for one symbol (known instruments get their
  // curated label; any other well-formed ticker is allowed for search→chart).
  const symbol = req.query?.symbol;
  if (symbol) {
    const inst = INSTRUMENTS.find((i) => i.s === symbol);
    const win = RANGES[String(req.query?.range || '1d')];
    if ((!inst && !SYM_RE.test(String(symbol))) || !win) { res.status(400).json({ error: 'unknown symbol or range' }); return; }
    try {
      const result = await chart(String(symbol), win);
      const m = result?.meta || {};
      const pts = series(result);
      if (!pts.length) { res.status(404).json({ error: 'no data for symbol' }); return; }
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300, stale-if-error=86400');
      res.status(200).json({
        symbol: String(symbol),
        label: inst?.label || m.shortName || m.symbol || String(symbol),
        kind: inst?.kind || (m.instrumentType || '').toLowerCase() || 'stock',
        currency: m.currency || 'USD',
        range: req.query.range || '1d',
        price: isFinite(m.regularMarketPrice) ? m.regularMarketPrice : (pts.at(-1)?.[1] ?? null),
        prevClose: isFinite(m.chartPreviousClose) ? m.chartPreviousClose : null,
        updatedAt: new Date().toISOString(),
        points: pts,
      });
    } catch {
      res.status(502).json({ error: 'upstream unavailable' });
    }
    return;
  }

  const results = await Promise.allSettled(INSTRUMENTS.map((i) => quote(i)));
  const quotes = results
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter(Boolean);

  res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=300, stale-if-error=86400');
  res.status(200).json({ updatedAt: new Date().toISOString(), count: quotes.length, quotes });
}
