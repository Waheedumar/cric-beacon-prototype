// Vercel serverless function: gets Sportmonks live scores for the app.
// Avoids CORS and keeps the token on the server (env var SPORTMONKS_API_TOKEN).
module.exports = async (req, res) => {
  const token = process.env.SPORTMONKS_API_TOKEN;
  if (!token) { res.status(500).json({ error: 'SPORTMONKS_API_TOKEN not set' }); return; }
  const id = (req.query && req.query.id) ? String(req.query.id) : '';
  if (id && !/^\d+$/.test(id)) { res.status(400).json({ error: 'bad id' }); return; }
  const path = id ? 'livescores/' + id : 'livescores';
  const url = 'https://cricket.sportmonks.com/api/v2.0/' + path +
    '?include=localteam,visitorteam,venue&api_token=' + encodeURIComponent(token);
  try {
    const r = await fetch(url);
    const body = await r.text();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
    res.status(r.status).send(body);
  } catch (e) {
    res.status(502).json({ error: 'upstream fetch failed' });
  }
};
