// Meridian — local weather via Open-Meteo (open data, no key). The browser
// sends coordinates only to this endpoint; nothing is stored server-side.
const ICONS = [
  [[0], '☀️', 'Clear'],
  [[1], '🌤️', 'Mostly clear'],
  [[2], '⛅', 'Partly cloudy'],
  [[3], '☁️', 'Overcast'],
  [[45, 48], '🌫️', 'Fog'],
  [[51, 53, 55, 56, 57], '🌦️', 'Drizzle'],
  [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', 'Rain'],
  [[71, 73, 75, 77, 85, 86], '🌨️', 'Snow'],
  [[95, 96, 99], '⛈️', 'Thunderstorm'],
];
function describe(code) {
  for (const [codes, icon, label] of ICONS) if (codes.includes(code)) return { icon, label };
  return { icon: '🌡️', label: 'Weather' };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const lat = parseFloat(req.query?.lat), lon = parseFloat(req.query?.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    res.status(400).json({ error: 'bad coordinates' });
    return;
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=temperature_2m,weather_code&timezone=auto`;
    const r = await fetch(url, { headers: { 'User-Agent': 'MeridianBot/0.1' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const cur = j?.current;
    if (!cur || !isFinite(cur.temperature_2m)) throw new Error('no data');
    const { icon, label } = describe(cur.weather_code);
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1800, stale-if-error=86400');
    res.status(200).json({
      temp: Math.round(cur.temperature_2m),
      unit: '°C',
      code: cur.weather_code,
      icon,
      label,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    res.status(502).json({ error: 'weather unavailable' });
  }
}
