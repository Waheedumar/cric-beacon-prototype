// Trace script: verify HUD display for all 4 mock matches
// Extracts MOCK_MATCHES values from index.html and runs hudTeamDisplay logic

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'index.html');
const indexContent = fs.readFileSync(indexPath, 'utf8');

const matchIds = ['galle', 'mcg', 'hambantota', 'premadasa'];

let allPassed = true;

console.log('=== HUD Display Verification ===\n');

for (const matchId of matchIds) {
  // Find match block: `matchId: { ... }`
  const matchStart = indexContent.indexOf(`${matchId}: {`);
  if (matchStart === -1) { console.error(`❌ Could not find ${matchId}`); allPassed = false; continue; }

  // Find the matching closing brace for this match object
  let braceCount = 0;
  let foundStart = false;
  let endIdx = matchStart;
  for (let i = matchStart; i < indexContent.length; i++) {
    const c = indexContent[i];
    if (c === '{') { if (!foundStart && i > matchStart + 10) foundStart = true; braceCount++; }
    else if (c === '}') { braceCount--; if (foundStart && braceCount === 0) { endIdx = i; break; } }
  }

  // Extract the VALUE part only (after the colon)
  const valueStart = indexContent.indexOf('{', matchStart);
  const matchObjStr = indexContent.slice(valueStart, endIdx + 1);

  // Convert to valid JSON
  const matchJsonStr = matchObjStr
    .replace(/'/g, '"')
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']');

  let matchData;
  try {
    matchData = JSON.parse(matchJsonStr);
  } catch (e) {
    console.error(`❌ ${matchId}: Failed to parse: ${e.message}`);
    allPassed = false;
    continue;
  }

  // Simulate hudTeamDisplay logic
  const teams = { home: matchData.teams.home, away: matchData.teams.away };
  const innings = matchData.innings || {};
  const bt = matchData.battingTeam === 'home' ? teams.home : teams.away;
  const ot = matchData.battingTeam === 'home' ? teams.away : teams.home;

  // Compute firstInnHomeWk (from index.html lines 2996-2999)
  const firstInnHomeWk = innings.firstInningsHomeWickets != null
    ? innings.firstInningsHomeWickets
    : (typeof innings.firstInningsHome === 'object' ? innings.firstInningsHome?.wickets || 0
      : (String(teams.home.key) === innings.firstInnings?.team ? (innings.firstInnings?.wickets || 0) : 0));

  const firstInnAwayWk = innings.firstInningsAwayWickets != null
    ? innings.firstInningsAwayWickets
    : (typeof innings.firstInningsAway === 'object' ? innings.firstInningsAway?.wickets || 0
      : (String(teams.away.key) === innings.firstInnings?.team ? (innings.firstInnings?.wickets || 0) : 0));

  // teamTotal (from index.html line 2658+)
  function teamTotal(teamKey) {
    const key = String(teamKey);
    const homeKey = String(teams.home.key);
    const awayKey = String(teams.away.key);
    let total = 0;

    if (key === homeKey && innings.firstInningsHome != null) {
      total += Number(innings.firstInningsHome) || 0;
    } else if (key === awayKey && innings.firstInningsAway != null) {
      total += Number(innings.firstInningsAway) || 0;
    } else {
      const first = innings.firstInnings;
      if (first && (String(first.team) === key || first.team === 'home' && key === homeKey || first.team === 'away' && key === awayKey)) {
        total += Number(first.total) || 0;
      }
    }
    return total;
  }

  // hudTeamDisplay (from index.html lines 3142-3150)
  function hudTeamDisplay(team) {
    const teamWkts = team.key === teams.home.key ? firstInnHomeWk : firstInnAwayWk;
    const teamTotalRuns = teamTotal(team.key);
    const teamBattedFirst = innings.firstInnings && (String(innings.firstInnings.team) === team.key || innings.firstInnings.team === 'home' && team.key === teams.home.key || innings.firstInnings.team === 'away' && team.key === teams.away.key);
    const teamHasBatted = teamBattedFirst || teamTotalRuns > 0 || teamWkts > 0;
    if (!teamHasBatted) return `${team.short} Yet to Bat`;
    if (teamWkts >= 10) return `${team.short} ${teamTotalRuns}`;
    return `${team.short} ${teamTotalRuns}/${teamWkts}`;
  }

  const btDisplay = hudTeamDisplay(bt);
  const otDisplay = hudTeamDisplay(ot);
  const hudLine = `${btDisplay} · ${otDisplay}`;

  // Expected values
  const expected = {
    galle: 'SA 176 · WI Yet to Bat',
    mcg: 'NZ 289 · AUS Yet to Bat',
    hambantota: 'BD 185 · NZ Yet to Bat',
    premadasa: 'SL Yet to Bat · WI Yet to Bat'
  };

  const exp = expected[matchId];
  const pass = hudLine === exp;
  if (!pass) allPassed = false;

  console.log(`${pass ? '✅' : '❌'} ${matchId.toUpperCase()}: ${hudLine}`);
  if (!pass) {
    console.log(`   Expected: ${exp}`);
    console.log(`   innings.firstInnings:`, JSON.stringify(innings.firstInnings));
    console.log(`   bt.key=${bt.key}, ot.key=${ot.key}`);
    console.log(`   firstInnHomeWk=${firstInnHomeWk}, firstInnAwayWk=${firstInnAwayWk}`);
    console.log(`   teamTotal(bt)=${teamTotal(bt.key)}, teamTotal(ot)=${teamTotal(ot.key)}`);
  }
}

console.log(`\n${allPassed ? 'All 4 matches display correctly ✅' : 'Some matches failed ❌'}`);
process.exit(allPassed ? 0 : 1);