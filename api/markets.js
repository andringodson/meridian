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

/* ---------- fallback quotes ----------
   Yahoo's chart endpoint is unofficial: it can block cloud IPs, tighten rate
   limits or change shape without notice. When a quote fails, a keyless
   secondary source fills in (CoinGecko for crypto, Frankfurter for FX), and as
   a final resort the last good quote from this warm instance is re-served
   flagged as delayed — so the ticker never goes blank on an upstream hiccup. */
const lastGood = new Map(); // symbol → quote from a previous invocation

const COINGECKO_IDS = { 'BTC-USD': 'bitcoin', 'ETH-USD': 'ethereum' };
async function cryptoFallback(insts) {
  const need = insts.filter((i) => COINGECKO_IDS[i.s]);
  if (!need.length) return [];
  const ids = need.map((i) => COINGECKO_IDS[i.s]).join(',');
  const r = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MeridianBot/0.1)' } }
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return need.map((i) => {
    const d = j[COINGECKO_IDS[i.s]];
    if (!d || !isFinite(d.usd)) return null;
    const pct = isFinite(d.usd_24h_change) ? d.usd_24h_change : 0;
    return {
      symbol: i.s, label: i.label, kind: i.kind,
      price: Math.round(d.usd * 100) / 100,
      prevClose: Math.round((d.usd / (1 + pct / 100)) * 100) / 100,
      changePct: Math.round(pct * 100) / 100,
      currency: 'USD', spark: [], delayed: true,
    };
  }).filter(Boolean);
}

async function fxFallback(inst) {
  const [base, quoteCur] = [inst.s.slice(0, 3), inst.s.slice(3, 6)]; // EURUSD=X
  const d8 = (d) => d.toISOString().slice(0, 10);
  const r = await fetch(
    `https://api.frankfurter.dev/v1/${d8(new Date(Date.now() - 6 * 864e5))}..${d8(new Date())}?base=${base}&symbols=${quoteCur}`
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const days = Object.keys(j.rates || {}).sort();
  if (!days.length) return null;
  const last = j.rates[days[days.length - 1]][quoteCur];
  const prev = days.length > 1 ? j.rates[days[days.length - 2]][quoteCur] : last;
  if (!isFinite(last)) return null;
  return {
    symbol: inst.s, label: inst.label, kind: inst.kind,
    price: Math.round(last * 10000) / 10000,
    prevClose: Math.round(prev * 10000) / 10000,
    changePct: prev ? Math.round(((last - prev) / prev) * 10000) / 100 : 0,
    currency: quoteCur, spark: [], delayed: true,
  };
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

  // Backfill anything Yahoo dropped: secondary sources first, then the last
  // good quote this instance has seen.
  const got = new Set(quotes.map((q) => q.symbol));
  const missing = INSTRUMENTS.filter((i) => !got.has(i.s));
  if (missing.length) {
    const fills = await Promise.allSettled([
      cryptoFallback(missing.filter((i) => i.kind === 'crypto')),
      ...missing.filter((i) => i.kind === 'fx').map((i) => fxFallback(i)),
    ]);
    for (const f of fills) {
      if (f.status !== 'fulfilled' || !f.value) continue;
      for (const q of [].concat(f.value)) {
        if (q && !got.has(q.symbol)) { quotes.push(q); got.add(q.symbol); }
      }
    }
    for (const i of missing) {
      const prev = lastGood.get(i.s);
      if (!got.has(i.s) && prev) { quotes.push({ ...prev, delayed: true }); got.add(i.s); }
    }
  }
  for (const q of quotes) if (!q.delayed) lastGood.set(q.symbol, q);
  const order = new Map(INSTRUMENTS.map((i, n) => [i.s, n]));
  quotes.sort((a, b) => (order.get(a.symbol) ?? 99) - (order.get(b.symbol) ?? 99));

  res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=300, stale-if-error=86400');
  res.status(200).json({ updatedAt: new Date().toISOString(), count: quotes.length, quotes });
}
