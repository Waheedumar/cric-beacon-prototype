const { SportMonksAdapter } = require('./sportmonksAdapter');

// TEMPORARY TEST: This script only checks for live matches. It will be removed after the user confirms the feature works.

const token = process.env.VITE_SPORTMONKS_API_TOKEN;

if (!token) {
  console.log('⚠️  No VITE_SPORTMONKS_API_TOKEN found in environment');
  process.exit(0);
}

// Defensive fallback: same pattern as normalizeSportMonksMatch so a missing
// name never produces a blank/Unknown display.
function teamName(team) {
  return (team && (team.name || team.code || 'UNKNOWN')).toUpperCase();
}

function formatScoreboard(lsb) {
  if (!lsb) return null;
  const parts = [];
  if (lsb.runs !== undefined && lsb.runs !== null) parts.push(`${lsb.runs}/${lsb.wickets ?? 0}`);
  if (lsb.over !== undefined && lsb.over !== null) parts.push(`(${lsb.over} ov)`);
  return parts.join(' ') || null;
}

async function checkLiveMatches() {
  try {
    console.log('🔍 Checking for LIVE matches via SportMonks API...\n');

    const adapter = new SportMonksAdapter({
      token,
      retry: {
        maxAttempts: 3,
        baseDelay: 500,
        jitter: 0.3,
      },
    });

    const matches = await adapter.listLiveMatches();

    if (matches.length === 0) {
      console.log('📭 No live matches currently available.');
      return;
    }

    console.log(`✅ Found ${matches.length} live match(es):\n`);

    matches.forEach((match, index) => {
      const home = teamName(match.localteam);
      const away = teamName(match.visitorteam);
      const label = home && away ? `${home} v ${away}` : (match.name || match.match_name || 'Unknown Match');
      const score = formatScoreboard(match.live_scoreboard);
      const status = match.status || 'Unknown';

      console.log(`${index + 1}. ${label}`);
      console.log(`   ID: ${match.id}`);
      console.log(`   Status: ${status}`);
      if (score) console.log(`   Score: ${score}`);
      console.log(`   Format: ${match.format || 'Unknown'}`);
      console.log(`   Started: ${match.starting_at || 'Unknown'}`);
      console.log('   ---');
    });

  } catch (err) {
    console.error('❌ Error checking live matches:', err.message);
    process.exit(1);
  }
}

checkLiveMatches();