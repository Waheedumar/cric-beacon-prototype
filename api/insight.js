// M3 Section 5: grounded AI insight. Facts in -> Claude Haiku -> validated insight out.
const { validate } = require('../lib/aiValidator.js');
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const cache = new Map();
const SYSTEM = [
  'You are a cricket analyst for a live match app.',
  'Use ONLY the facts provided. Never invent players, scores, wickets or events.',
  'Reply with JSON only, no markdown: {"text": "...", "claims": [...]}',
  'text: 1-2 sentences, max 45 words.',
  'claims: every factual item mentioned in text, each one of:',
  '{"type":"team_score","team":"<team name>","runs":<n>,"wickets":<n>}',
  '{"type":"player","name":"<exact name from facts>"}',
  '{"type":"result","winner":"<team name>"} (only if facts.result exists)',
  'Write a score like 169/5 only if it is exactly in the facts.'
].join('\n');

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST only' }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(200).json({ ok: false, fallback: true, error: 'AI key not set' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const facts = body && body.facts, situation = (body && body.situation) || {};
  if (!facts || !Array.isArray(facts.teams)) { res.status(400).json({ ok: false, error: 'facts required' }); return; }
  const payload = JSON.stringify({ facts, situation });
  if (payload.length > 8000) { res.status(413).json({ ok: false, error: 'facts too large' }); return; }
  if (cache.has(payload)) { res.status(200).json(cache.get(payload)); return; }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, system: SYSTEM, messages: [{ role: 'user', content: 'Match facts (JSON):\n' + payload }] })
    });
    const j = await r.json();
    if (!r.ok) { res.status(200).json({ ok: false, fallback: true, error: 'AI request failed: ' + ((j.error && j.error.message) || r.status) }); return; }
    const raw = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').replace(/```json|```/g, '').trim();
    let out;
    try { out = JSON.parse(raw); } catch (e) { res.status(200).json({ ok: false, fallback: true, error: 'AI reply was not valid JSON' }); return; }
    const v = validate(out, facts);
    const result = v.valid
      ? { ok: true, text: String(out.text || ''), claims: out.claims || [], checked: v.checked }
      : { ok: false, fallback: true, error: 'AI insight rejected by validator', errors: v.errors.map(e => e.reason) };
    if (cache.size > 200) cache.clear();
    cache.set(payload, result);
    res.status(200).json(result);
  } catch (e) {
    res.status(200).json({ ok: false, fallback: true, error: 'AI unavailable: ' + ((e && e.message) || e) });
  }
};