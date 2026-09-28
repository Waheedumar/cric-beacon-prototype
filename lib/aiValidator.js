// AI validation (M3 Section 6): every factual claim in an AI insight is checked against the match data.
// Works in the browser (window.AIValidator) and on the server (require('./lib/aiValidator.js')).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AIValidator = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  function findTeam(facts, t) { const n = norm(t); return (facts.teams || []).find(x => norm(x.name) === n || norm(x.short) === n); }
  function hasPlayer(facts, name) { const n = norm(name); return (facts.players || []).some(p => norm(p) === n); }
  function validate(output, facts) {
    const errors = []; let checked = 0;
    (output && output.claims || []).forEach(c => {
      checked++;
      if (c.type === 'team_score') {
        const t = findTeam(facts, c.team);
        if (!t) errors.push({ claim: c, reason: 'Unknown team "' + c.team + '"' });
        else {
          if (c.runs != null && Number(c.runs) !== Number(t.runs)) errors.push({ claim: c, reason: t.name + ' scored ' + t.runs + ', not ' + c.runs });
          if (c.wickets != null && t.wickets != null && Number(c.wickets) !== Number(t.wickets)) errors.push({ claim: c, reason: t.name + ' lost ' + t.wickets + ' wickets, not ' + c.wickets });
        }
      } else if (c.type === 'player') {
        if (!hasPlayer(facts, c.name)) errors.push({ claim: c, reason: 'Player "' + c.name + '" is not in this match' });
      } else if (c.type === 'result') {
        if (!facts.result) errors.push({ claim: c, reason: 'No official result is available for this match' });
        else { const w = findTeam(facts, c.winner); if (!w || norm(facts.result).indexOf(norm(w.name)) !== 0) errors.push({ claim: c, reason: 'Official result is "' + facts.result + '"' }); }
      } else errors.push({ claim: c, reason: 'Unsupported claim type "' + c.type + '"' });
    });
    // Safety net: every score like "169/5" written in the text must belong to a team.
    const text = String((output && output.text) || '');
    const re = /\b(\d{1,3})\s*\/\s*(\d{1,2})\b/g; let m;
    while ((m = re.exec(text))) {
      checked++;
      const r = Number(m[1]), w = Number(m[2]);
      if (!(facts.teams || []).some(t => Number(t.runs) === r && (t.wickets == null || Number(t.wickets) === w)))
        errors.push({ claim: { type: 'text_score', value: m[0] }, reason: 'Score "' + m[0] + '" in the text does not match any team' });
    }
    return { valid: errors.length === 0, checked, errors };
  }
  return { validate };
});