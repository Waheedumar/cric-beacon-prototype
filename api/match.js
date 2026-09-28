// Vercel serverless function: one Sportmonks match -> normalized match document.
// Uses the same adapter as Milestones 1-2, so live and finished matches share one rendering path.
const { normalizeSportMonksMatch, normalizeSportMonksLive } = require('../sportmonksAdapter.js');

const INCLUDES = 'balls,localteam,visitorteam,venue,scoreboards,stage,runs,batting,balls.batsman,balls.bowler,balls.batsmanout,balls.catchstump,balls.score,balls.batsmanone,balls.batsmantwo,batting.result,batting.team';

module.exports = async (req, res) => {
  const token = process.env.SPORTMONKS_API_TOKEN;
  if (!token) { res.status(500).json({ error: 'SPORTMONKS_API_TOKEN not set' }); return; }
  const id = (req.query && req.query.id) ? String(req.query.id) : '';
  if (!/^\d+$/.test(id)) { res.status(400).json({ error: 'bad id' }); return; }
  const url = 'https://cricket.sportmonks.com/api/v2.0/fixtures/' + id +
    '?include=' + INCLUDES + '&api_token=' + encodeURIComponent(token);
  try {
    const r = await fetch(url);
    if (!r.ok) { const t = await r.text(); res.status(r.status).json({ error: 'sportmonks ' + r.status, detail: t.slice(0, 300) }); return; }
    const json = await r.json();
    const doc = normalizeSportMonksLive(json.data || json);
    if (req.query && req.query.check === '1') { const d = json.data || json; const ov = doc.overs || []; const runs = ov.reduce((a, o) => a + (o.balls || []).reduce((x, b) => x + (Number(b[0]) || 0), 0), 0); const wk = ov.reduce((a, o) => a + (o.balls || []).filter(b => b[1]).length, 0); const sb = (d.scoreboards || []).filter(x => x.type === 'total').map(x => ({ code: x.scoreboard, total: x.total, wickets: x.wickets, overs: x.overs })); res.status(200).json({ overs: ov.length, balls: ov.reduce((a, o) => a + (o.balls || []).length, 0), runsFromBalls: runs, wicketsFromBalls: wk, officialScoreboards: sb, bowlers: Object.keys(doc.start.bowlers || {}).length, openers: (doc.start.batsmen || []).map(b => b.name) }); return; }
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
    res.status(200).json(doc);
  } catch (e) {
    res.status(502).json({ error: 'fetch or normalize failed', detail: String((e && e.message) || e) });
  }
};
